import { useEffect, useState } from 'react';
import { Play, Loader2, AlertCircle, Maximize2, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';

// EN TEST VIDEO - Système de génération cinématographique avec Kie.ai Sora 2

interface VideoJob {
  id: string;
  status: string;
  video_url: string | null;
  watermark_video_url: string | null;
  error_message: string | null;
  scene_prompt: string;
}

const PENDING_STATUSES = ['pending', 'queuing', 'generating'];

interface CinematicVideoPlayerProps {
  eventId: string;
  agentName: string;
  fallbackText?: string;
  onRequestRegeneration?: () => void;
}

export function CinematicVideoPlayer({
  eventId,
  agentName,
  fallbackText,
  onRequestRegeneration
}: CinematicVideoPlayerProps) {
  const [videoJob, setVideoJob] = useState<VideoJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;

    async function fetchVideoJob(): Promise<string | null> {
      try {
        const { data: event, error: eventError } = await supabase
          .from('events')
          // Deux cles etrangeres relient events et video_jobs (events.video_job_id et
          // video_jobs.event_id): sans nommer la contrainte, PostgREST refuse
          // l'imbrication (PGRST201).
          .select(
            'video_job_id, video_jobs!events_video_job_id_fkey(id, status, video_url, watermark_video_url, error_message, scene_prompt)'
          )
          .eq('id', eventId)
          .maybeSingle();

        if (cancelled) return null;

        if (eventError) {
          setError(eventError.message);
          setLoading(false);
          return null;
        }

        const job = (event?.video_jobs ?? null) as VideoJob | null;
        setVideoJob(job);
        setLoading(false);
        return job?.status ?? null;
      } catch (err) {
        if (cancelled) return null;
        setError(err instanceof Error ? err.message : 'Unknown error');
        setLoading(false);
        return null;
      }
    }

    fetchVideoJob().then((status) => {
      if (cancelled || !status || !PENDING_STATUSES.includes(status)) return;
      interval = setInterval(async () => {
        const next = await fetchVideoJob();
        if (next && !PENDING_STATUSES.includes(next) && interval) clearInterval(interval);
      }, 5000);
    });

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [eventId]);

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  if (loading && !videoJob) {
    return (
      <div className="flex items-center justify-center p-8 bg-white/[0.02] rounded-xl border border-white/[0.06]">
        <Loader2 className="w-6 h-6 text-white/40 animate-spin" />
      </div>
    );
  }

  if (error && !videoJob) {
    return (
      <div className="p-4 bg-red-500/[0.05] rounded-xl border border-red-500/20">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs text-red-200/80">Impossible de charger la vidéo : {error}</p>
            {fallbackText && <p className="text-xs text-white/50 mt-2 leading-relaxed">{fallbackText}</p>}
          </div>
        </div>
      </div>
    );
  }

  if (!videoJob) {
    if (fallbackText) {
      return (
        <div className="p-4 bg-white/[0.02] rounded-xl border border-white/[0.06]">
          <p className="text-sm text-white/60 leading-relaxed">{fallbackText}</p>
        </div>
      );
    }
    return null;
  }

  if (videoJob.status === 'fail') {
    return (
      <div className="p-6 bg-red-500/[0.05] rounded-xl border border-red-500/20">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="text-sm font-semibold text-red-300 mb-1">Échec de génération</h4>
            <p className="text-xs text-red-200/70 mb-3">{videoJob.error_message || 'Une erreur est survenue'}</p>
            {fallbackText && (
              <div className="p-3 bg-white/[0.02] rounded-lg border border-white/[0.06] mb-3">
                <p className="text-xs text-white/50">{fallbackText}</p>
              </div>
            )}
            {onRequestRegeneration && (
              <button
                onClick={onRequestRegeneration}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-red-300 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Régénérer la vidéo
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (PENDING_STATUSES.includes(videoJob.status)) {
    const statusLabels: { [key: string]: string } = {
      pending: 'En attente',
      queuing: 'En file d\'attente',
      generating: 'Génération en cours'
    };

    return (
      <div className="relative overflow-hidden rounded-xl border border-white/[0.06] bg-gradient-to-br from-amber-500/[0.03] via-white/[0.02] to-white/[0.02] p-8">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAxMCAwIEwgMCAwIDAgMTAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjAyKSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-50" />
        <div className="relative text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/20 mb-4">
            <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">Vidéo cinématographique</h3>
          <p className="text-sm text-white/40 mb-1">{statusLabels[videoJob.status]}</p>
          <p className="text-xs text-white/25">Cela peut prendre quelques minutes...</p>
          {fallbackText && (
            <div className="mt-4 p-3 bg-white/[0.02] rounded-lg border border-white/[0.06] text-left">
              <p className="text-xs text-white/40 mb-1 font-medium">Contenu textuel:</p>
              <p className="text-xs text-white/50 leading-relaxed">{fallbackText}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (videoJob.status === 'success' && videoJob.video_url) {
    return (
      <>
        <div className="relative group rounded-xl overflow-hidden border border-white/[0.06] bg-black">
          <video
            src={videoJob.video_url}
            controls
            className="w-full aspect-video bg-black"
            poster={videoJob.video_url.replace(/\.[^/.]+$/, '_thumb.jpg')}
          >
            Votre navigateur ne supporte pas la lecture vidéo.
          </video>

          <div className="absolute bottom-3 left-3 px-2 py-1 bg-black/70 backdrop-blur-sm rounded-lg border border-white/10">
            <p className="text-xs font-semibold text-white">{agentName}</p>
          </div>

          <button
            onClick={toggleFullscreen}
            className="absolute top-3 right-3 p-2 bg-black/70 backdrop-blur-sm rounded-lg border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Plein écran"
          >
            <Maximize2 className="w-4 h-4 text-white" />
          </button>

          <div className="absolute top-3 left-3 px-2 py-1 bg-amber-500/90 backdrop-blur-sm rounded-md">
            <Play className="w-3 h-3 text-white inline mr-1" />
            <span className="text-[10px] font-bold text-white uppercase tracking-wide">Vidéo</span>
          </div>
        </div>

        {isFullscreen && (
          <div
            className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4"
            onClick={toggleFullscreen}
          >
            <div className="relative w-full max-w-6xl" onClick={(e) => e.stopPropagation()}>
              <video
                src={videoJob.video_url}
                controls
                autoPlay
                className="w-full rounded-xl"
              >
                Votre navigateur ne supporte pas la lecture vidéo.
              </video>
              <button
                onClick={toggleFullscreen}
                className="absolute -top-12 right-0 px-4 py-2 text-white hover:text-white/70 transition-colors text-sm font-medium"
              >
                Fermer
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}
