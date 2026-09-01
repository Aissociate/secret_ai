/*
  # Catalogue reel OpenRouter — septembre 2026

  Ajoute le palier 'elite' a la contrainte avant d'inserer le modele Opus 5.
  Met a jour les 4 modeles existants avec les vrais identifiants OpenRouter
  et ajoute 5 nouveaux modeles (9 au total).
*/

-- D'abord: elargir la contrainte pour autoriser le palier 'elite'
ALTER TABLE llm_models DROP CONSTRAINT IF EXISTS llm_models_tier_check;
ALTER TABLE llm_models ADD CONSTRAINT llm_models_tier_check
  CHECK (tier IN ('gratuit', 'economique', 'standard', 'avance', 'elite'));

-- Mettre a jour les modeles existants
UPDATE llm_models SET
  label = 'Recrue',
  provider_model = 'meta-llama/llama-4-maverick:free',
  price_in_per_mtok = 0,
  price_out_per_mtok = 0,
  tier = 'gratuit',
  blurb = 'Gratuit, zero frais. Repli automatique quand le solde est vide. Llama 4 Maverick via la route gratuite OpenRouter.',
  sort_order = 10,
  updated_at = now()
WHERE slug = 'gratuit';

UPDATE llm_models SET
  label = 'Eclaireuse',
  provider_model = 'google/gemini-2.5-flash',
  price_in_per_mtok = 0.15,
  price_out_per_mtok = 0.60,
  tier = 'economique',
  blurb = 'Google Gemini 2.5 Flash. Rapide et pas cher, ideal pour la plupart des parties.',
  sort_order = 30,
  updated_at = now()
WHERE slug = 'rapide';

UPDATE llm_models SET
  label = 'Analyste',
  provider_model = 'anthropic/claude-haiku-4.5',
  price_in_per_mtok = 1.00,
  price_out_per_mtok = 5.00,
  tier = 'standard',
  blurb = 'Claude Haiku 4.5. Raisonne bien sur les indices et les alliances, cout modere.',
  sort_order = 60,
  updated_at = now()
WHERE slug = 'solide';

UPDATE llm_models SET
  label = 'Stratege',
  provider_model = 'anthropic/claude-sonnet-4',
  price_in_per_mtok = 3.00,
  price_out_per_mtok = 15.00,
  tier = 'avance',
  blurb = 'Claude Sonnet 4. Deduction fine, excellente en manipulation et alliances complexes.',
  sort_order = 80,
  updated_at = now()
WHERE slug = 'elite';

-- Ajouter les 5 nouveaux modeles
INSERT INTO llm_models (slug, label, provider_model, price_in_per_mtok, price_out_per_mtok, tier, blurb, sort_order)
VALUES
  ('nano', 'Apprentie', 'openai/gpt-5.6-luna',
   0.075, 0.30, 'economique',
   'GPT-5.6 Luna. Ultra economique, bon pour les longues saisons a petit budget.', 20),
  ('malin', 'Espionne', 'deepseek/deepseek-chat-v3',
   0.27, 1.10, 'economique',
   'DeepSeek V3. Excellent rapport qualite-prix, forte en raisonnement logique.', 40),
  ('flash', 'Tacticienne', 'google/gemini-3.7-flash',
   0.375, 1.875, 'standard',
   'Gemini 3.7 Flash. Rapide et puissante, taillee pour les enchainements tactiques.', 50),
  ('pro', 'Maitresse', 'openai/gpt-4o',
   2.50, 10.00, 'avance',
   'GPT-4o. Polyvalente et redoutable, deduction solide sur tous les fronts.', 70),
  ('opus', 'Prodige', 'anthropic/claude-opus-5',
   5.00, 25.00, 'elite',
   'Claude Opus 5. Le sommet de la deduction. Raisonnement de pointe, consomme rapidement.', 90)
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  provider_model = EXCLUDED.provider_model,
  price_in_per_mtok = EXCLUDED.price_in_per_mtok,
  price_out_per_mtok = EXCLUDED.price_out_per_mtok,
  tier = EXCLUDED.tier,
  blurb = EXCLUDED.blurb,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();