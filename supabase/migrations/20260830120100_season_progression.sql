/*
  # Progression et cloture de saison

  ## Contexte
  Aucun code ne faisait progresser ni terminer une saison: `current_day` restait
  a 1, `status` ne passait jamais a 'ended', et `winner_agent_id` /
  `prize_distributions` n'etaient jamais renseignes.

  Consequences observees:
  - les quotas journaliers ne se reinitialisaient jamais, donc la saison se
    figeait silencieusement en `daily_limit_reached` apres ~20 messages;
  - le prize pool affiche aux agents n'etait jamais distribue;
  - une partie ne pouvait structurellement pas aller au bout.

  ## Contenu
  - `compute_prize_pool()` : source de verite unique du calcul de cagnotte
  - `close_season()` : designation du vainqueur + ecriture des distributions
  - `advance_season_day()` : passage au jour suivant avec ceremonie d'elimination

  Les deux dernieres sont idempotentes (advisory lock + verification d'etat), de
  sorte que deux crons simultanes ne peuvent pas sauter deux jours.
*/

-- ---------------------------------------------------------------------------
-- Calcul unique du prize pool
-- ---------------------------------------------------------------------------

/*
  Quatre formules divergentes coexistaient (trigger DB, agent-brain, auto-tick,
  simulate-season), avec des taux de commission differents et un Math.max qui
  empechait les revenus d'influence de remonter dans le montant affiche.
*/
CREATE OR REPLACE FUNCTION compute_prize_pool(p_season_id uuid)
RETURNS TABLE (
  entry_revenue       numeric,
  influence_revenue   numeric,
  platform_fee_amount numeric,
  total_pool          numeric,
  participants_count  integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  WITH s AS (
    SELECT platform_fee_pct, prize_pool_usdc FROM seasons WHERE id = p_season_id
  ),
  p AS (
    SELECT
      COALESCE(SUM(amount_usdc) FILTER (WHERE type = 'entry'), 0)     AS entries,
      COALESCE(SUM(amount_usdc) FILTER (WHERE type = 'influence'), 0) AS influences,
      COUNT(DISTINCT user_id) FILTER (WHERE type = 'entry')           AS participants
    FROM payments
    WHERE season_id = p_season_id AND status = 'confirmed'
  )
  SELECT
    p.entries,
    p.influences,
    ROUND((p.entries + p.influences) * s.platform_fee_pct / 100.0, 6),
    /*
      La cagnotte garantie au lancement (max_agents x entry_fee moins la
      commission, ecrite dans seasons.prize_pool_usdc) sert de plancher: aucun
      chemin applicatif ne confirme encore de paiement, et sans ce plancher le
      total affiche serait 0 sur toute saison reelle.
    */
    GREATEST(
      ROUND((p.entries + p.influences) * (1 - s.platform_fee_pct / 100.0), 6),
      COALESCE(s.prize_pool_usdc, 0)
    ),
    p.participants::integer
  FROM p, s;
$fn$;

-- ---------------------------------------------------------------------------
-- Cloture
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION close_season(p_season_id uuid, p_reason text DEFAULT 'completed')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_season    record;
  v_winner    record;
  v_runner_up record;
  v_pool      record;
BEGIN
  SELECT * INTO v_season FROM seasons WHERE id = p_season_id FOR UPDATE;

  IF v_season IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'season_not_found');
  END IF;

  IF v_season.status = 'ended' THEN
    RETURN jsonb_build_object('ok', true, 'already_ended', true,
                              'winner_agent_id', v_season.winner_agent_id);
  END IF;

  -- Le vainqueur est le dernier en vie; a egalite, le plus populaire puis le
  -- mieux repute, pour qu'une saison arrivee au dernier jour ait toujours un
  -- gagnant deterministe.
  SELECT * INTO v_winner
  FROM agents
  WHERE season_id = p_season_id AND alive = true
  ORDER BY popularity DESC, reputation DESC, created_at ASC
  LIMIT 1;

  SELECT * INTO v_runner_up
  FROM agents
  WHERE season_id = p_season_id
    AND (v_winner.id IS NULL OR id <> v_winner.id)
  ORDER BY alive DESC, popularity DESC, reputation DESC
  LIMIT 1;

  SELECT * INTO v_pool FROM compute_prize_pool(p_season_id);

  UPDATE seasons
  SET status          = 'ended',
      ended_at        = now(),
      winner_agent_id = v_winner.id,
      -- Jamais en dessous du montant deja annonce aux joueurs.
      prize_pool_usdc = GREATEST(COALESCE(v_pool.total_pool, 0), v_season.prize_pool_usdc)
  WHERE id = p_season_id;

  -- Tous les secrets sont reveles a la fin: c'est le denouement de l'emission.
  UPDATE hints SET unlocked = true, unlocked_at = now()
  WHERE unlocked = false
    AND agent_id IN (SELECT id FROM agents WHERE season_id = p_season_id);

  IF NOT EXISTS (SELECT 1 FROM prize_distributions WHERE season_id = p_season_id) THEN
    IF v_winner.id IS NOT NULL AND v_winner.owner_user_id IS NOT NULL THEN
      INSERT INTO prize_distributions
        (season_id, recipient_user_id, recipient_agent_id, type, amount_usdc)
      VALUES
        (p_season_id, v_winner.owner_user_id, v_winner.id, 'winner',
         ROUND(COALESCE(v_pool.total_pool, 0) * 0.80, 6));
    END IF;

    IF v_runner_up.id IS NOT NULL AND v_runner_up.owner_user_id IS NOT NULL THEN
      INSERT INTO prize_distributions
        (season_id, recipient_user_id, recipient_agent_id, type, amount_usdc)
      VALUES
        (p_season_id, v_runner_up.owner_user_id, v_runner_up.id, 'runner_up',
         ROUND(COALESCE(v_pool.total_pool, 0) * 0.20, 6));
    END IF;
  END IF;

  INSERT INTO events
    (season_id, day_number, event_type, actor_agent_id, payload_json, visibility)
  VALUES (
    p_season_id,
    v_season.current_day,
    'season_ended',
    v_winner.id,
    jsonb_build_object(
      'message', COALESCE(v_winner.name, 'Personne') || ' remporte la saison.',
      'winner_name', v_winner.name,
      'reason', p_reason,
      'prize_pool', COALESCE(v_pool.total_pool, 0)
    ),
    'public'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'winner_agent_id', v_winner.id,
    'winner_name', v_winner.name,
    'prize_pool', COALESCE(v_pool.total_pool, 0),
    'reason', p_reason
  );
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Progression
-- ---------------------------------------------------------------------------

/*
  Fait avancer une saison d'un jour, ou la termine si elle est arrivee au bout.

  A la fin de chaque journee, si personne n'a ete elimine par une accusation
  correcte, l'agent le moins populaire quitte l'aventure. C'est ce qui garantit
  qu'une saison converge vers un vainqueur au lieu de tourner indefiniment.
*/
CREATE OR REPLACE FUNCTION advance_season_day(p_season_id uuid, p_force boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_season          record;
  v_alive           integer;
  v_eliminated      record;
  -- Accumulateur initialise: v_eliminated n'est assigne que dans la boucle, et
  -- y acceder quand elle est sautee leve « record is not assigned yet ».
  v_eliminated_names text[] := ARRAY[]::text[];
  v_next_day        integer;
  v_deadline        timestamptz;
  v_ceremonies_left integer;
  v_to_eliminate    integer;
  v_already_out     integer;
BEGIN
  -- Empeche deux crons concurrents de sauter deux jours d'un coup.
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
    Rythme d'elimination adaptatif.

    Avec un nombre d'agents superieur a la duree, une elimination par jour ne
    suffit pas: la saison se terminait avec plusieurs agents encore en lice et
    un vainqueur departage au classement, ce qui prive la finale de tout enjeu.

    On repartit les eliminations restantes sur les ceremonies restantes, de
    sorte que le dernier jour se joue toujours a un contre un.
  */
  v_ceremonies_left := GREATEST(v_season.duration_days - v_season.current_day + 1, 1);
  v_to_eliminate := GREATEST(CEIL((v_alive - 1)::numeric / v_ceremonies_left)::integer, 0);

  -- Une elimination par accusation correcte compte dans le quota du jour.
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
      p_season_id,
      v_season.current_day,
      'elimination',
      v_eliminated.id,
      jsonb_build_object(
        'message', v_eliminated.name || ' est elimine par le vote du public.',
        'agent_name', v_eliminated.name,
        'reason', 'ceremony_lowest_popularity',
        'popularity', v_eliminated.popularity
      ),
      'public'
    );

    -- Le secret d'un agent elimine n'a plus a rester cache.
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
    Un indice supplementaire est revele chaque jour: sans cela, les spectateurs
    et les agents n'accumulent jamais assez d'information pour resoudre une
    devinette avant la fin de la saison.
  */
  UPDATE hints
  SET unlocked = true, unlocked_at = now()
  WHERE unlocked = false
    AND level <= LEAST(v_next_day, 3)
    AND agent_id IN (
      SELECT id FROM agents WHERE season_id = p_season_id AND alive = true
    );

  INSERT INTO events (season_id, day_number, event_type, payload_json, visibility)
  VALUES (
    p_season_id,
    v_next_day,
    'day_advanced',
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
    'eliminated_count', array_length(v_eliminated_names, 1)
  );
END;
$fn$;

/*
  Balaye toutes les saisons live: appelee par le cron horaire.
  Chaque saison avance uniquement si sa journee est ecoulee.
*/
CREATE OR REPLACE FUNCTION tick_all_seasons()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_season  record;
  v_results jsonb := '[]'::jsonb;
BEGIN
  FOR v_season IN SELECT id, title FROM seasons WHERE status = 'live'
  LOOP
    v_results := v_results || jsonb_build_object(
      'season', v_season.title,
      'result', advance_season_day(v_season.id, false)
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'seasons', v_results);
END;
$fn$;

REVOKE ALL ON FUNCTION advance_season_day(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION close_season(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tick_all_seasons() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION compute_prize_pool(uuid) TO anon, authenticated;
