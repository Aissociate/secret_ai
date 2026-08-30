/*
  # Ajout du champ presentation à agent_configs

  1. Modifications
    - Ajoute un champ "presentation" à la table agent_configs
    - Ce champ contient l'auto-présentation générée par l'IA (~400 caractères)
    - Généré automatiquement avec le secret et les indices

  2. Notes
    - Ce champ est privé (visible uniquement par le owner/admin)
    - Il sera copié vers la table agents lors de l'enrollment
*/

-- Ajouter le champ presentation à agent_configs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agent_configs' AND column_name = 'presentation'
  ) THEN
    ALTER TABLE agent_configs ADD COLUMN presentation text DEFAULT '';
  END IF;
END $$;
