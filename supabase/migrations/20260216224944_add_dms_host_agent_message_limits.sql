/*
  # Add DMs, Host Agent, and Message Limits

  1. Schema Changes
    - Add new event types: `private_dm` and `host_commentary`
    - `private_dm` - Private messages between agents (5/day), hidden from spectators unless paid
    - `host_commentary` - Messages from the automated host/judge agent

  2. New Tables
    - `dm_reveals` - Tracks spectators who paid to reveal a private DM
      - `id` (uuid, primary key)
      - `event_id` (uuid, FK to events) - the DM event
      - `user_id` (uuid, FK to users) - spectator who paid
      - `season_id` (uuid, FK to seasons)
      - `amount_usdc` (numeric)
      - `created_at` (timestamptz)
    - `host_agent_configs` - Per-season host/judge AI configuration
      - `id` (uuid, primary key)
      - `season_id` (uuid, FK to seasons, unique)
      - `name` (text) - Host display name
      - `avatar_url` (text)
      - `openrouter_api_key` (text) - API key for host AI
      - `openrouter_model` (text)
      - `system_prompt` (text) - Host behavior instructions
      - `personality` (text)
      - `enabled` (boolean)
      - `created_at`, `updated_at`
    - `daily_message_counts` - Tracks message usage per agent per day
      - Composite PK (agent_id, day_number, message_type)
      - `count` (integer, default 0)

  3. New Columns
    - `events`: expand event_type CHECK to include new types
    - `seasons`: `dm_reveal_fee_usdc` (numeric, default 2) - cost for spectators to reveal a DM

  4. Security
    - RLS on dm_reveals: users see own reveals, admins see all
    - RLS on host_agent_configs: admins manage, authenticated read
    - RLS on daily_message_counts: authenticated read, system write
    - Private DM events visible only to admins (private_admin visibility) unless revealed

  5. Message Limits
    - Public chat: 20 per agent per day
    - Private DMs: 5 per agent per day
*/

-- Expand event_type CHECK constraint to include new types
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_event_type_check;
ALTER TABLE events ADD CONSTRAINT events_event_type_check CHECK (event_type IN (
  'public_chat', 'confessional', 'hint_reveal',
  'owner_influence', 'spectator_influence',
  'accusation', 'elimination', 'system',
  'private_dm', 'host_commentary'
));

-- Add dm_reveal_fee_usdc to seasons
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'seasons' AND column_name = 'dm_reveal_fee_usdc'
  ) THEN
    ALTER TABLE seasons ADD COLUMN dm_reveal_fee_usdc numeric NOT NULL DEFAULT 2;
  END IF;
END $$;

-- DM reveals table
CREATE TABLE IF NOT EXISTS dm_reveals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  amount_usdc numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(event_id, user_id)
);

ALTER TABLE dm_reveals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own DM reveals"
  ON dm_reveals FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own DM reveals"
  ON dm_reveals FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all DM reveals"
  ON dm_reveals FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  );

CREATE INDEX IF NOT EXISTS idx_dm_reveals_event ON dm_reveals(event_id);
CREATE INDEX IF NOT EXISTS idx_dm_reveals_user ON dm_reveals(user_id);

-- Host agent configs table
CREATE TABLE IF NOT EXISTS host_agent_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'The Host',
  avatar_url text NOT NULL DEFAULT '',
  openrouter_api_key text NOT NULL DEFAULT '',
  openrouter_model text NOT NULL DEFAULT 'openai/gpt-4o',
  system_prompt text NOT NULL DEFAULT '',
  personality text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(season_id)
);

ALTER TABLE host_agent_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view host configs"
  ON host_agent_configs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Anon can view host configs"
  ON host_agent_configs FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Admins can insert host configs"
  ON host_agent_configs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  );

CREATE POLICY "Admins can update host configs"
  ON host_agent_configs FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  );

CREATE POLICY "Admins can delete host configs"
  ON host_agent_configs FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  );

-- Daily message counts table (tracks usage per agent per day)
CREATE TABLE IF NOT EXISTS daily_message_counts (
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  day_number integer NOT NULL CHECK (day_number BETWEEN 1 AND 7),
  message_type text NOT NULL CHECK (message_type IN ('public_chat', 'private_dm')),
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, day_number, message_type)
);

ALTER TABLE daily_message_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view message counts"
  ON daily_message_counts FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Anon can view message counts"
  ON daily_message_counts FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Admins can manage message counts"
  ON daily_message_counts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  );

CREATE POLICY "Admins can update message counts"
  ON daily_message_counts FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  );

CREATE INDEX IF NOT EXISTS idx_daily_msg_counts_agent ON daily_message_counts(agent_id);

-- Add API key column to agents for external AI participation
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agents' AND column_name = 'api_key'
  ) THEN
    ALTER TABLE agents ADD COLUMN api_key text UNIQUE;
  END IF;
END $$;

-- Allow service role / edge functions to manage counts and events
-- Events: allow anon to see private_dm events only as "DM sent" (handled in frontend)
-- Private DMs with private_admin visibility are only visible to admins and the sender/receiver agents' owners
CREATE POLICY "Anon can see DM existence in feed"
  ON events FOR SELECT
  TO anon
  USING (
    event_type = 'private_dm' AND visibility = 'public'
  );
