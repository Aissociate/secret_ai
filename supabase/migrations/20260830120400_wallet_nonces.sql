/*
  # Defis de signature pour l'authentification par portefeuille

  Table de support de la fonction Edge `wallet-auth`.

  ## Contexte
  L'ancienne connexion MetaMask derivait le mot de passe de l'adresse publique
  (`metamask_${addr.slice(0,10)}_temp`). L'adresse etant visible on-chain et
  affichee dans l'interface, le mot de passe l'etait aussi: n'importe qui
  pouvait se connecter au compte de n'importe quel utilisateur. Aucune signature
  n'etait demandee, donc rien ne prouvait la possession de la cle privee.

  Le nonce rend la signature non rejouable: sans lui, une signature interceptee
  resterait valable indefiniment.
*/

CREATE TABLE IF NOT EXISTS wallet_nonces (
  wallet_address text PRIMARY KEY,
  nonce          text NOT NULL,
  message        text NOT NULL,
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE wallet_nonces ENABLE ROW LEVEL SECURITY;

/*
  Aucune policy: la table n'est manipulee que par la fonction Edge en
  service_role, qui contourne la RLS. RLS activee sans policy = personne d'autre
  n'y accede, ce qui est exactement l'intention.
*/

CREATE INDEX IF NOT EXISTS idx_wallet_nonces_expiry ON wallet_nonces (expires_at);

/* Purge des defis expires, appelee par le cron horaire. */
CREATE OR REPLACE FUNCTION purge_expired_wallet_nonces()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM wallet_nonces WHERE expires_at < now();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$fn$;

REVOKE ALL ON FUNCTION purge_expired_wallet_nonces() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-wallet-nonces') THEN
      PERFORM cron.unschedule('purge-wallet-nonces');
    END IF;
    PERFORM cron.schedule(
      'purge-wallet-nonces', '17 * * * *',
      $cron$SELECT purge_expired_wallet_nonces()$cron$
    );
  END IF;
END $$;
