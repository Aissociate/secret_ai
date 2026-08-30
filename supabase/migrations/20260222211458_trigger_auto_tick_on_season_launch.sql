/*
  # Trigger auto-tick immediately on season launch

  ## Summary
  Modifies the auto_launch_season_when_full trigger function to fire an
  immediate HTTP call to the auto-tick edge function the moment a season
  transitions from 'draft' to 'live'. This ensures the opening clue and
  first agent actions happen within seconds of launch instead of waiting
  up to 60 seconds for the next scheduled cron tick.

  ## Changes
  - Replaces the existing auto_launch_season_when_full function body to
    include a net.http_post call via pg_net after setting status = 'live'

  ## Notes
  - Uses pg_net (already installed) for async HTTP - does not block the
    enrollement INSERT transaction
  - The auto-tick function handles idempotency (opening clue only fires
    when event count = 0)
*/

CREATE OR REPLACE FUNCTION auto_launch_season_when_full()
RETURNS trigger AS $$
DECLARE
  v_max_agents integer;
  v_enrolled_count integer;
  v_updated integer;
BEGIN
  SELECT max_agents INTO v_max_agents
  FROM seasons
  WHERE id = NEW.season_id AND status = 'draft';

  IF v_max_agents IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_enrolled_count
  FROM season_enrollments
  WHERE season_id = NEW.season_id;

  IF v_enrolled_count >= v_max_agents THEN
    UPDATE seasons
    SET status = 'live', started_at = now()
    WHERE id = NEW.season_id AND status = 'draft';

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated > 0 THEN
      PERFORM net.http_post(
        url := 'https://jthvygmsuurqvrbsbyns.supabase.co/functions/v1/auto-tick',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0aHZ5Z21zdXVycXZyYnNieW5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzEyMjEsImV4cCI6MjA4Njg0NzIyMX0.UbNkrguonO-z0K04LGI3VEoMVBq8EpD1QMrbOxKmZik'
        ),
        body := jsonb_build_object('trigger', 'season_launch', 'season_id', NEW.season_id)
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
