import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Video, Play, Filter, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Tabs } from '../components/Tabs';
import { DaySelector } from '../components/DaySelector';
import { getEventTypeLabel } from '../lib/cinematographyPrompts';
import type { Agent, Season } from '../api/types';

interface VideoJobWithDetails {
  id: string;
  status: string;
  video_url: string | null;
  created_at: string;
  completed_at: string | null;
  event_id: string;
  agent_id: string;
  season_id: string;
  event: {
    event_type: string;
    day_number: number;
    payload_json: {
      message?: string;
    };
  };
  agent: {
    name: string;
    avatar_url: string;
  };
}

export function VideosGalleryPage() {
  const { seasonId } = useParams();
  const sid = seasonId!;

  const [season, setSeason] = useState<Season | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [videos, setVideos] = useState<VideoJobWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentFilter, setAgentFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [dayFilter, setDayFilter] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedVideo, setSelectedVideo] = useState<VideoJobWithDetails | null>(null);

  useEffect(() => {
    loadData();
  }, [sid]);

  async function loadData() {
    setLoading(true);
    try {
      const [seasonRes, agentsRes, videosRes] = await Promise.all([
        supabase.from('seasons').select('*').eq('id', sid).maybeSingle(),
        supabase.from('agents').select('*').eq('season_id', sid),
        supabase
          .from('video_jobs')
          .select(`
            *,
            event:events!inner(event_type, day_number, payload_json),
            agent:agents!inner(name, avatar_url)
          `)
          .eq('season_id', sid)
          .eq('status', 'success')
          .not('video_url', 'is', null)
          .order('created_at', { ascending: false }),
      ]);

      if (seasonRes.data) setSeason(seasonRes.data);
      if (agentsRes.data) setAgents(agentsRes.data);
      if (videosRes.data) setVideos(videosRes.data as any);
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  }

  const eventTypes = useMemo(() => {
    const types = new Set<string>();
    videos.forEach((v) => types.add(v.event.event_type));
    return Array.from(types);
  }, [videos]);

  const filtered = useMemo(() => {
    let list = videos;

    if (agentFilter !== 'all') {
      list = list.filter((v) => v.agent_id === agentFilter);
    }

    if (typeFilter !== 'all') {
      list = list.filter((v) => v.event.event_type === typeFilter);
    }

    if (dayFilter !== null) {
      list = list.filter((v) => v.event.day_number === dayFilter);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      list = list.filter(
        (v) =>
          v.agent.name.toLowerCase().includes(query) ||
          v.event.payload_json.message?.toLowerCase().includes(query)
      );
    }

    return list;
  }, [videos, agentFilter, typeFilter, dayFilter, searchQuery]);

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-br from-white/[0.03] via-transparent to-amber-500/[0.03] p-5 sm:p-6">
        <div className="absolute top-0 right-0 w-48 h-48 bg-amber-500/[0.04] rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-2">
            <Video className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">
              Galerie
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-white">Vidéos Cinématographiques</h1>
          <p className="text-sm text-white/40 mt-1">
            Tous les moments capturés en vidéo
          </p>
          <div className="flex items-center gap-3 mt-3 text-[10px] text-white/25">
            <span className="flex items-center gap-1">
              <Play className="w-3 h-3" /> {filtered.length} vidéos
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher par agent ou contenu..."
              className="w-full pl-10 pr-4 py-2.5 bg-white/[0.03] border border-white/[0.06] rounded-lg text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-amber-500/50"
            />
          </div>
          {season && (
            <DaySelector
              currentDay={season.current_day}
              selectedDay={dayFilter}
              onChange={setDayFilter}
            />
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <Tabs
              value={agentFilter}
              onChange={setAgentFilter}
              tabs={[
                { key: 'all', label: 'Tous les agents' },
                ...agents.map((a) => ({ key: a.id, label: a.name })),
              ]}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-white/40" />
          <Tabs
            value={typeFilter}
            onChange={setTypeFilter}
            tabs={[
              { key: 'all', label: 'Tous types' },
              ...eventTypes.map((t) => ({ key: t, label: getEventTypeLabel(t) })),
            ]}
          />
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-64 rounded-2xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Video className="w-12 h-12 text-white/20 mx-auto mb-3" />
          <p className="text-sm text-white/40">Aucune vidéo trouvée</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((video) => (
            <div
              key={video.id}
              onClick={() => setSelectedVideo(video)}
              className="group relative overflow-hidden rounded-xl border border-white/[0.06] bg-black cursor-pointer hover:border-amber-500/50 transition-all"
            >
              <div className="relative aspect-video bg-black overflow-hidden">
                <video
                  src={video.video_url!}
                  className="w-full h-full object-cover"
                  poster={video.video_url!.replace(/\.[^/.]+$/, '_thumb.jpg')}
                />
                <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Play className="w-6 h-6 text-white fill-white" />
                  </div>
                </div>
                <div className="absolute top-2 left-2 px-2 py-1 bg-black/70 backdrop-blur-sm rounded-md text-[10px] font-bold text-white uppercase tracking-wide">
                  {getEventTypeLabel(video.event.event_type)}
                </div>
                <div className="absolute top-2 right-2 px-2 py-1 bg-black/70 backdrop-blur-sm rounded-md text-[10px] font-bold text-white">
                  Jour {video.event.day_number}
                </div>
              </div>
              <div className="p-3 bg-white/[0.02]">
                <p className="font-semibold text-white text-sm mb-1">{video.agent.name}</p>
                {video.event.payload_json.message && (
                  <p className="text-xs text-white/50 line-clamp-2">
                    {video.event.payload_json.message}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedVideo && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4"
          onClick={() => setSelectedVideo(null)}
        >
          <div className="relative w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4">
              <h2 className="text-xl font-bold text-white mb-1">{selectedVideo.agent.name}</h2>
              <p className="text-sm text-white/50">
                {getEventTypeLabel(selectedVideo.event.event_type)} - Jour {selectedVideo.event.day_number}
              </p>
            </div>
            <div className="rounded-xl overflow-hidden">
              <video
                src={selectedVideo.video_url!}
                controls
                autoPlay
                className="w-full"
              >
                Votre navigateur ne supporte pas la lecture vidéo.
              </video>
            </div>
            {selectedVideo.event.payload_json.message && (
              <div className="mt-4 p-4 bg-white/[0.05] rounded-xl border border-white/[0.06]">
                <p className="text-sm text-white/70 leading-relaxed">
                  {selectedVideo.event.payload_json.message}
                </p>
              </div>
            )}
            <button
              onClick={() => setSelectedVideo(null)}
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
