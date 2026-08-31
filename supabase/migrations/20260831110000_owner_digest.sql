/*
  # Digest : ce qui s'est passé pendant votre absence

  ## Pourquoi
  C'est la boucle de retour quotidienne du jeu. Un propriétaire ne suit pas la
  partie en continu : il revient et veut savoir ce que son IA a fait sans lui.
  Sans ce résumé, il faut relire un fil de plusieurs dizaines d'événements pour
  comprendre, et personne ne le fait.

  Le digest ne raconte pas la saison : il raconte **ses agents à lui**. C'est ce
  qui le rend lisible en trois lignes, et racontable.

  ## Portée
  La fonction s'exécute pour l'appelant (`auth.uid()`) et ne révèle rien qu'il
  ne puisse déjà voir : contenu public, plus ce qui concerne ses propres agents.
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

  -- Fenêtre par défaut: la dernière journée de jeu.
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

    -- Etat courant de chaque agent du proprietaire.
    'agents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id,
        'name', a.name,
        'alive', a.alive,
        'popularity', a.popularity,
        'reputation', a.reputation,
        'influences_left', a.owner_influences_remaining
      ) ORDER BY a.name)
      FROM agents a WHERE a.id = ANY(v_agents)
    ), '[]'::jsonb),

    -- Ce que ses agents ont fait.
    'acted', (
      SELECT COUNT(*) FROM events e
      WHERE e.season_id = p_season_id
        AND e.created_at > v_since
        AND e.actor_agent_id = ANY(v_agents)
    ),

    -- Ce qu'ils ont subi: accusations recues.
    'accused_by_others', (
      SELECT COUNT(*) FROM events e
      WHERE e.season_id = p_season_id
        AND e.created_at > v_since
        AND e.event_type = 'accusation'
        AND e.target_agent_id = ANY(v_agents)
    ),

    -- Eliminations prononcees par ses agents: le fait marquant a raconter.
    'eliminations_by', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'target', e.payload_json->>'agent_name',
        'secret', e.payload_json->>'secret',
        'at', e.created_at
      ) ORDER BY e.created_at DESC)
      FROM events e
      WHERE e.season_id = p_season_id
        AND e.created_at > v_since
        AND e.event_type = 'elimination'
        AND e.actor_agent_id = ANY(v_agents)
    ), '[]'::jsonb),

    -- Un de ses agents est-il tombe ?
    'eliminated_own', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', e.payload_json->>'agent_name',
        'reason', e.payload_json->>'reason',
        'at', e.created_at
      ) ORDER BY e.created_at DESC)
      FROM events e
      WHERE e.season_id = p_season_id
        AND e.created_at > v_since
        AND e.event_type = 'elimination'
        AND e.target_agent_id = ANY(v_agents)
    ), '[]'::jsonb),

    -- Indices de ses agents devenus publics: c'est ce qui le met en danger.
    'hints_revealed', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'level', e.payload_json->>'level',
        'at', e.created_at
      ) ORDER BY e.created_at DESC)
      FROM events e
      WHERE e.season_id = p_season_id
        AND e.created_at > v_since
        AND e.event_type = 'hint_reveal'
        AND e.target_agent_id = ANY(v_agents)
    ), '[]'::jsonb),

    -- Combien d'agents restent en lice, pour situer l'enjeu.
    'agents_remaining', (
      SELECT COUNT(*) FROM agents WHERE season_id = p_season_id AND alive = true
    ),

    'day_advanced', EXISTS (
      SELECT 1 FROM events e
      WHERE e.season_id = p_season_id
        AND e.created_at > v_since
        AND e.event_type = 'day_advanced'
    )
  ) INTO v_result;

  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION owner_digest(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION owner_digest(uuid, timestamptz) TO authenticated;
