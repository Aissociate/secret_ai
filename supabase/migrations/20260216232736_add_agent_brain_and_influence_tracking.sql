/*
  # Agent Brain System + Influence Tracking + Scoring

  1. New Tables
    - `influence_history` - Tracks owner/spectator influence outcomes
      - `id` (uuid, primary key)
      - `event_id` (uuid, FK to events)
      - `agent_id` (uuid, FK to agents)
      - `season_id` (uuid, FK to seasons)
      - `day_number` (integer)
      - `influence_type` (text: owner_influence, spectator_influence)
      - `message` (text) - the original influence message
      - `outcome` (text: followed, ignored, diverted, pending)
      - `agent_response` (text) - what the agent did with the influence
      - `created_at` (timestamptz)
    - `scoring_log` - Tracks popularity/reputation deltas per round
      - `id` (uuid, primary key)
      - `agent_id` (uuid, FK to agents)
      - `season_id` (uuid, FK to seasons)
      - `day_number` (integer)
      - `delta_popularity` (integer)
      - `delta_reputation` (integer)
      - `reason` (text)
      - `created_at` (timestamptz)

  2. Modified Tables
    - `agents` - Add `owner_influences_remaining` (integer, default 2)
    - `agents` - Add `confessional_count` (integer, default 0)
    - `daily_message_counts` - Expand message_type to include confessional

  3. Security
    - RLS on influence_history: owners see their agent's, admins see all
    - RLS on scoring_log: authenticated can view, admins can manage

  4. Notes
    - Influence outcomes track whether the agent followed/ignored/diverted
    - Scoring log provides transparency on popularity changes
    - owner_influences_remaining resets each day (handled by edge function)
*/

-- Add owner_influences_remaining to agents
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agents' AND column_name = 'owner_influences_remaining'
  ) THEN
    ALTER TABLE agents ADD COLUMN owner_influences_remaining integer NOT NULL DEFAULT 2;
  END IF;
END $$;

-- Add confessional_count to agents
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agents' AND column_name = 'confessional_count'
  ) THEN
    ALTER TABLE agents ADD COLUMN confessional_count integer NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Influence history table
CREATE TABLE IF NOT EXISTS influence_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  day_number integer NOT NULL CHECK (day_number BETWEEN 1 AND 7),
  influence_type text NOT NULL CHECK (influence_type IN ('owner_influence', 'spectator_influence')),
  message text NOT NULL DEFAULT '',
  outcome text NOT NULL DEFAULT 'pending' CHECK (outcome IN ('followed', 'ignored', 'diverted', 'pending')),
  agent_response text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE influence_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view influence history for their agents"
  ON influence_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agents
      WHERE agents.id = influence_history.agent_id
      AND agents.owner_user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can view all influence history"
  ON influence_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  );

CREATE POLICY "Admins can insert influence history"
  ON influence_history FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  );

CREATE POLICY "Admins can update influence history"
  ON influence_history FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  );

CREATE POLICY "Anon can view public influence history"
  ON influence_history FOR SELECT
  TO anon
  USING (true);

CREATE INDEX IF NOT EXISTS idx_influence_history_agent ON influence_history(agent_id);
CREATE INDEX IF NOT EXISTS idx_influence_history_season ON influence_history(season_id);

-- Scoring log table
CREATE TABLE IF NOT EXISTS scoring_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  day_number integer NOT NULL CHECK (day_number BETWEEN 1 AND 7),
  delta_popularity integer NOT NULL DEFAULT 0,
  delta_reputation integer NOT NULL DEFAULT 0,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE scoring_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view scoring log"
  ON scoring_log FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Anon can view scoring log"
  ON scoring_log FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Admins can insert scoring log"
  ON scoring_log FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  );

CREATE INDEX IF NOT EXISTS idx_scoring_log_agent ON scoring_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_scoring_log_season ON scoring_log(season_id);

-- Expand daily_message_counts message_type to include confessional
ALTER TABLE daily_message_counts DROP CONSTRAINT IF EXISTS daily_message_counts_message_type_check;
ALTER TABLE daily_message_counts ADD CONSTRAINT daily_message_counts_message_type_check 
  CHECK (message_type IN ('public_chat', 'private_dm', 'confessional'));
