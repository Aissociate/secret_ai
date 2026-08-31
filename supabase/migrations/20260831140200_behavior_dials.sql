/*
  # Variables de comportement

  ## Le problème
  La personnalisation se résumait à trois champs de texte libre
  (`personality_traits`, `strategy_notes`, `system_prompt`) qui n'atteignaient
  que le prompt. Deux agents aux doctrines opposées jouaient donc exactement de
  la même façon : la distribution des actions était codée en dur et identique
  pour tous (10 % accusation, 55 % message public, 20 % confessionnal, sinon un
  message privé).

  Autrement dit, la doctrine décorait le discours sans jamais changer le jeu.

  ## Ce que font ces curseurs
  Les quatre premiers **pondèrent réellement le tirage d'action** : un agent
  audacieux accuse plus souvent, un agent sociable envoie plus de messages
  privés. Les deux derniers n'agissent que sur le ton, et c'est assumé — tout
  n'a pas à être mécanique.

  Ils sont aussi injectés dans le prompt, pour que la manière de parler suive la
  manière de jouer.
*/

ALTER TABLE agent_configs
  -- Pondèrent le tirage d'action.
  ADD COLUMN IF NOT EXISTS trait_audace       integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS trait_sociabilite  integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS trait_expressivite integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS trait_introspection integer NOT NULL DEFAULT 50,
  -- N'agissent que sur le ton.
  ADD COLUMN IF NOT EXISTS trait_loyaute      integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS trait_discretion   integer NOT NULL DEFAULT 50,
  -- Texte libre, pour ce qu'aucun curseur ne capture.
  ADD COLUMN IF NOT EXISTS signature_style    text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS taboo              text NOT NULL DEFAULT '';

DO $$
DECLARE
  c text;
BEGIN
  FOREACH c IN ARRAY ARRAY[
    'trait_audace', 'trait_sociabilite', 'trait_expressivite',
    'trait_introspection', 'trait_loyaute', 'trait_discretion'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'agent_configs_' || c || '_range'
    ) THEN
      EXECUTE format(
        'ALTER TABLE agent_configs ADD CONSTRAINT %I CHECK (%I BETWEEN 0 AND 100)',
        'agent_configs_' || c || '_range', c
      );
    END IF;
  END LOOP;
END $$;

/* Les mêmes valeurs sont recopiées sur l'agent au lancement de la saison. */
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS trait_audace       integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS trait_sociabilite  integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS trait_expressivite integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS trait_introspection integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS trait_loyaute      integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS trait_discretion   integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS signature_style    text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS taboo              text NOT NULL DEFAULT '';

-- ---------------------------------------------------------------------------
-- Pondération du tirage d'action
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION scale_trait(p_value integer)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN COALESCE(p_value, 50) <= 50
      THEN 0.33 + (COALESCE(p_value, 50)::numeric / 50) * 0.67
    ELSE 1.0 + ((COALESCE(p_value, 50) - 50)::numeric / 50)
  END;
$fn$;

GRANT EXECUTE ON FUNCTION scale_trait(integer) TO anon, authenticated;

/*
  Renvoie les poids relatifs des quatre actions pour un agent.

  Un curseur à 50 laisse le poids de référence, à 0 le divise par trois, à 100
  le double : assez pour que deux doctrines opposées se distinguent nettement,
  pas assez pour qu'un agent ne fasse plus jamais qu'une seule chose — un agent
  qui n'enverrait que des accusations serait vite discrédité, et illisible.
*/
CREATE OR REPLACE FUNCTION agent_action_weights(p_agent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  a record;
BEGIN
  SELECT trait_audace, trait_sociabilite, trait_expressivite, trait_introspection
  INTO a FROM agents WHERE id = p_agent_id;

  IF a IS NULL THEN
    RETURN jsonb_build_object(
      'accusation', 10, 'public_chat', 45, 'confessional', 20, 'dm', 25
    );
  END IF;

  RETURN jsonb_build_object(
    'accusation',   ROUND(10 * scale_trait(a.trait_audace)),
    'public_chat',  ROUND(45 * scale_trait(a.trait_expressivite)),
    'confessional', ROUND(20 * scale_trait(a.trait_introspection)),
    'dm',           ROUND(25 * scale_trait(a.trait_sociabilite))
  );
END;
$fn$;

REVOKE ALL ON FUNCTION agent_action_weights(uuid) FROM PUBLIC, anon, authenticated;
