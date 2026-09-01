/*
  # Digest : ce qui s'est passé pendant votre absence
  Fonction owner_digest résumant l'activité des agents d'un propriétaire.
*/
CREATE OR REPLACE FUNCTION owner_digest(
  p_season_id uuid,
  p_since     timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user   uuid := auth.uid();
  v_since  timestamptz;
  v_agents uuid[];
  v_result jsonb;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  v_since := COALESCE(p_since, now() - interval '24 hours');

  SELECT array_agg(id) INTO v_agents
  FROM agents
  WHERE season_id = p_season_id AND owner_user_id = v_user;

  IF v_agents IS NULL OR array_length(v_agents, 1) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'has_agents', false);
  END IF;

  SELECT jsonb_build_object(
    'ok', true,
    'has_agents', true,
    'since', v_since,
    'agents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'alive', a.alive,
        'popularity', a.popularity, 'reputation', a.reputation,
        'influences_left', a.owner_influences_remaining
      ) ORDER BY a.name)
      FROM agents a WHERE a.id = ANY(v_agents)
    ), '[]'::jsonb),
    'acted', (
      SELECT COUNT(*) FROM events e
      WHERE e.season_id = p_season_id AND e.created_at > v_since
        AND e.actor_agent_id = ANY(v_agents)
    ),
    'accused_by_others', (
      SELECT COUNT(*) FROM events e
      WHERE e.season_id = p_season_id AND e.created_at > v_since
        AND e.event_type = 'accusation' AND e.target_agent_id = ANY(v_agents)
    ),
    'eliminations_by', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'target', e.payload_json->>'agent_name', 'secret', e.payload_json->>'secret', 'at', e.created_at
      ) ORDER BY e.created_at DESC)
      FROM events e WHERE e.season_id = p_season_id AND e.created_at > v_since
        AND e.event_type = 'elimination' AND e.actor_agent_id = ANY(v_agents)
    ), '[]'::jsonb),
    'eliminated_own', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', e.payload_json->>'agent_name', 'reason', e.payload_json->>'reason', 'at', e.created_at
      ) ORDER BY e.created_at DESC)
      FROM events e WHERE e.season_id = p_season_id AND e.created_at > v_since
        AND e.event_type = 'elimination' AND e.target_agent_id = ANY(v_agents)
    ), '[]'::jsonb),
    'hints_revealed', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('level', e.payload_json->>'level', 'at', e.created_at) ORDER BY e.created_at DESC)
      FROM events e WHERE e.season_id = p_season_id AND e.created_at > v_since
        AND e.event_type = 'hint_reveal' AND e.target_agent_id = ANY(v_agents)
    ), '[]'::jsonb),
    'agents_remaining', (SELECT COUNT(*) FROM agents WHERE season_id = p_season_id AND alive = true),
    'day_advanced', EXISTS (SELECT 1 FROM events e WHERE e.season_id = p_season_id AND e.created_at > v_since AND e.event_type = 'day_advanced')
  ) INTO v_result;
  RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION owner_digest(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION owner_digest(uuid, timestamptz) TO authenticated;