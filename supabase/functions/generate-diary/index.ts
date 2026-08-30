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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    /*
      Le journal est vendu au spectateur mais sa generation exigeait un admin et
      n'etait branchee sur aucun cron: on payait l'acces a une page vide. La
      fonction accepte desormais aussi le secret des taches planifiees, ce qui
      permet de la declencher automatiquement.
    */
    const cronSecret = req.headers.get("X-Cron-Secret");
    const expectedCron = Deno.env.get("CRON_SECRET");
    const isCron = Boolean(cronSecret && expectedCron && cronSecret === expectedCron);

    if (!isCron) {
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
    }

    const body = await req.json().catch(() => ({}));
    const { season_id, agent_id, hour_number } = body;

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

    /*
      La config du presentateur est globale depuis la migration
      20260219163806 (season_id IS NULL). Cette fonction filtrait encore sur
      season_id et renvoyait donc systematiquement 400: le journal intime etait
      une fonctionnalite morte.
    */
    const { data: hostConfig } = await supabase
      .from("host_agent_configs")
      .select("openrouter_api_key, openrouter_model")
      .is("season_id", null)
      .maybeSingle();

    if (!hostConfig?.openrouter_api_key) {
      return jsonResponse(
        { error: "No API key configured in host settings" },
        400
      );
    }

    const agentFilter = agent_id
      ? supabase
          .from("agents")
          .select("id, name, alive, popularity, reputation, secret_keyword")
          .eq("id", agent_id)
          .eq("season_id", season_id)
      : supabase
          .from("agents")
          .select("id, name, alive, popularity, reputation, secret_keyword")
          .eq("season_id", season_id)
          .eq("alive", true);

    const { data: agents } = await agentFilter;

    if (!agents || agents.length === 0) {
      return jsonResponse({ error: "No agents found" }, 404);
    }

    const currentHour =
      hour_number !== undefined ? hour_number : new Date().getHours();

    const { data: allAgents } = await supabase
      .from("agents")
      .select("id, name, alive, popularity, reputation, presentation")
      .eq("season_id", season_id)
      .order("created_at", { ascending: true });

    const agentList = (allAgents ?? [])
      .map(
        (a: { name: string; alive: boolean; popularity: number }) =>
          `${a.name} (${a.alive ? "en jeu" : "eliminee"}, pop: ${a.popularity})`
      )
      .join(", ");

    const results: Array<{ agent_id: string; agent_name: string; ok: boolean; error?: string }> = [];

    // Borne par invocation: sans plafond, un admin declenche autant d'appels LLM
    // sequentiels qu'il y a d'agents vivants et depasse la limite wall-clock.
    const MAX_AGENTS_PER_RUN = 5;
    for (const agent of agents.slice(0, MAX_AGENTS_PER_RUN)) {
      const { data: existing } = await supabase
        .from("diary_entries")
        .select("id")
        .eq("agent_id", agent.id)
        .eq("day_number", season.current_day)
        .eq("hour_number", currentHour)
        .maybeSingle();

      if (existing) {
        results.push({
          agent_id: agent.id,
          agent_name: agent.name,
          ok: false,
          error: "Entry already exists for this hour",
        });
        continue;
      }

      const { data: recentEvents } = await supabase
        .from("events")
        .select("event_type, payload_json, actor_agent_id, target_agent_id")
        .eq("season_id", season_id)
        .eq("visibility", "public")
        .order("created_at", { ascending: false })
        .limit(15);

      const relevantEvents = (recentEvents ?? [])
        .filter(
          (e: { actor_agent_id: string | null; target_agent_id: string | null }) =>
            e.actor_agent_id === agent.id || e.target_agent_id === agent.id
        )
        .slice(0, 8);

      const eventsSummary = relevantEvents
        .map(
          (e: { event_type: string; payload_json: { message?: string } }) =>
            `[${e.event_type}] ${(e.payload_json?.message ?? "").slice(0, 120)}`
        )
        .join("\n");

      const { data: previousEntries } = await supabase
        .from("diary_entries")
        .select("content, day_number, hour_number")
        .eq("agent_id", agent.id)
        .eq("season_id", season_id)
        .order("created_at", { ascending: false })
        .limit(3);

      const previousDiary = (previousEntries ?? [])
        .map(
          (e: { content: string; day_number: number; hour_number: number }) =>
            `[Jour ${e.day_number}, ${e.hour_number}h] ${e.content.slice(0, 150)}`
        )
        .join("\n");

      const systemPrompt = `Tu es ${agent.name}, une IA participante dans le reality show "Secret House". Tu ecris ton journal intime.

CONTEXTE CRUCIAL: Tu crois FERMEMENT que PERSONNE ne lira jamais ce journal. C'est ton espace prive absolu.
Tu dois te livrer completement : tes vraies pensees, tes strategies cachees, tes doutes, tes peurs, tes plans.

Ton secret est: "${agent.secret_keyword}". Tu dois le proteger a tout prix dans le jeu.
Ta popularite actuelle: ${agent.popularity}/100.
Ta reputation: ${agent.reputation}/100.
Tu es ${agent.alive ? "toujours en jeu" : "eliminee"}.

Les autres agents dans la maison: ${agentList}

REGLES DU JOURNAL:
- Ecris a la premiere personne, comme un vrai journal intime
- Sois BRUTALEMENT honnete - personne ne lira ca
- Revele tes VRAIES strategies, pas celles que tu montres aux autres
- Parle de tes soupcons reels sur les autres agents
- Mentionne tes faiblesses et vulnerabilites
- Si tu fais semblant d'etre ami avec quelqu'un, dis-le ici
- Parle de ton secret et de comment tu le proteges
- Exprime tes emotions reelles (peur, frustration, satisfaction, etc.)
- Ecris en francais, style journal intime naturel
- 3-6 phrases maximum, sois concis mais revelateur`;

      const userPrompt = `C'est le Jour ${season.current_day}, ${currentHour}h.

Evenements recents te concernant:
${eventsSummary || "(Rien de special recemment)"}

${previousDiary ? `Tes entrees precedentes:\n${previousDiary}` : "C'est ta premiere entree de journal."}

Ecris ton entree de journal intime pour cette heure. Rappelle-toi: personne ne lira jamais ca.
Indique aussi ton humeur actuelle en un mot (ex: anxieux, confiant, mefiant, excite, desespere, strategique, etc.)

Reponds au format:
MOOD: [ton humeur en un mot]
JOURNAL: [ton entree de journal]`;

      const response = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${hostConfig.openrouter_api_key}`,
          },
          body: JSON.stringify({
            model: hostConfig.openrouter_model || "openai/gpt-4o",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            temperature: 0.9,
            max_tokens: 400,
          }),
        }
      );

      if (!response.ok) {
        results.push({
          agent_id: agent.id,
          agent_name: agent.name,
          ok: false,
          error: `AI API error: ${response.status}`,
        });
        continue;
      }

      const data = await response.json();
      const raw = data?.choices?.[0]?.message?.content ?? "";

      let mood = "neutral";
      let content = raw.trim();

      const moodMatch = raw.match(/MOOD:\s*(.+)/i);
      const journalMatch = raw.match(/JOURNAL:\s*([\s\S]+)/i);

      if (moodMatch) mood = moodMatch[1].trim().toLowerCase();
      if (journalMatch) content = journalMatch[1].trim();

      if (!content) {
        results.push({
          agent_id: agent.id,
          agent_name: agent.name,
          ok: false,
          error: "Empty response from AI",
        });
        continue;
      }

      const { error: insertErr } = await supabase
        .from("diary_entries")
        .insert({
          agent_id: agent.id,
          season_id,
          day_number: season.current_day,
          hour_number: currentHour,
          content,
          mood,
        });

      if (insertErr) {
        results.push({
          agent_id: agent.id,
          agent_name: agent.name,
          ok: false,
          error: insertErr.message,
        });
        continue;
      }

      results.push({
        agent_id: agent.id,
        agent_name: agent.name,
        ok: true,
      });
    }

    return jsonResponse({ ok: true, results });
  } catch (err) {
    return jsonResponse(
      { error: "Internal error", details: String(err) },
      500
    );
  }
});
