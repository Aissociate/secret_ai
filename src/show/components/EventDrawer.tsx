import { useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { X, ArrowRight } from 'lucide-react';
import type { Agent, FeedEvent } from '../api/types';
import { highlightAgentNames } from '../lib/highlightAgents';
import { CommentsThread } from './CommentsThread';

export function EventDrawer({
  selected,
  onClose,
  agentMap,
  seasonId,
}: {
  selected: FeedEvent | null;
  onClose: () => void;
  agentMap?: Map<string, Agent>;
  seasonId?: string;
}) {
  const handleEsc = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (selected) {
      document.addEventListener('keydown', handleEsc);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [selected, handleEsc]);

  if (!selected) return null;

  const actor = selected.actor_agent_id && agentMap ? agentMap.get(selected.actor_agent_id) : null;
  const target = selected.target_agent_id && agentMap ? agentMap.get(selected.target_agent_id) : null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 animate-fade-in"
        onClick={onClose}
      />
      <div className="fixed top-0 right-0 h-full w-full max-w-lg bg-[#0d0f16] border-l border-white/[0.08] z-50 overflow-y-auto animate-slide-in">
        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white">Details</h3>
            <button
              onClick={onClose}
              className="p-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {(actor || target) && (
            <div className="flex items-center gap-3 flex-wrap">
              {actor && (
                <Link
                  to={seasonId ? `/show/${seasonId}/agent/${actor.id}` : '#'}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] transition-all group/actor"
                >
                  <img
                    src={actor.avatar_url}
                    alt={actor.name}
                    className="w-8 h-8 rounded-lg object-cover ring-1 ring-white/10 group-hover/actor:ring-white/25 transition-all"
                  />
                  <div>
                    <div className="text-sm font-bold text-white">{actor.name}</div>
                    <div className="text-[10px] text-white/40">Emetteur</div>
                  </div>
                </Link>
              )}
              {target && (
                <>
                  <ArrowRight className="w-4 h-4 text-white/20" />
                  <Link
                    to={seasonId ? `/show/${seasonId}/agent/${target.id}` : '#'}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] transition-all group/target"
                  >
                    <img
                      src={target.avatar_url}
                      alt={target.name}
                      className="w-8 h-8 rounded-lg object-cover ring-1 ring-white/10 group-hover/target:ring-white/25 transition-all"
                    />
                    <div>
                      <div className="text-sm font-bold text-white">{target.name}</div>
                      <div className="text-[10px] text-white/40">Cible</div>
                    </div>
                  </Link>
                </>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 text-xs text-white/50">
            <span className="capitalize">{selected.event_type.replace('_', ' ')}</span>
            <span>&middot;</span>
            <span>Jour {selected.day_number}</span>
            <span>&middot;</span>
            <span>{new Date(selected.created_at).toLocaleString()}</span>
          </div>

          <div>
            <label className="text-xs font-medium text-white/40 block mb-2">
              Message
            </label>
            <div className="border border-white/[0.08] rounded-xl p-4 bg-white/[0.02] text-sm text-white/80 leading-relaxed">
              {selected.payload_json?.message
                ? highlightAgentNames(selected.payload_json.message as string, agentMap)
                : '(no message)'}
            </div>
          </div>

          <CommentsThread eventId={selected.id} />

          {!!(selected.payload_json as Record<string, unknown>)?.meta && (
            <div>
              <label className="text-xs font-medium text-white/40 block mb-2">
                Meta
              </label>
              <div className="border border-white/[0.08] rounded-xl p-4 bg-white/[0.02]">
                <pre className="text-xs text-white/60 whitespace-pre-wrap font-mono">
                  {JSON.stringify((selected.payload_json as Record<string, unknown>).meta, null, 2)}
                </pre>
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-white/40 block mb-2">
              Payload complet
            </label>
            <div className="border border-white/[0.08] rounded-xl p-4 bg-white/[0.02]">
              <pre className="text-xs text-white/60 whitespace-pre-wrap font-mono">
                {JSON.stringify(selected.payload_json, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
