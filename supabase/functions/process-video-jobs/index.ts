import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";
import { requireCronSecret, type DB } from "../_shared/auth.ts";

interface VideoJob {
  id: string;
  task_id: string | null;
  status: string;
  scene_prompt: string;
  retry_count: number;
  season_id: string;
  event_id: string;
  agent_id: string;
  cinematography_metadata: Record<string, unknown> | null;
}

interface VideoSettings {
  kie_ai_api_key: string;
  model: string;
  aspect_ratio: string;
  n_frames: string;
  remove_watermark: boolean;
}

interface KieJobResponse {
  code: number;
  message: string;
  data: {
    taskId: string;
    state: string;
    resultJson?: string;
    failCode?: string;
    failMsg?: string;
  };
}

async function processJob(
  job: VideoJob,
  settings: VideoSettings,
  supabase: DB
): Promise<{ updated: boolean; newStatus: string }> {
  if (!job.task_id) {
    console.log(`Job ${job.id} has no task_id, skipping`);
    return { updated: false, newStatus: job.status };
  }

  try {
    // Query Kie.ai for job status
    const kieResponse = await fetch(
      `https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${job.task_id}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${settings.kie_ai_api_key}`,
        },
      }
    );

    if (!kieResponse.ok) {
      console.error(`Failed to query Kie.ai for job ${job.id}: ${kieResponse.status}`);
      return { updated: false, newStatus: job.status };
    }

    const kieData: KieJobResponse = await kieResponse.json();

    if (kieData.code !== 200) {
      console.error(`Kie.ai returned error code ${kieData.code} for job ${job.id}`);
      return { updated: false, newStatus: job.status };
    }

    const state = kieData.data.state;
    let newStatus = job.status;
    const updateData: Record<string, unknown> = {};

    // Map Kie.ai states to our statuses
    switch (state) {
      case "waiting":
      case "queuing":
        newStatus = "queuing";
        updateData.status = "queuing";
        break;

      case "generating":
        newStatus = "generating";
        updateData.status = "generating";
        break;

      case "success":
        newStatus = "success";
        updateData.status = "success";
        updateData.completed_at = new Date().toISOString();

        // Extract video URLs from resultJson
        if (kieData.data.resultJson) {
          try {
            const resultData = JSON.parse(kieData.data.resultJson);
            if (resultData.resultUrls && resultData.resultUrls.length > 0) {
              updateData.video_url = resultData.resultUrls[0];
            }
            if (resultData.resultWaterMarkUrls && resultData.resultWaterMarkUrls.length > 0) {
              updateData.watermark_video_url = resultData.resultWaterMarkUrls[0];
            }
          } catch (e) {
            console.error(`Failed to parse resultJson for job ${job.id}:`, e);
          }
        }
        break;

      case "fail": {
        const errorMsg = `${kieData.data.failCode || "unknown"}: ${kieData.data.failMsg || "unknown error"}`;

        // Check if we should retry
        if (job.retry_count < 3) {
          console.log(`Job ${job.id} failed, attempting retry ${job.retry_count + 1}/3`);

          // Get agent avatar for retry
          const { data: agent } = await supabase
            .from("agents")
            .select("avatar_url")
            .eq("id", job.agent_id)
            .maybeSingle();

          if (agent) {
            // Create new task with Kie.ai
            const retryResponse = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${settings.kie_ai_api_key}`,
              },
              body: JSON.stringify({
                model: settings.model,
                input: {
                  prompt: job.scene_prompt,
                  image_urls: [agent.avatar_url],
                  aspect_ratio: settings.aspect_ratio,
                  n_frames: settings.n_frames,
                  remove_watermark: settings.remove_watermark,
                  upload_method: "s3",
                },
              }),
            });

            if (retryResponse.ok) {
              const retryData = await retryResponse.json();
              const newTaskId = retryData?.data?.taskId;

              if (newTaskId) {
                updateData.task_id = newTaskId;
                updateData.status = "pending";
                updateData.retry_count = job.retry_count + 1;
                updateData.error_message = `Previous attempt failed: ${errorMsg}. Retrying...`;
                newStatus = "pending";
                console.log(`Created retry task ${newTaskId} for job ${job.id}`);
              } else {
                // Retry creation failed, mark as fail
                updateData.status = "fail";
                updateData.completed_at = new Date().toISOString();
                updateData.error_message = `${errorMsg}. Retry failed: no taskId returned`;
                newStatus = "fail";
              }
            } else {
              // Retry creation failed, mark as fail
              updateData.status = "fail";
              updateData.completed_at = new Date().toISOString();
              updateData.error_message = `${errorMsg}. Retry failed: ${retryResponse.status}`;
              newStatus = "fail";
            }
          } else {
            // Agent not found, mark as fail
            updateData.status = "fail";
            updateData.completed_at = new Date().toISOString();
            updateData.error_message = `${errorMsg}. Retry failed: agent not found`;
            newStatus = "fail";
          }
        } else {
          // Max retries reached, mark as final fail
          updateData.status = "fail";
          updateData.completed_at = new Date().toISOString();
          updateData.error_message = `${errorMsg}. Max retries (3) reached`;
          newStatus = "fail";
        }
        break;
      }
    }

    // Update the job if status changed
    if (newStatus !== job.status || Object.keys(updateData).length > 1) {
      const { error } = await supabase
        .from("video_jobs")
        .update(updateData)
        .eq("id", job.id);

      if (error) {
        console.error(`Failed to update job ${job.id}:`, error);
        return { updated: false, newStatus: job.status };
      }

      console.log(`Updated job ${job.id}: ${job.status} -> ${newStatus}`);
      return { updated: true, newStatus };
    }

    return { updated: false, newStatus };
  } catch (error) {
    console.error(`Error processing job ${job.id}:`, error);
    return { updated: false, newStatus: job.status };
  }
}

// Borne le travail d'une invocation: sans limite, un backlog de 200 jobs
// declenche 200 appels HTTP sequentiels et depasse la limite wall-clock.
const MAX_JOBS_PER_RUN = 25;
const BATCH_SIZE = 5;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const denied = requireCronSecret(req);
  if (denied) return denied;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: jobs, error: jobsError } = await supabase
      .from("video_jobs")
      .select("*")
      .in("status", ["pending", "queuing", "generating"])
      .order("created_at", { ascending: true })
      .limit(MAX_JOBS_PER_RUN);

    if (jobsError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch jobs", details: jobsError }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!jobs || jobs.length === 0) {
      return new Response(
        JSON.stringify({ message: "No jobs to process", processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing ${jobs.length} video jobs...`);

    // Group jobs by season to batch fetch settings
    const jobsByseason: { [seasonId: string]: VideoJob[] } = {};
    for (const job of jobs) {
      if (!jobsByseason[job.season_id]) {
        jobsByseason[job.season_id] = [];
      }
      jobsByseason[job.season_id].push(job);
    }

    let totalProcessed = 0;
    const results: Array<Record<string, unknown>> = [];

    // Process jobs for each season
    for (const [seasonId, seasonJobs] of Object.entries(jobsByseason)) {
      // Fetch settings for this season
      const { data: settings, error: settingsError } = await supabase
        .from("video_generation_settings")
        .select("*")
        .eq("season_id", seasonId)
        .maybeSingle();

      if (settingsError || !settings) {
        console.error(`No settings found for season ${seasonId}, skipping ${seasonJobs.length} jobs`);
        continue;
      }

      // Traitement par lots: un job lent ne bloque plus toute la file.
      for (let i = 0; i < seasonJobs.length; i += BATCH_SIZE) {
        const batch = seasonJobs.slice(i, i + BATCH_SIZE);
        const settled = await Promise.allSettled(
          batch.map((job) => processJob(job, settings, supabase))
        );

        settled.forEach((outcome, idx) => {
          const job = batch[idx];
          if (outcome.status === "fulfilled") {
            if (outcome.value.updated) totalProcessed++;
            results.push({
              job_id: job.id,
              old_status: job.status,
              new_status: outcome.value.newStatus,
              updated: outcome.value.updated,
            });
          } else {
            results.push({
              job_id: job.id,
              old_status: job.status,
              new_status: job.status,
              updated: false,
              error: String(outcome.reason),
            });
          }
        });
      }
    }

    return new Response(
      JSON.stringify({
        message: `Processed ${totalProcessed} jobs`,
        total_jobs: jobs.length,
        processed: totalProcessed,
        truncated: jobs.length === MAX_JOBS_PER_RUN,
        results
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Internal server error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
