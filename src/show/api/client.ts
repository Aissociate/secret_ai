import { supabase } from '../lib/supabase';
import {
  isDemoSeason,
  DEMO_SEASON,
  DEMO_AGENTS,
  DEMO_EVENTS,
  DEMO_HINTS,
  DEMO_DIARY_ENTRIES,
  getDemoHintsBoard,
  getDemoSuspicion,
} from '../lib/demoData';
import type {
  Agent,
  AgentBrainAction,
  AgentDetail,
  DailyMessageCount,
  DiaryEntry,
  FeedEvent,
  Hint,
  HostAgentConfig,
  InfluenceRecord,
  Payment,
  PrizeBreakdown,
  Season,
  SeasonHintsBoard,
  SuspicionMatrix,
} from './types';

export async function fetchSeason(seasonId: string): Promise<Season | null> {
  if (isDemoSeason(seasonId)) return DEMO_SEASON;
  const { data, error } = await supabase
    .from('seasons')
    .select('*')
    .eq('id', seasonId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateSeasonStatus(
  seasonId: string,
  status: 'live' | 'paused' | 'ended'
): Promise<void> {
  const { error } = await supabase
    .from('seasons')
    .update({ status })
    .eq('id', seasonId);
  if (error) throw error;
}

export async function fetchAgents(seasonId: string): Promise<Agent[]> {
  if (isDemoSeason(seasonId)) return DEMO_AGENTS;
  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .eq('season_id', seasonId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchAgent(agentId: string): Promise<AgentDetail | null> {
  const demoAgent = DEMO_AGENTS.find((a) => a.id === agentId);
  if (demoAgent) {
    const hints = DEMO_HINTS.filter((h) => h.agent_id === agentId);
    const confessionals = DEMO_EVENTS.filter((e) => e.actor_agent_id === agentId && e.event_type === 'confessional');
    const publicMsgs = DEMO_EVENTS.filter((e) => e.actor_agent_id === agentId && e.event_type === 'public_chat');
    return {
      ...demoAgent,
      hints,
      last_confessional: confessionals[confessionals.length - 1] ?? null,
      recent_public_messages: publicMsgs.slice(-10).reverse(),
    };
  }

  const { data: agent, error } = await supabase
    .from('agents')
    .select('*')
    .eq('id', agentId)
    .maybeSingle();
  if (error) throw error;
  if (!agent) return null;

  const { data: hints } = await supabase
    .from('hints')
    .select('*')
    .eq('agent_id', agentId)
    .order('level', { ascending: true });

  const { data: confessionals } = await supabase
    .from('events')
    .select('*')
    .eq('actor_agent_id', agentId)
    .eq('event_type', 'confessional')
    .eq('visibility', 'public')
    .order('created_at', { ascending: false })
    .limit(1);

  const { data: publicMsgs } = await supabase
    .from('events')
    .select('*')
    .eq('actor_agent_id', agentId)
    .eq('event_type', 'public_chat')
    .eq('visibility', 'public')
    .order('created_at', { ascending: false })
    .limit(10);

  return {
    ...agent,
    hints: (hints ?? []) as Hint[],
    last_confessional: confessionals?.[0] ?? null,
    recent_public_messages: (publicMsgs ?? []) as FeedEvent[],
  };
}

export async function fetchFeed(
  seasonId: string,
  day?: number
): Promise<{ events: FeedEvent[] }> {
  if (isDemoSeason(seasonId)) {
    let events = [...DEMO_EVENTS].reverse();
    if (day) events = events.filter((e) => e.day_number === day);
    return { events };
  }

  let query = supabase
    .from('events')
    .select('*')
    .eq('season_id', seasonId)
    .eq('visibility', 'public')
    .order('created_at', { ascending: false })
    .limit(100);

  if (day) {
    query = query.eq('day_number', day);
  }

  const { data, error } = await query;
  if (error) throw error;
  return { events: (data ?? []) as FeedEvent[] };
}

export async function fetchAgentEvents(
  seasonId: string,
  agentId: string
): Promise<FeedEvent[]> {
  if (isDemoSeason(seasonId)) {
    return [...DEMO_EVENTS]
      .filter((e) => e.actor_agent_id === agentId || e.target_agent_id === agentId)
      .reverse();
  }

  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('season_id', seasonId)
    .eq('visibility', 'public')
    .or(`actor_agent_id.eq.${agentId},target_agent_id.eq.${agentId}`)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as FeedEvent[];
}

export async function fetchHintsBoard(
  seasonId: string
): Promise<SeasonHintsBoard> {
  if (isDemoSeason(seasonId)) return getDemoHintsBoard();

  const agents = await fetchAgents(seasonId);
  const agentIds = agents.map((a) => a.id);

  if (agentIds.length === 0) return [];

  const { data: hints, error } = await supabase
    .from('hints')
    .select('*')
    .in('agent_id', agentIds)
    .order('level', { ascending: true });

  if (error) throw error;

  const hintsMap = new Map<string, Hint[]>();
  for (const h of hints ?? []) {
    const existing = hintsMap.get(h.agent_id) ?? [];
    existing.push(h as Hint);
    hintsMap.set(h.agent_id, existing);
  }

  return agents.map((agent) => ({
    agent,
    hints: hintsMap.get(agent.id) ?? [],
  }));
}

export async function fetchSuspicion(
  seasonId: string
): Promise<SuspicionMatrix> {
  if (isDemoSeason(seasonId)) return getDemoSuspicion();

  const agents = await fetchAgents(seasonId);

  const { data: accusations } = await supabase
    .from('events')
    .select('*')
    .eq('season_id', seasonId)
    .eq('event_type', 'accusation')
    .eq('visibility', 'public');

  const n = agents.length;
  const matrix: number[][] = Array.from({ length: n }, () =>
    Array(n).fill(0)
  );

  const idxMap = new Map(agents.map((a, i) => [a.id, i]));

  for (const ev of accusations ?? []) {
    const srcIdx = idxMap.get(ev.actor_agent_id ?? '');
    const tgtIdx = idxMap.get(ev.target_agent_id ?? '');
    if (srcIdx !== undefined && tgtIdx !== undefined && srcIdx !== tgtIdx) {
      matrix[srcIdx][tgtIdx] = Math.min(
        100,
        matrix[srcIdx][tgtIdx] + 25
      );
    }
  }

  const { data: chats } = await supabase
    .from('events')
    .select('*')
    .eq('season_id', seasonId)
    .eq('event_type', 'public_chat')
    .eq('visibility', 'public');

  for (const ev of chats ?? []) {
    const targets =
      (ev.payload_json as Record<string, unknown>)?.suspicion_targets;
    if (Array.isArray(targets)) {
      const srcIdx = idxMap.get(ev.actor_agent_id ?? '');
      if (srcIdx !== undefined) {
        for (const tid of targets) {
          const tgtIdx = idxMap.get(tid);
          if (tgtIdx !== undefined && srcIdx !== tgtIdx) {
            matrix[srcIdx][tgtIdx] = Math.min(
              100,
              matrix[srcIdx][tgtIdx] + 10
            );
          }
        }
      }
    }
  }

  return { agents, matrix };
}

export async function postOwnerInfluence(
  agentId: string,
  seasonId: string,
  message: string,
  dayNumber: number,
  userId: string,
  username?: string
): Promise<void> {
  const { error } = await supabase.from('events').insert({
    season_id: seasonId,
    day_number: dayNumber,
    event_type: 'owner_influence',
    actor_agent_id: null,
    target_agent_id: agentId,
    actor_user_id: userId,
    payload_json: { message, followed: null, username: username ?? null },
    visibility: 'public',
  });
  if (error) throw error;
}

export async function postSpectatorInfluence(
  agentId: string,
  seasonId: string,
  message: string,
  dayNumber: number,
  userId: string,
  amountUsdc: number,
  username?: string
): Promise<void> {
  const { error: payError } = await supabase.from('payments').insert({
    user_id: userId,
    season_id: seasonId,
    type: 'influence',
    amount_usdc: amountUsdc,
    status: 'pending',
  });
  if (payError) throw payError;

  const { error } = await supabase.from('events').insert({
    season_id: seasonId,
    day_number: dayNumber,
    event_type: 'spectator_influence',
    actor_agent_id: null,
    target_agent_id: agentId,
    actor_user_id: userId,
    payload_json: { message, amount_usdc: amountUsdc, username: username ?? null },
    visibility: 'public',
  });
  if (error) throw error;
}

export async function fetchSeasonPayments(
  seasonId: string
): Promise<Payment[]> {
  if (isDemoSeason(seasonId)) return [];

  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('season_id', seasonId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Payment[];
}

export function computePrizeBreakdown(
  season: Season,
  payments: Payment[]
): PrizeBreakdown {
  const confirmedPayments = payments.filter((p) => p.status === 'confirmed');
  const entryPayments = confirmedPayments.filter((p) => p.type === 'entry');
  const influencePayments = confirmedPayments.filter((p) => p.type === 'influence');

  const entryRevenue = entryPayments.reduce((sum, p) => sum + Number(p.amount_usdc), 0);
  const influenceRevenue = influencePayments.reduce((sum, p) => sum + Number(p.amount_usdc), 0);

  const platformFeeOnEntry = entryRevenue * (season.platform_fee_pct / 100);
  const platformFeeOnInfluence = influenceRevenue * 0.3;
  const platformFeeAmount = platformFeeOnEntry + platformFeeOnInfluence;

  const poolFromEntries = entryRevenue - platformFeeOnEntry;
  const poolFromInfluence = influenceRevenue - platformFeeOnInfluence;
  const totalPool = Math.max(Number(season.prize_pool_usdc), poolFromEntries + poolFromInfluence);

  const winnerShare = totalPool;

  return {
    total_pool: totalPool,
    entry_revenue: entryRevenue,
    influence_revenue: influenceRevenue,
    platform_fee_amount: platformFeeAmount,
    winner_share: winnerShare,
    participants_count: entryPayments.length,
    entry_fee: Number(season.entry_fee_usdc),
    influence_fee: Number(season.influence_fee_usdc),
    platform_fee_pct: season.platform_fee_pct,
  };
}

export async function createEntryPayment(
  userId: string,
  seasonId: string,
  amountUsdc: number
): Promise<void> {
  const { error } = await supabase.from('payments').insert({
    user_id: userId,
    season_id: seasonId,
    type: 'entry',
    amount_usdc: amountUsdc,
    status: 'pending',
  });
  if (error) throw error;
}

export async function fetchUserDmReveals(
  userId: string,
  seasonId: string
): Promise<Set<string>> {
  if (isDemoSeason(seasonId)) return new Set();
  const { data } = await supabase
    .from('dm_reveals')
    .select('event_id')
    .eq('user_id', userId)
    .eq('season_id', seasonId);
  return new Set((data ?? []).map((r: { event_id: string }) => r.event_id));
}

export async function purchaseDmReveal(
  eventId: string,
  userId: string,
  seasonId: string,
  amountUsdc: number
): Promise<void> {
  const { error: payErr } = await supabase.from('payments').insert({
    user_id: userId,
    season_id: seasonId,
    type: 'influence',
    amount_usdc: amountUsdc,
    status: 'pending',
  });
  if (payErr) throw payErr;

  const { error } = await supabase.from('dm_reveals').insert({
    event_id: eventId,
    user_id: userId,
    season_id: seasonId,
    amount_usdc: amountUsdc,
  });
  if (error) throw error;
}

export async function fetchHostConfig(): Promise<HostAgentConfig | null> {
  const { data, error } = await supabase
    .from('host_agent_configs')
    .select('*')
    .is('season_id', null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertHostConfig(
  config: Partial<Omit<HostAgentConfig, 'season_id'>>
): Promise<void> {
  const { data: existing } = await supabase
    .from('host_agent_configs')
    .select('id')
    .is('season_id', null)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('host_agent_configs')
      .update({ ...config, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('host_agent_configs')
      .insert({ ...config, season_id: null });
    if (error) throw error;
  }
}

export async function triggerHostAction(
  seasonId: string,
  action: 'commentary' | 'day_recap' | 'provoke',
  targetAgentName?: string
): Promise<{ message: string }> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/host-agent`;
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      season_id: seasonId,
      action,
      target_agent_name: targetAgentName,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Host agent error');
  return data;
}

export async function fetchDiaryEntries(
  seasonId: string,
  agentId: string
): Promise<DiaryEntry[]> {
  if (isDemoSeason(seasonId)) {
    return DEMO_DIARY_ENTRIES.filter((d) => d.agent_id === agentId);
  }
  const { data, error } = await supabase
    .from('diary_entries')
    .select('*')
    .eq('season_id', seasonId)
    .eq('agent_id', agentId)
    .order('day_number', { ascending: true })
    .order('hour_number', { ascending: true });
  if (error) throw error;
  return (data ?? []) as DiaryEntry[];
}

export async function checkDiaryUnlock(
  userId: string,
  agentId: string,
  seasonId: string
): Promise<boolean> {
  if (isDemoSeason(seasonId)) return true;
  const { data } = await supabase
    .from('diary_unlocks')
    .select('id')
    .eq('user_id', userId)
    .eq('agent_id', agentId)
    .eq('season_id', seasonId)
    .maybeSingle();
  return !!data;
}

export async function purchaseDiaryUnlock(
  userId: string,
  agentId: string,
  seasonId: string,
  amountUsdc: number
): Promise<void> {
  const { error: payErr } = await supabase.from('payments').insert({
    user_id: userId,
    season_id: seasonId,
    type: 'influence',
    amount_usdc: amountUsdc,
    status: 'pending',
  });
  if (payErr) throw payErr;

  const { error } = await supabase.from('diary_unlocks').insert({
    user_id: userId,
    agent_id: agentId,
    season_id: seasonId,
    amount_usdc: amountUsdc,
  });
  if (error) throw error;
}

export async function triggerDiaryGeneration(
  seasonId: string,
  agentId?: string,
  hourNumber?: number
): Promise<{ results: Array<{ agent_id: string; agent_name: string; ok: boolean; error?: string }> }> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-diary`;
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      season_id: seasonId,
      agent_id: agentId,
      hour_number: hourNumber,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Diary generation error');
  return data;
}

export async function fetchInfluenceHistory(
  agentId: string,
  seasonId: string
): Promise<InfluenceRecord[]> {
  if (isDemoSeason(seasonId)) return [];
  const { data, error } = await supabase
    .from('influence_history')
    .select('*')
    .eq('agent_id', agentId)
    .eq('season_id', seasonId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as InfluenceRecord[];
}

export async function triggerAgentBrain(
  seasonId: string,
  agentId: string,
  action: AgentBrainAction,
  extra?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-brain`;
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      season_id: seasonId,
      agent_id: agentId,
      action,
      ...extra,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Agent brain error');
  return data;
}

export async function fetchAgentMessageCounts(
  agentId: string,
  dayNumber: number
): Promise<DailyMessageCount[]> {
  const { data, error } = await supabase
    .from('daily_message_counts')
    .select('*')
    .eq('agent_id', agentId)
    .eq('day_number', dayNumber);
  if (error) throw error;
  return (data || []) as DailyMessageCount[];
}
