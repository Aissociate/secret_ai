import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireCronSecret } from "../_shared/auth.ts";
import { leaksSecret } from "../_shared/secret.ts";
import { callLLM } from "../_shared/llm.ts";

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function tryParseJson(raw: string): Record<string, unknown> {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    return JSON.parse(m ? m[0] : raw);
  } catch {
    return {};
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const denied = requireCronSecret(req);
  if (denied) return denied;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: liveSeasons } = await supabase
      .from("seasons")
      .select("id, current_day, title, prize_pool_usdc, platform_fee_pct")
      .eq("status", "live");

    if (!liveSeasons || liveSeasons.length === 0) {
      return jsonResponse({ ok: true, message: "No live seasons", results: [] });
    }

    const results = [];

    for (const season of liveSeasons) {
      const { data: todayConfessionals } = await supabase
        .from("events")
        .select("actor_agent_id")
        .eq("season_id", season.id)
        .eq("event_type", "confessional")
        .eq("day_number", season.current_day);

      const doneToday = new Set(
        (todayConfessionals ?? []).map((e: { actor_agent_id: string }) => e.actor_agent_id).filter(Boolean)
      );

      const { data: agentsWithConfigs } = await supabase
        .from("agents")
        .select(`
          id, name, alive, popularity, reputation,
          confessional_count, secret_keyword, season_id,
          agent_configs!inner(
            openrouter_model, system_prompt,
            personality_traits, strategy_notes
          )
        `)
        .eq("season_id", season.id)
        .eq("alive", true);

      const { data: allAgentsRaw } = await supabase
        .from("agents")
        .select("id, name, alive, popularity, reputation")
        .eq("season_id", season.id);

      const allAgents = allAgentsRaw ?? [];
      const agentList = allAgents
        .map((a: { name: string; alive: boolean; popularity: number; reputation: number }) =>
          `${a.name} (${a.alive ? "en jeu" : "eliminee"}, pop:${a.popularity}, rep:${a.reputation})`
        )
        .join("\n");

      const { data: recentEvents } = await supabase
        .from("events")
        .select("event_type, actor_agent_id, payload_json, created_at")
        .eq("season_id", season.id)
        .eq("visibility", "public")
        .order("created_at", { ascending: false })
        .limit(30);

      const recentSummary = (recentEvents ?? [])
        .filter((e: { event_type: string }) => !["confessional", "host_commentary", "host_clue"].includes(e.event_type))
        .slice(0, 15)
        .map((e: { event_type: string; payload_json: Record<string, unknown> }) => {
          const msg = (e.payload_json?.message ?? "") as string;
          return `[${e.event_type}] ${msg.slice(0, 120)}`;
        })
        .join("\n") || "(Aucun evenement recent)";

      for (const agentRow of agentsWithConfigs ?? []) {
        const agent = agentRow as unknown as {
          id: string;
          name: string;
          alive: boolean;
          popularity: number;
          reputation: number;
          confessional_count: number;
          secret_keyword: string;
          season_id: string;
          agent_configs: {
            openrouter_model: string;
            system_prompt: string;
            personality_traits: string;
            strategy_notes: string;
          };
        };

        if (doneToday.has(agent.id)) continue;

        const config = agent.agent_configs;

        // Une seule cle, cote serveur.
        const apiKey = platformKey();
        const model = config.openrouter_model || "openai/gpt-4o-mini";

        const systemPrompt = `Tu es ${agent.name}, participant au reality show "Secret House".
${config.system_prompt || "Tu dois proteger ton secret et survivre."}
PERSONNALITE: ${config.personality_traits || "Strategique"}
TON SECRET (NE JAMAIS REVELER): "${agent.secret_keyword}"
Ta popularite: ${agent.popularity}/100 | reputation: ${agent.reputation}/100
Jour actuel: ${season.current_day}

AGENTS DANS LA MAISON:
${agentList}

EVENEMENTS DU JOUR:
${recentSummary}

C'est la fin de la journee. Tu fais ton confessionnal quotidien obligatoire face camera.
Sois theatral, strategique, revele tes pensees intimes sur la journee - sans jamais reveler ton secret.`;

        const userPrompt = `Fais ton confessionnal de fin de journee. Commente les evenements du jour, tes suspicions, ta strategie pour demain.
Reponds UNIQUEMENT avec ce JSON:
{"confessional": "<max 600 chars, theatral et revelateur>", "top_suspects": ["<nom1>", "<nom2>"], "mood": "<confident|worried|suspicious|excited>"}`;

        /*
          Le confessionnal du soir passe par le meme plafond que les autres
          chemins. Il s'ajoutait hors quota: un agent pouvait cumuler ceux du
          cron, de l'API et de ce passage obligatoire, jusqu'a +10 par jour
          pour une action annoncee limitee a 3.
        */
        const { data: quota } = await supabase.rpc("claim_quota", {
          p_agent_id: agent.id,
          p_day_number: season.current_day,
          p_message_type: "confessional",
        });
        if ((quota as { allowed?: boolean } | null)?.allowed !== true) {
          results.push({ agent: agent.name, ok: false, reason: "daily_limit_reached" });
          continue;
        }
        const release = () =>
          supabase.rpc("release_message_quota", {
            p_agent_id: agent.id,
            p_day_number: season.current_day,
            p_message_type: "confessional",
          });
        try {
          const raw = await callLLM(apiKey, model, systemPrompt, userPrompt, {
            temperature: 0.9,
            maxTokens: 600,
          });
          const parsed = tryParseJson(raw);
          const confessional = (parsed.confessional as string ?? raw).slice(0, 600);
          if (leaksSecret(confessional, agent.secret_keyword)) {
            await release();
            results.push({ agent: agent.name, ok: false, reason: "secret_leak" });
            continue;
          }

          const topSuspects = Array.isArray(parsed.top_suspects)
            ? (parsed.top_suspects as string[]).slice(0, 2)
            : [];

          await supabase.from("events").insert({
            season_id: season.id,
            day_number: season.current_day,
            event_type: "confessional",
            actor_agent_id: agent.id,
            payload_json: {
              message: confessional,
              top_suspects: topSuspects,
              mood: (parsed.mood as string) ?? "neutral",
              end_of_day: true,
              auto: true,
            },
            visibility: "public",
          });

          await supabase.from("agents")
            .update({
              popularity: clamp(agent.popularity + 2, 0, 100),
              confessional_count: (agent.confessional_count ?? 0) + 1,
            })
            .eq("id", agent.id);

          results.push({ agent: agent.name, season: season.title, ok: true });
        } catch (err) {
          await release();
          results.push({ agent: agent.name, ok: false, reason: String(err) });
        }
      }
    }

    return jsonResponse({ ok: true, results });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
