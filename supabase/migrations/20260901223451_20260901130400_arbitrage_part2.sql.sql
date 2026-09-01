/* # Arbitrage part 2: slug migration, tier trigger, cleanup */

-- Delete old tier-based slugs
DELETE FROM llm_models WHERE slug NOT LIKE '%/%' AND slug NOT IN ('gratuit','rapide','solide','elite');

-- Update agent_configs and agents to use real OpenRouter slugs
UPDATE agent_configs SET model_slug = 'openai/gpt-4o-mini' WHERE model_slug NOT IN (SELECT slug FROM llm_models);
UPDATE agents SET model_slug = 'openai/gpt-4o-mini' WHERE model_slug NOT IN (SELECT slug FROM llm_models);

-- Update game_settings slugs
UPDATE game_settings SET free_model_slug = 'openai/gpt-4o-mini' WHERE free_model_slug NOT IN (SELECT slug FROM llm_models WHERE enabled);
UPDATE game_settings SET secret_model_slug = 'openai/gpt-4o-mini' WHERE secret_model_slug NOT IN (SELECT slug FROM llm_models WHERE enabled);

-- Update provider_model = slug for all models
UPDATE llm_models SET provider_model = slug WHERE provider_model IS DISTINCT FROM slug;

-- Set defaults
ALTER TABLE agent_configs ALTER COLUMN model_slug SET DEFAULT 'openai/gpt-4o-mini';
ALTER TABLE agents ALTER COLUMN model_slug SET DEFAULT 'openai/gpt-4o-mini';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_models_provider ON llm_models (provider, label);
CREATE INDEX IF NOT EXISTS idx_models_free ON llm_models (is_free) WHERE enabled;

-- Tier classification trigger
CREATE OR REPLACE FUNCTION classer_modele()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
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
    WHEN 'gratuit' THEN 1000
    WHEN 'economique' THEN 2000
    WHEN 'standard' THEN 3000
    WHEN 'avance' THEN 4000
    ELSE 5000
  END;
  NEW.sort_order := v_base + LEAST(999, GREATEST(0, CEIL(COALESCE(NEW.price_out_per_mtok, 0) * 10)::integer));
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trigger_classer_modele ON llm_models;
CREATE TRIGGER trigger_classer_modele
  BEFORE INSERT OR UPDATE OF is_free, price_out_per_mtok ON llm_models
  FOR EACH ROW EXECUTE FUNCTION classer_modele();

-- Apply tier classification to all existing models
UPDATE llm_models SET price_out_per_mtok = price_out_per_mtok;

-- Cleanup
DROP TABLE IF EXISTS _model_staging;
DROP FUNCTION IF EXISTS flush_model_staging();
