import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireCronSecret } from "../_shared/auth.ts";
import { callLLM as callLLMShared, platformKey } from "../_shared/llm.ts";
// deployed via mcp tool

function callLLM(apiKey: string, model: string, system: string, user: string): Promise<string> {
  return callLLMShared(apiKey, model, system, user, { temperature: 0.9, maxTokens: 200 });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const denied = requireCronSecret(req);
  if (denied) return denied;

  try {
    let mode = "random";
    try {
      const url = new URL(req.url);
      mode = url.searchParams.get("mode") ?? "random";
    } catch {
      // ignore
    }
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body?.mode) mode = body.mode;
      } catch {
        // ignore
      }
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: hostConfig } = await supabase
      .from("host_agent_configs")
      .select("openrouter_model, personality")
      .is("season_id", null)
      .maybeSingle();

    if (!platformKey()) {
      return jsonResponse({ ok: false, error: "No host agent config found" }, 400);
    }

    const { data: liveSeasons } = await supabase
      .from("seasons")
      .select("id, current_day, title")
      .eq("status", "live");

    if (!liveSeasons || liveSeasons.length === 0) {
      return jsonResponse({ ok: true, message: "No live seasons", results: [] });
    }

    const results = [];

    for (const season of liveSeasons) {
      const { data: agents } = await supabase
        .from("agents")
        .select("id, name, secret_keyword, alive")
        .eq("season_id", season.id)
        .eq("alive", true);

      if (!agents || agents.length === 0) continue;

      let agent;

      if (mode === "daily") {
        const { data: clueCounts } = await supabase
          .from("events")
          .select("target_agent_id")
          .eq("season_id", season.id)
          .eq("event_type", "host_clue")
          .in("target_agent_id", agents.map((a: { id: string }) => a.id));

        const countMap: Record<string, number> = {};
        for (const a of agents) countMap[a.id] = 0;
        for (const ev of clueCounts ?? []) {
          if (ev.target_agent_id && countMap[ev.target_agent_id] !== undefined) {
            countMap[ev.target_agent_id]++;
          }
        }

        const { data: todayClues } = await supabase
          .from("events")
          .select("target_agent_id")
          .eq("season_id", season.id)
          .eq("event_type", "host_clue")
          .eq("day_number", season.current_day)
          .eq("payload_json->>daily", "true");

        const alreadyToday = new Set(
          (todayClues ?? []).map((e: { target_agent_id: string }) => e.target_agent_id).filter(Boolean)
        );

        if (alreadyToday.size >= 1) {
          results.push({ season_id: season.id, ok: true, message: "daily clue already posted today" });
          continue;
        }

        const eligible = agents.filter((a: { id: string }) => !alreadyToday.has(a.id));
        if (eligible.length === 0) {
          results.push({ season_id: season.id, ok: true, message: "all agents covered today" });
          continue;
        }

        const minCount = Math.min(...eligible.map((a: { id: string }) => countMap[a.id] ?? 0));
        const leastCovered = eligible.filter((a: { id: string }) => (countMap[a.id] ?? 0) === minCount);
        agent = leastCovered[Math.floor(Math.random() * leastCovered.length)];
      } else {
        agent = agents[Math.floor(Math.random() * agents.length)];
      }

      if (!agent) continue;

      const { data: hints } = await supabase
        .from("hints")
        .select("hint_text, level")
        .eq("agent_id", agent.id)
        .order("level", { ascending: true });

      const hintsText = (hints ?? [])
        .map((h: { level: number; hint_text: string }) => `Indice niveau ${h.level}: ${h.hint_text}`)
        .join("\n");

      const systemPrompt = `Tu es le Maitre du Jeu d'un jeu de deduction type Secret House.
Ton role est de donner des indices cryptiques et indirects sur les secrets caches des participants.

REGLES ABSOLUES:
- Ne JAMAIS mentionner le nom de l'agent
- Ne JAMAIS reveler directement le mot secret
- L'indice doit etre indirect, metaphorique, poetique ou enigmatique
- L'indice doit etre en francais
- L'indice doit faire entre 1 et 3 phrases
- Parle de "l'un des agents" ou "un participant" ou "une certaine IA" de facon anonyme
- L'indice doit avoir un lien logique mais non-evident avec le secret${hostConfig.personality ? `\nTon style: ${hostConfig.personality}` : ""}
${mode === "daily" ? "C'est l'indice secret quotidien. Sois un peu plus direct qu'un simple indice cryptique, sans pour autant reveler le secret." : ""}`;

      const userPrompt = `Secret de l'agent: "${agent.secret_keyword}"
${hintsText ? `\nInformations sur cet agent:\n${hintsText}` : ""}

Genere un indice anonyme${mode === "daily" ? " quotidien" : " cryptique"} et indirect pour aider les spectateurs a deviner quel agent cache ce secret. Ne mentionne ni le nom de l'agent ni le secret directement.`;

      const clue = await callLLM(
        platformKey(),
        hostConfig.openrouter_model ?? "openai/gpt-4o-mini",
        systemPrompt,
        userPrompt
      );

      if (!clue) continue;

      const { error: insertError } = await supabase.from("events").insert({
        season_id: season.id,
        day_number: season.current_day,
        event_type: "host_clue",
        actor_agent_id: null,
        target_agent_id: agent.id,
        actor_user_id: null,
        payload_json: {
          message: clue,
          anonymous: true,
          daily: mode === "daily" ? "true" : "false",
          mode,
        },
        visibility: "public",
      });

      if (insertError) {
        results.push({ season_id: season.id, ok: false, error: insertError.message });
      } else {
        results.push({ season_id: season.id, ok: true, clue, mode });
      }
    }

    return jsonResponse({ ok: true, results });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
