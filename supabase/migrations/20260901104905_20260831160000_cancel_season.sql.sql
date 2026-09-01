/*
  # Annuler une saison
  cancel_season: suppression cibgee d'une saison avec remboursement des droits d'entree
*/
CREATE OR REPLACE FUNCTION cancel_season(p_season_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_user uuid := auth.uid(); v_season record; v_refunded integer := 0; v_total numeric := 0; r record;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_user AND role = 'admin') THEN RETURN jsonb_build_object('ok', false, 'error', 'admin_required'); END IF;
  SELECT * INTO v_season FROM seasons WHERE id = p_season_id FOR UPDATE;
  IF v_season IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'season_not_found'); END IF;
  IF v_season.status = 'ended' THEN RETURN jsonb_build_object('ok', false, 'error', 'season_ended'); END IF;
  FOR r IN
    SELECT l.user_id, -l.amount_usdc AS amount FROM wallet_ledger l
    WHERE l.season_id = p_season_id AND l.kind = 'entry_fee' AND l.amount_usdc < 0
      AND NOT EXISTS (SELECT 1 FROM wallet_ledger r2 WHERE r2.user_id = l.user_id AND r2.season_id = p_season_id AND r2.kind = 'refund')
  LOOP
    INSERT INTO wallet_ledger (user_id, kind, amount_usdc, season_id, note)
    VALUES (r.user_id, 'refund', r.amount, p_season_id, 'Saison annulee : ' || COALESCE(v_season.title, 'sans titre'));
    v_refunded := v_refunded + 1; v_total := v_total + r.amount;
  END LOOP;
  DELETE FROM seasons WHERE id = p_season_id;
  RETURN jsonb_build_object('ok', true, 'title', v_season.title, 'refunds', v_refunded, 'refunded_total', v_total);
END;
$fn$;
REVOKE ALL ON FUNCTION cancel_season(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cancel_season(uuid) TO authenticated;