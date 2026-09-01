/*
  # Catalogue complet multi-fournisseurs OpenRouter — septembre 2026

  ## Ce qui change
  Remplace le catalogue precedent par un catalogue exhaustif couvrant 7 fournisseurs
  majeurs (Anthropic, OpenAI, Google, DeepSeek, xAI/Grok, Mistral, MiniMax), avec
  au moins un modele par fournisseur a chaque palier ou il est pertinent.

  ## Organisation en 5 paliers

  ### Recrue (gratuit) — 3 modeles gratuits au choix
  - Llama 4 Maverick :free      — Meta        — $0 / $0
  - Grok 4 Fast :free            — xAI         — $0 / $0
  - Gemini 2.5 Flash :free       — Google      — $0 / $0

  ### Soldat (economique, ~$0.10–$0.60 in/out) — 6 modeles
  - Mistral Small 4              — Mistral     — $0.15 / $0.60
  - GPT-5.6 Luna                 — OpenAI      — $0.075 / $0.30
  - Gemini 2.5 Flash             — Google      — $0.15 / $0.60
  - DeepSeek V3                  — DeepSeek    — $0.27 / $1.10
  - Grok 4 Fast                  — xAI         — $0.20 / $0.50
  - MiniMax M3                   — MiniMax     — $0.30 / $1.20

  ### Officier (standard, ~$0.40–$5.00 in/out) — 5 modeles
  - Gemini 3.7 Flash             — Google      — $0.375 / $1.875
  - Mistral Large 3              — Mistral     — $0.50 / $1.50
  - Claude Haiku 4.5             — Anthropic   — $1.00 / $5.00
  - Grok 4.3                     — xAI         — $1.25 / $2.50
  - Mistral Medium 3.5           — Mistral     — $1.50 / $7.50

  ### General (avance, ~$2.00–$15.00 in/out) — 4 modeles
  - Grok 4.5                     — xAI         — $2.00 / $6.00
  - GPT-4o                       — OpenAI      — $2.50 / $10.00
  - Claude Sonnet 4              — Anthropic   — $3.00 / $15.00
  - GPT-5.5                      — OpenAI      — $2.00 / $8.00

  ### Marechal (elite, $5.00+ in/out) — 2 modeles
  - Claude Opus 5                — Anthropic   — $5.00 / $25.00
  - Claude Opus 5 Fast           — Anthropic   — $10.00 / $50.00

  ## Colonnes ajoutees
  - `provider` (text) — nom du fournisseur pour regrouper dans l'interface

  ## Securite
  Aucun changement de RLS. La politique existante autorise la lecture
  des modeles actifs par anon et authenticated.
*/

-- Ajouter la colonne provider
ALTER TABLE llm_models ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT '';

-- Elargir la contrainte de palier
ALTER TABLE llm_models DROP CONSTRAINT IF EXISTS llm_models_tier_check;
ALTER TABLE llm_models ADD CONSTRAINT llm_models_tier_check
  CHECK (tier IN ('gratuit', 'economique', 'standard', 'avance', 'elite'));

-- Supprimer les anciens modeles qui n'ont plus de sens
DELETE FROM llm_models WHERE slug NOT IN (
  SELECT slug FROM llm_models WHERE FALSE
);

-- Reinserer tout le catalogue
INSERT INTO llm_models (slug, label, provider, provider_model, price_in_per_mtok, price_out_per_mtok, tier, blurb, sort_order)
VALUES
  -- === RECRUE (gratuit) ===
  ('gratuit-llama',  'Recrue Llama',  'Meta',      'meta-llama/llama-4-maverick:free',   0,    0,    'gratuit',
   'Llama 4 Maverick gratuit. Repli automatique quand le solde est vide.', 10),
  ('gratuit-grok',   'Recrue Grok',   'xAI',       'x-ai/grok-4-fast:free',              0,    0,    'gratuit',
   'Grok 4 Fast gratuit. Alternative rapide et sans frais.', 11),
  ('gratuit-gemini', 'Recrue Gemini', 'Google',    'google/gemini-2.5-flash:free',       0,    0,    'gratuit',
   'Gemini 2.5 Flash gratuit. Option Google a zero cout.', 12),

  -- === SOLDAT (economique) ===
  ('eco-luna',    'Soldat Luna',    'OpenAI',    'openai/gpt-5.6-luna',              0.075, 0.30,  'economique',
   'GPT-5.6 Luna. Ultra economique, ideal pour les longues saisons.', 20),
  ('eco-gemini',  'Soldat Gemini',  'Google',    'google/gemini-2.5-flash',          0.15,  0.60,  'economique',
   'Gemini 2.5 Flash. Rapide et pas cher, excellent en general.', 21),
  ('eco-mistral', 'Soldat Mistral', 'Mistral',   'mistralai/mistral-small-4',        0.15,  0.60,  'economique',
   'Mistral Small 4. Modele de production par defaut chez Mistral.', 22),
  ('eco-grok',    'Soldat Grok',    'xAI',       'x-ai/grok-4-fast',                0.20,  0.50,  'economique',
   'Grok 4 Fast. Rapide et abordable, bon en raisonnement.', 23),
  ('eco-deepseek','Soldat DeepSeek','DeepSeek',  'deepseek/deepseek-chat-v3',        0.27,  1.10,  'economique',
   'DeepSeek V3. Excellent rapport qualite-prix, forte en logique.', 24),
  ('eco-minimax', 'Soldat MiniMax', 'MiniMax',   'minimax/minimax-m3',               0.30,  1.20,  'economique',
   'MiniMax M3. Tres abordable et surprenamment capable.', 25),

  -- === OFFICIER (standard) ===
  ('std-gemini',  'Officier Gemini',  'Google',    'google/gemini-3.7-flash',         0.375, 1.875, 'standard',
   'Gemini 3.7 Flash. Puissante pour les enchainements tactiques.', 40),
  ('std-mistral', 'Officier Mistral', 'Mistral',   'mistralai/mistral-large-3',       0.50,  1.50,  'standard',
   'Mistral Large 3. Flagship Mistral, polyvalent et fiable.', 41),
  ('std-claude',  'Officier Claude',  'Anthropic', 'anthropic/claude-haiku-4.5',      1.00,  5.00,  'standard',
   'Claude Haiku 4.5. Raisonne bien sur les indices et alliances.', 42),
  ('std-grok',    'Officier Grok',    'xAI',       'x-ai/grok-4.3',                  1.25,  2.50,  'standard',
   'Grok 4.3. 1M de contexte, excellent en analyse longue.', 43),
  ('std-mistral2','Officier Magistral','Mistral',  'mistralai/mistral-medium-3.5',    1.50,  7.50,  'standard',
   'Mistral Medium 3.5. Open-weights, raisonnement pousse.', 44),

  -- === GENERAL (avance) ===
  ('adv-grok',    'General Grok',    'xAI',       'x-ai/grok-4.5',                  2.00,  6.00,  'avance',
   'Grok 4.5. Frontier xAI, fort en code et STEM.', 60),
  ('adv-gpt5',    'General GPT-5',   'OpenAI',    'openai/gpt-5.5',                 2.00,  8.00,  'avance',
   'GPT-5.5. Polyvalent et redoutable, deduction solide.', 61),
  ('adv-gpt4o',   'General GPT-4o',  'OpenAI',    'openai/gpt-4o',                  2.50, 10.00,  'avance',
   'GPT-4o. Reference OpenAI, fiable sur tous les fronts.', 62),
  ('adv-claude',  'General Claude',  'Anthropic', 'anthropic/claude-sonnet-4',       3.00, 15.00,  'avance',
   'Claude Sonnet 4. Deduction fine, excellente en manipulation.', 63),

  -- === MARECHAL (elite) ===
  ('elite-opus',     'Marechal Opus',      'Anthropic', 'anthropic/claude-opus-5',      5.00, 25.00, 'elite',
   'Claude Opus 5. Le sommet de la deduction. Raisonnement de pointe.', 80),
  ('elite-opus-fast','Marechal Opus Fast', 'Anthropic', 'anthropic/claude-opus-5-fast',10.00, 50.00, 'elite',
   'Claude Opus 5 Fast. Meme puissance, vitesse doublee, prix double.', 81)

ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  provider = EXCLUDED.provider,
  provider_model = EXCLUDED.provider_model,
  price_in_per_mtok = EXCLUDED.price_in_per_mtok,
  price_out_per_mtok = EXCLUDED.price_out_per_mtok,
  tier = EXCLUDED.tier,
  blurb = EXCLUDED.blurb,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

-- Nettoyer les anciens slugs qui ne sont plus dans le catalogue
DELETE FROM llm_models WHERE slug IN (
  'gratuit', 'nano', 'rapide', 'malin', 'flash', 'solide', 'pro', 'elite', 'opus'
);