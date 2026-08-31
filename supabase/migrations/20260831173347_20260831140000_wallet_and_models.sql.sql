/*
  # Solde personnel, catalogue de modèles, facturation des tokens

  ## Ce qui change
  Chaque propriétaire fournissait sa propre clé OpenRouter, stockée en clair et
  facturée chez lui. La plateforme n'avait donc ni contrôle sur le modèle
  employé, ni visibilité sur le coût, ni revenu.

  Désormais : une seule clé plateforme (secret d'environnement, jamais en base),
  un catalogue de modèles au choix du joueur, et la consommation débitée de son
  **solde personnel** à trois fois le prix coûtant.

  ## Deux poches distinctes
  - Le **solde** (`wallet_ledger`) est personnel et rechargeable. Il paie les
    tokens et le droit d'entrée.
  - La **cagnotte de saison** (`prize_pool_usdc`) est alimentée par les droits
    d'entrée et revient au vainqueur. Elle n'est jamais entamée par la
    consommation de tokens.

  ## Solde épuisé
  L'agent ne meurt pas : il bascule sur le modèle gratuit et continue de jouer,
  en dégradé. Une panne de paiement ne doit pas décider d'une partie.
*/

-- ---------------------------------------------------------------------------
-- 1. Grand livre du solde
-- ---------------------------------------------------------------------------

/*
  Le grand livre fait foi ; le solde en cache sur `users` n'est qu'une
  optimisation de lecture, recalculable à tout moment. Sans lui, chaque appel
  LLM devrait sommer l'historique complet.
*/
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN (
               'deposit', 'entry_fee', 'token_usage', 'refund', 'payout', 'adjustment'
             )),
  -- Signé : positif crédite, négatif débite.
  amount_usdc numeric(18,6) NOT NULL,
  season_id  uuid REFERENCES seasons(id) ON DELETE SET NULL,
  agent_id   uuid REFERENCES agents(id) ON DELETE SET NULL,
  note       text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_user ON wallet_ledger (user_id, created_at DESC);

ALTER TABLE wallet_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own ledger" ON wallet_ledger;
CREATE POLICY "Users read own ledger"
  ON wallet_ledger FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

/*
  Aucune policy d'écriture : un solde que le client peut créditer ne vaut rien.
  Tout passe par les fonctions ci-dessous, en service_role.
*/

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS balance_usdc numeric(18,6) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION trg_wallet_apply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  UPDATE users
  SET balance_usdc = balance_usdc + NEW.amount_usdc
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ledger_apply ON wallet_ledger;
CREATE TRIGGER trg_ledger_apply
  AFTER INSERT ON wallet_ledger
  FOR EACH ROW
  EXECUTE FUNCTION trg_wallet_apply();

-- ---------------------------------------------------------------------------
-- 2. Catalogue de modèles
-- ---------------------------------------------------------------------------

/*
  Les prix sont exprimés par million de tokens, comme chez OpenRouter, et
  doivent être resynchronisés quand le fournisseur les change : une valeur
  périmée fait vendre à perte.
*/
CREATE TABLE IF NOT EXISTS llm_models (
  slug              text PRIMARY KEY,
  label             text NOT NULL,
  provider_model    text NOT NULL,
  price_in_per_mtok numeric(12,6) NOT NULL DEFAULT 0 CHECK (price_in_per_mtok >= 0),
  price_out_per_mtok numeric(12,6) NOT NULL DEFAULT 0 CHECK (price_out_per_mtok >= 0),
  tier              text NOT NULL DEFAULT 'standard'
                      CHECK (tier IN ('gratuit', 'economique', 'standard', 'avance')),
  blurb             text NOT NULL DEFAULT '',
  enabled           boolean NOT NULL DEFAULT true,
  sort_order        integer NOT NULL DEFAULT 100,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE llm_models ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read models" ON llm_models;
CREATE POLICY "Anyone can read models"
  ON llm_models FOR SELECT
  TO anon, authenticated
  USING (enabled = true);

/*
  Amorçage. Les tarifs sont ceux constatés à la rédaction et servent de point de
  départ : à vérifier contre la grille OpenRouter avant mise en service.
  Le palier « gratuit » est le filet de sécurité quand un solde s'épuise ; il
  doit rester jouable, pas seulement présent.
*/
INSERT INTO llm_models
  (slug, label, provider_model, price_in_per_mtok, price_out_per_mtok, tier, blurb, sort_order)
VALUES
  ('gratuit', 'Recrue',      'meta-llama/llama-3.1-8b-instruct',  0.00, 0.00, 'gratuit',
   'Gratuit, sans frais. Repli automatique quand le solde est vide.', 10),
  ('rapide',  'Tacticienne', 'openai/gpt-4o-mini',                0.15, 0.60, 'economique',
   'Bon rapport cout / finesse. Convient a la plupart des parties.', 20),
  ('solide',  'Strategiste', 'anthropic/claude-3.5-haiku',        0.80, 4.00, 'standard',
   'Raisonne mieux sur les indices et les alliances.', 30),
  ('elite',   'Maitresse',   'openai/gpt-4o',                     2.50, 10.00, 'avance',
   'Deduction la plus fine. Consomme vite.', 40)
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  provider_model = EXCLUDED.provider_model,
  tier = EXCLUDED.tier,
  blurb = EXCLUDED.blurb,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

/* Le modèle choisi par le propriétaire, remplaçant `openrouter_model`. */
ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS model_slug text NOT NULL DEFAULT 'rapide'
    REFERENCES llm_models(slug) ON UPDATE CASCADE;

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS model_slug text NOT NULL DEFAULT 'rapide'
    REFERENCES llm_models(slug) ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. Consommation
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS token_usage (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id      uuid REFERENCES agents(id) ON DELETE SET NULL,
  season_id     uuid REFERENCES seasons(id) ON DELETE SET NULL,
  model_slug    text NOT NULL,
  prompt_tokens integer NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  -- Prix coutant, puis prix facture (marge x3).
  cost_usdc     numeric(18,6) NOT NULL DEFAULT 0,
  charged_usdc  numeric(18,6) NOT NULL DEFAULT 0,
  downgraded    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_user ON token_usage (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_agent ON token_usage (agent_id, created_at DESC);

ALTER TABLE token_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own usage" ON token_usage;
CREATE POLICY "Users read own usage"
  ON token_usage FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

/* Marge appliquée au prix coutant. */
CREATE OR REPLACE FUNCTION token_margin()
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(
    NULLIF(current_setting('app.token_margin', true), '')::numeric,
    3.0
  );
$fn$;

GRANT EXECUTE ON FUNCTION token_margin() TO anon, authenticated;