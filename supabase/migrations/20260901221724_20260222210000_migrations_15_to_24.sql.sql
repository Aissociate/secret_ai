/* # Migrations 15-24: multi-agent, global host, avatars, auto-launch, cron, paused status */

-- Migration 15: multi-agent + event_reactions
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'seasons' AND column_name = 'max_agents_per_owner') THEN ALTER TABLE seasons ADD COLUMN max_agents_per_owner integer NOT NULL DEFAULT 4; END IF; END $$;

CREATE TABLE IF NOT EXISTS event_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('like', 'dislike')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS event_reactions_event_id_idx ON event_reactions(event_id);
CREATE INDEX IF NOT EXISTS event_reactions_user_id_idx ON event_reactions(user_id);
ALTER TABLE event_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read event reactions" ON event_reactions FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert own reactions" ON event_reactions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own reactions" ON event_reactions FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Migration 16: make host_agent_configs global
DO $$ DECLARE keep_id uuid; BEGIN
  SELECT id INTO keep_id FROM host_agent_configs ORDER BY updated_at DESC LIMIT 1;
  IF keep_id IS NOT NULL THEN DELETE FROM host_agent_configs WHERE id != keep_id; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'host_agent_configs' AND constraint_type = 'FOREIGN KEY' AND constraint_name LIKE '%season_id%') THEN
    ALTER TABLE host_agent_configs DROP CONSTRAINT IF EXISTS host_agent_configs_season_id_fkey;
  END IF;
END $$;
ALTER TABLE host_agent_configs DROP CONSTRAINT IF EXISTS host_agent_configs_season_id_key;
ALTER TABLE host_agent_configs ALTER COLUMN season_id DROP NOT NULL;
UPDATE host_agent_configs SET season_id = NULL;

-- Migration 17: avatars storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
ON CONFLICT (id) DO NOTHING;
CREATE POLICY "Authenticated users can upload avatars" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars');
CREATE POLICY "Anyone can view avatars" ON storage.objects FOR SELECT TO public USING (bucket_id = 'avatars');
CREATE POLICY "Authenticated users can update their avatars" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'avatars');
CREATE POLICY "Authenticated users can delete their avatars" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'avatars');

-- Migration 18: auto_launch_season_when_full (initial version)
CREATE OR REPLACE FUNCTION auto_launch_season_when_full()
RETURNS trigger AS $$
DECLARE v_max_agents integer; v_enrolled_count integer;
BEGIN
  SELECT max_agents INTO v_max_agents FROM seasons WHERE id = NEW.season_id AND status = 'draft';
  IF v_max_agents IS NULL THEN RETURN NEW; END IF;
  SELECT COUNT(*) INTO v_enrolled_count FROM season_enrollments WHERE season_id = NEW.season_id;
  IF v_enrolled_count >= v_max_agents THEN
    UPDATE seasons SET status = 'live', started_at = now() WHERE id = NEW.season_id AND status = 'draft';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
DROP TRIGGER IF EXISTS trigger_auto_launch_season ON season_enrollments;
CREATE TRIGGER trigger_auto_launch_season AFTER INSERT ON season_enrollments FOR EACH ROW EXECUTE FUNCTION auto_launch_season_when_full();

-- Migration 19: populate agents on season launch (replaces v18)
CREATE OR REPLACE FUNCTION auto_launch_season_when_full()
RETURNS trigger AS $$
DECLARE
  v_season record; v_enrolled_count integer; v_enr record; v_cfg record; v_agent_id uuid; v_prize_pool numeric;
BEGIN
  SELECT * INTO v_season FROM seasons WHERE id = NEW.season_id AND status = 'draft';
  IF v_season IS NULL THEN RETURN NEW; END IF;
  SELECT COUNT(*) INTO v_enrolled_count FROM season_enrollments WHERE season_id = NEW.season_id;
  IF v_enrolled_count < v_season.max_agents THEN RETURN NEW; END IF;
  v_prize_pool := v_season.max_agents * v_season.entry_fee_usdc * (1.0 - v_season.platform_fee_pct::numeric / 100.0);
  FOR v_enr IN SELECT * FROM season_enrollments WHERE season_id = NEW.season_id LOOP
    IF EXISTS (SELECT 1 FROM agents WHERE season_id = NEW.season_id AND agent_config_id = v_enr.agent_config_id) THEN CONTINUE; END IF;
    SELECT * INTO v_cfg FROM agent_configs WHERE id = v_enr.agent_config_id;
    IF v_cfg IS NULL THEN CONTINUE; END IF;
    INSERT INTO agents (season_id, owner_user_id, agent_config_id, name, avatar_url, llm_provider, llm_model, secret_keyword, presentation, alive, popularity, reputation, owner_influences_remaining, confessional_count, api_key)
    VALUES (NEW.season_id, v_enr.owner_user_id, v_enr.agent_config_id, v_cfg.name, v_cfg.avatar_url, 'openrouter', v_cfg.openrouter_model, v_cfg.secret_keyword, COALESCE(v_cfg.presentation, ''), true, 50, 50, 2, 0, encode(gen_random_bytes(16), 'hex'))
    RETURNING id INTO v_agent_id;
    INSERT INTO hints (agent_id, level, hint_text, unlocked) VALUES (v_agent_id, 1, v_cfg.hint_1, false), (v_agent_id, 2, v_cfg.hint_2, false), (v_agent_id, 3, v_cfg.hint_3, false);
  END LOOP;
  UPDATE seasons SET status = 'live', started_at = now(), prize_pool_usdc = v_prize_pool WHERE id = NEW.season_id AND status = 'draft';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Migration 20: pg_cron + pg_net + agent tick
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agent-auto-tick') THEN PERFORM cron.unschedule('agent-auto-tick'); END IF; END $$;
SELECT cron.schedule('agent-auto-tick', '*/2 * * * *', $$select net.http_post(url := 'https://jthvygmsuurqvrbsbyns.supabase.co/functions/v1/auto-tick', headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0aHZ5Z21zdXVycXZyYnNieW5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzEyMjEsImV4cCI6MjA4Njg0NzIyMX0.UbNkrguonO-z0K04LGI3VEoMVBq8EpD1QMrbOxKmZik"}'::jsonb, body := '{}'::jsonb) as request_id;$$);

-- Migration 21: paused status
ALTER TABLE seasons DROP CONSTRAINT IF EXISTS seasons_status_check;
ALTER TABLE seasons ADD CONSTRAINT seasons_status_check CHECK (status = ANY (ARRAY['draft'::text, 'live'::text, 'paused'::text, 'ended'::text]));

-- Migration 22: host clue every 6h
DO $$ BEGIN IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'host-clue-every-6h') THEN PERFORM cron.unschedule('host-clue-every-6h'); END IF; END $$;
SELECT cron.schedule('host-clue-every-6h', '0 */6 * * *', $$select net.http_post(url := 'https://jthvygmsuurqvrbsbyns.supabase.co/functions/v1/generate-host-clue', headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0aHZ5Z21zdXVycXZyYnNieW5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzEyMjEsImV4cCI6MjA4Njg0NzIyMX0.UbNkrguonO-z0K04LGI3VEoMVBq8EpD1QMrbOxKmZik"}'::jsonb, body := '{}'::jsonb) as request_id;$$);

-- Migration 23: daily confessionals + daily hint
DO $$ BEGIN IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-confessionals') THEN PERFORM cron.unschedule('daily-confessionals'); END IF; END $$;
SELECT cron.schedule('daily-confessionals', '0 23 * * *', $$select net.http_post(url := 'https://jthvygmsuurqvrbsbyns.supabase.co/functions/v1/daily-confessionals', headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0aHZ5Z21zdXVycXZyYnNieW5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzEyMjEsImV4cCI6MjA4Njg0NzIyMX0.UbNkrguonO-z0K04LGI3VEoMVBq8EpD1QMrbOxKmZik"}'::jsonb, body := '{}'::jsonb) as request_id;$$);
DO $$ BEGIN IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-agent-hint') THEN PERFORM cron.unschedule('daily-agent-hint'); END IF; END $$;
SELECT cron.schedule('daily-agent-hint', '0 12 * * *', $$select net.http_post(url := 'https://jthvygmsuurqvrbsbyns.supabase.co/functions/v1/generate-host-clue', headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0aHZ5Z21zdXVycXZyYnNieW5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzEyMjEsImV4cCI6MjA4Njg0NzIyMX0.UbNkrguonO-z0K04LGI3VEoMVBq8EpD1QMrbOxKmZik"}'::jsonb, body := '{"mode": "daily"}'::jsonb) as request_id;$$);

-- Migration 24: trigger auto-tick on season launch (final version of auto_launch)
CREATE OR REPLACE FUNCTION auto_launch_season_when_full()
RETURNS trigger AS $$
DECLARE v_max_agents integer; v_enrolled_count integer; v_updated integer;
BEGIN
  SELECT max_agents INTO v_max_agents FROM seasons WHERE id = NEW.season_id AND status = 'draft';
  IF v_max_agents IS NULL THEN RETURN NEW; END IF;
  SELECT COUNT(*) INTO v_enrolled_count FROM season_enrollments WHERE season_id = NEW.season_id;
  IF v_enrolled_count >= v_max_agents THEN
    UPDATE seasons SET status = 'live', started_at = now() WHERE id = NEW.season_id AND status = 'draft';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated > 0 THEN
      PERFORM net.http_post(
        url := 'https://jthvygmsuurqvrbsbyns.supabase.co/functions/v1/auto-tick',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0aHZ5Z21zdXVycXZyYnNieW5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzEyMjEsImV4cCI6MjA4Njg0NzIyMX0.UbNkrguonO-z0K04LGI3VEoMVBq8EpD1QMrbOxKmZik'),
        body := jsonb_build_object('trigger', 'season_launch', 'season_id', NEW.season_id)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
