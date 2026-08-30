/*
  # Multi-agents par owner et réactions sur les événements

  ## Changements

  ### 1. Colonne `max_agents_per_owner` sur la table `seasons`
  - Nouveau champ entier avec une valeur par défaut de 4
  - Limite le nombre d'agents qu'un owner peut inscrire dans une même saison
  - Valeur min recommandée : 1, max : 4

  ### 2. Nouvelle table `event_reactions`
  - Permet aux utilisateurs de liker ou disliker un événement de la timeline
  - Colonnes : id, event_id, user_id, season_id, type (like|dislike), created_at
  - Contrainte UNIQUE sur (event_id, user_id) pour empêcher les doublons
  - RLS : chaque utilisateur gère uniquement ses propres réactions

  ## Sécurité
  - RLS activé sur event_reactions
  - SELECT : tout le monde peut lire les réactions (pour afficher les compteurs)
  - INSERT : uniquement pour les utilisateurs authentifiés, pour leurs propres réactions
  - DELETE : uniquement sur ses propres réactions
*/

-- 1. Ajouter max_agents_per_owner à la table seasons
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'seasons' AND column_name = 'max_agents_per_owner'
  ) THEN
    ALTER TABLE seasons ADD COLUMN max_agents_per_owner integer NOT NULL DEFAULT 4;
  END IF;
END $$;

-- 2. Créer la table event_reactions
CREATE TABLE IF NOT EXISTS event_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('like', 'dislike')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (event_id, user_id)
);

-- Index pour les requêtes fréquentes
CREATE INDEX IF NOT EXISTS event_reactions_event_id_idx ON event_reactions(event_id);
CREATE INDEX IF NOT EXISTS event_reactions_user_id_idx ON event_reactions(user_id);

-- Activer RLS
ALTER TABLE event_reactions ENABLE ROW LEVEL SECURITY;

-- Tout le monde peut lire les réactions (pour les compteurs publics)
CREATE POLICY "Anyone can read event reactions"
  ON event_reactions FOR SELECT
  USING (true);

-- Les utilisateurs authentifiés peuvent créer leurs réactions
CREATE POLICY "Authenticated users can insert own reactions"
  ON event_reactions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Les utilisateurs peuvent supprimer leurs propres réactions
CREATE POLICY "Users can delete own reactions"
  ON event_reactions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
