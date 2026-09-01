import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigError =
  !supabaseUrl || !supabaseAnonKey
    ? new Error(
        'Configuration Supabase manquante. Definissez VITE_SUPABASE_URL et ' +
          'VITE_SUPABASE_ANON_KEY dans votre fichier .env, puis relancez le serveur.'
      )
    : null;

/*
  Un client de remplacement evite que le module entier echoue a l'import:
  l'erreur est rapportee par les composants (via supabaseConfigError), pas par
  un throw au niveau du module qui tuerait le rendu avant meme que React ne
  monte.
*/
const fallbackClient: SupabaseClient = {
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    signInWithPassword: async () => ({ data: { user: null, session: null }, error: { message: 'Configuration manquante' } as any }),
    signUp: async () => ({ data: { user: null, session: null }, error: { message: 'Configuration manquante' } as any }),
    signOut: async () => ({ error: null }),
    setUser: async () => ({ data: { user: null }, error: null as any }),
    updateUser: async () => ({ data: { user: null }, error: null as any }),
    setSession: async () => ({ data: { user: null, session: null }, error: { message: 'Configuration manquante' } as any }),
  },
  from: () => ({
    select: () => ({ order: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }), single: async () => ({ data: null, error: null }) }), limit: async () => ({ data: null, error: null }) }) }),
    insert: async () => ({ error: { message: 'Configuration manquante' } as any }),
    update: async () => ({ error: { message: 'Configuration manquante' } as any }),
    delete: async () => ({ error: { message: 'Configuration manquante' } as any }),
    upsert: async () => ({ error: { message: 'Configuration manquante' } as any }),
  }),
  channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
  removeChannel: () => {},
} as unknown as SupabaseClient;

export const supabase: SupabaseClient = supabaseConfigError
  ? fallbackClient
  : createClient(supabaseUrl!, supabaseAnonKey!);
