/*
  # Bonus de bienvenue
  welcome_bonus_amount + grant_welcome_bonus + trigger sur users
*/
CREATE OR REPLACE FUNCTION welcome_bonus_amount() RETURNS numeric LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $fn$ SELECT COALESCE(NULLIF(current_setting('app.welcome_bonus', true), '')::numeric, 200); $fn$;
GRANT EXECUTE ON FUNCTION welcome_bonus_amount() TO anon, authenticated;

CREATE OR REPLACE FUNCTION grant_welcome_bonus(p_user_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_amount numeric := welcome_bonus_amount();
BEGIN
  IF v_amount <= 0 THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM wallet_ledger WHERE user_id = p_user_id AND kind = 'deposit' AND note = 'Bonus de bienvenue') THEN RETURN false; END IF;
  INSERT INTO wallet_ledger (user_id, kind, amount_usdc, note) VALUES (p_user_id, 'deposit', v_amount, 'Bonus de bienvenue');
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION grant_welcome_bonus(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION trg_welcome_bonus() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$ BEGIN PERFORM grant_welcome_bonus(NEW.id); RETURN NEW; END; $fn$;
DROP TRIGGER IF EXISTS trg_users_welcome_bonus ON users;
CREATE TRIGGER trg_users_welcome_bonus AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION trg_welcome_bonus();

DO $$
DECLARE u record; v_count integer := 0;
BEGIN
  FOR u IN SELECT id FROM users LOOP
    IF grant_welcome_bonus(u.id) THEN v_count := v_count + 1; END IF;
  END LOOP;
  RAISE NOTICE 'Bonus de bienvenue accorde a % compte(s)', v_count;
END $$;