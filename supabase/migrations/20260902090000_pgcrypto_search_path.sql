/*
  # `gen_random_bytes` redevient visible au lancement de saison

  Lancer une saison echoue sur:

      function gen_random_bytes(integer) does not exist

  `auto_launch_season_when_full` cree la cle d'API de chaque agent avec
  `encode(gen_random_bytes(16), 'hex')`. `gen_random_bytes` appartient a
  pgcrypto, que Supabase range dans le schema `extensions` et non dans `public`.

  ## D'ou vient la regression

  La version d'origine (`20260219194354_populate_agents_on_season_launch`) ne
  fixait aucun `search_path`: la fonction heritait de celui de la session, qui
  contient `extensions`, et l'appel se resolvait. Le durcissement de
  `20260830120000_season_lifecycle_and_security` l'a passee en SECURITY DEFINER
  avec `SET search_path = public, pg_temp` — une bonne pratique, un
  `search_path` non fixe sur une fonction SECURITY DEFINER etant detournable —
  mais sans ajouter le schema ou vit pgcrypto. L'appel a `gen_random_bytes`,
  lui, n'a pas bouge. La meme migration montre pourtant qu'on savait le faire:
  `notify_edge_function` y porte `SET search_path = public, pg_temp, net` pour
  atteindre pg_net.

  Les trois redefinitions suivantes ont recopie le defaut.

  ## Ce que fait ce fichier

  `ALTER FUNCTION ... SET search_path` ne touche qu'au reglage, pas au corps: il
  n'y a donc pas de cinquieme copie des cent lignes de cette fonction dans le
  depot.

  Le schema n'est pas ecrit en dur mais lu dans `pg_extension`: selon l'age du
  projet Supabase, pgcrypto se trouve dans `extensions` ou dans `public`, et une
  constante serait fausse une fois sur deux.

  ## Avertissement

  Toute redefinition future de `auto_launch_season_when_full` doit conserver le
  schema de pgcrypto dans son `search_path`, sans quoi le bug revient — c'est
  exactement ainsi qu'il est apparu.
*/

DO $$
DECLARE
  v_schema text;
BEGIN
  SELECT n.nspname INTO v_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pgcrypto';

  /*
    Absente, on l'installe. Le cas ne devrait pas se presenter — la table
    `agent_challenges` porte un DEFAULT `encode(gen_random_bytes(12), 'hex')`,
    et sa creation aurait echoue sans pgcrypto — mais un deploiement neuf sur
    une base minimale n'a pas cette garantie.
  */
  IF v_schema IS NULL THEN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
      EXECUTE 'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions';
      v_schema := 'extensions';
    ELSE
      EXECUTE 'CREATE EXTENSION IF NOT EXISTS pgcrypto';
      SELECT n.nspname INTO v_schema
      FROM pg_extension e
      JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname = 'pgcrypto';
    END IF;
  END IF;

  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'pgcrypto introuvable et non installable: gen_random_bytes restera indisponible.';
  END IF;

  -- `public` deux fois serait accepte, mais autant garder un reglage lisible.
  IF v_schema = 'public' THEN
    EXECUTE 'ALTER FUNCTION auto_launch_season_when_full() SET search_path = public, pg_temp';
  ELSE
    EXECUTE format(
      'ALTER FUNCTION auto_launch_season_when_full() SET search_path = public, %I, pg_temp',
      v_schema
    );
  END IF;

  RAISE NOTICE 'auto_launch_season_when_full: search_path = public, %, pg_temp', v_schema;
END $$;

/*
  Garde-fou: si `gen_random_bytes` reste introuvable, mieux vaut interrompre la
  migration que laisser le lancement de saison echouer plus tard, au moment ou
  un joueur s'inscrit.
*/
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'gen_random_bytes') THEN
    RAISE EXCEPTION 'gen_random_bytes reste introuvable apres installation de pgcrypto.';
  END IF;
END $$;
