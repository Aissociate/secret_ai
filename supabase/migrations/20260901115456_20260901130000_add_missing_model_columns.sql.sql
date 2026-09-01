/*
  # Add missing llm_models columns from OpenRouter catalog schema

  Adds context_length, is_free, expires_at, synced_at columns that the
  game_settings migration depends on. Also relaxes blurb and provider_model
  constraints and drops the old tier check.
*/

ALTER TABLE llm_models
  ADD COLUMN IF NOT EXISTS context_length integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_free        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS expires_at     date,
  ADD COLUMN IF NOT EXISTS synced_at      timestamptz NOT NULL DEFAULT now();

ALTER TABLE llm_models ALTER COLUMN blurb DROP NOT NULL;
ALTER TABLE llm_models ALTER COLUMN provider_model DROP NOT NULL;
ALTER TABLE llm_models ALTER COLUMN tier SET DEFAULT 'standard';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'llm_models_tier_check') THEN
    ALTER TABLE llm_models DROP CONSTRAINT llm_models_tier_check;
  END IF;
END $$;

-- Mark existing free-tier models
UPDATE llm_models SET is_free = true WHERE tier = 'gratuit';

-- Set provider_model = slug where missing
UPDATE llm_models SET provider_model = slug WHERE provider_model IS DISTINCT FROM slug;

CREATE INDEX IF NOT EXISTS idx_models_provider ON llm_models (provider, label);
CREATE INDEX IF NOT EXISTS idx_models_free ON llm_models (is_free) WHERE enabled;