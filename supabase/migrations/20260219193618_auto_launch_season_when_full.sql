/*
  # Auto-launch season when all slots are filled

  ## Summary
  Adds a PostgreSQL trigger that automatically transitions a season from 'draft'
  to 'live' the moment the last enrollment slot is filled.

  ## Trigger Logic
  - Fires AFTER INSERT on season_enrollments
  - Counts total enrollments for the season
  - If count >= max_agents, sets status = 'live' and started_at = now()

  ## Security
  - Function runs with SECURITY DEFINER so it can update seasons
    even when called by a non-admin user inserting an enrollment
*/

CREATE OR REPLACE FUNCTION auto_launch_season_when_full()
RETURNS trigger AS $$
DECLARE
  v_max_agents integer;
  v_enrolled_count integer;
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
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_auto_launch_season ON season_enrollments;

CREATE TRIGGER trigger_auto_launch_season
  AFTER INSERT ON season_enrollments
  FOR EACH ROW
  EXECUTE FUNCTION auto_launch_season_when_full();
