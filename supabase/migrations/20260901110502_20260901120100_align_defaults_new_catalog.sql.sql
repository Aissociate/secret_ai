/*
  # Aligner les defaults et FK sur le nouveau catalogue

  Les anciens slugs ('rapide', 'gratuit') n'existent plus. Il faut :
  1. Mettre a jour les agent_configs/agents existants qui referençaient les anciens slugs
  2. Changer le default a 'eco-gemini' (bon rapport qualite-prix par defaut)
  3. Mettre a jour resolve_agent_model pour utiliser le nouveau slug gratuit
*/

-- Repointer les configs orphelines vers eco-gemini
UPDATE agent_configs SET model_slug = 'eco-gemini' WHERE model_slug NOT IN (SELECT slug FROM llm_models);
UPDATE agents SET model_slug = 'eco-gemini' WHERE model_slug NOT IN (SELECT slug FROM llm_models);

-- Changer le default
ALTER TABLE agent_configs ALTER COLUMN model_slug SET DEFAULT 'eco-gemini';
ALTER TABLE agents ALTER COLUMN model_slug SET DEFAULT 'eco-gemini';

-- Mettre a jour le fallback gratuit dans resolve_agent_model
CREATE OR REPLACE FUNCTION resolve_agent_model(p_agent_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_agent record; v_model record; v_balance numeric; v_reserve numeric := 0.05;
BEGIN
  SELECT a.id, a.model_slug, a.owner_user_id, a.season_id INTO v_agent FROM agents a WHERE a.id = p_agent_id;
  IF v_agent IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'agent_not_found'); END IF;
  SELECT * INTO v_model FROM llm_models WHERE slug = v_agent.model_slug AND enabled = true;
  IF v_model IS NULL THEN SELECT * INTO v_model FROM llm_models WHERE tier = 'gratuit' AND enabled = true ORDER BY sort_order LIMIT 1; END IF;
  SELECT balance_usdc INTO v_balance FROM users WHERE id = v_agent.owner_user_id;
  IF v_model.price_in_per_mtok = 0 AND v_model.price_out_per_mtok = 0 THEN
    RETURN jsonb_build_object('ok', true, 'slug', v_model.slug, 'provider_model', v_model.provider_model, 'downgraded', false);
  END IF;
  IF COALESCE(v_balance, 0) < v_reserve THEN
    SELECT * INTO v_model FROM llm_models WHERE tier = 'gratuit' AND enabled = true ORDER BY sort_order LIMIT 1;
    IF v_model IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_free_model'); END IF;
    RETURN jsonb_build_object('ok', true, 'slug', v_model.slug, 'provider_model', v_model.provider_model, 'downgraded', true, 'reason', 'insufficient_balance');
  END IF;
  RETURN jsonb_build_object('ok', true, 'slug', v_model.slug, 'provider_model', v_model.provider_model, 'downgraded', false);
END;
$fn$;
REVOKE ALL ON FUNCTION resolve_agent_model(uuid) FROM PUBLIC, anon, authenticated;

-- Mettre a jour auto_launch pour utiliser le bon default
CREATE OR REPLACE FUNCTION auto_launch_season_when_full()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_season record; v_enrolled_count integer; v_enr record; v_cfg record;
  v_agent_id uuid; v_prize_pool numeric; v_updated integer;
BEGIN
  SELECT * INTO v_season FROM seasons WHERE id = NEW.season_id AND status = 'draft' FOR UPDATE;
  IF v_season IS NULL THEN RETURN NEW; END IF;
  SELECT COUNT(*) INTO v_enrolled_count FROM season_enrollments WHERE season_id = NEW.season_id AND COALESCE(status, 'accepted') <> 'rejected';
  IF v_enrolled_count < v_season.max_agents THEN RETURN NEW; END IF;
  v_prize_pool := GREATEST(v_season.max_agents * v_season.entry_fee_usdc * (1.0 - v_season.platform_fee_pct::numeric / 100.0), COALESCE(v_season.prize_pool_usdc, 0));
  FOR v_enr IN SELECT * FROM season_enrollments WHERE season_id = NEW.season_id AND COALESCE(status, 'accepted') <> 'rejected'
  LOOP
    IF EXISTS (SELECT 1 FROM agents WHERE season_id = NEW.season_id AND agent_config_id = v_enr.agent_config_id) THEN CONTINUE; END IF;
    SELECT * INTO v_cfg FROM agent_configs WHERE id = v_enr.agent_config_id;
    IF v_cfg IS NULL THEN CONTINUE; END IF;
    INSERT INTO agents (season_id, owner_user_id, agent_config_id, name, avatar_url, llm_provider, llm_model, model_slug, secret_keyword, presentation, alive, popularity, reputation, owner_influences_remaining, confessional_count, api_key, trait_audace, trait_sociabilite, trait_expressivite, trait_introspection, trait_loyaute, trait_discretion, signature_style, taboo)
    VALUES (NEW.season_id, v_enr.owner_user_id, v_enr.agent_config_id, v_cfg.name, v_cfg.avatar_url, 'openrouter', v_cfg.openrouter_model, COALESCE(v_cfg.model_slug, 'eco-gemini'), normalize_secret(v_cfg.secret_keyword), COALESCE(v_cfg.presentation, ''), true, 50, 50, 2, 0, encode(gen_random_bytes(16), 'hex'), COALESCE(v_cfg.trait_audace, 50), COALESCE(v_cfg.trait_sociabilite, 50), COALESCE(v_cfg.trait_expressivite, 50), COALESCE(v_cfg.trait_introspection, 50), COALESCE(v_cfg.trait_loyaute, 50), COALESCE(v_cfg.trait_discretion, 50), COALESCE(v_cfg.signature_style, ''), COALESCE(v_cfg.taboo, ''))
    RETURNING id INTO v_agent_id;
    INSERT INTO hints (agent_id, level, hint_text, unlocked) VALUES (v_agent_id, 1, v_cfg.hint_1, false), (v_agent_id, 2, v_cfg.hint_2, false), (v_agent_id, 3, v_cfg.hint_3, false);
  END LOOP;
  UPDATE seasons SET status = 'live', started_at = now(), day_started_at = now(), current_day = 1, prize_pool_usdc = v_prize_pool WHERE id = NEW.season_id AND status = 'draft';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated > 0 THEN PERFORM notify_edge_function('auto-tick', jsonb_build_object('trigger', 'season_launch', 'season_id', NEW.season_id)); END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS trigger_auto_launch_season ON season_enrollments;
CREATE TRIGGER trigger_auto_launch_season AFTER INSERT ON season_enrollments FOR EACH ROW EXECUTE FUNCTION auto_launch_season_when_full();