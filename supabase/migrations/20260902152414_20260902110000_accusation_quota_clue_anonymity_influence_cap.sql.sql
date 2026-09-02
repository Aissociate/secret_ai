/*
  Trois correctifs de mecanique de jeu.

  1. Accusations. `game_limits` prevoit 3 accusations par jour, mais la
     contrainte de `daily_message_counts` n'acceptait que public_chat,
     private_dm et confessional. La reservation de quota echouait, auto-tick
     lisait « quota epuise » et aucun agent n'a jamais pu accuser: le coeur du
     jeu, deviner un secret pour eliminer, ne se jouait pas.

  2. Anonymat des indices du presentateur. Les evenements `host_clue`
     portaient `target_agent_id`, et la timeline affichait la puce de l'agent
     vise a cote d'un indice pourtant redige comme anonyme. La cible vit
     desormais dans `host_clue_targets`, lisible par les admins seulement, et
     les indices deja publies sont migres.

  3. Influence spectateur. `post_influence` ajoutait 1 point de popularite
     sans plafond ni debit: un seul compte pouvait pousser un agent a 95 et
     forcer la revelation de ses trois indices. Plafond de 3 messages par
     spectateur, par agent et par jour; seul le premier fait monter la
     popularite.
*/

-- ---------------------------------------------------------------------------
-- 1. Quota d'accusation
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT conname INTO v_conname
  FROM pg_constraint
  WHERE conrelid = 'daily_message_counts'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%message_type%';

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE daily_message_counts DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

ALTER TABLE daily_message_counts
  ADD CONSTRAINT daily_message_counts_message_type_check
  CHECK (message_type IN ('public_chat', 'private_dm', 'confessional', 'accusation'));

-- ---------------------------------------------------------------------------
-- 2. Cible des indices du presentateur
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS host_clue_targets (
  event_id   uuid PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  agent_id   uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_host_clue_targets_agent ON host_clue_targets(agent_id);

ALTER TABLE host_clue_targets ENABLE ROW LEVEL SECURITY;

-- Seuls les admins lisent la cible; l'ecriture passe par les fonctions Edge
-- (service_role, hors RLS). Aucune policy pour anon ni pour l'insertion.
DROP POLICY IF EXISTS "Admins read clue targets" ON host_clue_targets;
CREATE POLICY "Admins read clue targets"
  ON host_clue_targets FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'));

INSERT INTO host_clue_targets (event_id, agent_id)
SELECT id, target_agent_id
FROM events
WHERE event_type = 'host_clue' AND target_agent_id IS NOT NULL
ON CONFLICT (event_id) DO NOTHING;

UPDATE events
SET target_agent_id = NULL
WHERE event_type = 'host_clue' AND target_agent_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Plafond d'influence spectateur
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

  -- Verrou sur l'agent: le comptage puis la mise a jour de popularite ne
  -- doivent pas se croiser entre deux appels du meme spectateur.
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

    -- « Chaque influence augmente legerement la popularite »: une fois par
    -- spectateur et par jour, sinon le palier de revelation s'achete en boucle.
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
    'public'
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
