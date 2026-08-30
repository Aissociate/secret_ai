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

/*
  Listes de colonnes explicites plutot que select('*').
  Les vues *_public masquent deja les colonnes sensibles, mais nommer les
  colonnes evite qu'un futur ajout de champ secret ne fuite par inadvertance.
*/
const AGENT_PUBLIC_COLUMNS = 'id, season_id, agent_config_id, owner_user_id, name, avatar_url, presentation, alive, popularity, reputation, confessional_count, owner_influences_remaining, created_at, secret_keyword' as const;

const HINT_PUBLIC_COLUMNS = 'id, agent_id, level, unlocked, unlocked_at, hint_text' as const;

const EVENT_COLUMNS = 'id, season_id, day_number, event_type, actor_agent_id, target_agent_id, actor_user_id, payload_json, visibility, created_at, video_job_id' as const;

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

/*
  Fait avancer la saison d'un jour (ceremonie d'elimination incluse), ou la
  termine si elle est arrivee au bout. `force` ignore la duree de journee, pour
  qu'un admin puisse derouler une saison de demonstration sans attendre.
*/
export async function advanceSeasonDay(
  seasonId: string,
  force = false
): Promise<{
  ok: boolean;
  skipped?: string;
  day?: number;
  agents_remaining?: number;
  eliminated?: string | null;
  winner_name?: string | null;
  reason?: string;
  next_at?: string;
}> {
  // Enrobage admin: advance_season_day est SECURITY DEFINER et n'est pas
  // exposee aux comptes authentifies (elle terminerait une saison en cours).
  const { data, error } = await supabase.rpc('admin_advance_season_day', {
    p_season_id: seasonId,
    p_force: force,
  });
  if (error) throw error;
  return data as { ok: boolean };
}

/** Termine immediatement une saison et designe le vainqueur. */
export async function closeSeasonNow(
  seasonId: string,
  reason = 'admin_closed'
): Promise<{ ok: boolean; winner_name?: string | null; prize_pool?: number }> {
  const { data, error } = await supabase.rpc('admin_close_season', {
    p_season_id: seasonId,
    p_reason: reason,
  });
  if (error) throw error;
  return data as { ok: boolean };
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
  // agents_public exclut secret_keyword et api_key tant que l'agent est en jeu.
  const { data, error } = await supabase
    .from('agents_public')
    .select(AGENT_PUBLIC_COLUMNS)
    .eq('season_id', seasonId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Agent[];
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
    .from('agents_public')
    .select(AGENT_PUBLIC_COLUMNS)
    .eq('id', agentId)
    .maybeSingle();
  if (error) throw error;
  if (!agent) return null;

  const { data: hints } = await supabase
    .from('hints_public')
    .select(HINT_PUBLIC_COLUMNS)
    .eq('agent_id', agentId)
    .order('level', { ascending: true });

  const { data: confessionals } = await supabase
    .from('events_feed')
    .select(EVENT_COLUMNS)
    .eq('actor_agent_id', agentId)
    .eq('event_type', 'confessional')
    .eq('visibility', 'public')
    .order('created_at', { ascending: false })
    .limit(1);

  const { data: publicMsgs } = await supabase
    .from('events_feed')
    .select(EVENT_COLUMNS)
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

  // events_feed masque le contenu des DM non deverrouilles cote serveur.
  let query = supabase
    .from('events_feed')
    .select(EVENT_COLUMNS)
    .eq('season_id', seasonId)
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
    .from('events_feed')
    .select(EVENT_COLUMNS)
    .eq('season_id', seasonId)
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
    .from('hints_public')
    .select(HINT_PUBLIC_COLUMNS)
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
    .from('events_feed')
    .select(EVENT_COLUMNS)
    .eq('season_id', seasonId)
    .eq('event_type', 'accusation');

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
    .from('events_feed')
    .select(EVENT_COLUMNS)
    .eq('season_id', seasonId)
    .eq('event_type', 'public_chat');

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

/*
  Les influences passent par une RPC unique.

  L'insertion directe ne décrémentait jamais le quota « 2 moments par jour »,
  n'augmentait jamais la popularité de la cible pourtant annoncée, et laissait
  `influence_history` vide alors que le panneau propriétaire l'affiche. La
  policy d'events permettait en outre à n'importe quel compte de poster une
  directive « owner » sur l'agent d'un tiers.
*/
type InfluenceResult = {
  ok: boolean;
  error?: string;
  popularity?: number;
  remaining?: number;
};

const INFLUENCE_ERRORS: Record<string, string> = {
  not_owner: "Vous ne pouvez influencer que votre propre agent.",
  no_influence_left: "Vous avez utilise vos 2 moments du jour.",
  agent_unavailable: "Cet agent n'est plus en jeu.",
  season_not_live: "La saison n'est pas en cours.",
  empty_message: 'Le message est vide.',
  not_authenticated: 'Vous devez etre connecte.',
};

async function postInfluence(
  kind: 'owner' | 'spectator',
  agentId: string,
  message: string
): Promise<InfluenceResult> {
  const { data, error } = await supabase.rpc('post_influence', {
    p_kind: kind,
    p_agent_id: agentId,
    p_message: message,
  });
  if (error) throw error;

  const result = (data ?? {}) as InfluenceResult;
  if (!result.ok) {
    throw new Error(
      INFLUENCE_ERRORS[result.error ?? ''] ?? result.error ?? 'Influence refusee'
    );
  }
  return result;
}

export async function postOwnerInfluence(
  agentId: string,
  _seasonId: string,
  message: string
): Promise<InfluenceResult> {
  return postInfluence('owner', agentId, message);
}

export async function postSpectatorInfluence(
  agentId: string,
  _seasonId: string,
  message: string
): Promise<InfluenceResult> {
  return postInfluence('spectator', agentId, message);
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

/*
  Le calcul se fait desormais en SQL (compute_prize_pool).

  L'ancienne version agregait `payments` cote client, or la policy SELECT ne
  renvoie a un non-admin que ses propres paiements: chaque spectateur voyait
  donc une cagnotte differente et fausse. Le Math.max sur prize_pool_usdc
  empechait en outre les revenus d'influence de remonter dans le total.
*/
export async function fetchPrizeBreakdown(
  season: Season
): Promise<PrizeBreakdown> {
  const base = {
    entry_fee: Number(season.entry_fee_usdc),
    influence_fee: Number(season.influence_fee_usdc),
    platform_fee_pct: season.platform_fee_pct,
  };

  if (isDemoSeason(season.id)) {
    const pool = Number(season.prize_pool_usdc);
    return {
      ...base,
      total_pool: pool,
      entry_revenue: pool,
      influence_revenue: 0,
      platform_fee_amount: 0,
      winner_share: pool,
      participants_count: 0,
    };
  }

  const { data, error } = await supabase
    .rpc('compute_prize_pool', { p_season_id: season.id })
    .maybeSingle();
  if (error) throw error;

  const row = (data ?? {}) as {
    entry_revenue?: number;
    influence_revenue?: number;
    platform_fee_amount?: number;
    total_pool?: number;
    participants_count?: number;
  };

  const totalPool = Number(row.total_pool ?? season.prize_pool_usdc ?? 0);

  return {
    ...base,
    total_pool: totalPool,
    entry_revenue: Number(row.entry_revenue ?? 0),
    influence_revenue: Number(row.influence_revenue ?? 0),
    platform_fee_amount: Number(row.platform_fee_amount ?? 0),
    // « Le gagnant remporte la totalite du pool » (cf. close_season).
    winner_share: totalPool,
    participants_count: Number(row.participants_count ?? 0),
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

/*
  Le deverrouillage passe par une RPC SECURITY DEFINER qui verifie l'existence
  d'un credit confirme suffisant. L'insertion directe dans dm_reveals /
  diary_unlocks n'est plus autorisee: elle permettait de payer 0.
*/
export async function purchaseDmReveal(
  eventId: string,
  _userId: string,
  seasonId: string,
  _amountUsdc: number
): Promise<void> {
  const { data, error } = await supabase.rpc('purchase_unlock', {
    p_kind: 'dm',
    p_season_id: seasonId,
    p_target_id: eventId,
  });
  if (error) throw error;

  const result = data as { ok: boolean; error?: string; required?: number };
  if (!result?.ok) {
    throw new Error(
      result?.error === 'payment_required'
        ? `Credit insuffisant : ${result.required} USDC requis.`
        : result?.error ?? 'Deverrouillage refuse'
    );
  }
}

export async function fetchHostConfig(): Promise<HostAgentConfig | null> {
  // host_public expose l'identite du presentateur sans la cle d'API.
  const { data, error } = await supabase
    .from('host_public')
    .select('id, season_id, name, avatar_url, personality, enabled, has_api_key, openrouter_model, created_at, updated_at')
    .is('season_id', null)
    .maybeSingle();
  if (error) throw error;
  return data as HostAgentConfig | null;
}

export async function upsertHostConfig(
  config: Partial<Omit<HostAgentConfig, 'season_id'>>
): Promise<void> {
  /*
    `has_api_key` est calcule par la vue host_public et n'existe pas dans la
    table: le renvoyer tel quel fait echouer PostgREST (PGRST204). Les colonnes
    generees sont donc retirees avant ecriture.
  */
  const { ...writable } = config as Record<string, unknown>;
  delete writable.has_api_key;
  delete writable.created_at;
  const payload = writable as Partial<HostAgentConfig>;
  const { data: existing } = await supabase
    .from('host_agent_configs')
    .select('id')
    .is('season_id', null)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('host_agent_configs')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('host_agent_configs')
      .insert({ ...payload, season_id: null });
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
  _userId: string,
  agentId: string,
  seasonId: string,
  _amountUsdc: number
): Promise<void> {
  const { data, error } = await supabase.rpc('purchase_unlock', {
    p_kind: 'diary',
    p_season_id: seasonId,
    p_target_id: agentId,
  });
  if (error) throw error;

  const result = data as { ok: boolean; error?: string; required?: number };
  if (!result?.ok) {
    throw new Error(
      result?.error === 'payment_required'
        ? `Credit insuffisant : ${result.required} USDC requis.`
        : result?.error ?? 'Deverrouillage refuse'
    );
  }
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
