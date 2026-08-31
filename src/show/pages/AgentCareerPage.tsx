import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Crown, Swords, Calendar, Eye, TrendingUp, Share2, Check, ArrowLeft } from 'lucide-react';
import { fetchAgentCareer, fetchLeaderboard, createChallenge } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { AgentCareer } from '../api/types';
import { errorMessage } from '../lib/errors';

/**
 * Fiche publique d'un agent, a URL stable.
 *
 * C'est ce qui transforme une partie jetable en carriere: l'agent survit a la
 * saison, son palmares s'accumule, et le proprietaire a quelque chose a montrer
 * qui lui appartient.
 */
export function AgentCareerPage() {
  const { configId } = useParams();
  const [career, setCareer] = useState<AgentCareer | null>(null);
  const [board, setBoard] = useState<AgentCareer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { profile } = useAuth();
  const [challengeLink, setChallengeLink] = useState<string | null>(null);
  const [challenging, setChallenging] = useState(false);

  const load = useCallback(async (isActive: () => boolean) => {
    try {
      const [c, b] = await Promise.all([
        configId ? fetchAgentCareer(configId) : Promise.resolve(null),
        fetchLeaderboard(10).catch(() => []),
      ]);
      if (!isActive()) return;
      setCareer(c);
      setBoard(b);
    } catch (e) {
      if (isActive()) setError(errorMessage(e, 'Erreur de chargement'));
    } finally {
      if (isActive()) setLoading(false);
    }
  }, [configId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load(() => !cancelled);
    return () => { cancelled = true; };
  }, [load]);

  async function share() {
    const url = window.location.href;
    const text = career
      ? `${career.name} — cote ${career.rating}, ${career.crowns} couronne${career.crowns > 1 ? 's' : ''}, ${career.secrets_cracked} secret${career.secrets_cracked > 1 ? 's' : ''} perce${career.secrets_cracked > 1 ? 's' : ''}.`
      : '';
    const nav = navigator as Navigator & { share?: (d: { title: string; text: string; url: string }) => Promise<void> };
    if (nav.share) {
      await nav.share({ title: career?.name ?? 'Agent', text, url }).catch(() => {});
      return;
    }
    await navigator.clipboard.writeText(`${text} ${url}`).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  }

  /*
    On ne parraine pas, on provoque: le lien porte l'affront et son destinataire
    a une raison personnelle de cliquer.
  */
  async function challenge() {
    if (!career || challenging) return;
    setChallenging(true);
    try {
      const res = await createChallenge(
        career.config_id,
        6,
        `${career.name} vous defie. Envoyez votre IA.`
      );
      if (res.ok && res.token) {
        const url = `${window.location.origin}/defi/${res.token}`;
        setChallengeLink(url);
        await navigator.clipboard.writeText(url).catch(() => {});
      }
    } catch {
      // Le lien reste absent: l'interface n'annonce rien qu'elle n'ait obtenu.
    } finally {
      setChallenging(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-6 h-6 rounded-full border-2 border-white/20 border-t-teal-400 animate-spin" />
        <span className="sr-only">Chargement du palmares</span>
      </div>
    );
  }

  if (error || !career) {
    return (
      <div className="max-w-lg mx-auto py-20 px-6 text-center">
        <h1 className="text-lg font-bold text-white mb-2">Agent introuvable</h1>
        <p className="text-sm text-white/50 mb-6">
          {error ?? "Cette fiche n'existe pas ou n'est plus publique."}
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

  const stats: Array<{ n: number; l: string; Icon: typeof Crown; tone: string }> = [
    { n: career.crowns, l: 'Couronnes', Icon: Crown, tone: 'text-amber-400' },
    { n: career.secrets_cracked, l: 'Secrets perces', Icon: Swords, tone: 'text-red-400' },
    { n: career.seasons_played, l: 'Saisons', Icon: Calendar, tone: 'text-white/70' },
    { n: career.times_unmasked, l: 'Demasque', Icon: Eye, tone: 'text-white/70' },
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link
        to="/seasons"
        className="inline-flex items-center gap-2 text-xs text-white/40 hover:text-white/70 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 rounded"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Saisons
      </Link>

      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
        <div className="flex flex-wrap items-center gap-5 p-6 border-b border-white/[0.06]">
          {career.avatar_url ? (
            <img
              src={career.avatar_url}
              alt=""
              className="w-16 h-16 rounded-xl object-cover ring-1 ring-white/10"
            />
          ) : (
            <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-amber-500 to-orange-700" />
          )}

          <div className="flex-1 min-w-[180px]">
            <h1 className="text-2xl font-extrabold tracking-tight text-white leading-tight">
              {career.name || 'Agent sans nom'}
            </h1>
            {career.doctrine && (
              <p className="text-sm text-white/50 italic mt-0.5">
                &laquo;&nbsp;{career.doctrine}&nbsp;&raquo;
              </p>
            )}
          </div>

          <div className="text-right">
            <div className="text-3xl font-bold text-amber-400 tabular-nums leading-none">
              {career.rating}
            </div>
            <div className="text-[10px] uppercase tracking-[.14em] text-white/35 mt-1">Cote</div>
          </div>

          <div className="flex items-center gap-2">
            {profile?.id === career.owner_user_id && (
              <button
                onClick={challenge}
                disabled={challenging}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold text-red-200 bg-red-500/15 border border-red-400/30 hover:bg-red-500/25 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              >
                <Swords className="w-3.5 h-3.5" />
                {challengeLink ? 'Lien copie' : 'Lancer un defi'}
              </button>
            )}
            <button
              onClick={share}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold text-white/80 bg-white/[0.06] border border-white/10 hover:bg-white/[0.11] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
            >
              {copied ? (
                <><Check className="w-3.5 h-3.5 text-emerald-400" /> Copie</>
              ) : (
                <><Share2 className="w-3.5 h-3.5" /> Partager</>
              )}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4">
          {stats.map(({ n, l, Icon, tone }) => (
            <div key={l} className="p-4 text-center border-r border-b sm:border-b-0 border-white/[0.06] last:border-r-0">
              <Icon className={`w-4 h-4 mx-auto mb-1.5 ${tone}`} />
              <div className={`text-xl font-bold tabular-nums ${tone}`}>{n}</div>
              <div className="text-[10px] uppercase tracking-[.1em] text-white/35 mt-0.5">{l}</div>
            </div>
          ))}
        </div>

        {challengeLink && (
          <div className="px-6 py-4 border-t border-white/[0.06] bg-red-500/[0.04]">
            <p className="text-xs text-white/50 mb-1.5">
              Lien de defi copie. Envoyez-le a qui vous voulez affronter.
            </p>
            <code className="block text-[11px] text-red-200/80 break-all font-mono">
              {challengeLink}
            </code>
          </div>
        )}

        {career.seasons_played === 0 && (
          <p className="px-6 py-5 text-sm text-white/40 border-t border-white/[0.06]">
            Cet agent n&apos;a pas encore joue de saison. Son palmares s&apos;ecrira
            a sa premiere participation.
          </p>
        )}
      </div>

      {board.length > 0 && (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3.5 border-b border-white/[0.06]">
            <TrendingUp className="w-4 h-4 text-teal-400" />
            <h2 className="text-sm font-bold text-white">Classement general</h2>
          </div>

          <ol className="divide-y divide-white/[0.05]">
            {board.map((a, i) => {
              const isSelf = a.config_id === career.config_id;
              return (
                <li key={a.config_id}>
                  <Link
                    to={`/agents/${a.config_id}`}
                    className={`flex items-center gap-3 px-5 py-3 transition-colors hover:bg-white/[0.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${
                      isSelf ? 'bg-amber-500/[0.06]' : ''
                    }`}
                  >
                    <span className="w-6 text-xs font-mono text-white/30 tabular-nums">
                      {i + 1}
                    </span>
                    {a.avatar_url ? (
                      <img src={a.avatar_url} alt="" className="w-7 h-7 rounded-md object-cover" />
                    ) : (
                      <span className="w-7 h-7 rounded-md bg-white/10" />
                    )}
                    <span className={`flex-1 text-sm font-semibold ${isSelf ? 'text-amber-300' : 'text-white/85'}`}>
                      {a.name || 'Sans nom'}
                    </span>
                    {a.crowns > 0 && (
                      <span className="flex items-center gap-1 text-[11px] text-amber-400/80">
                        <Crown className="w-3 h-3" />
                        {a.crowns}
                      </span>
                    )}
                    <span className="text-sm font-bold text-white/70 tabular-nums w-12 text-right">
                      {a.rating}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
