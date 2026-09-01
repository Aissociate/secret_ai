/* # Migration 53-56: openrouter columns, sync cron, game_settings, wire_settings */

-- Add new columns to llm_models
ALTER TABLE llm_models ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT '';
ALTER TABLE llm_models ADD COLUMN IF NOT EXISTS context_length integer NOT NULL DEFAULT 0;
ALTER TABLE llm_models ADD COLUMN IF NOT EXISTS is_free boolean NOT NULL DEFAULT false;
ALTER TABLE llm_models ADD COLUMN IF NOT EXISTS expires_at date;
ALTER TABLE llm_models ADD COLUMN IF NOT EXISTS synced_at timestamptz;

-- Update llm_models tier check to include 'elite'
DO $$ DECLARE v_conname text; BEGIN
  SELECT conname INTO v_conname FROM pg_constraint WHERE conrelid = 'llm_models'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%tier%';
  IF v_conname IS NOT NULL THEN EXECUTE format('ALTER TABLE llm_models DROP CONSTRAINT %I', v_conname); END IF;
END $$;
ALTER TABLE llm_models ADD CONSTRAINT llm_models_tier_check CHECK (tier IN ('gratuit','economique','standard','avance','elite'));

-- Insert openai/gpt-4o-mini if not present (needed for game_settings FK)
INSERT INTO llm_models (slug, label, provider_model, price_in_per_mtok, price_out_per_mtok, tier, blurb, sort_order, provider, context_length, is_free)
VALUES ('openai/gpt-4o-mini', 'GPT-4o Mini', 'openai/gpt-4o-mini', 0.15, 0.60, 'economique', 'Bon rapport cout/finesse.', 20, 'openai', 128000, false)
ON CONFLICT (slug) DO UPDATE SET label = EXCLUDED.label, provider = EXCLUDED.provider, context_length = EXCLUDED.context_length, updated_at = now();

-- game_settings table
CREATE TABLE IF NOT EXISTS game_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  free_model_slug text REFERENCES llm_models(slug) ON UPDATE CASCADE ON DELETE SET NULL,
  secret_model_slug text REFERENCES llm_models(slug) ON UPDATE CASCADE ON DELETE SET NULL,
  secret_prompt text NOT NULL DEFAULT '',
  token_margin numeric(6,2) NOT NULL DEFAULT 3 CHECK (token_margin >= 1),
  welcome_bonus numeric(12,2) NOT NULL DEFAULT 200 CHECK (welcome_bonus >= 0),
  default_decay_pct integer NOT NULL DEFAULT 20 CHECK (default_decay_pct BETWEEN 0 AND 50),
  default_min_rep integer NOT NULL DEFAULT 30 CHECK (default_min_rep BETWEEN 0 AND 100),
  default_hint_directness integer NOT NULL DEFAULT 1 CHECK (default_hint_directness BETWEEN 1 AND 2),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL
);
ALTER TABLE game_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone reads settings" ON game_settings;
CREATE POLICY "Anyone reads settings" ON game_settings FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Admins update settings" ON game_settings;
CREATE POLICY "Admins update settings" ON game_settings FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')) WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
ALTER TABLE game_settings ADD COLUMN IF NOT EXISTS demo_topup_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE game_settings ADD COLUMN IF NOT EXISTS demo_topup_amount numeric(12,2) NOT NULL DEFAULT 100 CHECK (demo_topup_amount > 0);
ALTER TABLE game_settings ADD COLUMN IF NOT EXISTS demo_topup_cap numeric(12,2) NOT NULL DEFAULT 1000 CHECK (demo_topup_cap >= 0);

INSERT INTO game_settings (id, free_model_slug, secret_model_slug, secret_prompt)
SELECT true, 'openai/gpt-4o-mini', 'openai/gpt-4o-mini', 'Tu es le maitre du jeu.'
ON CONFLICT (id) DO NOTHING;

-- Update token_margin to read from game_settings
CREATE OR REPLACE FUNCTION token_margin() RETURNS numeric LANGUAGE sql STABLE SET search_path = public, pg_temp AS $fn$ SELECT COALESCE((SELECT token_margin FROM game_settings WHERE id), NULLIF(current_setting('app.token_margin', true), '')::numeric, 3.0); $fn$;
GRANT EXECUTE ON FUNCTION token_margin() TO anon, authenticated;

CREATE OR REPLACE FUNCTION welcome_bonus_amount() RETURNS numeric LANGUAGE sql STABLE SET search_path = public, pg_temp AS $fn$ SELECT COALESCE((SELECT welcome_bonus FROM game_settings WHERE id), NULLIF(current_setting('app.welcome_bonus', true), '')::numeric, 200); $fn$;
GRANT EXECUTE ON FUNCTION welcome_bonus_amount() TO anon, authenticated;

CREATE OR REPLACE FUNCTION fallback_model() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$ SELECT jsonb_build_object('slug', slug, 'provider_model', provider_model) FROM (SELECT m.slug, m.provider_model, 0 AS rank FROM llm_models m WHERE m.enabled AND m.slug = COALESCE((SELECT free_model_slug FROM game_settings WHERE id), '') UNION ALL SELECT m.slug, m.provider_model, 1 FROM llm_models m WHERE m.enabled AND m.is_free AND (m.expires_at IS NULL OR m.expires_at > now()::date) ORDER BY rank, slug LIMIT 1) pick; $fn$;
REVOKE ALL ON FUNCTION fallback_model() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION demo_topup() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$ DECLARE v_user uuid := auth.uid(); v_cfg record; v_already numeric; v_balance numeric; BEGIN IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF; SELECT demo_topup_enabled, demo_topup_amount, demo_topup_cap INTO v_cfg FROM game_settings WHERE id; IF NOT COALESCE(v_cfg.demo_topup_enabled, false) THEN RETURN jsonb_build_object('ok', false, 'error', 'topup_disabled'); END IF; SELECT COALESCE(SUM(amount_usdc), 0) INTO v_already FROM wallet_ledger WHERE user_id = v_user AND kind = 'deposit' AND note = 'Recharge de demonstration'; IF v_already + v_cfg.demo_topup_amount > v_cfg.demo_topup_cap THEN RETURN jsonb_build_object('ok', false, 'error', 'cap_reached', 'already', v_already, 'cap', v_cfg.demo_topup_cap); END IF; INSERT INTO wallet_ledger (user_id, kind, amount_usdc, note) VALUES (v_user, 'deposit', v_cfg.demo_topup_amount, 'Recharge de demonstration'); SELECT balance_usdc INTO v_balance FROM users WHERE id = v_user; RETURN jsonb_build_object('ok', true, 'credited', v_cfg.demo_topup_amount, 'balance', v_balance); END; $fn$;
REVOKE ALL ON FUNCTION demo_topup() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION demo_topup() TO authenticated;

-- wire_settings: resolve_agent_model using fallback_model
CREATE OR REPLACE FUNCTION resolve_agent_model(p_agent_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$ DECLARE v_agent record; v_model record; v_balance numeric; v_fallback jsonb; v_reserve numeric := 0.05; BEGIN SELECT a.id, a.model_slug, a.owner_user_id INTO v_agent FROM agents a WHERE a.id = p_agent_id; IF v_agent IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'agent_not_found'); END IF; v_fallback := fallback_model(); SELECT * INTO v_model FROM llm_models WHERE slug = v_agent.model_slug AND enabled = true; IF v_model IS NULL THEN IF v_fallback IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_free_model'); END IF; RETURN jsonb_build_object('ok', true, 'slug', v_fallback->>'slug', 'provider_model', v_fallback->>'provider_model', 'downgraded', true, 'reason', 'model_retired'); END IF; IF v_model.is_free THEN RETURN jsonb_build_object('ok', true, 'slug', v_model.slug, 'provider_model', v_model.provider_model, 'downgraded', false); END IF; SELECT balance_usdc INTO v_balance FROM users WHERE id = v_agent.owner_user_id; IF COALESCE(v_balance, 0) < v_reserve THEN IF v_fallback IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_free_model'); END IF; RETURN jsonb_build_object('ok', true, 'slug', v_fallback->>'slug', 'provider_model', v_fallback->>'provider_model', 'downgraded', true, 'reason', 'insufficient_balance'); END IF; RETURN jsonb_build_object('ok', true, 'slug', v_model.slug, 'provider_model', v_model.provider_model, 'downgraded', false); END; $fn$;
REVOKE ALL ON FUNCTION resolve_agent_model(uuid) FROM PUBLIC, anon, authenticated;

-- sync_models cron
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-openrouter-models') THEN PERFORM cron.unschedule('sync-openrouter-models'); END IF;
    PERFORM cron.schedule('sync-openrouter-models', '0 6 * * *', $cron$SELECT notify_edge_function('sync-models', jsonb_build_object('trigger', 'cron'))$cron$);
  END IF;
END $$;

-- Update notify_edge_function whitelist to include sync-models
CREATE OR REPLACE FUNCTION notify_edge_function(fn_name text, payload jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp, net AS $fn$ DECLARE v_url text := current_setting('app.supabase_url', true); v_secret text := current_setting('app.cron_secret', true); BEGIN IF fn_name NOT IN ('auto-tick','daily-confessionals','generate-host-clue','process-video-jobs','generate-diary','sync-models') THEN RAISE EXCEPTION 'Fonction non autorisee: %', fn_name; END IF; IF v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN RAISE WARNING 'notify_edge_function(%): non configure', fn_name; RETURN; END IF; PERFORM net.http_post(url := v_url || '/functions/v1/' || fn_name, headers := jsonb_build_object('Content-Type', 'application/json', 'X-Cron-Secret', v_secret), body := payload); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'notify_edge_function(%) a echoue: %', fn_name, SQLERRM; END; $fn$;
REVOKE ALL ON FUNCTION notify_edge_function(text, jsonb) FROM PUBLIC, anon, authenticated;
