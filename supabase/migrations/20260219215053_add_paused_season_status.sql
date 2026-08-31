/*
  # Add 'paused' status to seasons

  ## Changes
  - Drops the existing `seasons_status_check` constraint
  - Recreates it with the additional 'paused' value: 'draft' | 'live' | 'paused' | 'ended'

  ## Notes
  - Paused seasons are excluded from auto-tick processing (the tick already filters on status = 'live')
  - Admins can pause/resume a live season from the live view
*/

ALTER TABLE seasons DROP CONSTRAINT IF EXISTS seasons_status_check;

ALTER TABLE seasons ADD CONSTRAINT seasons_status_check
  CHECK (status = ANY (ARRAY['draft'::text, 'live'::text, 'paused'::text, 'ended'::text]));
