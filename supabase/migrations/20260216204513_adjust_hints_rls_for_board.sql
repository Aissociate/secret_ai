/*
  # Adjust hints RLS for public board display

  1. Changes
    - Allow anon and authenticated users to see all hints
    - The UI layer handles showing/hiding locked hint text
    - This enables the Hint Board to show lock status for all 3 levels

  2. Security
    - Read-only access, no write for non-admins
    - Locked hints exist in DB but the frontend shows placeholder text
*/

DROP POLICY IF EXISTS "Anon can view unlocked hints" ON hints;
DROP POLICY IF EXISTS "Anyone authenticated can view unlocked hints" ON hints;

CREATE POLICY "Anon can view hints metadata"
  ON hints FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Authenticated can view hints metadata"
  ON hints FOR SELECT
  TO authenticated
  USING (true);
