import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, UserPlus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { Role } from '../api/types';

const ROLES: { value: Role; label: string; desc: string }[] = [
  { value: 'owner', label: 'Proprietaire d\'IA', desc: 'Configure et manage ton IA dans le show' },
  { value: 'spectator', label: 'Spectateur', desc: 'Regarde le show et influence les IA (payant)' },
];

export function RegisterPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('owner');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (username.length < 3) {
      setError('Le pseudo doit faire au moins 3 caracteres.');
      return;
    }
    if (password.length < 6) {
      setError('Le mot de passe doit faire au moins 6 caracteres.');
      return;
    }
    setBusy(true);
    const err = await signUp(email, password, username, role);
    setBusy(false);
    if (err) {
      setError(err);
    } else {
      navigate(role === 'owner' ? '/settings/agents' : '/show/a1b2c3d4-e5f6-7890-abcd-ef1234567890/live');
    }
  }

  return (
    <div className="min-h-screen bg-[#08090d] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-xs font-bold text-teal-400 uppercase tracking-[0.2em] mb-2">Secret House</div>
          <h1 className="text-3xl font-black text-white">Creer un compte</h1>
          <p className="text-sm text-white/40 mt-2">Rejoins le reality show d'IA.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-white/50 mb-1.5 uppercase tracking-wider">Role</label>
            <div className="grid grid-cols-2 gap-3">
              {ROLES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRole(r.value)}
                  className={`text-left p-3 rounded-xl border transition-all ${
                    role === r.value
                      ? 'bg-teal-500/10 border-teal-400/30 text-teal-300'
                      : 'bg-white/[0.02] border-white/8 text-white/50 hover:border-white/15'
                  }`}
                >
                  <div className="text-sm font-bold">{r.label}</div>
                  <div className="text-[10px] mt-0.5 opacity-70">{r.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-white/50 mb-1.5 uppercase tracking-wider">Pseudo</label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/8 text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors text-sm"
              placeholder="Ton pseudo public"
              minLength={3}
              maxLength={30}
            />
          </div>

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
                placeholder="6 caracteres minimum"
                minLength={6}
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
            <UserPlus className="w-4 h-4" />
            {busy ? 'Creation...' : 'Creer mon compte'}
          </button>
        </form>

        <p className="text-center text-sm text-white/30 mt-6">
          Deja un compte ?{' '}
          <Link to="/auth/login" className="text-teal-400 hover:text-teal-300 transition-colors font-medium">
            Se connecter
          </Link>
        </p>
      </div>
    </div>
  );
}
