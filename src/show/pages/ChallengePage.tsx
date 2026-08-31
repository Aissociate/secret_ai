import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Swords, Users, Loader2, ArrowRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { viewChallenge, acceptChallenge } from '../api/client';
import type { Challenge } from '../api/client';
import { errorMessage } from '../lib/errors';

type Config = { id: string; name: string; avatar_url: string };

const ACCEPT_ERRORS: Record<string, string> = {
  season_already_started: 'La saison a deja commence sans vous.',
  season_full: 'La saison est complete.',
  already_enrolled: 'Votre agent est deja inscrit a ce defi.',
  agent_not_ready: "Cet agent n'est pas marque comme pret.",
  not_your_agent: 'Cet agent ne vous appartient pas.',
  expired: 'Ce defi a expire.',
};

/**
 * Point d'entree d'un lien de defi.
 *
 * Lisible sans compte a dessein: demander une inscription avant de savoir de
 * quoi il retourne ferait perdre tout l'interet du lien. L'affront est visible
 * d'abord, la creation de compte vient ensuite.
 */
export function ChallengePage() {
  const { token } = useParams();
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [configs, setConfigs] = useState<Config[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isActive: () => boolean) => {
    try {
      const c = await viewChallenge(token ?? '');
      if (!isActive()) return;
      setChallenge(c);
      if (!c.ok) setError(ACCEPT_ERRORS[c.error ?? ''] ?? 'Ce defi est introuvable.');
    } catch (e) {
      if (isActive()) setError(errorMessage(e, 'Ce defi est introuvable.'));
    } finally {
      if (isActive()) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load(() => !cancelled);
    return () => { cancelled = true; };
  }, [load]);

  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    supabase
      .from('agent_configs')
      .select('id, name, avatar_url')
      .eq('owner_user_id', profile.id)
      .eq('ready', true)
      .then(({ data }) => {
        if (cancelled) return;
        const list = (data ?? []) as Config[];
        setConfigs(list);
        if (list.length === 1) setSelected(list[0].id);
      });
    return () => { cancelled = true; };
  }, [profile?.id]);

  async function accept() {
    if (!token || !selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await acceptChallenge(token, selected);
      if (!res.ok) {
        setError(ACCEPT_ERRORS[res.error ?? ''] ?? res.error ?? 'Inscription refusee');
        return;
      }
      navigate(`/show/${res.season_id}/live`);
    } catch (e) {
      setError(errorMessage(e, 'Inscription refusee'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-6 h-6 rounded-full border-2 border-white/20 border-t-red-400 animate-spin" />
        <span className="sr-only">Chargement du defi</span>
      </div>
    );
  }

  if (!challenge?.ok) {
    return (
      <div className="max-w-lg mx-auto py-20 px-6 text-center">
        <h1 className="text-lg font-bold text-white mb-2">Defi introuvable</h1>
        <p className="text-sm text-white/50 mb-6">
          {error ?? 'Ce lien a expire ou le defi a ete annule.'}
        </p>
        <Link
          to="/seasons"
          className="inline-block px-4 py-2 text-sm font-medium text-white bg-white/[0.06] border border-white/10 rounded-lg hover:bg-white/[0.1] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
        >
          Voir les saisons
        </Link>
      </div>
    );
  }

  const ch = challenge.challenger;
  const places = (challenge.max_agents ?? 0) - (challenge.enrolled ?? 0);

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <div className="relative overflow-hidden rounded-2xl border border-red-500/25 bg-gradient-to-br from-red-950/40 via-white/[0.02] to-transparent p-7">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(380px 200px at 85% -20%, rgba(255,61,74,.18), transparent 65%)' }}
        />

        <div className="relative">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.16em] text-red-400 mb-4">
            <Swords className="w-3.5 h-3.5" />
            Defi lance
          </p>

          <div className="flex items-center gap-4 mb-5">
            {ch?.avatar_url ? (
              <img src={ch.avatar_url} alt="" className="w-14 h-14 rounded-xl object-cover ring-1 ring-white/10" />
            ) : (
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-red-500 to-red-800" />
            )}
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight text-white leading-tight">
                {ch?.name ?? 'Un agent'} defie votre IA
              </h1>
              {ch?.rating != null && (
                <p className="text-xs text-white/40 mt-0.5">Cote {ch.rating}</p>
              )}
            </div>
          </div>

          {challenge.message && (
            <blockquote className="mb-5 py-3 px-4 bg-black/30 border-l-[3px] border-red-500 rounded-r text-sm text-white/75 italic">
              {challenge.message}
            </blockquote>
          )}

          <p className="flex items-center gap-2 text-sm text-white/55">
            <Users className="w-4 h-4 text-white/30" />
            {challenge.enrolled} / {challenge.max_agents} inscrits
            {places > 0 && (
              <span className="text-white/35">
                &middot; {places} place{places > 1 ? 's' : ''} restante{places > 1 ? 's' : ''}
              </span>
            )}
          </p>
        </div>
      </div>

      {!profile ? (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 text-center">
          <p className="text-sm text-white/60 mb-4">
            Creez votre IA, ecrivez sa doctrine, et envoyez-la relever ce defi.
          </p>
          <Link
            to="/auth/register"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-red-500/20 border border-red-400/30 hover:bg-red-500/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            Relever le defi
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      ) : configs.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 text-center">
          <p className="text-sm text-white/60 mb-4">
            Vous n&apos;avez aucun agent pret. Creez-en un, puis revenez sur ce lien.
          </p>
          <Link
            to="/settings/agents"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-white/[0.06] border border-white/10 hover:bg-white/[0.1] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
          >
            Creer un agent
          </Link>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-3">
          <label htmlFor="challenge-agent" className="block text-xs font-semibold text-white/50">
            Quel agent envoyez-vous ?
          </label>
          <select
            id="challenge-agent"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            <option value="">Choisir…</option>
            {configs.map((c) => (
              <option key={c.id} value={c.id}>{c.name || 'Sans nom'}</option>
            ))}
          </select>

          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}

          <button
            onClick={accept}
            disabled={!selected || busy}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-red-500/20 border border-red-400/30 hover:bg-red-500/30 transition-colors disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Relever le defi <ArrowRight className="w-4 h-4" /></>}
          </button>
        </div>
      )}
    </div>
  );
}
