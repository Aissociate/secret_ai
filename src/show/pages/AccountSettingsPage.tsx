import { useState } from 'react';
import { User, Wallet, Lock, Save } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { BrowserProvider } from 'ethers';

export function AccountSettingsPage() {
  const { profile, updateProfile, updatePassword } = useAuth();

  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [walletAddress, setWalletAddress] = useState(profile?.wallet_address || '');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  const [profileBusy, setProfileBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [connectingWallet, setConnectingWallet] = useState(false);

  async function handleProfileSubmit(e: React.FormEvent) {
    e.preventDefault();
    setProfileError(null);
    setProfileSuccess(null);
    setProfileBusy(true);

    const err = await updateProfile({
      display_name: displayName || null,
    });

    setProfileBusy(false);
    if (err) {
      setProfileError(err);
    } else {
      setProfileSuccess('Profil mis à jour avec succès');
      setTimeout(() => setProfileSuccess(null), 3000);
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (newPassword !== confirmPassword) {
      setPasswordError('Les mots de passe ne correspondent pas');
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError('Le mot de passe doit contenir au moins 6 caractères');
      return;
    }

    setPasswordBusy(true);
    const err = await updatePassword(currentPassword, newPassword);
    setPasswordBusy(false);

    if (err) {
      setPasswordError(err);
    } else {
      setPasswordSuccess('Mot de passe mis à jour avec succès');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPasswordSuccess(null), 3000);
    }
  }

  async function handleConnectWallet() {
    setProfileError(null);
    setProfileSuccess(null);
    setConnectingWallet(true);

    try {
      if (!window.ethereum) {
        setProfileError('MetaMask n\'est pas installé');
        setConnectingWallet(false);
        return;
      }

      const provider = new BrowserProvider(window.ethereum);
      const accounts = await provider.send('eth_requestAccounts', []);
      const address = accounts[0];

      if (!address) {
        setProfileError('Aucune adresse trouvée');
        setConnectingWallet(false);
        return;
      }

      const err = await updateProfile({
        wallet_address: address.toLowerCase(),
      });

      setConnectingWallet(false);

      if (err) {
        setProfileError(err);
      } else {
        setWalletAddress(address.toLowerCase());
        setProfileSuccess('Wallet connecté avec succès');
        setTimeout(() => setProfileSuccess(null), 3000);
      }
    } catch (error: unknown) {
      setConnectingWallet(false);
      if (error instanceof Error) {
        setProfileError('Erreur: ' + error.message);
      } else {
        setProfileError('Erreur inconnue');
      }
    }
  }

  return (
    <div className="space-y-8">
        <div className="mb-8">
          <h1 className="text-3xl font-black text-white mb-2">Configuration du compte</h1>
          <p className="text-sm text-white/40">Gérez vos informations personnelles et votre sécurité</p>
        </div>

        <div className="space-y-8">
          <div className="border border-white/8 bg-white/[0.02] rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-teal-500/20 border border-teal-400/30 flex items-center justify-center">
                <User className="w-5 h-5 text-teal-300" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Informations du profil</h2>
                <p className="text-xs text-white/40">Personnalisez votre profil public</p>
              </div>
            </div>

            <form onSubmit={handleProfileSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-white/50 mb-1.5 uppercase tracking-wider">
                  Nom d'utilisateur
                </label>
                <input
                  type="text"
                  value={profile?.username || ''}
                  disabled
                  className="w-full px-4 py-3 rounded-xl bg-white/[0.02] border border-white/8 text-white/40 text-sm cursor-not-allowed"
                />
                <p className="text-xs text-white/30 mt-1">Le nom d'utilisateur ne peut pas être modifié</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-white/50 mb-1.5 uppercase tracking-wider">
                  Nom affiché (optionnel)
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Comment voulez-vous être appelé?"
                  className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/8 text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors text-sm"
                />
              </div>

              {profileError && (
                <div className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-2.5">
                  {profileError}
                </div>
              )}

              {profileSuccess && (
                <div className="text-xs text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded-xl px-4 py-2.5">
                  {profileSuccess}
                </div>
              )}

              <button
                type="submit"
                disabled={profileBusy}
                className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-teal-500/20 border border-teal-400/30 text-teal-300 font-bold text-sm hover:bg-teal-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Save className="w-4 h-4" />
                {profileBusy ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </form>
          </div>

          <div className="border border-white/8 bg-white/[0.02] rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-400/30 flex items-center justify-center">
                <Wallet className="w-5 h-5 text-amber-300" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Portefeuille crypto</h2>
                <p className="text-xs text-white/40">Connectez votre wallet MetaMask</p>
              </div>
            </div>

            <div className="space-y-4">
              {walletAddress ? (
                <div>
                  <label className="block text-xs font-semibold text-white/50 mb-1.5 uppercase tracking-wider">
                    Adresse du wallet
                  </label>
                  <div className="px-4 py-3 rounded-xl bg-white/[0.02] border border-white/8 text-white/60 text-sm font-mono">
                    {walletAddress}
                  </div>
                  <p className="text-xs text-white/30 mt-1">Wallet connecté</p>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-white/40 mb-3">Aucun wallet connecté</p>
                </div>
              )}

              <button
                type="button"
                onClick={handleConnectWallet}
                disabled={connectingWallet}
                className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-amber-500/20 border border-amber-400/30 text-amber-300 font-bold text-sm hover:bg-amber-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Wallet className="w-4 h-4" />
                {connectingWallet ? 'Connexion...' : walletAddress ? 'Changer de wallet' : 'Connecter MetaMask'}
              </button>
            </div>
          </div>

          <div className="border border-white/8 bg-white/[0.02] rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-400/30 flex items-center justify-center">
                <Lock className="w-5 h-5 text-rose-300" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Changer le mot de passe</h2>
                <p className="text-xs text-white/40">Sécurisez votre compte</p>
              </div>
            </div>

            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-white/50 mb-1.5 uppercase tracking-wider">
                  Mot de passe actuel
                </label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/8 text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-white/50 mb-1.5 uppercase tracking-wider">
                  Nouveau mot de passe
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/8 text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-white/50 mb-1.5 uppercase tracking-wider">
                  Confirmer le nouveau mot de passe
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/8 text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors text-sm"
                />
              </div>

              {passwordError && (
                <div className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-2.5">
                  {passwordError}
                </div>
              )}

              {passwordSuccess && (
                <div className="text-xs text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded-xl px-4 py-2.5">
                  {passwordSuccess}
                </div>
              )}

              <button
                type="submit"
                disabled={passwordBusy}
                className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-rose-500/20 border border-rose-400/30 text-rose-300 font-bold text-sm hover:bg-rose-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Lock className="w-4 h-4" />
                {passwordBusy ? 'Modification...' : 'Changer le mot de passe'}
              </button>
            </form>
          </div>
        </div>
    </div>
  );
}
