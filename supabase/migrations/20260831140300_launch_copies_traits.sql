/*
  # Le lancement recopie les traits et le modèle

  Les curseurs de comportement et le modèle choisi vivent sur `agent_configs`
  (l'identité durable) mais sont lus sur `agents` (l'incarnation de la saison).
  Sans cette recopie, chaque agent entrerait en jeu avec les valeurs par défaut
  et la configuration du propriétaire n'aurait aucun effet.

  On fige les valeurs au lancement plutôt que de les lire en direct : changer sa
  doctrine en pleine saison reviendrait à changer de joueur en cours de partie.
*/

CREATE OR REPLACE FUNCTION auto_launch_season_when_full()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_season         record;
  v_enrolled_count integer;
  v_enr            record;
  v_cfg            record;
  v_agent_id       uuid;
  v_prize_pool     numeric;
  v_updated        integer;
BEGIN
  SELECT * INTO v_season
  FROM seasons
  WHERE id = NEW.season_id AND status = 'draft'
  FOR UPDATE;

  IF v_season IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_enrolled_count
  FROM season_enrollments
  WHERE season_id = NEW.season_id
    AND COALESCE(status, 'accepted') <> 'rejected';

  IF v_enrolled_count < v_season.max_agents THEN
    RETURN NEW;
  END IF;

  /*
    Cagnotte garantie. Les droits d'entree deja preleves l'ont alimentee au fil
    des inscriptions: on garde le plus eleve des deux pour ne jamais annoncer
    moins que ce qui a ete encaisse.
  */
  v_prize_pool := GREATEST(
    v_season.max_agents * v_season.entry_fee_usdc
      * (1.0 - v_season.platform_fee_pct::numeric / 100.0),
    COALESCE(v_season.prize_pool_usdc, 0)
  );

  FOR v_enr IN
    SELECT * FROM season_enrollments
    WHERE season_id = NEW.season_id
      AND COALESCE(status, 'accepted') <> 'rejected'
  LOOP
    IF EXISTS (
      SELECT 1 FROM agents
      WHERE season_id = NEW.season_id AND agent_config_id = v_enr.agent_config_id
    ) THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_cfg FROM agent_configs WHERE id = v_enr.agent_config_id;
    IF v_cfg IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO agents (
      season_id, owner_user_id, agent_config_id, name, avatar_url,
      llm_provider, llm_model, model_slug, secret_keyword, presentation,
      alive, popularity, reputation, owner_influences_remaining,
      confessional_count, api_key,
      trait_audace, trait_sociabilite, trait_expressivite,
      trait_introspection, trait_loyaute, trait_discretion,
      signature_style, taboo
    ) VALUES (
      NEW.season_id,
      v_enr.owner_user_id,
      v_enr.agent_config_id,
      v_cfg.name,
      v_cfg.avatar_url,
      'openrouter',
      v_cfg.openrouter_model,
      COALESCE(v_cfg.model_slug, 'rapide'),
      normalize_secret(v_cfg.secret_keyword),
      COALESCE(v_cfg.presentation, ''),
      true, 50, 50, 2, 0,
      encode(gen_random_bytes(16), 'hex'),
      COALESCE(v_cfg.trait_audace, 50),
      COALESCE(v_cfg.trait_sociabilite, 50),
      COALESCE(v_cfg.trait_expressivite, 50),
      COALESCE(v_cfg.trait_introspection, 50),
      COALESCE(v_cfg.trait_loyaute, 50),
      COALESCE(v_cfg.trait_discretion, 50),
      COALESCE(v_cfg.signature_style, ''),
      COALESCE(v_cfg.taboo, '')
    )
    RETURNING id INTO v_agent_id;

    INSERT INTO hints (agent_id, level, hint_text, unlocked)
    VALUES
      (v_agent_id, 1, v_cfg.hint_1, false),
      (v_agent_id, 2, v_cfg.hint_2, false),
      (v_agent_id, 3, v_cfg.hint_3, false);
  END LOOP;

  UPDATE seasons
  SET status          = 'live',
      started_at      = now(),
      day_started_at  = now(),
      current_day     = 1,
      prize_pool_usdc = v_prize_pool
  WHERE id = NEW.season_id AND status = 'draft';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated > 0 THEN
    PERFORM notify_edge_function(
      'auto-tick',
      jsonb_build_object('trigger', 'season_launch', 'season_id', NEW.season_id)
    );
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trigger_auto_launch_season ON season_enrollments;
CREATE TRIGGER trigger_auto_launch_season
  AFTER INSERT ON season_enrollments
  FOR EACH ROW
  EXECUTE FUNCTION auto_launch_season_when_full();
