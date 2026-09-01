/*
  # Réinitialisation des saisons
  reset_all_seasons + nettoyage des secrets obsoletes + execution du reset
*/
CREATE OR REPLACE FUNCTION reset_all_seasons(p_include_ended boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_refunded integer := 0; v_amount numeric := 0; v_deleted integer := 0; r record;
BEGIN
  FOR r IN
    SELECT l.user_id, l.season_id, -l.amount_usdc AS amount, s.title
    FROM wallet_ledger l JOIN seasons s ON s.id = l.season_id
    WHERE l.kind = 'entry_fee' AND l.amount_usdc < 0 AND s.status <> 'ended'
      AND NOT EXISTS (SELECT 1 FROM wallet_ledger r2 WHERE r2.user_id = l.user_id AND r2.season_id = l.season_id AND r2.kind = 'refund')
  LOOP
    INSERT INTO wallet_ledger (user_id, kind, amount_usdc, season_id, note)
    VALUES (r.user_id, 'refund', r.amount, r.season_id, 'Saison annulee : ' || COALESCE(r.title, 'sans titre'));
    v_refunded := v_refunded + 1; v_amount := v_amount + r.amount;
  END LOOP;
  IF p_include_ended THEN DELETE FROM seasons; ELSE DELETE FROM seasons WHERE status <> 'ended'; END IF;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'seasons_deleted', v_deleted, 'refunds', v_refunded, 'refunded_total', v_amount);
END;
$fn$;
REVOKE ALL ON FUNCTION reset_all_seasons(boolean) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE v_cleared integer;
BEGIN
  UPDATE agent_configs SET secret_keyword = '', hint_1 = '', hint_2 = '', hint_3 = '', ready = false
  WHERE normalize_secret(secret_keyword) IN (SELECT normalized FROM secret_blocklist);
  GET DIAGNOSTICS v_cleared = ROW_COUNT;
  RAISE NOTICE 'Secrets obsoletes effaces sur % configuration(s)', v_cleared;
END $$;

DO $$
DECLARE v_result jsonb;
BEGIN
  v_result := reset_all_seasons(true);
  RAISE NOTICE 'Reinitialisation: %', v_result;
END $$;