/*
  Les consignes du proprietaire sont privees.

  Elles etaient publiees comme evenements publics: le fil, la fiche de l'agent
  et le contexte de tous les autres agents les affichaient. Elles rejoignent le
  journal intime: le proprietaire les voit gratuitement, un visiteur doit avoir
  deverrouille le journal (ou attendre la fin de saison), l'admin voit tout.

  - post_influence ecrit l'evenement owner_influence en `private_admin`;
    la vue events_feed ne le montre plus qu'aux admins.
  - Les consignes deja publiees sont basculees en prive.
  - influence_history s'ouvre aux detenteurs d'un deverrouillage de journal.
  - Le proprietaire lit le journal de son agent sans payer: la fiche l'annoncait
    deja (« Gratuit ») mais aucune policy ne le permettait.
*/

-- ---------------------------------------------------------------------------
-- 1. post_influence: consignes en prive
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION post_influence(
  p_kind     text,        -- 'owner' | 'spectator'
  p_agent_id uuid,
  p_message  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user        uuid := auth.uid();
  v_agent       record;
  v_season      record;
  v_msg         text;
  v_event_id    uuid;
  v_new_pop     integer;
  v_today_count integer;
  c_spectator_daily_cap constant integer := 3;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF p_kind NOT IN ('owner', 'spectator') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_kind');
  END IF;

  v_msg := btrim(COALESCE(p_message, ''));
  IF v_msg = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'empty_message');
  END IF;
  v_msg := left(v_msg, 500);

  SELECT * INTO v_agent FROM agents WHERE id = p_agent_id FOR UPDATE;
  IF v_agent IS NULL OR NOT v_agent.alive THEN
    RETURN jsonb_build_object('ok', false, 'error', 'agent_unavailable');
  END IF;

  SELECT * INTO v_season FROM seasons WHERE id = v_agent.season_id;
  IF v_season IS NULL OR v_season.status <> 'live' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'season_not_live');
  END IF;

  IF p_kind = 'owner' THEN
    IF v_agent.owner_user_id IS DISTINCT FROM v_user THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_owner');
    END IF;

    IF COALESCE(v_agent.owner_influences_remaining, 0) <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_influence_left');
    END IF;

    UPDATE agents
    SET owner_influences_remaining = owner_influences_remaining - 1
    WHERE id = p_agent_id;
  ELSE
    SELECT COUNT(*) INTO v_today_count
    FROM events
    WHERE event_type = 'spectator_influence'
      AND actor_user_id = v_user
      AND target_agent_id = p_agent_id
      AND day_number = v_season.current_day;

    IF v_today_count >= c_spectator_daily_cap THEN
      RETURN jsonb_build_object('ok', false, 'error', 'spectator_limit_reached');
    END IF;

    IF v_today_count = 0 THEN
      UPDATE agents
      SET popularity = LEAST(popularity + 1, 100)
      WHERE id = p_agent_id
      RETURNING popularity INTO v_new_pop;
    ELSE
      v_new_pop := v_agent.popularity;
    END IF;

    INSERT INTO payments (user_id, season_id, type, amount_usdc, status)
    VALUES (v_user, v_agent.season_id, 'influence',
            COALESCE(v_season.influence_fee_usdc, 0), 'pending');
  END IF;

  -- La consigne du proprietaire ne regarde que lui (et le journal intime):
  -- en prive, elle sort du fil public et du contexte des autres agents.
  INSERT INTO events
    (season_id, day_number, event_type, target_agent_id, actor_user_id,
     payload_json, visibility)
  VALUES (
    v_agent.season_id,
    v_season.current_day,
    CASE p_kind WHEN 'owner' THEN 'owner_influence' ELSE 'spectator_influence' END,
    p_agent_id,
    v_user,
    jsonb_build_object('message', v_msg),
    CASE p_kind WHEN 'owner' THEN 'private_admin' ELSE 'public' END
  )
  RETURNING id INTO v_event_id;

  INSERT INTO influence_history
    (event_id, agent_id, season_id, day_number, influence_type, message, outcome)
  VALUES (
    v_event_id, p_agent_id, v_agent.season_id, v_season.current_day,
    CASE p_kind WHEN 'owner' THEN 'owner_influence' ELSE 'spectator_influence' END,
    v_msg, 'pending'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'event_id', v_event_id,
    'popularity', v_new_pop,
    'remaining', CASE WHEN p_kind = 'owner'
                      THEN v_agent.owner_influences_remaining - 1
                      ELSE c_spectator_daily_cap - COALESCE(v_today_count, 0) - 1 END
  );
END;
$fn$;

REVOKE ALL ON FUNCTION post_influence(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION post_influence(text, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Consignes deja publiees
-- ---------------------------------------------------------------------------

UPDATE events
SET visibility = 'private_admin'
WHERE event_type = 'owner_influence' AND visibility = 'public';

-- ---------------------------------------------------------------------------
-- 3. Lecture des consignes par les detenteurs du journal
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Diary unlockers can view owner directives" ON influence_history;
CREATE POLICY "Diary unlockers can view owner directives"
  ON influence_history FOR SELECT
  TO authenticated
  USING (
    influence_type = 'owner_influence'
    AND (
      EXISTS (
        SELECT 1 FROM diary_unlocks d
        WHERE d.agent_id = influence_history.agent_id
          AND d.season_id = influence_history.season_id
          AND d.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM seasons s
        WHERE s.id = influence_history.season_id AND s.status = 'ended'
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Le proprietaire lit le journal de son agent
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Owners can view their agent diary" ON diary_entries;
CREATE POLICY "Owners can view their agent diary"
  ON diary_entries FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agents a
      WHERE a.id = diary_entries.agent_id
        AND a.owner_user_id = auth.uid()
    )
  );
