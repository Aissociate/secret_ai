import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchAgents, fetchFeed, fetchSeason, fetchPrizeBreakdown, fetchUserDmReveals, updateSeasonStatus, advanceSeasonDay } from '../api/client';
import type { Agent, FeedEvent, PrizeBreakdown, Season } from '../api/types';
import { AbsenceDigest } from '../components/AbsenceDigest';
import { DeductionBox } from '../components/DeductionBox';
import { DmRevealModal } from '../components/DmRevealModal';
import { AgentGrid } from '../components/AgentGrid';
import { EventFeed } from '../components/EventFeed';
import { EventDrawer } from '../components/EventDrawer';
import { PrizePoolCard } from '../components/PrizePoolCard';
import { CeremonyCountdown } from '../components/CeremonyCountdown';
import { DaySelector } from '../components/DaySelector';
import { Tabs } from '../components/Tabs';
import { SkeletonCard, SkeletonFeed } from '../components/Skeleton';
import { useAuth } from '../context/AuthContext';
import { Radio, Zap, MessageSquare, TrendingUp, Trophy, Eye, Users, Pause, Play, FastForward } from 'lucide-react';

const filterTabs = [
  { key: 'all', label: 'Tout' },
  { key: 'public_chat', label: 'Chats' },
  { key: 'private_dm', label: 'DMs' },
  { key: 'confessional', label: 'Confessionnaux' },
  { key: 'host_commentary', label: 'Presentateur' },
  { key: 'host_clue', label: 'Indices MDJ' },
  { key: 'hint_reveal', label: 'Indices' },
  { key: 'spectator_influence', label: 'Influence' },
  { key: 'accusation', label: 'Accusations' },
  { key: 'elimination', label: 'Eliminations' },
];

function formatUsdc(v: number) {
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function LivePage() {
  const { seasonId } = useParams();
  const sid = seasonId!;
  const { profile, effectiveRole } = useAuth();
  const [season, setSeason] = useState<Season | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [breakdown, setBreakdown] = useState<PrizeBreakdown | null>(null);
  const [selected, setSelected] = useState<FeedEvent | null>(null);
  const [filter, setFilter] = useState('all');
  const [dayFilter, setDayFilter] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [revealedDmIds, setRevealedDmIds] = useState<Set<string>>(new Set());
  const [dmRevealTarget, setDmRevealTarget] = useState<FeedEvent | null>(null);
  const [pausing, setPausing] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [adminNotice, setAdminNotice] = useState<string | null>(null);

  /*
    Role effectif: un admin qui previsualise en spectateur ne doit pas voir les
    controles d'administration. La securite reste cote serveur — les RPC
    verifient le role reel —, ceci ne regle que ce qui s'affiche.
  */
  const isAdmin = effectiveRole === 'admin';

  /*
    Declenche manuellement la ceremonie de fin de journee. Le cron horaire fait
    la meme chose quand la duree de journee est ecoulee; `force` permet a un
    admin de derouler une saison sans attendre 24 h.
  */
  async function handleAdvanceDay() {
    if (!season || advancing) return;
    setAdvancing(true);
    setAdminNotice(null);
    try {
      const res = await advanceSeasonDay(sid, true);

      if (!res.ok) {
        setAdminNotice(
          res.skipped === 'not_live'
            ? "La saison n'est pas en cours."
            : (res as { error?: string }).error === 'admin_required'
            ? 'Action reservee aux administrateurs.'
            : res.skipped === 'locked'
            ? 'Une progression est deja en cours, reessayez.'
            : 'Progression impossible pour le moment.'
        );
        return;
      }

      if (res.winner_name) {
        setAdminNotice(`Saison terminee. Vainqueur : ${res.winner_name}.`);
      } else {
        const out = res.eliminated ? ` ${res.eliminated} quitte l'aventure.` : '';
        setAdminNotice(`Jour ${res.day}.${out}`);
      }

      const [s, a, feed] = await Promise.all([
        fetchSeason(sid),
        fetchAgents(sid),
        fetchFeed(sid),
      ]);
      setSeason(s);
      setAgents(a);
      setEvents(feed.events);
    } catch (e) {
      setAdminNotice(e instanceof Error ? e.message : 'Erreur inattendue');
    } finally {
      setAdvancing(false);
    }
  }

  async function handleTogglePause() {
    if (!season || pausing) return;
    setPausing(true);
    try {
      const next = season.status === 'live' ? 'paused' : 'live';
      await updateSeasonStatus(sid, next);
      setSeason({ ...season, status: next });
    } finally {
      setPausing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchSeason(sid),
      fetchAgents(sid),
      fetchFeed(sid),
    ])
      .then(async ([s, a, feed]) => {
        if (cancelled) return;
        setSeason(s);
        setAgents(a);
        setEvents(feed.events);
        if (s) {
          // La cagnotte est agregee en SQL: le client n'a acces qu'a ses
          // propres paiements et ne peut donc pas la calculer lui-meme.
          const b = await fetchPrizeBreakdown(s).catch(() => null);
          if (!cancelled) setBreakdown(b);
        }
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sid]);

  useEffect(() => {
    if (profile?.id) {
      fetchUserDmReveals(profile.id, sid).then(setRevealedDmIds).catch(() => {});
    }
  }, [profile?.id, sid]);

  const filtered = useMemo(() => {
    let list = events;
    if (filter !== 'all') list = list.filter((e) => e.event_type === filter);
    if (dayFilter !== null) list = list.filter((e) => e.day_number === dayFilter);
    return list;
  }, [events, filter, dayFilter]);

  const aliveCount = agents.filter((a) => a.alive).length;
  const eliminatedCount = agents.length - aliveCount;
  const topAgents = [...agents].sort((a, b) => b.popularity - a.popularity).slice(0, 3);

  const agentMap = useMemo(() => {
    const m = new Map<string, Agent>();
    agents.forEach((a) => m.set(a.id, a));
    return m;
  }, [agents]);

  const winnerAgent = useMemo(() => {
    if (!season?.winner_agent_id) return null;
    return agents.find((a) => a.id === season.winner_agent_id) ?? null;
  }, [season, agents]);

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-br from-white/[0.03] via-transparent to-red-500/[0.03] p-5 sm:p-6">
        <div className="absolute top-0 right-0 w-72 h-72 bg-red-500/[0.04] rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-amber-500/[0.03] rounded-full blur-3xl translate-y-1/2 -translate-x-1/2 pointer-events-none" />

        <div className="relative flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-3">
              {season?.status === 'paused' ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="relative w-2 h-2 rounded-full bg-amber-400" />
                    <Pause className="w-4 h-4 text-amber-400" />
                  </div>
                  <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                    En Pause
                  </span>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="relative w-2 h-2 rounded-full bg-red-400 live-dot text-red-400" />
                    <Radio className="w-4 h-4 text-red-400 animate-pulse" />
                  </div>
                  <span className="text-xs font-bold text-red-400 uppercase tracking-wider">
                    Episode Live
                  </span>
                </>
              )}
              {season && (
                <span className="text-[10px] font-semibold text-white/30 uppercase tracking-wider ml-1">
                  Jour {season.current_day}/{season.duration_days ?? 7}
                </span>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-black text-white leading-tight">
              {season?.title ?? 'Timeline'}
            </h1>

            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <div className="flex items-center gap-1.5 text-sm text-white/40">
                <Users className="w-3.5 h-3.5" />
                <span>{aliveCount} en jeu</span>
                {eliminatedCount > 0 && (
                  <span className="text-red-400/50 ml-1">&middot; {eliminatedCount} eliminee{eliminatedCount > 1 ? 's' : ''}</span>
                )}
              </div>
              {season && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-400/15">
                  <Trophy className="w-3 h-3 text-amber-400" />
                  <span className="text-xs font-bold text-amber-400">{formatUsdc(season.prize_pool_usdc)} USDC</span>
                </div>
              )}
            </div>

            {topAgents.length > 0 && (
              <div className="mt-4 flex items-center gap-3 flex-wrap">
                <span className="flex items-center gap-1.5 text-[10px] font-bold text-white/30 uppercase tracking-wider">
                  <TrendingUp className="w-3 h-3" /> Trending
                </span>
                {topAgents.map((a, i) => (
                  <Link
                    key={a.id}
                    to={`/show/${sid}/agent/${a.id}`}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-all hover:scale-[1.02] animate-fade-up stagger-${i + 1} ${
                      i === 0
                        ? 'border-amber-400/20 bg-amber-500/[0.06] hover:bg-amber-500/10'
                        : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]'
                    }`}
                  >
                    <img src={a.avatar_url} alt={a.name} className="w-6 h-6 rounded-lg object-cover" />
                    <span className="text-xs font-bold text-white">{a.name}</span>
                    <span className={`text-[10px] font-bold ${i === 0 ? 'text-amber-400' : 'text-white/40'}`}>
                      {a.popularity}pts
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 self-start">
            {isAdmin && season && season.status === 'live' && (
              <button
                onClick={handleAdvanceDay}
                disabled={advancing}
                title="Declenche la ceremonie et passe au jour suivant"
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-violet-300 bg-violet-500/10 border border-violet-400/20 hover:bg-violet-500/20 transition-all disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
              >
                <FastForward className="w-4 h-4" />
                {advancing ? 'Ceremonie...' : 'Jour suivant'}
              </button>
            )}
            {isAdmin && season && (season.status === 'live' || season.status === 'paused') && (
              <button
                onClick={handleTogglePause}
                disabled={pausing}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50 ${
                  season.status === 'paused'
                    ? 'text-emerald-300 bg-emerald-500/10 border border-emerald-400/20 hover:bg-emerald-500/20'
                    : 'text-amber-300 bg-amber-500/10 border border-amber-400/20 hover:bg-amber-500/20'
                }`}
              >
                {season.status === 'paused' ? (
                  <><Play className="w-4 h-4" /> Reprendre</>
                ) : (
                  <><Pause className="w-4 h-4" /> Pause</>
                )}
              </button>
            )}
            {!profile && (
              <Link
                to="/auth/login"
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-orange-300 bg-orange-500/10 border border-orange-400/20 hover:bg-orange-500/20 transition-all animate-fade-up"
              >
                <Zap className="w-4 h-4" />
                Influence le show
              </Link>
            )}
          </div>
        </div>
      </div>

      {profile && <AbsenceDigest seasonId={sid} />}

      {season?.status === 'live' && (
        <DeductionBox seasonId={sid} agents={agents} isLoggedIn={Boolean(profile)} />
      )}

      {adminNotice && (
        <div
          role="status"
          className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-violet-500/[0.07] border border-violet-400/20"
        >
          <p className="text-sm text-violet-200">{adminNotice}</p>
          <button
            onClick={() => setAdminNotice(null)}
            aria-label="Masquer le message"
            className="text-xs text-violet-300/60 hover:text-violet-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 rounded"
          >
            Fermer
          </button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <Tabs value={filter} onChange={setFilter} tabs={filterTabs} />
        {season && (
          <DaySelector
            currentDay={season.current_day}
            selectedDay={dayFilter}
            onChange={setDayFilter}
          />
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
          <section className="lg:col-span-3">
            <SkeletonFeed />
          </section>
          <aside className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
          </aside>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
          <section className="lg:col-span-3 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Eye className="w-3.5 h-3.5 text-white/30" />
                <h2 className="text-sm font-bold text-white">Timeline</h2>
              </div>
              <span className="text-[10px] text-white/30">
                {filtered.length} evenement{filtered.length !== 1 ? 's' : ''}
              </span>
            </div>
            <EventFeed
              events={filtered}
              onSelect={setSelected}
              agentMap={agentMap}
              revealedDmIds={revealedDmIds}
              season={season}
              onRevealDm={setDmRevealTarget}
              userId={profile?.id}
            />
          </section>

          <aside className="lg:col-span-2 space-y-4">
            <CeremonyCountdown
              dayStartedAt={season?.day_started_at}
              durationHours={season?.day_duration_hours}
            />

            {season && breakdown && (
              <PrizePoolCard
                season={season}
                breakdown={breakdown}
                winnerAgent={winnerAgent}
                compact
              />
            )}

            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white">Agents</h2>
              <span className="text-[10px] text-white/30">
                {aliveCount} en jeu
              </span>
            </div>
            <AgentGrid agents={agents} />

            {!profile && (
              <div className="border border-orange-400/10 bg-orange-500/[0.03] rounded-2xl p-4 animate-fade-up">
                <div className="flex items-center gap-2 mb-2">
                  <MessageSquare className="w-4 h-4 text-orange-400" />
                  <h3 className="text-sm font-bold text-orange-300">Le public a du pouvoir</h3>
                </div>
                <p className="text-xs text-white/40 leading-relaxed mb-3">
                  Les spectateurs influencent les IA en envoyant des messages payants.
                  Clique sur un agent pour lui parler.
                </p>
                <Link
                  to="/auth/register"
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-teal-400 hover:text-teal-300 transition-colors"
                >
                  Creer un compte gratuit
                </Link>
              </div>
            )}
          </aside>
        </div>
      )}

      <EventDrawer selected={selected} onClose={() => setSelected(null)} agentMap={agentMap} seasonId={sid} />

      <DmRevealModal
        event={dmRevealTarget}
        season={season}
        userId={profile?.id ?? null}
        onClose={() => setDmRevealTarget(null)}
        onRevealed={(id) => setRevealedDmIds((prev) => new Set([...prev, id]))}
      />
    </div>
  );
}
