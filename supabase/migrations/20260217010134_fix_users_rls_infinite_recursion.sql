/*
  # Fix Users Table RLS Infinite Recursion

  1. Problem
    - The current RLS policies on the users table create infinite recursion
    - Policies check if user is admin by querying the same users table
    - This causes "infinite recursion detected in policy" error

  2. Solution
    - Simplify RLS policies to avoid self-referential queries
    - Allow authenticated users to read all profiles (needed for app functionality)
    - Restrict updates to own profile only
    - Admins can bypass RLS using service role key when needed

  3. Changes
    - Drop existing problematic policies
    - Create new simplified policies without recursion
*/

-- Drop existing policies that cause recursion
DROP POLICY IF EXISTS "Users can read profiles" ON users;
DROP POLICY IF EXISTS "Users can update profiles" ON users;
DROP POLICY IF EXISTS "Users can insert own profile" ON users;

-- Allow authenticated users to read all profiles
CREATE POLICY "Authenticated users can read all profiles"
  ON users FOR SELECT
  TO authenticated
  USING (true);

-- Allow users to insert their own profile during signup
CREATE POLICY "Users can insert own profile on signup"
  ON users FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- Allow users to update only their own profile
CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
