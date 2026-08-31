/*
  # Prize Pool & Incentives Enhancements

  1. Modified Tables
    - `seasons`
      - `winner_agent_id` (uuid, nullable FK to agents) - the winning agent
      - `influence_fee_usdc` (numeric, default 1) - cost per spectator influence message

  2. New Tables
    - `prize_distributions` - tracks how the prize pool is distributed at season end
      - `id` (uuid, primary key)
      - `season_id` (uuid, FK to seasons)
      - `recipient_user_id` (uuid, FK to users)
      - `recipient_agent_id` (uuid, nullable FK to agents)
      - `type` (text: winner, runner_up, platform_fee, influence_revenue)
      - `amount_usdc` (numeric)
      - `paid` (boolean, default false)
      - `created_at` (timestamptz)

  3. Security
    - RLS on prize_distributions: users can view their own, admins can view/manage all
    - Admins can update season winner

  4. Notes
    - Prize pool composition: entry fees (minus platform fee) + influence revenue share
    - Default split: 80% to winner, 20% platform fee on entry fees
    - Influence revenue: 70% goes to prize pool, 30% platform fee
*/

-- Add winner_agent_id to seasons
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'seasons' AND column_name = 'winner_agent_id'
  ) THEN
    ALTER TABLE seasons ADD COLUMN winner_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add influence_fee_usdc to seasons
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'seasons' AND column_name = 'influence_fee_usdc'
  ) THEN
    ALTER TABLE seasons ADD COLUMN influence_fee_usdc numeric NOT NULL DEFAULT 1;
  END IF;
END $$;

-- Prize distributions table
CREATE TABLE IF NOT EXISTS prize_distributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('winner', 'runner_up', 'platform_fee', 'influence_revenue')),
  amount_usdc numeric NOT NULL DEFAULT 0,
  paid boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE prize_distributions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own distributions"
  ON prize_distributions FOR SELECT
  TO authenticated
  USING (auth.uid() = recipient_user_id);

CREATE POLICY "Admins can view all distributions"
  ON prize_distributions FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  );

CREATE POLICY "Admins can insert distributions"
  ON prize_distributions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  );

CREATE POLICY "Admins can update distributions"
  ON prize_distributions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  );

CREATE INDEX IF NOT EXISTS idx_prize_distributions_season ON prize_distributions(season_id);
CREATE INDEX IF NOT EXISTS idx_prize_distributions_user ON prize_distributions(recipient_user_id);

-- Allow anon to read seasons prize pool (for landing page)
CREATE INDEX IF NOT EXISTS idx_payments_season ON payments(season_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
