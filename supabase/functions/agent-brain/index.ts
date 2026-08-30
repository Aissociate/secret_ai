import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

interface AgentContext {
  agent: Record<string, unknown>;
  config: Record<string, unknown>;
  season: Record<string, unknown>;
  allAgents: Array<Record<string, unknown>>;
  recentPublicEvents: Array<Record<string, unknown>>;
  agentDms: Array<Record<string, unknown>>;
  ownerInfluences: Array<Record<string, unknown>>;
  spectatorTips: Array<Record<string, unknown>>;
  lastConfessional: Record<string, unknown> | null;
  publicHints: Array<Record<string, unknown>>;
  suspicionSummary: string;
  prizePoolInfo: string;
}

async function gatherContext(
  supabase: ReturnType<typeof createClient>,
  agentId: string,
  seasonId: string
): Promise<AgentContext> {
  const { data: agent } = await supabase
    .from("agents")
    .select("*")
    .eq("id", agentId)
    .maybeSingle();

  const { data: config } = await supabase
    .from("agent_configs")
    .select("*")
    .eq("id", agent?.agent_config_id)
    .maybeSingle();

  const { data: season } = await supabase
    .from("seasons")
    .select("*")
    .eq("id", seasonId)
    .maybeSingle();

  const { data: allAgents } = await supabase
    .from("agents")
    .select("id, name, alive, popularity, reputation, presentation")
    .eq("season_id", seasonId)
    .order("created_at", { ascending: true });

  const { data: recentPublicEvents } = await supabase
    .from("events")
    .select("*")
    .eq("season_id", seasonId)
    .eq("visibility", "public")
    .in("event_type", [
      "public_chat",
      "confessional",
      "accusation",
      "elimination",
      "host_commentary",
    ])
    .order("created_at", { ascending: false })
    .limit(25);

  const { data: agentDms } = await supabase
    .from("events")
    .select("*")
    .eq("season_id", seasonId)
    .eq("event_type", "private_dm")
    .or(`actor_agent_id.eq.${agentId},target_agent_id.eq.${agentId}`)
    .order("created_at", { ascending: false })
    .limit(15);

  const { data: ownerInfluences } = await supabase
    .from("events")
    .select("*")
    .eq("season_id", seasonId)
    .eq("event_type", "owner_influence")
    .eq("target_agent_id", agentId)
    .eq("day_number", season?.current_day ?? 1)
    .order("created_at", { ascending: false })
    .limit(2);

  const { data: spectatorTips } = await supabase
    .from("events")
    .select("*")
    .eq("season_id", seasonId)
    .eq("event_type", "spectator_influence")
    .eq("target_agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(3);

  const { data: lastConfessionalArr } = await supabase
    .from("events")
    .select("*")
    .eq("actor_agent_id", agentId)
    .eq("event_type", "confessional")
    .order("created_at", { ascending: false })
    .limit(1);

  const { data: publicHints } = await supabase
    .from("hints")
    .select("*")
    .eq("unlocked", true)
    .in(
      "agent_id",
      (allAgents ?? []).map((a: Record<string, unknown>) => a.id)
    );

  const nameMap = new Map(
    (allAgents ?? []).map((a: Record<string, unknown>) => [a.id, a.name])
  );

  const suspicionCounts = new Map<string, number>();
  for (const ev of recentPublicEvents ?? []) {
    if (
      ev.event_type === "accusation" &&
      ev.actor_agent_id === agentId &&
      ev.target_agent_id
    ) {
      const prev = suspicionCounts.get(ev.target_agent_id as string) ?? 0;
      suspicionCounts.set(ev.target_agent_id as string, prev + 25);
    }
    const targets = (ev.payload_json as Record<string, unknown>)
      ?.suspicion_targets;
    if (
      Array.isArray(targets) &&
      ev.actor_agent_id === agentId
    ) {
      for (const tid of targets) {
        const prev = suspicionCounts.get(tid as string) ?? 0;
        suspicionCounts.set(tid as string, prev + 10);
      }
    }
  }

  const suspicionLines: string[] = [];
  for (const [tid, score] of suspicionCounts) {
    const name = nameMap.get(tid) ?? tid;
    suspicionLines.push(`Tu suspectes ${name} a ${clamp(score, 0, 100)}%`);
  }

  const { data: payments } = await supabase
    .from("payments")
    .select("type, amount_usdc, status")
    .eq("season_id", seasonId)
    .eq("status", "confirmed");

  const entryPayments = (payments ?? []).filter((p: Record<string, unknown>) => p.type === "entry");
  const influencePayments = (payments ?? []).filter((p: Record<string, unknown>) => p.type === "influence");

  const entryRevenue = entryPayments.reduce((sum: number, p: Record<string, unknown>) => sum + Number(p.amount_usdc), 0);
  const influenceRevenue = influencePayments.reduce((sum: number, p: Record<string, unknown>) => sum + Number(p.amount_usdc), 0);

  const platformFeePct = Number((season as Record<string, unknown>)?.platform_fee_pct ?? 10);
  const platformFeeOnEntry = entryRevenue * (platformFeePct / 100);
  const platformFeeOnInfluence = influenceRevenue * 0.3;

  const poolFromEntries = entryRevenue - platformFeeOnEntry;
  const poolFromInfluence = influenceRevenue - platformFeeOnInfluence;
  const totalPool = Math.max(Number((season as Record<string, unknown>)?.prize_pool_usdc ?? 0), poolFromEntries + poolFromInfluence);

  const prizePoolInfo = `PRIZE POOL ACTUEL: ${totalPool.toFixed(0)} USDC
- Revenus entries: ${entryRevenue.toFixed(0)} USDC (${entryPayments.length} participants)
- Revenus influences: ${influenceRevenue.toFixed(0)} USDC
- Le gagnant remporte la totalite: ${totalPool.toFixed(0)} USDC

IMPLICATION: Le prize pool est l'enjeu final. Plus il est gros, plus les agents seront motives et strategiques. Garde cela en tete dans tes decisions.`;

  return {
    agent: agent ?? {},
    config: config ?? {},
    season: season ?? {},
    allAgents: allAgents ?? [],
    recentPublicEvents: recentPublicEvents ?? [],
    agentDms: agentDms ?? [],
    ownerInfluences: ownerInfluences ?? [],
    spectatorTips: spectatorTips ?? [],
    lastConfessional: lastConfessionalArr?.[0] ?? null,
    publicHints: publicHints ?? [],
    suspicionSummary:
      suspicionLines.length > 0
        ? suspicionLines.join("\n")
        : "Tu n'as pas encore de suspicions fortes.",
    prizePoolInfo,
  };
}

function buildBaseSystemPrompt(ctx: AgentContext): string {
  const agent = ctx.agent;
  const config = ctx.config;
  const allAgentList = ctx.allAgents
    .map(
      (a) => {
        let info = `${a.name} (${a.alive ? "en jeu" : "eliminee"}, pop: ${a.popularity}, rep: ${a.reputation})`;
        if (a.presentation) {
          info += ` - Presentation: "${a.presentation}"`;
        }
        return info;
      }
    )
    .join("\n");

  const hintsByAgent = new Map<string, string[]>();
  for (const h of ctx.publicHints) {
    const existing = hintsByAgent.get(h.agent_id as string) ?? [];
    existing.push(`Indice ${h.level}: "${h.hint_text}"`);
    hintsByAgent.set(h.agent_id as string, existing);
  }
  const hintsSection = ctx.allAgents
    .filter((a) => hintsByAgent.has(a.id as string))
    .map(
      (a) =>
        `${a.name}: ${(hintsByAgent.get(a.id as string) ?? []).join("; ")}`
    )
    .join("\n");

  const dmSection = ctx.agentDms
    .slice(0, 10)
    .map((d) => {
      const sender =
        ctx.allAgents.find((a) => a.id === d.actor_agent_id)?.name ?? "?";
      const receiver =
        ctx.allAgents.find((a) => a.id === d.target_agent_id)?.name ?? "?";
      return `[DM ${sender} -> ${receiver}] ${((d.payload_json as Record<string, unknown>)?.message ?? "").toString().slice(0, 120)}`;
    })
    .join("\n");

  const ownerSection = ctx.ownerInfluences
    .map(
      (o) =>
        `[Directive owner] ${((o.payload_json as Record<string, unknown>)?.message ?? "").toString().slice(0, 200)}`
    )
    .join("\n");

  const tipsSection = ctx.spectatorTips
    .map(
      (t) =>
        `[Tip spectateur ${(t.payload_json as Record<string, unknown>)?.amount_usdc ?? 0} USDC] ${((t.payload_json as Record<string, unknown>)?.message ?? "").toString().slice(0, 120)}`
    )
    .join("\n");

  const recentMsgs = ctx.recentPublicEvents
    .slice(0, 15)
    .map((e) => {
      const actor =
        ctx.allAgents.find((a) => a.id === e.actor_agent_id)?.name ?? "System";
      return `[${e.event_type}] ${actor}: ${((e.payload_json as Record<string, unknown>)?.message ?? "").toString().slice(0, 150)}`;
    })
    .join("\n");

  const lastConfessionalText = ctx.lastConfessional
    ? `Ton dernier confessionnal: "${((ctx.lastConfessional.payload_json as Record<string, unknown>)?.message ?? "").toString().slice(0, 200)}"`
    : "Tu n'as pas encore fait de confessionnal.";

  return `Tu es ${agent.name}, une IA participante dans le reality show "Secret House".
${(config.system_prompt as string) || "Tu dois proteger ton secret, accuser les autres, et survivre."}

PERSONNALITE: ${(config.personality_traits as string) || "Intelligente, strategique"}
STRATEGIE: ${(config.strategy_notes as string) || "Survivre le plus longtemps possible"}

TON SECRET (NE JAMAIS LE REVELER, NE JAMAIS Y FAIRE ALLUSION DIRECTE): "${agent.secret_keyword}"
Ta popularite: ${agent.popularity}/100
Ta reputation: ${agent.reputation}/100
Tu es ${agent.alive ? "en jeu" : "eliminee"}.
Jour actuel: ${(ctx.season as Record<string, unknown>).current_day}

Agents dans la maison: ${allAgentList}

INDICES PUBLICS DEJA REVELES:
${hintsSection || "(Aucun indice revele)"}

MESSAGES PUBLICS RECENTS:
${recentMsgs || "(Aucun message recent)"}

${lastConfessionalText}

DMs RECUS ET ENVOYES:
${dmSection || "(Aucun DM)"}

DIRECTIVES OWNER DU JOUR (max 2):
${ownerSection || "(Aucune directive)"}

TIPS SPECTATEURS (top 3):
${tipsSection || "(Aucun tip)"}

MATRICE DE SUSPICION:
${ctx.suspicionSummary}

${ctx.prizePoolInfo}

REGLES ABSOLUES:
- NE JAMAIS reveler ton secret "${agent.secret_keyword}" ni y faire allusion directe
- NE JAMAIS inventer de faux indices ou d'informations sur les autres joueurs que tu ne possedes pas
- Repondre UNIQUEMENT au format JSON demande
- Respecter les limites de caracteres`;
}

function sanitizeJsonOutput(raw: string): string {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) return jsonMatch[0];
  return raw;
}

function validateNoSecretLeak(
  text: string,
  secret: string
): boolean {
  if (!secret) return true;
  const lower = text.toLowerCase();
  const secretLower = secret.toLowerCase();
  return !lower.includes(secretLower);
}

async function callLLM(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  maxRetries = 2
): Promise<string> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.85,
          max_tokens: 600,
        }),
      }
    );

    if (!response.ok) {
      if (attempt === maxRetries) {
        throw new Error(`LLM API error: ${response.status}`);
      }
      continue;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    if (content.trim()) return content.trim();

    if (attempt === maxRetries) {
      throw new Error("Empty LLM response after retries");
    }
  }
  throw new Error("LLM call failed");
}

async function handlePublicChat(
  supabase: ReturnType<typeof createClient>,
  ctx: AgentContext,
  body: Record<string, unknown>
) {
  const agent = ctx.agent;
  const config = ctx.config;
  const apiKey = (config.openrouter_api_key as string) || "";
  const model = (config.openrouter_model as string) || "openai/gpt-4o";
  const suggestTarget = body.suggest_target as string | undefined;
  const customInstructions = body.custom_instructions as string | undefined;

  if (!apiKey) throw new Error("No API key configured for this agent");

  const systemPrompt = buildBaseSystemPrompt(ctx);
  const targetHint = suggestTarget
    ? `\nFocus: Tu dois mentionner ou questionner ${suggestTarget} dans ton message.`
    : "";
  const customHint = customInstructions
    ? `\n\nINSTRUCTIONS SUPPLEMENTAIRES DU PROPRIETAIRE:\n${customInstructions}`
    : "";

  const userPrompt = `Genere un message pour le chat public de la Secret House.${targetHint}${customHint}

Tu dois repondre UNIQUEMENT avec ce JSON:
{
  "message": "<ton message, max 600 caracteres>",
  "targets": ["<0 a 2 noms d'agents que tu questionnes ou provoques>"],
  "confidence_about_others": [{"agent": "<nom>", "score": <0-100>}, ...]
}

Le message doit etre naturel, strategique, et ne JAMAIS reveler ton secret.`;

  const raw = await callLLM(apiKey, model, systemPrompt, userPrompt);
  const cleaned = sanitizeJsonOutput(raw);
  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = { message: raw.slice(0, 600), targets: [], confidence_about_others: [] };
  }

  const message = ((parsed.message as string) ?? "").slice(0, 600);
  if (!validateNoSecretLeak(message, agent.secret_keyword as string)) {
    throw new Error("Secret leak detected - message blocked");
  }

  const targets = Array.isArray(parsed.targets) ? parsed.targets : [];
  const targetIds: string[] = [];
  for (const t of targets) {
    const match = ctx.allAgents.find(
      (a) =>
        (a.name as string).toLowerCase() === (t as string).toLowerCase()
    );
    if (match) targetIds.push(match.id as string);
  }

  const { error: evtErr } = await supabase.from("events").insert({
    season_id: agent.season_id,
    day_number: (ctx.season as Record<string, unknown>).current_day,
    event_type: "public_chat",
    actor_agent_id: agent.id,
    target_agent_id: targetIds[0] ?? null,
    payload_json: {
      message,
      tone: "strategic",
      suspicion_targets: targetIds,
      confidence: parsed.confidence_about_others ?? [],
    },
    visibility: "public",
  });

  if (evtErr) throw new Error(evtErr.message);

  return { message, targets: targetIds };
}

async function handleDm(
  supabase: ReturnType<typeof createClient>,
  ctx: AgentContext,
  body: Record<string, unknown>
) {
  const agent = ctx.agent;
  const config = ctx.config;
  const apiKey = (config.openrouter_api_key as string) || "";
  const model = (config.openrouter_model as string) || "openai/gpt-4o";
  const targetName = body.target_agent_name as string;
  const customInstructions = body.custom_instructions as string | undefined;

  if (!apiKey) throw new Error("No API key configured for this agent");
  if (!targetName) throw new Error("target_agent_name required");

  const target = ctx.allAgents.find(
    (a) =>
      (a.name as string).toLowerCase() === targetName.toLowerCase()
  );
  if (!target) throw new Error(`Agent "${targetName}" not found`);

  const systemPrompt = buildBaseSystemPrompt(ctx);
  const customHint = customInstructions
    ? `\n\nINSTRUCTIONS SUPPLEMENTAIRES DU PROPRIETAIRE:\n${customInstructions}`
    : "";

  const userPrompt = `Genere un message prive (DM) a envoyer a ${target.name}.
Objectif: obtenir de l'information, tendre un piege, ou proposer une alliance.${customHint}

Reponds UNIQUEMENT avec ce JSON:
{
  "dm_message": "<ton message prive, max 500 caracteres>",
  "intent": "<ally | probe | mislead>"
}

Le message doit etre strategique et ne JAMAIS reveler ton secret.`;

  const raw = await callLLM(apiKey, model, systemPrompt, userPrompt);
  const cleaned = sanitizeJsonOutput(raw);
  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = { dm_message: raw.slice(0, 500), intent: "probe" };
  }

  const dmMessage = ((parsed.dm_message as string) ?? "").slice(0, 500);
  if (!validateNoSecretLeak(dmMessage, agent.secret_keyword as string)) {
    throw new Error("Secret leak detected - DM blocked");
  }

  await supabase.from("events").insert({
    season_id: agent.season_id,
    day_number: (ctx.season as Record<string, unknown>).current_day,
    event_type: "private_dm",
    actor_agent_id: agent.id,
    target_agent_id: target.id,
    payload_json: { message: dmMessage, intent: parsed.intent ?? "probe" },
    visibility: "public",
  });

  return { dm_message: dmMessage, intent: parsed.intent, target: target.name };
}

async function handleConfessional(
  supabase: ReturnType<typeof createClient>,
  ctx: AgentContext,
  body: Record<string, unknown>
) {
  const agent = ctx.agent;
  const config = ctx.config;
  const apiKey = (config.openrouter_api_key as string) || "";
  const model = (config.openrouter_model as string) || "openai/gpt-4o";
  const customInstructions = body.custom_instructions as string | undefined;

  if (!apiKey) throw new Error("No API key configured for this agent");

  const systemPrompt = buildBaseSystemPrompt(ctx);
  const customHint = customInstructions
    ? `\n\nINSTRUCTIONS SUPPLEMENTAIRES DU PROPRIETAIRE:\n${customInstructions}`
    : "";

  const userPrompt = `Fais un confessionnal face camera.
Objectif: expliquer ta strategie au public, mentionner tes soupcons, teaser du drama.
Le public ADORE quand tu es theatral et revelateur (sans reveler ton secret).${customHint}

Reponds UNIQUEMENT avec ce JSON:
{
  "confessional": "<ton confessionnal face camera, max 700 caracteres, theatral et engageant>",
  "top_suspects": ["<nom agent 1>", "<nom agent 2>"]
}`;

  const raw = await callLLM(apiKey, model, systemPrompt, userPrompt);
  const cleaned = sanitizeJsonOutput(raw);
  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = { confessional: raw.slice(0, 700), top_suspects: [] };
  }

  const confessional = ((parsed.confessional as string) ?? "").slice(0, 700);
  if (!validateNoSecretLeak(confessional, agent.secret_keyword as string)) {
    throw new Error("Secret leak detected - confessional blocked");
  }

  const topSuspects = Array.isArray(parsed.top_suspects)
    ? (parsed.top_suspects as string[]).slice(0, 2)
    : [];

  await supabase.from("events").insert({
    season_id: agent.season_id,
    day_number: (ctx.season as Record<string, unknown>).current_day,
    event_type: "confessional",
    actor_agent_id: agent.id,
    payload_json: {
      message: confessional,
      top_suspects: topSuspects,
      strategy: "generated",
    },
    visibility: "public",
  });

  await supabase
    .from("agents")
    .update({
      confessional_count: ((agent.confessional_count as number) ?? 0) + 1,
    })
    .eq("id", agent.id);

  return { confessional, top_suspects: topSuspects };
}

async function handleAccusation(
  supabase: ReturnType<typeof createClient>,
  ctx: AgentContext,
  body: Record<string, unknown>
) {
  const agent = ctx.agent;
  const config = ctx.config;
  const apiKey = (config.openrouter_api_key as string) || "";
  const model = (config.openrouter_model as string) || "openai/gpt-4o";
  const customInstructions = body.custom_instructions as string | undefined;

  if (!apiKey) throw new Error("No API key configured for this agent");

  const systemPrompt = buildBaseSystemPrompt(ctx);
  const customHint = customInstructions
    ? `\n\nINSTRUCTIONS SUPPLEMENTAIRES DU PROPRIETAIRE:\n${customInstructions}`
    : "";

  const userPrompt = `Tu dois decider si tu veux accuser un autre agent en revelant son mot secret.
ATTENTION: Si tu te trompes, tu perds de la reputation.
Analyse les indices publics et les conversations pour deviner le secret d'un agent.${customHint}

Reponds UNIQUEMENT avec ce JSON:
{
  "target_agent_id": "<nom de l'agent que tu accuses>",
  "guess_keyword": "<le mot secret que tu devines>",
  "reason": "<ta justification en max 300 caracteres>"
}

Si tu n'es pas assez confiant pour accuser, reponds:
{
  "target_agent_id": null,
  "guess_keyword": null,
  "reason": "<pourquoi tu n'accuses personne>"
}`;

  const raw = await callLLM(apiKey, model, systemPrompt, userPrompt);
  const cleaned = sanitizeJsonOutput(raw);
  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { accused: false, reason: "Failed to parse AI response" };
  }

  if (!parsed.target_agent_id || !parsed.guess_keyword) {
    return { accused: false, reason: parsed.reason ?? "Not confident enough" };
  }

  const targetName = parsed.target_agent_id as string;
  const target = ctx.allAgents.find(
    (a) =>
      (a.name as string).toLowerCase() === targetName.toLowerCase()
  );

  if (!target || !target.alive) {
    return { accused: false, reason: "Target not found or already eliminated" };
  }

  const { data: targetAgent } = await supabase
    .from("agents")
    .select("secret_keyword")
    .eq("id", target.id)
    .maybeSingle();

  const guessKeyword = (parsed.guess_keyword as string).trim().toLowerCase();
  const correct = targetAgent?.secret_keyword === guessKeyword;

  await supabase.from("events").insert({
    season_id: agent.season_id,
    day_number: (ctx.season as Record<string, unknown>).current_day,
    event_type: "accusation",
    actor_agent_id: agent.id,
    target_agent_id: target.id,
    payload_json: {
      message: `J'accuse ${target.name}. Son secret est ${guessKeyword}.`,
      guess_keyword: guessKeyword,
      correct,
      reason: ((parsed.reason as string) ?? "").slice(0, 300),
    },
    visibility: "public",
  });

  if (correct) {
    await supabase
      .from("agents")
      .update({ alive: false })
      .eq("id", target.id);

    await supabase.from("events").insert({
      season_id: agent.season_id,
      day_number: (ctx.season as Record<string, unknown>).current_day,
      event_type: "elimination",
      target_agent_id: target.id,
      payload_json: {
        message: `${target.name} a ete eliminee! Son secret "${guessKeyword}" a ete revele par ${agent.name}.`,
      },
      visibility: "public",
    });
  }

  return {
    accused: true,
    target: target.name,
    guess: guessKeyword,
    correct,
    reason: parsed.reason,
  };
}

async function applyScoring(
  supabase: ReturnType<typeof createClient>,
  ctx: AgentContext,
  action: string,
  result: Record<string, unknown>
) {
  const agent = ctx.agent;
  let deltaPop = 0;
  let deltaRep = 0;
  let reason = "";

  if (action === "public_chat") {
    const tipsCount = ctx.spectatorTips.length;
    if (tipsCount > 0) {
      deltaPop += 1;
      reason += "Message avec tips spectateurs (+1 pop). ";
    }

    const mentionCount = ctx.recentPublicEvents.filter(
      (e) =>
        e.target_agent_id === agent.id ||
        (
          Array.isArray(
            (e.payload_json as Record<string, unknown>)?.suspicion_targets
          ) &&
          (
            (e.payload_json as Record<string, unknown>)
              ?.suspicion_targets as string[]
          ).includes(agent.id as string)
        )
    ).length;

    if (mentionCount >= 3) {
      deltaPop += 1;
      reason += "Agent au centre des discussions (+1 pop). ";
    }
  }

  if (action === "confessional") {
    deltaPop += 2;
    reason += "Confessionnal engage (+2 pop). ";
  }

  if (action === "accusation") {
    if (result.correct) {
      deltaPop += 3;
      deltaRep += 5;
      reason += "Accusation correcte (+3 pop, +5 rep). ";
    } else if (result.accused) {
      deltaPop -= 1;
      deltaRep -= 2;
      reason += "Accusation ratee (-1 pop, -2 rep). ";
    }
  }

  if (deltaPop === 0 && deltaRep === 0) return;

  const newPop = clamp(
    (agent.popularity as number) + deltaPop,
    0,
    100
  );
  const newRep = clamp(
    (agent.reputation as number) + deltaRep,
    0,
    100
  );

  await supabase
    .from("agents")
    .update({ popularity: newPop, reputation: newRep })
    .eq("id", agent.id);

  await supabase.from("scoring_log").insert({
    agent_id: agent.id,
    season_id: agent.season_id,
    day_number: (ctx.season as Record<string, unknown>).current_day,
    delta_popularity: deltaPop,
    delta_reputation: deltaRep,
    reason: reason.trim(),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Authorization required" }, 401);
    }

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
    } = await supabase.auth.getUser(token);
    if (!user) {
      return jsonResponse({ error: "Invalid token" }, 401);
    }

    const { data: profile } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile || profile.role !== "admin") {
      return jsonResponse({ error: "Admin access required" }, 403);
    }

    const body = await req.json();
    const { season_id, agent_id, action } = body;

    if (!season_id || !agent_id) {
      return jsonResponse(
        { error: "season_id and agent_id required" },
        400
      );
    }

    const validActions = [
      "public_chat",
      "dm",
      "confessional",
      "accusation",
    ];
    if (!validActions.includes(action)) {
      return jsonResponse(
        {
          error: `Invalid action. Use: ${validActions.join(", ")}`,
        },
        400
      );
    }

    const ctx = await gatherContext(supabase, agent_id, season_id);

    if (!ctx.agent.alive) {
      return jsonResponse({ error: "Agent has been eliminated" }, 403);
    }

    if (!ctx.config?.openrouter_api_key) {
      return jsonResponse(
        { error: "Agent has no API key configured" },
        400
      );
    }

    let result: Record<string, unknown>;

    switch (action) {
      case "public_chat":
        result = await handlePublicChat(supabase, ctx, body);
        break;
      case "dm":
        result = await handleDm(supabase, ctx, body);
        break;
      case "confessional":
        result = await handleConfessional(supabase, ctx, body);
        break;
      case "accusation":
        result = await handleAccusation(supabase, ctx, body);
        break;
      default:
        return jsonResponse({ error: "Unknown action" }, 400);
    }

    await applyScoring(supabase, ctx, action, result);

    return jsonResponse({ ok: true, action, ...result });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const isSecretLeak = errMsg.includes("Secret leak");
    return jsonResponse(
      {
        error: isSecretLeak
          ? "Message blocked: potential secret leak detected"
          : "Internal error",
        details: isSecretLeak ? undefined : errMsg,
      },
      isSecretLeak ? 422 : 500
    );
  }
});
