/*
  # Reglages du jeu

  Plusieurs valeurs qui gouvernent la partie etaient dispersees et figees :
  marge sur les tokens et bonus de bienvenue dans des GUC de base, modele de
  repli deduit d'un tri, prompt de generation des secrets code en dur dans une
  fonction Edge. Aucune n'etait modifiable sans redeploiement, ni consultable
  depuis l'application.

  Une ligne unique les rassemble, editable par un administrateur.

  ## Prompt de generation
  Il est stocke comme gabarit avec des marqueurs substitues a l'execution :

  - `{domaine}`  : domaine tire au sort (horlogerie, reliure, speleologie...)
  - `{forme}`    : contrainte de forme tiree au sort
  - `{interdits}`: mots deja utilises dans la saison
  - `{indice3}`  : consigne du troisieme indice, selon hint_directness

  Le tirage du domaine et de la forme reste cote serveur : c'est lui qui evite
  que le modele se rabatte toujours sur le meme registre.
*/

CREATE TABLE IF NOT EXISTS game_settings (
  id                   boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- Modele servant de repli quand un solde est epuise.
  free_model_slug      text REFERENCES llm_models(slug) ON UPDATE CASCADE ON DELETE SET NULL,
  -- Modele employe pour generer secrets, indices et presentations.
  secret_model_slug    text REFERENCES llm_models(slug) ON UPDATE CASCADE ON DELETE SET NULL,
  secret_prompt        text NOT NULL DEFAULT '',
  -- Economie.
  token_margin         numeric(6,2) NOT NULL DEFAULT 3 CHECK (token_margin >= 1),
  welcome_bonus        numeric(12,2) NOT NULL DEFAULT 200 CHECK (welcome_bonus >= 0),
  -- Valeurs par defaut appliquees aux nouvelles saisons.
  default_decay_pct    integer NOT NULL DEFAULT 20 CHECK (default_decay_pct BETWEEN 0 AND 50),
  default_min_rep      integer NOT NULL DEFAULT 30 CHECK (default_min_rep BETWEEN 0 AND 100),
  default_hint_directness integer NOT NULL DEFAULT 1 CHECK (default_hint_directness BETWEEN 1 AND 2),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE game_settings ENABLE ROW LEVEL SECURITY;

/*
  Lecture ouverte: les tarifs et le modele de repli s'affichent deja dans
  l'interface. Le prompt de generation n'a rien de secret non plus — il decrit
  la contrainte, pas les mots.
*/
DROP POLICY IF EXISTS "Anyone reads settings" ON game_settings;
CREATE POLICY "Anyone reads settings"
  ON game_settings FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Admins update settings" ON game_settings;
CREATE POLICY "Admins update settings"
  ON game_settings FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

/*
  Amorcage. Le modele de repli est le gratuit le plus capable disponible; celui
  de generation, un modele economique mais correct en redaction.
*/
INSERT INTO game_settings (id, free_model_slug, secret_model_slug, secret_prompt)
SELECT
  true,
  (SELECT slug FROM llm_models
    WHERE is_free AND enabled AND (expires_at IS NULL OR expires_at > now()::date)
    ORDER BY context_length DESC, slug LIMIT 1),
  (SELECT slug FROM llm_models WHERE slug = 'openai/gpt-4o-mini' AND enabled),
  $prompt$Tu es le maitre du jeu de "La Maison des Secrets". Chaque IA possede un MOT SECRET que les autres doivent deviner pour l'eliminer.

Le mot secret doit etre tire du domaine suivant: {domaine}.
Il doit respecter cette contrainte de forme: {forme}.

REGLES SUR LE MOT:
- Un seul mot, un nom commun francais, au singulier, sans accent de preference
- Il doit exister reellement et etre verifiable dans un dictionnaire
- Il doit etre precis et technique plutot qu'evocateur ou poetique
- N'utilise AUCUN mot du registre onirique (astres, ombres, reves, oiseaux, mysteres)
{interdits}

REGLES SUR LES INDICES — chacun contraint un axe DIFFERENT, jamais le meme:
- Indice 1 : evoque uniquement le CONTEXTE d'usage, sans decrire l'objet. Maximum 14 mots.
- Indice 2 : evoque uniquement la MATIERE, la taille ou la sensation physique. Maximum 14 mots.
{indice3} Maximum 14 mots.

Les trois indices ne doivent JAMAIS pouvoir se resumer a la meme image. Pris isolement, aucun ne doit suffire. Pris ensemble, ils doivent designer un mot unique.

PRESENTATION (environ 400 caracteres):
- A la premiere personne, comme si l'IA se presentait aux autres candidats
- Reflete sa personnalite, cree une premiere impression memorable
- Ne doit contenir aucune allusion au domaine du secret

Reponds UNIQUEMENT en JSON valide, sans texte avant ni apres:
{"secret_keyword":"lemot","hint_1":"...","hint_2":"...","hint_3":"...","presentation":"..."}$prompt$
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Les fonctions existantes lisent ces reglages
-- ---------------------------------------------------------------------------

/* La marge vient du panneau, plus d'un GUC invisible. */
CREATE OR REPLACE FUNCTION token_margin()
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(
    (SELECT token_margin FROM game_settings WHERE id),
    NULLIF(current_setting('app.token_margin', true), '')::numeric,
    3.0
  );
$fn$;

GRANT EXECUTE ON FUNCTION token_margin() TO anon, authenticated;

CREATE OR REPLACE FUNCTION welcome_bonus_amount()
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(
    (SELECT welcome_bonus FROM game_settings WHERE id),
    NULLIF(current_setting('app.welcome_bonus', true), '')::numeric,
    200
  );
$fn$;

GRANT EXECUTE ON FUNCTION welcome_bonus_amount() TO anon, authenticated;

/*
  Le repli suit le modele choisi dans le panneau. A defaut — reglage vide ou
  modele desactive depuis — on retombe sur le gratuit le plus capable, pour
  qu'une partie ne s'arrete jamais faute de configuration.
*/
CREATE OR REPLACE FUNCTION fallback_model()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object('slug', slug, 'provider_model', provider_model)
  FROM (
    SELECT m.slug, m.provider_model, 0 AS rank
    FROM llm_models m
    WHERE m.enabled
      AND m.slug = COALESCE((SELECT free_model_slug FROM game_settings WHERE id), '')
    UNION ALL
    SELECT m.slug, m.provider_model, 1
    FROM llm_models m
    WHERE m.enabled AND m.is_free
      AND (m.expires_at IS NULL OR m.expires_at > now()::date)
    ORDER BY rank, slug
    LIMIT 1
  ) pick;
$fn$;

REVOKE ALL ON FUNCTION fallback_model() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Recharge de demonstration
-- ---------------------------------------------------------------------------

/*
  Aucun prestataire de paiement n'est encore branche, et sans solde personne ne
  peut jouer. Un bouton credite donc un montant fixe, le temps de brancher le
  vrai module derriere.

  C'est de la monnaie creee a partir de rien: le reglage doit pouvoir etre
  coupe d'un geste avant toute mise en service, et un plafond cumule empeche
  qu'un compte s'en serve indefiniment entre-temps.
*/
ALTER TABLE game_settings
  ADD COLUMN IF NOT EXISTS demo_topup_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS demo_topup_amount  numeric(12,2) NOT NULL DEFAULT 100
    CHECK (demo_topup_amount > 0),
  ADD COLUMN IF NOT EXISTS demo_topup_cap     numeric(12,2) NOT NULL DEFAULT 1000
    CHECK (demo_topup_cap >= 0);

CREATE OR REPLACE FUNCTION demo_topup()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user     uuid := auth.uid();
  v_cfg      record;
  v_already  numeric;
  v_balance  numeric;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT demo_topup_enabled, demo_topup_amount, demo_topup_cap
  INTO v_cfg FROM game_settings WHERE id;

  IF NOT COALESCE(v_cfg.demo_topup_enabled, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'topup_disabled');
  END IF;

  SELECT COALESCE(SUM(amount_usdc), 0) INTO v_already
  FROM wallet_ledger
  WHERE user_id = v_user AND kind = 'deposit' AND note = 'Recharge de demonstration';

  IF v_already + v_cfg.demo_topup_amount > v_cfg.demo_topup_cap THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'cap_reached',
      'already', v_already, 'cap', v_cfg.demo_topup_cap
    );
  END IF;

  INSERT INTO wallet_ledger (user_id, kind, amount_usdc, note)
  VALUES (v_user, 'deposit', v_cfg.demo_topup_amount, 'Recharge de demonstration');

  SELECT balance_usdc INTO v_balance FROM users WHERE id = v_user;

  RETURN jsonb_build_object(
    'ok', true, 'credited', v_cfg.demo_topup_amount, 'balance', v_balance
  );
END;
$fn$;

REVOKE ALL ON FUNCTION demo_topup() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION demo_topup() TO authenticated;
