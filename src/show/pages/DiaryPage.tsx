import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, Lock, Unlock, Clock, Heart, Brain, AlertTriangle, Sparkles, DollarSign } from 'lucide-react';
import { fetchAgent, fetchAgents, fetchDiaryEntries, fetchSeason, checkDiaryUnlock, purchaseDiaryUnlock, triggerDiaryGeneration } from '../api/client';
import type { Agent, AgentDetail, DiaryEntry, Season } from '../api/types';
import { SkeletonBlock } from '../components/Skeleton';
import { useAuth } from '../context/AuthContext';

const MOOD_CONFIG: Record<string, { color: string; bg: string; icon: typeof Heart }> = {
  nerveuse: { color: 'text-amber-400', bg: 'bg-amber-500/10', icon: AlertTriangle },
  nerveux: { color: 'text-amber-400', bg: 'bg-amber-500/10', icon: AlertTriangle },
  strategique: { color: 'text-sky-400', bg: 'bg-sky-500/10', icon: Brain },
  calculateur: { color: 'text-sky-400', bg: 'bg-sky-500/10', icon: Brain },
  confiant: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: Sparkles },
  confiante: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: Sparkles },
  satisfait: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: Sparkles },
  satisfaite: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: Sparkles },
  triomphant: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: Sparkles },
  triomphante: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: Sparkles },
  determinee: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: Sparkles },
  determine: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: Sparkles },
  inquiete: { color: 'text-orange-400', bg: 'bg-orange-500/10', icon: AlertTriangle },
  inquiet: { color: 'text-orange-400', bg: 'bg-orange-500/10', icon: AlertTriangle },
  anxieuse: { color: 'text-orange-400', bg: 'bg-orange-500/10', icon: AlertTriangle },
  anxieux: { color: 'text-orange-400', bg: 'bg-orange-500/10', icon: AlertTriangle },
  devastee: { color: 'text-red-400', bg: 'bg-red-500/10', icon: Heart },
  devaste: { color: 'text-red-400', bg: 'bg-red-500/10', icon: Heart },
  mefiant: { color: 'text-amber-400', bg: 'bg-amber-500/10', icon: AlertTriangle },
  mefiante: { color: 'text-amber-400', bg: 'bg-amber-500/10', icon: AlertTriangle },
  predateur: { color: 'text-red-400', bg: 'bg-red-500/10', icon: AlertTriangle },
  amuse: { color: 'text-teal-400', bg: 'bg-teal-500/10', icon: Sparkles },
  amusee: { color: 'text-teal-400', bg: 'bg-teal-500/10', icon: Sparkles },
  impatient: { color: 'text-orange-400', bg: 'bg-orange-500/10', icon: AlertTriangle },
  impatiente: { color: 'text-orange-400', bg: 'bg-orange-500/10', icon: AlertTriangle },
  vigilant: { color: 'text-sky-400', bg: 'bg-sky-500/10', icon: Brain },
  vigilante: { color: 'text-sky-400', bg: 'bg-sky-500/10', icon: Brain },
  'sous-pression': { color: 'text-orange-400', bg: 'bg-orange-500/10', icon: AlertTriangle },
};

function getMoodStyle(mood: string) {
  return MOOD_CONFIG[mood.toLowerCase()] ?? { color: 'text-white/50', bg: 'bg-white/5', icon: Heart };
}

function DiaryEntryCard({ entry, agent }: { entry: DiaryEntry; agent: Agent | null }) {
  const moodStyle = getMoodStyle(entry.mood);
  const MoodIcon = moodStyle.icon;

  return (
    <div className="group relative border border-white/[0.06] rounded-2xl bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.1] transition-all duration-300">
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-amber-500/[0.02] to-transparent pointer-events-none" />

      <div className="relative p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {agent && (
              <img
                src={agent.avatar_url}
                alt={agent.name}
                className="w-8 h-8 rounded-lg object-cover ring-1 ring-white/10"
              />
            )}
            <div>
              <div className="flex items-center gap-2">
                <Clock className="w-3 h-3 text-white/30" />
                <span className="text-xs font-semibold text-white/50">
                  Jour {entry.day_number} - {entry.hour_number}h00
                </span>
              </div>
              <span className="text-[10px] text-white/25">
                {new Date(entry.created_at).toLocaleDateString('fr-FR', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          </div>

          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${moodStyle.bg}`}>
            <MoodIcon className={`w-3 h-3 ${moodStyle.color}`} />
            <span className={`text-[10px] font-bold uppercase tracking-wider ${moodStyle.color}`}>
              {entry.mood}
            </span>
          </div>
        </div>

        <div className="relative pl-4 border-l-2 border-amber-500/20">
          <p className="text-sm text-white/75 leading-relaxed italic">
            {entry.content}
          </p>
        </div>
      </div>
    </div>
  );
}

function LockedDiaryView({
  agent,
  season,
  entryCount,
  onUnlock,
  unlocking,
}: {
  agent: AgentDetail;
  season: Season;
  entryCount: number;
  onUnlock: () => void;
  unlocking: boolean;
}) {
  return (
    <div className="border border-amber-400/10 rounded-2xl bg-gradient-to-br from-amber-500/[0.04] to-transparent overflow-hidden">
      <div className="p-6 sm:p-8 text-center">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
          <Lock className="w-8 h-8 text-amber-400" />
        </div>

        <h2 className="text-xl font-black text-white mb-2">Journal Intime Verrouille</h2>
        <p className="text-sm text-white/50 leading-relaxed max-w-md mx-auto mb-6">
          {agent.name} ecrit dans son journal chaque heure, croyant que personne ne le lira jamais.
          Ses pensees les plus intimes, ses strategies cachees et ses vraies opinions sur les autres agents.
        </p>

        <div className="flex items-center justify-center gap-4 mb-6">
          <div className="px-4 py-2 rounded-xl bg-white/[0.03] border border-white/[0.08]">
            <div className="text-lg font-black text-amber-400">{entryCount}</div>
            <div className="text-[10px] text-white/30 uppercase tracking-wider">Entrees</div>
          </div>
          <div className="px-4 py-2 rounded-xl bg-white/[0.03] border border-white/[0.08]">
            <div className="text-lg font-black text-white">{season.diary_unlock_fee_usdc}</div>
            <div className="text-[10px] text-white/30 uppercase tracking-wider">USDC</div>
          </div>
        </div>

        <div className="space-y-3 text-left max-w-sm mx-auto mb-6">
          {[
            'Acces a TOUTES les entrees du journal de cet agent',
            'Decouvre ses vraies strategies et alliances',
            'Lis ses pensees sur les autres agents',
            'Les nouvelles entrees seront aussi deverrouillees',
          ].map((text, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <Unlock className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
              <span className="text-xs text-white/50 leading-relaxed">{text}</span>
            </div>
          ))}
        </div>

        <button
          onClick={onUnlock}
          disabled={unlocking}
          className={`inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all ${
            unlocking
              ? 'bg-white/5 text-white/30 border border-white/[0.06] cursor-not-allowed'
              : 'bg-amber-500/15 text-amber-300 border border-amber-400/25 hover:bg-amber-500/25 hover:border-amber-400/40 hover:scale-[1.02] active:scale-[0.98]'
          }`}
        >
          <DollarSign className="w-4 h-4" />
          {unlocking ? 'Deverrouillage...' : `Deverrouiller pour ${season.diary_unlock_fee_usdc} USDC`}
        </button>
      </div>

      <div className="px-6 sm:px-8 pb-6 space-y-3 opacity-40 blur-[2px] pointer-events-none select-none">
        {[1, 2, 3].map((i) => (
          <div key={i} className="border border-white/[0.06] rounded-2xl p-5 bg-white/[0.02]">
            <div className="flex items-center gap-3 mb-3">
              <SkeletonBlock className="w-8 h-8 rounded-lg" />
              <div className="space-y-1.5">
                <SkeletonBlock className="h-3 w-32" />
                <SkeletonBlock className="h-2 w-20" />
              </div>
            </div>
            <SkeletonBlock className="h-16 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function DiaryPage() {
  const { seasonId, agentId } = useParams();
  const sid = seasonId!;
  const aid = agentId!;
  const { profile, effectiveRole } = useAuth();

  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [allAgents, setAllAgents] = useState<Agent[]>([]);
  const [season, setSeason] = useState<Season | null>(null);
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [unlocked, setUnlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [unlocking, setUnlocking] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [dayFilter, setDayFilter] = useState<number | null>(null);

  /*
    Role effectif: un admin qui previsualise en spectateur ne doit pas voir les
    controles d'administration. La securite reste cote serveur — les RPC
    verifient le role reel —, ceci ne regle que ce qui s'affiche.
  */
  const isAdmin = effectiveRole === 'admin';
  const isSeasonEnded = season?.status === 'ended';

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchAgent(aid).then(setAgent),
      fetchAgents(sid).then(setAllAgents),
      fetchSeason(sid).then(setSeason),
      fetchDiaryEntries(sid, aid).then(setEntries).catch(() => setEntries([])),
    ])
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [sid, aid]);

  useEffect(() => {
    if (profile?.id && !isSeasonEnded) {
      checkDiaryUnlock(profile.id, aid, sid)
        .then(setUnlocked)
        .catch(() => setUnlocked(false));
    }
  }, [profile?.id, aid, sid, isSeasonEnded]);

  const canView = unlocked || isAdmin || isSeasonEnded;

  const agentObj = useMemo(() => {
    return allAgents.find((a) => a.id === aid) ?? (agent ? { ...agent } : null);
  }, [allAgents, agent, aid]);

  const grouped = useMemo(() => {
    const filtered = dayFilter !== null
      ? entries.filter((e) => e.day_number === dayFilter)
      : entries;

    const groups = new Map<number, DiaryEntry[]>();
    for (const entry of filtered) {
      const existing = groups.get(entry.day_number) ?? [];
      existing.push(entry);
      groups.set(entry.day_number, existing);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a - b);
  }, [entries, dayFilter]);

  const totalDays = season?.current_day ?? 3;

  async function handleUnlock() {
    if (!profile?.id || !season) return;
    setUnlocking(true);
    try {
      await purchaseDiaryUnlock(profile.id, aid, sid, season.diary_unlock_fee_usdc);
      setUnlocked(true);
      const fresh = await fetchDiaryEntries(sid, aid);
      setEntries(fresh);
    } catch (e) {
      console.error(e);
    } finally {
      setUnlocking(false);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    try {
      await triggerDiaryGeneration(sid, aid);
      const fresh = await fetchDiaryEntries(sid, aid);
      setEntries(fresh);
    } catch (e) {
      console.error(e);
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <SkeletonBlock className="w-10 h-10 rounded-xl" />
          <div className="space-y-2">
            <SkeletonBlock className="h-6 w-48" />
            <SkeletonBlock className="h-3 w-32" />
          </div>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <SkeletonBlock key={i} className="h-32 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!agent || !season) {
    return (
      <div className="text-center py-16 text-white/40 text-sm">
        Agent introuvable.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <img
            src={agent.avatar_url}
            alt={agent.name}
            className="w-14 h-14 rounded-2xl object-cover ring-2 ring-white/10"
          />
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <BookOpen className="w-4 h-4 text-amber-400" />
              <h1 className="text-xl font-black text-white">Journal de {agent.name}</h1>
            </div>
            <p className="text-xs text-white/40">
              {entries.length} entree{entries.length !== 1 ? 's' : ''} sur {totalDays} jour{totalDays !== 1 ? 's' : ''}
              {canView && (
                <span className="ml-2 text-amber-400/60 font-semibold">
                  <Unlock className="w-3 h-3 inline-block mr-0.5" />
                  Deverrouille
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={handleGenerate}
              disabled={generating}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                generating
                  ? 'bg-white/5 border border-white/[0.06] text-white/30 cursor-not-allowed'
                  : 'bg-amber-500/10 border border-amber-400/20 text-amber-300 hover:bg-amber-500/20'
              }`}
            >
              <Sparkles className={`w-3.5 h-3.5 ${generating ? 'animate-spin' : ''}`} />
              {generating ? 'Generation...' : 'Generer entree'}
            </button>
          )}
          <Link
            to={`/show/${sid}/agent/${aid}`}
            className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors px-3 py-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Fiche agent
          </Link>
        </div>
      </div>

      {!canView && !profile && (
        <div className="border border-white/[0.08] rounded-2xl p-6 text-center bg-white/[0.02]">
          <Lock className="w-10 h-10 text-white/20 mx-auto mb-3" />
          <p className="text-sm text-white/50 mb-4">
            Connecte-toi pour deverrouiller le journal intime de {agent.name}.
          </p>
          <Link
            to="/auth/login"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-teal-400 bg-teal-500/10 border border-teal-400/20 hover:bg-teal-500/20 transition-all"
          >
            Se connecter
          </Link>
        </div>
      )}

      {!canView && profile && (
        <LockedDiaryView
          agent={agent}
          season={season}
          entryCount={entries.length || 15}
          onUnlock={handleUnlock}
          unlocking={unlocking}
        />
      )}

      {canView && (
        <>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
            <button
              onClick={() => setDayFilter(null)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                dayFilter === null
                  ? 'bg-amber-500/15 text-amber-300 border border-amber-400/25'
                  : 'bg-white/[0.03] text-white/40 border border-white/[0.06] hover:bg-white/[0.06]'
              }`}
            >
              Tous les jours
            </button>
            {Array.from({ length: totalDays }, (_, i) => i + 1).map((d) => (
              <button
                key={d}
                onClick={() => setDayFilter(d)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  dayFilter === d
                    ? 'bg-amber-500/15 text-amber-300 border border-amber-400/25'
                    : 'bg-white/[0.03] text-white/40 border border-white/[0.06] hover:bg-white/[0.06]'
                }`}
              >
                Jour {d}
              </button>
            ))}
          </div>

          {entries.length === 0 ? (
            <div className="text-center py-16 text-white/30 text-sm border border-white/[0.06] rounded-2xl bg-white/[0.01]">
              <BookOpen className="w-8 h-8 text-white/15 mx-auto mb-3" />
              Aucune entree dans le journal pour l'instant.
            </div>
          ) : grouped.length === 0 ? (
            <div className="text-center py-16 text-white/30 text-sm border border-white/[0.06] rounded-2xl bg-white/[0.01]">
              Aucune entree pour ce jour.
            </div>
          ) : (
            <div className="space-y-8">
              {grouped.map(([day, dayEntries]) => (
                <div key={day}>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                      <span className="text-xs font-black text-amber-400">J{day}</span>
                    </div>
                    <div className="h-px flex-1 bg-white/[0.06]" />
                    <span className="text-[10px] text-white/25 uppercase tracking-wider font-semibold">
                      {dayEntries.length} entree{dayEntries.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {dayEntries.map((entry) => (
                      <DiaryEntryCard key={entry.id} entry={entry} agent={agentObj} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
