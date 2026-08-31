/*
  # Add anonymous read policies for public show data

  1. Changes
    - Allow anonymous users to read seasons, agents, public events, and unlocked hints
    - This enables the show viewer to work without requiring authentication
    - Write operations remain restricted to authenticated users

  2. Security
    - Read-only for anonymous users
    - Only public visibility events are accessible
    - Only unlocked hints are visible to anonymous users
*/

CREATE POLICY "Anon can view seasons"
  ON seasons FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anon can view agents"
  ON agents FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anon can view public events"
  ON events FOR SELECT
  TO anon
  USING (visibility = 'public');

CREATE POLICY "Anon can view unlocked hints"
  ON hints FOR SELECT
  TO anon
  USING (unlocked = true);
