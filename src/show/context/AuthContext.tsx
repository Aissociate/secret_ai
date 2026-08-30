import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Role } from '../api/types';

interface Profile {
  id: string;
  role: Role;
  username: string;
  wallet_address: string | null;
  display_name: string | null;
}

/*
  Le role est volontairement absent: il est fixe par la base (trigger
  prevent_role_self_escalation) et ne doit jamais etre pilote par le client.
*/
type EditableProfile = Partial<Pick<Profile, 'username' | 'display_name' | 'wallet_address'>>;

interface AuthState {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  viewAsRole: Role | null;
  effectiveRole: Role;
  isAdmin: boolean;
  signUp: (email: string, password: string, username: string, role?: Role) => Promise<string | null>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signInWithMetaMask: () => Promise<string | null>;
  signOut: () => Promise<void>;
  updateProfile: (updates: EditableProfile) => Promise<string | null>;
  updatePassword: (currentPassword: string, newPassword: string) => Promise<string | null>;
  setViewAsRole: (role: Role | null) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewAsRole, setViewAsRole] = useState<Role | null>(null);

  const isAdmin = profile?.role === 'admin';
  const effectiveRole: Role = (isAdmin && viewAsRole) ? viewAsRole : (profile?.role || 'spectator');

  async function loadProfile(userId: string) {
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    setProfile(data as Profile | null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        loadProfile(s.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        (async () => {
          await loadProfile(s.user.id);
        })();
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signUp(
    email: string,
    password: string,
    username: string,
    role: Role = 'spectator'
  ): Promise<string | null> {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return error.message;
    if (!data.user) return 'Inscription echouee';

    /*
      Le role demande a l'inscription n'est qu'une intention: 'owner' ou
      'spectator' sont acceptes, tout le reste est ramene a 'spectator' par le
      trigger cote base. Rien ici ne peut creer un admin.
    */
    const requestedRole: Role = role === 'owner' ? 'owner' : 'spectator';

    const { error: profileError } = await supabase
      .from('users')
      .insert({ id: data.user.id, username, role: requestedRole });
    if (profileError) return profileError.message;

    await loadProfile(data.user.id);
    return null;
  }

  async function signIn(email: string, password: string): Promise<string | null> {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return error.message;
    return null;
  }

  async function signOut() {
    await supabase.auth.signOut();
    setProfile(null);
  }

  /*
    Connexion par portefeuille (SIWE simplifie).

    L'implementation precedente derivait le mot de passe de l'adresse publique
    (`metamask_${addr.slice(0,10)}_temp`) : l'adresse etant visible on-chain et
    affichee dans l'interface, n'importe qui pouvait recalculer le mot de passe
    et prendre le controle du compte. Aucune signature n'etait demandee, donc
    rien ne prouvait la possession de la cle privee.

    Le flux correct exige une signature verifiee cote serveur. Il requiert la
    fonction Edge `wallet-auth` (nonce + verification + emission de session).
  */
  async function signInWithMetaMask(): Promise<string | null> {
    try {
      if (!window.ethereum) {
        return "MetaMask n'est pas installé. Veuillez installer MetaMask pour continuer.";
      }

      // ethers n'est charge que si l'utilisateur emprunte reellement ce chemin.
      const { BrowserProvider } = await import('ethers');
      const provider = new BrowserProvider(window.ethereum);
      const accounts: string[] = await provider.send('eth_requestAccounts', []);
      const walletAddress = accounts[0]?.toLowerCase();

      if (!walletAddress) return 'Aucune adresse MetaMask trouvée';

      const functionsUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      // 1. Le serveur emet un nonce a usage unique.
      const nonceRes = await fetch(`${functionsUrl}/functions/v1/wallet-auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Apikey: anonKey },
        body: JSON.stringify({ step: 'nonce', wallet_address: walletAddress }),
      });

      if (!nonceRes.ok) {
        return "La connexion par portefeuille n'est pas disponible (fonction wallet-auth absente).";
      }

      const { message } = (await nonceRes.json()) as { message?: string };
      if (!message) return 'Reponse invalide du serveur';

      // 2. L'utilisateur signe: c'est la preuve de possession de la cle privee.
      const signer = await provider.getSigner();
      const signature = await signer.signMessage(message);

      // 3. Le serveur verifie la signature et renvoie une session.
      const verifyRes = await fetch(`${functionsUrl}/functions/v1/wallet-auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Apikey: anonKey },
        body: JSON.stringify({
          step: 'verify',
          wallet_address: walletAddress,
          signature,
        }),
      });

      const payload = (await verifyRes.json()) as {
        error?: string;
        access_token?: string;
        refresh_token?: string;
      };

      if (!verifyRes.ok || !payload.access_token || !payload.refresh_token) {
        return payload.error ?? 'Signature refusée';
      }

      const { error } = await supabase.auth.setSession({
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
      });
      if (error) return error.message;

      return null;
    } catch (error: unknown) {
      if (error instanceof Error) return 'Erreur MetaMask: ' + error.message;
      return 'Erreur MetaMask inconnue';
    }
  }

  async function updateProfile(updates: EditableProfile): Promise<string | null> {
    if (!user) return 'Utilisateur non connecté';

    // Liste blanche explicite: meme si l'appelant passe autre chose, seules ces
    // colonnes partent vers la base.
    const safe: EditableProfile = {
      username: updates.username,
      display_name: updates.display_name,
      wallet_address: updates.wallet_address,
    };
    Object.keys(safe).forEach((k) => {
      if (safe[k as keyof EditableProfile] === undefined) {
        delete safe[k as keyof EditableProfile];
      }
    });

    const { error } = await supabase
      .from('users')
      .update(safe)
      .eq('id', user.id);

    if (error) return error.message;

    await loadProfile(user.id);
    return null;
  }

  async function updatePassword(currentPassword: string, newPassword: string): Promise<string | null> {
    if (!user?.email) return 'Utilisateur non connecté';

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });

    if (signInError) return 'Mot de passe actuel incorrect';

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (updateError) return updateError.message;

    return null;
  }

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, viewAsRole, effectiveRole, isAdmin, signUp, signIn, signInWithMetaMask, signOut, updateProfile, updatePassword, setViewAsRole }}>
      {children}
    </AuthContext.Provider>
  );
}
