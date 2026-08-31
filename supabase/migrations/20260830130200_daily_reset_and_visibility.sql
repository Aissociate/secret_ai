/*
  # Remise à zéro quotidienne + visibilité du remplissage

  ## Influences du propriétaire
  L'interface annonce « Tu as 2 moments par jour ». La colonne
  `owner_influences_remaining` était pourtant fixée à 2 au lancement et plus
  jamais touchée : le quota était en pratique illimité, et le compteur affichait
  éternellement 2/2. La migration d'origine annonçait « reset each day (handled
  by edge function) » — aucune fonction ne le faisait.

  ## Remplissage d'une saison
  Le compteur de places lit `season_enrollments`, dont aucune policy n'autorise
  la lecture globale : un visiteur voyait toujours 0 / 6, un propriétaire
  uniquement ses propres inscriptions. Personne ne pouvait donc savoir qu'une
  saison allait démarrer. Une vue agrégée expose le décompte sans révéler qui
  s'est inscrit.
*/

-- ---------------------------------------------------------------------------
-- 1. Le passage au jour suivant recharge les influences
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

  /*
    Rythme adaptatif: avec plus d'agents que de jours, une élimination par jour
    laisserait plusieurs finalistes départagés au classement. On répartit les
    départs restants sur les cérémonies restantes pour que la finale se joue
    toujours à un contre un.
  */
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

  v_next_day := v_season.current_day + 1;

  UPDATE seasons
  SET current_day    = v_next_day,
      day_started_at = now()
  WHERE id = p_season_id;

  /*
    « Tu as 2 moments par jour » : le quota se recharge à chaque nouvelle
    journée, pour tous les agents encore en lice.
  */
  UPDATE agents
  SET owner_influences_remaining = 2
  WHERE season_id = p_season_id AND alive = true;

  /*
    Les indices se débloquent par palier de popularité (60 / 80 / 95), pas par
    jour. On repasse néanmoins sur les agents vivants à chaque journée pour
    rattraper un éventuel palier franchi hors trigger.
  */
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

-- ---------------------------------------------------------------------------
-- 2. Décompte des inscriptions, visible de tous
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW season_fill
WITH (security_invoker = false) AS
SELECT
  s.id AS season_id,
  s.max_agents,
  COUNT(e.id) FILTER (WHERE COALESCE(e.status, 'accepted') <> 'rejected')::integer
    AS enrolled_count
FROM seasons s
LEFT JOIN season_enrollments e ON e.season_id = s.id
GROUP BY s.id, s.max_agents;

REVOKE ALL ON season_fill FROM PUBLIC, anon, authenticated;
GRANT SELECT ON season_fill TO anon, authenticated;
