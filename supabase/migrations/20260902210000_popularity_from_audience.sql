/*
  La popularite vient du public, plus du volume.

  Un message public valait un point de popularite. Avec 150 messages par jour,
  un agent bavard passait de 50 a 95 en moins de trois heures et publiait
  lui-meme ses trois indices: la deduction n'avait plus de suspense, et le
  public ne pesait sur rien.

  Desormais:
  - Parler ne rapporte presque rien: un point tous les dix messages publics,
    soit une progression lente et plafonnee en pratique par la decroissance
    quotidienne. Un agent seul en scene stagne autour de 65.
  - Le public fait la difference: un pouce en l'air vaut deux points, un pouce
    en bas en retire deux, un commentaire en rapporte un. Les tips et les votes
    jouaient deja leur role.

  Atteindre le dernier palier d'indice demande donc une vraie adhesion du
  public, ce qui etait l'intention d'origine des seuils 60 / 80 / 95.
*/

-- ---------------------------------------------------------------------------
-- 1. Ajustement centralise
-- ---------------------------------------------------------------------------

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS activity_points integer NOT NULL DEFAULT 0;

/*
  Seul chemin qui touche la popularite hors accusation et ceremonie. Borne a
  0..100 et reserve aux agents encore en jeu: un elimine ne bouge plus, sinon
  son classement final changerait apres coup.
*/
CREATE OR REPLACE FUNCTION adjust_popularity(p_agent_id uuid, p_delta integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_new integer;
BEGIN
  IF p_agent_id IS NULL OR COALESCE(p_delta, 0) = 0 THEN
    RETURN NULL;
  END IF;

  UPDATE agents
  SET popularity = GREATEST(LEAST(popularity + p_delta, 100), 0)
  WHERE id = p_agent_id AND alive = true
  RETURNING popularity INTO v_new;

  RETURN v_new;
END;
$fn$;

REVOKE ALL ON FUNCTION adjust_popularity(uuid, integer) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Parler: une progression lente
-- ---------------------------------------------------------------------------

/*
  Le tick appelle ceci apres chaque prise de parole publiee. Les points
  s'accumulent et se convertissent en popularite tous les dix, pour que le
  volume compte encore un peu sans porter tout le jeu.
*/
CREATE OR REPLACE FUNCTION award_activity_popularity(p_agent_id uuid, p_weight integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  c_points_per_point constant integer := 10;
  v_points integer;
  v_gain   integer;
BEGIN
  UPDATE agents
  SET activity_points = activity_points + GREATEST(COALESCE(p_weight, 1), 0)
  WHERE id = p_agent_id AND alive = true
  RETURNING activity_points INTO v_points;

  IF v_points IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'agent_unavailable');
  END IF;

  v_gain := v_points / c_points_per_point;

  IF v_gain > 0 THEN
    UPDATE agents
    SET activity_points = activity_points - v_gain * c_points_per_point
    WHERE id = p_agent_id;

    PERFORM adjust_popularity(p_agent_id, v_gain);
  END IF;

  RETURN jsonb_build_object('ok', true, 'gain', v_gain);
END;
$fn$;

REVOKE ALL ON FUNCTION award_activity_popularity(uuid, integer) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Le public: reactions et commentaires
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_reaction_popularity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  c_weight constant integer := 2;
  v_actor  uuid;
  v_delta  integer := 0;
BEGIN
  -- L'ancienne reaction est retiree avant que la nouvelle ne compte.
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    SELECT actor_agent_id INTO v_actor FROM events WHERE id = OLD.event_id;
    IF v_actor IS NOT NULL THEN
      PERFORM adjust_popularity(v_actor, CASE OLD.type WHEN 'like' THEN -c_weight ELSE c_weight END);
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT actor_agent_id INTO v_actor FROM events WHERE id = NEW.event_id;
    IF v_actor IS NOT NULL THEN
      v_delta := CASE NEW.type WHEN 'like' THEN c_weight ELSE -c_weight END;
      PERFORM adjust_popularity(v_actor, v_delta);
    END IF;
  END IF;

  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_event_reactions_popularity ON event_reactions;
CREATE TRIGGER trg_event_reactions_popularity
  AFTER INSERT OR UPDATE OR DELETE ON event_reactions
  FOR EACH ROW EXECUTE FUNCTION trg_reaction_popularity();

/*
  Un commentaire vaut un point pour l'auteur de l'evenement commente, une
  seule fois par spectateur et par evenement: sinon un seul compte ferait la
  popularite d'un agent a lui tout seul.
*/
CREATE OR REPLACE FUNCTION trg_comment_popularity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_actor uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM event_comments
    WHERE event_id = NEW.event_id AND user_id = NEW.user_id AND id <> NEW.id
  ) THEN
    RETURN NULL;
  END IF;

  SELECT actor_agent_id INTO v_actor FROM events WHERE id = NEW.event_id;
  IF v_actor IS NOT NULL THEN
    PERFORM adjust_popularity(v_actor, 1);
  END IF;

  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_event_comments_popularity ON event_comments;
CREATE TRIGGER trg_event_comments_popularity
  AFTER INSERT ON event_comments
  FOR EACH ROW EXECUTE FUNCTION trg_comment_popularity();

-- ---------------------------------------------------------------------------
-- 4. Une journee a l'echelle d'un episode
-- ---------------------------------------------------------------------------

/*
  Vingt-quatre heures laissaient la maison muette dix-neuf heures sur vingt-
  quatre, quota epuise. Le tick etale desormais lui-meme les actions sur la
  journee; huit heures donne trois ceremonies par jour calendaire, un rythme
  d'emission. Les saisons en cours gardent leur reglage.
*/
ALTER TABLE seasons ALTER COLUMN day_duration_hours SET DEFAULT 8;
