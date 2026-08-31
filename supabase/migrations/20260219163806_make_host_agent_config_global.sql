/*
  # Make host_agent_configs a global backoffice configuration

  ## Summary
  The host/presenter AI configuration is a single global config, not per-season.
  This migration removes the season_id dependency from host_agent_configs.

  ## Changes
  1. Consolidate to a single global row (keep the most recently updated one)
  2. Drop the FK constraint referencing seasons
  3. Drop the UNIQUE constraint on season_id
  4. Make season_id nullable (backward compat)
  5. Set all season_id values to NULL (global config)

  ## Notes
  - Existing per-season configs are merged into one global config
  - The edge function and API will fetch the single global record
*/

-- Step 1: Keep only the most recently updated config, delete the rest
DO $$
DECLARE
  keep_id uuid;
BEGIN
  SELECT id INTO keep_id FROM host_agent_configs ORDER BY updated_at DESC LIMIT 1;
  IF keep_id IS NOT NULL THEN
    DELETE FROM host_agent_configs WHERE id != keep_id;
  END IF;
END $$;

-- Step 2: Drop foreign key constraint on season_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'host_agent_configs'
      AND constraint_type = 'FOREIGN KEY'
      AND constraint_name LIKE '%season_id%'
  ) THEN
    ALTER TABLE host_agent_configs DROP CONSTRAINT IF EXISTS host_agent_configs_season_id_fkey;
  END IF;
END $$;

-- Step 3: Drop UNIQUE constraint on season_id
ALTER TABLE host_agent_configs DROP CONSTRAINT IF EXISTS host_agent_configs_season_id_key;

-- Step 4: Make season_id nullable
ALTER TABLE host_agent_configs ALTER COLUMN season_id DROP NOT NULL;

-- Step 5: Set season_id to NULL (global config)
UPDATE host_agent_configs SET season_id = NULL;
