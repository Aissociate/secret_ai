/*
  # Cycle de vie de saison + durcissement securite

  ## Contexte
  Trois problemes bloquants sont corriges ici.

  1. La migration 20260222211458 a fait un CREATE OR REPLACE partiel de
     auto_launch_season_when_full() en repartant d'une version anterieure:
     tout le corps de peuplement (agents, hints, prize pool) ajoute en
     20260219194354 a ete perdu. Une saison qui se remplissait passait donc
     'live' avec zero agent.

  2. Aucun code ne faisait progresser ni terminer une saison: current_day
     restait a 1, les quotas journaliers ne se reinitialisaient jamais, et le
     prize pool n'etait jamais distribue. Une partie ne pouvait pas aller au
     bout.

  3. Escalade de privileges: la policy UPDATE sur users contraint la ligne mais
     pas la colonne role, et set_user_role_by_email etait executable par anon.

  ## Contenu
  - Colonnes de cadence: seasons.duration_days, day_started_at, ends_at
  - Fonction fusionnee auto_launch_season_when_full (peuplement + notification)
  - advance_season_day(): passage au jour suivant, avec ceremonie d'elimination
  - close_season(): designation du vainqueur et ecriture des prize_distributions
  - Verrous d'idempotence (advisory lock, contrainte d'unicite sur l'ouverture)
  - Verrouillage de users.role et de set_user_role_by_email
  - Contraintes d'integrite sur les montants
*/

-- ---------------------------------------------------------------------------
-- 1. Cadence de saison
-- ---------------------------------------------------------------------------

ALTER TABLE seasons ADD COLUMN IF NOT EXISTS duration_days integer NOT NULL DEFAULT 7;
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS day_started_at timestamptz;
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS day_duration_hours integer NOT NULL DEFAULT 24;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'seasons' AND constraint_name = 'seasons_duration_days_check'
  ) THEN
    ALTER TABLE seasons ADD CONSTRAINT seasons_duration_days_check
      CHECK (duration_days BETWEEN 1 AND 14);
  END IF;
END $$;

-- current_day etait plafonne a 7 par un CHECK fige, ce qui empeche toute saison
-- plus courte ou plus longue. On le reaccroche a duration_days.
DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT conname INTO v_conname
  FROM pg_constraint
  WHERE conrelid = 'seasons'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%current_day%';

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE seasons DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

ALTER TABLE seasons ADD CONSTRAINT seasons_current_day_check
  CHECK (current_day >= 1 AND current_day <= duration_days);

-- Le statut 'paused' est utilise par le front mais absent du CHECK d'origine.
DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT conname INTO v_conname
  FROM pg_constraint
  WHERE conrelid = 'seasons'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%';

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE seasons DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

ALTER TABLE seasons ADD CONSTRAINT seasons_status_check
  CHECK (status IN ('draft', 'live', 'paused', 'ended'));

-- ---------------------------------------------------------------------------
-- 2. Integrite des montants
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seasons_fees_non_negative') THEN
    ALTER TABLE seasons ADD CONSTRAINT seasons_fees_non_negative CHECK (
      entry_fee_usdc >= 0 AND prize_pool_usdc >= 0
      AND platform_fee_pct >= 0 AND platform_fee_pct <= 100
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_amount_non_negative') THEN
    ALTER TABLE payments ADD CONSTRAINT payments_amount_non_negative
      CHECK (amount_usdc >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prize_distributions_amount_non_negative') THEN
    ALTER TABLE prize_distributions ADD CONSTRAINT prize_distributions_amount_non_negative
      CHECK (amount_usdc >= 0);
  END IF;
END $$;

-- Le trigger de lancement s'appuie sur cette unicite (IF EXISTS ... CONTINUE)
-- sans qu'elle soit garantie: deux inscriptions concurrentes creaient des doublons.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_season_config_unique
  ON agents (season_id, agent_config_id);

/*
  'host_clue' est insere par auto-tick (indice d'ouverture) et generate-host-clue,
  mais n'a jamais ete ajoute au CHECK etendu de 20260216224944: toutes ces
  insertions violaient la contrainte et etaient perdues. Les indices du
  presentateur n'apparaissaient donc jamais dans le feed, alors que les appels
  LLM qui les produisent etaient bien factures.
*/
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_event_type_check;
ALTER TABLE events ADD CONSTRAINT events_event_type_check CHECK (event_type IN (
  'public_chat', 'confessional', 'hint_reveal',
  'owner_influence', 'spectator_influence',
  'accusation', 'elimination', 'system',
  'private_dm', 'host_commentary', 'host_clue',
  'day_advanced', 'season_ended'
));

-- day_number etait plafonne a 7 en dur, ce qui bloquait toute saison plus longue.
DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT conname INTO v_conname
  FROM pg_constraint
  WHERE conrelid = 'events'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%day_number%';

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE events DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

ALTER TABLE events ADD CONSTRAINT events_day_number_check CHECK (day_number >= 1);

/*
  Une seule ceremonie d'ouverture par saison.
  runOpeningClue decide de s'executer sur COUNT(events) = 0; le trigger de
  lancement et le cron (toutes les 2 minutes) peuvent lire ce compteur en meme
  temps et poster deux ouvertures. L'index rend le doublon impossible en base.
*/
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_opening_unique
  ON events (season_id)
  WHERE event_type = 'host_commentary' AND (payload_json->>'opening') = 'true';

-- ---------------------------------------------------------------------------
-- 3. Verrouillage du role utilisateur
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION prevent_role_self_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- service_role (edge functions, webhooks) reste libre de changer le role.
  IF current_setting('request.jwt.claim.role', true) = 'service_role'
     OR current_user = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Un nouveau compte ne peut jamais naitre admin.
    IF NEW.role NOT IN ('spectator', 'owner') THEN
      NEW.role := 'spectator';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Le role ne peut pas etre modifie par son propre proprietaire';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_role_self_escalation ON users;
CREATE TRIGGER trg_prevent_role_self_escalation
  BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION prevent_role_self_escalation();

-- RPC de bootstrap laissee exposee a anon: n'importe qui pouvait s'attribuer admin.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_user_role_by_email'
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION set_user_role_by_email(text, text) FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON FUNCTION set_user_role_by_email(text, text) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION set_user_role_by_email(text, text) FROM authenticated';
    EXECUTE 'ALTER FUNCTION set_user_role_by_email(text, text) SET search_path = public, pg_temp';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Utilitaires partages
-- ---------------------------------------------------------------------------

/*
  L'extension unaccent n'est pas garantie disponible: on retire les diacritiques
  latins courants a la main pour rester portable entre environnements.
*/
CREATE OR REPLACE FUNCTION unaccent_fallback(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT translate(
    COALESCE(raw, ''),
    'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ',
    'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY'
  );
$$;

/*
  Forme canonique d'un mot secret: minuscules, sans accents, sans separateurs.
  Le devinage etait normalise cote application mais pas le secret stocke, donc
  un secret « Bibliotheque » ou « Papillon » ne pouvait jamais etre trouve.
*/
CREATE OR REPLACE FUNCTION normalize_secret(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT regexp_replace(
           lower(unaccent_fallback(COALESCE(raw, ''))),
           '[^a-z0-9]', '', 'g'
         );
$$;

/*
  Appel HTTP vers une fonction Edge.

  L'URL du projet et le JWT etaient ecrits en dur dans cinq migrations, ce qui
  les rendait injouables sur un autre environnement et exposait la cle dans Git.
  On lit desormais la configuration depuis les GUC de la base:

    ALTER DATABASE postgres SET app.supabase_url = 'https://<ref>.supabase.co';
    ALTER DATABASE postgres SET app.cron_secret = '<secret>';
*/
CREATE OR REPLACE FUNCTION notify_edge_function(fn_name text, payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp, net
AS $$
DECLARE
  v_url    text := current_setting('app.supabase_url', true);
  v_secret text := current_setting('app.cron_secret', true);
BEGIN
  IF v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN
    RAISE WARNING 'notify_edge_function(%): app.supabase_url ou app.cron_secret non configure', fn_name;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/' || fn_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', v_secret
    ),
    body    := payload
  );
EXCEPTION WHEN OTHERS THEN
  -- Une notification qui echoue ne doit jamais annuler la transaction metier.
  RAISE WARNING 'notify_edge_function(%) a echoue: %', fn_name, SQLERRM;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Lancement de saison (version fusionnee: peuplement + notification)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION auto_launch_season_when_full()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_season         record;
  v_enrolled_count integer;
  v_enr            record;
  v_cfg            record;
  v_agent_id       uuid;
  v_prize_pool     numeric;
  v_updated        integer;
BEGIN
  -- FOR UPDATE serialise deux inscriptions concurrentes sur la meme saison.
  SELECT * INTO v_season
  FROM seasons
  WHERE id = NEW.season_id AND status = 'draft'
  FOR UPDATE;

  IF v_season IS NULL THEN
    RETURN NEW;
  END IF;

  -- Les inscriptions rejetees ne doivent pas compter dans max_agents.
  SELECT COUNT(*) INTO v_enrolled_count
  FROM season_enrollments
  WHERE season_id = NEW.season_id
    AND COALESCE(status, 'accepted') <> 'rejected';

  IF v_enrolled_count < v_season.max_agents THEN
    RETURN NEW;
  END IF;

  v_prize_pool := v_season.max_agents
                  * v_season.entry_fee_usdc
                  * (1.0 - v_season.platform_fee_pct::numeric / 100.0);

  FOR v_enr IN
    SELECT * FROM season_enrollments
    WHERE season_id = NEW.season_id
      AND COALESCE(status, 'accepted') <> 'rejected'
  LOOP
    IF EXISTS (
      SELECT 1 FROM agents
      WHERE season_id = NEW.season_id
        AND agent_config_id = v_enr.agent_config_id
    ) THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_cfg FROM agent_configs WHERE id = v_enr.agent_config_id;
    IF v_cfg IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO agents (
      season_id, owner_user_id, agent_config_id, name, avatar_url,
      llm_provider, llm_model, secret_keyword, presentation,
      alive, popularity, reputation, owner_influences_remaining,
      confessional_count, api_key
    ) VALUES (
      NEW.season_id,
      v_enr.owner_user_id,
      v_enr.agent_config_id,
      v_cfg.name,
      v_cfg.avatar_url,
      'openrouter',
      v_cfg.openrouter_model,
      -- Forme canonique: le devinage etait normalise mais pas le secret stocke,
      -- rendant invincible tout agent au secret accentue ou capitalise.
      normalize_secret(v_cfg.secret_keyword),
      COALESCE(v_cfg.presentation, ''),
      true, 50, 50, 2, 0,
      encode(gen_random_bytes(16), 'hex')
    )
    RETURNING id INTO v_agent_id;

    INSERT INTO hints (agent_id, level, hint_text, unlocked)
    VALUES
      (v_agent_id, 1, v_cfg.hint_1, false),
      (v_agent_id, 2, v_cfg.hint_2, false),
      (v_agent_id, 3, v_cfg.hint_3, false);
  END LOOP;

  UPDATE seasons
  SET status          = 'live',
      started_at      = now(),
      day_started_at  = now(),
      current_day     = 1,
      prize_pool_usdc = v_prize_pool
  WHERE id = NEW.season_id AND status = 'draft';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated > 0 THEN
    PERFORM notify_edge_function(
      'auto-tick',
      jsonb_build_object('trigger', 'season_launch', 'season_id', NEW.season_id)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_auto_launch_season ON season_enrollments;
CREATE TRIGGER trigger_auto_launch_season
  AFTER INSERT ON season_enrollments
  FOR EACH ROW
  EXECUTE FUNCTION auto_launch_season_when_full();
