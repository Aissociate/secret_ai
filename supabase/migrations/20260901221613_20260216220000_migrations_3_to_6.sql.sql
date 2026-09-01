/* # Add anonymous read policies + adjust hints RLS + agent configs + prize pool */

-- Migration 3: anon read policies
CREATE POLICY "Anon can view seasons" ON seasons FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can view agents" ON agents FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can view public events" ON events FOR SELECT TO anon USING (visibility = 'public');
CREATE POLICY "Anon can view unlocked hints" ON hints FOR SELECT TO anon USING (unlocked = true);

-- Migration 4: adjust hints RLS for board
DROP POLICY IF EXISTS "Anon can view unlocked hints" ON hints;
DROP POLICY IF EXISTS "Anyone authenticated can view unlocked hints" ON hints;
CREATE POLICY "Anon can view hints metadata" ON hints FOR SELECT TO anon USING (true);
CREATE POLICY "Authenticated can view hints metadata" ON hints FOR SELECT TO authenticated USING (true);

-- Migration 5: agent configs + enrollments
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
CREATE POLICY "Owners can view own configs" ON agent_configs FOR SELECT TO authenticated USING (auth.uid() = owner_user_id);
CREATE POLICY "Owners can insert own configs" ON agent_configs FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_user_id);
CREATE POLICY "Owners can update own configs" ON agent_configs FOR UPDATE TO authenticated USING (auth.uid() = owner_user_id) WITH CHECK (auth.uid() = owner_user_id);
CREATE POLICY "Owners can delete own configs" ON agent_configs FOR DELETE TO authenticated USING (auth.uid() = owner_user_id);
CREATE INDEX IF NOT EXISTS idx_agent_configs_owner ON agent_configs(owner_user_id);

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
CREATE POLICY "Owners can view own enrollments" ON season_enrollments FOR SELECT TO authenticated USING (auth.uid() = owner_user_id);
CREATE POLICY "Owners can insert own enrollments" ON season_enrollments FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_user_id);
CREATE POLICY "Admins can view all enrollments" ON season_enrollments FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Admins can update enrollments" ON season_enrollments FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')) WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE INDEX IF NOT EXISTS idx_season_enrollments_season ON season_enrollments(season_id);
CREATE INDEX IF NOT EXISTS idx_season_enrollments_owner ON season_enrollments(owner_user_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agents' AND column_name = 'agent_config_id') THEN
    ALTER TABLE agents ADD COLUMN agent_config_id uuid REFERENCES agent_configs(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE POLICY "Anon can view draft seasons" ON seasons FOR SELECT TO anon USING (status IN ('draft', 'live'));

-- Migration 6: prize pool enhancements
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'seasons' AND column_name = 'winner_agent_id') THEN ALTER TABLE seasons ADD COLUMN winner_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'seasons' AND column_name = 'influence_fee_usdc') THEN ALTER TABLE seasons ADD COLUMN influence_fee_usdc numeric NOT NULL DEFAULT 1; END IF; END $$;

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
CREATE POLICY "Users can view own distributions" ON prize_distributions FOR SELECT TO authenticated USING (auth.uid() = recipient_user_id);
CREATE POLICY "Admins can view all distributions" ON prize_distributions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Admins can insert distributions" ON prize_distributions FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Admins can update distributions" ON prize_distributions FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')) WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE INDEX IF NOT EXISTS idx_prize_distributions_season ON prize_distributions(season_id);
CREATE INDEX IF NOT EXISTS idx_prize_distributions_user ON prize_distributions(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_payments_season ON payments(season_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
