import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { platformKey } from "../_shared/llm.ts";
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
    const { season_id, action } = body;

    if (!season_id) {
      return jsonResponse({ error: "season_id required" }, 400);
    }

    const { data: season } = await supabase
      .from("seasons")
      .select("*")
      .eq("id", season_id)
      .maybeSingle();

    if (!season) {
      return jsonResponse({ error: "Season not found" }, 404);
    }

    const { data: hostConfig } = await supabase
      .from("host_agent_configs")
      .select("*")
      .is("season_id", null)
      .maybeSingle();

    if (!hostConfig || !hostConfig.enabled) {
      return jsonResponse({ error: "Host agent not configured or disabled" }, 400);
    }

    if (!platformKey()) {
      return jsonResponse({ error: "Host agent API key not set" }, 400);
    }

    const { data: agents } = await supabase
      .from("agents")
      .select("id, name, alive, popularity, reputation, presentation")
      .eq("season_id", season_id)
      .order("created_at", { ascending: true });

    const { data: recentEvents } = await supabase
      .from("events")
      .select("*")
      .eq("season_id", season_id)
      .eq("visibility", "public")
      .order("created_at", { ascending: false })
      .limit(20);

    const agentList = (agents ?? [])
      .map(
        (a: { name: string; alive: boolean; popularity: number }) =>
          `${a.name} (${a.alive ? "en jeu" : "eliminee"}, pop: ${a.popularity})`
      )
      .join(", ");

    const recentSummary = (recentEvents ?? [])
      .slice(0, 10)
      .map(
        (e: { event_type: string; payload_json: { message?: string } }) =>
          `[${e.event_type}] ${(e.payload_json?.message ?? "").slice(0, 100)}`
      )
      .join("\n");

    let userPrompt = "";

    if (action === "commentary") {
      userPrompt = `Genere un commentaire d'animateur sur les evenements recents du Jour ${season.current_day}.
Agents: ${agentList}
Evenements recents:
${recentSummary}

Fais un commentaire dramatique, engageant, comme un presentateur TV. 2-3 phrases maximum.`;
    } else if (action === "day_recap") {
      userPrompt = `Fais le recap du Jour ${season.current_day}.
Agents: ${agentList}
Evenements:
${recentSummary}

Resume les moments forts, les tensions, les retournements. Style presentateur de reality show. 3-5 phrases.`;
    } else if (action === "provoke") {
      const targetName = body.target_agent_name ?? "";
      userPrompt = `En tant qu'animateur, provoque ou questionne ${targetName || "les agents"} pour creer du drama.
Agents: ${agentList}
Contexte recent:
${recentSummary}

Pose une question piquante ou fais une remarque provocatrice. 1-2 phrases maximum.`;
    } else {
      return jsonResponse({
        error: "Unknown action. Use: commentary, day_recap, provoke",
      }, 400);
    }

    const systemPrompt =
      hostConfig.system_prompt ||
      `Tu es "${hostConfig.name}", l'animateur et juge du reality show "Secret House". ${hostConfig.personality || "Tu es charismatique, dramatique, et tu adores creer du suspense."}
Tu commentes les evenements, tu provoques les agents, tu resumes les journees. Ton style est celui d'un grand presentateur TV francais. Tu parles toujours en francais.
IMPORTANT: Sois concis, percutant et theatral.`;

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${platformKey()}`,
        },
        body: JSON.stringify({
          model: hostConfig.openrouter_model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.85,
          max_tokens: 300,
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return jsonResponse(
        { error: `OpenRouter error: ${response.status}`, details: errText },
        502
      );
    }

    const data = await response.json();
    const message = data?.choices?.[0]?.message?.content ?? "";

    if (!message.trim()) {
      return jsonResponse({ error: "Empty response from AI" }, 422);
    }

    const { error: evtErr } = await supabase.from("events").insert({
      season_id,
      day_number: season.current_day,
      event_type: "host_commentary",
      payload_json: {
        message: message.trim(),
        action,
        host_name: hostConfig.name,
        host_avatar: hostConfig.avatar_url,
      },
      visibility: "public",
    });

    if (evtErr) {
      return jsonResponse({ error: evtErr.message }, 500);
    }

    return jsonResponse({
      ok: true,
      message: message.trim(),
      action,
      host_name: hostConfig.name,
    });
  } catch (err) {
    return jsonResponse(
      { error: "Internal error", details: String(err) },
      500
    );
  }
});
