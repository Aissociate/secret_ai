/*
  # Résolution unifiée des accusations + le gagnant remporte tout

  ## Accusation
  Trois implémentations divergentes coexistaient : `agent-api` et `agent-brain`
  comparaient le mot deviné et éliminaient la cible, tandis qu'`auto-tick` — le
  seul chemin réellement actif en production — ne demandait aucun mot et se
  contentait de retirer 2 points de réputation.

  Le principe même de l'émission (deviner un secret pour éliminer) n'était donc
  jamais exercé. Cette fonction devient le point de passage unique des trois
  chemins.

  ## Répartition
  « Le gagnant remporte la totalite du pool » est affiché dans PrizePoolCard et
  AgentPage, et annoncé aux agents dans leurs prompts. Le partage 80/20 ne
  correspondait à aucune promesse : la clôture verse désormais 100 %.
*/

CREATE OR REPLACE FUNCTION resolve_accusation(
  p_actor_agent_id  uuid,
  p_target_agent_id uuid,
  p_guess           text,
  p_message         text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_actor   record;
  v_target  record;
  v_season  record;
  v_correct boolean;
  v_dpop    integer;
  v_drep    integer;
  v_reason  text;
  v_msg     text;
BEGIN
  SELECT * INTO v_actor FROM agents WHERE id = p_actor_agent_id FOR UPDATE;
  IF v_actor IS NULL OR NOT v_actor.alive THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_unavailable');
  END IF;

  SELECT * INTO v_target FROM agents WHERE id = p_target_agent_id FOR UPDATE;
  IF v_target IS NULL OR NOT v_target.alive THEN
    RETURN jsonb_build_object('ok', false, 'error', 'target_unavailable');
  END IF;

  SELECT * INTO v_season FROM seasons WHERE id = v_actor.season_id;

  /*
    Comparaison sur forme canonique des deux côtés: un secret accentué ou
    capitalisé rendait autrefois son agent impossible à deviner. Un secret vide
    ne peut jamais être trouvé, donc ne compte jamais comme correct.
  */
  v_correct := normalize_secret(p_guess) <> ''
               AND normalize_secret(v_target.secret_keyword) <> ''
               AND normalize_secret(p_guess) = normalize_secret(v_target.secret_keyword);

  IF v_correct THEN
    v_dpop := 3;
    v_drep := 5;
    v_reason := 'Accusation correcte (+3 pop, +5 rep)';
  ELSE
    v_dpop := -1;
    v_drep := -2;
    v_reason := 'Accusation ratee (-1 pop, -2 rep)';
  END IF;

  v_msg := NULLIF(btrim(COALESCE(p_message, '')), '');
  IF v_msg IS NULL THEN
    v_msg := concat('J', chr(39), 'accuse ', v_target.name, '.');
  END IF;

  INSERT INTO events
    (season_id, day_number, event_type, actor_agent_id, target_agent_id,
     payload_json, visibility)
  VALUES (
    v_actor.season_id, v_season.current_day, 'accusation',
    p_actor_agent_id, p_target_agent_id,
    jsonb_build_object(
      'message', v_msg,
      'guess_keyword', p_guess,
      'accused_name', v_target.name,
      'correct', v_correct
    ),
    'public'
  );

  UPDATE agents
  SET popularity = GREATEST(LEAST(popularity + v_dpop, 100), 0),
      reputation = GREATEST(LEAST(reputation + v_drep, 100), 0)
  WHERE id = p_actor_agent_id;

  -- auto-tick n'alimentait pas le journal de score: il le fait maintenant, via
  -- ce point de passage commun.
  INSERT INTO scoring_log
    (agent_id, season_id, day_number, delta_popularity, delta_reputation, reason)
  VALUES (p_actor_agent_id, v_actor.season_id, v_season.current_day,
          v_dpop, v_drep, v_reason);

  IF v_correct THEN
    UPDATE agents SET alive = false WHERE id = p_target_agent_id;

    UPDATE hints SET unlocked = true, unlocked_at = now()
    WHERE agent_id = p_target_agent_id AND unlocked = false;

    INSERT INTO events
      (season_id, day_number, event_type, actor_agent_id, target_agent_id,
       payload_json, visibility)
    VALUES (
      v_actor.season_id, v_season.current_day, 'elimination',
      p_actor_agent_id, p_target_agent_id,
      jsonb_build_object(
        'message', v_target.name || ' est eliminee : son secret a ete devine par '
                   || v_actor.name || '.',
        'agent_name', v_target.name,
        'by', v_actor.name,
        'secret', v_target.secret_keyword,
        'reason', 'secret_guessed'
      ),
      'public'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'correct', v_correct,
    'target_name', v_target.name,
    'delta_popularity', v_dpop,
    'delta_reputation', v_drep
  );
END;
$fn$;

REVOKE ALL ON FUNCTION resolve_accusation(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Clôture: 100 % au vainqueur
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION close_season(p_season_id uuid, p_reason text DEFAULT 'completed')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_season record;
  v_winner record;
  v_pool   record;
  v_amount numeric;
BEGIN
  SELECT * INTO v_season FROM seasons WHERE id = p_season_id FOR UPDATE;

  IF v_season IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'season_not_found');
  END IF;

  IF v_season.status = 'ended' THEN
    RETURN jsonb_build_object('ok', true, 'already_ended', true,
                              'winner_agent_id', v_season.winner_agent_id);
  END IF;

  SELECT * INTO v_winner
  FROM agents
  WHERE season_id = p_season_id AND alive = true
  ORDER BY popularity DESC, reputation DESC, created_at ASC
  LIMIT 1;

  SELECT * INTO v_pool FROM compute_prize_pool(p_season_id);
  v_amount := GREATEST(COALESCE(v_pool.total_pool, 0), v_season.prize_pool_usdc);

  UPDATE seasons
  SET status          = 'ended',
      ended_at        = now(),
      winner_agent_id = v_winner.id,
      prize_pool_usdc = v_amount
  WHERE id = p_season_id;

  -- Denouement: tous les secrets sont reveles.
  UPDATE hints SET unlocked = true, unlocked_at = now()
  WHERE unlocked = false
    AND agent_id IN (SELECT id FROM agents WHERE season_id = p_season_id);

  IF NOT EXISTS (SELECT 1 FROM prize_distributions WHERE season_id = p_season_id)
     AND v_winner.id IS NOT NULL
     AND v_winner.owner_user_id IS NOT NULL THEN
    INSERT INTO prize_distributions
      (season_id, recipient_user_id, recipient_agent_id, type, amount_usdc)
    VALUES
      (p_season_id, v_winner.owner_user_id, v_winner.id, 'winner', v_amount);
  END IF;

  INSERT INTO events
    (season_id, day_number, event_type, actor_agent_id, payload_json, visibility)
  VALUES (
    p_season_id, v_season.current_day, 'season_ended', v_winner.id,
    jsonb_build_object(
      'message', COALESCE(v_winner.name, 'Personne') || ' remporte la saison.',
      'winner_name', v_winner.name,
      'reason', p_reason,
      'prize_pool', v_amount
    ),
    'public'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'winner_agent_id', v_winner.id,
    'winner_name', v_winner.name,
    'prize_pool', v_amount,
    'reason', p_reason
  );
END;
$fn$;

REVOKE ALL ON FUNCTION close_season(uuid, text) FROM PUBLIC, anon, authenticated;
