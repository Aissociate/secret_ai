/*
  # Secret House MVP - Complete Schema

  1. New Tables
    - users, seasons, agents, hints, allowances_daily, payments, events
  2. Security: RLS on all tables with authenticated policies
  3. Indexes on events and agents
*/

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'spectator' CHECK (role IN ('owner', 'spectator', 'admin')),
  username text UNIQUE NOT NULL,
  wallet_address text,
  created_at timestamptz DEFAULT now() NOT NULL
);
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own profile" ON users FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON users FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON users FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE TABLE IF NOT EXISTS seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'ended')),
  title text NOT NULL,
  entry_fee_usdc numeric NOT NULL DEFAULT 0,
  platform_fee_pct integer NOT NULL DEFAULT 20,
  prize_pool_usdc numeric NOT NULL DEFAULT 0,
  max_agents integer NOT NULL DEFAULT 6,
  current_day integer NOT NULL DEFAULT 1 CHECK (current_day BETWEEN 1 AND 7),
  created_at timestamptz DEFAULT now() NOT NULL,
  started_at timestamptz,
  ended_at timestamptz
);
ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can view seasons" ON seasons FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert seasons" ON seasons FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Admins can update seasons" ON seasons FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')) WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));

CREATE TABLE IF NOT EXISTS agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  avatar_url text NOT NULL DEFAULT '',
  llm_provider text NOT NULL DEFAULT '',
  llm_model text NOT NULL DEFAULT '',
  secret_keyword text NOT NULL DEFAULT '',
  alive boolean NOT NULL DEFAULT true,
  popularity integer NOT NULL DEFAULT 0 CHECK (popularity BETWEEN 0 AND 100),
  reputation integer NOT NULL DEFAULT 50 CHECK (reputation BETWEEN 0 AND 100),
  created_at timestamptz DEFAULT now() NOT NULL
);
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can view agents" ON agents FOR SELECT TO authenticated USING (true);
CREATE POLICY "Owners can insert their agents" ON agents FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_user_id);
CREATE POLICY "Owners can update their agents" ON agents FOR UPDATE TO authenticated USING (auth.uid() = owner_user_id) WITH CHECK (auth.uid() = owner_user_id);
CREATE INDEX IF NOT EXISTS idx_agents_season_id ON agents(season_id);

CREATE TABLE IF NOT EXISTS hints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  level integer NOT NULL CHECK (level IN (1, 2, 3)),
  hint_text text NOT NULL DEFAULT '',
  unlocked boolean NOT NULL DEFAULT false,
  unlocked_at timestamptz,
  UNIQUE(agent_id, level)
);
ALTER TABLE hints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can view unlocked hints" ON hints FOR SELECT TO authenticated USING (unlocked = true);
CREATE POLICY "Admins can view all hints" ON hints FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Admins can insert hints" ON hints FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Admins can update hints" ON hints FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')) WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE INDEX IF NOT EXISTS idx_hints_agent_id ON hints(agent_id);

CREATE TABLE IF NOT EXISTS allowances_daily (
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_number integer NOT NULL CHECK (day_number BETWEEN 1 AND 7),
  used_count integer NOT NULL DEFAULT 0 CHECK (used_count BETWEEN 0 AND 2),
  PRIMARY KEY (season_id, owner_user_id, day_number)
);
ALTER TABLE allowances_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners can view own allowances" ON allowances_daily FOR SELECT TO authenticated USING (auth.uid() = owner_user_id);
CREATE POLICY "Owners can insert own allowances" ON allowances_daily FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_user_id);
CREATE POLICY "Owners can update own allowances" ON allowances_daily FOR UPDATE TO authenticated USING (auth.uid() = owner_user_id) WITH CHECK (auth.uid() = owner_user_id);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('entry', 'influence')),
  amount_usdc numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'failed')),
  tx_ref text,
  created_at timestamptz DEFAULT now() NOT NULL
);
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own payments" ON payments FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own payments" ON payments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all payments" ON payments FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  day_number integer NOT NULL CHECK (day_number BETWEEN 1 AND 7),
  event_type text NOT NULL CHECK (event_type IN ('public_chat', 'confessional', 'hint_reveal', 'owner_influence', 'spectator_influence', 'accusation', 'elimination', 'system')),
  actor_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  target_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private_admin')),
  created_at timestamptz DEFAULT now() NOT NULL
);
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can view public events" ON events FOR SELECT TO authenticated USING (visibility = 'public');
CREATE POLICY "Admins can view all events" ON events FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Admins can insert events" ON events FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Authenticated users can insert influence events" ON events FOR INSERT TO authenticated WITH CHECK (event_type IN ('owner_influence', 'spectator_influence') AND auth.uid() = actor_user_id);
CREATE INDEX IF NOT EXISTS idx_events_season_day ON events(season_id, day_number);
CREATE INDEX IF NOT EXISTS idx_events_actor_agent ON events(actor_agent_id);
CREATE INDEX IF NOT EXISTS idx_events_target_agent ON events(target_agent_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);
