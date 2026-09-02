CREATE TABLE IF NOT EXISTS app_secrets (
  key   text PRIMARY KEY,
  value text NOT NULL
);

ALTER TABLE app_secrets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_app_secrets" ON app_secrets;
DROP POLICY IF EXISTS "insert_app_secrets" ON app_secrets;
DROP POLICY IF EXISTS "update_app_secrets" ON app_secrets;
DROP POLICY IF EXISTS "delete_app_secrets" ON app_secrets;
CREATE POLICY "select_app_secrets" ON app_secrets FOR SELECT
  TO authenticated USING (false);
CREATE POLICY "insert_app_secrets" ON app_secrets FOR INSERT
  TO authenticated WITH CHECK (false);
CREATE POLICY "update_app_secrets" ON app_secrets FOR UPDATE
  TO authenticated USING (false);
CREATE POLICY "delete_app_secrets" ON app_secrets FOR DELETE
  TO authenticated USING (false);

INSERT INTO app_secrets (key, value) VALUES
  ('cron_secret', 'b77f9cd0cb0d9a60ec32de2c086abf738dbf27af6cf55c28d3a73320e85ecac4'),
  ('supabase_url', 'https://srzxcujeisxslksnhuwm.supabase.co')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

CREATE OR REPLACE FUNCTION notify_edge_function(fn_name text, payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp, net
AS $$
DECLARE
  v_url    text;
  v_secret text;
BEGIN
  SELECT value INTO v_url    FROM app_secrets WHERE key = 'supabase_url';
  SELECT value INTO v_secret FROM app_secrets WHERE key = 'cron_secret';

  IF v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN
    RAISE WARNING 'notify_edge_function(%): supabase_url ou cron_secret non configure dans app_secrets', fn_name;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/' || fn_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', v_secret
    ),
    body    := payload
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_edge_function(%) a echoue: %', fn_name, SQLERRM;
END;
$$;
