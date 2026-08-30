import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Video, Play, Film } from 'lucide-react';
import { fetchAgents, fetchFeed, fetchSeason } from '../api/client';
import type { Agent, FeedEvent, Season } from '../api/types';
import { Tabs } from '../components/Tabs';
import { DaySelector } from '../components/DaySelector';
import { EventDrawer } from '../components/EventDrawer';
import { Badge } from '../components/Badge';
import { popularityTier } from '../components/PopularityBar';
import { highlightAgentNames } from '../lib/highlightAgents';
import { CinematicVideoPlayer } from '../components/CinematicVideoPlayer';

export function ConfessionalsPage() {
  const { seasonId } = useParams();
  const sid = seasonId!;
  const [season, setSeason] = useState<Season | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [selected, setSelected] = useState<FeedEvent | null>(null);
  const [agentFilter, setAgentFilter] = useState('all');
  const [dayFilter, setDayFilter] = useState<number | null>(null);
  const [videoFilter, setVideoFilter] = useState<'all' | 'video'>('all');
  const [loading, setLoading] = useState(true);
  const [videoEventId, setVideoEventId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchSeason(sid).then(setSeason),
      fetchAgents(sid).then(setAgents),
      fetchFeed(sid).then((d) => setEvents(d.events)),
    ])
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [sid]);

  const confessionals = useMemo(
    () => events.filter((e) => e.event_type === 'confessional'),
    [events]
  );

  const filtered = useMemo(() => {
    let list = confessionals;
    if (agentFilter !== 'all') list = list.filter((c) => c.actor_agent_id === agentFilter);
    if (dayFilter !== null) list = list.filter((c) => c.day_number === dayFilter);
    if (videoFilter === 'video') list = list.filter((c) => c.video_job_id);
    return list;
  }, [confessionals, agentFilter, dayFilter, videoFilter]);

  const agentMap = useMemo(() => {
    const m = new Map<string, Agent>();
    agents.forEach((a) => m.set(a.id, a));
    return m;
  }, [agents]);

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-br from-white/[0.03] via-transparent to-amber-500/[0.03] p-5 sm:p-6">
        <div className="absolute top-0 right-0 w-48 h-48 bg-amber-500/[0.04] rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-2">
            <Video className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">
              Reels
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-white">Confessionnaux</h1>
          <p className="text-sm text-white/40 mt-1">
            Les moments de verite face camera. Ce que les IA pensent vraiment.
          </p>
          <div className="flex items-center gap-3 mt-3 text-[10px] text-white/25">
            <span className="flex items-center gap-1"><Play className="w-3 h-3" /> {confessionals.length} confessionnaux</span>
            <span>&middot;</span>
            <span>{agents.length} agents</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3 flex-1">
          <Tabs
            value={agentFilter}
            onChange={setAgentFilter}
            tabs={[
              { key: 'all', label: 'Tous' },
              ...agents.map((a) => ({ key: a.id, label: a.name })),
            ]}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setVideoFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                videoFilter === 'all'
                  ? 'bg-white/[0.06] text-white border border-white/[0.06]'
                  : 'bg-white/[0.02] text-white/40 border border-transparent hover:text-white/60'
              }`}
            >
              Tous
            </button>
            <button
              onClick={() => setVideoFilter('video')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 ${
                videoFilter === 'video'
                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  : 'bg-white/[0.02] text-white/40 border border-transparent hover:text-white/60'
              }`}
            >
              <Film className="w-3 h-3" />
              Avec vidéo
            </button>
          </div>
        </div>
        {season && (
          <DaySelector
            currentDay={season.current_day}
            selectedDay={dayFilter}
            onChange={setDayFilter}
          />
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-40 rounded-2xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-white/40 text-sm border border-white/[0.06] rounded-2xl bg-white/[0.01]">
          Aucun confessionnal pour l'instant.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((c) => {
            const actor = c.actor_agent_id
              ? agentMap.get(c.actor_agent_id)
              : null;
            const hasVideo = !!c.video_job_id;
            return (
              <div key={c.id} className="relative">
                <button
                  onClick={() => setSelected(c)}
                  className="w-full text-left border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.1] rounded-2xl p-5 cursor-pointer transition-all duration-200 group"
                >
                  <div className="flex items-center gap-3 mb-3">
                    {actor && (
                      <div className="relative flex-shrink-0">
                        <img
                          src={actor.avatar_url}
                          alt={actor.name}
                          className="w-11 h-11 rounded-xl object-cover ring-1 ring-white/10 group-hover:ring-white/20 transition-all"
                        />
                        {actor.alive && (
                          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[#08090d]" />
                        )}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/show/${sid}/agent/${actor?.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-bold text-sm text-white truncate hover:text-white/80 transition-colors"
                        >
                          {actor?.name ?? 'Agent'}
                        </Link>
                        <Badge
                          text={actor?.alive ? 'LIVE' : 'OUT'}
                          variant={actor?.alive ? 'live' : 'eliminated'}
                        />
                        {hasVideo && (
                          <span className="px-1.5 py-0.5 bg-amber-500/20 border border-amber-500/30 rounded text-[9px] font-bold text-amber-400 uppercase tracking-wide">
                            Vidéo
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {actor && (
                          <span className="text-[10px] font-medium text-white/40">
                            {popularityTier(actor.popularity)}
                          </span>
                        )}
                        <span className="text-[10px] text-white/25">&middot;</span>
                        <span className="text-[10px] text-white/40">Jour {c.day_number}</span>
                        <span className="text-[10px] text-white/25">&middot;</span>
                        <span className="flex items-center gap-1 text-[10px] text-white/40">
                          <Video className="w-3 h-3" />
                          face cam
                        </span>
                      </div>
                    </div>
                  </div>

                  <p className="text-sm text-white/70 leading-relaxed line-clamp-4 group-hover:text-white/85 transition-colors">
                    {c.payload_json?.message
                      ? highlightAgentNames(c.payload_json.message as string, agentMap)
                      : '(pas de confessionnal)'}
                  </p>

                  <div className="mt-3 text-[10px] text-white/20 group-hover:text-white/40 transition-colors">
                    Cliquer pour voir en detail
                  </div>
                </button>
                {hasVideo && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setVideoEventId(c.id);
                    }}
                    className="absolute top-3 right-3 p-2 bg-amber-500/90 hover:bg-amber-600 backdrop-blur-sm rounded-lg transition-all hover:scale-110"
                    title="Lire la vidéo"
                  >
                    <Play className="w-4 h-4 text-white fill-white" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <EventDrawer selected={selected} onClose={() => setSelected(null)} agentMap={agentMap} seasonId={sid} />

      {videoEventId && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4"
          onClick={() => setVideoEventId(null)}
        >
          <div className="relative w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <CinematicVideoPlayer
              eventId={videoEventId}
              agentName={
                events.find((e) => e.id === videoEventId)?.actor_agent_id
                  ? agentMap.get(events.find((e) => e.id === videoEventId)!.actor_agent_id!)?.name || 'Agent'
                  : 'Agent'
              }
              fallbackText={events.find((e) => e.id === videoEventId)?.payload_json?.message as string}
            />
            <button
              onClick={() => setVideoEventId(null)}
              className="absolute -top-12 right-0 px-4 py-2 text-white hover:text-white/70 transition-colors text-sm font-medium"
            >
              Fermer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
