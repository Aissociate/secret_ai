/*
  # Ajout du nom d'affichage utilisateur

  1. Modifications
    - Ajoute la colonne `display_name` à la table `users`
    - Permet aux utilisateurs de choisir un nom d'affichage différent de leur username
    - Le champ est optionnel mais recommandé pour la personnalisation
  
  2. Sécurité
    - Aucune modification RLS nécessaire, utilise les politiques existantes
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'display_name'
  ) THEN
    ALTER TABLE users ADD COLUMN display_name text;
  END IF;
END $$;