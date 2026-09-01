CREATE TABLE IF NOT EXISTS _model_staging (
  slug text PRIMARY KEY,
  label text NOT NULL,
  provider text NOT NULL DEFAULT '',
  price_in numeric NOT NULL DEFAULT 0,
  price_out numeric NOT NULL DEFAULT 0,
  ctx integer NOT NULL DEFAULT 0,
  free boolean NOT NULL DEFAULT false,
  exp date,
  blurb text NOT NULL DEFAULT ''
);

CREATE OR REPLACE FUNCTION flush_model_staging()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_count integer;
BEGIN
  INSERT INTO llm_models (slug, label, provider, provider_model, price_in_per_mtok, price_out_per_mtok, context_length, is_free, expires_at, blurb, tier, sort_order, enabled, synced_at)
  SELECT s.slug, s.label, s.provider, s.slug, s.price_in, s.price_out, s.ctx, s.free, s.exp, s.blurb, 'standard', 100, true, now()
  FROM _model_staging s
  ON CONFLICT (slug) DO UPDATE SET
    label = EXCLUDED.label,
    provider = EXCLUDED.provider,
    provider_model = EXCLUDED.provider_model,
    price_in_per_mtok = EXCLUDED.price_in_per_mtok,
    price_out_per_mtok = EXCLUDED.price_out_per_mtok,
    context_length = EXCLUDED.context_length,
    is_free = EXCLUDED.is_free,
    expires_at = EXCLUDED.expires_at,
    blurb = EXCLUDED.blurb,
    enabled = true,
    synced_at = now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;
