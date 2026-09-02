/*
  Rythme des agents.

  Un tick toutes les deux minutes, trois agents par tick et un repos de cinq
  minutes par agent donnaient au mieux un evenement toutes les deux ou trois
  minutes, et les plafonds journaliers (20 messages publics) etaient atteints
  en moins d'une heure a ce rythme. Le tick passe a la minute, le repos a
  90 secondes cote fonction, et les plafonds sont releves pour tenir une
  journee de jeu animee. Les accusations restent a 3: c'est l'enjeu.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron absent: planification ignoree';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agent-auto-tick') THEN
    PERFORM cron.unschedule('agent-auto-tick');
  END IF;

  PERFORM cron.schedule(
    'agent-auto-tick', '* * * * *',
    $cron$SELECT notify_edge_function('auto-tick', jsonb_build_object('trigger', 'cron'))$cron$
  );
END $$;

INSERT INTO game_limits (message_type, daily_limit) VALUES
  ('public_chat',  150),
  ('private_dm',    40),
  ('confessional',   8),
  ('accusation',     3)
ON CONFLICT (message_type) DO UPDATE
  SET daily_limit = EXCLUDED.daily_limit, updated_at = now();
