# Configuration du Stockage Supabase

Ce projet utilise Supabase Storage pour stocker les avatars des agents IA.

## Configuration requise

Pour activer l'upload d'images d'avatars, vous devez créer un bucket de stockage dans Supabase.

### Étapes de configuration

1. **Accéder à Supabase Dashboard**
   - Connectez-vous à votre projet Supabase
   - Naviguez vers la section "Storage" dans le menu latéral

2. **Créer le bucket "avatars"**
   - Cliquez sur "New bucket"
   - Nom du bucket: `avatars`
   - Cochez "Public bucket" (pour permettre l'accès public aux images)
   - Cliquez sur "Create bucket"

3. **Configurer les politiques de sécurité (RLS)**

   Les politiques suivantes doivent être créées pour le bucket `avatars`:

   **Politique INSERT (Upload)**
   ```sql
   -- Permet aux utilisateurs authentifiés d'uploader des images
   CREATE POLICY "Authenticated users can upload avatars"
   ON storage.objects FOR INSERT
   TO authenticated
   WITH CHECK (bucket_id = 'avatars');
   ```

   **Politique SELECT (Lecture)**
   ```sql
   -- Permet à tous de lire les avatars (bucket public)
   CREATE POLICY "Public avatars are viewable by everyone"
   ON storage.objects FOR SELECT
   TO public
   USING (bucket_id = 'avatars');
   ```

   **Politique DELETE (Suppression)**
   ```sql
   -- Permet aux utilisateurs authentifiés de supprimer leurs propres avatars
   CREATE POLICY "Users can delete their own avatars"
   ON storage.objects FOR DELETE
   TO authenticated
   USING (bucket_id = 'avatars');
   ```

4. **Configuration alternative via SQL**

   Si vous préférez configurer via SQL, vous pouvez exécuter ces commandes dans l'éditeur SQL de Supabase:

   ```sql
   -- Créer le bucket
   INSERT INTO storage.buckets (id, name, public)
   VALUES ('avatars', 'avatars', true);

   -- Ajouter les politiques
   CREATE POLICY "Authenticated users can upload avatars"
   ON storage.objects FOR INSERT
   TO authenticated
   WITH CHECK (bucket_id = 'avatars');

   CREATE POLICY "Public avatars are viewable by everyone"
   ON storage.objects FOR SELECT
   TO public
   USING (bucket_id = 'avatars');

   CREATE POLICY "Users can delete their own avatars"
   ON storage.objects FOR DELETE
   TO authenticated
   USING (bucket_id = 'avatars');
   ```

## Utilisation

Une fois le bucket configuré, les utilisateurs pourront uploader des images d'avatars directement depuis la page de configuration des agents IA (`/settings/agents/:configId`).

Le composant `ImageUpload` gérera automatiquement:
- La validation du type de fichier (images uniquement)
- La limitation de taille (5MB par défaut)
- L'upload vers Supabase Storage
- La génération d'URL publique
- La mise à jour de l'avatar dans la base de données

## Formats supportés

- JPG/JPEG
- PNG
- GIF
- WEBP

## Limites

- Taille maximale: 5MB par image
- Le bucket est configuré en mode public pour permettre l'affichage des avatars sans authentification
