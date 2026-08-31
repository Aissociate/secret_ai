/*
  # Facturation des tokens et choix du modèle

  Trois opérations, toutes en `SECURITY DEFINER` et fermées au client :
  résoudre quel modèle un agent doit réellement utiliser, débiter après coup, et
  prélever le droit d'entrée.

  Le principe : on **débite après l'appel**, sur la consommation réelle rapportée
  par le fournisseur, jamais sur une estimation. Une estimation fausse ferait
  payer de l'air ou perdre de l'argent.
*/

-- ---------------------------------------------------------------------------
-- 1. Quel modèle pour cet agent, maintenant ?
-- ---------------------------------------------------------------------------

/*
  Le solde peut s'épuiser en pleine saison. L'agent ne meurt pas pour autant :
  il bascule sur le palier gratuit et continue de jouer, en dégradé. Une panne
  de paiement ne doit pas décider d'une partie.

  Le seuil de repli est une réserve, pas zéro : un appel dont on ignore encore
  le coût ne doit pas pouvoir creuser le solde.
*/
CREATE OR REPLACE FUNCTION resolve_agent_model(p_agent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_agent   record;
  v_model   record;
  v_balance numeric;
  v_reserve numeric := 0.05;
BEGIN
  SELECT a.id, a.model_slug, a.owner_user_id, a.season_id
  INTO v_agent
  FROM agents a WHERE a.id = p_agent_id;

  IF v_agent IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'agent_not_found');
  END IF;

  SELECT * INTO v_model
  FROM llm_models WHERE slug = v_agent.model_slug AND enabled = true;

  -- Modele retire du catalogue: on ne bloque pas la partie pour autant.
  IF v_model IS NULL THEN
    SELECT * INTO v_model FROM llm_models WHERE tier = 'gratuit' AND enabled = true
    ORDER BY sort_order LIMIT 1;
  END IF;

  SELECT balance_usdc INTO v_balance FROM users WHERE id = v_agent.owner_user_id;

  IF v_model.price_in_per_mtok = 0 AND v_model.price_out_per_mtok = 0 THEN
    RETURN jsonb_build_object(
      'ok', true, 'slug', v_model.slug,
      'provider_model', v_model.provider_model, 'downgraded', false
    );
  END IF;

  IF COALESCE(v_balance, 0) < v_reserve THEN
    SELECT * INTO v_model FROM llm_models WHERE tier = 'gratuit' AND enabled = true
    ORDER BY sort_order LIMIT 1;

    IF v_model IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_free_model');
    END IF;

    RETURN jsonb_build_object(
      'ok', true, 'slug', v_model.slug,
      'provider_model', v_model.provider_model,
      'downgraded', true, 'reason', 'insufficient_balance'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'slug', v_model.slug,
    'provider_model', v_model.provider_model, 'downgraded', false
  );
END;
$fn$;

REVOKE ALL ON FUNCTION resolve_agent_model(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Débiter la consommation réelle
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION charge_tokens(
  p_agent_id      uuid,
  p_model_slug    text,
  p_prompt_tokens integer,
  p_output_tokens integer,
  p_downgraded    boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_agent   record;
  v_model   record;
  v_cost    numeric;
  v_charged numeric;
  v_balance numeric;
BEGIN
  SELECT a.id, a.owner_user_id, a.season_id INTO v_agent
  FROM agents a WHERE a.id = p_agent_id;

  IF v_agent IS NULL OR v_agent.owner_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'agent_not_found');
  END IF;

  SELECT * INTO v_model FROM llm_models WHERE slug = p_model_slug;
  IF v_model IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_model');
  END IF;

  v_cost :=
      COALESCE(p_prompt_tokens, 0)::numeric / 1000000 * v_model.price_in_per_mtok
    + COALESCE(p_output_tokens, 0)::numeric / 1000000 * v_model.price_out_per_mtok;

  v_charged := ROUND(v_cost * token_margin(), 6);

  INSERT INTO token_usage
    (user_id, agent_id, season_id, model_slug,
     prompt_tokens, output_tokens, cost_usdc, charged_usdc, downgraded)
  VALUES
    (v_agent.owner_user_id, p_agent_id, v_agent.season_id, p_model_slug,
     COALESCE(p_prompt_tokens, 0), COALESCE(p_output_tokens, 0),
     ROUND(v_cost, 6), v_charged, p_downgraded);

  /*
    Un appel gratuit est trace mais n'ecrit pas au grand livre: une ligne a zero
    par action noierait l'historique que le joueur consulte.
  */
  IF v_charged > 0 THEN
    INSERT INTO wallet_ledger (user_id, kind, amount_usdc, season_id, agent_id, note)
    VALUES (v_agent.owner_user_id, 'token_usage', -v_charged,
            v_agent.season_id, p_agent_id, v_model.label);
  END IF;

  SELECT balance_usdc INTO v_balance FROM users WHERE id = v_agent.owner_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'cost', ROUND(v_cost, 6),
    'charged', v_charged,
    'balance', v_balance
  );
END;
$fn$;

REVOKE ALL ON FUNCTION charge_tokens(uuid, text, integer, integer, boolean)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Droit d'entrée prélevé sur le solde
-- ---------------------------------------------------------------------------

/*
  S'inscrire débite le solde et alimente la cagnotte de la saison. Les deux
  mouvements doivent être solidaires : un droit d'entrée débité sans cagnotte
  créditée, ou l'inverse, fausserait la comptabilité du jeu.
*/
CREATE OR REPLACE FUNCTION pay_entry_fee(p_season_id uuid, p_config_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user    uuid := auth.uid();
  v_season  record;
  v_balance numeric;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_season FROM seasons WHERE id = p_season_id FOR UPDATE;
  IF v_season IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'season_not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM agent_configs WHERE id = p_config_id AND owner_user_id = v_user
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_your_agent');
  END IF;

  -- Idempotent: une inscription deja payee ne se refacture pas.
  IF EXISTS (
    SELECT 1 FROM wallet_ledger
    WHERE user_id = v_user AND season_id = p_season_id AND kind = 'entry_fee'
  ) THEN
    RETURN jsonb_build_object('ok', true, 'already_paid', true);
  END IF;

  IF COALESCE(v_season.entry_fee_usdc, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'amount', 0);
  END IF;

  SELECT balance_usdc INTO v_balance FROM users WHERE id = v_user FOR UPDATE;

  IF COALESCE(v_balance, 0) < v_season.entry_fee_usdc THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'insufficient_balance',
      'required', v_season.entry_fee_usdc, 'balance', COALESCE(v_balance, 0)
    );
  END IF;

  INSERT INTO wallet_ledger (user_id, kind, amount_usdc, season_id, note)
  VALUES (v_user, 'entry_fee', -v_season.entry_fee_usdc, p_season_id,
          'Droit d''entree ' || v_season.title);

  -- Le droit d'entree alimente la cagnotte, qui n'est jamais touchee par les tokens.
  UPDATE seasons
  SET prize_pool_usdc = prize_pool_usdc + v_season.entry_fee_usdc
  WHERE id = p_season_id;

  RETURN jsonb_build_object('ok', true, 'amount', v_season.entry_fee_usdc);
END;
$fn$;

REVOKE ALL ON FUNCTION pay_entry_fee(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pay_entry_fee(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Consulter son solde
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION my_wallet()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'balance', COALESCE((SELECT balance_usdc FROM users WHERE id = v_user), 0),
    'spent_tokens', COALESCE((
      SELECT SUM(charged_usdc) FROM token_usage WHERE user_id = v_user
    ), 0),
    'calls', COALESCE((
      SELECT COUNT(*) FROM token_usage WHERE user_id = v_user
    ), 0),
    'recent', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'kind', l.kind, 'amount', l.amount_usdc,
        'note', l.note, 'at', l.created_at
      ) ORDER BY l.created_at DESC)
      FROM (
        SELECT * FROM wallet_ledger WHERE user_id = v_user
        ORDER BY created_at DESC LIMIT 20
      ) l
    ), '[]'::jsonb)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION my_wallet() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION my_wallet() TO authenticated;
