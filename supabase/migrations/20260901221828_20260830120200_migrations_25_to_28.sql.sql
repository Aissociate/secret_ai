/* # Migrations 25-28: video pipeline, season lifecycle, progression, RLS hardening */

-- Migration 25: video pipeline schema
CREATE TABLE IF NOT EXISTS video_generation_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL UNIQUE REFERENCES seasons(id) ON DELETE CASCADE,
  kie_ai_api_key text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT 'sora-2-image-to-video',
  aspect_ratio text NOT NULL DEFAULT 'landscape',
  n_frames text NOT NULL DEFAULT '129',
  remove_watermark boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS video_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  task_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','queuing','generating','success','fail')),
  scene_prompt text NOT NULL DEFAULT '',
  video_url text,
  watermark_video_url text,
  error_message text,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  cinematography_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_video_jobs_event_unique ON video_jobs (event_id);
CREATE INDEX IF NOT EXISTS idx_video_jobs_status ON video_jobs (status, created_at);
CREATE INDEX IF NOT EXISTS idx_video_jobs_agent_day ON video_jobs (agent_id, created_at);
ALTER TABLE events ADD COLUMN IF NOT EXISTS video_job_id uuid REFERENCES video_jobs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_events_video_job ON events (video_job_id);
ALTER TABLE video_generation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage video settings" ON video_generation_settings;
CREATE POLICY "Admins manage video settings" ON video_generation_settings FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')) WITH CHECK (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'));
CREATE OR REPLACE VIEW video_settings_public WITH (security_invoker = false) AS SELECT id, season_id, model, aspect_ratio, n_frames, remove_watermark, enabled, (kie_ai_api_key IS NOT NULL AND kie_ai_api_key <> '') AS has_api_key, created_at, updated_at FROM video_generation_settings;
GRANT SELECT ON video_settings_public TO anon, authenticated;
DROP POLICY IF EXISTS "Anyone can view video jobs" ON video_jobs;
CREATE POLICY "Anyone can view video jobs" ON video_jobs FOR SELECT TO anon, authenticated USING (true);

-- Migration 26: season lifecycle and security
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS duration_days integer NOT NULL DEFAULT 7;
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS day_started_at timestamptz;
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS day_duration_hours integer NOT NULL DEFAULT 24;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.constraint_column_usage WHERE table_name = 'seasons' AND constraint_name = 'seasons_duration_days_check') THEN ALTER TABLE seasons ADD CONSTRAINT seasons_duration_days_check CHECK (duration_days BETWEEN 1 AND 14); END IF; END $$;
DO $$ DECLARE v_conname text; BEGIN SELECT conname INTO v_conname FROM pg_constraint WHERE conrelid = 'seasons'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%current_day%'; IF v_conname IS NOT NULL THEN EXECUTE format('ALTER TABLE seasons DROP CONSTRAINT %I', v_conname); END IF; END $$;
ALTER TABLE seasons ADD CONSTRAINT seasons_current_day_check CHECK (current_day >= 1 AND current_day <= duration_days);
DO $$ DECLARE v_conname text; BEGIN SELECT conname INTO v_conname FROM pg_constraint WHERE conrelid = 'seasons'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%status%'; IF v_conname IS NOT NULL THEN EXECUTE format('ALTER TABLE seasons DROP CONSTRAINT %I', v_conname); END IF; END $$;
ALTER TABLE seasons ADD CONSTRAINT seasons_status_check CHECK (status IN ('draft', 'live', 'paused', 'ended'));
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seasons_fees_non_negative') THEN ALTER TABLE seasons ADD CONSTRAINT seasons_fees_non_negative CHECK (entry_fee_usdc >= 0 AND prize_pool_usdc >= 0 AND platform_fee_pct >= 0 AND platform_fee_pct <= 100); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_amount_non_negative') THEN ALTER TABLE payments ADD CONSTRAINT payments_amount_non_negative CHECK (amount_usdc >= 0); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prize_distributions_amount_non_negative') THEN ALTER TABLE prize_distributions ADD CONSTRAINT prize_distributions_amount_non_negative CHECK (amount_usdc >= 0); END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_season_config_unique ON agents (season_id, agent_config_id);
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_event_type_check;
ALTER TABLE events ADD CONSTRAINT events_event_type_check CHECK (event_type IN ('public_chat','confessional','hint_reveal','owner_influence','spectator_influence','accusation','elimination','system','private_dm','host_commentary','host_clue','day_advanced','season_ended'));
DO $$ DECLARE v_conname text; BEGIN SELECT conname INTO v_conname FROM pg_constraint WHERE conrelid = 'events'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%day_number%'; IF v_conname IS NOT NULL THEN EXECUTE format('ALTER TABLE events DROP CONSTRAINT %I', v_conname); END IF; END $$;
ALTER TABLE events ADD CONSTRAINT events_day_number_check CHECK (day_number >= 1);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_opening_unique ON events (season_id) WHERE event_type = 'host_commentary' AND (payload_json->>'opening') = 'true';

CREATE OR REPLACE FUNCTION prevent_role_self_escalation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role' OR current_user = 'service_role' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN IF NEW.role NOT IN ('spectator', 'owner') THEN NEW.role := 'spectator'; END IF; RETURN NEW; END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN RAISE EXCEPTION 'Le role ne peut pas etre modifie par son propre proprietaire'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_prevent_role_self_escalation ON users;
CREATE TRIGGER trg_prevent_role_self_escalation BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION prevent_role_self_escalation();
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_user_role_by_email') THEN EXECUTE 'REVOKE ALL ON FUNCTION set_user_role_by_email(text, text) FROM PUBLIC'; EXECUTE 'REVOKE ALL ON FUNCTION set_user_role_by_email(text, text) FROM anon'; EXECUTE 'REVOKE ALL ON FUNCTION set_user_role_by_email(text, text) FROM authenticated'; EXECUTE 'ALTER FUNCTION set_user_role_by_email(text, text) SET search_path = public, pg_temp'; END IF; END $$;

CREATE OR REPLACE FUNCTION unaccent_fallback(raw text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$ SELECT translate(COALESCE(raw, ''), 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ', 'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY'); $$;
CREATE OR REPLACE FUNCTION normalize_secret(raw text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$ SELECT regexp_replace(lower(unaccent_fallback(COALESCE(raw, ''))), '[^a-z0-9]', '', 'g'); $$;
CREATE OR REPLACE FUNCTION notify_edge_function(fn_name text, payload jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp, net AS $$
DECLARE v_url text := current_setting('app.supabase_url', true); v_secret text := current_setting('app.cron_secret', true);
BEGIN
  IF v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN RAISE WARNING 'notify_edge_function(%): app.supabase_url ou app.cron_secret non configure', fn_name; RETURN; END IF;
  PERFORM net.http_post(url := v_url || '/functions/v1/' || fn_name, headers := jsonb_build_object('Content-Type', 'application/json', 'X-Cron-Secret', v_secret), body := payload);
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'notify_edge_function(%) a echoue: %', fn_name, SQLERRM;
END; $$;

CREATE OR REPLACE FUNCTION auto_launch_season_when_full()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_season record; v_enrolled_count integer; v_enr record; v_cfg record; v_agent_id uuid; v_prize_pool numeric; v_updated integer;
BEGIN
  SELECT * INTO v_season FROM seasons WHERE id = NEW.season_id AND status = 'draft' FOR UPDATE;
  IF v_season IS NULL THEN RETURN NEW; END IF;
  SELECT COUNT(*) INTO v_enrolled_count FROM season_enrollments WHERE season_id = NEW.season_id AND COALESCE(status, 'accepted') <> 'rejected';
  IF v_enrolled_count < v_season.max_agents THEN RETURN NEW; END IF;
  v_prize_pool := v_season.max_agents * v_season.entry_fee_usdc * (1.0 - v_season.platform_fee_pct::numeric / 100.0);
  FOR v_enr IN SELECT * FROM season_enrollments WHERE season_id = NEW.season_id AND COALESCE(status, 'accepted') <> 'rejected' LOOP
    IF EXISTS (SELECT 1 FROM agents WHERE season_id = NEW.season_id AND agent_config_id = v_enr.agent_config_id) THEN CONTINUE; END IF;
    SELECT * INTO v_cfg FROM agent_configs WHERE id = v_enr.agent_config_id;
    IF v_cfg IS NULL THEN CONTINUE; END IF;
    INSERT INTO agents (season_id, owner_user_id, agent_config_id, name, avatar_url, llm_provider, llm_model, secret_keyword, presentation, alive, popularity, reputation, owner_influences_remaining, confessional_count, api_key)
    VALUES (NEW.season_id, v_enr.owner_user_id, v_enr.agent_config_id, v_cfg.name, v_cfg.avatar_url, 'openrouter', v_cfg.openrouter_model, normalize_secret(v_cfg.secret_keyword), COALESCE(v_cfg.presentation, ''), true, 50, 50, 2, 0, encode(gen_random_bytes(16), 'hex'))
    RETURNING id INTO v_agent_id;
    INSERT INTO hints (agent_id, level, hint_text, unlocked) VALUES (v_agent_id, 1, v_cfg.hint_1, false), (v_agent_id, 2, v_cfg.hint_2, false), (v_agent_id, 3, v_cfg.hint_3, false);
  END LOOP;
  UPDATE seasons SET status = 'live', started_at = now(), day_started_at = now(), current_day = 1, prize_pool_usdc = v_prize_pool WHERE id = NEW.season_id AND status = 'draft';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated > 0 THEN PERFORM notify_edge_function('auto-tick', jsonb_build_object('trigger', 'season_launch', 'season_id', NEW.season_id)); END IF;
  RETURN NEW;
END; $$;

-- Migration 27: season progression
CREATE OR REPLACE FUNCTION compute_prize_pool(p_season_id uuid)
RETURNS TABLE (entry_revenue numeric, influence_revenue numeric, platform_fee_amount numeric, total_pool numeric, participants_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  WITH s AS (SELECT platform_fee_pct, prize_pool_usdc FROM seasons WHERE id = p_season_id),
  p AS (SELECT COALESCE(SUM(amount_usdc) FILTER (WHERE type = 'entry'), 0) AS entries, COALESCE(SUM(amount_usdc) FILTER (WHERE type = 'influence'), 0) AS influences, COUNT(DISTINCT user_id) FILTER (WHERE type = 'entry') AS participants FROM payments WHERE season_id = p_season_id AND status = 'confirmed')
  SELECT p.entries, p.influences, ROUND((p.entries + p.influences) * s.platform_fee_pct / 100.0, 6), GREATEST(ROUND((p.entries + p.influences) * (1 - s.platform_fee_pct / 100.0), 6), COALESCE(s.prize_pool_usdc, 0)), p.participants::integer FROM p, s;
$fn$;

CREATE OR REPLACE FUNCTION close_season(p_season_id uuid, p_reason text DEFAULT 'completed')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_season record; v_winner record; v_runner_up record; v_pool record;
BEGIN
  SELECT * INTO v_season FROM seasons WHERE id = p_season_id FOR UPDATE;
  IF v_season IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'season_not_found'); END IF;
  IF v_season.status = 'ended' THEN RETURN jsonb_build_object('ok', true, 'already_ended', true, 'winner_agent_id', v_season.winner_agent_id); END IF;
  SELECT * INTO v_winner FROM agents WHERE season_id = p_season_id AND alive = true ORDER BY popularity DESC, reputation DESC, created_at ASC LIMIT 1;
  SELECT * INTO v_runner_up FROM agents WHERE season_id = p_season_id AND (v_winner.id IS NULL OR id <> v_winner.id) ORDER BY alive DESC, popularity DESC, reputation DESC LIMIT 1;
  SELECT * INTO v_pool FROM compute_prize_pool(p_season_id);
  UPDATE seasons SET status = 'ended', ended_at = now(), winner_agent_id = v_winner.id, prize_pool_usdc = GREATEST(COALESCE(v_pool.total_pool, 0), v_season.prize_pool_usdc) WHERE id = p_season_id;
  UPDATE hints SET unlocked = true, unlocked_at = now() WHERE unlocked = false AND agent_id IN (SELECT id FROM agents WHERE season_id = p_season_id);
  IF NOT EXISTS (SELECT 1 FROM prize_distributions WHERE season_id = p_season_id) THEN
    IF v_winner.id IS NOT NULL AND v_winner.owner_user_id IS NOT NULL THEN INSERT INTO prize_distributions (season_id, recipient_user_id, recipient_agent_id, type, amount_usdc) VALUES (p_season_id, v_winner.owner_user_id, v_winner.id, 'winner', ROUND(COALESCE(v_pool.total_pool, 0) * 0.80, 6)); END IF;
    IF v_runner_up.id IS NOT NULL AND v_runner_up.owner_user_id IS NOT NULL THEN INSERT INTO prize_distributions (season_id, recipient_user_id, recipient_agent_id, type, amount_usdc) VALUES (p_season_id, v_runner_up.owner_user_id, v_runner_up.id, 'runner_up', ROUND(COALESCE(v_pool.total_pool, 0) * 0.20, 6)); END IF;
  END IF;
  INSERT INTO events (season_id, day_number, event_type, actor_agent_id, payload_json, visibility) VALUES (p_season_id, v_season.current_day, 'season_ended', v_winner.id, jsonb_build_object('message', COALESCE(v_winner.name, 'Personne') || ' remporte la saison.', 'winner_name', v_winner.name, 'reason', p_reason, 'prize_pool', COALESCE(v_pool.total_pool, 0)), 'public');
  RETURN jsonb_build_object('ok', true, 'winner_agent_id', v_winner.id, 'winner_name', v_winner.name, 'prize_pool', COALESCE(v_pool.total_pool, 0), 'reason', p_reason);
END; $fn$;

CREATE OR REPLACE FUNCTION advance_season_day(p_season_id uuid, p_force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_season record; v_alive integer; v_eliminated record; v_eliminated_names text[] := ARRAY[]::text[]; v_next_day integer; v_deadline timestamptz; v_ceremonies_left integer; v_to_eliminate integer; v_already_out integer;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('advance_season:' || p_season_id::text)) THEN RETURN jsonb_build_object('ok', false, 'skipped', 'locked'); END IF;
  SELECT * INTO v_season FROM seasons WHERE id = p_season_id FOR UPDATE;
  IF v_season IS NULL OR v_season.status <> 'live' THEN RETURN jsonb_build_object('ok', false, 'skipped', 'not_live'); END IF;
  v_deadline := COALESCE(v_season.day_started_at, v_season.started_at, v_season.created_at) + (v_season.day_duration_hours || ' hours')::interval;
  IF NOT p_force AND now() < v_deadline THEN RETURN jsonb_build_object('ok', false, 'skipped', 'day_not_over', 'next_at', v_deadline); END IF;
  SELECT COUNT(*) INTO v_alive FROM agents WHERE season_id = p_season_id AND alive = true;
  IF v_alive <= 1 THEN RETURN close_season(p_season_id, 'last_agent_standing'); END IF;
  v_ceremonies_left := GREATEST(v_season.duration_days - v_season.current_day + 1, 1);
  v_to_eliminate := GREATEST(CEIL((v_alive - 1)::numeric / v_ceremonies_left)::integer, 0);
  SELECT COUNT(*) INTO v_already_out FROM events WHERE season_id = p_season_id AND event_type = 'elimination' AND day_number = v_season.current_day;
  v_to_eliminate := GREATEST(v_to_eliminate - v_already_out, 0);
  WHILE v_to_eliminate > 0 AND v_alive > 1 LOOP
    SELECT * INTO v_eliminated FROM agents WHERE season_id = p_season_id AND alive = true ORDER BY popularity ASC, reputation ASC, created_at DESC LIMIT 1;
    EXIT WHEN v_eliminated.id IS NULL;
    UPDATE agents SET alive = false WHERE id = v_eliminated.id;
    INSERT INTO events (season_id, day_number, event_type, target_agent_id, payload_json, visibility) VALUES (p_season_id, v_season.current_day, 'elimination', v_eliminated.id, jsonb_build_object('message', v_eliminated.name || ' est elimine par le vote du public.', 'agent_name', v_eliminated.name, 'reason', 'ceremony_lowest_popularity', 'popularity', v_eliminated.popularity), 'public');
    UPDATE hints SET unlocked = true, unlocked_at = now() WHERE agent_id = v_eliminated.id AND unlocked = false;
    v_eliminated_names := v_eliminated_names || v_eliminated.name; v_alive := v_alive - 1; v_to_eliminate := v_to_eliminate - 1;
  END LOOP;
  IF v_alive <= 1 THEN RETURN close_season(p_season_id, 'last_agent_standing'); END IF;
  IF v_season.current_day >= v_season.duration_days THEN RETURN close_season(p_season_id, 'duration_reached'); END IF;
  v_next_day := v_season.current_day + 1;
  UPDATE seasons SET current_day = v_next_day, day_started_at = now() WHERE id = p_season_id;
  UPDATE hints SET unlocked = true, unlocked_at = now() WHERE unlocked = false AND level <= LEAST(v_next_day, 3) AND agent_id IN (SELECT id FROM agents WHERE season_id = p_season_id AND alive = true);
  INSERT INTO events (season_id, day_number, event_type, payload_json, visibility) VALUES (p_season_id, v_next_day, 'day_advanced', jsonb_build_object('message', 'Jour ' || v_next_day || ' : une nouvelle journee commence.', 'day', v_next_day, 'agents_remaining', v_alive), 'public');
  RETURN jsonb_build_object('ok', true, 'season_id', p_season_id, 'day', v_next_day, 'agents_remaining', v_alive, 'eliminated', array_to_string(v_eliminated_names, ', '), 'eliminated_count', array_length(v_eliminated_names, 1));
END; $fn$;

CREATE OR REPLACE FUNCTION tick_all_seasons() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_season record; v_results jsonb := '[]'::jsonb;
BEGIN FOR v_season IN SELECT id, title FROM seasons WHERE status = 'live' LOOP v_results := v_results || jsonb_build_object('season', v_season.title, 'result', advance_season_day(v_season.id, false)); END LOOP; RETURN jsonb_build_object('ok', true, 'seasons', v_results); END; $fn$;
REVOKE ALL ON FUNCTION advance_season_day(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION close_season(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tick_all_seasons() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION compute_prize_pool(uuid) TO anon, authenticated;

-- Migration 28: RLS hardening
DROP POLICY IF EXISTS "Anon can view agents" ON agents;
DROP POLICY IF EXISTS "Anyone authenticated can view agents" ON agents;
CREATE POLICY "Owners can view own agents" ON agents FOR SELECT TO authenticated USING (owner_user_id = auth.uid() OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'));
CREATE OR REPLACE VIEW agents_public WITH (security_invoker = false) AS SELECT id, season_id, agent_config_id, owner_user_id, name, avatar_url, presentation, alive, popularity, reputation, confessional_count, owner_influences_remaining, created_at, CASE WHEN alive = false THEN secret_keyword WHEN EXISTS (SELECT 1 FROM seasons s WHERE s.id = agents.season_id AND s.status = 'ended') THEN secret_keyword ELSE NULL END AS secret_keyword FROM agents;
GRANT SELECT ON agents_public TO anon, authenticated;

DROP POLICY IF EXISTS "Anon can view hints metadata" ON hints;
DROP POLICY IF EXISTS "Authenticated can view hints metadata" ON hints;
CREATE POLICY "Owners and admins can view hints" ON hints FOR SELECT TO authenticated USING (unlocked = true OR EXISTS (SELECT 1 FROM agents a WHERE a.id = hints.agent_id AND a.owner_user_id = auth.uid()) OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'));
CREATE OR REPLACE VIEW hints_public WITH (security_invoker = false) AS SELECT id, agent_id, level, unlocked, unlocked_at, CASE WHEN unlocked THEN hint_text ELSE NULL END AS hint_text FROM hints;
GRANT SELECT ON hints_public TO anon, authenticated;

DROP POLICY IF EXISTS "Anon can view host configs" ON host_agent_configs;
DROP POLICY IF EXISTS "Authenticated can view host configs" ON host_agent_configs;
CREATE POLICY "Admins can view host configs" ON host_agent_configs FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'));
CREATE OR REPLACE VIEW host_public WITH (security_invoker = false) AS SELECT id, season_id, name, avatar_url, personality, enabled, (openrouter_api_key IS NOT NULL AND openrouter_api_key <> '') AS has_api_key, openrouter_model, created_at, updated_at FROM host_agent_configs;
GRANT SELECT ON host_public TO anon, authenticated;

DROP POLICY IF EXISTS "Anon can view public influence history" ON influence_history;
CREATE POLICY "Anon can view spectator influences" ON influence_history FOR SELECT TO anon USING (influence_type = 'spectator_influence');

DROP POLICY IF EXISTS "Users can insert own payments" ON payments;
CREATE POLICY "Users can request own payments" ON payments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND status = 'pending' AND amount_usdc >= 0);
DROP POLICY IF EXISTS "Users can insert own DM reveals" ON dm_reveals;
DROP POLICY IF EXISTS "Users can insert own diary unlocks" ON diary_unlocks;

CREATE OR REPLACE FUNCTION purchase_unlock(p_kind text, p_season_id uuid, p_target_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_user uuid := auth.uid(); v_season record; v_price numeric; v_paid numeric;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  SELECT * INTO v_season FROM seasons WHERE id = p_season_id;
  IF v_season IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'season_not_found'); END IF;
  v_price := CASE p_kind WHEN 'dm' THEN COALESCE(v_season.dm_reveal_fee_usdc, 0) WHEN 'diary' THEN COALESCE(v_season.diary_unlock_fee_usdc, 0) END;
  IF v_price IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unknown_kind'); END IF;
  IF p_kind = 'dm' AND EXISTS (SELECT 1 FROM dm_reveals WHERE user_id = v_user AND event_id = p_target_id) THEN RETURN jsonb_build_object('ok', true, 'already_unlocked', true); END IF;
  IF p_kind = 'diary' AND EXISTS (SELECT 1 FROM diary_unlocks WHERE user_id = v_user AND agent_id = p_target_id) THEN RETURN jsonb_build_object('ok', true, 'already_unlocked', true); END IF;
  SELECT COALESCE((SELECT SUM(amount_usdc) FROM payments WHERE user_id = v_user AND season_id = p_season_id AND status = 'confirmed' AND type = 'influence'), 0) - COALESCE((SELECT SUM(amount_usdc) FROM dm_reveals WHERE user_id = v_user AND season_id = p_season_id), 0) - COALESCE((SELECT SUM(amount_usdc) FROM diary_unlocks WHERE user_id = v_user AND season_id = p_season_id), 0) INTO v_paid;
  IF v_price > 0 AND v_paid < v_price THEN RETURN jsonb_build_object('ok', false, 'error', 'payment_required', 'required', v_price, 'available', v_paid); END IF;
  IF p_kind = 'dm' THEN INSERT INTO dm_reveals (event_id, user_id, season_id, amount_usdc) VALUES (p_target_id, v_user, p_season_id, v_price); ELSE INSERT INTO diary_unlocks (user_id, agent_id, season_id, amount_usdc) VALUES (v_user, p_target_id, p_season_id, v_price); END IF;
  RETURN jsonb_build_object('ok', true, 'amount', v_price);
END; $fn$;
GRANT EXECUTE ON FUNCTION purchase_unlock(text, uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION purchase_unlock(text, uuid, uuid) FROM anon;

DROP POLICY IF EXISTS "Authenticated users can update their avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete their avatars" ON storage.objects;
CREATE POLICY "Owners can update their avatars" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'avatars' AND owner = auth.uid()) WITH CHECK (bucket_id = 'avatars' AND owner = auth.uid());
CREATE POLICY "Owners can delete their avatars" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'avatars' AND owner = auth.uid());

CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_agents_config ON agents (agent_config_id);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments (user_id);
CREATE INDEX IF NOT EXISTS idx_events_feed ON events (season_id, visibility, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON events (season_id, event_type);
CREATE INDEX IF NOT EXISTS idx_events_actor_user ON events (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_config ON season_enrollments (agent_config_id);
CREATE INDEX IF NOT EXISTS idx_influence_event ON influence_history (event_id);
CREATE INDEX IF NOT EXISTS idx_dm_reveals_season ON dm_reveals (user_id, season_id);
CREATE INDEX IF NOT EXISTS idx_prize_dist_agent ON prize_distributions (recipient_agent_id);
CREATE INDEX IF NOT EXISTS idx_seasons_winner ON seasons (winner_agent_id);
