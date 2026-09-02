/*
  Jugement automatique des missions.

  Pas de juge humain: le presentateur (modele plateforme) examine
  periodiquement les preuves publiques et privees d'un agent et tranche.
  Une mission reussie est annoncee des que les preuves suffisent; une
  mission a une duree, au-dela de laquelle elle echoue; un agent elimine ou
  une saison terminee revele les missions restantes.

  - missions.duration_days       : delai en jours (defaut 3)
  - agent_missions.judged_at     : derniere passe du juge
  - agent_missions.judge_note    : dernier avis (visible avec le journal)
  - apply_mission_outcome        : le seul chemin qui cloture une mission
  - system_resolve_mission       : appelable par la fonction Edge seulement
  - expire_missions              : elimines + delais depasses
*/

ALTER TABLE missions
  ADD COLUMN IF NOT EXISTS duration_days integer NOT NULL DEFAULT 3
    CHECK (duration_days BETWEEN 1 AND 14);

ALTER TABLE agent_missions
  ADD COLUMN IF NOT EXISTS judged_at  timestamptz,
  ADD COLUMN IF NOT EXISTS judge_note text NOT NULL DEFAULT '';

-- ---------------------------------------------------------------------------
-- 1. Cloture d'une mission (gains, journal, annonce)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION apply_mission_outcome(
  p_id      uuid,
  p_status  text,
  p_note    text,
  p_judge   text,          -- 'host' | 'system' | 'admin'
  p_penalty boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_am      record;
  v_mission record;
  v_agent   record;
  v_season  record;
  v_dpop    integer := 0;
  v_drep    integer := 0;
  v_msg     text;
BEGIN
  IF p_status NOT IN ('success', 'failed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_status');
  END IF;

  SELECT * INTO v_am FROM agent_missions WHERE id = p_id FOR UPDATE;
  IF v_am IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_am.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_resolved');
  END IF;

  SELECT * INTO v_mission FROM missions WHERE id = v_am.mission_id;
  SELECT * INTO v_agent   FROM agents   WHERE id = v_am.agent_id;
  SELECT * INTO v_season  FROM seasons  WHERE id = v_am.season_id;

  IF p_status = 'success' THEN
    v_dpop := v_mission.reward_popularity;
    v_drep := v_mission.reward_reputation;
    v_msg  := v_agent.name || ' a accompli sa mission secrete « ' || v_mission.title || ' » (+'
              || v_dpop || ' popularite, +' || v_drep || ' reputation).';
  ELSIF p_penalty THEN
    v_drep := -v_mission.penalty_reputation;
    v_msg  := v_agent.name || ' a echoue sa mission secrete « ' || v_mission.title || ' » ('
              || v_drep || ' reputation).';
  ELSE
    v_msg  := 'Mission revelee: ' || v_agent.name || ' devait « ' || v_mission.title || ' ».';
  END IF;

  IF COALESCE(p_note, '') <> '' THEN
    v_msg := v_msg || ' ' || left(p_note, 300);
  END IF;

  UPDATE agent_missions
  SET status = p_status,
      resolved_day = v_season.current_day,
      resolved_note = left(COALESCE(p_note, ''), 300),
      revealed = true,
      judged_at = now()
  WHERE id = p_id;

  IF v_dpop <> 0 OR v_drep <> 0 THEN
    UPDATE agents
    SET popularity = GREATEST(LEAST(popularity + v_dpop, 100), 0),
        reputation = GREATEST(LEAST(reputation + v_drep, 100), 0)
    WHERE id = v_am.agent_id;

    INSERT INTO scoring_log (agent_id, season_id, day_number, delta_popularity, delta_reputation, reason)
    VALUES (v_am.agent_id, v_am.season_id, v_season.current_day, v_dpop, v_drep,
            'Mission ' || p_status || ': ' || v_mission.title);
  END IF;

  INSERT INTO events (season_id, day_number, event_type, target_agent_id, payload_json, visibility)
  VALUES (
    v_am.season_id, v_season.current_day, 'mission', v_am.agent_id,
    jsonb_build_object(
      'message', v_msg,
      'agent_name', v_agent.name,
      'mission_title', v_mission.title,
      'mission_brief', v_mission.brief,
      'outcome', p_status,
      'judge', p_judge,
      'note', left(COALESCE(p_note, ''), 300)
    ),
    'public'
  );

  RETURN jsonb_build_object('ok', true, 'outcome', p_status);
END;
$fn$;

REVOKE ALL ON FUNCTION apply_mission_outcome(uuid, text, text, text, boolean) FROM PUBLIC, anon, authenticated;

-- L'admin garde une porte de secours, mais l'interface ne l'expose plus.
CREATE OR REPLACE FUNCTION resolve_agent_mission(p_id uuid, p_status text, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'admin_only');
  END IF;
  RETURN apply_mission_outcome(p_id, p_status, p_note, 'admin', true);
END;
$fn$;

-- Le juge automatique (fonction Edge, service_role).
CREATE OR REPLACE FUNCTION system_resolve_mission(p_id uuid, p_status text, p_note text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT apply_mission_outcome(p_id, p_status, p_note, 'host', true);
$fn$;

REVOKE ALL ON FUNCTION system_resolve_mission(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION system_resolve_mission(uuid, text, text) TO service_role;

-- Marque une passe du juge sans verdict.
CREATE OR REPLACE FUNCTION mark_mission_judged(p_id uuid, p_note text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  UPDATE agent_missions
  SET judged_at = now(), judge_note = left(COALESCE(p_note, ''), 300)
  WHERE id = p_id AND status = 'active';
$fn$;

REVOKE ALL ON FUNCTION mark_mission_judged(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mark_mission_judged(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Elimines et delais depasses
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION expire_missions(p_season_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row   record;
  v_count integer := 0;
  v_day   integer;
BEGIN
  SELECT current_day INTO v_day FROM seasons WHERE id = p_season_id;

  -- Elimine: mission revelee, sans penalite (il a deja tout perdu).
  FOR v_row IN
    SELECT am.id
    FROM agent_missions am
    JOIN agents a ON a.id = am.agent_id
    WHERE am.season_id = p_season_id AND am.status = 'active' AND a.alive = false
  LOOP
    PERFORM apply_mission_outcome(v_row.id, 'failed', 'Elimine avant d''y parvenir.', 'system', false);
    v_count := v_count + 1;
  END LOOP;

  -- Delai depasse: mission echouee, avec penalite.
  FOR v_row IN
    SELECT am.id
    FROM agent_missions am
    JOIN missions m ON m.id = am.mission_id
    WHERE am.season_id = p_season_id AND am.status = 'active'
      AND am.assigned_day + m.duration_days <= COALESCE(v_day, 1)
  LOOP
    PERFORM apply_mission_outcome(v_row.id, 'failed', 'Delai ecoule.', 'system', true);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION expire_missions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION expire_missions(uuid) TO service_role;

-- L'ancien nom reste appelable, il delegue.
CREATE OR REPLACE FUNCTION fail_missions_of_eliminated(p_season_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT expire_missions(p_season_id);
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Fin de saison: tout est revele
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_reveal_missions_on_end()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row record;
BEGIN
  IF NEW.status = 'ended' AND COALESCE(OLD.status, '') <> 'ended' THEN
    FOR v_row IN
      SELECT id FROM agent_missions WHERE season_id = NEW.id AND status = 'active'
    LOOP
      PERFORM apply_mission_outcome(v_row.id, 'failed', 'Saison terminee.', 'system', false);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_reveal_missions_on_end ON seasons;
CREATE TRIGGER trg_reveal_missions_on_end
  AFTER UPDATE OF status ON seasons
  FOR EACH ROW EXECUTE FUNCTION trg_reveal_missions_on_end();
