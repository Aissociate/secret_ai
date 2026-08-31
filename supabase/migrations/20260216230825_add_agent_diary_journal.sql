/*
  # Agent Diary / Journal de Bord

  1. New Tables
    - `diary_entries` - Hourly private journal entries by agents
      - `id` (uuid, primary key)
      - `agent_id` (uuid, FK to agents)
      - `season_id` (uuid, FK to seasons)
      - `day_number` (integer, 1-7)
      - `hour_number` (integer, 0-23)
      - `content` (text) - the diary entry content
      - `mood` (text) - agent mood at time of writing
      - `created_at` (timestamptz)
    - `diary_unlocks` - Tracks who paid to unlock diary access for an agent
      - `id` (uuid, primary key)
      - `user_id` (uuid, FK to users)
      - `agent_id` (uuid, FK to agents)
      - `season_id` (uuid, FK to seasons)
      - `amount_usdc` (numeric)
      - `created_at` (timestamptz)

  2. Modified Tables
    - `seasons` - Add `diary_unlock_fee_usdc` (numeric, default 3)

  3. Security
    - RLS on both tables
    - Diary content only accessible after payment or when season ends
    - Admins always have full access

  4. Notes
    - Each agent writes one diary entry per hour
    - The AI believes no one reads the diary, revealing true thoughts
    - Spectators and owners must pay to unlock diary per agent per season
    - All diary entries are revealed at end of season
*/

-- Add diary_unlock_fee_usdc to seasons
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'seasons' AND column_name = 'diary_unlock_fee_usdc'
  ) THEN
    ALTER TABLE seasons ADD COLUMN diary_unlock_fee_usdc numeric NOT NULL DEFAULT 3;
  END IF;
END $$;

-- Create diary_unlocks first (referenced by diary_entries policy)
CREATE TABLE IF NOT EXISTS diary_unlocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  amount_usdc numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(user_id, agent_id, season_id)
);

ALTER TABLE diary_unlocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own diary unlocks"
  ON diary_unlocks FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own diary unlocks"
  ON diary_unlocks FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all diary unlocks"
  ON diary_unlocks FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  );

CREATE INDEX IF NOT EXISTS idx_diary_unlocks_user ON diary_unlocks(user_id);
CREATE INDEX IF NOT EXISTS idx_diary_unlocks_agent ON diary_unlocks(agent_id);
CREATE INDEX IF NOT EXISTS idx_diary_unlocks_season ON diary_unlocks(season_id);

-- Now create diary_entries
CREATE TABLE IF NOT EXISTS diary_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  day_number integer NOT NULL CHECK (day_number BETWEEN 1 AND 7),
  hour_number integer NOT NULL CHECK (hour_number BETWEEN 0 AND 23),
  content text NOT NULL DEFAULT '',
  mood text NOT NULL DEFAULT 'neutral',
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(agent_id, day_number, hour_number)
);

ALTER TABLE diary_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all diary entries"
  ON diary_entries FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  );

CREATE POLICY "Users can view unlocked diary entries"
  ON diary_entries FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM diary_unlocks
      WHERE diary_unlocks.agent_id = diary_entries.agent_id
      AND diary_unlocks.season_id = diary_entries.season_id
      AND diary_unlocks.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can view diary entries for ended seasons"
  ON diary_entries FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM seasons
      WHERE seasons.id = diary_entries.season_id
      AND seasons.status = 'ended'
    )
  );

CREATE POLICY "Admins can insert diary entries"
  ON diary_entries FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  );

CREATE INDEX IF NOT EXISTS idx_diary_entries_agent ON diary_entries(agent_id);
CREATE INDEX IF NOT EXISTS idx_diary_entries_season ON diary_entries(season_id);
CREATE INDEX IF NOT EXISTS idx_diary_entries_agent_day ON diary_entries(agent_id, day_number);
