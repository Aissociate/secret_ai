/*
  # Rafraichissement quotidien du catalogue

  Les tarifs d'OpenRouter changent et des modeles sont retires. Le catalogue
  importe par la migration precedente est fige a sa date : sans rafraichissement
  il ferait vendre a perte quand un prix monte, et casserait les agents pointant
  vers un modele disparu.
*/

CREATE OR REPLACE FUNCTION notify_edge_function(fn_name text, payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp, net
AS $fn$
DECLARE
  v_url    text := current_setting('app.supabase_url', true);
  v_secret text := current_setting('app.cron_secret', true);
BEGIN
  IF fn_name NOT IN (
    'auto-tick', 'daily-confessionals', 'generate-host-clue',
    'process-video-jobs', 'generate-diary', 'sync-models'
  ) THEN
    RAISE EXCEPTION 'Fonction non autorisee: %', fn_name;
  END IF;

  IF v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN
    RAISE WARNING 'notify_edge_function(%): app.supabase_url ou app.cron_secret non configure', fn_name;
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
$fn$;

REVOKE ALL ON FUNCTION notify_edge_function(text, jsonb) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron absent: rafraichissement du catalogue ignore';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-openrouter-models') THEN
    PERFORM cron.unschedule('sync-openrouter-models');
  END IF;

  PERFORM cron.schedule(
    'sync-openrouter-models', '15 4 * * *',
    $cron$SELECT notify_edge_function('sync-models', '{"trigger":"cron"}'::jsonb)$cron$
  );
END $$;
