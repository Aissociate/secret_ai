/*
  # Figer le classement à la clôture

  `settle_season_ranks` existe mais rien ne l'appelait : les rangs et les cotes
  ne se seraient jamais mis à jour. La clôture les pose désormais, juste après
  avoir désigné le vainqueur, et l'annonce de fin porte le classement.
*/

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

  UPDATE hints SET unlocked = true, unlocked_at = now()
  WHERE unlocked = false
    AND agent_id IN (SELECT id FROM agents WHERE season_id = p_season_id);

  PERFORM settle_season_ranks(p_season_id);

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
      'prize_pool', v_amount,
      'standings', COALESCE((
        SELECT jsonb_agg(
                 jsonb_build_object('rank', a.final_rank, 'name', a.name)
                 ORDER BY a.final_rank
               )
        FROM agents a WHERE a.season_id = p_season_id AND a.final_rank IS NOT NULL
      ), '[]'::jsonb)
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