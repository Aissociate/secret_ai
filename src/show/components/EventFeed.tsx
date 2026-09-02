import { Link, useParams } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { ArrowRight, Lock, Mic, User, Film, ThumbsUp, ThumbsDown, Share2, Check, Eye } from 'lucide-react';
import type { Agent, FeedEvent, Season } from '../api/types';
import { highlightAgentNames } from '../lib/highlightAgents';
import { metaFor, tierFor, chapterLabel } from '../lib/eventMeta';
import { EliminationCard } from './EliminationCard';
import { supabase } from '../lib/supabase';


type ReactionCounts = { likes: number; dislikes: number };
type UserReactions = Record<string, 'like' | 'dislike' | null>;
type ReactionMap = Record<string, ReactionCounts>;

export function AgentChip({ agent, seasonId }: { agent: Agent; seasonId: string }) {
  return (
    <Link
      to={`/show/${seasonId}/agent/${agent.id}`}
      className="inline-flex items-center gap-1.5 group/chip"
    >
      <img
        src={agent.avatar_url}
        alt={agent.name}
        className="w-5 h-5 rounded-md object-cover ring-1 ring-white/10 group-hover/chip:ring-white/25 transition-all"
      />
      <span className="text-xs font-bold text-white/90 group-hover/chip:text-white transition-colors">
        {agent.name}
      </span>
    </Link>
  );
}

function ReactionBar({
  eventId,
  seasonId,
  userId,
  counts,
  userReaction,
  onReact,
}: {
  eventId: string;
  seasonId: string;
  userId?: string;
  counts: ReactionCounts;
  userReaction: 'like' | 'dislike' | null;
  onReact: (eventId: string, type: 'like' | 'dislike') => void;
}) {
  const [copied, setCopied] = useState(false);

  function handleShare(e: React.MouseEvent) {
    e.stopPropagation();
    const url = `${window.location.origin}/show/${seasonId}/live?event=${eventId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex items-center gap-1 mt-2" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={(e) => { e.stopPropagation(); if (userId) onReact(eventId, 'like'); }}
        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-all ${
          userReaction === 'like'
            ? 'bg-sky-500/20 text-sky-300 border border-sky-400/30'
            : 'text-white/25 hover:text-white/50 hover:bg-white/[0.04]'
        } ${!userId ? 'cursor-default opacity-50' : 'cursor-pointer'}`}
      >
        <ThumbsUp className="w-3 h-3" />
        {counts.likes > 0 && <span>{counts.likes}</span>}
      </button>

      <button
        onClick={(e) => { e.stopPropagation(); if (userId) onReact(eventId, 'dislike'); }}
        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-all ${
          userReaction === 'dislike'
            ? 'bg-red-500/20 text-red-300 border border-red-400/30'
            : 'text-white/25 hover:text-white/50 hover:bg-white/[0.04]'
        } ${!userId ? 'cursor-default opacity-50' : 'cursor-pointer'}`}
      >
        <ThumbsDown className="w-3 h-3" />
        {counts.dislikes > 0 && <span>{counts.dislikes}</span>}
      </button>

      <button
        onClick={handleShare}
        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-white/25 hover:text-white/50 hover:bg-white/[0.04] transition-all ml-auto"
      >
        {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Share2 className="w-3 h-3" />}
        {copied ? <span className="text-emerald-400">Copie !</span> : <span>Partager</span>}
      </button>
    </div>
  );
}

export function EventFeed({
  events,
  onSelect,
  agentMap,
  revealedDmIds,
  season,
  onRevealDm,
  userId,
}: {
  events: FeedEvent[];
  onSelect: (ev: FeedEvent) => void;
  agentMap?: Map<string, Agent>;
  revealedDmIds?: Set<string>;
  season?: Season | null;
  onRevealDm?: (ev: FeedEvent) => void;
  userId?: string;
}) {
  const { seasonId } = useParams();
  const sid = seasonId ?? '';
  const isSeasonEnded = season?.status === 'ended';

  const [reactionMap, setReactionMap] = useState<ReactionMap>({});
  const [userReactions, setUserReactions] = useState<UserReactions>({});

  const loadReactions = useCallback(async () => {
    if (events.length === 0) return;
    const eventIds = events.map((e) => e.id);

    const { data: counts } = await supabase
      .from('event_reactions')
      .select('event_id, type')
      .in('event_id', eventIds);

    const map: ReactionMap = {};
    for (const row of counts ?? []) {
      if (!map[row.event_id]) map[row.event_id] = { likes: 0, dislikes: 0 };
      if (row.type === 'like') map[row.event_id].likes++;
      else map[row.event_id].dislikes++;
    }
    setReactionMap(map);

    if (userId) {
      const { data: mine } = await supabase
        .from('event_reactions')
        .select('event_id, type')
        .in('event_id', eventIds)
        .eq('user_id', userId);

      const userMap: UserReactions = {};
      for (const row of mine ?? []) {
        userMap[row.event_id] = row.type as 'like' | 'dislike';
      }
      setUserReactions(userMap);
    }
  }, [events, userId]);

  useEffect(() => {
    loadReactions();
  }, [loadReactions]);

  async function handleReact(eventId: string, type: 'like' | 'dislike') {
    if (!userId) return;

    const current = userReactions[eventId];
    const currentCounts = reactionMap[eventId] ?? { likes: 0, dislikes: 0 };

    if (current === type) {
      await supabase
        .from('event_reactions')
        .delete()
        .eq('event_id', eventId)
        .eq('user_id', userId);

      setUserReactions((prev) => ({ ...prev, [eventId]: null }));
      setReactionMap((prev) => ({
        ...prev,
        [eventId]: {
          ...currentCounts,
          likes: type === 'like' ? Math.max(0, currentCounts.likes - 1) : currentCounts.likes,
          dislikes: type === 'dislike' ? Math.max(0, currentCounts.dislikes - 1) : currentCounts.dislikes,
        },
      }));
      return;
    }

    if (current) {
      await supabase
        .from('event_reactions')
        .delete()
        .eq('event_id', eventId)
        .eq('user_id', userId);
    }

    const seasonIdForReaction = season?.id ?? events.find((e) => e.id === eventId)?.season_id ?? '';

    await supabase.from('event_reactions').insert({
      event_id: eventId,
      user_id: userId,
      season_id: seasonIdForReaction,
      type,
    });

    setUserReactions((prev) => ({ ...prev, [eventId]: type }));
    setReactionMap((prev) => ({
      ...prev,
      [eventId]: {
        likes:
          type === 'like'
            ? currentCounts.likes + 1
            : current === 'like'
              ? Math.max(0, currentCounts.likes - 1)
              : currentCounts.likes,
        dislikes:
          type === 'dislike'
            ? currentCounts.dislikes + 1
            : current === 'dislike'
              ? Math.max(0, currentCounts.dislikes - 1)
              : currentCounts.dislikes,
      },
    }));
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-16 text-white/30 text-sm border border-white/[0.06] rounded-2xl bg-white/[0.01]">
        Aucun evenement pour l'instant.
      </div>
    );
  }

  /*
    Le fil se lit comme un episode: les evenements sont regroupes en chapitres
    (« Jour 3 · Soir ») pour qu'on puisse dire ou l'on s'est arrete et le
    retrouver. Sans ce relief, tout defile a plat.
  */
  const chapters: Array<{ key: string; label: string; items: FeedEvent[] }> = [];
  for (const ev of events) {
    const label = chapterLabel(ev.day_number, ev.created_at);
    const last = chapters[chapters.length - 1];
    if (last && last.label === label) last.items.push(ev);
    else chapters.push({ key: `${ev.day_number}-${label}-${ev.id}`, label, items: [ev] });
  }

  return (
    <div className="relative space-y-5">
      {chapters.map((chapter) => (
        <section key={chapter.key} className="space-y-1.5">
          <div className="flex items-center gap-3 pt-1">
            <h3 className="text-[11px] font-bold uppercase tracking-[.18em] text-white/70 whitespace-nowrap">
              {chapter.label}
            </h3>
            <span className="flex-1 h-px bg-white/[0.08]" aria-hidden="true" />
          </div>

        {chapter.items.map((ev) => {
          const meta = metaFor(ev.event_type);
          const Icon = meta.icon;
          const tier = tierFor(ev.event_type, ev.payload_json);

          const isDm = ev.event_type === 'private_dm';
          const isHost = ev.event_type === 'host_commentary';
          const isClue = ev.event_type === 'host_clue';
          const dmRevealed = isDm && (isSeasonEnded || revealedDmIds?.has(ev.id));

          const hostName = isHost ? (ev.payload_json?.host_name as string) : null;
          const hostAvatar = isHost ? (ev.payload_json?.host_avatar as string) : null;

          const actor = ev.actor_agent_id && agentMap ? agentMap.get(ev.actor_agent_id) : null;
          const target = ev.target_agent_id && agentMap ? agentMap.get(ev.target_agent_id) : null;
          // Nommer les participants d'un DM verrouille sans en livrer le contenu:
          // c'est ce qui rend le deverrouillage desirable.
          const actorForDm = actor?.name ?? null;
          const targetForDm = target?.name ?? null;

          const dmPair =
            actorForDm && targetForDm ? `${actorForDm} et ${targetForDm}` : 'deux agents';
          const msg = isDm && !dmRevealed
            ? `Un message prive circule entre ${dmPair}.`
            : (ev.payload_json?.message as string) ??
              (ev.payload_json?.title as string) ??
              JSON.stringify(ev.payload_json);

          const isUserEvent = ev.event_type === 'spectator_influence' || ev.event_type === 'owner_influence';
          const userPseudo = isUserEvent ? (ev.payload_json?.username as string) : null;

          const counts = reactionMap[ev.id] ?? { likes: 0, dislikes: 0 };
          const userReaction = userReactions[ev.id] ?? null;

          if (ev.event_type === 'elimination') {
            const p = ev.payload_json ?? {};
            return (
              <div key={ev.id} className="py-1">
                <EliminationCard
                  data={{
                    agentName: (p.agent_name as string) ?? target?.name ?? 'Un agent',
                    secret: (p.secret as string) ?? null,
                    byName: (p.by as string) ?? actor?.name ?? null,
                    reason: (p.reason as string) ?? null,
                    dayNumber: ev.day_number,
                    createdAt: ev.created_at,
                    seasonTitle: season?.title,
                    // L'enjeu monte a mesure que le champ se reduit: la
                    // resolution d'accusation et la ceremonie le portent tous
                    // deux dans le payload.
                    agentsRemaining: (p.agents_remaining as number) ?? null,
                    prizePool: (p.prize_pool as number) ?? null,
                  }}
                />
              </div>
            );
          }

          return (
            <div
              key={ev.id}
              role="button"
              tabIndex={0}
              onClick={() => isDm && !dmRevealed && onRevealDm ? onRevealDm(ev) : onSelect(ev)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (isDm && !dmRevealed && onRevealDm) onRevealDm(ev);
                  else onSelect(ev);
                }
              }}
              className={`w-full text-left flex gap-3 border rounded-2xl cursor-pointer transition-all duration-200 group focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${
                tier === 'ambient' ? 'p-3' : 'p-4'
              } ${
                tier === 'beat'
                  ? 'border-red-400/30 bg-gradient-to-r from-red-500/[0.07] to-transparent hover:border-red-400/45'
                  : isDm && !dmRevealed
                  ? 'border-rose-400/10 bg-rose-500/[0.03] hover:bg-rose-500/[0.06] hover:border-rose-400/20'
                  : isHost
                    ? 'border-cyan-400/10 bg-cyan-500/[0.03] hover:bg-cyan-500/[0.06] hover:border-cyan-400/20'
                    : isClue
                      ? 'border-violet-400/20 bg-violet-500/[0.04] hover:bg-violet-500/[0.07] hover:border-violet-400/30'
                      : tier === 'ambient'
                        ? 'border-white/[0.04] bg-white/[0.012] hover:bg-white/[0.04] hover:border-white/[0.08]'
                        : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.1]'
              }`}
            >
              {isClue ? (
                <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-400/20 flex items-center justify-center relative z-10">
                  <Eye className="w-4 h-4 text-violet-400" />
                </div>
              ) : isHost && hostAvatar ? (
                <div className="flex-shrink-0 relative z-10">
                  <img
                    src={hostAvatar}
                    alt={hostName ?? 'Host'}
                    className="w-10 h-10 rounded-xl object-cover ring-1 ring-cyan-400/20 group-hover:ring-cyan-400/40 transition-all"
                  />
                  <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-md ${meta.bg} flex items-center justify-center border border-[#08090d]`}>
                    <Mic className={`w-2.5 h-2.5 ${meta.color}`} />
                  </div>
                </div>
              ) : isDm && !dmRevealed ? (
                <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center relative z-10">
                  <Lock className="w-4 h-4 text-rose-400" />
                </div>
              ) : isUserEvent && userPseudo ? (
                <div className="flex-shrink-0 relative z-10">
                  <div className={`w-10 h-10 rounded-xl ${meta.bg} flex items-center justify-center`}>
                    <User className={`w-4 h-4 ${meta.color}`} />
                  </div>
                  <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-md ${meta.bg} flex items-center justify-center border border-[#08090d]`}>
                    <Icon className={`w-2.5 h-2.5 ${meta.color}`} />
                  </div>
                </div>
              ) : actor ? (
                <div className="flex-shrink-0 relative z-10">
                  <img
                    src={actor.avatar_url}
                    alt={actor.name}
                    className="w-10 h-10 rounded-xl object-cover ring-1 ring-white/10 group-hover:ring-white/20 transition-all"
                  />
                  <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-md ${meta.bg} flex items-center justify-center border border-[#08090d]`}>
                    <Icon className={`w-2.5 h-2.5 ${meta.color}`} />
                  </div>
                </div>
              ) : (
                <div className={`flex-shrink-0 w-10 h-10 rounded-xl ${meta.bg} flex items-center justify-center relative z-10`}>
                  <Icon className={`w-4 h-4 ${meta.color}`} />
                </div>
              )}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  {isClue ? (
                    <span className="text-xs font-bold text-violet-300">Maitre du Jeu</span>
                  ) : isHost ? (
                    <span className="text-xs font-bold text-cyan-300">{hostName ?? 'Presentateur'}</span>
                  ) : isDm && !dmRevealed ? (
                    <span className="text-xs font-semibold text-rose-300/80">
                      {actorForDm && targetForDm ? `${actorForDm} → ${targetForDm}` : 'Echange prive'}
                    </span>
                  ) : isUserEvent && userPseudo ? (
                    <span className={`text-xs font-bold ${ev.event_type === 'owner_influence' ? 'text-teal-300' : 'text-orange-300'}`}>
                      {userPseudo}
                    </span>
                  ) : actor ? (
                    <span onClick={(e) => e.stopPropagation()} className="contents">
                      <AgentChip agent={actor} seasonId={sid} />
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-white/40">Maitre du Jeu</span>
                  )}

                  {isDm && dmRevealed && target && (
                    <span className="flex items-center gap-1.5 text-white/40">
                      <ArrowRight className="w-3 h-3" />
                      <span onClick={(e) => e.stopPropagation()} className="contents">
                        <AgentChip agent={target} seasonId={sid} />
                      </span>
                    </span>
                  )}

                  {!isDm && target && (
                    <span className="flex items-center gap-1.5 text-white/40">
                      <ArrowRight className="w-3 h-3" />
                      <span onClick={(e) => e.stopPropagation()} className="contents">
                        <AgentChip agent={target} seasonId={sid} />
                      </span>
                    </span>
                  )}

                  {tier !== 'ambient' && (
                    <span className={`text-[10px] font-semibold uppercase tracking-wider ${meta.color} ml-auto flex-shrink-0`}>
                      {meta.label}
                    </span>
                  )}
                  {ev.video_job_id && (
                    <span className="px-1.5 py-0.5 bg-amber-500/20 border border-amber-500/30 rounded flex items-center gap-1 text-[9px] font-bold text-amber-400 uppercase tracking-wide flex-shrink-0">
                      <Film className="w-2.5 h-2.5" />
                      Vidéo
                    </span>
                  )}
                </div>

                <p className={`leading-relaxed group-hover:text-white/90 transition-colors ${
                  tier === 'beat' ? 'text-[15px] font-medium text-white/90' : 'text-sm'
                } ${
                  isDm && !dmRevealed ? 'text-rose-300/50 italic' : isClue ? 'text-violet-200/80 italic' : tier === 'beat' ? '' : 'text-white/70'
                }`}>
                  {isDm && !dmRevealed ? msg : isClue ? msg : highlightAgentNames(msg, agentMap)}
                </p>

                {ev.event_type === 'accusation' && !!ev.payload_json?.guess_keyword && (
                  // Le mot devine et le verdict sont l'information utile du
                  // spectateur: une devinette ratee exclut ce mot pour la cible.
                  <p
                    className={`text-xs mt-1 font-medium ${
                      ev.payload_json?.correct === true ? 'text-emerald-400' : 'text-white/40'
                    }`}
                  >
                    Mot devine : « {String(ev.payload_json.guess_keyword)} »
                    {ev.payload_json?.correct === true ? ' : juste, cible eliminee' : ' : faux'}
                  </p>
                )}

                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-[10px] text-white/25">
                    Jour {ev.day_number}
                  </span>
                  <span className="text-[10px] text-white/15">&middot;</span>
                  <span className="text-[10px] text-white/25">
                    {new Date(ev.created_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  {isDm && !dmRevealed && season && (
                    <>
                      <span className="text-[10px] text-white/15">&middot;</span>
                      <span className="text-[10px] font-bold text-rose-400 flex items-center gap-1">
                        <Lock className="w-2.5 h-2.5" />
                        Lire l&apos;echange · {season.dm_reveal_fee_usdc} USDC
                      </span>
                    </>
                  )}
                </div>

                <ReactionBar
                  eventId={ev.id}
                  seasonId={sid}
                  userId={userId}
                  counts={counts}
                  userReaction={userReaction}
                  onReact={handleReact}
                />
              </div>
            </div>
          );
        })}
        </section>
      ))}
    </div>
  );
}
