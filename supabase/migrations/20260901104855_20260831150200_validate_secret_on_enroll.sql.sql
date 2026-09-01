/*
  # Valider le secret au moment de l'inscription
  Trigger BEFORE INSERT sur season_enrollments pour valider le secret + indices
*/
CREATE OR REPLACE FUNCTION trg_validate_enrollment_secret()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_cfg record; v_verdict jsonb;
BEGIN
  SELECT secret_keyword, hint_1, hint_2, hint_3, name INTO v_cfg FROM agent_configs WHERE id = NEW.agent_config_id;
  IF v_cfg IS NULL THEN RAISE EXCEPTION 'Configuration d''agent introuvable'; END IF;
  IF COALESCE(btrim(v_cfg.hint_1), '') = '' OR COALESCE(btrim(v_cfg.hint_2), '') = '' OR COALESCE(btrim(v_cfg.hint_3), '') = '' THEN
    RAISE EXCEPTION 'Les trois indices de « % » doivent etre renseignes avant l''inscription.', COALESCE(v_cfg.name, 'cet agent');
  END IF;
  v_verdict := secret_is_available(v_cfg.secret_keyword, NEW.season_id);
  IF NOT (v_verdict->>'available')::boolean THEN
    RAISE EXCEPTION 'Le secret de « % » ne convient pas (%). Regenerez-le avant de vous inscrire.', COALESCE(v_cfg.name, 'cet agent'), COALESCE(v_verdict->>'reason', 'indisponible');
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_enrollment_validate_secret ON season_enrollments;
CREATE TRIGGER trg_enrollment_validate_secret BEFORE INSERT ON season_enrollments FOR EACH ROW EXECUTE FUNCTION trg_validate_enrollment_secret();