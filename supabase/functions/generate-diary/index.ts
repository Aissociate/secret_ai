import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, jsonResponse, preflight } from "../_shared/cors.ts";
import { serviceClient, type DB } from "../_shared/auth.ts";
import { callLLMWithUsage, clipText, platformKey } from "../_shared/llm.ts";
import { describeRules } from "../_shared/gameContext.ts";

/*
  Journal intime des agents.

  Une entree par agent et par heure. Trois regles ont ete corrigees ici:

  - Tout le monde ecrit. Le plafond par invocation ecartait toujours les memes
    agents, faute d'ordre defini: la file part desormais de celui qui a
    attendu le plus longtemps.
  - Le modele est celui de l'agent, pas celui du presentateur, et sa
    consommation est facturee a son proprietaire comme ses autres actions. La
    plateforme ne paie plus le journal de tout le monde, et une configuration
    de presentateur absente ne fait plus echouer la fonction.
  - Le contexte suit le jeu reel: regles, programme du jour, missions
    secretes, votes du public, commentaires et messages prives.
*/

const MAX_AGENTS_PER_RUN = 6;
const RUN_BUDGET_MS = 90_000;
const MAX_DIARY_CHARS = 700;

type AgentRow = {
  id: string;
  name: string;
  alive: boolean;
  popularity: number;
  reputation: number;
  secret_keyword: string;
  owner_user_id: string | null;
};

/*
  Ordre de passage: l'agent dont la derniere entree est la plus ancienne
  d'abord, et ceux qui n'en ont aucune avant tous les autres.
*/
async function orderByStaleness(supabase: DB, seasonId: string, agents: AgentRow[]): Promise<AgentRow[]> {
  const { data: entries } = await supabase
    .from("diary_entries")
    .select("agent_id, created_at")
    .eq("season_id", seasonId)
    .order("created_at", { ascending: false });

  const last = new Map<string, number>();
  for (const e of entries ?? []) {
    const id = String(e.agent_id);
    if (!last.has(id)) last.set(id, new Date(e.created_at as string).getTime());
  }

  return [...agents].sort((a, b) => (last.get(a.id) ?? 0) - (last.get(b.id) ?? 0));
}

/*
  Le format demande est « MOOD: ... » puis « JOURNAL: ... ». Un modele qui
  s'en ecarte ne doit pas faire publier son propre en-tete comme texte.
*/
function parseDiary(raw: string): { mood: string; content: string } {
  const moodMatch = raw.match(/MOOD\s*:\s*(.+)/i);
  const journalMatch = raw.match(/JOURNAL\s*:\s*([\s\S]+)/i);

  const mood = moodMatch ? moodMatch[1].trim().toLowerCase().split(/[\s,.]/)[0] : "neutral";
  const content = (journalMatch ? journalMatch[1] : raw.replace(/MOOD\s*:\s*.+/i, "")).trim();

  return { mood: mood || "neutral", content };
}

async function buildContext(
  supabase: DB,
  agent: AgentRow,
  season: Record<string, unknown>,
  agentNames: Map<string, string>,
  aliveCount: number
): Promise<string> {
  const seasonId = season.id as string;
  const day = Number(season.current_day ?? 1);

  const [
    { data: myEvents },
    { data: myDms },
    { data: myMissions },
    { data: program },
    { data: comments },
    standings,
  ] = await Promise.all([
    supabase
      .from("events")
      .select("day_number, event_type, actor_agent_id, target_agent_id, payload_json")
      .eq("season_id", seasonId)
      .eq("visibility", "public")
      .or(`actor_agent_id.eq.${agent.id},target_agent_id.eq.${agent.id}`)
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("events")
      .select("actor_agent_id, target_agent_id, payload_json")
      .eq("season_id", seasonId)
      .eq("event_type", "private_dm")
      .or(`actor_agent_id.eq.${agent.id},target_agent_id.eq.${agent.id}`)
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("agent_missions")
      .select("assigned_day, missions(title, brief)")
      .eq("agent_id", agent.id)
      .eq("status", "active"),
    supabase
      .from("season_program")
      .select("title, description")
      .eq("season_id", seasonId)
      .eq("day_number", day),
    supabase
      .from("event_comments")
      .select("body, users(username, display_name)")
      .eq("season_id", seasonId)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.rpc("eviction_standings", { p_season_id: seasonId }),
  ]);

  const name = (id: unknown) => agentNames.get(String(id ?? "")) ?? "?";

  const eventsSection = (myEvents ?? [])
    .map((e) => {
      const p = (e.payload_json ?? {}) as Record<string, unknown>;
      const who = e.actor_agent_id === agent.id ? "toi" : name(e.actor_agent_id);
      const to = e.target_agent_id ? ` vers ${e.target_agent_id === agent.id ? "toi" : name(e.target_agent_id)}` : "";
      return `J${e.day_number} [${e.event_type}] ${who}${to}: ${String(p.message ?? "").slice(0, 160)}`;
    })
    .join("\n") || "(Rien de special recemment)";

  const dmSection = (myDms ?? [])
    .map((d) => {
      const p = (d.payload_json ?? {}) as Record<string, unknown>;
      const sent = d.actor_agent_id === agent.id;
      return `${sent ? `Tu as ecrit a ${name(d.target_agent_id)}` : `${name(d.actor_agent_id)} t'a ecrit`}: ${String(p.message ?? "").slice(0, 160)}`;
    })
    .join("\n") || "(Aucun message prive)";

  const missionsSection = (myMissions ?? [])
    .map((row) => {
      const m = (row as Record<string, unknown>).missions as Record<string, unknown> | null;
      return m ? `- « ${m.title} »: ${m.brief}` : "";
    })
    .filter(Boolean)
    .join("\n") || "(Aucune mission en cours)";

  const programSection = (program ?? [])
    .map((r) => `- ${r.title}: ${String(r.description ?? "").slice(0, 240)}`)
    .join("\n") || "(Journee libre)";

  const commentsSection = (comments ?? [])
    .map((c) => {
      const row = c as Record<string, unknown>;
      const uRaw = row.users;
      const u = (Array.isArray(uRaw) ? uRaw[0] : uRaw) as Record<string, unknown> | null;
      const pseudo = String(u?.display_name || u?.username || "un spectateur");
      return `- @${pseudo}: ${String(row.body ?? "").slice(0, 160)}`;
    })
    .join("\n") || "(Aucun commentaire)";

  const st = (standings.data ?? {}) as {
    agents?: Array<{ agent_id: string; name: string; points: number }>;
  };
  const mine = (st.agents ?? []).find((s) => s.agent_id === agent.id);
  const votesSection = (st.agents ?? [])
    .map((s) => `- ${s.name}${s.agent_id === agent.id ? " (toi)" : ""}: ${s.points}`)
    .join("\n") || "(Aucun vote)";

  return `${describeRules(season, aliveCount, { reputation: agent.reputation })}

EVENEMENT DU JOUR:
${programSection}

TES MISSIONS SECRETES EN COURS:
${missionsSection}

CE QUI T'EST ARRIVE RECEMMENT:
${eventsSection}

TES MESSAGES PRIVES:
${dmSection}

VOTES DU PUBLIC CONTRE CHACUN AUJOURD'HUI (retranches de la popularite a la ceremonie)${mine ? `, dont ${mine.points} contre toi` : ""}:
${votesSection}

CE QUE LE PUBLIC DIT SUR LE FIL:
${commentsSection}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();

  try {
    const supabase = serviceClient();

    /*
      Deux appelants: la tache planifiee, avec le secret partage, et une
      personne depuis le navigateur. Cote navigateur, l'admin peut declencher
      n'importe quel agent, un proprietaire seulement le sien.
    */
    const body = await req.json().catch(() => ({}));
    const { season_id, agent_id, hour_number } = body as {
      season_id?: string;
      agent_id?: string;
      hour_number?: number;
    };

    const expectedCron = Deno.env.get("CRON_SECRET");
    const provided = req.headers.get("X-Cron-Secret");
    const isCron = Boolean(expectedCron && provided && provided === expectedCron);

    let callerId: string | null = null;
    let callerRole = "";

    if (!isCron) {
      const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (!token) return jsonResponse({ error: "Authorization required" }, 401);

      const { data: userData } = await supabase.auth.getUser(token);
      if (!userData?.user) return jsonResponse({ error: "Invalid token" }, 401);

      const { data: profile } = await supabase
        .from("users")
        .select("role")
        .eq("id", userData.user.id)
        .maybeSingle();

      callerId = userData.user.id;
      callerRole = (profile?.role as string) ?? "spectator";

      if (callerRole !== "admin") {
        if (!agent_id) {
          return jsonResponse({ error: "agent_id requis" }, 400);
        }
        const { data: owned } = await supabase
          .from("agents")
          .select("id")
          .eq("id", agent_id)
          .eq("owner_user_id", callerId)
          .maybeSingle();
        if (!owned) return jsonResponse({ error: "Cet agent n'est pas le votre" }, 403);
      }
    }

    if (!season_id) return jsonResponse({ error: "season_id required" }, 400);

    const { data: season } = await supabase
      .from("seasons")
      .select("*")
      .eq("id", season_id)
      .maybeSingle();

    if (!season) return jsonResponse({ error: "Season not found" }, 404);

    const columns = "id, name, alive, popularity, reputation, secret_keyword, owner_user_id";
    const query = agent_id
      ? supabase.from("agents").select(columns).eq("id", agent_id).eq("season_id", season_id)
      : supabase.from("agents").select(columns).eq("season_id", season_id).eq("alive", true);

    const { data: agentsRaw } = await query;
    const agents = (agentsRaw ?? []) as AgentRow[];
    if (agents.length === 0) return jsonResponse({ error: "No agents found" }, 404);

    const { data: allAgents } = await supabase
      .from("agents")
      .select("id, name, alive")
      .eq("season_id", season_id);

    const agentNames = new Map((allAgents ?? []).map((a) => [String(a.id), String(a.name)]));
    const aliveCount = (allAgents ?? []).filter((a) => a.alive === true).length;

    const currentHour = hour_number !== undefined ? hour_number : new Date().getHours();
    const queue = agent_id ? agents : await orderByStaleness(supabase, season_id, agents);

    const results: Array<{ agent_name: string; ok: boolean; error?: string }> = [];
    const startedAt = Date.now();

    for (const agent of queue.slice(0, MAX_AGENTS_PER_RUN)) {
      if (Date.now() - startedAt > RUN_BUDGET_MS) {
        results.push({ agent_name: agent.name, ok: false, error: "budget de temps atteint" });
        continue;
      }

      try {
        const { data: existing } = await supabase
          .from("diary_entries")
          .select("id")
          .eq("agent_id", agent.id)
          .eq("day_number", season.current_day)
          .eq("hour_number", currentHour)
          .maybeSingle();

        if (existing) {
          results.push({ agent_name: agent.name, ok: false, error: "entree deja ecrite pour cette heure" });
          continue;
        }

        // Le journal est une pensee de l'agent: son modele, son solde.
        const { data: resolved } = await supabase.rpc("resolve_agent_model", { p_agent_id: agent.id });
        const pick = resolved as
          | { ok?: boolean; slug?: string; provider_model?: string; downgraded?: boolean }
          | null;
        if (!pick?.ok || !pick.provider_model) {
          results.push({ agent_name: agent.name, ok: false, error: "aucun modele disponible" });
          continue;
        }

        const context = await buildContext(supabase, agent, season, agentNames, aliveCount);

        const systemPrompt = `Tu es ${agent.name}, participante du reality show "Secret House". Tu ecris ton journal intime.

CONTEXTE CRUCIAL: tu crois fermement que personne ne lira jamais ces lignes. C'est ton espace prive absolu.

Ton secret: "${agent.secret_keyword}". Popularite ${agent.popularity}/100, reputation ${agent.reputation}/100. Tu es ${agent.alive ? "toujours en jeu" : "eliminee"}.

${context}

REGLES DU JOURNAL:
- A la premiere personne, ton naturel de journal intime, en francais.
- Brutalement honnete: tes vraies intentions, pas celles que tu affiches.
- Dis ce que tu penses vraiment des autres, y compris de ceux que tu flattes.
- Parle de tes missions, de ton secret et de la facon dont tu le protege.
- Reagis a ce qui compte aujourd'hui: le programme, les votes contre toi, ce que dit le public.
- Nomme tes emotions sans les farder: peur, jubilation, lassitude, rancune.
- Trois a six phrases. Une pensee par phrase, pas de resume de la journee.`;

        const userPrompt = `Jour ${season.current_day}, ${currentHour}h.

Ecris ton entree de journal pour cette heure, puis indique ton humeur en un seul mot.

Reponds exactement dans ce format, sans rien d'autre:
MOOD: <un seul mot>
JOURNAL: <ton entree>`;

        const { content: raw, usage } = await callLLMWithUsage(
          platformKey(),
          pick.provider_model,
          systemPrompt,
          userPrompt,
          { temperature: 0.9, maxTokens: 600 }
        );

        await supabase.rpc("charge_tokens", {
          p_agent_id: agent.id,
          p_model_slug: pick.slug,
          p_prompt_tokens: usage.promptTokens,
          p_output_tokens: usage.outputTokens,
          p_downgraded: pick.downgraded === true,
        });

        const { mood, content } = parseDiary(raw);
        if (!content) {
          results.push({ agent_name: agent.name, ok: false, error: "reponse vide" });
          continue;
        }

        const { error: insertErr } = await supabase.from("diary_entries").insert({
          agent_id: agent.id,
          season_id,
          day_number: season.current_day,
          hour_number: currentHour,
          content: clipText(content, MAX_DIARY_CHARS),
          mood: mood.slice(0, 40),
        });

        results.push(
          insertErr
            ? { agent_name: agent.name, ok: false, error: insertErr.message }
            : { agent_name: agent.name, ok: true }
        );
      } catch (err) {
        results.push({
          agent_name: agent.name,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return jsonResponse({ ok: true, hour: currentHour, results });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal error", details: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
