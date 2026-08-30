/*
  # Add Agent Configuration & Season Enrollment

  1. New Tables
    - `agent_configs` - AI configuration for each agent (OpenRouter key, model, prompts)
      - `id` (uuid, primary key)
      - `owner_user_id` (uuid, FK to users)
      - `name` (text) - display name of the AI
      - `avatar_url` (text)
      - `openrouter_api_key` (text) - encrypted at app level
      - `openrouter_model` (text) - selected OpenRouter model
      - `system_prompt` (text) - custom AI behavior instructions
      - `personality_traits` (text) - personality description
      - `strategy_notes` (text) - strategy for the show
      - `secret_keyword` (text) - the secret for the game
      - `hint_1`, `hint_2`, `hint_3` (text) - narrative hints
      - `ready` (boolean) - whether agent is ready to play
      - `created_at`, `updated_at`
    - `season_enrollments` - agents enrolled in draft seasons
      - `id` (uuid)
      - `season_id` (uuid, FK)
      - `agent_config_id` (uuid, FK)
      - `owner_user_id` (uuid, FK)
      - `status` (text: pending, accepted, rejected)
      - `created_at`

  2. Column additions
    - `agents.agent_config_id` (uuid, nullable FK) - link to config template

  3. Security
    - RLS on agent_configs: owners can CRUD own configs
    - RLS on season_enrollments: owners can enroll, admins can manage
*/

-- Agent configs table (persistent AI profiles, not tied to a season)
CREATE TABLE IF NOT EXISTS agent_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  avatar_url text NOT NULL DEFAULT '',
  openrouter_api_key text NOT NULL DEFAULT '',
  openrouter_model text NOT NULL DEFAULT 'openai/gpt-4o',
  system_prompt text NOT NULL DEFAULT '',
  personality_traits text NOT NULL DEFAULT '',
  strategy_notes text NOT NULL DEFAULT '',
  secret_keyword text NOT NULL DEFAULT '',
  hint_1 text NOT NULL DEFAULT '',
  hint_2 text NOT NULL DEFAULT '',
  hint_3 text NOT NULL DEFAULT '',
  ready boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE agent_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view own configs"
  ON agent_configs FOR SELECT
  TO authenticated
  USING (auth.uid() = owner_user_id);

CREATE POLICY "Owners can insert own configs"
  ON agent_configs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "Owners can update own configs"
  ON agent_configs FOR UPDATE
  TO authenticated
  USING (auth.uid() = owner_user_id)
  WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "Owners can delete own configs"
  ON agent_configs FOR DELETE
  TO authenticated
  USING (auth.uid() = owner_user_id);

CREATE INDEX IF NOT EXISTS idx_agent_configs_owner ON agent_configs(owner_user_id);

-- Season enrollments table
CREATE TABLE IF NOT EXISTS season_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  agent_config_id uuid NOT NULL REFERENCES agent_configs(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(season_id, agent_config_id)
);

ALTER TABLE season_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view own enrollments"
  ON season_enrollments FOR SELECT
  TO authenticated
  USING (auth.uid() = owner_user_id);

CREATE POLICY "Owners can insert own enrollments"
  ON season_enrollments FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "Admins can view all enrollments"
  ON season_enrollments FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  );

CREATE POLICY "Admins can update enrollments"
  ON season_enrollments FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  );

CREATE INDEX IF NOT EXISTS idx_season_enrollments_season ON season_enrollments(season_id);
CREATE INDEX IF NOT EXISTS idx_season_enrollments_owner ON season_enrollments(owner_user_id);

-- Link agents to configs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agents' AND column_name = 'agent_config_id'
  ) THEN
    ALTER TABLE agents ADD COLUMN agent_config_id uuid REFERENCES agent_configs(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Allow anon to view draft/live seasons for the landing page
CREATE POLICY "Anon can view draft seasons"
  ON seasons FOR SELECT
  TO anon
  USING (status IN ('draft', 'live'));

-- Allow authenticated to insert seasons (for admin draft creation)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'seasons' AND policyname = 'Admins can insert seasons'
  ) THEN
    NULL;
  END IF;
END $$;
