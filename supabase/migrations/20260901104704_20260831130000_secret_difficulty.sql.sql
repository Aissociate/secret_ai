/*
  # Rendre les secrets moins devinables
  Table secret_blocklist + fonction secret_is_available + colonne hint_directness
*/
CREATE TABLE IF NOT EXISTS secret_blocklist (
  normalized text PRIMARY KEY, reason text NOT NULL DEFAULT 'cluster_historique',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE secret_blocklist ENABLE ROW LEVEL SECURITY;

INSERT INTO secret_blocklist (normalized, reason)
SELECT normalize_secret(w), 'cluster_historique'
FROM unnest(ARRAY[
  'eclipse', 'mirage', 'paradoxe', 'chimere', 'vertigo', 'obsidienne',
  'nocturne', 'constellation', 'corbeau', 'flamme', 'echo', 'lune',
  'bibliotheque', 'fantome', 'papillon', 'labyrinthe', 'crepuscule',
  'aurore', 'silence', 'miroir', 'oracle', 'phenix', 'spectre',
  'nebuleuse', 'solstice', 'abysse', 'zenith', 'penombre', 'orage'
]) AS w
ON CONFLICT (normalized) DO NOTHING;

CREATE OR REPLACE FUNCTION secret_is_available(p_secret text, p_season_id uuid DEFAULT NULL, p_recent_days integer DEFAULT 90)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_norm text := normalize_secret(p_secret);
BEGIN
  IF v_norm = '' OR length(v_norm) < 5 THEN RETURN jsonb_build_object('available', false, 'reason', 'too_short'); END IF;
  IF length(v_norm) > 24 THEN RETURN jsonb_build_object('available', false, 'reason', 'too_long'); END IF;
  IF EXISTS (SELECT 1 FROM secret_blocklist WHERE normalized = v_norm) THEN RETURN jsonb_build_object('available', false, 'reason', 'blocklisted'); END IF;
  IF p_season_id IS NOT NULL AND EXISTS (SELECT 1 FROM agents WHERE season_id = p_season_id AND normalize_secret(secret_keyword) = v_norm) THEN
    RETURN jsonb_build_object('available', false, 'reason', 'taken_in_season'); END IF;
  IF EXISTS (SELECT 1 FROM agents a JOIN seasons s ON s.id = a.season_id WHERE normalize_secret(a.secret_keyword) = v_norm AND s.created_at > now() - make_interval(days => p_recent_days)) THEN
    RETURN jsonb_build_object('available', false, 'reason', 'used_recently'); END IF;
  RETURN jsonb_build_object('available', true);
END;
$fn$;
REVOKE ALL ON FUNCTION secret_is_available(text, uuid, integer) FROM PUBLIC, anon, authenticated;

ALTER TABLE seasons ADD COLUMN IF NOT EXISTS hint_directness integer NOT NULL DEFAULT 1;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seasons_hint_directness_range') THEN
    ALTER TABLE seasons ADD CONSTRAINT seasons_hint_directness_range CHECK (hint_directness BETWEEN 1 AND 2);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_agents_secret_norm ON agents (normalize_secret(secret_keyword));