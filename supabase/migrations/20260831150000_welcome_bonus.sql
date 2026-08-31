/*
  # Bonus de bienvenue

  Sans dépôt, pas de partie : un nouvel inscrit ne pouvait ni payer son droit
  d'entrée, ni faire tourner un modèle payant, et aucun moyen de créditer un
  solde n'existe encore. Le bonus lui permet d'entrer dans le jeu tout de suite.

  Le montant est réglable sans redéploiement :

    ALTER DATABASE postgres SET app.welcome_bonus = '200';

  ## Garde-fou
  Le crédit est unique par compte. Une seule ligne `deposit` portant la note
  « bienvenue » peut exister : c'est ce qui empêche un utilisateur de le
  réclamer plusieurs fois en recréant son profil, et rend la migration
  rejouable sans double crédit.
*/

CREATE OR REPLACE FUNCTION welcome_bonus_amount()
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(
    NULLIF(current_setting('app.welcome_bonus', true), '')::numeric,
    200
  );
$fn$;

GRANT EXECUTE ON FUNCTION welcome_bonus_amount() TO anon, authenticated;

CREATE OR REPLACE FUNCTION grant_welcome_bonus(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_amount numeric := welcome_bonus_amount();
BEGIN
  IF v_amount <= 0 THEN
    RETURN false;
  END IF;

  -- Un seul bonus par compte, quoi qu'il arrive.
  IF EXISTS (
    SELECT 1 FROM wallet_ledger
    WHERE user_id = p_user_id AND kind = 'deposit' AND note = 'Bonus de bienvenue'
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO wallet_ledger (user_id, kind, amount_usdc, note)
  VALUES (p_user_id, 'deposit', v_amount, 'Bonus de bienvenue');

  RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION grant_welcome_bonus(uuid) FROM PUBLIC, anon, authenticated;

/*
  Le profil est cree par le client juste apres l'inscription: c'est le seul
  moment ou l'on est certain qu'un compte vient de naitre.
*/
CREATE OR REPLACE FUNCTION trg_welcome_bonus()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  PERFORM grant_welcome_bonus(NEW.id);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_users_welcome_bonus ON users;
CREATE TRIGGER trg_users_welcome_bonus
  AFTER INSERT ON users
  FOR EACH ROW
  EXECUTE FUNCTION trg_welcome_bonus();

/*
  Rattrapage pour les comptes deja existants: le bonus n'aurait aucun sens s'il
  ne beneficiait qu'aux inscrits d'apres cette migration, alors qu'aucun d'eux
  n'a jamais pu deposer.
*/
DO $$
DECLARE
  u       record;
  v_count integer := 0;
BEGIN
  FOR u IN SELECT id FROM users LOOP
    IF grant_welcome_bonus(u.id) THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Bonus de bienvenue accorde a % compte(s)', v_count;
END $$;
