/*
  # Correctifs des privileges et de la progression

  Cette migration corrige des defauts introduits par les migrations du 30/08.

  ## 1. Les vues etaient accessibles en ECRITURE a anon
  Un projet Supabase pose des default privileges qui accordent `ALL ON TABLES`
  (les vues incluses) a anon/authenticated. Un `GRANT SELECT` est additif: il ne
  retire pas l'INSERT/UPDATE/DELETE deja accorde. Comme les vues sont
  auto-updatable et declarees `security_invoker = false`, elles s'executaient
  avec les droits du proprietaire et contournaient la RLS:
  `PATCH /hints_public {"unlocked": true}` deverrouillait tous les indices.
  C'etait strictement pire que l'etat initial.

  ## 2. `REVOKE ... FROM PUBLIC` ne revoquait rien
  Meme cause: les droits sont accordes explicitement a anon/authenticated, pas
  via PUBLIC. Le cas le plus grave est `notify_edge_function`, qui n'avait aucun
  REVOKE: n'importe quel visiteur pouvait l'appeler avec fn_name='auto-tick',
  la fonction ajoutant elle-meme l'en-tete X-Cron-Secret depuis le GUC. Tout le
  dispositif CRON_SECRET etait donc neutralise.

  ## 3. `advance_season_day` levait une exception
  `v_eliminated` n'etait assigne que dans la boucle WHILE. Quand une accusation
  correcte avait deja eu lieu dans la journee, la boucle etait sautee et l'acces
  a `v_eliminated.name` levait « record is not assigned yet »: la saison se
  figeait et le cron echouait pour toutes les saisons.

  ## 4. La cagnotte retombait a zero
  `compute_prize_pool` n'agrege que les paiements `confirmed`, or aucun chemin
  applicatif ne confirme un paiement. Le total valait 0 (et non NULL), donc le
  repli `?? prize_pool_usdc` du front ne se declenchait jamais, et
  `close_season` ecrasait la cagnotte calculee au lancement.
*/

-- ---------------------------------------------------------------------------
-- 1. Verrouillage des vues en lecture seule
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_view text;
BEGIN
  FOREACH v_view IN ARRAY ARRAY[
    'agents_public', 'hints_public', 'host_public',
    'events_feed', 'video_settings_public'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = v_view) THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', v_view);
      EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated', v_view);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Revocation reelle des fonctions sensibles
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'advance_season_day(uuid, boolean)',
    'close_season(uuid, text)',
    'tick_all_seasons()',
    'claim_message_quota(uuid, integer, text, integer)',
    'release_message_quota(uuid, integer, text)',
    'purge_expired_wallet_nonces()',
    'notify_edge_function(text, jsonb)',
    'prevent_role_self_escalation()'
  ]
  LOOP
    BEGIN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', v_sig
      );
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'Fonction absente, ignoree: %', v_sig;
    END;
  END LOOP;
END $$;

/*
  notify_edge_function ne doit accepter qu'une liste blanche de fonctions:
  `fn_name` etait concatene dans l'URL sans validation.
*/
CREATE OR REPLACE FUNCTION notify_edge_function(fn_name text, payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp, net
AS $fn$
DECLARE
  v_url    text := current_setting('app.supabase_url', true);
  v_secret text := current_setting('app.cron_secret', true);
BEGIN
  IF fn_name NOT IN (
    'auto-tick', 'daily-confessionals', 'generate-host-clue', 'process-video-jobs'
  ) THEN
    RAISE EXCEPTION 'Fonction non autorisee: %', fn_name;
  END IF;

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
  RAISE WARNING 'notify_edge_function(%) a echoue: %', fn_name, SQLERRM;
END;
$fn$;

REVOKE ALL ON FUNCTION notify_edge_function(text, jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Amorçage administrateur
-- ---------------------------------------------------------------------------

/*
  Le trigger precedent etait declare SECURITY DEFINER, si bien que `current_user`
  y valait toujours son proprietaire (postgres) et jamais 'service_role'. Et
  `request.jwt.claim.role` n'existe plus depuis PostgREST 12. Aucune des deux
  echappatoires ne fonctionnait: plus personne ne pouvait promouvoir un admin,
  meme depuis l'editeur SQL.

  Sans SECURITY DEFINER, `current_user` reflete le role reel de la connexion.
  Un acces SQL direct (postgres) ou service_role peut donc changer un role;
  une requete PostgREST (anon/authenticated) ne le peut pas.
*/
CREATE OR REPLACE FUNCTION prevent_role_self_escalation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_jwt_role text;
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_jwt_role := current_setting('request.jwt.claims', true)::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Un compte cree depuis le navigateur ne peut jamais naitre admin.
    IF NEW.role NOT IN ('spectator', 'owner') THEN
      NEW.role := 'spectator';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Le role ne peut pas etre modifie depuis le client';
  END IF;

  RETURN NEW;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Bornes journalieres alignees sur duration_days
-- ---------------------------------------------------------------------------

/*
  Seuls seasons.current_day et events.day_number avaient ete rattaches a
  duration_days. Cinq autres tables gardaient un CHECK fige a 7 jours: des le
  jour 8, claim_message_quota violait la contrainte et agent-api, qui ne lit pas
  l'erreur, repondait « limite quotidienne atteinte » a chaque message.
*/
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass::text AS tbl, c.conname
    FROM pg_constraint c
    WHERE c.contype = 'c'
      AND c.conrelid::regclass::text IN (
        'daily_message_counts', 'allowances_daily', 'influence_history',
        'scoring_log', 'diary_entries'
      )
      AND pg_get_constraintdef(c.oid) ILIKE '%day_number%'
      AND pg_get_constraintdef(c.oid) ILIKE '%7%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I CHECK (day_number >= 1)',
      r.tbl, r.conname
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Deverrouillages payants: retablir un chemin fonctionnel
-- ---------------------------------------------------------------------------

/*
  La version precedente exigeait un credit issu de paiements `confirmed`. Or
  aucun chemin applicatif ne confirme de paiement (il n'y a pas encore de
  prestataire branche), et les policies d'insertion directe ont ete supprimees:
  DM et journal etaient donc devenus inachetables.

  Cette version enregistre elle-meme la dette au tarif de la saison, puis
  accorde l'acces. Le trou reellement corrige est le controle du montant: le
  client fixait librement `amount_usdc` et pouvait donc payer 0. Le prix est
  desormais lu en base, jamais recu du navigateur.

  Quand un prestataire de paiement sera branche, il suffira de passer
  `v_require_confirmed` a true: la fonction exigera alors un credit confirme.
*/
CREATE OR REPLACE FUNCTION purchase_unlock(
  p_kind      text,
  p_season_id uuid,
  p_target_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user    uuid := auth.uid();
  v_season  record;
  v_price   numeric;
  v_credit  numeric;
  v_require_confirmed boolean :=
    COALESCE(current_setting('app.require_confirmed_payment', true)::boolean, false);
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF p_kind NOT IN ('dm', 'diary') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_kind');
  END IF;

  SELECT * INTO v_season FROM seasons WHERE id = p_season_id;
  IF v_season IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'season_not_found');
  END IF;

  v_price := CASE p_kind
               WHEN 'dm'    THEN COALESCE(v_season.dm_reveal_fee_usdc, 0)
               ELSE              COALESCE(v_season.diary_unlock_fee_usdc, 0)
             END;

  -- Idempotent: un deverrouillage deja acquis n'est jamais refacture.
  IF p_kind = 'dm' AND EXISTS (
    SELECT 1 FROM dm_reveals WHERE user_id = v_user AND event_id = p_target_id
  ) THEN
    RETURN jsonb_build_object('ok', true, 'already_unlocked', true);
  END IF;

  IF p_kind = 'diary' AND EXISTS (
    SELECT 1 FROM diary_unlocks WHERE user_id = v_user AND agent_id = p_target_id
  ) THEN
    RETURN jsonb_build_object('ok', true, 'already_unlocked', true);
  END IF;

  IF v_require_confirmed AND v_price > 0 THEN
    SELECT
      COALESCE((SELECT SUM(amount_usdc) FROM payments
                WHERE user_id = v_user AND season_id = p_season_id
                  AND status = 'confirmed' AND type = 'influence'), 0)
      - COALESCE((SELECT SUM(amount_usdc) FROM dm_reveals
                  WHERE user_id = v_user AND season_id = p_season_id), 0)
      - COALESCE((SELECT SUM(amount_usdc) FROM diary_unlocks
                  WHERE user_id = v_user AND season_id = p_season_id), 0)
    INTO v_credit;

    IF v_credit < v_price THEN
      RETURN jsonb_build_object('ok', false, 'error', 'payment_required',
                                'required', v_price, 'available', v_credit);
    END IF;
  ELSIF v_price > 0 THEN
    -- Trace de la dette au tarif officiel de la saison.
    INSERT INTO payments (user_id, season_id, type, amount_usdc, status)
    VALUES (v_user, p_season_id, 'influence', v_price, 'pending');
  END IF;

  IF p_kind = 'dm' THEN
    INSERT INTO dm_reveals (event_id, user_id, season_id, amount_usdc)
    VALUES (p_target_id, v_user, p_season_id, v_price);
  ELSE
    INSERT INTO diary_unlocks (user_id, agent_id, season_id, amount_usdc)
    VALUES (v_user, p_target_id, p_season_id, v_price);
  END IF;

  RETURN jsonb_build_object('ok', true, 'amount', v_price);
END;
$fn$;

REVOKE ALL ON FUNCTION purchase_unlock(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION purchase_unlock(text, uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Quota des confessionnaux
-- ---------------------------------------------------------------------------

/*
  `LIMITS.confessional = 3` etait declare dans agent-api mais jamais applique:
  la route accordait +2 de popularite sans plafond. Le CHECK de
  daily_message_counts n'acceptait que 'public_chat' et 'private_dm', il faut
  donc y ajouter le type avant de pouvoir reserver le quota.
*/
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
  CHECK (message_type IN ('public_chat', 'private_dm', 'confessional'));
