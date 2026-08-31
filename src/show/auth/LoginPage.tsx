import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogIn, Wallet } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function LoginPage() {
  const { signIn, signInWithMetaMask } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [metaMaskBusy, setMetaMaskBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const err = await signIn(email, password);
    setBusy(false);
    if (err) {
      setError(err);
    } else {
      navigate('/show/a1b2c3d4-e5f6-7890-abcd-ef1234567890/live');
    }
  }

  async function handleMetaMaskLogin() {
    setError(null);
    setMetaMaskBusy(true);
    const err = await signInWithMetaMask();
    setMetaMaskBusy(false);
    if (err) {
      setError(err);
    } else {
      navigate('/show/a1b2c3d4-e5f6-7890-abcd-ef1234567890/live');
    }
  }

  return (
    <div className="min-h-screen bg-[#08090d] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-xs font-bold text-teal-400 uppercase tracking-[0.2em] mb-2">Secret House</div>
          <h1 className="text-3xl font-black text-white">Connexion</h1>
          <p className="text-sm text-white/40 mt-2">Entre dans l'arene.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-white/50 mb-1.5 uppercase tracking-wider">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/8 text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors text-sm"
              placeholder="ton@email.com"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-white/50 mb-1.5 uppercase tracking-wider">Mot de passe</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/8 text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors text-sm pr-12"
                placeholder="Mot de passe"
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-2.5">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-teal-500/20 border border-teal-400/30 text-teal-300 font-bold text-sm hover:bg-teal-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <LogIn className="w-4 h-4" />
            {busy ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-white/8"></div>
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-[#08090d] px-3 text-white/30">Ou</span>
          </div>
        </div>

        <button
          onClick={handleMetaMaskLogin}
          disabled={metaMaskBusy}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-amber-500/20 border border-amber-400/30 text-amber-300 font-bold text-sm hover:bg-amber-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Wallet className="w-4 h-4" />
          {metaMaskBusy ? 'Connexion...' : 'Connexion avec MetaMask'}
        </button>

        <p className="text-center text-sm text-white/30 mt-6">
          Pas encore de compte ?{' '}
          <Link to="/auth/register" className="text-teal-400 hover:text-teal-300 transition-colors font-medium">
            Creer un compte
          </Link>
        </p>
      </div>
    </div>
  );
}
