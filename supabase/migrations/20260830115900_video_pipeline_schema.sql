/*
  # Schema du pipeline video (rapatrie dans les migrations)

  ## Contexte
  `video_jobs`, `video_generation_settings` et `events.video_job_id` sont
  utilises par les fonctions Edge (generate-video, process-video-jobs) et par
  trois pages du front, mais n'existaient dans aucune migration: ils avaient ete
  crees a la main dans la console Supabase.

  Consequences: un deploiement depuis zero cassait, et surtout l'etat RLS de ces
  tables n'etait ni versionne ni auditable — alors que
  `video_generation_settings` contient une cle d'API Kie.ai.

  Cette migration est ecrite en IF NOT EXISTS: elle ne touche pas un
  environnement ou ces objets existent deja, et rend le schema reproductible
  partout ailleurs.

  Numerotee avant les autres migrations du 30/08 car la vue `events_feed`
  (20260830120300) reference `events.video_job_id`.
*/

CREATE TABLE IF NOT EXISTS video_generation_settings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id       uuid NOT NULL UNIQUE REFERENCES seasons(id) ON DELETE CASCADE,
  kie_ai_api_key  text NOT NULL DEFAULT '',
  model           text NOT NULL DEFAULT 'sora-2-image-to-video',
  aspect_ratio    text NOT NULL DEFAULT 'landscape',
  n_frames        text NOT NULL DEFAULT '129',
  remove_watermark boolean NOT NULL DEFAULT false,
  enabled         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS video_jobs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                 uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  season_id                uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  agent_id                 uuid REFERENCES agents(id) ON DELETE SET NULL,
  task_id                  text,
  status                   text NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','queuing','generating','success','fail')),
  scene_prompt             text NOT NULL DEFAULT '',
  video_url                text,
  watermark_video_url      text,
  error_message            text,
  retry_count              integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  cinematography_metadata  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  completed_at             timestamptz
);

/*
  Une seule tache par evenement: `generate-video` ne dedupliquait pas, donc deux
  appels sur le meme evenement creaient deux taches payantes et la seconde
  ecrasait events.video_job_id.
*/
CREATE UNIQUE INDEX IF NOT EXISTS idx_video_jobs_event_unique ON video_jobs (event_id);
CREATE INDEX IF NOT EXISTS idx_video_jobs_status ON video_jobs (status, created_at);
CREATE INDEX IF NOT EXISTS idx_video_jobs_agent_day ON video_jobs (agent_id, created_at);

ALTER TABLE events ADD COLUMN IF NOT EXISTS video_job_id uuid
  REFERENCES video_jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_video_job ON events (video_job_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE video_generation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_jobs ENABLE ROW LEVEL SECURITY;

/*
  video_generation_settings contient kie_ai_api_key: seuls les admins y ont
  acces, et le front lit l'etat via la vue video_settings_public.
*/
DROP POLICY IF EXISTS "Admins manage video settings" ON video_generation_settings;
CREATE POLICY "Admins manage video settings"
  ON video_generation_settings FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'));

CREATE OR REPLACE VIEW video_settings_public
WITH (security_invoker = false) AS
SELECT
  id,
  season_id,
  model,
  aspect_ratio,
  n_frames,
  remove_watermark,
  enabled,
  (kie_ai_api_key IS NOT NULL AND kie_ai_api_key <> '') AS has_api_key,
  created_at,
  updated_at
FROM video_generation_settings;

GRANT SELECT ON video_settings_public TO anon, authenticated;

-- Les videos produites sont destinees a etre vues: lecture publique.
DROP POLICY IF EXISTS "Anyone can view video jobs" ON video_jobs;
CREATE POLICY "Anyone can view video jobs"
  ON video_jobs FOR SELECT
  TO anon, authenticated
  USING (true);

/*
  Aucune policy d'ecriture: les taches sont creees et mises a jour uniquement
  par les fonctions Edge en service_role, qui contournent la RLS.
*/
