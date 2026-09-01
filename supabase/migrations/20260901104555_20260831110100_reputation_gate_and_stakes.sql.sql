/*
  # La réputation devient un droit, et la cagnotte se ressent
  - Seuil de réputation minimum pour accuser
  - resolve_accusation enrichi avec contrôle de réputation
  - ceremony_elimination_payload announce l'enjeu
*/
ALTER TABLE seasons
  ADD COLUMN IF NOT EXISTS min_reputation_to_accuse integer NOT NULL DEFAULT 30;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seasons_min_rep_range') THEN
    ALTER TABLE seasons ADD CONSTRAINT seasons_min_rep_range CHECK (min_reputation_to_accuse BETWEEN 0 AND 100);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION resolve_accusation(
  p_actor_agent_id  uuid, p_target_agent_id uuid, p_guess text, p_message text DEFAULT ''
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_actor record; v_target record; v_season record;
  v_correct boolean; v_dpop integer; v_drep integer; v_reason text; v_msg text;
  v_pool numeric; v_alive integer;
BEGIN
  SELECT * INTO v_actor FROM agents WHERE id = p_actor_agent_id FOR UPDATE;
  IF v_actor IS NULL OR NOT v_actor.alive THEN RETURN jsonb_build_object('ok', false, 'error', 'actor_unavailable'); END IF;
  SELECT * INTO v_target FROM agents WHERE id = p_target_agent_id FOR UPDATE;
  IF v_target IS NULL OR NOT v_target.alive THEN RETURN jsonb_build_object('ok', false, 'error', 'target_unavailable'); END IF;
  SELECT * INTO v_season FROM seasons WHERE id = v_actor.season_id;
  IF v_actor.reputation < COALESCE(v_season.min_reputation_to_accuse, 0) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reputation_too_low', 'reputation', v_actor.reputation, 'required', v_season.min_reputation_to_accuse);
  END IF;
  v_correct := normalize_secret(p_guess) <> '' AND normalize_secret(v_target.secret_keyword) <> '' AND normalize_secret(p_guess) = normalize_secret(v_target.secret_keyword);
  IF v_correct THEN v_dpop := 3; v_drep := 5; v_reason := 'Accusation correcte (+3 pop, +5 rep)';
  ELSE v_dpop := -1; v_drep := -2; v_reason := 'Accusation ratee (-1 pop, -2 rep)'; END IF;
  v_msg := NULLIF(btrim(COALESCE(p_message, '')), '');
  IF v_msg IS NULL THEN v_msg := concat('J', chr(39), 'accuse ', v_target.name, '.'); END IF;
  INSERT INTO events (season_id, day_number, event_type, actor_agent_id, target_agent_id, payload_json, visibility)
  VALUES (v_actor.season_id, v_season.current_day, 'accusation', p_actor_agent_id, p_target_agent_id,
    jsonb_build_object('message', v_msg, 'guess_keyword', p_guess, 'accused_name', v_target.name, 'correct', v_correct), 'public');
  UPDATE agents SET popularity = GREATEST(LEAST(popularity + v_dpop, 100), 0), reputation = GREATEST(LEAST(reputation + v_drep, 100), 0) WHERE id = p_actor_agent_id;
  INSERT INTO scoring_log (agent_id, season_id, day_number, delta_popularity, delta_reputation, reason)
  VALUES (p_actor_agent_id, v_actor.season_id, v_season.current_day, v_dpop, v_drep, v_reason);
  IF v_correct THEN
    UPDATE agents SET alive = false WHERE id = p_target_agent_id;
    UPDATE hints SET unlocked = true, unlocked_at = now() WHERE agent_id = p_target_agent_id AND unlocked = false;
    SELECT COUNT(*) INTO v_alive FROM agents WHERE season_id = v_actor.season_id AND alive = true;
    SELECT GREATEST(COALESCE(total_pool, 0), v_season.prize_pool_usdc) INTO v_pool FROM compute_prize_pool(v_actor.season_id);
    INSERT INTO events (season_id, day_number, event_type, actor_agent_id, target_agent_id, payload_json, visibility)
    VALUES (v_actor.season_id, v_season.current_day, 'elimination', p_actor_agent_id, p_target_agent_id,
      jsonb_build_object('message', v_target.name || ' est eliminee : son secret a ete devine par ' || v_actor.name || '.',
        'agent_name', v_target.name, 'by', v_actor.name, 'secret', v_target.secret_keyword, 'reason', 'secret_guessed',
        'agents_remaining', v_alive, 'prize_pool', v_pool), 'public');
  END IF;
  RETURN jsonb_build_object('ok', true, 'correct', v_correct, 'target_name', v_target.name, 'delta_popularity', v_dpop, 'delta_reputation', v_drep);
END;
$fn$;
REVOKE ALL ON FUNCTION resolve_accusation(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION ceremony_elimination_payload(p_season_id uuid, p_agent agents)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_alive integer; v_pool numeric; v_base numeric;
BEGIN
  SELECT COUNT(*) INTO v_alive FROM agents WHERE season_id = p_season_id AND alive = true;
  SELECT prize_pool_usdc INTO v_base FROM seasons WHERE id = p_season_id;
  SELECT GREATEST(COALESCE(total_pool, 0), COALESCE(v_base, 0)) INTO v_pool FROM compute_prize_pool(p_season_id);
  RETURN jsonb_build_object('message', p_agent.name || ' est elimine par le vote du public.',
    'agent_name', p_agent.name, 'secret', p_agent.secret_keyword, 'reason', 'ceremony_lowest_popularity',
    'popularity', p_agent.popularity, 'agents_remaining', GREATEST(v_alive, 0), 'prize_pool', v_pool);
END;
$fn$;
REVOKE ALL ON FUNCTION ceremony_elimination_payload(uuid, agents) FROM PUBLIC, anon, authenticated;