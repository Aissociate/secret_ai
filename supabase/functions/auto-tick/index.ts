import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type DB = ReturnType<typeof createClient>;

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

function leaksSecret(text: string, secret: string): boolean {
  return secret ? text.toLowerCase().includes(secret.toLowerCase()) : false;
}

async function callLLM(
  apiKey: string,
  model: string,
  system: string,
  user: string
): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
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
  if (!res.ok) throw new Error(`LLM error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() ?? "";
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
}

interface AgentConfig {
  openrouter_api_key: string;
  openrouter_model: string;
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

  const agentList = allAgents
    .map((a) => `${a.name} (${a.alive ? "en jeu" : "eliminee"}, pop:${a.popularity}, rep:${a.reputation})`)
    .join("\n");

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
    .map((e) => {
      const actor = nameMap.get(e.actor_agent_id as string) ?? "System";
      const msg = ((e.payload_json as Record<string, unknown>)?.message ?? "") as string;
      return `[${e.event_type}] ${actor}: ${msg}`;
    })
    .join("\n") || "(Aucun message)";

  const dmSection = (agentDms ?? [])
    .map((d) => {
      const sender = nameMap.get(d.actor_agent_id) ?? "?";
      const receiver = nameMap.get(d.target_agent_id) ?? "?";
      const msg = ((d.payload_json as Record<string, unknown>)?.message ?? "") as string;
      return `[DM ${sender} -> ${receiver}] ${msg}`;
    })
    .join("\n") || "(Aucun DM)";

  const ownerSection = (ownerInfluences ?? [])
    .map((o) => `[Directive owner] ${((o.payload_json as Record<string, unknown>)?.message ?? "").toString().slice(0, 200)}`)
    .join("\n") || "(Aucune directive)";

  const tipsSection = (spectatorTips ?? [])
    .map((t) => `[Tip ${(t.payload_json as Record<string, unknown>)?.amount_usdc ?? 0} USDC] ${((t.payload_json as Record<string, unknown>)?.message ?? "").toString().slice(0, 120)}`)
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

  return `AGENTS DANS LA MAISON:
${agentList}

INDICES PUBLICS DEJA REVELES:
${hintsSection}

MESSAGES PUBLICS RECENTS:
${recentMsgs}

${lastConfessionalText}

DMS RECUS ET ENVOYES:
${dmSection}

DIRECTIVES OWNER DU JOUR (max 2):
${ownerSection}

TIPS SPECTATEURS (top 3):
${tipsSection}

MATRICE DE SUSPICION:
${suspicionSummary}

PRIZE POOL ACTUEL: ${totalPool.toFixed(0)} USDC - Le gagnant remporte tout.`;
}

async function runAgentTick(
  supabase: DB,
  agent: AgentFull,
  config: AgentConfig,
  season: Record<string, unknown>,
  allAgents: AgentFull[],
  recentPublicEvents: Record<string, unknown>[],
  todayCounts: Record<string, number>
): Promise<string> {
  const apiKey = config.openrouter_api_key;
  const model = config.openrouter_model || "openai/gpt-4o-mini";

  if (!apiKey) return "no_api_key";

  const aliveOthers = allAgents.filter((a) => a.id !== agent.id && a.alive);

  const chatCount = todayCounts.public_chat ?? 0;
  const dmCount = todayCounts.private_dm ?? 0;
  const confCount = todayCounts.confessional ?? 0;
  const accuseCount = todayCounts.accusation ?? 0;

  const canChat = chatCount < 20;
  const canDm = dmCount < 5 && aliveOthers.length > 0;
  const canConfess = confCount < 1;
  const canAccuse = accuseCount < 1 && aliveOthers.length > 0;

  if (!canChat && !canDm && !canConfess) return "daily_limit_reached";

  const rand = Math.random();
  let action: "public_chat" | "confessional" | "dm" | "accusation";

  if (canAccuse && rand < 0.10) {
    action = "accusation";
  } else if (canChat && rand < 0.55) {
    action = "public_chat";
  } else if (canConfess && rand < 0.75) {
    action = "confessional";
  } else if (canDm) {
    action = "dm";
  } else if (canChat) {
    action = "public_chat";
  } else if (canConfess) {
    action = "confessional";
  } else {
    return "daily_limit_reached";
  }

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
TON SECRET (NE JAMAIS REVELER, NE JAMAIS Y FAIRE ALLUSION): "${agent.secret_keyword}"
Ta popularite: ${agent.popularity}/100 | reputation: ${agent.reputation}/100
Tu es ${agent.alive ? "en jeu" : "eliminee"}.
Jour actuel: ${season.current_day}
Chats aujourd'hui: ${chatCount}/20 | DMs: ${dmCount}/5 | Confessionnaux: ${confCount}/1 | Accusations: ${accuseCount}/1

${contextSection}

REGLES ABSOLUES:
- NE JAMAIS reveler ton secret "${agent.secret_keyword}" ni y faire allusion
- NE JAMAIS inventer de faux indices sur les autres joueurs
- Repondre UNIQUEMENT au format JSON demande`;

  const dayNumber = (season.current_day as number) ?? 1;
  const seasonId = agent.season_id;

  if (action === "public_chat") {
    const userPrompt = `Genere un message pour le chat public. Sois strategique, naturel, engage.
Reponds UNIQUEMENT avec ce JSON:
{"message": "<max 500 chars>", "targets": ["<0-2 noms>"], "tone": "<friendly|neutral|suspicious|provocative>"}`;

    const raw = await callLLM(apiKey, model, systemPrompt, userPrompt);
    const parsed = tryParseJson(raw);
    const message = (parsed.message as string ?? raw).slice(0, 500);
    if (leaksSecret(message, agent.secret_keyword)) return "secret_leak";

    const targets = Array.isArray(parsed.targets) ? (parsed.targets as string[]) : [];
    const targetIds = targets
      .map((t) => allAgents.find((a) => a.name.toLowerCase() === t.toLowerCase())?.id)
      .filter(Boolean) as string[];

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
        auto: true,
      },
      visibility: "public",
    });

    await supabase.from("agents")
      .update({ popularity: clamp(agent.popularity + 1, 0, 100) })
      .eq("id", agent.id);

  } else if (action === "confessional") {
    const userPrompt = `Fais un confessionnal face camera. Theatral, revelateur (sans reveler ton secret).
Le public adore quand tu es dramatique et strategique.
Reponds UNIQUEMENT avec ce JSON:
{"confessional": "<max 600 chars>", "top_suspects": ["<nom1>", "<nom2>"]}`;

    const raw = await callLLM(apiKey, model, systemPrompt, userPrompt);
    const parsed = tryParseJson(raw);
    const confessional = (parsed.confessional as string ?? raw).slice(0, 600);
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

  } else if (action === "accusation") {
    const target = aliveOthers[Math.floor(Math.random() * aliveOthers.length)];
    const userPrompt = `Tu veux accuser publiquement un autre agent d'etre suspect. Choisis ta cible et justifie ton accusation de facon strategique sans mentionner ton propre secret.
Cible suggeree: ${target.name}
Reponds UNIQUEMENT avec ce JSON:
{"message": "<accusation publique max 400 chars>", "accused": "<nom de l'agent>", "reason": "<raison courte>"}`;

    const raw = await callLLM(apiKey, model, systemPrompt, userPrompt);
    const parsed = tryParseJson(raw);
    const message = (parsed.message as string ?? raw).slice(0, 400);
    if (leaksSecret(message, agent.secret_keyword)) return "secret_leak";

    const accusedName = (parsed.accused as string) ?? target.name;
    const accusedAgent = allAgents.find((a) => a.name.toLowerCase() === accusedName.toLowerCase()) ?? target;

    await supabase.from("events").insert({
      season_id: seasonId,
      day_number: dayNumber,
      event_type: "accusation",
      actor_agent_id: agent.id,
      target_agent_id: accusedAgent.id,
      payload_json: {
        message,
        accused_name: accusedAgent.name,
        reason: (parsed.reason as string) ?? "",
        auto: true,
      },
      visibility: "public",
    });

    await supabase.from("agents")
      .update({ reputation: clamp(agent.reputation - 2, 0, 100) })
      .eq("id", agent.id);

  } else {
    const target = aliveOthers[Math.floor(Math.random() * aliveOthers.length)];
    const userPrompt = `Envoie un message prive a ${target.name}. Objectif: alliance, info ou piege.
Reponds UNIQUEMENT avec ce JSON:
{"dm_message": "<max 400 chars>", "intent": "<ally|probe|mislead>"}`;

    const raw = await callLLM(apiKey, model, systemPrompt, userPrompt);
    const parsed = tryParseJson(raw);
    const dmMessage = (parsed.dm_message as string ?? raw).slice(0, 400);
    if (leaksSecret(dmMessage, agent.secret_keyword)) return "secret_leak";

    await supabase.from("events").insert({
      season_id: seasonId,
      day_number: dayNumber,
      event_type: "private_dm",
      actor_agent_id: agent.id,
      target_agent_id: target.id,
      payload_json: { message: dmMessage, intent: (parsed.intent as string) ?? "probe", auto: true },
      visibility: "public",
    });
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
    .select("openrouter_api_key, openrouter_model, personality, name")
    .is("season_id", null)
    .maybeSingle();

  if (!hostConfig?.openrouter_api_key) return false;

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

  const openingRaw = await callLLM(
    hostConfig.openrouter_api_key,
    hostConfig.openrouter_model ?? "openai/gpt-4o-mini",
    `Tu es le Maitre du Jeu de "Secret House". ${hostStyle}`,
    `Redige UNIQUEMENT un message d'ouverture theatral et dramatique pour lancer la saison "${season.title}" avec ${aliveAgents.length} agents. 2-3 phrases maximum. Pas d'indice, juste l'annonce du debut.`
  );

  const clueRaw = await callLLM(
    hostConfig.openrouter_api_key,
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

  if (!openingRaw.trim()) return false;

  await supabase.from("events").insert({
    season_id: season.id,
    day_number: season.current_day ?? 1,
    event_type: "host_commentary",
    payload_json: {
      message: openingRaw.trim().slice(0, 500),
      action: "opening",
      host_name: hostConfig.name,
      auto: true,
      opening: true,
    },
    visibility: "public",
  });

  if (clueRaw.trim()) {
    await supabase.from("events").insert({
      season_id: season.id,
      day_number: season.current_day ?? 1,
      event_type: "host_clue",
      actor_agent_id: null,
      target_agent_id: target.id,
      actor_user_id: null,
      payload_json: {
        message: clueRaw.trim().slice(0, 300),
        anonymous: true,
        daily: "false",
        mode: "opening",
        auto: true,
      },
      visibility: "public",
    });
  }

  return true;
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

  if (!hostConfig || !hostConfig.enabled || !hostConfig.openrouter_api_key) return null;

  const { data: lastHostEvent } = await supabase
    .from("events")
    .select("created_at")
    .eq("season_id", season.id)
    .eq("event_type", "host_commentary")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const eventsSinceLastHost = lastHostEvent
    ? recentEvents.filter(
        (e) =>
          e.event_type !== "host_commentary" &&
          new Date(e.created_at as string) > new Date(lastHostEvent.created_at)
      ).length
    : recentEvents.length;

  if (eventsSinceLastHost < 5) return "host_skipped";

  const agentList = allAgents
    .map((a) => `${a.name} (${a.alive ? "en jeu" : "eliminee"}, pop:${a.popularity})`)
    .join(", ");

  const recentSummary = recentEvents
    .filter((e) => e.event_type !== "host_commentary")
    .map((e) => {
      const msg = ((e.payload_json as Record<string, unknown>)?.message ?? "") as string;
      return `[${e.event_type}] ${msg}`;
    })
    .join("\n");

  const actions = ["commentary", "provoke"];
  const action = actions[Math.floor(Math.random() * actions.length)];
  const randomAgent = allAgents.filter((a) => a.alive)[Math.floor(Math.random() * allAgents.filter((a) => a.alive).length)];

  let userPrompt = "";
  if (action === "provoke" && randomAgent) {
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
Tu commentes les evenements, tu provoques les agents, tu resumes les journees. Style grand presentateur TV francais. Sois concis et percutant.`;

  const raw = await callLLM(
    hostConfig.openrouter_api_key,
    hostConfig.openrouter_model,
    systemPrompt,
    userPrompt
  );

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

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: liveSeasons } = await supabase
      .from("seasons")
      .select("id, current_day, title, prize_pool_usdc, platform_fee_pct, status")
      .eq("status", "live");

    if (!liveSeasons || liveSeasons.length === 0) {
      return jsonResponse({ ok: true, message: "No live seasons", acted: [] });
    }

    const results: Array<{ agent: string; action: string; season: string }> = [];
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    for (const season of liveSeasons) {
      const { data: recentActors } = await supabase
        .from("events")
        .select("actor_agent_id")
        .eq("season_id", season.id)
        .gte("created_at", fiveMinAgo);

      const recentActorIds = new Set(
        (recentActors ?? []).map((e: { actor_agent_id: string }) => e.actor_agent_id).filter(Boolean)
      );

      const { data: agentsWithConfigs } = await supabase
        .from("agents")
        .select(`
          id, name, alive, popularity, reputation,
          confessional_count, secret_keyword, season_id, agent_config_id,
          agent_configs!inner(
            openrouter_api_key, openrouter_model, system_prompt,
            personality_traits, strategy_notes
          )
        `)
        .eq("season_id", season.id)
        .eq("alive", true);

      const { data: allAgentsRaw } = await supabase
        .from("agents")
        .select("id, name, alive, popularity, reputation, confessional_count, secret_keyword, season_id, agent_config_id")
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
        .select("event_type, actor_agent_id, target_agent_id, payload_json, created_at")
        .eq("season_id", season.id)
        .eq("visibility", "public")
        .order("created_at", { ascending: false });

      const recentEventsArr = (recentEvents ?? []) as Record<string, unknown>[];

      const openingDone = await runOpeningClue(supabase, season, allAgents);
      if (openingDone) {
        results.push({ agent: "host", action: "opening_clue", season: season.title });
      }

      const hostResult = await runHostTick(supabase, season, allAgents, recentEventsArr);
      if (hostResult && hostResult !== "host_skipped") {
        results.push({ agent: "host", action: hostResult, season: season.title });
      }

      if (!agentsWithConfigs || agentsWithConfigs.length === 0) continue;

      const eligibleAgents = agentsWithConfigs.filter(
        (a: { id: string }) => !recentActorIds.has(a.id)
      );

      const shuffled = [...eligibleAgents].sort(() => Math.random() - 0.5);
      const batch = shuffled.slice(0, 3);

      for (const agentRow of batch) {
        const config = (agentRow as Record<string, unknown>).agent_configs as AgentConfig;
        const agent = agentRow as unknown as AgentFull;
        const todayCounts = dailyCountsMap[agent.id] ?? {};
        try {
          const action = await runAgentTick(
            supabase,
            agent,
            config,
            season,
            allAgents,
            recentEventsArr,
            todayCounts
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
