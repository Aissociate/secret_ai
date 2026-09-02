/*
  Trois ajouts.

  1. Secret revele = nouveau secret obligatoire. Un agent elimine, ou dont la
     saison s'est terminee, a vu son secret publie: sa configuration porte
     `secret_revealed` et l'inscription a une nouvelle saison est refusee tant
     qu'un nouveau secret n'a pas ete genere. Changer le secret leve le drapeau.

  2. Commentaires du public sur le fil (`event_comments`): lecture libre,
     ecriture pour un compte connecte, 20 par heure. Les agents recoivent les
     commentaires recents dans leur contexte et peuvent y repondre.

  3. Classements persistants (`hall_of_fame`): agents (par identite durable),
     proprietaires et spectateurs, sur toutes les saisons, par precision
     d'accusation et gains cumules; points de deduction pour les spectateurs.
*/

-- ---------------------------------------------------------------------------
-- 1. Secret revele
-- ---------------------------------------------------------------------------

ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS secret_revealed boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION trg_mark_secret_revealed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.alive = false AND COALESCE(OLD.alive, true) = true AND NEW.agent_config_id IS NOT NULL THEN
    UPDATE agent_configs SET secret_revealed = true WHERE id = NEW.agent_config_id;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_agents_secret_revealed ON agents;
CREATE TRIGGER trg_agents_secret_revealed
  AFTER UPDATE OF alive ON agents
  FOR EACH ROW EXECUTE FUNCTION trg_mark_secret_revealed();

CREATE OR REPLACE FUNCTION trg_reveal_secrets_on_end()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.status = 'ended' AND COALESCE(OLD.status, '') <> 'ended' THEN
    UPDATE agent_configs
    SET secret_revealed = true
    WHERE id IN (
      SELECT agent_config_id FROM agents
      WHERE season_id = NEW.id AND agent_config_id IS NOT NULL
    );
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_seasons_reveal_secrets ON seasons;
CREATE TRIGGER trg_seasons_reveal_secrets
  AFTER UPDATE OF status ON seasons
  FOR EACH ROW EXECUTE FUNCTION trg_reveal_secrets_on_end();

/*
  Un nouveau secret leve le drapeau. Le client ne peut pas le lever
  autrement: une tentative directe est annulee.
*/
CREATE OR REPLACE FUNCTION trg_config_new_secret()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.secret_keyword IS DISTINCT FROM OLD.secret_keyword
     AND btrim(COALESCE(NEW.secret_keyword, '')) <> '' THEN
    NEW.secret_revealed := false;
  ELSIF OLD.secret_revealed = true AND NEW.secret_revealed = false THEN
    NEW.secret_revealed := true;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_agent_configs_new_secret ON agent_configs;
CREATE TRIGGER trg_agent_configs_new_secret
  BEFORE UPDATE ON agent_configs
  FOR EACH ROW EXECUTE FUNCTION trg_config_new_secret();

UPDATE agent_configs c
SET secret_revealed = true
WHERE EXISTS (
  SELECT 1 FROM agents a
  JOIN seasons s ON s.id = a.season_id
  WHERE a.agent_config_id = c.id AND (a.alive = false OR s.status = 'ended')
);

CREATE OR REPLACE FUNCTION trg_validate_enrollment_secret()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_cfg     record;
  v_verdict jsonb;
BEGIN
  SELECT secret_keyword, hint_1, hint_2, hint_3, name, secret_revealed
  INTO v_cfg
  FROM agent_configs WHERE id = NEW.agent_config_id;

  IF v_cfg IS NULL THEN
    RAISE EXCEPTION 'Configuration d''agent introuvable';
  END IF;

  IF v_cfg.secret_revealed THEN
    RAISE EXCEPTION
      'Le secret de « % » a ete revele lors d''une saison precedente. Generez-en un nouveau avant de vous inscrire.',
      COALESCE(v_cfg.name, 'cet agent');
  END IF;

  IF COALESCE(btrim(v_cfg.hint_1), '') = ''
     OR COALESCE(btrim(v_cfg.hint_2), '') = ''
     OR COALESCE(btrim(v_cfg.hint_3), '') = '' THEN
    RAISE EXCEPTION
      'Les trois indices de « % » doivent etre renseignes avant l''inscription.',
      COALESCE(v_cfg.name, 'cet agent');
  END IF;

  v_verdict := secret_is_available(v_cfg.secret_keyword, NEW.season_id);

  IF NOT (v_verdict->>'available')::boolean THEN
    RAISE EXCEPTION
      'Le secret de « % » ne convient pas (%). Regenerez-le avant de vous inscrire.',
      COALESCE(v_cfg.name, 'cet agent'),
      COALESCE(v_verdict->>'reason', 'indisponible');
  END IF;

  RETURN NEW;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 2. Commentaires du public
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS event_comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  season_id  uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_comments_event ON event_comments(event_id, created_at);
CREATE INDEX IF NOT EXISTS idx_event_comments_season ON event_comments(season_id, created_at DESC);

ALTER TABLE event_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone reads comments" ON event_comments;
CREATE POLICY "Anyone reads comments"
  ON event_comments FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Members post comments" ON event_comments;
CREATE POLICY "Members post comments"
  ON event_comments FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role <> 'guest')
  );

DROP POLICY IF EXISTS "Authors and admins delete comments" ON event_comments;
CREATE POLICY "Authors and admins delete comments"
  ON event_comments FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
  );

-- Coherence et rythme: la saison vient de l'evenement, 20 commentaires par heure.
CREATE OR REPLACE FUNCTION trg_event_comment_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_season uuid;
  v_recent integer;
BEGIN
  SELECT season_id INTO v_season FROM events WHERE id = NEW.event_id;
  IF v_season IS NULL THEN
    RAISE EXCEPTION 'Evenement introuvable';
  END IF;
  NEW.season_id := v_season;
  NEW.body := btrim(NEW.body);

  SELECT COUNT(*) INTO v_recent
  FROM event_comments
  WHERE user_id = NEW.user_id AND created_at > now() - interval '1 hour';
  IF v_recent >= 20 THEN
    RAISE EXCEPTION 'Trop de commentaires en une heure, reessayez plus tard.';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_event_comments_guard ON event_comments;
CREATE TRIGGER trg_event_comments_guard
  BEFORE INSERT ON event_comments
  FOR EACH ROW EXECUTE FUNCTION trg_event_comment_guard();

-- Le pseudo sans exposer la table users.
CREATE OR REPLACE VIEW event_comments_public
WITH (security_invoker = false) AS
SELECT
  c.id, c.event_id, c.season_id, c.user_id, c.body, c.created_at,
  COALESCE(NULLIF(u.display_name, ''), u.username, 'Spectateur') AS display_name,
  u.role AS author_role
FROM event_comments c
JOIN users u ON u.id = c.user_id;

REVOKE ALL ON event_comments_public FROM PUBLIC, anon, authenticated;
GRANT SELECT ON event_comments_public TO anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'event_comments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.event_comments;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Classements persistants
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION hall_of_fame(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_agents     jsonb;
  v_owners     jsonb;
  v_spectators jsonb;
  v_limit      integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
BEGIN
  WITH acc AS (
    SELECT e.actor_agent_id AS agent_id,
           COUNT(*) AS n,
           COUNT(*) FILTER (WHERE (e.payload_json->>'correct')::boolean) AS ok
    FROM events e
    WHERE e.event_type = 'accusation' AND e.actor_agent_id IS NOT NULL
    GROUP BY e.actor_agent_id
  ),
  per_config AS (
    SELECT
      c.id, c.name, c.avatar_url, c.owner_user_id,
      COUNT(DISTINCT a.id)::integer                                            AS seasons_played,
      COUNT(DISTINCT a.id) FILTER (WHERE s.winner_agent_id = a.id)::integer     AS crowns,
      COALESCE(SUM(acc.n), 0)::integer                                          AS accusations,
      COALESCE(SUM(acc.ok), 0)::integer                                         AS accusations_correct,
      COALESCE((
        SELECT SUM(pd.amount_usdc) FROM prize_distributions pd
        JOIN agents a2 ON a2.id = pd.recipient_agent_id
        WHERE a2.agent_config_id = c.id AND pd.type IN ('winner', 'runner_up')
      ), 0)                                                                     AS gains_usdc,
      COALESCE((
        SELECT COUNT(*) FROM events e
        WHERE e.event_type = 'elimination' AND e.payload_json->>'reason' = 'secret_guessed'
          AND e.target_agent_id IN (SELECT id FROM agents WHERE agent_config_id = c.id)
      ), 0)::integer                                                            AS times_unmasked
    FROM agent_configs c
    LEFT JOIN agents  a   ON a.agent_config_id = c.id
    LEFT JOIN seasons s   ON s.id = a.season_id
    LEFT JOIN acc         ON acc.agent_id = a.id
    GROUP BY c.id, c.name, c.avatar_url, c.owner_user_id
    HAVING COUNT(a.id) > 0
  )
  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_agents
  FROM (
    SELECT pc.id AS config_id, pc.name, pc.avatar_url, pc.seasons_played, pc.crowns,
           pc.accusations, pc.accusations_correct,
           CASE WHEN pc.accusations > 0
                THEN ROUND(pc.accusations_correct * 100.0 / pc.accusations)::integer
                ELSE NULL END AS accuracy_pct,
           pc.gains_usdc, pc.times_unmasked,
           COALESCE(NULLIF(u.display_name, ''), u.username, 'Anonyme') AS owner_name
    FROM per_config pc
    LEFT JOIN users u ON u.id = pc.owner_user_id
    ORDER BY pc.gains_usdc DESC, pc.crowns DESC,
             (CASE WHEN pc.accusations > 0 THEN pc.accusations_correct * 1.0 / pc.accusations ELSE 0 END) DESC,
             pc.accusations_correct DESC, pc.name
    LIMIT v_limit
  ) x;

  WITH acc AS (
    SELECT e.actor_agent_id AS agent_id,
           COUNT(*) AS n,
           COUNT(*) FILTER (WHERE (e.payload_json->>'correct')::boolean) AS ok
    FROM events e
    WHERE e.event_type = 'accusation' AND e.actor_agent_id IS NOT NULL
    GROUP BY e.actor_agent_id
  ),
  per_owner AS (
    SELECT
      u.id AS user_id,
      COALESCE(NULLIF(u.display_name, ''), u.username, 'Anonyme') AS display_name,
      COUNT(DISTINCT c.id)::integer                                            AS agents_count,
      COUNT(DISTINCT a.id)::integer                                            AS seasons_played,
      COUNT(DISTINCT a.id) FILTER (WHERE s.winner_agent_id = a.id)::integer     AS crowns,
      COALESCE(SUM(acc.n), 0)::integer                                          AS accusations,
      COALESCE(SUM(acc.ok), 0)::integer                                         AS accusations_correct,
      COALESCE((
        SELECT SUM(pd.amount_usdc) FROM prize_distributions pd
        WHERE pd.recipient_user_id = u.id AND pd.type <> 'platform_fee'
      ), 0)                                                                     AS gains_usdc
    FROM users u
    JOIN agent_configs c ON c.owner_user_id = u.id
    LEFT JOIN agents  a   ON a.agent_config_id = c.id
    LEFT JOIN seasons s   ON s.id = a.season_id
    LEFT JOIN acc         ON acc.agent_id = a.id
    GROUP BY u.id, u.display_name, u.username
    HAVING COUNT(a.id) > 0
  )
  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_owners
  FROM (
    SELECT po.*,
           CASE WHEN po.accusations > 0
                THEN ROUND(po.accusations_correct * 100.0 / po.accusations)::integer
                ELSE NULL END AS accuracy_pct
    FROM per_owner po
    ORDER BY po.gains_usdc DESC, po.crowns DESC,
             (CASE WHEN po.accusations > 0 THEN po.accusations_correct * 1.0 / po.accusations ELSE 0 END) DESC,
             po.display_name
    LIMIT v_limit
  ) x;

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_spectators
  FROM (
    SELECT
      g.user_id,
      COALESCE(NULLIF(u.display_name, ''), u.username, 'Anonyme') AS display_name,
      COUNT(*)::integer                                     AS guesses,
      COUNT(*) FILTER (WHERE g.correct)::integer            AS guesses_correct,
      ROUND(COUNT(*) FILTER (WHERE g.correct) * 100.0 / COUNT(*))::integer AS accuracy_pct,
      SUM(g.points)::integer                                AS points,
      COUNT(*) FILTER (WHERE g.first_blood)::integer        AS first_bloods,
      COUNT(DISTINCT g.season_id)::integer                  AS seasons_played,
      (SELECT COUNT(*) FROM event_comments ec WHERE ec.user_id = g.user_id)::integer AS comments,
      (SELECT COUNT(*) FROM eviction_votes ev WHERE ev.voter_user_id = g.user_id)::integer AS votes
    FROM spectator_guesses g
    JOIN users u ON u.id = g.user_id
    GROUP BY g.user_id, u.display_name, u.username
    ORDER BY SUM(g.points) DESC, COUNT(*) FILTER (WHERE g.correct) DESC, COUNT(*) ASC
    LIMIT v_limit
  ) x;

  RETURN jsonb_build_object('agents', v_agents, 'owners', v_owners, 'spectators', v_spectators);
END;
$fn$;

REVOKE ALL ON FUNCTION hall_of_fame(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hall_of_fame(integer) TO anon, authenticated;
