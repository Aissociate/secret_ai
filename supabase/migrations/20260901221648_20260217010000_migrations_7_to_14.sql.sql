/* # Migrations 7-14: DMs, diary, brain, display_name, admin, presentation, fix recursion */

-- Migration 7: DMs, host agent, message limits
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_event_type_check;
ALTER TABLE events ADD CONSTRAINT events_event_type_check CHECK (event_type IN (
  'public_chat', 'confessional', 'hint_reveal', 'owner_influence', 'spectator_influence',
  'accusation', 'elimination', 'system', 'private_dm', 'host_commentary'
));

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'seasons' AND column_name = 'dm_reveal_fee_usdc') THEN ALTER TABLE seasons ADD COLUMN dm_reveal_fee_usdc numeric NOT NULL DEFAULT 2; END IF; END $$;

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
CREATE POLICY "Users can view own DM reveals" ON dm_reveals FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own DM reveals" ON dm_reveals FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all DM reveals" ON dm_reveals FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE INDEX IF NOT EXISTS idx_dm_reveals_event ON dm_reveals(event_id);
CREATE INDEX IF NOT EXISTS idx_dm_reveals_user ON dm_reveals(user_id);

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
CREATE POLICY "Authenticated can view host configs" ON host_agent_configs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Anon can view host configs" ON host_agent_configs FOR SELECT TO anon USING (true);
CREATE POLICY "Admins can insert host configs" ON host_agent_configs FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Admins can update host configs" ON host_agent_configs FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')) WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Admins can delete host configs" ON host_agent_configs FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));

CREATE TABLE IF NOT EXISTS daily_message_counts (
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  day_number integer NOT NULL CHECK (day_number BETWEEN 1 AND 7),
  message_type text NOT NULL CHECK (message_type IN ('public_chat', 'private_dm')),
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, day_number, message_type)
);
ALTER TABLE daily_message_counts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view message counts" ON daily_message_counts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Anon can view message counts" ON daily_message_counts FOR SELECT TO anon USING (true);
CREATE POLICY "Admins can manage message counts" ON daily_message_counts FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Admins can update message counts" ON daily_message_counts FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')) WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE INDEX IF NOT EXISTS idx_daily_msg_counts_agent ON daily_message_counts(agent_id);

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agents' AND column_name = 'api_key') THEN ALTER TABLE agents ADD COLUMN api_key text UNIQUE; END IF; END $$;

CREATE POLICY "Anon can see DM existence in feed" ON events FOR SELECT TO anon USING (event_type = 'private_dm' AND visibility = 'public');

-- Migration 8: diary
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'seasons' AND column_name = 'diary_unlock_fee_usdc') THEN ALTER TABLE seasons ADD COLUMN diary_unlock_fee_usdc numeric NOT NULL DEFAULT 3; END IF; END $$;

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
CREATE POLICY "Users can view own diary unlocks" ON diary_unlocks FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own diary unlocks" ON diary_unlocks FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all diary unlocks" ON diary_unlocks FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE INDEX IF NOT EXISTS idx_diary_unlocks_user ON diary_unlocks(user_id);
CREATE INDEX IF NOT EXISTS idx_diary_unlocks_agent ON diary_unlocks(agent_id);
CREATE INDEX IF NOT EXISTS idx_diary_unlocks_season ON diary_unlocks(season_id);

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
CREATE POLICY "Admins can view all diary entries" ON diary_entries FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Users can view unlocked diary entries" ON diary_entries FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM diary_unlocks WHERE diary_unlocks.agent_id = diary_entries.agent_id AND diary_unlocks.season_id = diary_entries.season_id AND diary_unlocks.user_id = auth.uid()));
CREATE POLICY "Users can view diary entries for ended seasons" ON diary_entries FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM seasons WHERE seasons.id = diary_entries.season_id AND seasons.status = 'ended'));
CREATE POLICY "Admins can insert diary entries" ON diary_entries FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE INDEX IF NOT EXISTS idx_diary_entries_agent ON diary_entries(agent_id);
CREATE INDEX IF NOT EXISTS idx_diary_entries_season ON diary_entries(season_id);
CREATE INDEX IF NOT EXISTS idx_diary_entries_agent_day ON diary_entries(agent_id, day_number);

-- Migration 9: brain + influence tracking + scoring
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agents' AND column_name = 'owner_influences_remaining') THEN ALTER TABLE agents ADD COLUMN owner_influences_remaining integer NOT NULL DEFAULT 2; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agents' AND column_name = 'confessional_count') THEN ALTER TABLE agents ADD COLUMN confessional_count integer NOT NULL DEFAULT 0; END IF; END $$;

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
CREATE POLICY "Authenticated can view influence history for their agents" ON influence_history FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM agents WHERE agents.id = influence_history.agent_id AND agents.owner_user_id = auth.uid()));
CREATE POLICY "Admins can view all influence history" ON influence_history FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Admins can insert influence history" ON influence_history FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Admins can update influence history" ON influence_history FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')) WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Anon can view public influence history" ON influence_history FOR SELECT TO anon USING (true);
CREATE INDEX IF NOT EXISTS idx_influence_history_agent ON influence_history(agent_id);
CREATE INDEX IF NOT EXISTS idx_influence_history_season ON influence_history(season_id);

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
CREATE POLICY "Authenticated can view scoring log" ON scoring_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "Anon can view scoring log" ON scoring_log FOR SELECT TO anon USING (true);
CREATE POLICY "Admins can insert scoring log" ON scoring_log FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE INDEX IF NOT EXISTS idx_scoring_log_agent ON scoring_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_scoring_log_season ON scoring_log(season_id);

ALTER TABLE daily_message_counts DROP CONSTRAINT IF EXISTS daily_message_counts_message_type_check;
ALTER TABLE daily_message_counts ADD CONSTRAINT daily_message_counts_message_type_check CHECK (message_type IN ('public_chat', 'private_dm', 'confessional'));

-- Migration 10: display_name
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'display_name') THEN ALTER TABLE users ADD COLUMN display_name text; END IF; END $$;

-- Migration 11: admin role for contact
CREATE OR REPLACE FUNCTION set_user_role_by_email(user_email text, new_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE user_uuid uuid;
BEGIN
  SELECT id INTO user_uuid FROM auth.users WHERE email = user_email;
  IF user_uuid IS NOT NULL THEN UPDATE users SET role = new_role WHERE id = user_uuid; END IF;
END; $$;

-- Migration 12: presentation + fix policies
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agents' AND column_name = 'presentation') THEN ALTER TABLE agents ADD COLUMN presentation text DEFAULT ''; END IF; END $$;
DROP POLICY IF EXISTS "Admins can read all profiles" ON users;
DROP POLICY IF EXISTS "Admins can update all profiles" ON users;
DROP POLICY IF EXISTS "Users can read own profile" ON users;
DROP POLICY IF EXISTS "Users can update own profile" ON users;

-- Migration 13: presentation to agent_configs
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_configs' AND column_name = 'presentation') THEN ALTER TABLE agent_configs ADD COLUMN presentation text DEFAULT ''; END IF; END $$;

-- Migration 14: fix users RLS infinite recursion
DROP POLICY IF EXISTS "Users can read profiles" ON users;
DROP POLICY IF EXISTS "Users can update profiles" ON users;
DROP POLICY IF EXISTS "Users can insert own profile" ON users;
CREATE POLICY "Authenticated users can read all profiles" ON users FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert own profile on signup" ON users FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON users FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
