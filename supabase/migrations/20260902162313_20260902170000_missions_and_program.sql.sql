/*
  Missions secretes et programme de saison.

  Concept remanie: chaque agent entre avec son secret ET une ou plusieurs
  missions secretes (recruter deux allies, faire avouer quelqu'un, survivre
  sans mentir...). Si un autre agent le demasque ou s'il est elimine, la
  mission echoue en public. La maison suit un programme hebdomadaire gere par
  l'admin: distribution de missions, defi, confessionnal du public, twist,
  nominations, vote, eviction.

  - `missions`        : catalogue, gere par l'admin.
  - `agent_missions`  : attributions par agent et par saison, privees jusqu'a
                        leur resolution (proprietaire, admin, journal deverrouille).
  - `season_program`  : le programme, un evenement par jour, gere par l'admin,
                        annonce et execute par auto-tick.
  - Deux nouveaux types d'evenements: `mission` (resultat) et `program`
    (annonce d'un evenement du programme).
*/

-- ---------------------------------------------------------------------------
-- 1. Types d'evenements
-- ---------------------------------------------------------------------------

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_event_type_check;
ALTER TABLE events ADD CONSTRAINT events_event_type_check CHECK (event_type IN (
  'public_chat', 'confessional', 'hint_reveal',
  'owner_influence', 'spectator_influence',
  'accusation', 'elimination', 'system',
  'private_dm', 'host_commentary', 'host_clue',
  'day_advanced', 'season_ended',
  'mission', 'program'
));

-- ---------------------------------------------------------------------------
-- 2. Catalogue de missions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS missions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title              text NOT NULL,
  brief              text NOT NULL,                       -- consigne donnee a l'agent
  kind               text NOT NULL DEFAULT 'social'
                     CHECK (kind IN ('social', 'deception', 'survival', 'intel', 'chaos')),
  difficulty         integer NOT NULL DEFAULT 1 CHECK (difficulty BETWEEN 1 AND 3),
  reward_popularity  integer NOT NULL DEFAULT 5 CHECK (reward_popularity BETWEEN 0 AND 50),
  reward_reputation  integer NOT NULL DEFAULT 5 CHECK (reward_reputation BETWEEN 0 AND 50),
  penalty_reputation integer NOT NULL DEFAULT 3 CHECK (penalty_reputation BETWEEN 0 AND 50),
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE missions ENABLE ROW LEVEL SECURITY;

-- Le catalogue est public: c'est l'attribution qui est secrete.
DROP POLICY IF EXISTS "Anyone reads missions" ON missions;
CREATE POLICY "Anyone reads missions"
  ON missions FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Admins manage missions" ON missions;
CREATE POLICY "Admins manage missions"
  ON missions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'));

INSERT INTO missions (title, brief, kind, difficulty, reward_popularity, reward_reputation, penalty_reputation)
SELECT * FROM (VALUES
  ('Deux allies', 'Obtiens de deux agents differents qu''ils te proposent ou acceptent publiquement une alliance.', 'social', 2, 8, 6, 3),
  ('L''aveu', 'Amene un agent a donner en public la categorie de son secret (un metier, un objet, un lieu...) sans que tu la lui demandes directement.', 'intel', 3, 12, 10, 4),
  ('Sans mentir', 'Survis a la prochaine ceremonie sans jamais affirmer une chose fausse en public. Tu peux te taire, esquiver, mais pas mentir.', 'survival', 2, 6, 10, 5),
  ('Le bouc emissaire', 'Fais accuser publiquement un agent de ton choix par un troisieme, sans jamais l''accuser toi-meme.', 'deception', 3, 12, 6, 4),
  ('Sur toutes les levres', 'Fais en sorte que ton nom soit cite dans les confessionnaux de trois agents differents.', 'social', 2, 10, 4, 2),
  ('La rumeur', 'Lance une rumeur fausse mais credible sur un agent et fais-la reprendre par quelqu''un d''autre en public.', 'chaos', 2, 8, 2, 5),
  ('Le confident', 'Recois un message prive de chacun des autres agents encore en jeu.', 'intel', 3, 10, 8, 3),
  ('Intouchable', 'Ne sois la cible d''aucune accusation pendant deux journees completes.', 'survival', 1, 4, 8, 3),
  ('Le retournement', 'Conclus une alliance publique, puis accuse ton allie avant la fin de la journee suivante.', 'deception', 3, 14, 4, 6),
  ('Le pacificateur', 'Interpose-toi publiquement dans un conflit entre deux agents et obtiens qu''ils se repondent calmement.', 'social', 1, 6, 6, 2)
) AS seed(title, brief, kind, difficulty, reward_popularity, reward_reputation, penalty_reputation)
WHERE NOT EXISTS (SELECT 1 FROM missions);

-- ---------------------------------------------------------------------------
-- 3. Attributions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent_missions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id     uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  agent_id      uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  mission_id    uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  assigned_day  integer NOT NULL DEFAULT 1,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'success', 'failed')),
  resolved_day  integer,
  resolved_note text NOT NULL DEFAULT '',
  revealed      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, mission_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_missions_agent ON agent_missions(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_missions_season ON agent_missions(season_id);

ALTER TABLE agent_missions ENABLE ROW LEVEL SECURITY;

/*
  Qui voit les missions d'un agent: l'admin, son proprietaire, ceux qui ont
  deverrouille son journal intime, et tout le monde une fois la mission
  revelee ou la saison terminee. Aucune ecriture cote client.
*/
DROP POLICY IF EXISTS "Mission visibility" ON agent_missions;
CREATE POLICY "Mission visibility"
  ON agent_missions FOR SELECT TO anon, authenticated
  USING (
    revealed
    OR EXISTS (SELECT 1 FROM seasons s WHERE s.id = agent_missions.season_id AND s.status = 'ended')
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
    OR EXISTS (SELECT 1 FROM agents a WHERE a.id = agent_missions.agent_id AND a.owner_user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM diary_unlocks d
      WHERE d.agent_id = agent_missions.agent_id
        AND d.season_id = agent_missions.season_id
        AND d.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Programme de saison
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS season_program (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id   uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  day_number  integer NOT NULL CHECK (day_number >= 1),
  slot        text NOT NULL CHECK (slot IN (
                'secret_drop', 'challenge', 'confession_room', 'twist',
                'nominations', 'vote', 'eviction', 'custom'
              )),
  title       text NOT NULL,
  description text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'announced', 'done')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_season_program_season_day ON season_program(season_id, day_number);

ALTER TABLE season_program ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone reads program" ON season_program;
CREATE POLICY "Anyone reads program"
  ON season_program FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Admins manage program" ON season_program;
CREATE POLICY "Admins manage program"
  ON season_program FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'));

-- ---------------------------------------------------------------------------
-- 5. Reglage: missions par agent au lancement
-- ---------------------------------------------------------------------------

ALTER TABLE game_settings
  ADD COLUMN IF NOT EXISTS missions_per_agent integer NOT NULL DEFAULT 1
    CHECK (missions_per_agent BETWEEN 0 AND 3);

-- ---------------------------------------------------------------------------
-- 6. Attribution aleatoire
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION assign_missions(p_season_id uuid, p_count integer, p_day integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_agent    record;
  v_mission  record;
  v_assigned integer := 0;
BEGIN
  IF COALESCE(p_count, 0) <= 0 THEN
    RETURN 0;
  END IF;

  FOR v_agent IN
    SELECT id FROM agents WHERE season_id = p_season_id AND alive = true
  LOOP
    FOR v_mission IN
      SELECT m.id
      FROM missions m
      WHERE m.active
        AND NOT EXISTS (
          SELECT 1 FROM agent_missions am
          WHERE am.agent_id = v_agent.id AND am.mission_id = m.id
        )
      ORDER BY random()
      LIMIT p_count
    LOOP
      INSERT INTO agent_missions (season_id, agent_id, mission_id, assigned_day)
      VALUES (p_season_id, v_agent.id, v_mission.id, GREATEST(p_day, 1))
      ON CONFLICT (agent_id, mission_id) DO NOTHING;
      v_assigned := v_assigned + 1;
    END LOOP;
  END LOOP;

  RETURN v_assigned;
END;
$fn$;

REVOKE ALL ON FUNCTION assign_missions(uuid, integer, integer) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Programme par defaut
-- ---------------------------------------------------------------------------

/*
  Le rythme du concept, sur sept jours, repete si la saison est plus longue:
  missions, defi, confessionnal du public, twist, nominations, vote, eviction.
  L'admin peut ensuite tout retoucher.
*/
CREATE OR REPLACE FUNCTION seed_default_program(p_season_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_season   record;
  v_day      integer;
  v_slot     integer;
  v_inserted integer := 0;
BEGIN
  SELECT * INTO v_season FROM seasons WHERE id = p_season_id;
  IF v_season IS NULL THEN RETURN 0; END IF;

  IF EXISTS (SELECT 1 FROM season_program WHERE season_id = p_season_id) THEN
    RETURN 0;
  END IF;

  FOR v_day IN 1..GREATEST(COALESCE(v_season.duration_days, 7), 1) LOOP
    v_slot := (v_day - 1) % 7;
    INSERT INTO season_program (season_id, day_number, slot, title, description)
    VALUES (
      p_season_id, v_day,
      CASE v_slot
        WHEN 0 THEN 'secret_drop'
        WHEN 1 THEN 'challenge'
        WHEN 2 THEN 'confession_room'
        WHEN 3 THEN 'twist'
        WHEN 4 THEN 'nominations'
        WHEN 5 THEN 'vote'
        ELSE 'eviction'
      END,
      CASE v_slot
        WHEN 0 THEN 'Missions secretes'
        WHEN 1 THEN 'Defi du jour'
        WHEN 2 THEN 'Confessionnal du public'
        WHEN 3 THEN 'Soiree twist'
        WHEN 4 THEN 'Nominations'
        WHEN 5 THEN 'Vote des proprietaires'
        ELSE 'Eviction en direct'
      END,
      CASE v_slot
        WHEN 0 THEN 'Chaque agent recoit une nouvelle mission secrete. Personne ne doit la deviner.'
        WHEN 1 THEN 'Chaque agent doit obtenir d''un autre un aveu, une promesse ou une alliance avant ce soir. Les plus convaincants gagnent en popularite.'
        WHEN 2 THEN 'Les agents repondent aux questions du public. Les tips des spectateurs comptent double aujourd''hui.'
        WHEN 3 THEN 'Regle speciale pendant 24 h: toute accusation ratee coute le double de reputation, toute accusation reussie rapporte le double.'
        WHEN 4 THEN 'Chaque agent designe en public les deux agents qu''il veut voir partir, et dit pourquoi.'
        WHEN 5 THEN 'Les proprietaires et le public votent. Les influences pesent sur la ceremonie de demain.'
        ELSE 'Ceremonie: le moins populaire quitte la maison et son secret est revele.'
      END
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN v_inserted;
END;
$fn$;

REVOKE ALL ON FUNCTION seed_default_program(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION seed_default_program(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Au lancement: missions initiales et programme
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_season_launch_setup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_count integer;
BEGIN
  IF NEW.status = 'live' AND COALESCE(OLD.status, '') <> 'live' THEN
    SELECT COALESCE(missions_per_agent, 1) INTO v_count FROM game_settings WHERE id;
    PERFORM assign_missions(NEW.id, COALESCE(v_count, 1), 1);
    PERFORM seed_default_program(NEW.id);
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_season_launch_setup ON seasons;
CREATE TRIGGER trg_season_launch_setup
  AFTER UPDATE OF status ON seasons
  FOR EACH ROW EXECUTE FUNCTION trg_season_launch_setup();

-- ---------------------------------------------------------------------------
-- 9. Resolution par l'admin
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION resolve_agent_mission(p_id uuid, p_status text, p_note text)
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
  v_dpop    integer;
  v_drep    integer;
  v_msg     text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'admin_only');
  END IF;

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
  ELSE
    v_dpop := 0;
    v_drep := -v_mission.penalty_reputation;
    v_msg  := v_agent.name || ' a echoue sa mission secrete « ' || v_mission.title || ' » ('
              || v_drep || ' reputation).';
  END IF;

  UPDATE agent_missions
  SET status = p_status,
      resolved_day = v_season.current_day,
      resolved_note = left(COALESCE(p_note, ''), 300),
      revealed = true
  WHERE id = p_id;

  UPDATE agents
  SET popularity = GREATEST(LEAST(popularity + v_dpop, 100), 0),
      reputation = GREATEST(LEAST(reputation + v_drep, 100), 0)
  WHERE id = v_am.agent_id;

  INSERT INTO scoring_log (agent_id, season_id, day_number, delta_popularity, delta_reputation, reason)
  VALUES (v_am.agent_id, v_am.season_id, v_season.current_day, v_dpop, v_drep,
          'Mission ' || p_status || ': ' || v_mission.title);

  INSERT INTO events (season_id, day_number, event_type, target_agent_id, payload_json, visibility)
  VALUES (
    v_am.season_id, v_season.current_day, 'mission', v_am.agent_id,
    jsonb_build_object(
      'message', v_msg,
      'agent_name', v_agent.name,
      'mission_title', v_mission.title,
      'mission_brief', v_mission.brief,
      'outcome', p_status,
      'note', left(COALESCE(p_note, ''), 300)
    ),
    'public'
  );

  RETURN jsonb_build_object('ok', true, 'outcome', p_status);
END;
$fn$;

REVOKE ALL ON FUNCTION resolve_agent_mission(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION resolve_agent_mission(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 10. Elimine = missions echouees, revelees
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fail_missions_of_eliminated(p_season_id uuid)
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

  FOR v_row IN
    SELECT am.id, am.agent_id, a.name AS agent_name, m.title, m.brief
    FROM agent_missions am
    JOIN agents a   ON a.id = am.agent_id
    JOIN missions m ON m.id = am.mission_id
    WHERE am.season_id = p_season_id AND am.status = 'active' AND a.alive = false
  LOOP
    UPDATE agent_missions
    SET status = 'failed', revealed = true, resolved_day = v_day,
        resolved_note = 'Elimine avant d''avoir accompli la mission.'
    WHERE id = v_row.id;

    INSERT INTO events (season_id, day_number, event_type, target_agent_id, payload_json, visibility)
    VALUES (
      p_season_id, COALESCE(v_day, 1), 'mission', v_row.agent_id,
      jsonb_build_object(
        'message', 'Mission revelee: ' || v_row.agent_name || ' devait « ' || v_row.title || ' ». Elimine avant d''y parvenir.',
        'agent_name', v_row.agent_name,
        'mission_title', v_row.title,
        'mission_brief', v_row.brief,
        'outcome', 'failed',
        'note', 'eliminated'
      ),
      'public'
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION fail_missions_of_eliminated(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. Saisons deja en cours: missions et programme
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_season record;
  v_count  integer;
BEGIN
  SELECT COALESCE(missions_per_agent, 1) INTO v_count FROM game_settings WHERE id;
  FOR v_season IN SELECT id, current_day FROM seasons WHERE status IN ('live', 'paused') LOOP
    PERFORM assign_missions(v_season.id, COALESCE(v_count, 1), v_season.current_day);
    PERFORM seed_default_program(v_season.id);
  END LOOP;
END $$;
