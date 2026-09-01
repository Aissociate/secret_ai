/*
  # Wire resolve_agent_model to game_settings fallback

  Updates resolve_agent_model to use fallback_model() from game_settings
  instead of hardcoded tier lookups. Uses is_free column for free model check.
*/

CREATE OR REPLACE FUNCTION resolve_agent_model(p_agent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_agent    record;
  v_model    record;
  v_balance  numeric;
  v_fallback jsonb;
  v_reserve  numeric := 0.05;
BEGIN
  SELECT a.id, a.model_slug, a.owner_user_id INTO v_agent
  FROM agents a WHERE a.id = p_agent_id;

  IF v_agent IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'agent_not_found');
  END IF;

  v_fallback := fallback_model();

  SELECT * INTO v_model
  FROM llm_models WHERE slug = v_agent.model_slug AND enabled = true;

  IF v_model IS NULL THEN
    IF v_fallback IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_free_model');
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'slug', v_fallback->>'slug',
      'provider_model', v_fallback->>'provider_model',
      'downgraded', true, 'reason', 'model_retired'
    );
  END IF;

  IF v_model.is_free THEN
    RETURN jsonb_build_object(
      'ok', true, 'slug', v_model.slug,
      'provider_model', v_model.provider_model, 'downgraded', false
    );
  END IF;

  SELECT balance_usdc INTO v_balance FROM users WHERE id = v_agent.owner_user_id;

  IF COALESCE(v_balance, 0) < v_reserve THEN
    IF v_fallback IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_free_model');
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'slug', v_fallback->>'slug',
      'provider_model', v_fallback->>'provider_model',
      'downgraded', true, 'reason', 'insufficient_balance'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'slug', v_model.slug,
    'provider_model', v_model.provider_model, 'downgraded', false
  );
END;
$fn$;

REVOKE ALL ON FUNCTION resolve_agent_model(uuid) FROM PUBLIC, anon, authenticated;