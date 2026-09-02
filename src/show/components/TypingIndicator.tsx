import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Agent, Season } from '../api/types';

type TypingRow = {
  season_id: string;
  actor: string;
  agent_id: string | null;
  kind: string;
  started_at: string;
};

const KIND_LABEL: Record<string, string> = {
  public_chat: 'ecrit dans le salon',
  private_dm: 'envoie un message prive',
  confessional: 'passe au confessionnal',
  accusation: 'prepare une accusation',
  opening: 'ouvre la saison',
  relance: 'relance la maison',
  commentary: 'commente la soiree',
  provoke: 'prepare une pique',
};

/** Au-dela, une ligne est un reste d'appel interrompu, pas une activite. */
const STALE_MS = 90_000;

/*
  Signal de presence du fil. Pendant qu'un agent (ou le presentateur) attend
  sa reponse du modele, auto-tick pose une ligne dans agent_typing: on affiche
  « X ecrit... ». Entre deux tours, le cron tourne a la minute pile: on montre
  le compte a rebours, pour que l'attente soit lisible plutot que vide.
*/
export function TypingIndicator({
  seasonId,
  agents,
  season,
}: {
  seasonId: string;
  agents: Agent[];
  season: Season | null;
}) {
  const [rows, setRows] = useState<TypingRow[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      supabase
        .from('agent_typing')
        .select('*')
        .eq('season_id', seasonId)
        .then(({ data }) => {
          if (!cancelled) setRows((data ?? []) as TypingRow[]);
        });
    };

    load();
    const channel = supabase
      .channel(`typing-${seasonId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agent_typing', filter: `season_id=eq.${seasonId}` },
        load
      )
      .subscribe();
    const poll = window.setInterval(load, 10_000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, [seasonId]);

  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  if (season?.status !== 'live') return null;

  const active = rows.filter((r) => now - new Date(r.started_at).getTime() < STALE_MS);

  if (active.length > 0) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 space-y-2 animate-fade-in">
        {active.map((r) => {
          const agent = r.agent_id ? agentMap.get(r.agent_id) : null;
          const name = agent?.name ?? 'Le Maitre du Jeu';
          return (
            <div key={r.actor} className="flex items-center gap-2.5">
              {agent ? (
                <img
                  src={agent.avatar_url}
                  alt={agent.name}
                  className="w-6 h-6 rounded-md object-cover ring-1 ring-white/10"
                />
              ) : (
                <span className="w-6 h-6 rounded-md bg-cyan-500/20 flex items-center justify-center text-[10px] font-black text-cyan-300">
                  MJ
                </span>
              )}
              <span className="text-xs text-white/60">
                <strong className="text-white/90">{name}</strong> {KIND_LABEL[r.kind] ?? 'ecrit'}
              </span>
              <span className="typing-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  const secondsToNext = 60 - Math.floor((now / 1000) % 60);
  const progress = ((60 - secondsToNext) / 60) * 100;

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] px-4 py-2.5 flex items-center gap-3">
      <span className="relative w-2 h-2 rounded-full bg-emerald-400 text-emerald-400 live-dot flex-shrink-0" />
      <span className="text-[11px] text-white/45 flex-1">
        La maison retient son souffle. Prochain tour dans{' '}
        <span className="tabular-nums text-white/70">{secondsToNext}s</span>
      </span>
      <div className="w-24 h-1 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className="h-full bg-white/25 transition-[width] duration-1000 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
