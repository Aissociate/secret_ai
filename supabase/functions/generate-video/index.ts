import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

// EN TEST VIDEO - Edge function pour génération vidéo Kie.ai Sora 2

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface RequestBody {
  event_id: string;
}

interface EventData {
  id: string;
  season_id: string;
  day_number: number;
  event_type: string;
  actor_agent_id: string | null;
  payload_json: {
    message?: string;
    cinematography?: {
      facial_expression?: string;
      body_language?: string;
      camera_suggestion?: string;
      lighting_mood?: string;
      scene_atmosphere?: string;
    };
  };
}

interface AgentData {
  id: string;
  name: string;
  avatar_url: string;
}

function buildCinematographicPrompt(
  event: EventData,
  agent: AgentData
): string {
  const message = event.payload_json.message || "";
  const cine = event.payload_json.cinematography || {};

  const agentName = agent.name;
  const expression = cine.facial_expression || "thoughtful and engaged";
  const bodyLang = cine.body_language || "natural gestures";
  const lighting = cine.lighting_mood || "soft dramatic lighting";
  const atmosphere = cine.scene_atmosphere || "intimate and focused";

  let basePrompt = "";

  switch (event.event_type) {
    case "confessional":
      basePrompt = `Cinematic close-up of ${agentName} in an intimate confessional booth. ${lighting} creating expressive shadows. ${agentName} ${expression} while ${bodyLang}. The atmosphere is ${atmosphere}. Professional documentary style cinematography. ${agentName} speaks directly to camera: "${message.substring(0, 200)}"`;
      break;

    case "public_chat":
      basePrompt = `Dynamic medium shot of ${agentName} in a modern minimalist living room. Soft natural lighting. ${agentName} ${bodyLang} during the discussion. Slightly mobile camera, documentary style. ${atmosphere}. ${agentName} says: "${message.substring(0, 200)}"`;
      break;

    case "accusation":
      basePrompt = `Tense close-up on ${agentName} making a serious accusation. Strong contrast lighting with dramatic shadows. Intense and determined expression ${expression}. Confrontational atmosphere. Psychological thriller style. ${agentName} declares: "${message.substring(0, 200)}"`;
      break;

    case "private_dm":
      basePrompt = `Intimate shot of ${agentName} in a private dimly lit space. Warm soft lighting. Expression showing ${expression}. Confidential and secretive atmosphere. Intimate cinema style. ${agentName} whispers: "${message.substring(0, 200)}"`;
      break;

    default:
      basePrompt = `${agentName} in a reality TV show setting. ${lighting}. ${expression} with ${bodyLang}. ${atmosphere}. Professional cinematography. ${message.substring(0, 200)}`;
  }

  return basePrompt;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body: RequestBody = await req.json();
    const { event_id } = body;

    if (!event_id) {
      return new Response(
        JSON.stringify({ error: "event_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch event data
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("*")
      .eq("id", event_id)
      .maybeSingle();

    if (eventError || !event) {
      return new Response(
        JSON.stringify({ error: "Event not found", details: eventError }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!event.actor_agent_id) {
      return new Response(
        JSON.stringify({ error: "Event has no actor agent" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch agent data
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id, name, avatar_url")
      .eq("id", event.actor_agent_id)
      .maybeSingle();

    if (agentError || !agent) {
      return new Response(
        JSON.stringify({ error: "Agent not found", details: agentError }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch video generation settings
    const { data: settings, error: settingsError } = await supabase
      .from("video_generation_settings")
      .select("*")
      .eq("season_id", event.season_id)
      .maybeSingle();

    if (settingsError || !settings) {
      return new Response(
        JSON.stringify({ error: "Video generation not configured for this season" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!settings.enabled) {
      return new Response(
        JSON.stringify({ error: "Video generation is disabled for this season" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check daily limit (3 videos per agent per day)
    const { count, error: countError } = await supabase
      .from("video_jobs")
      .select("*", { count: "exact", head: true })
      .eq("agent_id", agent.id)
      .eq("season_id", event.season_id)
      .neq("status", "fail")
      .gte("created_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString());

    if (countError) {
      return new Response(
        JSON.stringify({ error: "Error checking daily limit", details: countError }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if ((count || 0) >= 3) {
      return new Response(
        JSON.stringify({ error: "Daily video generation limit reached (3 per agent per day)" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build cinematic prompt
    const scenePrompt = buildCinematographicPrompt(event, agent);

    // Call Kie.ai API to create video generation task
    const kieResponse = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${settings.kie_ai_api_key}`,
      },
      body: JSON.stringify({
        model: settings.model,
        input: {
          prompt: scenePrompt,
          image_urls: [agent.avatar_url],
          aspect_ratio: settings.aspect_ratio,
          n_frames: settings.n_frames,
          remove_watermark: settings.remove_watermark,
          upload_method: "s3",
        },
      }),
    });

    if (!kieResponse.ok) {
      const errorText = await kieResponse.text();
      return new Response(
        JSON.stringify({
          error: "Failed to create video generation task",
          status: kieResponse.status,
          details: errorText
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const kieData = await kieResponse.json();
    const taskId = kieData?.data?.taskId;

    if (!taskId) {
      return new Response(
        JSON.stringify({ error: "No taskId returned from Kie.ai", response: kieData }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create video_job record
    const { data: videoJob, error: jobError } = await supabase
      .from("video_jobs")
      .insert({
        event_id: event.id,
        season_id: event.season_id,
        agent_id: agent.id,
        task_id: taskId,
        status: "pending",
        scene_prompt: scenePrompt,
        cinematography_metadata: event.payload_json.cinematography || {},
      })
      .select()
      .single();

    if (jobError || !videoJob) {
      return new Response(
        JSON.stringify({ error: "Failed to create video job record", details: jobError }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update event with video_job_id
    await supabase
      .from("events")
      .update({ video_job_id: videoJob.id })
      .eq("id", event.id);

    return new Response(
      JSON.stringify({
        success: true,
        job_id: videoJob.id,
        task_id: taskId,
        status: "pending"
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
