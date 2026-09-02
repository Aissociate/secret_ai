/*
  DM, journal intime et influence: payants, pour de vrai.

  purchase_unlock et post_influence ecrivaient une ligne `payments` en
  `pending` et accordaient l'acces aussitot: pour un spectateur inscrit, tout
  etait gratuit, et la cagnotte (70 % des influences confirmees) ne bougeait
  jamais. Ces trois achats passent par le portefeuille comme le droit
  d'entree: verification du solde, debit dans wallet_ledger, paiement
  `confirmed`. L'admin reste exempte. Un deverrouillage deja acquis n'est
  jamais refacture.
*/

-- ---------------------------------------------------------------------------
-- 1. Nouvelles natures de mouvement
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT conname INTO v_conname
  FROM pg_constraint
  WHERE conrelid = 'wallet_ledger'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%kind%';

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE wallet_ledger DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

ALTER TABLE wallet_ledger
  ADD CONSTRAINT wallet_ledger_kind_check
  CHECK (kind IN (
    'deposit', 'entry_fee', 'token_usage', 'refund', 'payout', 'adjustment',
    'purchase', 'influence'
  ));

-- ---------------------------------------------------------------------------
-- 2. Debit commun
-- ---------------------------------------------------------------------------

/*
  Verrouille le solde, refuse si insuffisant, debite et trace le paiement.
  Retourne NULL si tout va bien, sinon le JSON d'erreur a renvoyer tel quel.
*/
CREATE OR REPLACE FUNCTION wallet_charge(
  p_user      uuid,
  p_season_id uuid,
  p_kind      text,
  p_amount    numeric,
  p_note      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_balance numeric;
BEGIN
  IF COALESCE(p_amount, 0) <= 0 THEN
    RETURN NULL;
  END IF;

  -- L'admin anime le show: il ne paie pas ses propres outils.
  IF EXISTS (SELECT 1 FROM users WHERE id = p_user AND role = 'admin') THEN
    RETURN NULL;
  END IF;

  SELECT balance_usdc INTO v_balance FROM users WHERE id = p_user FOR UPDATE;

  IF COALESCE(v_balance, 0) < p_amount THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'insufficient_balance',
      'required', p_amount, 'balance', COALESCE(v_balance, 0)
    );
  END IF;

  INSERT INTO wallet_ledger (user_id, kind, amount_usdc, season_id, note)
  VALUES (p_user, p_kind, -p_amount, p_season_id, p_note);

  INSERT INTO payments (user_id, season_id, type, amount_usdc, status)
  VALUES (p_user, p_season_id, 'influence', p_amount, 'confirmed');

  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION wallet_charge(uuid, uuid, text, numeric, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Deverrouillages (DM, journal)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION purchase_unlock(
  p_kind      text,
  p_season_id uuid,
  p_target_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user    uuid := auth.uid();
  v_season  record;
  v_price   numeric;
  v_denied  jsonb;
  v_label   text;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF p_kind NOT IN ('dm', 'diary') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_kind');
  END IF;

  SELECT * INTO v_season FROM seasons WHERE id = p_season_id;
  IF v_season IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'season_not_found');
  END IF;

  v_price := CASE p_kind
               WHEN 'dm'    THEN COALESCE(v_season.dm_reveal_fee_usdc, 0)
               ELSE              COALESCE(v_season.diary_unlock_fee_usdc, 0)
             END;

  -- Idempotent: un deverrouillage deja acquis n'est jamais refacture.
  IF p_kind = 'dm' AND EXISTS (
    SELECT 1 FROM dm_reveals WHERE user_id = v_user AND event_id = p_target_id
  ) THEN
    RETURN jsonb_build_object('ok', true, 'already_unlocked', true);
  END IF;

  IF p_kind = 'diary' AND EXISTS (
    SELECT 1 FROM diary_unlocks WHERE user_id = v_user AND agent_id = p_target_id
  ) THEN
    RETURN jsonb_build_object('ok', true, 'already_unlocked', true);
  END IF;

  v_label := CASE p_kind WHEN 'dm' THEN 'Revelation d''un message prive'
                         ELSE 'Journal intime' END
             || ' - ' || v_season.title;

  v_denied := wallet_charge(v_user, p_season_id, 'purchase', v_price, v_label);
  IF v_denied IS NOT NULL THEN
    RETURN v_denied;
  END IF;

  IF p_kind = 'dm' THEN
    INSERT INTO dm_reveals (event_id, user_id, season_id, amount_usdc)
    VALUES (p_target_id, v_user, p_season_id, v_price);
  ELSE
    INSERT INTO diary_unlocks (user_id, agent_id, season_id, amount_usdc)
    VALUES (v_user, p_target_id, p_season_id, v_price);
  END IF;

  RETURN jsonb_build_object('ok', true, 'amount', v_price);
END;
$fn$;

REVOKE ALL ON FUNCTION purchase_unlock(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION purchase_unlock(text, uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Influence spectateur
-- ---------------------------------------------------------------------------

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
  v_user        uuid := auth.uid();
  v_agent       record;
  v_season      record;
  v_msg         text;
  v_event_id    uuid;
  v_new_pop     integer;
  v_today_count integer;
  v_denied      jsonb;
  c_spectator_daily_cap constant integer := 3;
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

  SELECT * INTO v_agent FROM agents WHERE id = p_agent_id FOR UPDATE;
  IF v_agent IS NULL OR NOT v_agent.alive THEN
    RETURN jsonb_build_object('ok', false, 'error', 'agent_unavailable');
  END IF;

  SELECT * INTO v_season FROM seasons WHERE id = v_agent.season_id;
  IF v_season IS NULL OR v_season.status <> 'live' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'season_not_live');
  END IF;

  IF p_kind = 'owner' THEN
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
    SELECT COUNT(*) INTO v_today_count
    FROM events
    WHERE event_type = 'spectator_influence'
      AND actor_user_id = v_user
      AND target_agent_id = p_agent_id
      AND day_number = v_season.current_day;

    IF v_today_count >= c_spectator_daily_cap THEN
      RETURN jsonb_build_object('ok', false, 'error', 'spectator_limit_reached');
    END IF;

    -- Le debit precede l'effet: pas de popularite ni de message sans solde.
    v_denied := wallet_charge(
      v_user, v_agent.season_id, 'influence',
      COALESCE(v_season.influence_fee_usdc, 0),
      'Influence sur ' || v_agent.name
    );
    IF v_denied IS NOT NULL THEN
      RETURN v_denied;
    END IF;

    IF v_today_count = 0 THEN
      UPDATE agents
      SET popularity = LEAST(popularity + 1, 100)
      WHERE id = p_agent_id
      RETURNING popularity INTO v_new_pop;
    ELSE
      v_new_pop := v_agent.popularity;
    END IF;
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
    CASE p_kind WHEN 'owner' THEN 'private_admin' ELSE 'public' END
  )
  RETURNING id INTO v_event_id;

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
    'charged', CASE WHEN p_kind = 'spectator' THEN COALESCE(v_season.influence_fee_usdc, 0) ELSE 0 END,
    'remaining', CASE WHEN p_kind = 'owner'
                      THEN v_agent.owner_influences_remaining - 1
                      ELSE c_spectator_daily_cap - COALESCE(v_today_count, 0) - 1 END
  );
END;
$fn$;

REVOKE ALL ON FUNCTION post_influence(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION post_influence(text, uuid, text) TO authenticated;
