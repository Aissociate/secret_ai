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
  | 'host_clue'
  // Produits par la progression de saison (advance_season_day / close_season).
  | 'day_advanced'
  | 'season_ended'
  // Missions secretes et programme de saison.
  | 'mission'
  | 'program';

export type MissionKind = 'social' | 'deception' | 'survival' | 'intel' | 'chaos';

export type Mission = {
  id: string;
  title: string;
  brief: string;
  kind: MissionKind;
  difficulty: number;
  reward_popularity: number;
  reward_reputation: number;
  penalty_reputation: number;
  duration_days: number;
  active: boolean;
  created_at?: string;
  updated_at?: string;
};

export type AgentMission = {
  id: string;
  season_id: string;
  agent_id: string;
  mission_id: string;
  assigned_day: number;
  status: 'active' | 'success' | 'failed';
  resolved_day: number | null;
  resolved_note: string;
  revealed: boolean;
  judged_at?: string | null;
  judge_note?: string;
  created_at: string;
  mission?: Mission | null;
};

export type EventComment = {
  id: string;
  event_id: string;
  season_id: string;
  user_id: string;
  display_name: string;
  author_role?: string;
  body: string;
  created_at: string;
};

export type HallOfFameAgent = {
  config_id: string;
  name: string;
  avatar_url: string | null;
  owner_name: string;
  seasons_played: number;
  crowns: number;
  accusations: number;
  accusations_correct: number;
  accuracy_pct: number | null;
  gains_usdc: number;
  times_unmasked: number;
};

export type HallOfFameOwner = {
  user_id: string;
  display_name: string;
  agents_count: number;
  seasons_played: number;
  crowns: number;
  accusations: number;
  accusations_correct: number;
  accuracy_pct: number | null;
  gains_usdc: number;
};

export type HallOfFameSpectator = {
  user_id: string;
  display_name: string;
  guesses: number;
  guesses_correct: number;
  accuracy_pct: number | null;
  points: number;
  first_bloods: number;
  seasons_played: number;
  comments: number;
  votes: number;
};

export type HallOfFame = {
  agents: HallOfFameAgent[];
  owners: HallOfFameOwner[];
  spectators: HallOfFameSpectator[];
};

export type EvictionStandings = {
  ok: boolean;
  day: number;
  vote_day: boolean;
  agents: Array<{ agent_id: string; name: string; points: number; voters: number }>;
  my_vote: string | null;
};

export type ProgramSlot =
  | 'secret_drop' | 'challenge' | 'confession_room' | 'twist'
  | 'nominations' | 'vote' | 'eviction' | 'custom';

export type ProgramRow = {
  id: string;
  season_id: string;
  day_number: number;
  slot: ProgramSlot;
  title: string;
  description: string;
  status: 'planned' | 'announced' | 'done';
  created_at?: string;
  updated_at?: string;
};

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
  /** Identite durable de l'agent, qui porte son palmares entre saisons. */
  agent_config_id?: string;
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

/**
 * Palmares cumule d'un agent, agrege sur toutes ses saisons.
 * Vue `agent_career`: aucune donnee secrete n'y figure.
 */
export type AgentCareer = {
  config_id: string;
  owner_user_id: string;
  name: string;
  avatar_url: string;
  doctrine: string;
  rating: number;
  seasons_played: number;
  crowns: number;
  finals: number;
  best_popularity: number;
  secrets_cracked: number;
  times_unmasked: number;
  created_at: string;
};

/** Resume de ce qui s'est passe pour les agents d'un proprietaire. */
export type OwnerDigest = {
  ok: boolean;
  has_agents: boolean;
  since?: string;
  agents?: Array<{
    id: string;
    name: string;
    alive: boolean;
    popularity: number;
    reputation: number;
    influences_left: number;
  }>;
  acted?: number;
  accused_by_others?: number;
  eliminations_by?: Array<{ target: string; secret: string; at: string }>;
  eliminated_own?: Array<{ name: string; reason: string; at: string }>;
  hints_revealed?: Array<{ level: string; at: string }>;
  agents_remaining?: number;
  day_advanced?: boolean;
};
