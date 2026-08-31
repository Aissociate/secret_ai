/*
  # Valider le secret au moment de l'inscription

  `secret_is_available` n'était consultée qu'à la génération. Le trigger de
  lancement recopie ensuite le secret de la configuration **sans le revalider** :
  un propriétaire pouvait donc saisir « constellation » à la main, ou conserver
  une configuration ancienne, et réintroduire un mot du cluster dans une saison
  neuve. Le nettoyage ponctuel de la réinitialisation ne suffit pas à empêcher
  que cela recommence.

  L'inscription est le bon endroit pour trancher : c'est le dernier moment où
  l'on peut refuser sans casser une partie en cours. Refuser au lancement
  exclurait silencieusement un agent d'une saison déjà pleine.
*/

CREATE OR REPLACE FUNCTION trg_validate_enrollment_secret()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_cfg     record;
  v_verdict jsonb;
BEGIN
  SELECT secret_keyword, hint_1, hint_2, hint_3, name
  INTO v_cfg
  FROM agent_configs WHERE id = NEW.agent_config_id;

  IF v_cfg IS NULL THEN
    RAISE EXCEPTION 'Configuration d''agent introuvable';
  END IF;

  IF COALESCE(btrim(v_cfg.hint_1), '') = ''
     OR COALESCE(btrim(v_cfg.hint_2), '') = ''
     OR COALESCE(btrim(v_cfg.hint_3), '') = '' THEN
    RAISE EXCEPTION
      'Les trois indices de « % » doivent etre renseignes avant l''inscription.',
      COALESCE(v_cfg.name, 'cet agent');
  END IF;

  v_verdict := secret_is_available(v_cfg.secret_keyword, NEW.season_id);

  IF NOT (v_verdict->>'available')::boolean THEN
    RAISE EXCEPTION
      'Le secret de « % » ne convient pas (%). Regenerez-le avant de vous inscrire.',
      COALESCE(v_cfg.name, 'cet agent'),
      COALESCE(v_verdict->>'reason', 'indisponible');
  END IF;

  RETURN NEW;
END;
$fn$;

/*
  BEFORE INSERT, donc avant le trigger de lancement (AFTER INSERT): une
  inscription refusee n'atteint jamais le peuplement de la saison.
*/
DROP TRIGGER IF EXISTS trg_enrollment_validate_secret ON season_enrollments;
CREATE TRIGGER trg_enrollment_validate_secret
  BEFORE INSERT ON season_enrollments
  FOR EACH ROW
  EXECUTE FUNCTION trg_validate_enrollment_secret();
