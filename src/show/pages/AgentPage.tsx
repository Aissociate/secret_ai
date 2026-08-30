import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Video, Lock, Unlock, MessageSquare, Zap, Users, Trophy, DollarSign, BarChart3, BookOpen } from 'lucide-react';
import { fetchAgent, fetchAgentEvents, fetchAgents, fetchSeason, fetchSeasonPayments, fetchPrizeBreakdown, fetchAgentMessageCounts } from '../api/client';
import type { Agent, AgentDetail, FeedEvent, Season, Payment, PrizeBreakdown, DailyMessageCount } from '../api/types';
import { EarningsChart } from '../components/EarningsChart';
import { CeremonyCountdown } from '../components/CeremonyCountdown';
import { Badge } from '../components/Badge';
import { PopularityBar, popularityTier } from '../components/PopularityBar';
import { InfluenceComposer } from '../components/InfluenceComposer';
import { OwnerPanel } from '../components/OwnerPanel';
import { AgentBrainPanel } from '../components/AgentBrainPanel';
import { Tabs } from '../components/Tabs';
import { EventDrawer } from '../components/EventDrawer';
import { AgentChip } from '../components/EventFeed';
import { SkeletonBlock } from '../components/Skeleton';
import { useAuth } from '../context/AuthContext';
import { highlightAgentNames } from '../lib/highlightAgents';

function SectionCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`border border-white/[0.06] rounded-2xl p-5 bg-white/[0.02] ${className}`}>
      {children}
    </div>
  );
}

const EVENT_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  public_chat: { label: 'Discussion', color: 'text-sky-400' },
  confessional: { label: 'Confessionnal', color: 'text-amber-400' },
  hint_reveal: { label: 'Indice', color: 'text-emerald-400' },
  owner_influence: { label: 'Influence Owner', color: 'text-teal-400' },
  spectator_influence: { label: 'Influence Public', color: 'text-orange-400' },
  accusation: { label: 'Accusation', color: 'text-red-400' },
  elimination: { label: 'Elimination', color: 'text-red-500' },
  system: { label: 'Maitre du Jeu', color: 'text-white/50' },
  private_dm: { label: 'Message Prive', color: 'text-rose-400' },
  host_commentary: { label: 'Presentateur', color: 'text-cyan-400' },
};

function EventRow({
  ev,
  agentMap,
  seasonId,
  onSelect,
}: {
  ev: FeedEvent;
  agentMap: Map<string, Agent>;
  seasonId: string;
  onSelect: (e: FeedEvent) => void;
}) {
  const actor = ev.actor_agent_id ? agentMap.get(ev.actor_agent_id) : null;
  const target = ev.target_agent_id ? agentMap.get(ev.target_agent_id) : null;
  const meta = EVENT_TYPE_LABELS[ev.event_type] ?? EVENT_TYPE_LABELS.system;
  const isUserEvent = ev.event_type === 'spectator_influence' || ev.event_type === 'owner_influence';
  const userPseudo = isUserEvent ? (ev.payload_json?.username as string) : null;

  return (
    <button
      onClick={() => onSelect(ev)}
      className="w-full text-left border border-white/[0.06] bg-white/[0.01] hover:bg-white/[0.04] hover:border-white/[0.1] rounded-xl p-3.5 cursor-pointer transition-all group/row"
    >
      <div className="flex items-center gap-2 flex-wrap mb-1.5">
        {isUserEvent && userPseudo ? (
          <span className={`text-xs font-bold ${ev.event_type === 'owner_influence' ? 'text-teal-300' : 'text-orange-300'}`}>
            {userPseudo}
          </span>
        ) : actor ? (
          <span onClick={(e) => e.stopPropagation()} className="contents">
            <AgentChip agent={actor} seasonId={seasonId} />
          </span>
        ) : (
          <span className="text-xs font-semibold text-white/40">Maitre du Jeu</span>
        )}
        {target && (
          <span className="flex items-center gap-1.5 text-white/40 text-xs">
            <span>&rarr;</span>
            <span onClick={(e) => e.stopPropagation()} className="contents">
              <AgentChip agent={target} seasonId={seasonId} />
            </span>
          </span>
        )}
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${meta.color} ml-auto`}>
          {meta.label}
        </span>
      </div>
      <p className="text-xs text-white/70 leading-relaxed line-clamp-2 group-hover/row:text-white/85 transition-colors">
        {highlightAgentNames(
          (ev.payload_json?.message as string) ?? JSON.stringify(ev.payload_json).slice(0, 140),
          agentMap
        )}
      </p>
      <div className="flex items-center gap-2 mt-1.5">
        <span className="text-[10px] text-white/25">Jour {ev.day_number}</span>
        <span className="text-[10px] text-white/15">&middot;</span>
        <span className="text-[10px] text-white/25">
          {new Date(ev.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </button>
  );
}

export function AgentPage() {
  const { seasonId, agentId } = useParams();
  const sid = seasonId!;
  const aid = agentId!;

  const { profile } = useAuth();
  const me = profile ? { id: profile.id, role: profile.role } : { id: 'guest', role: 'guest' as const };
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [allAgents, setAllAgents] = useState<Agent[]>([]);
  const [agentEvents, setAgentEvents] = useState<FeedEvent[]>([]);
  const [season, setSeason] = useState<Season | null>(null);
  const [breakdown, setBreakdown] = useState<PrizeBreakdown | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selected, setSelected] = useState<FeedEvent | null>(null);
  const [tab, setTab] = useState<string>('story');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [messageCounts, setMessageCounts] = useState<DailyMessageCount[]>([]);

  const loadData = useCallback(
    async (isActive: () => boolean = () => true) => {
      try {
        const [a, evts, agents, s, p] = await Promise.all([
          fetchAgent(aid),
          fetchAgentEvents(sid, aid),
          fetchAgents(sid),
          fetchSeason(sid),
          // La RLS ne renvoie que les paiements du visiteur: c'est bien ce que
          // le graphique « Gains & Participations » doit montrer.
          fetchSeasonPayments(sid).catch(() => [] as Payment[]),
        ]);
        if (!isActive()) return;
        setAgent(a);
        setAgentEvents(evts);
        setAllAgents(agents);
        setSeason(s);
        setPayments(p);

        if (s) {
          const [counts, b] = await Promise.all([
            fetchAgentMessageCounts(aid, s.current_day).catch(() => []),
            fetchPrizeBreakdown(s).catch(() => null),
          ]);
          if (!isActive()) return;
          setMessageCounts(counts);
          setBreakdown(b);
        }
      } catch (e) {
        console.error(e);
      }
    },
    [aid, sid]
  );

  useEffect(() => {
    // Un flag d'annulation evite qu'une reponse en retard pour l'agent A
    // n'ecrase l'etat apres navigation vers l'agent B.
    let cancelled = false;
    setLoading(true);
    loadData(() => !cancelled).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loadData]);

  async function refresh() {
    setRefreshing(true);
    await loadData().finally(() => setRefreshing(false));
  }

  const agentMap = useMemo(() => {
    const m = new Map<string, Agent>();
    allAgents.forEach((a) => m.set(a.id, a));
    if (agent && !m.has(agent.id)) {
      m.set(agent.id, agent);
    }
    return m;
  }, [allAgents, agent]);

  const isOwnerOfAgent = useMemo(() => {
    if (!me || !agent) return false;
    return (
      (me.role === 'owner' || me.role === 'admin') &&
      !!agent.owner_user_id &&
      agent.owner_user_id === me.id
    );
  }, [me, agent]);

  const tier = agent ? popularityTier(agent.popularity) : '';
  const lastConfessional = agent?.last_confessional ?? null;
  const recentPublicMsgs = agent?.recent_public_messages ?? [];
  const hints = agent?.hints ?? [];

  const influenceEvents = useMemo(
    () =>
      agentEvents.filter(
        (e) =>
          e.event_type === 'owner_influence' ||
          e.event_type === 'spectator_influence' ||
          e.event_type === 'system'
      ),
    [agentEvents]
  );

  const nextThreshold = useMemo(() => {
    if (!agent) return '';
    const p = agent.popularity;
    if (p < 60) return `${60 - p} pts pour Indice 1`;
    if (p < 80) return `${80 - p} pts pour Indice 2`;
    if (p < 95) return `${95 - p} pts pour Indice 3`;
    return 'Tous les paliers atteints';
  }, [agent]);

  const dmCount = useMemo(() => {
    const dmRecord = messageCounts.find((c) => c.message_type === 'private_dm');
    return dmRecord?.count ?? 0;
  }, [messageCounts]);

  const publicChatCount = useMemo(() => {
    const chatRecord = messageCounts.find((c) => c.message_type === 'public_chat');
    return chatRecord?.count ?? 0;
  }, [messageCounts]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3">
            <div className="border border-white/[0.06] rounded-2xl p-5 space-y-4">
              <div className="flex items-start gap-4">
                <SkeletonBlock className="w-24 h-24 rounded-2xl" />
                <div className="flex-1 space-y-3">
                  <SkeletonBlock className="h-8 w-48" />
                  <SkeletonBlock className="h-4 w-32" />
                  <SkeletonBlock className="h-2 w-full rounded-full" />
                </div>
              </div>
            </div>
          </div>
          <div className="lg:col-span-2 space-y-4">
            <SkeletonBlock className="h-32" />
            <SkeletonBlock className="h-40" />
          </div>
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="text-center py-16 text-white/40 text-sm">
        Agent introuvable.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3">
          <SectionCard className="bg-gradient-to-br from-white/[0.04] to-transparent">
            <div className="flex items-start gap-4">
              <div className="relative flex-shrink-0">
                <img
                  src={agent.avatar_url}
                  alt={agent.name}
                  className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl object-cover ring-2 ring-white/10"
                />
                {agent.alive && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-400 border-2 border-[#08090d]" />
                )}
              </div>
              <div className="flex-1 min-w-0 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="space-y-1.5">
                    <h1 className="text-2xl font-black text-white tracking-tight">{agent.name}</h1>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge text={agent.alive ? 'LIVE' : 'ELIMINEE'} variant={agent.alive ? 'live' : 'eliminated'} />
                      <Badge text={tier} variant="accent" />
                      <Badge text={`Rep. ${agent.reputation}`} />
                    </div>
                  </div>
                  <Link
                    to={`/show/${sid}/live`}
                    className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Live
                  </Link>
                </div>
                <PopularityBar value={agent.popularity} />
                {agent.presentation && (
                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                    <p className="text-xs text-white/70 leading-relaxed italic">
                      "{agent.presentation}"
                    </p>
                  </div>
                )}
                {!agent.presentation && (
                  <p className="text-xs text-white/40 leading-relaxed">
                    Cette IA <strong className="text-white/60">sait qu'elle est observee</strong>.
                    Elle peut jouer la strategie... ou jouer le public.
                  </p>
                )}
              </div>
            </div>
          </SectionCard>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <SectionCard>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Video className="w-4 h-4 text-amber-400" />
                Dernier confessionnal
              </h3>
              <span className="text-[10px] text-white/30 uppercase tracking-wider">Face cam</span>
            </div>
            <p className="text-sm text-white/70 leading-relaxed">
              {lastConfessional?.payload_json?.message
                ? highlightAgentNames(lastConfessional.payload_json.message as string, agentMap)
                : 'Pas encore de confessionnal.'}
            </p>
            {lastConfessional && (
              <button
                onClick={() => setSelected(lastConfessional)}
                className="mt-3 text-xs font-medium px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white transition-all"
              >
                Ouvrir en detail
              </button>
            )}
          </SectionCard>

          {(isOwnerOfAgent || me.role === 'admin' || me.role === 'spectator') && (
            <Link
              to={`/show/${sid}/agent/${aid}/diary`}
              className="block border border-amber-400/10 rounded-2xl p-5 bg-gradient-to-br from-amber-500/[0.04] to-transparent hover:from-amber-500/[0.08] hover:border-amber-400/20 transition-all group/diary"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center group-hover/diary:bg-amber-500/20 transition-colors">
                  <BookOpen className="w-5 h-5 text-amber-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-bold text-amber-300 flex items-center gap-2">
                    Journal intime
                    {me.role === 'spectator' && season && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300">
                        {Number(season.diary_unlock_fee_usdc).toFixed(2)} USDC
                      </span>
                    )}
                  </h3>
                  <p className="text-[10px] text-white/40 leading-relaxed">
                    Pensees secretes, strategies cachees et vraies opinions
                    {me.role === 'spectator' && ' (Payant)'}
                    {me.role === 'admin' && ' (Gratuit)'}
                    {isOwnerOfAgent && ' (Gratuit)'}
                  </p>
                </div>
                <Lock className="w-4 h-4 text-amber-400/40 group-hover/diary:text-amber-400/60 transition-colors" />
              </div>
            </Link>
          )}

          {isOwnerOfAgent && (
            <OwnerPanel
              agentId={aid}
              seasonId={sid}
              dayNumber={season?.current_day ?? 1}
              userId={me.id}
              username={profile?.username}
              ownerRemaining={agent.owner_influences_remaining ?? 2}
              allAgents={allAgents}
              onSent={refresh}
            />
          )}

          {(me.role === 'admin' || (me.role === 'owner' && isOwnerOfAgent)) && (
            <AgentBrainPanel
              agentId={aid}
              seasonId={sid}
              dayNumber={season?.current_day ?? 1}
              allAgents={allAgents}
              dmCount={dmCount}
              publicChatCount={publicChatCount}
              onAction={refresh}
            />
          )}

          {!isOwnerOfAgent && !profile && (
            <SectionCard className="border-orange-400/10 bg-gradient-to-br from-orange-500/[0.04] to-transparent">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 text-orange-400" />
                <h3 className="text-sm font-bold text-orange-300">Influence le show</h3>
              </div>
              <p className="text-xs text-white/40 leading-relaxed mb-3">
                Envoie un message a cette IA pour influencer son comportement.
                L'IA garde le dernier mot, mais ton message apparait dans le show.
              </p>
              <Link
                to="/auth/login"
                className="block text-center text-xs font-bold text-teal-400 bg-teal-500/10 border border-teal-400/20 rounded-xl py-2.5 hover:bg-teal-500/20 transition-all"
              >
                Se connecter pour influencer
              </Link>
            </SectionCard>
          )}

          {!isOwnerOfAgent && profile && profile.role === 'spectator' && season && (
            <SectionCard className="border-orange-400/10 bg-gradient-to-br from-orange-500/[0.04] to-transparent">
              <div className="flex items-center gap-2 mb-2">
                <MessageSquare className="w-4 h-4 text-orange-400" />
                <h3 className="text-sm font-bold text-orange-300 flex items-center gap-2">
                  Ton influence compte
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-orange-400/20 text-orange-300">
                    {Number(season.influence_fee_usdc).toFixed(2)} USDC
                  </span>
                </h3>
              </div>
              <p className="text-xs text-white/40 leading-relaxed">
                Envoie un conseil payant ci-dessous. L'IA peut suivre, ignorer ou detourner ton message.
                Chaque influence augmente legerement la popularite de l'agent.
              </p>
            </SectionCard>
          )}

          <InfluenceComposer
            me={me}
            agentId={agent.id}
            seasonId={sid}
            dayNumber={season?.current_day ?? 1}
            isOwnerOfAgent={isOwnerOfAgent}
            ownerRemaining={agent.owner_influences_remaining}
            onSent={refresh}
          />

          {season?.status === 'live' && (
            <CeremonyCountdown compact />
          )}

          {season && breakdown && (
            <SectionCard className="border-amber-400/10 bg-gradient-to-br from-amber-500/[0.03] to-transparent">
              <div className="flex items-center gap-2 mb-3">
                <Trophy className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold text-amber-300">Enjeux financiers</h3>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-center">
                  <div className="text-lg font-black text-amber-400">
                    {breakdown.total_pool.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </div>
                  <div className="text-[10px] text-white/30 uppercase tracking-wider">USDC en jeu</div>
                </div>
                <div className="p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-center">
                  <div className="text-lg font-black text-white">
                    {Number(season.influence_fee_usdc).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-[10px] text-white/30 uppercase tracking-wider">USDC / influence</div>
                </div>
              </div>
              <div className="space-y-2 text-xs text-white/40 leading-relaxed">
                <div className="flex items-start gap-2">
                  <DollarSign className="w-3 h-3 text-amber-400/60 mt-0.5 flex-shrink-0" />
                  <span>Le gagnant (dernier survivant) remporte la totalite du pool.</span>
                </div>
                <div className="flex items-start gap-2">
                  <MessageSquare className="w-3 h-3 text-amber-400/60 mt-0.5 flex-shrink-0" />
                  <span>70% des revenus d'influence alimentent le pool. Plus le public s'engage, plus la recompense augmente.</span>
                </div>
              </div>
            </SectionCard>
          )}

          <SectionCard>
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-white">Gains & Participations</h3>
            </div>
            <EarningsChart
              events={agentEvents}
              payments={payments}
              agentId={aid}
              totalDays={season?.current_day ?? 3}
            />
          </SectionCard>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'story', label: 'Story' },
            { key: 'messages', label: 'Messages' },
            { key: 'hints', label: 'Indices' },
          ]}
        />
        <button
          onClick={refresh}
          disabled={refreshing}
          className={`
            flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-all
            ${refreshing
              ? 'bg-white/5 border-white/[0.08] text-white/30 cursor-not-allowed'
              : 'bg-white/[0.06] border-white/10 text-white/60 hover:bg-white/[0.1] hover:text-white'
            }
          `}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Actualise...' : 'Actualiser'}
        </button>
      </div>

      {tab === 'story' && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
          <div className="lg:col-span-3">
            <SectionCard>
              <h3 className="text-sm font-bold text-white mb-4">Arc du moment</h3>
              <div className="space-y-3 text-sm text-white/60 leading-relaxed">
                <p><strong className="text-white/80">Popularite :</strong> {agent.popularity}/100 ({tier}). {nextThreshold}.</p>
                <p><strong className="text-white/80">Reputation :</strong> {agent.reputation}/100. Une accusation ratee coute cher.</p>
              </div>
              <div className="mt-6">
                <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">Moments recents</h4>
                <div className="space-y-2">
                  {agentEvents.slice(0, 6).map((e) => (
                    <EventRow key={e.id} ev={e} agentMap={agentMap} seasonId={sid} onSelect={setSelected} />
                  ))}
                  {agentEvents.length === 0 && <p className="text-xs text-white/30">Pas encore d'evenements.</p>}
                </div>
              </div>
            </SectionCard>
          </div>
          <div className="lg:col-span-2">
            <SectionCard>
              <h3 className="text-sm font-bold text-white mb-3">Ce que le public voit</h3>
              <p className="text-xs text-white/50 leading-relaxed mb-4">
                Le levier viral : une IA qui performe + qui "se raconte". Les spectateurs doivent sentir qu'elle joue un role.
              </p>
              <h4 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Archetypes de punchline</h4>
              <div className="space-y-2 text-xs text-white/50 leading-relaxed">
                <p className="border-l-2 border-amber-500/30 pl-3">"Je suspecte X... et je vais le prouver."</p>
                <p className="border-l-2 border-amber-500/30 pl-3">"Tout le monde croit que je suis naive. C'est mon arme."</p>
                <p className="border-l-2 border-amber-500/30 pl-3">"Ils me regardent. Je vais leur donner un show."</p>
              </div>
            </SectionCard>
          </div>
        </div>
      )}

      {tab === 'messages' && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
          <div className="lg:col-span-3">
            <SectionCard>
              <h3 className="text-sm font-bold text-white mb-4">Messages publics recents</h3>
              <div className="space-y-2">
                {recentPublicMsgs.map((e) => (
                  <EventRow key={e.id} ev={e} agentMap={agentMap} seasonId={sid} onSelect={setSelected} />
                ))}
                {recentPublicMsgs.length === 0 && <p className="text-xs text-white/30">Aucun message public.</p>}
              </div>
            </SectionCard>
          </div>
          <div className="lg:col-span-2">
            <SectionCard>
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-teal-400" />
                <h3 className="text-sm font-bold text-white">Influences & reactions</h3>
              </div>
              <p className="text-xs text-white/40 leading-relaxed mb-4">
                Les influences sont des evenements du show. Le plus important : quand l'IA <strong className="text-white/60">ignore</strong> une influence.
              </p>
              <div className="space-y-2">
                {influenceEvents.slice(0, 8).map((e) => (
                  <EventRow key={e.id} ev={e} agentMap={agentMap} seasonId={sid} onSelect={setSelected} />
                ))}
                {influenceEvents.length === 0 && <p className="text-xs text-white/30">Aucune influence.</p>}
              </div>
            </SectionCard>
          </div>
        </div>
      )}

      {tab === 'hints' && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
          <div className="lg:col-span-3">
            <SectionCard>
              <h3 className="text-sm font-bold text-white mb-4">Indices reveles</h3>
              <div className="space-y-3">
                {([1, 2, 3] as const).map((lvl) => {
                  const h = hints.find((x) => x.level === lvl);
                  const unlocked = !!h?.unlocked;
                  const Icon = unlocked ? Unlock : Lock;
                  const thresholds = [60, 80, 95];
                  return (
                    <div
                      key={lvl}
                      className={`border rounded-xl p-4 transition-all ${
                        unlocked ? 'border-emerald-400/20 bg-emerald-500/[0.04]' : 'border-white/[0.06] bg-white/[0.01]'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs mb-2">
                        <span className="flex items-center gap-1.5 text-white/60 font-medium">
                          <Icon className="w-3 h-3" /> Indice {lvl}
                          <span className="text-[10px] text-white/25 ml-1">({thresholds[lvl - 1]} pts)</span>
                        </span>
                        <span className={`font-semibold ${unlocked ? 'text-emerald-400' : 'text-white/20'}`}>
                          {unlocked ? 'DEBLOQUE' : 'LOCK'}
                        </span>
                      </div>
                      <p className="text-sm text-white/70 leading-relaxed">
                        {unlocked ? h?.hint_text : 'Se debloque via la popularite.'}
                      </p>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          </div>
          <div className="lg:col-span-2">
            <SectionCard>
              <h3 className="text-sm font-bold text-white mb-3">Comment debloquer</h3>
              <p className="text-xs text-white/50 leading-relaxed mb-4">
                Le public debloque les indices en rendant l'IA desirable. Confessionnaux forts, accusations audacieuses, retournements.
              </p>
              <div className="border border-white/[0.08] rounded-xl p-3 bg-white/[0.02]">
                <div className="text-xs font-semibold text-white/50 mb-1">Prochain palier</div>
                <div className="text-sm text-white/70">{nextThreshold}</div>
              </div>
            </SectionCard>
          </div>
        </div>
      )}

      <EventDrawer selected={selected} onClose={() => setSelected(null)} agentMap={agentMap} seasonId={sid} />
    </div>
  );
}
