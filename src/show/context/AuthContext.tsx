import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Role } from '../api/types';
import { BrowserProvider } from 'ethers';

interface Profile {
  id: string;
  role: Role;
  username: string;
  wallet_address: string | null;
  display_name: string | null;
}

interface AuthState {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  viewAsRole: Role | null;
  effectiveRole: Role;
  isAdmin: boolean;
  signUp: (email: string, password: string, username: string, role: Role) => Promise<string | null>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signInWithMetaMask: () => Promise<string | null>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<Profile>) => Promise<string | null>;
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

  async function signUp(email: string, password: string, username: string, role: Role): Promise<string | null> {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return error.message;
    if (!data.user) return 'Inscription echouee';

    const { error: profileError } = await supabase
      .from('users')
      .insert({ id: data.user.id, username, role });
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

  async function signInWithMetaMask(): Promise<string | null> {
    try {
      if (!window.ethereum) {
        return 'MetaMask n\'est pas installé. Veuillez installer MetaMask pour continuer.';
      }

      const provider = new BrowserProvider(window.ethereum);
      const accounts = await provider.send('eth_requestAccounts', []);
      const walletAddress = accounts[0];

      if (!walletAddress) {
        return 'Aucune adresse MetaMask trouvée';
      }

      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('wallet_address', walletAddress.toLowerCase())
        .maybeSingle();

      if (existingUser) {
        const tempPassword = `metamask_${walletAddress.slice(0, 10)}_temp`;
        const { error } = await supabase.auth.signInWithPassword({
          email: `${walletAddress.toLowerCase()}@metamask.local`,
          password: tempPassword,
        });

        if (error) {
          return 'Erreur de connexion MetaMask: ' + error.message;
        }

        return null;
      } else {
        const tempPassword = `metamask_${walletAddress.slice(0, 10)}_temp`;
        const username = `user_${walletAddress.slice(2, 8)}`;

        const { data: authData, error: signUpError } = await supabase.auth.signUp({
          email: `${walletAddress.toLowerCase()}@metamask.local`,
          password: tempPassword,
        });

        if (signUpError) return signUpError.message;
        if (!authData.user) return 'Inscription échouée';

        const { error: profileError } = await supabase
          .from('users')
          .insert({
            id: authData.user.id,
            username,
            role: 'spectator',
            wallet_address: walletAddress.toLowerCase(),
          });

        if (profileError) return profileError.message;

        await loadProfile(authData.user.id);
        return null;
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        return 'Erreur MetaMask: ' + error.message;
      }
      return 'Erreur MetaMask inconnue';
    }
  }

  async function updateProfile(updates: Partial<Profile>): Promise<string | null> {
    if (!user) return 'Utilisateur non connecté';

    const { error } = await supabase
      .from('users')
      .update(updates)
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
