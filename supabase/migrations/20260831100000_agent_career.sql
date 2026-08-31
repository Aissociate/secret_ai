/*
  # Carrière d'agent : le palmarès qui survit à la saison

  ## Pourquoi
  Un agent est aujourd'hui jetable : la saison finit, tout disparaît, et rien ne
  justifie d'avoir soigné sa doctrine. C'est ce qui manque pour qu'un
  propriétaire s'investisse et ait quelque chose à montrer.

  L'identité durable est `agent_configs` (possédée par l'utilisateur, réutilisée
  d'une saison à l'autre) ; `agents` n'est qu'une incarnation par saison. La
  carrière s'agrège donc sur cette relation.

  ## Contenu
  - `agents.eliminated_at` et `agents.final_rank`, renseignés automatiquement
  - `agent_configs.rating`, une cote mise à jour à la clôture
  - `agent_career`, vue publique agrégeant le palmarès
*/

-- ---------------------------------------------------------------------------
-- 1. Traces de fin de parcours
-- ---------------------------------------------------------------------------

ALTER TABLE agents ADD COLUMN IF NOT EXISTS eliminated_at timestamptz;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS final_rank integer;

/*
  Horodater l'élimination par trigger plutôt que dans chaque chemin: la
  cérémonie et la résolution d'accusation basculent toutes deux `alive`, et un
  troisième chemin ajouté demain serait couvert sans y penser.
*/
CREATE OR REPLACE FUNCTION trg_stamp_elimination()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF OLD.alive = true AND NEW.alive = false AND NEW.eliminated_at IS NULL THEN
    NEW.eliminated_at := now();
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_agents_stamp_elimination ON agents;
CREATE TRIGGER trg_agents_stamp_elimination
  BEFORE UPDATE OF alive ON agents
  FOR EACH ROW
  EXECUTE FUNCTION trg_stamp_elimination();

-- ---------------------------------------------------------------------------
-- 2. Cote
-- ---------------------------------------------------------------------------

ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS rating integer NOT NULL DEFAULT 1000;

/*
  Barème de cote, volontairement lisible plutôt que sophistiqué.

  Le classement de fin de saison donne l'essentiel: le vainqueur gagne 40
  points, le dernier en perd autant, le milieu de tableau est neutre. Chaque
  secret percé vaut 8 points de plus, pour que la déduction — le cœur du jeu —
  paie davantage que la simple survie.

  Un barème compréhensible se raconte ; un Elo complet ne se raconte pas.
*/
CREATE OR REPLACE FUNCTION rating_delta(
  p_rank        integer,
  p_field_size  integer,
  p_secrets     integer
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN p_field_size <= 1 OR p_rank IS NULL THEN 0
    ELSE ROUND(40 * (1 - 2 * (p_rank - 1)::numeric / (p_field_size - 1)))::integer
  END + COALESCE(p_secrets, 0) * 8;
$fn$;

GRANT EXECUTE ON FUNCTION rating_delta(integer, integer, integer) TO anon, authenticated;

/*
  Fige le classement d'une saison terminée et applique les cotes.
  Idempotente: si les rangs sont déjà posés, elle ne fait rien.
*/
CREATE OR REPLACE FUNCTION settle_season_ranks(p_season_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_field  integer;
  v_row    record;
  v_count  integer := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM agents WHERE season_id = p_season_id AND final_rank IS NOT NULL
  ) THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*) INTO v_field FROM agents WHERE season_id = p_season_id;
  IF COALESCE(v_field, 0) = 0 THEN RETURN 0; END IF;

  /*
    Rang: les survivants d'abord, puis les élimines du plus tardif au plus
    précoce. Tenir plus longtemps vaut mieux que partir tôt.
  */
  FOR v_row IN
    SELECT
      a.id,
      a.agent_config_id,
      ROW_NUMBER() OVER (
        ORDER BY a.alive DESC, a.eliminated_at DESC NULLS LAST,
                 a.popularity DESC, a.created_at ASC
      )::integer AS rank,
      (
        SELECT COUNT(*) FROM events e
        WHERE e.season_id = p_season_id
          AND e.event_type = 'elimination'
          AND e.actor_agent_id = a.id
          AND e.payload_json->>'reason' = 'secret_guessed'
      )::integer AS secrets
    FROM agents a
    WHERE a.season_id = p_season_id
  LOOP
    UPDATE agents SET final_rank = v_row.rank WHERE id = v_row.id;

    UPDATE agent_configs
    SET rating = GREATEST(0, rating + rating_delta(v_row.rank, v_field, v_row.secrets))
    WHERE id = v_row.agent_config_id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION settle_season_ranks(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Vue de carrière
-- ---------------------------------------------------------------------------

/*
  Fiche publique d'un agent, agrégée sur toutes ses saisons.
  Aucun secret n'y figure: seulement ce qui se montre.
*/
CREATE OR REPLACE VIEW agent_career
WITH (security_invoker = false) AS
SELECT
  c.id                       AS config_id,
  c.owner_user_id,
  c.name,
  c.avatar_url,
  c.personality_traits       AS doctrine,
  c.rating,
  COUNT(a.id)::integer                                          AS seasons_played,
  COUNT(a.id) FILTER (WHERE s.winner_agent_id = a.id)::integer   AS crowns,
  COUNT(a.id) FILTER (WHERE a.final_rank = 2)::integer           AS finals,
  COALESCE(MAX(a.popularity), 0)::integer                        AS best_popularity,
  (
    SELECT COUNT(*)::integer FROM events e
    WHERE e.event_type = 'elimination'
      AND e.payload_json->>'reason' = 'secret_guessed'
      AND e.actor_agent_id IN (
        SELECT id FROM agents WHERE agent_config_id = c.id
      )
  )                                                              AS secrets_cracked,
  (
    SELECT COUNT(*)::integer FROM events e
    WHERE e.event_type = 'elimination'
      AND e.payload_json->>'reason' = 'secret_guessed'
      AND e.target_agent_id IN (
        SELECT id FROM agents WHERE agent_config_id = c.id
      )
  )                                                              AS times_unmasked,
  c.created_at
FROM agent_configs c
LEFT JOIN agents  a ON a.agent_config_id = c.id
LEFT JOIN seasons s ON s.id = a.season_id
GROUP BY c.id, c.owner_user_id, c.name, c.avatar_url,
         c.personality_traits, c.rating, c.created_at;

REVOKE ALL ON agent_career FROM PUBLIC, anon, authenticated;
GRANT SELECT ON agent_career TO anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_agents_config_season ON agents (agent_config_id, season_id);
CREATE INDEX IF NOT EXISTS idx_events_actor_reason
  ON events (event_type, actor_agent_id)
  WHERE event_type = 'elimination';
