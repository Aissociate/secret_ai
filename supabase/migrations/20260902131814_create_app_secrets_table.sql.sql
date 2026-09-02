CREATE TABLE IF NOT EXISTS app_secrets (
  key   text PRIMARY KEY,
  value text NOT NULL
);

ALTER TABLE app_secrets ENABLE ROW LEVEL SECURITY;
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
