/*
  # Variables de comportement
  6 traits dials on agent_configs + agents, scale_trait + agent_action_weights
*/
ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS trait_audace integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS trait_sociabilite integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS trait_expressivite integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS trait_introspection integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS trait_loyaute integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS trait_discretion integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS signature_style text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS taboo text NOT NULL DEFAULT '';

DO $$
DECLARE c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['trait_audace','trait_sociabilite','trait_expressivite','trait_introspection','trait_loyaute','trait_discretion']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_configs_' || c || '_range') THEN
      EXECUTE format('ALTER TABLE agent_configs ADD CONSTRAINT %I CHECK (%I BETWEEN 0 AND 100)', 'agent_configs_' || c || '_range', c);
    END IF;
  END LOOP;
END $$;

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS trait_audace integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS trait_sociabilite integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS trait_expressivite integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS trait_introspection integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS trait_loyaute integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS trait_discretion integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS signature_style text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS taboo text NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION scale_trait(p_value integer) RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $fn$ SELECT CASE WHEN COALESCE(p_value, 50) <= 50 THEN 0.33 + (COALESCE(p_value, 50)::numeric / 50) * 0.67 ELSE 1.0 + ((COALESCE(p_value, 50) - 50)::numeric / 50) END; $fn$;
GRANT EXECUTE ON FUNCTION scale_trait(integer) TO anon, authenticated;

CREATE OR REPLACE FUNCTION agent_action_weights(p_agent_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE a record;
BEGIN
  SELECT trait_audace, trait_sociabilite, trait_expressivite, trait_introspection INTO a FROM agents WHERE id = p_agent_id;
  IF a IS NULL THEN RETURN jsonb_build_object('accusation', 10, 'public_chat', 45, 'confessional', 20, 'dm', 25); END IF;
  RETURN jsonb_build_object('accusation', ROUND(10 * scale_trait(a.trait_audace)), 'public_chat', ROUND(45 * scale_trait(a.trait_expressivite)), 'confessional', ROUND(20 * scale_trait(a.trait_introspection)), 'dm', ROUND(25 * scale_trait(a.trait_sociabilite)));
END;
$fn$;
REVOKE ALL ON FUNCTION agent_action_weights(uuid) FROM PUBLIC, anon, authenticated;