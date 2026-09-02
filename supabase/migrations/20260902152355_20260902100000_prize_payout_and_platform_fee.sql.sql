/*
  # La cagnotte est versee, et la commission est prelevee

  ## Versement

  `close_season` inserait une ligne dans `prize_distributions` avec
  `paid = false` et s'arretait la. `wallet_ledger.kind` connaissait `'payout'`
  mais rien ne l'ecrivait jamais. Depuis que le solde est reel — le droit
  d'entree debite vraiment le joueur — le vainqueur ne recevait donc rien: la
  boucle « j'ai mis quelque chose de moi » se terminait sur un chiffre affiche.

  Le versement se fait par declencheur sur `prize_distributions` plutot que
  dans `close_season`: c'est la troisieme definition de cette fonction et
  aucune n'a a etre recopiee. Toute distribution inseree a l'avenir, quel que
  soit le chemin, sera payee sans qu'on y pense.

  Seules les distributions a un joueur (`winner`, `runner_up`) touchent un
  solde: `platform_fee` et `influence_revenue` n'ont pas de portefeuille.

  ## Commission

  `pay_entry_fee` ajoutait le droit d'entree *entier* a `prize_pool_usdc`. Le
  lancement calcule `max_agents x fee x (1 - pct)` puis prend le plus grand des
  deux: la somme non decotee l'emportait toujours, et `platform_fee_pct` ne
  commandait rien. Sans effet tant que rien n'etait verse; au premier
  versement, la plateforme aurait paye sa propre commission.

  `compute_prize_pool` lisait les entrees dans `payments` en `'confirmed'`,
  que `pay_entry_fee` n'ecrit jamais: les entrees valaient toujours 0 et tout
  reposait sur le plancher. Elle lit maintenant le grand livre, qui fait foi.

  Les revenus d'influence restent lus dans `payments`, ou `post_influence`
  les ecrit en `'pending'` sans que rien ne les confirme: c'est un autre
  chantier, celui du prestataire de paiement.
*/

-- ---------------------------------------------------------------------------
-- 1. Versement par declencheur
-- ---------------------------------------------------------------------------

ALTER TABLE prize_distributions ADD COLUMN IF NOT EXISTS paid_at timestamptz;

CREATE OR REPLACE FUNCTION trg_pay_prize_distribution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_season_title text;
BEGIN
  IF NEW.paid OR NEW.type NOT IN ('winner', 'runner_up') OR COALESCE(NEW.amount_usdc, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  -- Idempotence: une distribution deja creditee au grand livre ne l'est pas deux fois.
  IF EXISTS (
    SELECT 1 FROM wallet_ledger
    WHERE user_id = NEW.recipient_user_id
      AND season_id = NEW.season_id
      AND kind = 'payout'
      AND COALESCE(agent_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = COALESCE(NEW.recipient_agent_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) THEN
    NEW.paid := true;
    NEW.paid_at := COALESCE(NEW.paid_at, now());
    RETURN NEW;
  END IF;

  SELECT title INTO v_season_title FROM seasons WHERE id = NEW.season_id;

  INSERT INTO wallet_ledger (user_id, kind, amount_usdc, season_id, agent_id, note)
  VALUES (
    NEW.recipient_user_id, 'payout', NEW.amount_usdc, NEW.season_id, NEW.recipient_agent_id,
    CASE NEW.type WHEN 'winner' THEN 'Cagnotte ' ELSE 'Finaliste ' END || COALESCE(v_season_title, '')
  );

  NEW.paid := true;
  NEW.paid_at := now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_prize_distribution_pay ON prize_distributions;
CREATE TRIGGER trg_prize_distribution_pay
  BEFORE INSERT ON prize_distributions
  FOR EACH ROW EXECUTE FUNCTION trg_pay_prize_distribution();

/*
  Rattrapage des distributions deja enregistrees et jamais versees. Le
  declencheur ne porte que sur l'insertion; on rejoue sa logique une fois.
*/
DO $$
DECLARE
  r record;
  v_title text;
BEGIN
  FOR r IN
    SELECT d.*
    FROM prize_distributions d
    WHERE d.paid = false
      AND d.type IN ('winner', 'runner_up')
      AND COALESCE(d.amount_usdc, 0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM wallet_ledger l
        WHERE l.user_id = d.recipient_user_id
          AND l.season_id = d.season_id
          AND l.kind = 'payout'
      )
  LOOP
    SELECT title INTO v_title FROM seasons WHERE id = r.season_id;
    INSERT INTO wallet_ledger (user_id, kind, amount_usdc, season_id, agent_id, note)
    VALUES (r.recipient_user_id, 'payout', r.amount_usdc, r.season_id, r.recipient_agent_id,
            CASE r.type WHEN 'winner' THEN 'Cagnotte ' ELSE 'Finaliste ' END || COALESCE(v_title, ''));
    UPDATE prize_distributions SET paid = true, paid_at = now() WHERE id = r.id;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Le droit d'entree alimente la cagnotte net de commission
-- ---------------------------------------------------------------------------

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
  v_net     numeric;
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

  -- Le joueur paie le droit entier; le grand livre garde ce montant pour un
  -- eventuel remboursement integral a l'annulation.
  INSERT INTO wallet_ledger (user_id, kind, amount_usdc, season_id, note)
  VALUES (v_user, 'entry_fee', -v_season.entry_fee_usdc, p_season_id,
          'Droit d''entree ' || v_season.title);

  /*
    La cagnotte, elle, ne recoit que la part nette: c'est la seule facon pour
    que `platform_fee_pct` existe ailleurs que dans un reglage. Le lancement
    calcule le meme montant de son cote — max_agents x fee x (1 - pct) — et
    les deux coincident quand tous les inscrits ont paye.
  */
  v_net := ROUND(v_season.entry_fee_usdc * (1 - COALESCE(v_season.platform_fee_pct, 0) / 100.0), 6);

  UPDATE seasons
  SET prize_pool_usdc = prize_pool_usdc + v_net
  WHERE id = p_season_id;

  RETURN jsonb_build_object(
    'ok', true,
    'amount', v_season.entry_fee_usdc,
    'to_pool', v_net
  );
END;
$fn$;

REVOKE ALL ON FUNCTION pay_entry_fee(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pay_entry_fee(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. La cagnotte se calcule sur le grand livre
-- ---------------------------------------------------------------------------

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
  e AS (
    -- Les droits d'entree sont des debits: on les lit en valeur absolue.
    SELECT
      COALESCE(-SUM(amount_usdc), 0) AS entries,
      COUNT(DISTINCT user_id)        AS participants
    FROM wallet_ledger
    WHERE season_id = p_season_id AND kind = 'entry_fee'
  ),
  p AS (
    SELECT COALESCE(SUM(amount_usdc), 0) AS influences
    FROM payments
    WHERE season_id = p_season_id AND type = 'influence' AND status = 'confirmed'
  )
  SELECT
    e.entries,
    p.influences,
    ROUND(e.entries * s.platform_fee_pct / 100.0 + p.influences * 0.30, 6),
    -- Plancher: la cagnotte garantie au lancement, quand rien n'est encore paye.
    GREATEST(
      ROUND(e.entries * (1 - s.platform_fee_pct / 100.0) + p.influences * 0.70, 6),
      COALESCE(s.prize_pool_usdc, 0)
    ),
    e.participants::integer
  FROM e, p, s;
$fn$;

GRANT EXECUTE ON FUNCTION compute_prize_pool(uuid) TO anon, authenticated;
