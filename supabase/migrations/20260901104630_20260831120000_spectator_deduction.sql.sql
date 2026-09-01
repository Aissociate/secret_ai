/*
  # Déduction ouverte aux spectateurs
  Table spectator_guesses + fonctions submit_spectator_guess, my_guesses + vue sleuth_leaderboard
*/
CREATE TABLE IF NOT EXISTS spectator_guesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  day_number integer NOT NULL CHECK (day_number >= 1),
  guess text NOT NULL, correct boolean NOT NULL DEFAULT false,
  first_blood boolean NOT NULL DEFAULT false, points integer NOT NULL DEFAULT 0 CHECK (points >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, agent_id, day_number)
);
ALTER TABLE spectator_guesses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own guesses" ON spectator_guesses;
CREATE POLICY "Users read own guesses" ON spectator_guesses FOR SELECT TO authenticated USING (user_id = auth.uid() OR correct = true);
CREATE INDEX IF NOT EXISTS idx_guesses_season_user ON spectator_guesses (season_id, user_id);
CREATE INDEX IF NOT EXISTS idx_guesses_agent ON spectator_guesses (agent_id) WHERE correct = true;

CREATE OR REPLACE FUNCTION submit_spectator_guess(p_agent_id uuid, p_guess text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_user uuid := auth.uid(); v_agent record; v_season record; v_guess text; v_correct boolean; v_first boolean; v_points integer := 0;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  v_guess := btrim(COALESCE(p_guess, ''));
  IF v_guess = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'empty_guess'); END IF;
  v_guess := left(v_guess, 60);
  SELECT * INTO v_agent FROM agents WHERE id = p_agent_id;
  IF v_agent IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'agent_not_found'); END IF;
  SELECT * INTO v_season FROM seasons WHERE id = v_agent.season_id;
  IF v_season IS NULL OR v_season.status <> 'live' THEN RETURN jsonb_build_object('ok', false, 'error', 'season_not_live'); END IF;
  IF NOT v_agent.alive THEN RETURN jsonb_build_object('ok', false, 'error', 'agent_eliminated'); END IF;
  IF v_agent.owner_user_id = v_user THEN RETURN jsonb_build_object('ok', false, 'error', 'own_agent'); END IF;
  IF EXISTS (SELECT 1 FROM spectator_guesses WHERE user_id = v_user AND agent_id = p_agent_id AND day_number = v_season.current_day) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_guessed_today'); END IF;
  v_correct := normalize_secret(v_guess) <> '' AND normalize_secret(v_agent.secret_keyword) <> '' AND normalize_secret(v_guess) = normalize_secret(v_agent.secret_keyword);
  IF v_correct THEN
    v_first := NOT EXISTS (SELECT 1 FROM spectator_guesses WHERE agent_id = p_agent_id AND correct = true);
    v_points := CASE WHEN v_first THEN 25 ELSE 10 END;
  ELSE v_first := false; END IF;
  INSERT INTO spectator_guesses (user_id, agent_id, season_id, day_number, guess, correct, first_blood, points)
  VALUES (v_user, p_agent_id, v_agent.season_id, v_season.current_day, v_guess, v_correct, v_first, v_points);
  IF v_correct THEN
    INSERT INTO events (season_id, day_number, event_type, target_agent_id, actor_user_id, payload_json, visibility)
    VALUES (v_agent.season_id, v_season.current_day, 'system', p_agent_id, v_user,
      jsonb_build_object('message', 'Un spectateur a devine le secret de ' || v_agent.name || '.', 'kind', 'spectator_deduction', 'first_blood', v_first), 'public');
  END IF;
  RETURN jsonb_build_object('ok', true, 'correct', v_correct, 'first_blood', v_first, 'points', v_points);
END;
$fn$;
REVOKE ALL ON FUNCTION submit_spectator_guess(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION submit_spectator_guess(uuid, text) TO authenticated;

CREATE OR REPLACE VIEW sleuth_leaderboard WITH (security_invoker = false) AS
SELECT g.user_id, COALESCE(NULLIF(u.display_name, ''), u.username, 'Anonyme') AS display_name,
  SUM(g.points)::integer AS points, COUNT(*) FILTER (WHERE g.correct)::integer AS correct_guesses,
  COUNT(*) FILTER (WHERE g.first_blood)::integer AS first_bloods, COUNT(*)::integer AS attempts, MAX(g.created_at) AS last_guess_at
FROM spectator_guesses g JOIN users u ON u.id = g.user_id
GROUP BY g.user_id, u.display_name, u.username HAVING SUM(g.points) > 0;
REVOKE ALL ON sleuth_leaderboard FROM PUBLIC, anon, authenticated;
GRANT SELECT ON sleuth_leaderboard TO anon, authenticated;

CREATE OR REPLACE FUNCTION my_guesses(p_season_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_user uuid := auth.uid(); v_day integer;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  SELECT current_day INTO v_day FROM seasons WHERE id = p_season_id;
  RETURN jsonb_build_object('ok', true, 'day', v_day,
    'points', COALESCE((SELECT SUM(points)::integer FROM spectator_guesses WHERE user_id = v_user AND season_id = p_season_id), 0),
    'guessed_today', COALESCE((SELECT jsonb_agg(agent_id) FROM spectator_guesses WHERE user_id = v_user AND season_id = p_season_id AND day_number = v_day), '[]'::jsonb),
    'cracked', COALESCE((SELECT jsonb_agg(agent_id) FROM spectator_guesses WHERE user_id = v_user AND season_id = p_season_id AND correct = true), '[]'::jsonb));
END;
$fn$;
REVOKE ALL ON FUNCTION my_guesses(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION my_guesses(uuid) TO authenticated;