/*
  # Arbitrage part 2: slug migration, functions, tier trigger

  1. Migrates old custom slugs (eco-gemini, std-claude etc.) to real OpenRouter identifiers
  2. Reseeds game_settings free/secret model slugs
  3. Restores resolve_agent_model and auto_launch functions to use fallback_model()
  4. Adds tier classification trigger (classer_modele)
*/

-- 3. Slug migration
DO $$
DECLARE
  v_free text;
  v_row  record;
BEGIN
  SELECT slug INTO v_free
  FROM llm_models
  WHERE is_free AND enabled AND (expires_at IS NULL OR expires_at > now()::date)
    AND slug LIKE '%/%'
  ORDER BY context_length DESC, slug
  LIMIT 1;

  FOR v_row IN
    SELECT maison.slug AS ancien,
           COALESCE(reel.slug, v_free, 'openai/gpt-4o-mini') AS nouveau
    FROM llm_models maison
    LEFT JOIN llm_models reel
      ON reel.slug = maison.provider_model AND reel.slug LIKE '%/%'
    WHERE maison.slug NOT LIKE '%/%'
  LOOP
    UPDATE agent_configs SET model_slug = v_row.nouveau WHERE model_slug = v_row.ancien;
    UPDATE agents        SET model_slug = v_row.nouveau WHERE model_slug = v_row.ancien;
    IF to_regclass('public.game_settings') IS NOT NULL THEN
      UPDATE game_settings SET free_model_slug   = v_row.nouveau WHERE free_model_slug   = v_row.ancien;
      UPDATE game_settings SET secret_model_slug = v_row.nouveau WHERE secret_model_slug = v_row.ancien;
    END IF;
  END LOOP;

  DELETE FROM llm_models WHERE slug NOT LIKE '%/%';

  UPDATE agent_configs SET model_slug = COALESCE(v_free, 'openai/gpt-4o-mini')
  WHERE model_slug NOT IN (SELECT slug FROM llm_models);
  UPDATE agents SET model_slug = COALESCE(v_free, 'openai/gpt-4o-mini')
  WHERE model_slug NOT IN (SELECT slug FROM llm_models);
END $$;

UPDATE llm_models SET provider_model = slug WHERE provider_model IS DISTINCT FROM slug;
ALTER TABLE agent_configs ALTER COLUMN model_slug SET DEFAULT 'openai/gpt-4o-mini';
ALTER TABLE agents        ALTER COLUMN model_slug SET DEFAULT 'openai/gpt-4o-mini';
CREATE INDEX IF NOT EXISTS idx_models_provider ON llm_models (provider, label);
CREATE INDEX IF NOT EXISTS idx_models_free ON llm_models (is_free) WHERE enabled;

-- 4. Reseed game_settings
DO $$
BEGIN
  IF to_regclass('public.game_settings') IS NULL THEN RETURN; END IF;
  UPDATE game_settings
  SET free_model_slug = (
    SELECT slug FROM llm_models
    WHERE is_free AND enabled AND (expires_at IS NULL OR expires_at > now()::date)
    ORDER BY context_length DESC, slug LIMIT 1
  )
  WHERE free_model_slug IS NULL OR free_model_slug NOT IN (SELECT slug FROM llm_models WHERE enabled);

  UPDATE game_settings
  SET secret_model_slug = (
    SELECT slug FROM llm_models WHERE slug = 'openai/gpt-4o-mini' AND enabled
  )
  WHERE secret_model_slug IS NULL OR secret_model_slug NOT IN (SELECT slug FROM llm_models WHERE enabled);
END $$;

-- 5. Restore resolve_agent_model
CREATE OR REPLACE FUNCTION resolve_agent_model(p_agent_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_agent record; v_model record; v_balance numeric; v_fallback jsonb; v_reserve numeric := 0.05;
BEGIN
  SELECT a.id, a.model_slug, a.owner_user_id INTO v_agent FROM agents a WHERE a.id = p_agent_id;
  IF v_agent IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'agent_not_found'); END IF;
  v_fallback := fallback_model();
  SELECT * INTO v_model FROM llm_models WHERE slug = v_agent.model_slug AND enabled = true;
  IF v_model IS NULL THEN
    IF v_fallback IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_free_model'); END IF;
    RETURN jsonb_build_object('ok', true, 'slug', v_fallback->>'slug', 'provider_model', v_fallback->>'provider_model', 'downgraded', true, 'reason', 'model_retired');
  END IF;
  IF v_model.is_free THEN
    RETURN jsonb_build_object('ok', true, 'slug', v_model.slug, 'provider_model', v_model.provider_model, 'downgraded', false);
  END IF;
  SELECT balance_usdc INTO v_balance FROM users WHERE id = v_agent.owner_user_id;
  IF COALESCE(v_balance, 0) < v_reserve THEN
    IF v_fallback IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_free_model'); END IF;
    RETURN jsonb_build_object('ok', true, 'slug', v_fallback->>'slug', 'provider_model', v_fallback->>'provider_model', 'downgraded', true, 'reason', 'insufficient_balance');
  END IF;
  RETURN jsonb_build_object('ok', true, 'slug', v_model.slug, 'provider_model', v_model.provider_model, 'downgraded', false);
END;
$fn$;
REVOKE ALL ON FUNCTION resolve_agent_model(uuid) FROM PUBLIC, anon, authenticated;

-- 6. Tier classification trigger
CREATE OR REPLACE FUNCTION classer_modele()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE v_base integer;
BEGIN
  NEW.tier := CASE
    WHEN NEW.is_free THEN 'gratuit'
    WHEN NEW.price_out_per_mtok < 1.5 THEN 'economique'
    WHEN NEW.price_out_per_mtok < 8.0 THEN 'standard'
    WHEN NEW.price_out_per_mtok < 20.0 THEN 'avance'
    ELSE 'elite'
  END;
  v_base := CASE NEW.tier
    WHEN 'gratuit' THEN 1000 WHEN 'economique' THEN 2000 WHEN 'standard' THEN 3000 WHEN 'avance' THEN 4000 ELSE 5000
  END;
  NEW.sort_order := v_base + LEAST(999, GREATEST(0, CEIL(COALESCE(NEW.price_out_per_mtok, 0) * 10)::integer));
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trigger_classer_modele ON llm_models;
CREATE TRIGGER trigger_classer_modele
  BEFORE INSERT OR UPDATE OF is_free, price_out_per_mtok ON llm_models
  FOR EACH ROW EXECUTE FUNCTION classer_modele();

-- Apply tier classification to existing models
UPDATE llm_models SET price_out_per_mtok = price_out_per_mtok;

-- Clean up helper
DROP FUNCTION IF EXISTS exec_raw_sql(text);
DROP FUNCTION IF EXISTS flush_model_staging();