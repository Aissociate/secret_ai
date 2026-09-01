/*
  # Défi nominatif
  Table agent_challenges + fonctions create_challenge, view_challenge, accept_challenge
*/
CREATE TABLE IF NOT EXISTS agent_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(12), 'hex'),
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  from_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_config_id uuid NOT NULL REFERENCES agent_configs(id) ON DELETE CASCADE,
  message text NOT NULL DEFAULT '',
  accepted_count integer NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE agent_challenges ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_challenges_season ON agent_challenges (season_id);

CREATE OR REPLACE FUNCTION create_challenge(p_config_id uuid, p_max_agents integer DEFAULT 6, p_message text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_user uuid := auth.uid(); v_config record; v_season_id uuid; v_token text; v_max integer;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  SELECT * INTO v_config FROM agent_configs WHERE id = p_config_id AND owner_user_id = v_user;
  IF v_config IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_your_agent'); END IF;
  IF NOT v_config.ready THEN RETURN jsonb_build_object('ok', false, 'error', 'agent_not_ready'); END IF;
  v_max := LEAST(GREATEST(COALESCE(p_max_agents, 6), 2), 12);
  INSERT INTO seasons (title, status, max_agents, max_agents_per_owner, current_day)
  VALUES (COALESCE(NULLIF(btrim(v_config.name), ''), 'Un agent') || ' lance un defi', 'draft', v_max, 1, 1)
  RETURNING id INTO v_season_id;
  INSERT INTO season_enrollments (season_id, agent_config_id, owner_user_id, status) VALUES (v_season_id, p_config_id, v_user, 'pending');
  INSERT INTO agent_challenges (season_id, from_user_id, from_config_id, message)
  VALUES (v_season_id, v_user, p_config_id, left(btrim(COALESCE(p_message, '')), 240)) RETURNING token INTO v_token;
  RETURN jsonb_build_object('ok', true, 'token', v_token, 'season_id', v_season_id, 'max_agents', v_max);
END;
$fn$;
REVOKE ALL ON FUNCTION create_challenge(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_challenge(uuid, integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION view_challenge(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_ch record; v_season record; v_count integer;
BEGIN
  SELECT * INTO v_ch FROM agent_challenges WHERE token = p_token;
  IF v_ch IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF v_ch.expires_at < now() THEN RETURN jsonb_build_object('ok', false, 'error', 'expired'); END IF;
  SELECT * INTO v_season FROM seasons WHERE id = v_ch.season_id;
  SELECT COUNT(*) INTO v_count FROM season_enrollments WHERE season_id = v_ch.season_id AND COALESCE(status, 'accepted') <> 'rejected';
  RETURN jsonb_build_object('ok', true, 'token', v_ch.token, 'season_id', v_ch.season_id, 'season_status', v_season.status,
    'message', v_ch.message, 'max_agents', v_season.max_agents, 'enrolled', v_count,
    'challenger', (SELECT jsonb_build_object('name', c.name, 'avatar_url', c.avatar_url, 'config_id', c.id, 'rating', c.rating) FROM agent_configs c WHERE c.id = v_ch.from_config_id));
END;
$fn$;
REVOKE ALL ON FUNCTION view_challenge(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION view_challenge(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION accept_challenge(p_token text, p_config_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_user uuid := auth.uid(); v_ch record; v_season record; v_config record; v_count integer;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  SELECT * INTO v_ch FROM agent_challenges WHERE token = p_token FOR UPDATE;
  IF v_ch IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF v_ch.expires_at < now() THEN RETURN jsonb_build_object('ok', false, 'error', 'expired'); END IF;
  SELECT * INTO v_season FROM seasons WHERE id = v_ch.season_id FOR UPDATE;
  IF v_season.status <> 'draft' THEN RETURN jsonb_build_object('ok', false, 'error', 'season_already_started', 'season_id', v_ch.season_id); END IF;
  SELECT * INTO v_config FROM agent_configs WHERE id = p_config_id AND owner_user_id = v_user;
  IF v_config IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_your_agent'); END IF;
  IF NOT v_config.ready THEN RETURN jsonb_build_object('ok', false, 'error', 'agent_not_ready'); END IF;
  IF EXISTS (SELECT 1 FROM season_enrollments WHERE season_id = v_ch.season_id AND owner_user_id = v_user) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_enrolled', 'season_id', v_ch.season_id); END IF;
  SELECT COUNT(*) INTO v_count FROM season_enrollments WHERE season_id = v_ch.season_id AND COALESCE(status, 'accepted') <> 'rejected';
  IF v_count >= v_season.max_agents THEN RETURN jsonb_build_object('ok', false, 'error', 'season_full'); END IF;
  INSERT INTO season_enrollments (season_id, agent_config_id, owner_user_id, status) VALUES (v_ch.season_id, p_config_id, v_user, 'pending');
  UPDATE agent_challenges SET accepted_count = accepted_count + 1 WHERE id = v_ch.id;
  RETURN jsonb_build_object('ok', true, 'season_id', v_ch.season_id, 'enrolled', v_count + 1, 'max_agents', v_season.max_agents);
END;
$fn$;
REVOKE ALL ON FUNCTION accept_challenge(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION accept_challenge(text, uuid) TO authenticated;