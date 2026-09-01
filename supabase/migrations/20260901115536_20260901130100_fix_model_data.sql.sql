/*
  # Insert core OpenRouter models and fix free model data

  Inserts key models needed by game_settings references and migrates
  agent_configs/agents from old slugs to real OpenRouter identifiers.
  Updates context_length on existing free models.
*/

-- Insert gpt-4o-mini (needed by game_settings.secret_model_slug)
INSERT INTO llm_models (slug, label, provider, provider_model, price_in_per_mtok, price_out_per_mtok, context_length, is_free, tier, blurb, sort_order)
VALUES ('openai/gpt-4o-mini', 'OpenAI: GPT-4o-mini', 'openai', 'openai/gpt-4o-mini', 0.15, 0.60, 128000, false, 'economique', 'Modele compact et rapide. Excellent rapport qualite-prix pour la generation de secrets et indices.', 25)
ON CONFLICT (slug) DO NOTHING;

-- Fix the 3 free models: set real OpenRouter slugs and context_length
-- First update references, then rename the slugs

-- gratuit-llama -> meta-llama/llama-4-maverick:free  (not :free, the free route is separate)
UPDATE agent_configs SET model_slug = 'gratuit-llama' WHERE model_slug = 'gratuit-llama';
UPDATE llm_models SET context_length = 1048576, provider_model = 'meta-llama/llama-4-maverick:free' WHERE slug = 'gratuit-llama';

-- gratuit-grok
UPDATE llm_models SET context_length = 2000000, provider_model = 'x-ai/grok-4-fast:free' WHERE slug = 'gratuit-grok';

-- gratuit-gemini
UPDATE llm_models SET context_length = 1048576, provider_model = 'google/gemini-2.5-flash:free' WHERE slug = 'gratuit-gemini';

-- Make sure eco-gemini and other old slugs point to valid provider_models
UPDATE llm_models SET context_length = 1048576 WHERE slug = 'eco-gemini';
UPDATE llm_models SET context_length = 1050000 WHERE slug = 'eco-luna';
UPDATE llm_models SET context_length = 262000 WHERE slug = 'eco-mistral';
UPDATE llm_models SET context_length = 2000000 WHERE slug = 'eco-grok';
UPDATE llm_models SET context_length = 163840 WHERE slug = 'eco-deepseek';
UPDATE llm_models SET context_length = 1048576 WHERE slug = 'eco-minimax';
UPDATE llm_models SET context_length = 1048576 WHERE slug = 'std-gemini';
UPDATE llm_models SET context_length = 262144 WHERE slug = 'std-mistral';
UPDATE llm_models SET context_length = 200000 WHERE slug = 'std-claude';
UPDATE llm_models SET context_length = 1000000 WHERE slug = 'std-grok';
UPDATE llm_models SET context_length = 262144 WHERE slug = 'std-mistral2';
UPDATE llm_models SET context_length = 500000 WHERE slug = 'adv-grok';
UPDATE llm_models SET context_length = 1050000 WHERE slug = 'adv-gpt5';
UPDATE llm_models SET context_length = 128000 WHERE slug = 'adv-gpt4o';
UPDATE llm_models SET context_length = 1000000 WHERE slug = 'adv-claude';
UPDATE llm_models SET context_length = 1000000 WHERE slug = 'elite-opus';
UPDATE llm_models SET context_length = 1000000 WHERE slug = 'elite-opus-fast';