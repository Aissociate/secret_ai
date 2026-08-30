/*
  # Aligner la mécanique sur ce que le produit promet

  La revue fonctionnelle a montré que plusieurs règles annoncées dans
  l'interface n'existaient pas côté serveur. Cette migration implémente les
  promesses telles qu'elles sont écrites, plutôt que de corriger les textes.

  | Promesse affichée | État avant | Implémenté ici |
  |---|---|---|
  | « Popularite >= 60 / 80 / 95 » pour les indices | déblocage journalier | seuils de popularité |
  | « Chaque influence augmente legerement la popularite » | aucun effet | +1 popularité à la cible |
  | « Tu as 2 moments par jour » | compteur jamais décrémenté | quota réel, remis à zéro chaque jour |
  | « 70% des revenus d'influence » | commission unique appliquée | 70 % explicites |
  | « Le gagnant remporte la totalite du pool » | 80 / 20 | 100 % au vainqueur |
  | Historique « suivie / ignorée / détournée » | table jamais alimentée | écrite à chaque influence |
*/

-- ---------------------------------------------------------------------------
-- 1. Indices débloqués par la popularité
-- ---------------------------------------------------------------------------

/*
  Les paliers sont ceux affichés dans AgentSettingsPage, HintsPage, HintCard et
  AgentPage. Ils vivent dans une fonction unique pour que l'interface et la base
  ne puissent plus diverger.
*/
CREATE OR REPLACE FUNCTION hint_threshold(p_level integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE p_level WHEN 1 THEN 60 WHEN 2 THEN 80 WHEN 3 THEN 95 END;
$fn$;

GRANT EXECUTE ON FUNCTION hint_threshold(integer) TO anon, authenticated;

/*
  Déverrouille les indices dont le palier est atteint.
  Appelée par le trigger de popularité et par la progression de journée.
*/
CREATE OR REPLACE FUNCTION unlock_hints_by_popularity(p_agent_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_pop      integer;
  v_season   uuid;
  v_day      integer;
  v_unlocked integer := 0;
  h          record;
BEGIN
  SELECT popularity, season_id INTO v_pop, v_season
  FROM agents WHERE id = p_agent_id;

  IF v_pop IS NULL THEN RETURN 0; END IF;

  SELECT current_day INTO v_day FROM seasons WHERE id = v_season;

  FOR h IN
    SELECT id, level, hint_text FROM hints
    WHERE agent_id = p_agent_id
      AND unlocked = false
      AND v_pop >= hint_threshold(level)
    ORDER BY level
  LOOP
    UPDATE hints SET unlocked = true, unlocked_at = now() WHERE id = h.id;
    v_unlocked := v_unlocked + 1;

    -- Le déblocage est un moment de jeu: il doit apparaître dans le fil.
    INSERT INTO events
      (season_id, day_number, event_type, target_agent_id, payload_json, visibility)
    VALUES (
      v_season,
      COALESCE(v_day, 1),
      'hint_reveal',
      p_agent_id,
      jsonb_build_object(
        'message', 'Indice ' || h.level || ' revele : ' || h.hint_text,
        'level', h.level,
        'hint_text', h.hint_text,
        'threshold', hint_threshold(h.level),
        'popularity', v_pop
      ),
      'public'
    );
  END LOOP;

  RETURN v_unlocked;
END;
$fn$;

REVOKE ALL ON FUNCTION unlock_hints_by_popularity(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION trg_unlock_hints_on_popularity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.popularity > COALESCE(OLD.popularity, -1) THEN
    PERFORM unlock_hints_by_popularity(NEW.id);
  END IF;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_agents_unlock_hints ON agents;
CREATE TRIGGER trg_agents_unlock_hints
  AFTER UPDATE OF popularity ON agents
  FOR EACH ROW
  EXECUTE FUNCTION trg_unlock_hints_on_popularity();

-- ---------------------------------------------------------------------------
-- 2. Influences: quota réel, effet réel, historique réel
-- ---------------------------------------------------------------------------

/*
  Point d'entrée unique des influences.

  Auparavant le client insérait l'événement lui-même: le quota de 2 par jour
  n'était jamais décrémenté, la popularité de la cible n'était jamais touchée,
  et `influence_history` restait vide alors que l'interface l'affiche.
*/
CREATE OR REPLACE FUNCTION post_influence(
  p_kind     text,        -- 'owner' | 'spectator'
  p_agent_id uuid,
  p_message  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user     uuid := auth.uid();
  v_agent    record;
  v_season   record;
  v_msg      text;
  v_event_id uuid;
  v_new_pop  integer;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF p_kind NOT IN ('owner', 'spectator') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_kind');
  END IF;

  v_msg := btrim(COALESCE(p_message, ''));
  IF v_msg = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'empty_message');
  END IF;
  v_msg := left(v_msg, 500);

  SELECT * INTO v_agent FROM agents WHERE id = p_agent_id;
  IF v_agent IS NULL OR NOT v_agent.alive THEN
    RETURN jsonb_build_object('ok', false, 'error', 'agent_unavailable');
  END IF;

  SELECT * INTO v_season FROM seasons WHERE id = v_agent.season_id;
  IF v_season IS NULL OR v_season.status <> 'live' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'season_not_live');
  END IF;

  IF p_kind = 'owner' THEN
    -- La policy d'events laissait n'importe quel compte poster une directive
    -- « owner » sur l'agent d'un tiers: on vérifie la propriété ici.
    IF v_agent.owner_user_id IS DISTINCT FROM v_user THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_owner');
    END IF;

    IF COALESCE(v_agent.owner_influences_remaining, 0) <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_influence_left');
    END IF;

    UPDATE agents
    SET owner_influences_remaining = owner_influences_remaining - 1
    WHERE id = p_agent_id;
  ELSE
    -- « Chaque influence augmente legerement la popularite de l'agent. »
    UPDATE agents
    SET popularity = LEAST(popularity + 1, 100)
    WHERE id = p_agent_id
    RETURNING popularity INTO v_new_pop;

    INSERT INTO payments (user_id, season_id, type, amount_usdc, status)
    VALUES (v_user, v_agent.season_id, 'influence',
            COALESCE(v_season.influence_fee_usdc, 0), 'pending');
  END IF;

  INSERT INTO events
    (season_id, day_number, event_type, target_agent_id, actor_user_id,
     payload_json, visibility)
  VALUES (
    v_agent.season_id,
    v_season.current_day,
    CASE p_kind WHEN 'owner' THEN 'owner_influence' ELSE 'spectator_influence' END,
    p_agent_id,
    v_user,
    jsonb_build_object('message', v_msg),
    'public'
  )
  RETURNING id INTO v_event_id;

  -- L'interface affiche « suivie / ignorée / détournée »: la ligne doit exister
  -- dès l'envoi, l'issue étant renseignée plus tard par le moteur d'agent.
  INSERT INTO influence_history
    (event_id, agent_id, season_id, day_number, influence_type, message, outcome)
  VALUES (
    v_event_id, p_agent_id, v_agent.season_id, v_season.current_day,
    CASE p_kind WHEN 'owner' THEN 'owner_influence' ELSE 'spectator_influence' END,
    v_msg, 'pending'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'event_id', v_event_id,
    'popularity', v_new_pop,
    'remaining', CASE WHEN p_kind = 'owner'
                      THEN v_agent.owner_influences_remaining - 1 END
  );
END;
$fn$;

REVOKE ALL ON FUNCTION post_influence(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION post_influence(text, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Cagnotte: 70 % des revenus d'influence, 100 % au vainqueur
-- ---------------------------------------------------------------------------

/*
  « Le prize pool est constitue des droits d'entree (moins X% de frais
  plateforme) et de 70% des revenus d'influence. »
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
    ROUND(p.entries * s.platform_fee_pct / 100.0 + p.influences * 0.30, 6),
    /*
      Plancher: la cagnotte garantie au lancement. Aucun paiement n'est encore
      confirmé faute de prestataire, sans ce plancher le montant affiché serait 0.
    */
    GREATEST(
      ROUND(
        p.entries * (1 - s.platform_fee_pct / 100.0) + p.influences * 0.70,
        6
      ),
      COALESCE(s.prize_pool_usdc, 0)
    ),
    p.participants::integer
  FROM p, s;
$fn$;

GRANT EXECUTE ON FUNCTION compute_prize_pool(uuid) TO anon, authenticated;
