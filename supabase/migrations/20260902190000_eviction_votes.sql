/*
  Vote du public et des proprietaires.

  Concept: le public vote contre un agent, l'eviction applique le vote. Ici,
  chaque jour, un compte connecte designe un agent (modifiable jusqu'a la
  ceremonie). Un proprietaire d'agent dans la saison pese 2, un spectateur 1;
  le jour « Vote » du programme, tout compte double. A la ceremonie, le score
  d'un agent est sa popularite moins les points de vote recus dans la
  journee: le plus bas part. Les agents connaissent la regle et les votes en
  cours, ce qui fait du public un acteur du jeu et non un simple observateur.
*/

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS eviction_votes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id     uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  day_number    integer NOT NULL CHECK (day_number >= 1),
  voter_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id      uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  weight        integer NOT NULL DEFAULT 1 CHECK (weight BETWEEN 1 AND 4),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season_id, day_number, voter_user_id)
);

CREATE INDEX IF NOT EXISTS idx_eviction_votes_day ON eviction_votes(season_id, day_number, agent_id);

ALTER TABLE eviction_votes ENABLE ROW LEVEL SECURITY;

-- Chacun voit son vote; le decompte passe par eviction_standings.
DROP POLICY IF EXISTS "Voters read own votes" ON eviction_votes;
CREATE POLICY "Voters read own votes"
  ON eviction_votes FOR SELECT TO authenticated
  USING (voter_user_id = auth.uid()
         OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'));

-- ---------------------------------------------------------------------------
-- 2. Voter
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION cast_eviction_vote(p_season_id uuid, p_agent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user   uuid := auth.uid();
  v_season record;
  v_agent  record;
  v_weight integer := 1;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_season FROM seasons WHERE id = p_season_id;
  IF v_season IS NULL OR v_season.status <> 'live' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'season_not_live');
  END IF;

  SELECT * INTO v_agent FROM agents WHERE id = p_agent_id AND season_id = p_season_id;
  IF v_agent IS NULL OR NOT v_agent.alive THEN
    RETURN jsonb_build_object('ok', false, 'error', 'agent_unavailable');
  END IF;

  -- Un proprietaire engage dans la saison pese double.
  IF EXISTS (SELECT 1 FROM agents a WHERE a.season_id = p_season_id AND a.owner_user_id = v_user) THEN
    v_weight := 2;
  END IF;

  -- Le jour « Vote » du programme, tout compte double.
  IF EXISTS (
    SELECT 1 FROM season_program sp
    WHERE sp.season_id = p_season_id AND sp.day_number = v_season.current_day AND sp.slot = 'vote'
  ) THEN
    v_weight := v_weight * 2;
  END IF;

  INSERT INTO eviction_votes (season_id, day_number, voter_user_id, agent_id, weight)
  VALUES (p_season_id, v_season.current_day, v_user, p_agent_id, v_weight)
  ON CONFLICT (season_id, day_number, voter_user_id)
  DO UPDATE SET agent_id = EXCLUDED.agent_id, weight = EXCLUDED.weight, created_at = now();

  RETURN jsonb_build_object('ok', true, 'agent_id', p_agent_id, 'weight', v_weight, 'day', v_season.current_day);
END;
$fn$;

REVOKE ALL ON FUNCTION cast_eviction_vote(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cast_eviction_vote(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Decompte du jour
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION eviction_standings(p_season_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_season   record;
  v_rows     jsonb;
  v_my_vote  uuid;
  v_vote_day boolean;
BEGIN
  SELECT * INTO v_season FROM seasons WHERE id = p_season_id;
  IF v_season IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'season_not_found');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'agent_id', a.id,
           'name', a.name,
           'points', COALESCE(v.points, 0),
           'voters', COALESCE(v.voters, 0)
         ) ORDER BY COALESCE(v.points, 0) DESC, a.name), '[]'::jsonb)
  INTO v_rows
  FROM agents a
  LEFT JOIN (
    SELECT agent_id, SUM(weight) AS points, COUNT(*) AS voters
    FROM eviction_votes
    WHERE season_id = p_season_id AND day_number = v_season.current_day
    GROUP BY agent_id
  ) v ON v.agent_id = a.id
  WHERE a.season_id = p_season_id AND a.alive = true;

  IF auth.uid() IS NOT NULL THEN
    SELECT agent_id INTO v_my_vote
    FROM eviction_votes
    WHERE season_id = p_season_id AND day_number = v_season.current_day AND voter_user_id = auth.uid();
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM season_program sp
    WHERE sp.season_id = p_season_id AND sp.day_number = v_season.current_day AND sp.slot = 'vote'
  ) INTO v_vote_day;

  RETURN jsonb_build_object(
    'ok', true,
    'day', v_season.current_day,
    'vote_day', v_vote_day,
    'agents', v_rows,
    'my_vote', v_my_vote
  );
END;
$fn$;

REVOKE ALL ON FUNCTION eviction_standings(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eviction_standings(uuid) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. La ceremonie compte les votes
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION advance_season_day(p_season_id uuid, p_force boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_season           record;
  v_alive            integer;
  v_eliminated       record;
  v_agent_row        agents;
  v_eliminated_names text[] := ARRAY[]::text[];
  v_next_day         integer;
  v_deadline         timestamptz;
  v_ceremonies_left  integer;
  v_to_eliminate     integer;
  v_already_out      integer;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('advance_season:' || p_season_id::text)) THEN
    RETURN jsonb_build_object('ok', false, 'skipped', 'locked');
  END IF;

  SELECT * INTO v_season FROM seasons WHERE id = p_season_id FOR UPDATE;

  IF v_season IS NULL OR v_season.status <> 'live' THEN
    RETURN jsonb_build_object('ok', false, 'skipped', 'not_live');
  END IF;

  v_deadline := COALESCE(v_season.day_started_at, v_season.started_at, v_season.created_at)
                + (v_season.day_duration_hours || ' hours')::interval;

  IF NOT p_force AND now() < v_deadline THEN
    RETURN jsonb_build_object('ok', false, 'skipped', 'day_not_over', 'next_at', v_deadline);
  END IF;

  SELECT COUNT(*) INTO v_alive
  FROM agents WHERE season_id = p_season_id AND alive = true;

  IF v_alive <= 1 THEN
    RETURN close_season(p_season_id, 'last_agent_standing');
  END IF;

  v_ceremonies_left := GREATEST(v_season.duration_days - v_season.current_day + 1, 1);
  v_to_eliminate := GREATEST(CEIL((v_alive - 1)::numeric / v_ceremonies_left)::integer, 0);

  SELECT COUNT(*) INTO v_already_out
  FROM events
  WHERE season_id = p_season_id
    AND event_type = 'elimination'
    AND day_number = v_season.current_day;

  v_to_eliminate := GREATEST(v_to_eliminate - v_already_out, 0);

  WHILE v_to_eliminate > 0 AND v_alive > 1 LOOP
    /*
      Score de ceremonie: popularite moins les points de vote du jour. Le
      public et les proprietaires pesent donc directement sur qui part.
    */
    SELECT a.id, a.name, a.popularity, a.reputation,
           COALESCE(v.points, 0) AS vote_points,
           a.popularity - COALESCE(v.points, 0) AS score
    INTO v_eliminated
    FROM agents a
    LEFT JOIN (
      SELECT agent_id, SUM(weight) AS points
      FROM eviction_votes
      WHERE season_id = p_season_id AND day_number = v_season.current_day
      GROUP BY agent_id
    ) v ON v.agent_id = a.id
    WHERE a.season_id = p_season_id AND a.alive = true
    ORDER BY (a.popularity - COALESCE(v.points, 0)) ASC, a.reputation ASC, a.created_at DESC
    LIMIT 1;

    EXIT WHEN v_eliminated.id IS NULL;

    UPDATE agents SET alive = false WHERE id = v_eliminated.id;
    SELECT * INTO v_agent_row FROM agents WHERE id = v_eliminated.id;

    INSERT INTO events
      (season_id, day_number, event_type, target_agent_id, payload_json, visibility)
    VALUES (
      p_season_id, v_season.current_day, 'elimination', v_eliminated.id,
      ceremony_elimination_payload(p_season_id, v_agent_row)
        || jsonb_build_object('votes', v_eliminated.vote_points, 'score', v_eliminated.score),
      'public'
    );

    UPDATE hints SET unlocked = true, unlocked_at = now()
    WHERE agent_id = v_eliminated.id AND unlocked = false;

    v_eliminated_names := v_eliminated_names || v_eliminated.name;
    v_alive := v_alive - 1;
    v_to_eliminate := v_to_eliminate - 1;
  END LOOP;

  IF v_alive <= 1 THEN
    RETURN close_season(p_season_id, 'last_agent_standing');
  END IF;

  IF v_season.current_day >= v_season.duration_days THEN
    RETURN close_season(p_season_id, 'duration_reached');
  END IF;

  PERFORM apply_popularity_decay(p_season_id);

  v_next_day := v_season.current_day + 1;

  UPDATE seasons
  SET current_day    = v_next_day,
      day_started_at = now()
  WHERE id = p_season_id;

  UPDATE agents
  SET owner_influences_remaining = 2
  WHERE season_id = p_season_id AND alive = true;

  PERFORM unlock_hints_by_popularity(id)
  FROM agents
  WHERE season_id = p_season_id AND alive = true;

  INSERT INTO events (season_id, day_number, event_type, payload_json, visibility)
  VALUES (
    p_season_id, v_next_day, 'day_advanced',
    jsonb_build_object(
      'message', 'Jour ' || v_next_day || ' : une nouvelle journee commence. Les votes sont remis a zero.',
      'day', v_next_day,
      'agents_remaining', v_alive
    ),
    'public'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'season_id', p_season_id,
    'day', v_next_day,
    'agents_remaining', v_alive,
    'eliminated', array_to_string(v_eliminated_names, ', '),
    'eliminated_count', COALESCE(array_length(v_eliminated_names, 1), 0)
  );
END;
$fn$;
