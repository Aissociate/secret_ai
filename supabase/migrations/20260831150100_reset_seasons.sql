/*
  # Réinitialisation des saisons

  ⚠️ **Cette migration supprime toutes les saisons et tout ce qui en dépend.**

  Les règles ont changé en profondeur : secrets tirés autrement, modèles au
  choix, tokens facturés, curseurs de comportement, décroissance de popularité.
  Les parties en cours ont été lancées sous d'autres règles et ne peuvent pas
  converger correctement — les agents existants n'ont ni traits, ni modèle
  choisi, et portent des secrets désormais sur liste noire.

  ## Ce qui est supprimé
  Saisons, et par cascade : agents, événements, indices, inscriptions,
  distributions, propositions de spectateurs, défis, tâches vidéo.

  ## Ce qui survit
  - Les **comptes** et leur **solde**.
  - L'**historique financier** : `wallet_ledger` et `token_usage` référencent la
    saison en `ON DELETE SET NULL`, donc les lignes restent et les soldes
    demeurent justes.
  - Les **configurations d'agents** — le travail créatif des propriétaires.

  ## Remboursements
  Les droits d'entrée des saisons **non terminées** sont recrédités : le joueur
  a payé pour une partie qui n'aura pas lieu. Ceux des saisons terminées ne le
  sont pas — la partie a bien eu lieu.
*/

CREATE OR REPLACE FUNCTION reset_all_seasons(p_include_ended boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_refunded  integer := 0;
  v_amount    numeric := 0;
  v_deleted   integer := 0;
  r           record;
BEGIN
  /*
    Remboursement avant suppression: une fois la saison effacee, on ne saurait
    plus quel droit d'entree correspondait a quoi.
  */
  FOR r IN
    SELECT l.user_id, l.season_id, -l.amount_usdc AS amount, s.title
    FROM wallet_ledger l
    JOIN seasons s ON s.id = l.season_id
    WHERE l.kind = 'entry_fee'
      AND l.amount_usdc < 0
      AND s.status <> 'ended'
      AND NOT EXISTS (
        SELECT 1 FROM wallet_ledger r2
        WHERE r2.user_id = l.user_id
          AND r2.season_id = l.season_id
          AND r2.kind = 'refund'
      )
  LOOP
    INSERT INTO wallet_ledger (user_id, kind, amount_usdc, season_id, note)
    VALUES (r.user_id, 'refund', r.amount, r.season_id,
            'Saison annulee : ' || COALESCE(r.title, 'sans titre'));

    v_refunded := v_refunded + 1;
    v_amount := v_amount + r.amount;
  END LOOP;

  IF p_include_ended THEN
    DELETE FROM seasons;
  ELSE
    DELETE FROM seasons WHERE status <> 'ended';
  END IF;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'seasons_deleted', v_deleted,
    'refunds', v_refunded,
    'refunded_total', v_amount
  );
END;
$fn$;

REVOKE ALL ON FUNCTION reset_all_seasons(boolean) FROM PUBLIC, anon, authenticated;

/*
  Les secrets tires sous l'ancien prompt appartiennent au cluster desormais sur
  liste noire. `secret_is_available` n'est consultee qu'a la generation: le
  trigger de lancement recopie le secret de la configuration sans le revalider,
  si bien qu'une vieille configuration reintroduirait « constellation » ou
  « corbeau » dans une saison neuve.

  On efface donc uniquement les secrets concernes, et on repasse la
  configuration en « non prete » pour que son proprietaire en regenere un. Le
  reste de son travail — nom, avatar, personnalite, curseurs — est conserve.
*/
DO $$
DECLARE
  v_cleared integer;
BEGIN
  UPDATE agent_configs
  SET secret_keyword = '',
      hint_1 = '',
      hint_2 = '',
      hint_3 = '',
      ready = false
  WHERE normalize_secret(secret_keyword) IN (SELECT normalized FROM secret_blocklist);

  GET DIAGNOSTICS v_cleared = ROW_COUNT;
  RAISE NOTICE 'Secrets obsoletes effaces sur % configuration(s)', v_cleared;
END $$;

DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := reset_all_seasons(true);
  RAISE NOTICE 'Reinitialisation: %', v_result;
END $$;
