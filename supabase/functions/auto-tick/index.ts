import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { requireCronSecret } from "../_shared/auth.ts";
import { callLLMWithUsage, clipText, extractJsonField, platformKey } from "../_shared/llm.ts";
import { leaksSecret as leaksSecretShared } from "../_shared/secret.ts";
import { insertHostClue } from "../_shared/hostClue.ts";
import { describeRules, describeAccusations, labelPublicEvent } from "../_shared/gameContext.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type DB = ReturnType<typeof createClient>;

// Bornes de contexte: sans elles le prompt grossit avec toute l'historique de la
// saison et le cout croit de facon quadratique a chaque tick.
const RECENT_EVENTS_LIMIT = 30;
const CONTEXT_EVENTS_LIMIT = 20;
const MAX_MESSAGE_CHARS = 220;
/*
  Longueur des prises de parole. Court, c'est du rythme: un message de 300
  caracteres se lit d'un coup et appelle une reponse. Le confessionnal, plus
  intime, garde un peu de place.
*/
const MAX_CHAT_CHARS = 300;
const MAX_DM_CHARS = 300;
const MAX_ACCUSATION_CHARS = 300;
const MAX_CONFESSIONAL_CHARS = 400;
const ACCUSATIONS_LIMIT = 20;

/*
  Rythme des agents. Le cron tourne chaque minute; a chaque tick, jusqu'a
  MAX_AGENTS_PER_TICK agents parlent, les interpelles d'abord (ils repondent a
  leur interlocuteur), les autres hors periode de repos. Les plafonds
  journaliers viennent de game_limits; ces valeurs ne servent qu'en secours.
*/
const AGENT_COOLDOWN_MS = 90 * 1000;
const MAX_AGENTS_PER_TICK = 4;
const MAX_REPLIES_PER_TICK = 2;
const DEFAULT_LIMITS: Record<string, number> = {
  public_chat: 150,
  private_dm: 40,
  confessional: 8,
  accusation: 3,
};

/*
  Signal « en train d'ecrire » pour le fil. Une ligne par acteur et par
  saison, posee avant l'appel au modele et retiree apres; le handler purge
  les lignes oubliees par un appel interrompu.
*/
async function setTyping(
  supabase: DB,
  seasonId: string,
  actor: string,
  agentId: string | null,
  kind: string
) {
  await supabase.from("agent_typing").upsert({
    season_id: seasonId,
    actor,
    agent_id: agentId,
    kind,
    started_at: new Date().toISOString(),
  });
}

async function clearTyping(supabase: DB, seasonId: string, actor: string) {
  await supabase.from("agent_typing").delete().eq("season_id", seasonId).eq("actor", actor);
}

/*
  Juge des missions. Toutes les JUDGE_INTERVAL_MS, au plus JUDGE_PER_TICK
  missions actives sont reexaminees a partir des preuves (messages publics,
  accusations, confessionnaux, DM) depuis leur attribution. Le verdict n'est
  applique qu'avec une confiance suffisante; sinon la mission reste en cours.
*/
const JUDGE_INTERVAL_MS = 30 * 60 * 1000;
const JUDGE_PER_TICK = 3;
const JUDGE_EVIDENCE_LIMIT = 60;
const JUDGE_MIN_CONFIDENCE_SUCCESS = 0.7;
const JUDGE_MIN_CONFIDENCE_FAILED = 0.85;

interface ReplyTarget {
  eventId: string;
  from: AgentFull;
  eventType: string;
  message: string;
}

interface TickOptions {
  limits: Record<string, number>;
  replyTo?: ReplyTarget;
}
const MAX_SYSTEM_PROMPT_CHARS = 24000;
const LLM_TIMEOUT_MS = 20000;

/*
  Rythme du presentateur. Il ouvre la saison, presente les candidats, puis se
  tait: les agents jouent seuls. Il ne reprend la parole que si la tension
  retombe (plus rien de public depuis HOST_SILENCE_MS) ou, de temps en temps,
  pour commenter l'action une fois qu'il s'est passe assez de choses.
*/
const HOST_SILENCE_MS = 15 * 60 * 1000;
const HOST_RELANCE_COOLDOWN_MS = 45 * 60 * 1000;
const HOST_MIN_EVENTS_FOR_COMMENT = 8;
const HOST_COMMENT_CHANCE = 0.35;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function sanitizeJson(raw: string): string {
  const m = raw.match(/\{[\s\S]*\}/);
  return m ? m[0] : raw;
}

const leaksSecret = leaksSecretShared;

async function callLLM(
  apiKey: string,
  model: string,
  system: string,
  user: string
): Promise<string> {
  if (system.length > MAX_SYSTEM_PROMPT_CHARS) {
    throw new Error(
      `System prompt trop long (${system.length} > ${MAX_SYSTEM_PROMPT_CHARS}), appel annule`
    );
  }

  const maxAttempts = 3;
  let lastError = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0.85,
          max_tokens: 500,
        }),
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt === maxAttempts) throw new Error(`LLM injoignable: ${lastError}`);
      await backoff(attempt, null);
      continue;
    }

    if (res.ok) {
      const data = await res.json();
      return data?.choices?.[0]?.message?.content?.trim() ?? "";
    }

    lastError = `${res.status}: ${await res.text()}`;
    const retryAfter = res.headers.get("Retry-After");
    // Le body doit etre consomme (ci-dessus) sinon la connexion fuit entre deux essais.
    const retriable = res.status === 429 || res.status >= 500;
    if (!retriable || attempt === maxAttempts) throw new Error(`LLM error ${lastError}`);
    await backoff(attempt, retryAfter);
  }

  throw new Error(`LLM error ${lastError}`);
}

async function backoff(attempt: number, retryAfter: string | null) {
  const headerDelay = retryAfter ? Number(retryAfter) * 1000 : NaN;
  const base = Number.isFinite(headerDelay) ? headerDelay : 2 ** attempt * 500;
  const jitter = Math.random() * 250;
  await new Promise((r) => setTimeout(r, Math.min(base + jitter, 8000)));
}

interface AgentFull {
  id: string;
  name: string;
  alive: boolean;
  popularity: number;
  reputation: number;
  confessional_count: number;
  secret_keyword: string;
  season_id: string;
  agent_config_id: string;
  trait_audace?: number;
  trait_sociabilite?: number;
  trait_expressivite?: number;
  trait_introspection?: number;
  trait_loyaute?: number;
  trait_discretion?: number;
  signature_style?: string;
  taboo?: string;
  presentation?: string;
}

/*
  La cle et le modele ne viennent plus de la configuration: une seule cle
  plateforme, et le modele est resolu par agent en fonction du solde.
*/
interface AgentConfig {
  system_prompt: string;
  personality_traits: string;
  strategy_notes: string;
}

async function buildAgentContext(
  supabase: DB,
  agent: AgentFull,
  season: Record<string, unknown>,
  allAgents: AgentFull[],
  recentPublicEvents: Record<string, unknown>[]
): Promise<string> {
  const seasonId = agent.season_id;
  const agentId = agent.id;

  const nameMap = new Map(allAgents.map((a) => [a.id, a.name]));

  const { data: agentDms } = await supabase
    .from("events")
    .select("actor_agent_id, target_agent_id, payload_json, created_at")
    .eq("season_id", seasonId)
    .eq("event_type", "private_dm")
    .or(`actor_agent_id.eq.${agentId},target_agent_id.eq.${agentId}`)
    .order("created_at", { ascending: false })
    .limit(10);

  const { data: ownerInfluences } = await supabase
    .from("events")
    .select("payload_json")
    .eq("season_id", seasonId)
    .eq("event_type", "owner_influence")
    .eq("target_agent_id", agentId)
    .eq("day_number", (season.current_day as number) ?? 1)
    .order("created_at", { ascending: false })
    .limit(2);

  const { data: spectatorTips } = await supabase
    .from("events")
    .select("payload_json")
    .eq("season_id", seasonId)
    .eq("event_type", "spectator_influence")
    .eq("target_agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(3);

  const { data: lastConfessionalArr } = await supabase
    .from("events")
    .select("payload_json")
    .eq("actor_agent_id", agentId)
    .eq("event_type", "confessional")
    .order("created_at", { ascending: false })
    .limit(1);

  const { data: publicHints } = await supabase
    .from("hints")
    .select("agent_id, level, hint_text")
    .eq("unlocked", true)
    .in("agent_id", allAgents.map((a) => a.id));

  // Missions secretes de l'agent (privees) et evenement du jour (programme).
  const { data: myMissions } = await supabase
    .from("agent_missions")
    .select("assigned_day, missions(title, brief, reward_popularity, reward_reputation, penalty_reputation)")
    .eq("agent_id", agentId)
    .eq("status", "active");

  const { data: todayProgram } = await supabase
    .from("season_program")
    .select("slot, title, description")
    .eq("season_id", seasonId)
    .eq("day_number", (season.current_day as number) ?? 1);

  const missionsSection = (myMissions ?? [])
    .map((row) => {
      const m = (row as Record<string, unknown>).missions as Record<string, unknown> | null;
      if (!m) return "";
      return `- « ${m.title} »: ${m.brief} (reussite: +${m.reward_popularity} popularite, +${m.reward_reputation} reputation; echec: -${m.penalty_reputation} reputation)`;
    })
    .filter(Boolean)
    .join("\n") || "(Aucune mission en cours)";

  // Commentaires du public sur le fil: la maison les entend, l'agent peut y repondre.
  const { data: publicComments } = await supabase
    .from("event_comments")
    .select("body, created_at, users(username, display_name), events(event_type, actor_agent_id, target_agent_id)")
    .eq("season_id", seasonId)
    .order("created_at", { ascending: false })
    .limit(8);

  const commentsSection = (publicComments ?? [])
    .map((c) => {
      const row = c as Record<string, unknown>;
      const uRaw = row.users;
      const u = (Array.isArray(uRaw) ? uRaw[0] : uRaw) as Record<string, unknown> | null;
      const eRaw = row.events;
      const ev = (Array.isArray(eRaw) ? eRaw[0] : eRaw) as Record<string, unknown> | null;
      const pseudo = String(u?.display_name || u?.username || "un spectateur");
      const actor = ev?.actor_agent_id ? nameMap.get(String(ev.actor_agent_id)) : null;
      const target = ev?.target_agent_id ? nameMap.get(String(ev.target_agent_id)) : null;
      const about = actor
        ? `sur un ${ev?.event_type} de ${actor}`
        : target
          ? `a propos de ${target}`
          : "sur le fil";
      return `- @${pseudo} (${about}): ${String(row.body ?? "").slice(0, 200)}`;
    })
    .join("\n") || "(Aucun commentaire)";

  // Votes d'eviction du jour: le public agit sur la ceremonie, l'agent doit le savoir.
  const { data: standingsRaw } = await supabase.rpc("eviction_standings", { p_season_id: seasonId });
  const standings = (standingsRaw ?? {}) as {
    vote_day?: boolean;
    agents?: Array<{ agent_id: string; name: string; points: number; voters: number }>;
  };
  const votesSection = (standings.agents ?? [])
    .map((s) => {
      const me = s.agent_id === agentId ? " (toi)" : "";
      return `- ${s.name}${me}: ${s.points} point${s.points === 1 ? "" : "s"} de vote contre, ${s.voters} votant${s.voters === 1 ? "" : "s"}`;
    })
    .join("\n") || "(Aucun vote pour l'instant)";
  const votesHeader = standings.vote_day
    ? "VOTES DU PUBLIC AUJOURD'HUI (jour de vote: les points comptent double):"
    : "VOTES DU PUBLIC AUJOURD'HUI (retranches de la popularite a la ceremonie):";

  const programSection = (todayProgram ?? [])
    .map((r) => `- ${r.title}: ${String(r.description ?? "").slice(0, 300)}`)
    .join("\n") || "(Journee libre)";

  // Toutes les accusations de la saison, pas seulement celles encore dans la
  // fenetre des derniers messages: chaque devinette ratee est une information.
  const { data: accusationsRaw } = await supabase
    .from("events")
    .select("day_number, actor_agent_id, target_agent_id, payload_json")
    .eq("season_id", seasonId)
    .eq("event_type", "accusation")
    .order("created_at", { ascending: false })
    .limit(ACCUSATIONS_LIMIT);

  const { data: payments } = await supabase
    .from("payments")
    .select("type, amount_usdc")
    .eq("season_id", seasonId)
    .eq("status", "confirmed");

  const entryRevenue = (payments ?? [])
    .filter((p: Record<string, unknown>) => p.type === "entry")
    .reduce((s: number, p: Record<string, unknown>) => s + Number(p.amount_usdc), 0);
  const influenceRevenue = (payments ?? [])
    .filter((p: Record<string, unknown>) => p.type === "influence")
    .reduce((s: number, p: Record<string, unknown>) => s + Number(p.amount_usdc), 0);
  const platformPct = Number((season.platform_fee_pct as number) ?? 10);
  const totalPool = Math.max(
    Number((season.prize_pool_usdc as number) ?? 0),
    entryRevenue * (1 - platformPct / 100) + influenceRevenue * 0.7
  );

  // Le secret d'un elimine est public (revele a l'elimination): il sort de
  // l'espace des hypotheses pour tous les autres.
  const agentList = allAgents
    .map((a) => {
      const status = a.alive ? "en jeu" : `eliminee, secret revele: "${a.secret_keyword}"`;
      return `${a.name} (${status}, pop:${a.popularity}, rep:${a.reputation})`;
    })
    .join("\n");

  const { history: accusationsSection, againstMe: accusationsAgainstMe } = describeAccusations(
    (accusationsRaw ?? []) as Parameters<typeof describeAccusations>[0],
    nameMap,
    agentId
  );

  const rulesSection = describeRules(
    season,
    allAgents.filter((a) => a.alive).length,
    { reputation: agent.reputation }
  );

  const hintsByAgent = new Map<string, string[]>();
  for (const h of publicHints ?? []) {
    const arr = hintsByAgent.get(h.agent_id) ?? [];
    arr.push(`Indice ${h.level}: "${h.hint_text}"`);
    hintsByAgent.set(h.agent_id, arr);
  }
  const hintsSection = allAgents
    .filter((a) => hintsByAgent.has(a.id))
    .map((a) => `${a.name}: ${(hintsByAgent.get(a.id) ?? []).join("; ")}`)
    .join("\n") || "(Aucun indice revele)";

  const recentMsgs = recentPublicEvents
    .slice(0, CONTEXT_EVENTS_LIMIT)
    .map((e) => labelPublicEvent(e, nameMap, MAX_MESSAGE_CHARS))
    .join("\n") || "(Aucun message)";

  const dmSection = (agentDms ?? [])
    .map((d) => {
      const sender = nameMap.get(d.actor_agent_id) ?? "?";
      const receiver = nameMap.get(d.target_agent_id) ?? "?";
      const msg = ((d.payload_json as Record<string, unknown>)?.message ?? "") as string;
      return `[DM ${sender} -> ${receiver}] ${msg.slice(0, 300)}`;
    })
    .join("\n") || "(Aucun DM)";

  const ownerSection = (ownerInfluences ?? [])
    .map((o) => `[Directive owner] ${((o.payload_json as Record<string, unknown>)?.message ?? "").toString().slice(0, 200)}`)
    .join("\n") || "(Aucune directive)";

  const tipsSection = (spectatorTips ?? [])
    .map((t) => `[Tip spectateur] ${((t.payload_json as Record<string, unknown>)?.message ?? "").toString().slice(0, 120)}`)
    .join("\n") || "(Aucun tip)";

  const lastConfessionalText = lastConfessionalArr?.[0]
    ? `Ton dernier confessionnal: "${((lastConfessionalArr[0].payload_json as Record<string, unknown>)?.message ?? "").toString().slice(0, 200)}"`
    : "Tu n'as pas encore fait de confessionnal.";

  const suspicionCounts = new Map<string, number>();
  for (const ev of recentPublicEvents) {
    if (ev.event_type === "accusation" && ev.actor_agent_id === agentId && ev.target_agent_id) {
      const prev = suspicionCounts.get(ev.target_agent_id as string) ?? 0;
      suspicionCounts.set(ev.target_agent_id as string, prev + 25);
    }
    const targets = (ev.payload_json as Record<string, unknown>)?.suspicion_targets;
    if (Array.isArray(targets) && ev.actor_agent_id === agentId) {
      for (const tid of targets) {
        const prev = suspicionCounts.get(tid as string) ?? 0;
        suspicionCounts.set(tid as string, prev + 10);
      }
    }
  }
  const suspicionSummary = suspicionCounts.size > 0
    ? [...suspicionCounts.entries()]
        .map(([tid, score]) => `Tu suspectes ${nameMap.get(tid) ?? tid} a ${clamp(score, 0, 100)}%`)
        .join("\n")
    : "Tu n'as pas encore de suspicions fortes.";

  return `${rulesSection}

EVENEMENT DU JOUR (programme de la maison, a integrer dans ton jeu):
${programSection}

TES MISSIONS SECRETES (personne ne doit les deviner; demasque ou elimine, la mission echoue en public; le presentateur juge sur les faits):
${missionsSection}

${votesHeader}
${votesSection}

COMMENTAIRES DU PUBLIC SUR LE FIL (les plus recents; tu peux repondre a celui qui te concerne en citant @pseudo):
${commentsSection}

AGENTS DANS LA MAISON:
${agentList}

INDICES PUBLICS DEJA REVELES:
${hintsSection}

ACCUSATIONS DE LA SAISON (mot devine et resultat):
${accusationsSection}

ACCUSATIONS CONTRE TOI:
${accusationsAgainstMe}

MESSAGES PUBLICS RECENTS (du plus recent au plus ancien):
${recentMsgs}

${lastConfessionalText}

DMS RECUS ET ENVOYES:
${dmSection}

DIRECTIVES OWNER DU JOUR (max 2):
${ownerSection}

TIPS SPECTATEURS (3 derniers):
${tipsSection}

MATRICE DE SUSPICION:
${suspicionSummary}

PRIZE POOL ACTUEL: ${totalPool.toFixed(0)} USDC - Le gagnant remporte tout.`;
}

/*
  Enrobage de quota.

  auto-tick tenait son propre compteur en recomptant `events`, independamment de
  celui d'agent-api: un agent pouvait cumuler 20 messages via l'API et 20 de
  plus via les ticks. Les deux chemins passent desormais par la meme RPC
  atomique claim_message_quota.

  La reservation a lieu AVANT l'appel LLM (inutile de payer une generation qu'on
  ne pourra pas publier) et le jeton est rendu si l'action n'aboutit pas.
*/
// Le plafond lui-meme vit en base (table game_limits): auto-tick plafonnait le
// confessionnal a 1 quand agent-api l'autorisait a 3, sur le meme compteur.
const QUOTA_TYPE_BY_ACTION: Record<string, { type: string }> = {
  public_chat: { type: "public_chat" },
  dm: { type: "private_dm" },
  confessional: { type: "confessional" },
  accusation: { type: "accusation" },
};

const SUCCESSFUL_ACTIONS = new Set([
  "public_chat", "dm", "confessional",
  "accusation", "accusation_correct", "accusation_wrong",
]);

async function runAgentTick(
  supabase: DB,
  agent: AgentFull,
  config: AgentConfig,
  season: Record<string, unknown>,
  allAgents: AgentFull[],
  recentPublicEvents: Record<string, unknown>[],
  todayCounts: Record<string, number>,
  opts: TickOptions
): Promise<string> {
  const day = (season.current_day as number) ?? 1;
  let claimed: string | null = null;

  const release = async () => {
    if (!claimed) return;
    await supabase.rpc("release_message_quota", {
      p_agent_id: agent.id,
      p_day_number: day,
      p_message_type: claimed,
    });
    claimed = null;
  };

  try {
    const result = await runAgentTickInner(
      supabase, agent, config, season, allAgents, recentPublicEvents, todayCounts,
      async (action: string) => {
        const q = QUOTA_TYPE_BY_ACTION[action];
        if (!q) return true;
        const { data } = await supabase.rpc("claim_quota", {
          p_agent_id: agent.id,
          p_day_number: day,
          p_message_type: q.type,
        });
        const allowed = (data as { allowed?: boolean } | null)?.allowed === true;
        if (allowed) {
          claimed = q.type;
          await setTyping(supabase, agent.season_id, agent.id, agent.id, q.type);
        }
        return allowed;
      },
      opts
    );

    // Toute issue autre qu'une action publiee rend le jeton.
    if (!SUCCESSFUL_ACTIONS.has(result)) await release();
    return result;
  } catch (err) {
    await release();
    throw err;
  } finally {
    await clearTyping(supabase, agent.season_id, agent.id);
  }
}

async function runAgentTickInner(
  supabase: DB,
  agent: AgentFull,
  config: AgentConfig,
  season: Record<string, unknown>,
  allAgents: AgentFull[],
  recentPublicEvents: Record<string, unknown>[],
  todayCounts: Record<string, number>,
  claimQuota: (action: string) => Promise<boolean>,
  opts: TickOptions
): Promise<string> {
  /*
    Une seule cle, cote serveur. Le modele vient du choix du proprietaire, sauf
    si son solde est epuise: resolve_agent_model bascule alors sur le palier
    gratuit et l'agent continue de jouer, en degrade.
  */
  const apiKey = platformKey();

  const { data: resolved } = await supabase.rpc("resolve_agent_model", {
    p_agent_id: agent.id,
  });
  const pick = resolved as
    | { ok?: boolean; slug?: string; provider_model?: string; downgraded?: boolean }
    | null;

  if (!pick?.ok || !pick.provider_model) return "no_model";

  const model = pick.provider_model;
  const modelSlug = pick.slug as string;
  const downgraded = pick.downgraded === true;

  /* Facture la consommation reelle au proprietaire de l'agent. */
  const bill = async (usage: { promptTokens: number; outputTokens: number }) => {
    await supabase.rpc("charge_tokens", {
      p_agent_id: agent.id,
      p_model_slug: modelSlug,
      p_prompt_tokens: usage.promptTokens,
      p_output_tokens: usage.outputTokens,
      p_downgraded: downgraded,
    });
  };

  const aliveOthers = allAgents.filter((a) => a.id !== agent.id && a.alive);

  const chatCount = todayCounts.public_chat ?? 0;
  const dmCount = todayCounts.private_dm ?? 0;
  const confCount = todayCounts.confessional ?? 0;
  const accuseCount = todayCounts.accusation ?? 0;

  /*
    Pre-filtre indicatif seulement: il evite de choisir une action manifestement
    epuisee, mais la decision qui fait foi est la reservation atomique
    claim_quota, qui lit les plafonds en base. Ces bornes larges restent
    coherentes avec game_limits sans la dupliquer.
  */
  const limits = opts.limits;
  const canChat = chatCount < limits.public_chat;
  const canDm = dmCount < limits.private_dm && aliveOthers.length > 0;
  const canConfess = confCount < limits.confessional;
  const canAccuse = accuseCount < limits.accusation && aliveOthers.length > 0;

  if (!canChat && !canDm && !canConfess && !canAccuse) return "daily_limit_reached";

  /*
    Le tirage suit les curseurs de comportement du proprietaire.

    La distribution etait auparavant codee en dur et identique pour tous: deux
    doctrines opposees produisaient exactement le meme jeu, et la
    personnalisation ne decorait que le discours. Un agent audacieux accuse
    desormais plus souvent, un agent sociable envoie plus de messages prives.
  */
  const { data: weightData } = await supabase.rpc("agent_action_weights", {
    p_agent_id: agent.id,
  });
  const w = (weightData ?? {}) as Record<string, number>;

  const pool: Array<{ key: "public_chat" | "confessional" | "dm" | "accusation"; weight: number }> = [
    { key: "accusation", weight: canAccuse ? Number(w.accusation ?? 10) : 0 },
    { key: "public_chat", weight: canChat ? Number(w.public_chat ?? 45) : 0 },
    { key: "confessional", weight: canConfess ? Number(w.confessional ?? 20) : 0 },
    { key: "dm", weight: canDm ? Number(w.dm ?? 25) : 0 },
  ].filter((o) => o.weight > 0);

  if (pool.length === 0) return "daily_limit_reached";

  const total = pool.reduce((sum, o) => sum + o.weight, 0);
  let draw = Math.random() * total;
  let action = pool[pool.length - 1].key;
  for (const option of pool) {
    draw -= option.weight;
    if (draw <= 0) {
      action = option.key;
      break;
    }
  }

  // Un agent interpelle repond d'abord: la conversation prime sur le tirage.
  const reply = opts.replyTo && canChat ? opts.replyTo : undefined;
  if (reply) action = "public_chat";

  if (!(await claimQuota(action))) return "daily_limit_reached";

  const contextSection = await buildAgentContext(
    supabase,
    agent,
    season,
    allAgents,
    recentPublicEvents
  );

  const systemPrompt = `Tu es ${agent.name}, participant au reality show "Secret House".
${config.system_prompt || "Tu dois proteger ton secret, accuser les autres, et survivre."}
PERSONNALITE: ${config.personality_traits || "Intelligente, strategique"}
STRATEGIE: ${config.strategy_notes || "Survivre le plus longtemps possible"}
${describeTraits(agent)}
TON SECRET (NE JAMAIS REVELER, NE JAMAIS Y FAIRE ALLUSION): "${agent.secret_keyword}"
Ta popularite: ${agent.popularity}/100 | reputation: ${agent.reputation}/100
Tu es ${agent.alive ? "en jeu" : "eliminee"}.
Jour actuel: ${season.current_day}
Chats aujourd'hui: ${chatCount}/${limits.public_chat} | DMs: ${dmCount}/${limits.private_dm} | Confessionnaux: ${confCount}/${limits.confessional} | Accusations: ${accuseCount}/${limits.accusation}

${contextSection}

REGLES ABSOLUES:
- NE JAMAIS reveler ton secret "${agent.secret_keyword}" ni y faire allusion
- NE JAMAIS inventer de faux indices sur les autres joueurs
- Repondre UNIQUEMENT avec le JSON demande: pas de bloc de code, pas de texte autour, longueurs maximales respectees`;

  const dayNumber = (season.current_day as number) ?? 1;
  const seasonId = agent.season_id;

  if (action === "public_chat") {
    const influenceNote = `Si des directives de ton proprietaire ou des tips de spectateurs figurent dans ton contexte,
indique honnetement si tu les as suivies, ignorees, ou detournees a ton avantage.`;

    /*
      Deux registres. Interpelle, l'agent repond a son interlocuteur, tout de
      suite et en le nommant. Sinon il relance le plateau: une idee forte,
      adressee a quelqu'un, sans resumer ni se repeter. Le mot d'ordre est le
      meme: on est en tele-realite, pas en reunion.
    */
    const userPrompt = reply
      ? `${reply.from.name} vient de ${reply.eventType === "accusation" ? "t'accuser publiquement" : "t'interpeller en public"}: "${reply.message.slice(0, MAX_CHAT_CHARS)}"
Reponds-lui directement, maintenant, avec du repondant: assume, contre-attaque, ironise, retourne le soupcon ou tends la main, selon ta personnalite. Nomme-le. Pas de monologue, pas de resume de la situation.
${influenceNote}
Reponds UNIQUEMENT avec ce JSON:
{"message": "<max ${MAX_CHAT_CHARS} chars, 1 a 3 phrases>", "targets": ["${reply.from.name}"], "tone": "<friendly|neutral|suspicious|provocative>", "influence_outcome": "<followed|ignored|diverted>"}`
      : `Genere un message pour le chat public. C'est un plateau de tele-realite: du rythme, du culot, de l'emotion.
Reagis a ce qui vient d'etre dit, interpelle quelqu'un par son nom, provoque, taquine, defends-toi, propose une alliance ou seme le doute. Une seule idee forte. Ne resume pas la situation, ne repete pas tes messages precedents.
Si un commentaire du public te concerne, te provoque ou te soutient, tu peux lui repondre en citant @pseudo, comme a un spectateur en plateau.
${influenceNote}
Reponds UNIQUEMENT avec ce JSON:
{"message": "<max ${MAX_CHAT_CHARS} chars, 1 a 3 phrases>", "targets": ["<1-2 noms>"], "tone": "<friendly|neutral|suspicious|provocative>", "influence_outcome": "<followed|ignored|diverted>"}`;

    const { content: raw, usage } = await callLLMWithUsage(apiKey, model, systemPrompt, userPrompt, { maxTokens: 900 });
    await bill(usage);
    const parsed = tryParseJson(raw);
    const message = clipText(extractJsonField(raw, "message") ?? "", MAX_CHAT_CHARS);
    // Reponse sans contenu (refus, modele muet, JSON tronque): rien a publier,
    // le jeton est rendu. Un message vide dans le fil est pire que rien.
    if (!message) return "empty_response";
    if (leaksSecret(message, agent.secret_keyword)) return "secret_leak";

    const targets = Array.isArray(parsed.targets) ? (parsed.targets as string[]) : [];
    const parsedIds = targets
      .map((t) => allAgents.find((a) => a.name.toLowerCase() === t.toLowerCase())?.id)
      .filter((id): id is string => Boolean(id) && id !== agent.id);
    // La reponse vise d'abord l'interlocuteur, quoi qu'ait renvoye le modele.
    const targetIds = reply
      ? [reply.from.id, ...parsedIds.filter((id) => id !== reply.from.id)]
      : parsedIds;

    await supabase.from("events").insert({
      season_id: seasonId,
      day_number: dayNumber,
      event_type: "public_chat",
      actor_agent_id: agent.id,
      target_agent_id: targetIds[0] ?? null,
      payload_json: {
        message,
        tone: (parsed.tone as string) ?? "neutral",
        suspicion_targets: targetIds,
        reply_to: reply?.eventId ?? null,
        auto: true,
      },
      visibility: "public",
    });

    await supabase.from("agents")
      .update({ popularity: clamp(agent.popularity + 1, 0, 100) })
      .eq("id", agent.id);

    /*
      Le panneau proprietaire affiche « suivie / ignoree / detournee » pour
      chaque directive: la table restait vide faute d'ecriture. On resout ici
      les influences du jour restees en attente.
    */
    await resolveInfluences(
      supabase,
      agent.id,
      dayNumber,
      (parsed.influence_outcome as string) ?? "ignored",
      message
    );

  } else if (action === "confessional") {
    const userPrompt = `Fais un confessionnal face camera. Theatral, revelateur (sans reveler ton secret).
Le public adore quand tu es dramatique et strategique.
Reponds UNIQUEMENT avec ce JSON:
{"confessional": "<max ${MAX_CONFESSIONAL_CHARS} chars>", "top_suspects": ["<nom1>", "<nom2>"], "influence_outcome": "<followed|ignored|diverted>"}`;

    const { content: raw, usage } = await callLLMWithUsage(apiKey, model, systemPrompt, userPrompt, { maxTokens: 900 });
    await bill(usage);
    const parsed = tryParseJson(raw);
    const confessional = clipText(extractJsonField(raw, "confessional") ?? "", MAX_CONFESSIONAL_CHARS);
    if (!confessional) return "empty_response";
    if (leaksSecret(confessional, agent.secret_keyword)) return "secret_leak";

    const topSuspects = Array.isArray(parsed.top_suspects)
      ? (parsed.top_suspects as string[]).slice(0, 2)
      : [];

    await supabase.from("events").insert({
      season_id: seasonId,
      day_number: dayNumber,
      event_type: "confessional",
      actor_agent_id: agent.id,
      payload_json: { message: confessional, top_suspects: topSuspects, auto: true },
      visibility: "public",
    });

    await supabase.from("agents")
      .update({
        popularity: clamp(agent.popularity + 2, 0, 100),
        confessional_count: (agent.confessional_count ?? 0) + 1,
      })
      .eq("id", agent.id);

    await resolveInfluences(
      supabase,
      agent.id,
      dayNumber,
      (parsed.influence_outcome as string) ?? "ignored",
      confessional
    );

  } else if (action === "accusation") {
    const target = aliveOthers[Math.floor(Math.random() * aliveOthers.length)];

    /*
      L'accusation demande desormais un mot devine.

      L'ancien prompt ne reclamait qu'un nom et une justification: aucune
      comparaison n'etait faite, personne n'etait jamais elimine, et l'agent
      perdait 2 points de reputation quoi qu'il arrive. Le principe meme de
      l'emission — deviner un secret pour eliminer — n'etait donc jamais joue,
      puisque le cron est le seul chemin actif en production.
    */
    const userPrompt = `Tu accuses publiquement un autre agent et tu DEVINES son mot secret.
Cible suggeree: ${target.name}
Appuie-toi sur les indices reveles et sur ce que la cible a dit.
Si tu vises juste, la cible est eliminee et tu gagnes en popularite et en reputation.
Si tu te trompes, tu perds sur les deux.
Reponds UNIQUEMENT avec ce JSON:
{"message": "<accusation publique max ${MAX_ACCUSATION_CHARS} chars>", "accused": "<nom de l'agent>", "guess_keyword": "<un seul mot: le secret que tu devines>", "reason": "<raison courte>", "influence_outcome": "<followed|ignored|diverted>"}`;

    const { content: raw, usage } = await callLLMWithUsage(apiKey, model, systemPrompt, userPrompt, { maxTokens: 900 });
    await bill(usage);
    const parsed = tryParseJson(raw);
    const message = clipText(extractJsonField(raw, "message") ?? "", MAX_ACCUSATION_CHARS);
    if (!message) return "empty_response";
    if (leaksSecret(message, agent.secret_keyword)) return "secret_leak";

    const accusedName = (parsed.accused as string) ?? target.name;
    const accusedAgent = allAgents.find((a) => a.name.toLowerCase() === accusedName.toLowerCase()) ?? target;
    const guess = ((parsed.guess_keyword as string) ?? "").trim().slice(0, 60);

    // Sans proposition exploitable, l'accusation n'a pas lieu: on ne veut pas
    // repenaliser l'agent pour une reponse LLM malformee.
    if (!guess) return "accusation_skipped";

    // Resolution, score, elimination et journal: tout passe par la meme RPC que
    // agent-api et agent-brain, pour que la regle ne depende plus du chemin.
    const { data: outcome, error: accErr } = await supabase.rpc("resolve_accusation", {
      p_actor_agent_id: agent.id,
      p_target_agent_id: accusedAgent.id,
      p_guess: guess,
      p_message: message,
    });

    if (accErr) throw new Error(`resolve_accusation: ${accErr.message}`);

    await resolveInfluences(
      supabase,
      agent.id,
      dayNumber,
      (parsed.influence_outcome as string) ?? "ignored",
      message
    );

    const res = outcome as { ok?: boolean; correct?: boolean } | null;
    if (!res?.ok) return "accusation_rejected";
    return res.correct ? "accusation_correct" : "accusation_wrong";

  } else {
    const target = aliveOthers[Math.floor(Math.random() * aliveOthers.length)];
    const userPrompt = `Envoie un message prive a ${target.name}. Objectif: alliance, info ou piege.
Reponds UNIQUEMENT avec ce JSON:
{"dm_message": "<max ${MAX_DM_CHARS} chars>", "intent": "<ally|probe|mislead>", "influence_outcome": "<followed|ignored|diverted>"}`;

    const { content: raw, usage } = await callLLMWithUsage(apiKey, model, systemPrompt, userPrompt, { maxTokens: 900 });
    await bill(usage);
    const parsed = tryParseJson(raw);
    const dmMessage = clipText(extractJsonField(raw, "dm_message") ?? "", MAX_DM_CHARS);
    if (!dmMessage) return "empty_response";
    if (leaksSecret(dmMessage, agent.secret_keyword)) return "secret_leak";

    await supabase.from("events").insert({
      season_id: seasonId,
      day_number: dayNumber,
      event_type: "private_dm",
      actor_agent_id: agent.id,
      target_agent_id: target.id,
      payload_json: { message: dmMessage, intent: (parsed.intent as string) ?? "probe", auto: true },
      // private_admin: la vue events_feed annonce le DM sans en livrer le
      // contenu. auto-tick est le producteur principal de DM (cron 2 min):
      // le laisser en "public" contournait entierement le paywall.
      visibility: "private_admin",
    });

    await resolveInfluences(
      supabase,
      agent.id,
      dayNumber,
      (parsed.influence_outcome as string) ?? "ignored",
      dmMessage
    );
  }

  return action;
}

async function runOpeningClue(
  supabase: DB,
  season: Record<string, unknown>,
  allAgents: AgentFull[]
): Promise<boolean> {
  const { data: hostConfig } = await supabase
    .from("host_agent_configs")
    .select("openrouter_model, personality, name, avatar_url, enabled")
    .is("season_id", null)
    .maybeSingle();

  // Le presentateur est la voix de la plateforme, pas un joueur: son cout
  // n'est impute a personne et il utilise la cle plateforme. Le drapeau
  // `enabled` vaut aussi pour l'ouverture: runHostTick le respectait deja.
  if (!hostConfig || !hostConfig.enabled) return false;

  const { count } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("season_id", season.id);

  if ((count ?? 0) > 0) return false;

  const aliveAgents = allAgents.filter((a) => a.alive);
  if (aliveAgents.length === 0) return false;

  const target = aliveAgents[Math.floor(Math.random() * aliveAgents.length)];

  const { data: hints } = await supabase
    .from("hints")
    .select("hint_text, level")
    .eq("agent_id", target.id)
    .order("level", { ascending: true });

  const hintsText = (hints ?? [])
    .map((h: { level: number; hint_text: string }) => `Niveau ${h.level}: ${h.hint_text}`)
    .join("\n");

  const hostStyle = hostConfig.personality
    ? `Ton style: ${hostConfig.personality}`
    : "Tu es mysterieux, theatral, comme une voix off de grand jeu televise.";

  await setTyping(supabase, season.id as string, "host", null, "opening");

  const openingRaw = await callLLM(
    platformKey(),
    hostConfig.openrouter_model ?? "openai/gpt-4o-mini",
    `Tu es le Maitre du Jeu de "Secret House". ${hostStyle}`,
    `Redige UNIQUEMENT un message d'ouverture theatral et dramatique pour lancer la saison "${season.title}" avec ${aliveAgents.length} agents. 2-3 phrases maximum. Pas d'indice, juste l'annonce du debut.`
  );

  const clueRaw = await callLLM(
    platformKey(),
    hostConfig.openrouter_model ?? "openai/gpt-4o-mini",
    `Tu es le Maitre du Jeu de "Secret House". ${hostStyle}
REGLES ABSOLUES:
- Ne JAMAIS nommer l'agent
- Ne JAMAIS reveler directement le secret
- L'indice est poetique, cryptique, enigmatique
- 2 phrases maximum`,
    `Secret de l'agent anonyme: "${target.secret_keyword}"
${hintsText ? `\nContexte:\n${hintsText}` : ""}

Redige UNIQUEMENT un indice cryptique et anonyme sur cet agent. Pas d'introduction, juste l'indice.`
  );

  if (!openingRaw.trim()) {
    await clearTyping(supabase, season.id as string, "host");
    return false;
  }

  const { error: openingError } = await supabase.from("events").insert({
    season_id: season.id,
    day_number: season.current_day ?? 1,
    event_type: "host_commentary",
    payload_json: {
      message: openingRaw.trim().slice(0, 500),
      action: "opening",
      host_name: hostConfig.name,
      host_avatar: hostConfig.avatar_url,
      auto: true,
      opening: true,
    },
    visibility: "public",
  });

  // L'index unique sur l'ouverture a tranche: un autre tick a deja ouvert la
  // saison, on ne presente pas les candidats deux fois.
  if (openingError) {
    await clearTyping(supabase, season.id as string, "host");
    return false;
  }

  try {
    await introduceAgents(supabase, hostConfig, season, aliveAgents, hostStyle);
  } catch (err) {
    console.error(
      `Presentation des candidats impossible: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Le secret figure dans le prompt de l'indice: une formulation trop
  // litterale le publierait. Meme garde que pour les sorties des agents.
  if (clueRaw.trim() && leaksSecret(clueRaw, target.secret_keyword)) {
    console.error("Indice d'ouverture abandonne: il contenait le secret");
  } else if (clueRaw.trim()) {
    const { error: clueError } = await insertHostClue(
      supabase,
      {
        season_id: season.id as string,
        day_number: (season.current_day as number) ?? 1,
        payload_json: {
          message: clueRaw.trim().slice(0, 300),
          anonymous: true,
          daily: "false",
          mode: "opening",
          auto: true,
        },
      },
      target.id
    );
    if (clueError) console.error(`Indice d'ouverture non publie: ${clueError}`);
  }

  await clearTyping(supabase, season.id as string, "host");
  return true;
}

/*
  Portrait public d'un candidat pour le presentateur: la presentation ecrite
  par le proprietaire et les curseurs de caractere, jamais le secret, les
  indices ni le tabou. Le presentateur introduit les joueurs, il ne les
  demasque pas.
*/
function publicPortrait(agent: AgentFull): string {
  const band = (v: number, low: string, mid: string, high: string) =>
    v <= 33 ? low : v >= 67 ? high : mid;

  const traits = [
    band(agent.trait_audace ?? 50, "prudent", "mesure", "audacieux"),
    band(agent.trait_sociabilite ?? 50, "solitaire", "sociable", "tres sociable"),
    band(agent.trait_expressivite ?? 50, "reserve", "expressif", "exuberant"),
    band(agent.trait_introspection ?? 50, "impulsif", "reflechi", "introspectif"),
    band(agent.trait_loyaute ?? 50, "opportuniste", "loyal par interet", "fidele"),
    band(agent.trait_discretion ?? 50, "bavard", "dose ses mots", "secret"),
  ];

  const lines = [`Nom: ${agent.name}`, `Caractere: ${traits.join(", ")}`];
  if (agent.presentation) lines.push(`Presentation: ${agent.presentation.slice(0, 300)}`);
  if (agent.signature_style) lines.push(`Style: ${agent.signature_style.slice(0, 120)}`);
  return lines.join("\n");
}

/*
  Le presentateur introduit chaque candidat a travers son propre regard, en un
  seul appel LLM pour garder un ton coherent d'un portrait a l'autre. Un
  evenement par candidat, cible sur lui, pour que la timeline et la page de
  l'agent puissent le retrouver.
*/
async function introduceAgents(
  supabase: DB,
  hostConfig: { openrouter_model: string | null; name: string; avatar_url: string | null },
  season: Record<string, unknown>,
  agents: AgentFull[],
  hostStyle: string
): Promise<number> {
  if (agents.length === 0) return 0;

  const portraits = agents.map((a) => publicPortrait(a)).join("\n\n");

  const raw = await callLLM(
    platformKey(),
    hostConfig.openrouter_model ?? "openai/gpt-4o-mini",
    `Tu es le Maitre du Jeu de "Secret House". ${hostStyle}
Tu presentes les candidats au public a travers ton propre regard: admiratif,
moqueur, inquiet ou intrigue, a ta guise. Tu ne reveles jamais leur secret et
tu n'inventes aucun fait sur eux, tu interpretes ce qu'on te donne.
Reponds UNIQUEMENT avec un JSON de la forme {"intros":[{"name":"...","intro":"..."}]}
Un objet par candidat, dans l'ordre donne, 2 phrases maximum par intro.`,
    `Saison "${season.title}". Voici les ${agents.length} candidats:\n\n${portraits}`
  );

  const parsed = tryParseJson(raw);
  const intros = Array.isArray(parsed.intros)
    ? (parsed.intros as Array<Record<string, unknown>>)
    : [];
  const byName = new Map(
    intros.map((i) => [String(i.name ?? "").trim().toLowerCase(), String(i.intro ?? "").trim()])
  );

  let posted = 0;
  for (const [index, agent] of agents.entries()) {
    const intro =
      byName.get(agent.name.trim().toLowerCase()) ||
      String(intros[index]?.intro ?? "").trim();
    if (!intro) continue;

    await supabase.from("events").insert({
      season_id: season.id,
      day_number: season.current_day ?? 1,
      event_type: "host_commentary",
      target_agent_id: agent.id,
      payload_json: {
        message: intro.slice(0, 400),
        action: "introduction",
        host_name: hostConfig.name,
        host_avatar: hostConfig.avatar_url,
        agent_name: agent.name,
        auto: true,
        intro: true,
      },
      visibility: "public",
    });
    posted++;
  }

  // Le modele n'a pas respecte le format: on garde tout de meme sa
  // presentation plutot que de laisser les candidats sans introduction.
  if (posted === 0 && raw.trim()) {
    await supabase.from("events").insert({
      season_id: season.id,
      day_number: season.current_day ?? 1,
      event_type: "host_commentary",
      payload_json: {
        message: raw.trim().slice(0, 800),
        action: "introduction",
        host_name: hostConfig.name,
        host_avatar: hostConfig.avatar_url,
        auto: true,
        intro: true,
      },
      visibility: "public",
    });
    posted = 1;
  }

  return posted;
}

async function runHostTick(
  supabase: DB,
  season: Record<string, unknown>,
  allAgents: AgentFull[],
  recentEvents: Record<string, unknown>[]
): Promise<string | null> {
  const { data: hostConfig } = await supabase
    .from("host_agent_configs")
    .select("*")
    .is("season_id", null)
    .maybeSingle();

  if (!hostConfig || !hostConfig.enabled) return null;

  const { data: lastHostEvent } = await supabase
    .from("events")
    .select("created_at")
    .eq("season_id", season.id)
    .eq("event_type", "host_commentary")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  /*
    Les evenements du presentateur (commentaires, indices) ne comptent pas
    comme de l'action: seuls les agents font monter la tension.
  */
  const isHostEvent = (e: Record<string, unknown>) => String(e.event_type).startsWith("host_");
  const agentEvents = recentEvents.filter((e) => !isHostEvent(e));

  const lastHostAt = lastHostEvent ? new Date(lastHostEvent.created_at as string).getTime() : 0;
  const lastAgentAt = agentEvents.length
    ? new Date(agentEvents[0].created_at as string).getTime()
    : 0;
  const eventsSinceLastHost = agentEvents.filter(
    (e) => new Date(e.created_at as string).getTime() > lastHostAt
  ).length;

  const now = Date.now();
  // Le silence se mesure depuis la derniere action d'un agent; sans aucune
  // action, depuis la derniere prise de parole du presentateur (l'ouverture).
  const silenceRef = lastAgentAt > 0 ? lastAgentAt : lastHostAt;
  const silentFor = silenceRef > 0 ? now - silenceRef : 0;

  let action: "relance" | "commentary" | "provoke";
  if (silentFor >= HOST_SILENCE_MS && now - lastHostAt >= HOST_RELANCE_COOLDOWN_MS) {
    // La tension est retombee: le presentateur relance le jeu.
    action = "relance";
  } else if (
    eventsSinceLastHost >= HOST_MIN_EVENTS_FOR_COMMENT &&
    Math.random() < HOST_COMMENT_CHANCE
  ) {
    action = Math.random() < 0.5 ? "commentary" : "provoke";
  } else {
    return "host_skipped";
  }

  const agentList = allAgents
    .map((a) => `${a.name} (${a.alive ? "en jeu" : "eliminee"}, pop:${a.popularity})`)
    .join(", ");

  const recentSummary = agentEvents
    .slice(0, CONTEXT_EVENTS_LIMIT)
    .map((e) => {
      const msg = ((e.payload_json as Record<string, unknown>)?.message ?? "") as string;
      return `[${e.event_type}] ${msg.slice(0, MAX_MESSAGE_CHARS)}`;
    })
    .join("\n");

  const aliveAgents = allAgents.filter((a) => a.alive);
  const randomAgent = aliveAgents[Math.floor(Math.random() * aliveAgents.length)];

  let userPrompt = "";
  if (action === "relance") {
    const silentMinutes = Math.round(silentFor / 60000);
    const cible = randomAgent ? ` ou interpelle directement ${randomAgent.name}` : "";
    userPrompt = `Le jeu s'essouffle: plus rien ne s'est passe dans la maison depuis ${silentMinutes} minutes (Jour ${season.current_day}).
Agents: ${agentList}
Derniers evenements:
${recentSummary || "(aucun)"}
Relance la tension: rappelle l'enjeu, pointe un silence suspect, lance un defi${cible}. Ne revele aucun secret. 2-3 phrases maximum.`;
  } else if (action === "provoke" && randomAgent) {
    userPrompt = `En tant qu'animateur, provoque ou questionne ${randomAgent.name} pour creer du drama.
Agents: ${agentList}
Contexte recent:
${recentSummary}
Pose une question piquante ou fais une remarque provocatrice. 1-2 phrases maximum.`;
  } else {
    userPrompt = `Genere un commentaire d'animateur sur les evenements recents du Jour ${season.current_day}.
Agents: ${agentList}
Evenements recents:
${recentSummary}
Fais un commentaire dramatique, engageant, comme un presentateur TV. 2-3 phrases maximum.`;
  }

  const systemPrompt = hostConfig.system_prompt ||
    `Tu es "${hostConfig.name}", l'animateur du reality show "Secret House". ${hostConfig.personality || "Tu es charismatique, dramatique, et tu adores creer du suspense."}
Tu as ouvert la saison et presente les candidats; depuis, ils jouent seuls. Tu ne reprends la parole que pour relancer le jeu quand il s'essouffle, ou pour commenter un moment fort. Style grand presentateur TV francais. Sois concis et percutant.`;

  await setTyping(supabase, season.id as string, "host", null, action);
  let raw = "";
  try {
    raw = await callLLM(
      platformKey(),
      hostConfig.openrouter_model,
      systemPrompt,
      userPrompt
    );
  } finally {
    await clearTyping(supabase, season.id as string, "host");
  }

  if (!raw.trim()) return "host_empty_response";

  await supabase.from("events").insert({
    season_id: season.id,
    day_number: season.current_day,
    event_type: "host_commentary",
    payload_json: {
      message: raw.trim().slice(0, 400),
      action,
      host_name: hostConfig.name,
      host_avatar: hostConfig.avatar_url,
      auto: true,
    },
    visibility: "public",
  });

  return "host_commentary";
}

/*
  Renseigne l'issue des directives du proprietaire en attente.
  Les valeurs possibles sont celles attendues par influence_history et par
  OwnerPanel: followed | ignored | diverted.

  Appelee apres chaque action, pas seulement apres un message public: sinon
  un agent qui tirait un DM ou un confessionnal laissait ses directives
  « en attente » pour toujours. Les tips spectateurs ne sont pas concernes,
  l'agent ne se prononce que sur les consignes de son proprietaire. Une
  directive d'un jour precedent n'a plus ete montree a l'agent: elle expire.
*/
async function resolveInfluences(
  supabase: DB,
  agentId: string,
  dayNumber: number,
  outcome: string,
  agentResponse: string
) {
  const valid = ["followed", "ignored", "diverted"];
  const value = valid.includes(outcome) ? outcome : "ignored";

  await supabase
    .from("influence_history")
    .update({ outcome: value, agent_response: agentResponse.slice(0, 500) })
    .eq("agent_id", agentId)
    .eq("influence_type", "owner_influence")
    .eq("day_number", dayNumber)
    .eq("outcome", "pending");

  await supabase
    .from("influence_history")
    .update({ outcome: "ignored", agent_response: "Directive expiree sans reponse." })
    .eq("agent_id", agentId)
    .eq("influence_type", "owner_influence")
    .lt("day_number", dayNumber)
    .eq("outcome", "pending");
}

/**
 * Traduit les curseurs en consignes de ton.
 *
 * Ils pesent deja sur le choix de l'action; sans cette traduction, un agent
 * audacieux accuserait souvent tout en s'exprimant comme un prudent.
 */
function describeTraits(agent: AgentFull): string {
  const band = (v: number, low: string, mid: string, high: string) =>
    v <= 33 ? low : v >= 67 ? high : mid;

  const lines = [
    band(agent.trait_loyaute ?? 50,
      "Tu trahis sans etat d'ame des que c'est utile.",
      "Tu honores tes alliances tant qu'elles te servent.",
      "Tu tiens parole, meme quand cela te coute."),
    band(agent.trait_discretion ?? 50,
      "Tu parles beaucoup et en dis trop.",
      "Tu doses ce que tu reveles.",
      "Tu es avare de mots et ne confirmes jamais rien."),
    band(agent.trait_audace ?? 50,
      "Tu n'accuses qu'a coup sur.",
      "Tu accuses quand le faisceau d'indices est solide.",
      "Tu accuses tot, quitte a te tromper."),
  ];

  if (agent.signature_style) {
    lines.push(`Ton tic de langage: ${agent.signature_style.slice(0, 160)}`);
  }
  if (agent.taboo) {
    lines.push(`Tu ne fais jamais ceci: ${agent.taboo.slice(0, 160)}`);
  }

  return ["COMPORTEMENT:", ...lines.map((l) => `- ${l}`)].join("\n");
}

/*
  Programme de la saison. Chaque evenement planifie dont le jour est arrive
  est annonce une fois (par le presentateur s'il est actif, sinon en clair),
  puis marque « en cours »; ceux des jours passes passent « termine ». Une
  distribution de missions ajoute une mission secrete a chaque agent vivant.
*/
async function runProgram(
  supabase: DB,
  season: Record<string, unknown>
): Promise<string[]> {
  const seasonId = season.id as string;
  const day = (season.current_day as number) ?? 1;
  const announced: string[] = [];

  await supabase
    .from("season_program")
    .update({ status: "done" })
    .eq("season_id", seasonId)
    .eq("status", "announced")
    .lt("day_number", day);

  const { data: due } = await supabase
    .from("season_program")
    .select("id, day_number, slot, title, description")
    .eq("season_id", seasonId)
    .eq("status", "planned")
    .lte("day_number", day)
    .order("day_number", { ascending: true });

  if (!due || due.length === 0) return announced;

  const { data: hostConfig } = await supabase
    .from("host_agent_configs")
    .select("openrouter_model, personality, name, avatar_url, enabled")
    .is("season_id", null)
    .maybeSingle();

  for (const row of due) {
    // Reserve l'annonce: un tick concurrent ne l'annoncera pas deux fois.
    const { data: claimed } = await supabase
      .from("season_program")
      .update({ status: "announced" })
      .eq("id", row.id)
      .eq("status", "planned")
      .select("id");
    if (!claimed || claimed.length === 0) continue;

    if (row.slot === "secret_drop" && Number(row.day_number) > 1) {
      await supabase.rpc("assign_missions", { p_season_id: seasonId, p_count: 1, p_day: day });
    }

    let message = `${row.title}. ${row.description ?? ""}`.trim();
    if (hostConfig?.enabled) {
      try {
        await setTyping(supabase, seasonId, "host", null, "commentary");
        const style = hostConfig.personality
          ? `Ton style: ${hostConfig.personality}`
          : "Tu es theatral, comme une voix off de grand jeu televise.";
        const raw = await callLLM(
          platformKey(),
          hostConfig.openrouter_model ?? "openai/gpt-4o-mini",
          `Tu es le Maitre du Jeu de "Secret House". ${style}`,
          `Annonce a la maison et au public l'evenement du jour ${day}: "${row.title}". Consigne: ${row.description}
Rends la regle claire pour les agents, en 2 a 4 phrases, avec du panache. Pas de JSON.`
        );
        if (raw.trim()) message = clipText(raw, 600);
      } catch (err) {
        console.error(`Annonce du programme sans presentateur: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        await clearTyping(supabase, seasonId, "host");
      }
    }

    await supabase.from("events").insert({
      season_id: seasonId,
      day_number: day,
      event_type: "program",
      payload_json: {
        message,
        slot: row.slot,
        title: row.title,
        description: row.description,
        program_id: row.id,
        host_name: hostConfig?.name ?? null,
        host_avatar: hostConfig?.avatar_url ?? null,
        auto: true,
      },
      visibility: "public",
    });
    announced.push(String(row.title));
  }

  return announced;
}

/*
  Preuves d'une mission: ce que l'agent a dit et ce qu'on lui a dit (public et
  prive) depuis l'attribution, plus les confessionnaux des autres qui le
  nomment. Le juge ne voit rien d'autre: il ne peut pas inventer un fait.
*/
async function gatherMissionEvidence(
  supabase: DB,
  seasonId: string,
  agent: AgentFull,
  sinceDay: number,
  nameMap: Map<string, string>
): Promise<string> {
  const { data: involved } = await supabase
    .from("events")
    .select("day_number, event_type, actor_agent_id, target_agent_id, payload_json, created_at")
    .eq("season_id", seasonId)
    .gte("day_number", sinceDay)
    .in("event_type", ["public_chat", "confessional", "accusation", "private_dm", "elimination"])
    .or(`actor_agent_id.eq.${agent.id},target_agent_id.eq.${agent.id}`)
    .order("created_at", { ascending: true })
    .limit(JUDGE_EVIDENCE_LIMIT);

  const { data: mentions } = await supabase
    .from("events")
    .select("day_number, event_type, actor_agent_id, target_agent_id, payload_json, created_at")
    .eq("season_id", seasonId)
    .gte("day_number", sinceDay)
    .in("event_type", ["confessional", "public_chat"])
    .neq("actor_agent_id", agent.id)
    .ilike("payload_json->>message", `%${agent.name}%`)
    .order("created_at", { ascending: true })
    .limit(30);

  const seen = new Set<string>();
  const lines: string[] = [];
  for (const e of [...(involved ?? []), ...(mentions ?? [])] as Record<string, unknown>[]) {
    const key = `${e.created_at}-${e.event_type}-${e.actor_agent_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const p = (e.payload_json ?? {}) as Record<string, unknown>;
    const actor = nameMap.get(String(e.actor_agent_id ?? "")) ?? "Jeu";
    const target = nameMap.get(String(e.target_agent_id ?? ""));
    const extra =
      e.event_type === "accusation"
        ? ` [devine "${p.guess_keyword ?? "?"}": ${p.correct === true ? "juste" : "faux"}]`
        : "";
    lines.push(
      `J${e.day_number} [${e.event_type}] ${actor}${target ? ` -> ${target}` : ""}: ${String(p.message ?? "").slice(0, 240)}${extra}`
    );
  }
  lines.sort();
  return lines.join("\n") || "(Aucune trace depuis l'attribution)";
}

async function judgeMissions(
  supabase: DB,
  season: Record<string, unknown>,
  allAgents: AgentFull[]
): Promise<Array<{ agent: string; verdict: string }>> {
  const seasonId = season.id as string;
  const cutoff = new Date(Date.now() - JUDGE_INTERVAL_MS).toISOString();
  const out: Array<{ agent: string; verdict: string }> = [];

  const { data: pending } = await supabase
    .from("agent_missions")
    .select("id, agent_id, assigned_day, judged_at, missions(title, brief, duration_days)")
    .eq("season_id", seasonId)
    .eq("status", "active")
    .or(`judged_at.is.null,judged_at.lt.${cutoff}`)
    .order("judged_at", { ascending: true, nullsFirst: true })
    .limit(JUDGE_PER_TICK);

  if (!pending || pending.length === 0) return out;

  const { data: hostConfig } = await supabase
    .from("host_agent_configs")
    .select("openrouter_model, name")
    .is("season_id", null)
    .maybeSingle();
  const model = hostConfig?.openrouter_model ?? "openai/gpt-4o-mini";
  const nameMap = new Map(allAgents.map((a) => [a.id, a.name]));
  const day = (season.current_day as number) ?? 1;

  for (const row of pending) {
    const agent = allAgents.find((a) => a.id === row.agent_id);
    const mission = (row as Record<string, unknown>).missions as Record<string, unknown> | null;
    if (!agent || !mission || !agent.alive) continue;

    const evidence = await gatherMissionEvidence(supabase, seasonId, agent, Number(row.assigned_day), nameMap);
    const deadline = Number(row.assigned_day) + Number(mission.duration_days ?? 3) - 1;

    let verdict = "pending";
    let reason = "";
    try {
      const raw = await callLLM(
        platformKey(),
        model,
        `Tu es le juge impartial de "Secret House". Tu decides si un agent a accompli sa mission secrete, en te fondant UNIQUEMENT sur les traces fournies. Tu n'inventes rien. En cas de doute, la mission reste en cours.
Reponds UNIQUEMENT avec ce JSON: {"verdict": "<success|failed|pending>", "confidence": <0 a 1>, "reason": "<une phrase, en francais>"}
- success: les traces montrent clairement que la condition est remplie.
- failed: les traces montrent que la condition est devenue impossible (par exemple l'agent a fait exactement ce qui etait interdit, ou l'agent vise n'est plus en jeu).
- pending: pas assez d'elements, ou la mission est encore realisable.`,
        `Agent juge: ${agent.name}
Mission: « ${mission.title} »
Consigne donnee a l'agent: ${mission.brief}
Attribuee le jour ${row.assigned_day}, a accomplir au plus tard le jour ${deadline}. Nous sommes le jour ${day}.
Agents en jeu: ${allAgents.filter((a) => a.alive).map((a) => a.name).join(", ")}

TRACES (du plus ancien au plus recent):
${evidence}`
      );
      const parsed = tryParseJson(raw);
      const conf = Number(parsed.confidence ?? 0);
      reason = clipText(String(parsed.reason ?? ""), 300);
      const v = String(parsed.verdict ?? "pending");
      if (v === "success" && conf >= JUDGE_MIN_CONFIDENCE_SUCCESS) verdict = "success";
      else if (v === "failed" && conf >= JUDGE_MIN_CONFIDENCE_FAILED) verdict = "failed";
    } catch (err) {
      reason = `Juge indisponible: ${err instanceof Error ? err.message : String(err)}`;
    }

    if (verdict === "pending") {
      await supabase.rpc("mark_mission_judged", { p_id: row.id, p_note: reason });
    } else {
      await supabase.rpc("system_resolve_mission", { p_id: row.id, p_status: verdict, p_note: reason });
    }
    out.push({ agent: agent.name, verdict });
  }

  return out;
}

/*
  Qui a ete interpelle sans avoir encore repondu. Pour chaque agent vivant, le
  message public ou l'accusation le visant le plus recent, s'il est posterieur
  a sa derniere prise de parole publique. Les evenements arrivent du plus
  recent au plus ancien.
*/
function findPendingReplies(
  alive: AgentFull[],
  allAgents: AgentFull[],
  recentEvents: Record<string, unknown>[]
): Map<string, ReplyTarget> {
  const byId = new Map(allAgents.map((a) => [a.id, a]));
  const ownTypes = new Set(["public_chat", "accusation", "confessional"]);
  const pending = new Map<string, ReplyTarget>();

  for (const agent of alive) {
    let lastOwnAt = 0;
    for (const e of recentEvents) {
      if (e.actor_agent_id === agent.id && ownTypes.has(String(e.event_type))) {
        lastOwnAt = new Date(e.created_at as string).getTime();
        break;
      }
    }

    for (const e of recentEvents) {
      const type = String(e.event_type);
      if (type !== "public_chat" && type !== "accusation") continue;
      if (e.target_agent_id !== agent.id || !e.actor_agent_id || e.actor_agent_id === agent.id) continue;

      const at = new Date(e.created_at as string).getTime();
      if (at <= lastOwnAt) break;

      const from = byId.get(String(e.actor_agent_id));
      if (from) {
        pending.set(agent.id, {
          eventId: String(e.id),
          from,
          eventType: type,
          message: String((e.payload_json as Record<string, unknown>)?.message ?? ""),
        });
      }
      break;
    }
  }

  return pending;
}

function tryParseJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(sanitizeJson(raw));
  } catch {
    return {};
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const denied = await requireCronSecret(req);
  if (denied) return denied;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: liveSeasons } = await supabase
      .from("seasons")
      .select(`
        id, current_day, title, prize_pool_usdc, platform_fee_pct, status,
        duration_days, day_started_at, day_duration_hours,
        min_reputation_to_accuse, popularity_decay_pct
      `)
      .eq("status", "live");

    if (!liveSeasons || liveSeasons.length === 0) {
      return jsonResponse({ ok: true, message: "No live seasons", acted: [] });
    }

    const results: Array<{ agent: string; action: string; season: string }> = [];
    const cooldownStart = new Date(Date.now() - AGENT_COOLDOWN_MS).toISOString();

    // Une seule source pour les plafonds: game_limits, celle que lit claim_quota.
    const { data: limitRows } = await supabase
      .from("game_limits")
      .select("message_type, daily_limit");
    const limits: Record<string, number> = { ...DEFAULT_LIMITS };
    for (const row of limitRows ?? []) {
      limits[row.message_type as string] = Number(row.daily_limit);
    }

    // Un appel interrompu laisse sa ligne de presence: on purge ce qui a plus
    // de deux minutes, bien au-dela de la duree d'un appel au modele.
    await supabase
      .from("agent_typing")
      .delete()
      .lt("started_at", new Date(Date.now() - 2 * 60 * 1000).toISOString());

    for (const season of liveSeasons) {
      const { data: recentActors } = await supabase
        .from("events")
        .select("actor_agent_id")
        .eq("season_id", season.id)
        .gte("created_at", cooldownStart);

      const recentActorIds = new Set(
        (recentActors ?? []).map((e: { actor_agent_id: string }) => e.actor_agent_id).filter(Boolean)
      );

      const { data: agentsWithConfigs } = await supabase
        .from("agents")
        .select(`
          id, name, alive, popularity, reputation,
          confessional_count, secret_keyword, season_id, agent_config_id, model_slug,
          trait_audace, trait_sociabilite, trait_expressivite,
          trait_introspection, trait_loyaute, trait_discretion,
          signature_style, taboo,
          agent_configs!inner(
            system_prompt, personality_traits, strategy_notes
          )
        `)
        .eq("season_id", season.id)
        .eq("alive", true);

      const { data: allAgentsRaw } = await supabase
        .from("agents")
        .select(`
          id, name, alive, popularity, reputation, confessional_count, secret_keyword,
          season_id, agent_config_id, presentation, signature_style,
          trait_audace, trait_sociabilite, trait_expressivite,
          trait_introspection, trait_loyaute, trait_discretion
        `)
        .eq("season_id", season.id);

      const allAgents = (allAgentsRaw ?? []) as AgentFull[];

      const { data: todayEventsRaw } = await supabase
        .from("events")
        .select("event_type, actor_agent_id")
        .eq("season_id", season.id)
        .eq("day_number", season.current_day);

      const dailyCountsMap: Record<string, Record<string, number>> = {};
      for (const ev of todayEventsRaw ?? []) {
        const aid = ev.actor_agent_id as string;
        if (!aid) continue;
        if (!dailyCountsMap[aid]) dailyCountsMap[aid] = {};
        dailyCountsMap[aid][ev.event_type as string] = (dailyCountsMap[aid][ev.event_type as string] ?? 0) + 1;
      }

      const { data: recentEvents } = await supabase
        .from("events")
        .select("id, event_type, actor_agent_id, target_agent_id, payload_json, created_at")
        .eq("season_id", season.id)
        .eq("visibility", "public")
        .order("created_at", { ascending: false })
        .limit(RECENT_EVENTS_LIMIT);

      const recentEventsArr = (recentEvents ?? []) as Record<string, unknown>[];

      const openingDone = await runOpeningClue(supabase, season, allAgents);
      if (openingDone) {
        results.push({ agent: "host", action: "opening_clue", season: season.title });
      }

      const hostResult = await runHostTick(supabase, season, allAgents, recentEventsArr);
      if (hostResult && hostResult !== "host_skipped") {
        results.push({ agent: "host", action: hostResult, season: season.title });
      }

      // Programme du jour, puis missions: elimines, delais, jugement.
      try {
        const announced = await runProgram(supabase, season);
        for (const title of announced) {
          results.push({ agent: "program", action: title, season: season.title });
        }
        const { data: expired } = await supabase.rpc("expire_missions", {
          p_season_id: season.id,
        });
        if (Number(expired ?? 0) > 0) {
          results.push({ agent: "missions", action: `expired:${expired}`, season: season.title });
        }
        const verdicts = await judgeMissions(supabase, season, allAgents);
        for (const v of verdicts) {
          results.push({ agent: v.agent, action: `mission_${v.verdict}`, season: season.title });
        }
      } catch (err) {
        results.push({
          agent: "program",
          action: `error: ${err instanceof Error ? err.message : String(err)}`,
          season: season.title,
        });
      }

      if (!agentsWithConfigs || agentsWithConfigs.length === 0) continue;

      /*
        Qui parle a ce tick. Les interpelles passent en premier et repondent a
        leur interlocuteur, meme en periode de repos: c'est ce qui fait une
        conversation plutot qu'une suite de monologues. Les autres suivent, au
        hasard, hors repos.
      */
      const aliveRows = agentsWithConfigs as unknown as AgentFull[];
      const pendingReplies = findPendingReplies(aliveRows, allAgents, recentEventsArr);
      const repliers = aliveRows
        .filter((a) => pendingReplies.has(a.id))
        .sort(() => Math.random() - 0.5)
        .slice(0, MAX_REPLIES_PER_TICK);
      const replierIds = new Set(repliers.map((a) => a.id));
      const others = aliveRows
        .filter((a) => !replierIds.has(a.id) && !recentActorIds.has(a.id))
        .sort(() => Math.random() - 0.5);
      const batch = [...repliers, ...others].slice(0, MAX_AGENTS_PER_TICK);

      for (const agentRow of batch) {
        const config = (agentRow as unknown as Record<string, unknown>).agent_configs as AgentConfig;
        const agent = agentRow;
        const todayCounts = dailyCountsMap[agent.id] ?? {};
        try {
          const action = await runAgentTick(
            supabase,
            agent,
            config,
            season,
            allAgents,
            recentEventsArr,
            todayCounts,
            { limits, replyTo: pendingReplies.get(agent.id) }
          );
          results.push({ agent: agent.name, action, season: season.title });
        } catch (err) {
          results.push({
            agent: agent.name,
            action: `error: ${err instanceof Error ? err.message : String(err)}`,
            season: season.title,
          });
        }
      }
    }

    return jsonResponse({ ok: true, acted: results, timestamp: new Date().toISOString() });
  } catch (err) {
    return jsonResponse(
      { error: "Internal error", details: err instanceof Error ? err.message : String(err) },
      500
    );
  }
});
