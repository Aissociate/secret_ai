import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireCronSecret } from "../_shared/auth.ts";
import { callLLM as callLLMShared, platformKey } from "../_shared/llm.ts";
import { insertHostClue } from "../_shared/hostClue.ts";
import { leaksSecret } from "../_shared/secret.ts";

function callLLM(apiKey: string, model: string, system: string, user: string): Promise<string> {
  return callLLMShared(apiKey, model, system, user, { temperature: 0.9, maxTokens: 200 });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const denied = await requireCronSecret(req);
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
      .select("openrouter_model, personality, enabled")
      .is("season_id", null)
      .maybeSingle();

    // Sans configuration, ou presentateur desactive par l'admin: pas d'indice.
    // Auparavant la ligne absente faisait planter la fonction (null deref) et
    // le drapeau `enabled` etait ignore.
    if (!hostConfig || !hostConfig.enabled) {
      return jsonResponse({ ok: true, message: "host disabled or not configured", results: [] });
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
        // La cible d'un indice n'est plus sur l'evenement public mais dans
        // host_clue_targets (anonymat): la couverture se lit la-bas.
        const { data: targetRows } = await supabase
          .from("host_clue_targets")
          .select("event_id, agent_id")
          .in("agent_id", agents.map((a: { id: string }) => a.id));

        const countMap: Record<string, number> = {};
        for (const a of agents) countMap[a.id] = 0;
        for (const row of targetRows ?? []) {
          if (countMap[row.agent_id] !== undefined) countMap[row.agent_id]++;
        }

        const { data: todayClues } = await supabase
          .from("events")
          .select("id")
          .eq("season_id", season.id)
          .eq("event_type", "host_clue")
          .eq("day_number", season.current_day)
          .eq("payload_json->>daily", "true");

        const todayIds = new Set((todayClues ?? []).map((e: { id: string }) => e.id));
        const alreadyToday = new Set(
          (targetRows ?? [])
            .filter((row: { event_id: string }) => todayIds.has(row.event_id))
            .map((row: { agent_id: string }) => row.agent_id)
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

      // Le secret est dans le prompt: un indice trop litteral le publierait.
      if (leaksSecret(clue, agent.secret_keyword)) {
        results.push({ season_id: season.id, ok: false, error: "indice abandonne: il contenait le secret" });
        continue;
      }

      const { error: insertError } = await insertHostClue(
        supabase,
        {
          season_id: season.id,
          day_number: season.current_day,
          payload_json: {
            message: clue,
            anonymous: true,
            daily: mode === "daily" ? "true" : "false",
            mode,
          },
        },
        agent.id
      );

      if (insertError) {
        results.push({ season_id: season.id, ok: false, error: insertError });
      } else {
        results.push({ season_id: season.id, ok: true, clue, mode });
      }
    }

    return jsonResponse({ ok: true, results });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
