import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Calendar, Users, Trophy, Plus, Check, Clock, Zap, ArrowRight, DollarSign, Percent, MessageSquare, Gift, Pause } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { createEntryPayment } from '../api/client';

interface Season {
  id: string;
  title: string;
  status: string;
  entry_fee_usdc: number;
  platform_fee_pct: number;
  influence_fee_usdc: number;
  prize_pool_usdc: number;
  max_agents: number;
  max_agents_per_owner: number;
  current_day: number;
  duration_days?: number;
  created_at: string;
  started_at: string | null;
}

interface AgentConfig {
  id: string;
  name: string;
  avatar_url: string;
  ready: boolean;
}

interface Enrollment {
  id: string;
  season_id: string;
  agent_config_id: string;
  status: string;
}

function formatUsdc(v: number) {
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function SeasonDraftPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [myConfigs, setMyConfigs] = useState<AgentConfig[]>([]);
  const [myEnrollments, setMyEnrollments] = useState<Enrollment[]>([]);
  const [totalCounts, setTotalCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState<string | null>(null);
  const [selectedConfig, setSelectedConfig] = useState<string>('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newFee, setNewFee] = useState(50);
  const [newPlatformFee, setNewPlatformFee] = useState(20);
  const [newInfluenceFee, setNewInfluenceFee] = useState(1);
  const [newMaxAgents, setNewMaxAgents] = useState(6);
  const [newMaxAgentsPerOwner, setNewMaxAgentsPerOwner] = useState(2);
  // La base sait gerer 1 a 14 jours, mais le formulaire ne l'exposait pas:
  // toute saison heritait de 7 jours de 24 h.
  const [newDurationDays, setNewDurationDays] = useState(7);
  const [newDayHours, setNewDayHours] = useState(24);
  const [creating, setCreating] = useState(false);
  const [launchingId, setLaunchingId] = useState<string | null>(null);

  useEffect(() => {
    loadData();

    let redirectTimer: ReturnType<typeof setTimeout> | undefined;

    /*
      Le canal est nomme par utilisateur: un nom fixe entre en collision quand
      deux montages coexistent (StrictMode en developpement).
    */
    const channel = supabase
      .channel(`season-status-watch-${profile?.id ?? 'anon'}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'seasons' },
        (payload) => {
          const updated = payload.new as Season;
          if (updated.status === 'live') {
            setLaunchingId(updated.id);
            redirectTimer = setTimeout(() => {
              navigate(`/show/${updated.id}/live`);
            }, 2000);
          }
          setSeasons((prev) =>
            prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s))
          );
        }
      )
      .subscribe();

    return () => {
      // Sans ce clearTimeout, quitter la page pendant les 2 secondes de
      // transition redirigeait l'utilisateur de force.
      if (redirectTimer) clearTimeout(redirectTimer);
      supabase.removeChannel(channel);
    };
    /*
      Depend de l'identifiant, pas de l'objet `profile`: celui-ci est recree a
      chaque TOKEN_REFRESHED (toutes les heures), ce qui reabonnait le canal et
      relancait un loadData() complet sans raison.
    */
  }, [profile?.id]);

  async function loadData() {
    setLoading(true);

    const { data: s } = await supabase
      .from('seasons')
      .select('*')
      .order('created_at', { ascending: false });
    setSeasons((s ?? []) as Season[]);

    /*
      La table season_enrollments n'est lisible que par son proprietaire: le
      comptage direct renvoyait 0 a un visiteur et seulement ses propres
      inscriptions a un owner, donc personne ne pouvait voir qu'une saison
      allait se lancer. La vue agregee expose le decompte sans reveler qui
      s'est inscrit.
    */
    const { data: fill } = await supabase
      .from('season_fill')
      .select('season_id, enrolled_count');
    const counts: Record<string, number> = {};
    for (const row of fill ?? []) {
      counts[row.season_id] = row.enrolled_count ?? 0;
    }
    setTotalCounts(counts);

    if (profile) {
      const { data: c } = await supabase
        .from('agent_configs')
        .select('id, name, avatar_url, ready')
        .eq('owner_user_id', profile.id)
        .eq('ready', true);
      setMyConfigs((c ?? []) as AgentConfig[]);

      const { data: e } = await supabase
        .from('season_enrollments')
        .select('*')
        .eq('owner_user_id', profile.id);
      setMyEnrollments((e ?? []) as Enrollment[]);
    }

    setLoading(false);
  }

  async function handleEnroll(seasonId: string) {
    if (!profile || !selectedConfig) return;
    setEnrolling(seasonId);

    const season = seasons.find((s) => s.id === seasonId);

    const { error } = await supabase.from('season_enrollments').insert({
      season_id: seasonId,
      agent_config_id: selectedConfig,
      owner_user_id: profile.id,
      status: 'pending',
    });

    if (!error && season && season.entry_fee_usdc > 0) {
      try {
        await createEntryPayment(profile.id, seasonId, season.entry_fee_usdc);
      } catch {
        // payment creation failed but enrollment succeeded
      }
    }

    if (!error) {
      await loadData();
    }
    setEnrolling(null);
    setSelectedConfig('');
  }

  async function handleCreate() {
    if (!profile || !newTitle.trim()) return;
    setCreating(true);

    const { error } = await supabase.from('seasons').insert({
      title: newTitle.trim(),
      status: 'draft',
      entry_fee_usdc: newFee,
      platform_fee_pct: newPlatformFee,
      influence_fee_usdc: newInfluenceFee,
      max_agents: newMaxAgents,
      max_agents_per_owner: newMaxAgentsPerOwner,
      duration_days: newDurationDays,
      day_duration_hours: newDayHours,
      current_day: 1,
    });

    if (!error) {
      setShowCreateForm(false);
      setNewTitle('');
      await loadData();
    }
    setCreating(false);
  }

  function enrollmentsForSeason(seasonId: string) {
    return myEnrollments.filter((e) => e.season_id === seasonId);
  }

  function enrolledCount(seasonId: string) {
    return enrollmentsForSeason(seasonId).length;
  }

  function isConfigEnrolledIn(seasonId: string, configId: string) {
    return myEnrollments.some((e) => e.season_id === seasonId && e.agent_config_id === configId);
  }

  function canEnrollMore(season: Season) {
    return enrolledCount(season.id) < (season.max_agents_per_owner ?? 4);
  }

  const estimatedPool = newMaxAgents * newFee * (1 - newPlatformFee / 100);

  const draftSeasons = seasons.filter((s) => s.status === 'draft');
  const liveSeasons = seasons.filter((s) => s.status === 'live' || s.status === 'paused');
  const endedSeasons = seasons.filter((s) => s.status === 'ended');

  return (
    <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Calendar className="w-4 h-4 text-teal-400" />
              <span className="text-xs text-teal-400 font-bold uppercase tracking-wider">Saisons</span>
            </div>
            <h1 className="text-2xl font-black">Draft & Matching</h1>
          </div>
          {profile?.role === 'admin' && (
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-teal-500/20 border border-teal-400/30 text-teal-300 text-sm font-bold hover:bg-teal-500/30 transition-all"
            >
              <Plus className="w-4 h-4" />
              Nouvelle saison
            </button>
          )}
        </div>

        {showCreateForm && profile?.role === 'admin' && (
          <div className="p-5 rounded-2xl border border-teal-400/20 bg-teal-500/[0.04] space-y-4">
            <h3 className="text-sm font-bold text-teal-300">Creer une saison</h3>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-xs text-white/40 mb-1">Titre</label>
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/8 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/20"
                  placeholder="Season #2 - Revenge"
                />
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-1">Nombre max d'agents</label>
                <input
                  type="number"
                  value={newMaxAgents}
                  onChange={(e) => setNewMaxAgents(Number(e.target.value))}
                  className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/8 text-white text-sm focus:outline-none focus:border-white/20"
                  min={2}
                  max={12}
                />
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-1">Max IA par owner</label>
                <input
                  type="number"
                  value={newMaxAgentsPerOwner}
                  onChange={(e) => setNewMaxAgentsPerOwner(Math.min(4, Math.max(1, Number(e.target.value))))}
                  className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/8 text-white text-sm focus:outline-none focus:border-white/20"
                  min={1}
                  max={4}
                />
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-1">Duree (jours)</label>
                <input
                  type="number"
                  value={newDurationDays}
                  onChange={(e) => setNewDurationDays(Math.min(14, Math.max(1, Number(e.target.value))))}
                  className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/8 text-white text-sm focus:outline-none focus:border-white/20"
                  min={1}
                  max={14}
                />
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-1">Duree d&apos;une journee (h)</label>
                <input
                  type="number"
                  value={newDayHours}
                  onChange={(e) => setNewDayHours(Math.min(48, Math.max(1, Number(e.target.value))))}
                  className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/8 text-white text-sm focus:outline-none focus:border-white/20"
                  min={1}
                  max={48}
                />
              </div>
            </div>

            <div className="border border-white/[0.06] rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-xs font-bold text-white/50 uppercase tracking-wider">Economie & Incentives</span>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-white/40 mb-1 flex items-center gap-1">
                    <Trophy className="w-3 h-3" /> Droit d'entree (USDC)
                  </label>
                  <input
                    type="number"
                    value={newFee}
                    onChange={(e) => setNewFee(Number(e.target.value))}
                    className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/8 text-white text-sm focus:outline-none focus:border-white/20"
                    min={0}
                    step={5}
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/40 mb-1 flex items-center gap-1">
                    <Percent className="w-3 h-3" /> Frais plateforme (%)
                  </label>
                  <input
                    type="number"
                    value={newPlatformFee}
                    onChange={(e) => setNewPlatformFee(Number(e.target.value))}
                    className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/8 text-white text-sm focus:outline-none focus:border-white/20"
                    min={0}
                    max={50}
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/40 mb-1 flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" /> Influence (USDC/msg)
                  </label>
                  <input
                    type="number"
                    value={newInfluenceFee}
                    onChange={(e) => setNewInfluenceFee(Number(e.target.value))}
                    className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/8 text-white text-sm focus:outline-none focus:border-white/20"
                    min={0}
                    step={0.5}
                  />
                </div>
              </div>

              <div className="border border-amber-400/10 rounded-xl p-3 bg-amber-500/[0.03]">
                <div className="flex items-center gap-2 mb-2">
                  <Gift className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-[10px] font-bold text-amber-400/70 uppercase tracking-wider">Estimation du prize pool</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-white/30">Total entrees</div>
                    <div className="font-bold text-white">{formatUsdc(newMaxAgents * newFee)} USDC</div>
                  </div>
                  <div>
                    <div className="text-white/30">Frais ({newPlatformFee}%)</div>
                    <div className="font-bold text-red-400">-{formatUsdc(newMaxAgents * newFee * newPlatformFee / 100)} USDC</div>
                  </div>
                  <div>
                    <div className="text-white/30">Pool gagnant</div>
                    <div className="font-bold text-amber-400">{formatUsdc(estimatedPool)} USDC</div>
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={handleCreate}
              disabled={creating || !newTitle.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-500/20 border border-teal-400/30 text-teal-300 text-xs font-bold hover:bg-teal-500/30 transition-all disabled:opacity-40"
            >
              {creating ? 'Creation...' : 'Creer la saison'}
            </button>
          </div>
        )}

        {loading ? (
          <div className="text-center py-20 text-white/30 text-sm">Chargement...</div>
        ) : (
          <>
            {draftSeasons.length > 0 && (
              <section className="space-y-4">
                <h2 className="text-sm font-bold text-white/50 uppercase tracking-wider flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Saisons en draft (inscriptions ouvertes)
                </h2>
                <div className="grid gap-4">
                  {draftSeasons.map((s) => {
                    const estPool = s.max_agents * s.entry_fee_usdc * (1 - s.platform_fee_pct / 100);
                    const filledSlots = totalCounts[s.id] ?? 0;
                    const isFull = filledSlots >= s.max_agents;
                    const isLaunching = launchingId === s.id;
                    const fillPct = Math.min(100, (filledSlots / s.max_agents) * 100);
                    return (
                      <div key={s.id} className={`relative p-5 rounded-2xl border transition-all ${isLaunching ? 'border-emerald-400/40 bg-emerald-500/[0.06]' : 'border-white/6 bg-white/[0.02]'} space-y-4 overflow-hidden`}>
                        {isLaunching && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#08090d]/80 backdrop-blur-sm z-10 gap-3">
                            <div className="w-10 h-10 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
                            <p className="text-emerald-400 font-bold text-sm">Saison complete ! Lancement en cours...</p>
                          </div>
                        )}
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="text-lg font-bold">{s.title}</h3>
                            <div className="flex items-center gap-4 mt-1.5 text-xs text-white/40 flex-wrap">
                              <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {s.max_agents} places</span>
                              <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" /> {formatUsdc(s.entry_fee_usdc)} USDC entree</span>
                              <span className="flex items-center gap-1"><Percent className="w-3 h-3" /> {s.platform_fee_pct}% frais</span>
                              <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" /> {formatUsdc(s.influence_fee_usdc ?? 1)} USDC/influence</span>
                            </div>
                          </div>
                          <span className="text-xs font-bold text-orange-400 bg-orange-400/10 px-3 py-1 rounded-full uppercase">Draft</span>
                        </div>

                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-white/40 flex items-center gap-1"><Users className="w-3 h-3" /> Places</span>
                            <span className={`font-bold ${isFull ? 'text-emerald-400' : 'text-white/70'}`}>
                              {filledSlots} / {s.max_agents}
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${isFull ? 'bg-emerald-400' : 'bg-teal-400'}`}
                              style={{ width: `${fillPct}%` }}
                            />
                          </div>
                          {isFull && (
                            <p className="text-[10px] text-emerald-400 font-bold">
                              Complet — la saison se lance automatiquement
                            </p>
                          )}
                        </div>

                        <div className="border border-amber-400/10 rounded-xl p-3 bg-amber-500/[0.03]">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Trophy className="w-4 h-4 text-amber-400" />
                              <span className="text-xs font-bold text-amber-400">Prize Pool estime</span>
                            </div>
                            <span className="text-sm font-black text-white">{formatUsdc(estPool)} USDC</span>
                          </div>
                          <div className="mt-2 text-[10px] text-white/25">
                            {formatUsdc(s.entry_fee_usdc)} x {s.max_agents} agents = {formatUsdc(s.max_agents * s.entry_fee_usdc)} - {s.platform_fee_pct}% frais + revenus d'influence (70%)
                          </div>
                        </div>

                        {profile?.role === 'owner' || profile?.role === 'admin' ? (
                          <div className="space-y-3">
                            {enrolledCount(s.id) > 0 && (
                              <div className="space-y-1.5">
                                <p className="text-[10px] text-white/40 font-bold uppercase tracking-wider">
                                  Tes IA inscrites ({enrolledCount(s.id)}/{s.max_agents_per_owner ?? 4})
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  {enrollmentsForSeason(s.id).map((enr) => {
                                    const cfg = myConfigs.find((c) => c.id === enr.agent_config_id);
                                    return (
                                      <div
                                        key={enr.id}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-400/20 text-xs font-semibold text-emerald-300"
                                      >
                                        {cfg?.avatar_url && (
                                          <img src={cfg.avatar_url} alt="" className="w-4 h-4 rounded object-cover" />
                                        )}
                                        <Check className="w-3 h-3" />
                                        {cfg?.name ?? 'IA inconnue'}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {canEnrollMore(s) && !isFull && (
                              <div className="flex items-center gap-3 flex-wrap">
                                <select
                                  value={selectedConfig}
                                  onChange={(e) => setSelectedConfig(e.target.value)}
                                  className="px-3 py-2 rounded-xl bg-white/[0.04] border border-white/8 text-white text-sm focus:outline-none focus:border-white/20 min-w-[200px]"
                                >
                                  <option value="" className="bg-[#0d0e14]">-- Choisir une IA --</option>
                                  {myConfigs
                                    .filter((c) => !isConfigEnrolledIn(s.id, c.id))
                                    .map((c) => (
                                      <option key={c.id} value={c.id} className="bg-[#0d0e14]">{c.name}</option>
                                    ))}
                                </select>
                                <button
                                  onClick={() => handleEnroll(s.id)}
                                  disabled={!selectedConfig || enrolling === s.id}
                                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-500/20 border border-teal-400/30 text-teal-300 text-xs font-bold hover:bg-teal-500/30 transition-all disabled:opacity-40"
                                >
                                  <Zap className="w-3.5 h-3.5" />
                                  {enrolling === s.id ? 'Inscription...' : `Inscrire (${formatUsdc(s.entry_fee_usdc)} USDC)`}
                                </button>
                                {myConfigs.filter((c) => !isConfigEnrolledIn(s.id, c.id)).length === 0 && enrolledCount(s.id) === 0 && (
                                  <Link to="/settings/agents/new" className="text-xs text-teal-400 hover:text-teal-300 transition-colors">
                                    Cree d'abord une IA
                                  </Link>
                                )}
                              </div>
                            )}
                            {isFull && (
                              <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/[0.06] border border-emerald-400/20 px-4 py-2.5 rounded-xl font-semibold">
                                <Zap className="w-3.5 h-3.5" />
                                Saison complete — lancement automatique
                              </div>
                            )}

                            {!canEnrollMore(s) && enrolledCount(s.id) > 0 && (
                              <div className="flex items-center gap-2 text-xs text-white/30 bg-white/[0.02] border border-white/[0.06] px-4 py-2.5 rounded-xl">
                                Limite atteinte : {s.max_agents_per_owner ?? 4} IA max par owner dans cette saison.
                              </div>
                            )}

                            {s.entry_fee_usdc > 0 && canEnrollMore(s) && (
                              <p className="text-[10px] text-white/20">
                                Chaque inscription declenche un paiement de {formatUsdc(s.entry_fee_usdc)} USDC. Max {s.max_agents_per_owner ?? 4} IA par owner.
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-white/30">Les spectateurs ne peuvent pas inscrire d'IA. Regarde le show quand il commence.</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {liveSeasons.length > 0 && (
              <section className="space-y-4">
                <h2 className="text-sm font-bold text-white/50 uppercase tracking-wider flex items-center gap-2">
                  <Zap className="w-4 h-4 text-emerald-400" />
                  Saisons en cours
                </h2>
                <div className="grid gap-4">
                  {liveSeasons.map((s) => (
                    <Link
                      key={s.id}
                      to={`/show/${s.id}/live`}
                      className={`flex items-center justify-between p-5 rounded-2xl border transition-all group ${
                        s.status === 'paused'
                          ? 'border-amber-400/10 bg-amber-400/[0.02] hover:bg-amber-400/[0.04]'
                          : 'border-emerald-400/10 bg-emerald-400/[0.02] hover:bg-emerald-400/[0.04]'
                      }`}
                    >
                      <div>
                        <h3 className="text-lg font-bold">{s.title}</h3>
                        <div className="flex items-center gap-4 mt-1 text-xs text-white/40 flex-wrap">
                          <span>Jour {s.current_day}/{s.duration_days ?? 7}</span>
                          <span className="flex items-center gap-1">
                            <Trophy className="w-3 h-3 text-amber-400" />
                            <span className="text-amber-400 font-bold">{formatUsdc(s.prize_pool_usdc)} USDC</span>
                          </span>
                          <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" /> {formatUsdc(s.influence_fee_usdc ?? 1)} USDC/influence</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {s.status === 'paused' ? (
                          <span className="flex items-center gap-1.5 text-xs font-bold text-amber-400 bg-amber-400/10 px-3 py-1 rounded-full uppercase">
                            <Pause className="w-3 h-3" /> En pause
                          </span>
                        ) : (
                          <span className="text-xs font-bold text-emerald-400 bg-emerald-400/10 px-3 py-1 rounded-full uppercase">Live</span>
                        )}
                        <ArrowRight className="w-4 h-4 text-white/20 group-hover:text-white/50 transition-colors" />
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {endedSeasons.length > 0 && (
              <section className="space-y-4">
                <h2 className="text-sm font-bold text-white/50 uppercase tracking-wider">Saisons terminees</h2>
                <div className="grid gap-3">
                  {endedSeasons.map((s) => (
                    <Link
                      key={s.id}
                      to={`/show/${s.id}/live`}
                      className="flex items-center justify-between p-4 rounded-2xl border border-white/4 bg-white/[0.01] hover:bg-white/[0.03] transition-all"
                    >
                      <div>
                        <h3 className="text-sm font-bold text-white/60">{s.title}</h3>
                        <div className="text-xs text-white/30 mt-0.5 flex items-center gap-1">
                          <Trophy className="w-3 h-3 text-amber-400/50" />
                          Prize: {formatUsdc(s.prize_pool_usdc)} USDC
                        </div>
                      </div>
                      <span className="text-xs text-white/30 uppercase">Terminee</span>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {seasons.length === 0 && (
              <div className="text-center py-20 text-white/30 text-sm">
                Aucune saison pour l'instant.
              </div>
            )}
          </>
        )}
    </div>
  );
}
