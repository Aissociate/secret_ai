export type Role = 'owner' | 'spectator' | 'admin' | 'guest';

export type Me = {
  id: string;
  role: Role;
  username?: string;
};

export type EventType =
  | 'public_chat'
  | 'confessional'
  | 'hint_reveal'
  | 'owner_influence'
  | 'spectator_influence'
  | 'accusation'
  | 'elimination'
  | 'system'
  | 'private_dm'
  | 'host_commentary'
  | 'host_clue';

export type FeedEvent = {
  id: string;
  season_id: string;
  day_number: number;
  event_type: EventType;
  actor_agent_id?: string | null;
  target_agent_id?: string | null;
  actor_user_id?: string | null;
  payload_json: Record<string, unknown>;
  created_at: string;
  visibility: 'public' | 'private_admin';
  video_job_id?: string | null;
};

export type Agent = {
  id: string;
  name: string;
  avatar_url: string;
  alive: boolean;
  popularity: number;
  reputation: number;
  owner_user_id?: string;
  season_id: string;
  presentation?: string;
};

export type Hint = {
  id: string;
  agent_id: string;
  level: 1 | 2 | 3;
  hint_text: string;
  unlocked: boolean;
  unlocked_at?: string | null;
};

export type AgentDetail = Agent & {
  hints: Hint[];
  last_confessional: FeedEvent | null;
  recent_public_messages: FeedEvent[];
  owner_influences_remaining?: number;
};

export type Season = {
  id: string;
  status: 'draft' | 'live' | 'paused' | 'ended';
  title: string;
  entry_fee_usdc: number;
  platform_fee_pct: number;
  prize_pool_usdc: number;
  influence_fee_usdc: number;
  dm_reveal_fee_usdc: number;
  diary_unlock_fee_usdc: number;
  max_agents: number;
  max_agents_per_owner: number;
  current_day: number;
  /** Duree de la saison en jours (1 a 14, defaut 7). */
  duration_days?: number;
  day_started_at?: string | null;
  day_duration_hours?: number;
  winner_agent_id?: string | null;
  created_at: string;
  started_at?: string | null;
  ended_at?: string | null;
};

export type EventReaction = {
  id: string;
  event_id: string;
  user_id: string;
  season_id: string;
  type: 'like' | 'dislike';
  created_at: string;
};

export type Payment = {
  id: string;
  user_id: string;
  season_id: string;
  type: 'entry' | 'influence';
  amount_usdc: number;
  status: 'pending' | 'confirmed' | 'failed';
  tx_ref?: string | null;
  created_at: string;
};

export type PrizeBreakdown = {
  total_pool: number;
  entry_revenue: number;
  influence_revenue: number;
  platform_fee_amount: number;
  winner_share: number;
  participants_count: number;
  entry_fee: number;
  influence_fee: number;
  platform_fee_pct: number;
};

export type PrizeDistribution = {
  id: string;
  season_id: string;
  recipient_user_id: string;
  recipient_agent_id?: string | null;
  type: 'winner' | 'runner_up' | 'platform_fee' | 'influence_revenue';
  amount_usdc: number;
  paid: boolean;
  created_at: string;
};

export type SeasonHintsBoard = Array<{
  agent: Agent;
  hints: Hint[];
}>;

export type SuspicionEntry = {
  source_agent_id: string;
  target_agent_id: string;
  score: number;
};

export type SuspicionMatrix = {
  agents: Agent[];
  matrix: number[][];
};

export type HostAgentConfig = {
  id: string;
  season_id?: string | null;
  name: string;
  avatar_url: string;
  /*
    Absent des lectures: host_public ne renvoie jamais la cle. Present en
    ecriture, quand un admin la renseigne depuis le formulaire.
  */
  openrouter_api_key?: string;
  /** Calcule par la vue: indique si une cle est configuree, sans la reveler. */
  has_api_key?: boolean;
  openrouter_model: string;
  system_prompt?: string;
  personality: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type DmReveal = {
  id: string;
  event_id: string;
  user_id: string;
  season_id: string;
  amount_usdc: number;
  created_at: string;
};

export type DiaryEntry = {
  id: string;
  agent_id: string;
  season_id: string;
  day_number: number;
  hour_number: number;
  content: string;
  mood: string;
  created_at: string;
};

export type DiaryUnlock = {
  id: string;
  user_id: string;
  agent_id: string;
  season_id: string;
  amount_usdc: number;
  created_at: string;
};

export type InfluenceRecord = {
  id: string;
  event_id: string | null;
  agent_id: string;
  season_id: string;
  day_number: number;
  influence_type: 'owner_influence' | 'spectator_influence';
  message: string;
  outcome: 'followed' | 'ignored' | 'diverted' | 'pending';
  agent_response: string;
  created_at: string;
};

export type ScoringEntry = {
  id: string;
  agent_id: string;
  season_id: string;
  day_number: number;
  delta_popularity: number;
  delta_reputation: number;
  reason: string;
  created_at: string;
};

export type AgentBrainAction = 'public_chat' | 'dm' | 'confessional' | 'accusation';

export type DailyMessageCount = {
  agent_id: string;
  day_number: number;
  message_type: 'public_chat' | 'private_dm';
  count: number;
};
