/*
  # Génération automatique du journal + alignement des quotas

  ## Journal intime
  Le journal est vendu au spectateur (prix affiché sur la fiche agent) mais sa
  génération exigeait un admin et n'était branchée sur aucune tâche planifiée :
  on payait l'accès à une page vide. Une tâche horaire le remplit désormais pour
  chaque saison en cours.

  ## Quotas
  Le plafond de confessionnaux valait 3 par jour côté `agent-api` et 1 par jour
  côté `auto-tick`, alors que les deux réservent sur le même compteur : le
  premier arrivé fixait la règle pour l'autre. Les limites sont désormais
  centralisées en base, lues par les deux chemins.
*/

-- ---------------------------------------------------------------------------
-- 1. Limites de jeu, source unique
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS game_limits (
  message_type text PRIMARY KEY,
  daily_limit  integer NOT NULL CHECK (daily_limit >= 0),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO game_limits (message_type, daily_limit) VALUES
  ('public_chat',  20),
  ('private_dm',    5),
  ('confessional',  3),
  ('accusation',    3)
ON CONFLICT (message_type) DO UPDATE
  SET daily_limit = EXCLUDED.daily_limit, updated_at = now();

ALTER TABLE game_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read game limits" ON game_limits;
CREATE POLICY "Anyone can read game limits"
  ON game_limits FOR SELECT
  TO anon, authenticated
  USING (true);

/*
  Variante de claim_message_quota qui lit le plafond en base plutôt que de le
  recevoir de l'appelant : c'est ce qui empêche deux chemins de réserver sur le
  même compteur avec des limites différentes.
*/
CREATE OR REPLACE FUNCTION claim_quota(
  p_agent_id     uuid,
  p_day_number   integer,
  p_message_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_limit integer;
BEGIN
  SELECT daily_limit INTO v_limit
  FROM game_limits WHERE message_type = p_message_type;

  IF v_limit IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'error', 'unknown_message_type');
  END IF;

  RETURN claim_message_quota(p_agent_id, p_day_number, p_message_type, v_limit);
END;
$fn$;

REVOKE ALL ON FUNCTION claim_quota(uuid, integer, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Génération planifiée du journal
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION tick_diaries()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_season record;
  v_count  integer := 0;
BEGIN
  FOR v_season IN SELECT id FROM seasons WHERE status = 'live'
  LOOP
    PERFORM notify_edge_function(
      'generate-diary',
      jsonb_build_object('season_id', v_season.id, 'trigger', 'cron')
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'seasons', v_count);
END;
$fn$;

REVOKE ALL ON FUNCTION tick_diaries() FROM PUBLIC, anon, authenticated;

-- generate-diary doit être acceptée par la liste blanche de notify_edge_function.
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
    'process-video-jobs', 'generate-diary'
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
    RAISE NOTICE 'pg_cron absent: planification du journal ignoree';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agent-diaries') THEN
    PERFORM cron.unschedule('agent-diaries');
  END IF;

  PERFORM cron.schedule(
    'agent-diaries', '30 * * * *',
    $cron$SELECT tick_diaries()$cron$
  );
END $$;
