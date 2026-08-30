/*
  # Durcissement RLS

  ## Contexte
  Plusieurs policies etaient en `USING (true)` sur des tables contenant les
  secrets du jeu, les cles d'API et les messages prives payants. Toutes ces
  donnees etaient lisibles avec la seule cle anon, publique par nature puisque
  presente dans le bundle JavaScript.

  Points corriges:
  1. `agents.secret_keyword` et `agents.api_key` en lecture publique — le
     principe meme du jeu (deviner le secret) etait resolvable en une requete,
     et l'api_key permettait d'agir au nom de n'importe quel agent.
  2. `hints.hint_text` lisible meme verrouille (securite par obscurcissement
     cote client, assumee en commentaire dans la migration d'origine).
  3. `influence_history` en `anon USING (true)`: les policies se combinant en OR,
     un visiteur anonyme voyait plus qu'un utilisateur authentifie.
  4. Paywalls contournables: `dm_reveals` / `diary_unlocks` / `payments`
     insérables directement par le client, avec montant et statut libres.
  5. Bucket `avatars`: policies nommees « their avatars » mais sans condition
     de proprietaire.

  ## Approche
  L'acces public passe desormais par des vues en liste blanche de colonnes.
  Les tables sous-jacentes ne sont plus lisibles directement par anon.
*/

-- ---------------------------------------------------------------------------
-- 1. Agents: vue publique sans secret ni cle d'API
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Anon can view agents" ON agents;
DROP POLICY IF EXISTS "Anyone authenticated can view agents" ON agents;

-- Le proprietaire garde l'acces complet a son propre agent (il en connait deja
-- le secret), et l'admin a tout.
CREATE POLICY "Owners can view own agents"
  ON agents FOR SELECT
  TO authenticated
  USING (
    owner_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
  );

CREATE OR REPLACE VIEW agents_public
WITH (security_invoker = false) AS
SELECT
  id,
  season_id,
  agent_config_id,
  owner_user_id,
  name,
  avatar_url,
  presentation,
  alive,
  popularity,
  reputation,
  confessional_count,
  owner_influences_remaining,
  created_at,
  -- Le secret n'est expose qu'une fois l'agent hors jeu ou la saison terminee.
  CASE
    WHEN alive = false THEN secret_keyword
    WHEN EXISTS (
      SELECT 1 FROM seasons s WHERE s.id = agents.season_id AND s.status = 'ended'
    ) THEN secret_keyword
    ELSE NULL
  END AS secret_keyword
FROM agents;

GRANT SELECT ON agents_public TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Hints: le texte verrouille ne quitte plus la base
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Anon can view hints metadata" ON hints;
DROP POLICY IF EXISTS "Authenticated can view hints metadata" ON hints;

CREATE POLICY "Owners and admins can view hints"
  ON hints FOR SELECT
  TO authenticated
  USING (
    unlocked = true
    OR EXISTS (
      SELECT 1 FROM agents a
      WHERE a.id = hints.agent_id AND a.owner_user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
  );

/*
  Le tableau d'indices a besoin de connaitre l'etat de verrouillage des trois
  niveaux sans en reveler le contenu: la vue expose la structure, jamais le texte
  d'un indice encore verrouille.
*/
CREATE OR REPLACE VIEW hints_public
WITH (security_invoker = false) AS
SELECT
  id,
  agent_id,
  level,
  unlocked,
  unlocked_at,
  CASE WHEN unlocked THEN hint_text ELSE NULL END AS hint_text
FROM hints;

GRANT SELECT ON hints_public TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Host config: la cle d'API ne doit jamais traverser PostgREST
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Anon can view host configs" ON host_agent_configs;
DROP POLICY IF EXISTS "Authenticated can view host configs" ON host_agent_configs;

CREATE POLICY "Admins can view host configs"
  ON host_agent_configs FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'));

-- Identite publique du presentateur, sans secret.
CREATE OR REPLACE VIEW host_public
WITH (security_invoker = false) AS
SELECT
  id,
  season_id,
  name,
  avatar_url,
  personality,
  enabled,
  (openrouter_api_key IS NOT NULL AND openrouter_api_key <> '') AS has_api_key,
  openrouter_model,
  created_at,
  updated_at
FROM host_agent_configs;

GRANT SELECT ON host_public TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Influence history: la policy anon annulait la restriction authenticated
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Anon can view public influence history" ON influence_history;

-- Ce que paient les spectateurs reste public; les directives privees des
-- proprietaires ne le sont pas.
CREATE POLICY "Anon can view spectator influences"
  ON influence_history FOR SELECT
  TO anon
  USING (influence_type = 'spectator_influence');

-- ---------------------------------------------------------------------------
-- 5. Paywalls: plus d'ecriture directe par le client
-- ---------------------------------------------------------------------------

/*
  Les insertions client ne contraignaient ni le montant ni le statut: on pouvait
  inserer un paiement `confirmed` de montant arbitraire (falsification de la
  cagnotte), ou creer directement la ligne de deverrouillage avec un montant nul
  (contournement du paywall). Les deverrouillages passent desormais par une RPC
  qui verifie un paiement confirme du bon montant.
*/

DROP POLICY IF EXISTS "Users can insert own payments" ON payments;
CREATE POLICY "Users can request own payments"
  ON payments FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'pending'
    AND amount_usdc >= 0
  );

DROP POLICY IF EXISTS "Users can insert own DM reveals" ON dm_reveals;
DROP POLICY IF EXISTS "Users can insert own diary unlocks" ON diary_unlocks;

CREATE OR REPLACE FUNCTION purchase_unlock(
  p_kind      text,         -- 'dm' | 'diary'
  p_season_id uuid,
  p_target_id uuid          -- event_id pour 'dm', agent_id pour 'diary'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user   uuid := auth.uid();
  v_season record;
  v_price  numeric;
  v_paid   numeric;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_season FROM seasons WHERE id = p_season_id;
  IF v_season IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'season_not_found');
  END IF;

  v_price := CASE p_kind
               WHEN 'dm'    THEN COALESCE(v_season.dm_reveal_fee_usdc, 0)
               WHEN 'diary' THEN COALESCE(v_season.diary_unlock_fee_usdc, 0)
             END;

  IF v_price IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_kind');
  END IF;

  -- Deja debloque: operation idempotente, on ne refacture pas.
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

  /*
    Credit disponible = paiements confirmes moins ce qui a deja ete consomme par
    des deverrouillages. Pas besoin de marquer chaque paiement: le solde se
    deduit de l'ecart entre les deux, ce qui reste juste meme en cas de retry.
  */
  SELECT
    COALESCE((
      SELECT SUM(amount_usdc) FROM payments
      WHERE user_id = v_user AND season_id = p_season_id
        AND status = 'confirmed' AND type = 'influence'
    ), 0)
    - COALESCE((
      SELECT SUM(amount_usdc) FROM dm_reveals
      WHERE user_id = v_user AND season_id = p_season_id
    ), 0)
    - COALESCE((
      SELECT SUM(amount_usdc) FROM diary_unlocks
      WHERE user_id = v_user AND season_id = p_season_id
    ), 0)
  INTO v_paid;

  IF v_price > 0 AND v_paid < v_price THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_required',
                              'required', v_price, 'available', v_paid);
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

GRANT EXECUTE ON FUNCTION purchase_unlock(text, uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION purchase_unlock(text, uuid, uuid) FROM anon;

-- ---------------------------------------------------------------------------
-- 6. Storage: un avatar n'appartient qu'a son proprietaire
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Authenticated users can update their avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete their avatars" ON storage.objects;

CREATE POLICY "Owners can update their avatars"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'avatars' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'avatars' AND owner = auth.uid());

CREATE POLICY "Owners can delete their avatars"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'avatars' AND owner = auth.uid());

-- ---------------------------------------------------------------------------
-- 7. Index manquants sur les colonnes reellement filtrees
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_agents_config ON agents (agent_config_id);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments (user_id);
CREATE INDEX IF NOT EXISTS idx_events_feed ON events (season_id, visibility, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON events (season_id, event_type);
CREATE INDEX IF NOT EXISTS idx_events_actor_user ON events (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_config ON season_enrollments (agent_config_id);
CREATE INDEX IF NOT EXISTS idx_influence_event ON influence_history (event_id);
CREATE INDEX IF NOT EXISTS idx_dm_reveals_season ON dm_reveals (user_id, season_id);
CREATE INDEX IF NOT EXISTS idx_prize_dist_agent ON prize_distributions (recipient_agent_id);
CREATE INDEX IF NOT EXISTS idx_seasons_winner ON seasons (winner_agent_id);
