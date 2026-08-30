/*
  # Quota de messages atomique

  ## Contexte
  Trois systemes de comptage coexistaient pour la meme regle:
    - `agent-api`  : upsert non atomique (lire -> +1 -> ecrire), qui perd des
                     increments des que deux requetes se croisent;
    - `auto-tick`  : recomptage des lignes de `events`;
    - `agent-brain`: aucune limite du tout.

  Un agent pouvait donc cumuler 20 messages via l'API, 20 de plus via les ticks
  automatiques, et un nombre illimite via agent-brain.

  Cette RPC devient le seul point de passage: elle reserve un jeton de quota de
  facon atomique et renvoie le solde restant.
*/

CREATE OR REPLACE FUNCTION claim_message_quota(
  p_agent_id     uuid,
  p_day_number   integer,
  p_message_type text,
  p_limit        integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_count integer;
BEGIN
  /*
    L'INSERT ... ON CONFLICT DO UPDATE est atomique: la ligne est verrouillee le
    temps de l'increment, donc deux appels simultanes ne peuvent pas lire la
    meme valeur de depart.
  */
  INSERT INTO daily_message_counts (agent_id, day_number, message_type, count)
  VALUES (p_agent_id, p_day_number, p_message_type, 1)
  ON CONFLICT (agent_id, day_number, message_type)
  DO UPDATE SET count = daily_message_counts.count + 1
  RETURNING count INTO v_count;

  IF v_count > p_limit THEN
    -- Quota depasse: on rend le jeton et on refuse.
    UPDATE daily_message_counts
    SET count = count - 1
    WHERE agent_id = p_agent_id
      AND day_number = p_day_number
      AND message_type = p_message_type;

    RETURN jsonb_build_object(
      'allowed', false,
      'used', p_limit,
      'limit', p_limit,
      'remaining', 0
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'used', v_count,
    'limit', p_limit,
    'remaining', GREATEST(p_limit - v_count, 0)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION claim_message_quota(uuid, integer, text, integer) FROM PUBLIC, anon;

/* Libere un jeton lorsque l'action reservee echoue apres coup. */
CREATE OR REPLACE FUNCTION release_message_quota(
  p_agent_id     uuid,
  p_day_number   integer,
  p_message_type text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  UPDATE daily_message_counts
  SET count = GREATEST(count - 1, 0)
  WHERE agent_id = p_agent_id
    AND day_number = p_day_number
    AND message_type = p_message_type;
$fn$;

REVOKE ALL ON FUNCTION release_message_quota(uuid, integer, text) FROM PUBLIC, anon;
