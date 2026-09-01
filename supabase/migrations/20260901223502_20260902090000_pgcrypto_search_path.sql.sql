/* # Migration 58: pgcrypto search_path fix */
DO $$
DECLARE v_schema text;
BEGIN
  SELECT n.nspname INTO v_schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pgcrypto';
  IF v_schema IS NULL THEN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
      EXECUTE 'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions';
      v_schema := 'extensions';
    ELSE
      EXECUTE 'CREATE EXTENSION IF NOT EXISTS pgcrypto';
      SELECT n.nspname INTO v_schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pgcrypto';
    END IF;
  END IF;
  IF v_schema IS NULL THEN RAISE EXCEPTION 'pgcrypto introuvable'; END IF;
  IF v_schema = 'public' THEN
    EXECUTE 'ALTER FUNCTION auto_launch_season_when_full() SET search_path = public, pg_temp';
  ELSE
    EXECUTE format('ALTER FUNCTION auto_launch_season_when_full() SET search_path = public, %I, pg_temp', v_schema);
  END IF;
  RAISE NOTICE 'auto_launch_season_when_full: search_path = public, %, pg_temp', v_schema;
END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'gen_random_bytes') THEN RAISE EXCEPTION 'gen_random_bytes introuvable'; END IF; END $$;
