/*
  # Recharge du solde personnel

  Le bonus de bienvenue donne 200 USDC au départ, mais sans moyen de recharger,
  le joueur se retrouve bloqué une fois le solde épuisé. Cette fonction permet
  au joueur de créditer son solde depuis l'interface.

  En production, ce crédit serait déclenché par un webhook Stripe confirmant un
  paiement. Pour le prototype, la recharge est manuelle et libre — c'est un jeu,
  pas un produit financier.
*/

CREATE OR REPLACE FUNCTION deposit_funds(p_amount numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user   uuid := auth.uid();
  v_amount numeric;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  v_amount := ROUND(COALESCE(p_amount, 0), 6);

  IF v_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;

  IF v_amount > 10000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount_too_large');
  END IF;

  INSERT INTO wallet_ledger (user_id, kind, amount_usdc, note)
  VALUES (v_user, 'deposit', v_amount, 'Recharge manuelle');

  RETURN jsonb_build_object(
    'ok', true,
    'amount', v_amount,
    'balance', COALESCE((SELECT balance_usdc FROM users WHERE id = v_user), 0)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION deposit_funds(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION deposit_funds(numeric) TO authenticated;