/*
  # Ajout de la présentation d'agent et correction des politiques

  1. Modifications
    - Ajoute un champ "presentation" à la table agents (texte généré par IA)
    - Ce champ contient une auto-présentation de ~400 caractères dans le style de l'agent
    - Corrige les conflits de politiques RLS pour les utilisateurs

  2. Sécurité
    - Le champ presentation est visible publiquement (comme les autres données d'agent)
    - Les politiques RLS sont consolidées pour éviter les conflits
*/

-- Ajouter le champ presentation à la table agents
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agents' AND column_name = 'presentation'
  ) THEN
    ALTER TABLE agents ADD COLUMN presentation text DEFAULT '';
  END IF;
END $$;

-- Supprimer les politiques en double pour éviter les conflits
DROP POLICY IF EXISTS "Admins can read all profiles" ON users;
DROP POLICY IF EXISTS "Admins can update all profiles" ON users;

-- Recréer les politiques utilisateur de manière plus permissive
DROP POLICY IF EXISTS "Users can read own profile" ON users;
CREATE POLICY "Users can read profiles"
  ON users FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id OR 
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  );

DROP POLICY IF EXISTS "Users can update own profile" ON users;
CREATE POLICY "Users can update profiles"
  ON users FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = id OR 
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  )
  WITH CHECK (
    auth.uid() = id OR 
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  );
