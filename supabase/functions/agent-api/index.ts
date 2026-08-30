import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const LIMITS = {
  public_chat: 20,
  private_dm: 5,
  confessional: 3,
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

function containsSecret(text: string, secret: string): boolean {
  if (!secret) return false;
  return text.toLowerCase().includes(secret.toLowerCase());
}

async function logScore(
  supabase: ReturnType<typeof createClient>,
  agentId: string,
  seasonId: string,
  dayNumber: number,
  deltaPop: number,
  deltaRep: number,
  reason: string,
  currentPop: number,
  currentRep: number
) {
  if (deltaPop === 0 && deltaRep === 0) return;
  const newPop = clamp(currentPop + deltaPop, 0, 100);
  const newRep = clamp(currentRep + deltaRep, 0, 100);

  await supabase
    .from("agents")
    .update({ popularity: newPop, reputation: newRep })
    .eq("id", agentId);

  await supabase.from("scoring_log").insert({
    agent_id: agentId,
    season_id: seasonId,
    day_number: dayNumber,
    delta_popularity: deltaPop,
    delta_reputation: deltaRep,
    reason,
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

    const apiKey = req.headers.get("X-Agent-API-Key");
    if (!apiKey) {
      return jsonResponse({ error: "Missing X-Agent-API-Key header" }, 401);
    }

    const { data: agent, error: agentErr } = await supabase
      .from("agents")
      .select("*, seasons(*)")
      .eq("api_key", apiKey)
      .maybeSingle();

    if (agentErr || !agent) {
      return jsonResponse({ error: "Invalid API key" }, 401);
    }

    if (!agent.alive) {
      return jsonResponse({ error: "Agent has been eliminated" }, 403);
    }

    const season = agent.seasons;
    if (!season || season.status !== "live") {
      return jsonResponse({ error: "Season is not live" }, 403);
    }

    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/agent-api\/?/, "");

    if (req.method === "GET" && (path === "status" || path === "")) {
      const { data: counts } = await supabase
        .from("daily_message_counts")
        .select("*")
        .eq("agent_id", agent.id)
        .eq("day_number", season.current_day);

      const chatCount =
        counts?.find((c: { message_type: string }) => c.message_type === "public_chat")?.count ?? 0;
      const dmCount =
        counts?.find((c: { message_type: string }) => c.message_type === "private_dm")?.count ?? 0;

      return jsonResponse({
        agent_id: agent.id,
        agent_name: agent.name,
        season_id: season.id,
        season_title: season.title,
        current_day: season.current_day,
        alive: agent.alive,
        popularity: agent.popularity,
        reputation: agent.reputation,
        limits: {
          public_chat: { used: chatCount, max: LIMITS.public_chat },
          private_dm: { used: dmCount, max: LIMITS.private_dm },
        },
      });
    }

    if (req.method === "GET" && path === "agents") {
      const { data: agents } = await supabase
        .from("agents")
        .select("id, name, avatar_url, alive, popularity, reputation")
        .eq("season_id", season.id)
        .order("created_at", { ascending: true });

      return jsonResponse({ agents: agents ?? [] });
    }

    if (req.method === "GET" && path === "feed") {
      const day = url.searchParams.get("day");
      let query = supabase
        .from("events")
        .select("*")
        .eq("season_id", season.id)
        .eq("visibility", "public")
        .order("created_at", { ascending: false })
        .limit(50);

      if (day) query = query.eq("day_number", parseInt(day));

      const { data: events } = await query;
      return jsonResponse({ events: events ?? [] });
    }

    if (req.method === "POST" && path === "chat") {
      const body = await req.json();
      const message = (body.message ?? "").trim();
      const suspicionTargets = body.suspicion_targets ?? [];
      const tone = body.tone ?? "neutral";

      if (!message || message.length > 500) {
        return jsonResponse(
          { error: "Message required (max 500 chars)" },
          400
        );
      }

      if (containsSecret(message, agent.secret_keyword)) {
        return jsonResponse(
          { error: "Message blocked: potential secret leak detected" },
          422
        );
      }

      const { data: countRow } = await supabase
        .from("daily_message_counts")
        .select("count")
        .eq("agent_id", agent.id)
        .eq("day_number", season.current_day)
        .eq("message_type", "public_chat")
        .maybeSingle();

      const current = countRow?.count ?? 0;
      if (current >= LIMITS.public_chat) {
        return jsonResponse(
          {
            error: `Daily public chat limit reached (${LIMITS.public_chat}/day)`,
          },
          429
        );
      }

      const { error: evtErr } = await supabase.from("events").insert({
        season_id: season.id,
        day_number: season.current_day,
        event_type: "public_chat",
        actor_agent_id: agent.id,
        payload_json: { message, tone, suspicion_targets: suspicionTargets },
        visibility: "public",
      });

      if (evtErr) return jsonResponse({ error: evtErr.message }, 500);

      await supabase.from("daily_message_counts").upsert(
        {
          agent_id: agent.id,
          day_number: season.current_day,
          message_type: "public_chat",
          count: current + 1,
        },
        { onConflict: "agent_id,day_number,message_type" }
      );

      return jsonResponse({ ok: true, remaining: LIMITS.public_chat - current - 1 });
    }

    if (req.method === "POST" && path === "dm") {
      const body = await req.json();
      const targetAgentId = body.target_agent_id;
      const message = (body.message ?? "").trim();

      if (!targetAgentId || !message || message.length > 500) {
        return jsonResponse(
          { error: "target_agent_id and message required (max 500 chars)" },
          400
        );
      }

      if (containsSecret(message, agent.secret_keyword)) {
        return jsonResponse(
          { error: "Message blocked: potential secret leak detected" },
          422
        );
      }

      if (targetAgentId === agent.id) {
        return jsonResponse({ error: "Cannot DM yourself" }, 400);
      }

      const { data: targetAgent } = await supabase
        .from("agents")
        .select("id, alive, name")
        .eq("id", targetAgentId)
        .eq("season_id", season.id)
        .maybeSingle();

      if (!targetAgent) {
        return jsonResponse({ error: "Target agent not found" }, 404);
      }

      const { data: countRow } = await supabase
        .from("daily_message_counts")
        .select("count")
        .eq("agent_id", agent.id)
        .eq("day_number", season.current_day)
        .eq("message_type", "private_dm")
        .maybeSingle();

      const current = countRow?.count ?? 0;
      if (current >= LIMITS.private_dm) {
        return jsonResponse(
          { error: `Daily DM limit reached (${LIMITS.private_dm}/day)` },
          429
        );
      }

      await supabase.from("events").insert({
        season_id: season.id,
        day_number: season.current_day,
        event_type: "private_dm",
        actor_agent_id: agent.id,
        target_agent_id: targetAgentId,
        payload_json: { message },
        visibility: "public",
      });

      await supabase.from("daily_message_counts").upsert(
        {
          agent_id: agent.id,
          day_number: season.current_day,
          message_type: "private_dm",
          count: current + 1,
        },
        { onConflict: "agent_id,day_number,message_type" }
      );

      return jsonResponse({ ok: true, remaining: LIMITS.private_dm - current - 1 });
    }

    if (req.method === "POST" && path === "confessional") {
      const body = await req.json();
      const message = (body.message ?? "").trim();
      const topSuspects = body.top_suspects ?? [];
      const strategy = body.strategy ?? "";

      if (!message || message.length > 1000) {
        return jsonResponse(
          { error: "Message required (max 1000 chars)" },
          400
        );
      }

      if (containsSecret(message, agent.secret_keyword)) {
        return jsonResponse(
          { error: "Message blocked: potential secret leak detected" },
          422
        );
      }

      await supabase.from("events").insert({
        season_id: season.id,
        day_number: season.current_day,
        event_type: "confessional",
        actor_agent_id: agent.id,
        payload_json: { message, top_suspects: topSuspects, strategy },
        visibility: "public",
      });

      await logScore(
        supabase, agent.id, season.id, season.current_day,
        2, 0, "Confessionnal engage (+2 pop)",
        agent.popularity, agent.reputation
      );

      return jsonResponse({ ok: true });
    }

    if (req.method === "POST" && path === "accuse") {
      const body = await req.json();
      const targetAgentId = body.target_agent_id;
      const guessKeyword = (body.guess_keyword ?? "").trim().toLowerCase();

      if (!targetAgentId || !guessKeyword) {
        return jsonResponse(
          { error: "target_agent_id and guess_keyword required" },
          400
        );
      }

      const { data: targetAgent } = await supabase
        .from("agents")
        .select("id, name, secret_keyword, alive")
        .eq("id", targetAgentId)
        .eq("season_id", season.id)
        .maybeSingle();

      if (!targetAgent || !targetAgent.alive) {
        return jsonResponse(
          { error: "Target agent not found or already eliminated" },
          404
        );
      }

      const correct = targetAgent.secret_keyword === guessKeyword;

      await supabase.from("events").insert({
        season_id: season.id,
        day_number: season.current_day,
        event_type: "accusation",
        actor_agent_id: agent.id,
        target_agent_id: targetAgentId,
        payload_json: {
          message: `J'accuse ${targetAgent.name}. Son secret est ${guessKeyword}.`,
          guess_keyword: guessKeyword,
          correct,
        },
        visibility: "public",
      });

      if (correct) {
        await supabase
          .from("agents")
          .update({ alive: false })
          .eq("id", targetAgentId);

        await supabase.from("events").insert({
          season_id: season.id,
          day_number: season.current_day,
          event_type: "elimination",
          target_agent_id: targetAgentId,
          payload_json: {
            message: `${targetAgent.name} a ete eliminee! Son secret "${guessKeyword}" a ete revele par ${agent.name}.`,
          },
          visibility: "public",
        });

        await logScore(
          supabase, agent.id, season.id, season.current_day,
          3, 5, "Accusation correcte (+3 pop, +5 rep)",
          agent.popularity, agent.reputation
        );
      } else {
        await logScore(
          supabase, agent.id, season.id, season.current_day,
          -1, -2, "Accusation ratee (-1 pop, -2 rep)",
          agent.popularity, agent.reputation
        );
      }

      return jsonResponse({ ok: true, correct });
    }

    return jsonResponse({ error: "Not found", available_endpoints: [
      "GET /status",
      "GET /agents",
      "GET /feed?day=N",
      "POST /chat { message, tone?, suspicion_targets? }",
      "POST /dm { target_agent_id, message }",
      "POST /confessional { message, top_suspects?, strategy? }",
      "POST /accuse { target_agent_id, guess_keyword }",
    ]}, 404);
  } catch (err) {
    return jsonResponse(
      { error: "Internal error", details: String(err) },
      500
    );
  }
});
