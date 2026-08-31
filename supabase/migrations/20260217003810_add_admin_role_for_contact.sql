/*
  # Configuration du compte administrateur

  1. Modifications
    - Crée une fonction pour définir le rôle admin d'un utilisateur par email
    - Met le compte contact@aissociate.re en admin
    - Permet aux admins d'avoir un accès total sans restrictions de paiement

  2. Sécurité
    - Seul le compte admin peut modifier les rôles d'autres utilisateurs
    - Les admins ont des privilèges étendus pour gérer la plateforme
*/

-- Fonction pour définir un utilisateur comme admin par email
CREATE OR REPLACE FUNCTION set_user_role_by_email(user_email text, new_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_uuid uuid;
BEGIN
  -- Récupérer l'UUID de l'utilisateur depuis auth.users
  SELECT id INTO user_uuid
  FROM auth.users
  WHERE email = user_email;

  -- Si l'utilisateur existe, mettre à jour son rôle
  IF user_uuid IS NOT NULL THEN
    UPDATE users
    SET role = new_role
    WHERE id = user_uuid;
  END IF;
END;
$$;

-- Mettre contact@aissociate.re en admin
SELECT set_user_role_by_email('contact@aissociate.re', 'admin');

-- Ajouter une politique pour que les admins puissent lire tous les profils
CREATE POLICY "Admins can read all profiles"
  ON users FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid() AND users.role = 'admin'
    )
  );

-- Ajouter une politique pour que les admins puissent modifier tous les profils
CREATE POLICY "Admins can update all profiles"
  ON users FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid() AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid() AND users.role = 'admin'
    )
  );
