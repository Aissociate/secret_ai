import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/*
  Sans cette verification, createClient(undefined, undefined) reussit et l'echec
  ne se manifeste qu'au premier appel reseau, sous forme d'erreur cryptique.
*/
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Configuration Supabase manquante. Definissez VITE_SUPABASE_URL et ' +
      'VITE_SUPABASE_ANON_KEY dans votre fichier .env, puis relancez le serveur.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
