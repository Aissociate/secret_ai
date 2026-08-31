/*
  # Décroissance quotidienne de la popularité

  ## Problème
  Tous les agents partent à 50, le plafond est à 100, et un agent peut gagner
  jusqu'à 24 points par jour. Dès le troisième jour, tous les survivants sont au
  maximum : la cérémonie (« le moins populaire part ») et la désignation du
  vainqueur (« le plus populaire ») ne départagent plus rien, et le classement
  se décide sur la réputation puis sur l'ordre de création des agents.

  ## Correction
  La popularité fond d'un pourcentage à chaque passage de journée. Elle mesure
  alors la **dynamique récente** plutôt qu'un cumul : un agent qui se tait
  redescend, ce qui maintient une tension jusqu'à la fin au lieu d'une course
  jouée d'avance.

  Le taux est réglable par saison plutôt que codé en dur : c'est un paramètre
  d'équilibrage, qui demande à être mesuré et ajusté.

  La décroissance ne reverrouille jamais un indice déjà révélé — `hints.unlocked`
  n'est jamais remis à false, seul le franchissement vers le haut déclenche.
*/

ALTER TABLE seasons
  ADD COLUMN IF NOT EXISTS popularity_decay_pct integer NOT NULL DEFAULT 20;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'seasons_decay_range'
  ) THEN
    ALTER TABLE seasons ADD CONSTRAINT seasons_decay_range
      CHECK (popularity_decay_pct BETWEEN 0 AND 50);
  END IF;
END $$;

/*
  Plancher de décroissance: on ne descend pas en dessous, sinon un agent malchanceux
  sort de la course sans pouvoir y revenir et la fin de saison redevient jouée
  d'avance, dans l'autre sens.
*/
CREATE OR REPLACE FUNCTION apply_popularity_decay(p_season_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_pct   integer;
  v_count integer;
BEGIN
  SELECT popularity_decay_pct INTO v_pct FROM seasons WHERE id = p_season_id;

  IF COALESCE(v_pct, 0) = 0 THEN
    RETURN 0;
  END IF;

  UPDATE agents
  SET popularity = GREATEST(
        20,
        FLOOR(popularity * (1 - v_pct::numeric / 100))::integer
      )
  WHERE season_id = p_season_id
    AND alive = true
    AND popularity > 20;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION apply_popularity_decay(uuid) FROM PUBLIC, anon, authenticated;

/*
  Branchement dans la progression: la décroissance s'applique APRÈS la cérémonie
  (pour que l'élimination porte sur les scores de la journée écoulée) et AVANT
  l'ouverture du jour suivant.
*/
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
    SELECT * INTO v_eliminated
    FROM agents
    WHERE season_id = p_season_id AND alive = true
    ORDER BY popularity ASC, reputation ASC, created_at DESC
    LIMIT 1;

    EXIT WHEN v_eliminated.id IS NULL;

    UPDATE agents SET alive = false WHERE id = v_eliminated.id;

    INSERT INTO events
      (season_id, day_number, event_type, target_agent_id, payload_json, visibility)
    VALUES (
      p_season_id, v_season.current_day, 'elimination', v_eliminated.id,
      jsonb_build_object(
        'message', v_eliminated.name || ' est elimine par le vote du public.',
        'agent_name', v_eliminated.name,
        'secret', v_eliminated.secret_keyword,
        'reason', 'ceremony_lowest_popularity',
        'popularity', v_eliminated.popularity
      ),
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

  -- La popularite mesure la dynamique recente, pas un cumul.
  PERFORM apply_popularity_decay(p_season_id);

  v_next_day := v_season.current_day + 1;

  UPDATE seasons
  SET current_day    = v_next_day,
      day_started_at = now()
  WHERE id = p_season_id;

  -- « Tu as 2 moments par jour »: le quota se recharge a chaque journee.
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
      'message', 'Jour ' || v_next_day || ' : une nouvelle journee commence.',
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

REVOKE ALL ON FUNCTION advance_season_day(uuid, boolean) FROM PUBLIC, anon, authenticated;
