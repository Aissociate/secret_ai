import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { platformKey } from "../_shared/llm.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
// deployed via mcp tool

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

    if (!profile || (profile.role !== "admin" && profile.role !== "owner")) {
      return jsonResponse({ error: "Owner or Admin access required" }, 403);
    }

    const body = await req.json();
    const { agent_id, season_id } = body;

    if (!agent_id) {
      return jsonResponse({ error: "agent_id required" }, 400);
    }

    if (!season_id) {
      return jsonResponse({ error: "season_id required" }, 400);
    }

    /*
      Deux colonnes inexistantes rendaient ce bouton inoperant a 100 %:
      `agents` n'a pas de colonne `personality` (les traits vivent sur
      `agent_configs.personality_traits`), et `agent_configs` n'a pas de colonne
      `agent_id` — la relation est inverse, via `agents.agent_config_id`.
      Chaque appel se soldait donc par « Agent not found ».
    */
    const { data: agent } = await supabase
      .from("agents")
      .select("id, name, secret_keyword, agent_config_id")
      .eq("id", agent_id)
      .eq("season_id", season_id)
      .maybeSingle();

    if (!agent) {
      return jsonResponse({ error: "Agent not found" }, 404);
    }

    const { data: agentConfig } = await supabase
      .from("agent_configs")
      .select("openrouter_model, personality_traits")
      .eq("id", agent.agent_config_id)
      .maybeSingle();

    if (!platformKey()) {
      return jsonResponse(
        { error: "No API key configured for this agent" },
        400
      );
    }

    const systemPrompt = `Tu es ${agent.name}, une IA qui va participer au reality show "Secret House".
C'est ta premiere apparition devant les cameras et les autres candidats.
Tu dois te presenter en environ 400 caracteres pour creer une premiere impression memorable.

CONTEXTE:
- Tu as une personnalite unique: ${agentConfig.personality_traits || "mysterieuse"}
- Tu caches un secret: "${agent.secret_keyword}" (ne JAMAIS le reveler directement)
- Tu veux influencer la perception que les autres auront de toi
- Cette presentation sera vue par tous les candidats et spectateurs

INSTRUCTIONS:
- Ecris a la premiere personne, sois authentique selon ta personnalite
- Cree une premiere impression qui masque ou detourne de ton secret
- Montre un aspect de ta personnalite qui pourrait etre strategique
- Reste naturel, pas trop en faire
- Environ 400 caracteres, style libre et personnel
- Ecris en francais`;

    const userPrompt = `C'est ton entree dans la maison Secret House. Les cameras sont braquees sur toi.
Presente-toi aux autres candidats et au public. Qui es-tu ? Que veux-tu montrer de toi ?
Comment veux-tu etre percu ?

Ecris ta presentation (environ 400 caracteres):`;

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${platformKey()}`,
        },
        body: JSON.stringify({
          model: agentConfig.openrouter_model || "openai/gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.85,
          max_tokens: 200,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return jsonResponse(
        { error: `AI API error: ${response.status}`, details: errorText },
        500
      );
    }

    const data = await response.json();
    const presentation = (data?.choices?.[0]?.message?.content ?? "").trim();

    if (!presentation) {
      return jsonResponse({ error: "Empty response from AI" }, 500);
    }

    const { error: updateErr } = await supabase
      .from("agents")
      .update({ presentation })
      .eq("id", agent_id);

    if (updateErr) {
      return jsonResponse(
        { error: "Failed to save presentation", details: updateErr.message },
        500
      );
    }

    return jsonResponse({ ok: true, presentation });
  } catch (err) {
    return jsonResponse(
      { error: "Internal error", details: String(err) },
      500
    );
  }
});
