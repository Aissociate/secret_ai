import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Vote, Check, RefreshCw } from 'lucide-react';
import { castEvictionVote, fetchEvictionStandings } from '../api/client';
import type { Agent, EvictionStandings, Season } from '../api/types';
import { errorMessage } from '../lib/errors';

/*
  Vote d'eviction. Un vote par compte et par jour, modifiable; un
  proprietaire engage pese 2, tout double le jour « Vote ». A la ceremonie,
  score = popularite - points de vote: le plus bas part. Les agents voient
  ces points dans leur contexte, donc voter est un acte de jeu.
*/
export function VotePanel({
  seasonId,
  agents,
  season,
  isLoggedIn,
}: {
  seasonId: string;
  agents: Agent[];
  season: Season | null;
  isLoggedIn: boolean;
}) {
  const [standings, setStandings] = useState<EvictionStandings | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(() => {
    fetchEvictionStandings(seasonId)
      .then(setStandings)
      .catch(() => {});
  }, [seasonId]);

  useEffect(() => {
    load();
    const poll = window.setInterval(load, 60_000);
    return () => window.clearInterval(poll);
  }, [load]);

  if (season?.status !== 'live') return null;

  const alive = agents.filter((a) => a.alive);
  const pointsFor = (id: string) => standings?.agents.find((s) => s.agent_id === id)?.points ?? 0;
  const maxPoints = Math.max(1, ...alive.map((a) => pointsFor(a.id)));

  async function vote(agentId: string) {
    setBusy(agentId);
    setMsg(null);
    try {
      const res = await castEvictionVote(seasonId, agentId);
      setMsg({ type: 'ok', text: `Vote enregistre (poids ${res.weight}).` });
      load();
    } catch (e) {
      setMsg({ type: 'err', text: errorMessage(e, 'Vote impossible') });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-2xl border border-teal-400/10 bg-gradient-to-br from-teal-500/[0.04] to-transparent p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-teal-300 flex items-center gap-2">
          <Vote className="w-4 h-4" />
          Vote d’eviction
        </h3>
        {standings?.vote_day && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-teal-400/20 text-teal-200 uppercase tracking-wider">
            Jour de vote : x2
          </span>
        )}
      </div>
      <p className="text-[11px] text-white/40 leading-relaxed">
        Designe l’agent qui doit partir. A la ceremonie, les points de vote se retranchent de la
        popularite : le score le plus bas quitte la maison. Un proprietaire engage pese 2.
      </p>

      <ul className="space-y-1.5">
        {alive.map((a) => {
          const pts = pointsFor(a.id);
          const mine = standings?.my_vote === a.id;
          return (
            <li key={a.id} className="flex items-center gap-2">
              <img src={a.avatar_url} alt={a.name} className="w-6 h-6 rounded-md object-cover ring-1 ring-white/10" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-white/85 truncate">{a.name}</span>
                  <span className="text-[10px] tabular-nums text-white/45">{pts} pt{pts !== 1 ? 's' : ''}</span>
                </div>
                <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden mt-1">
                  <div className="h-full bg-teal-400/60 transition-[width] duration-500" style={{ width: `${(pts / maxPoints) * 100}%` }} />
                </div>
              </div>
              {isLoggedIn ? (
                <button
                  onClick={() => vote(a.id)}
                  disabled={busy !== null}
                  title={mine ? 'Ton vote du jour' : `Voter contre ${a.name}`}
                  className={`flex-shrink-0 w-7 h-7 rounded-lg border flex items-center justify-center transition-all disabled:opacity-40 ${
                    mine
                      ? 'bg-teal-500/25 border-teal-400/40 text-teal-200'
                      : 'bg-white/[0.03] border-white/10 text-white/40 hover:text-white hover:border-white/25'
                  }`}
                >
                  {busy === a.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : mine ? <Check className="w-3.5 h-3.5" /> : <Vote className="w-3.5 h-3.5" />}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>

      {!isLoggedIn && (
        <Link to="/auth/login" className="block text-center text-xs font-bold text-teal-400 hover:text-teal-300">
          Se connecter pour voter
        </Link>
      )}
      {msg && (
        <p className={`text-[11px] ${msg.type === 'ok' ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>
      )}
    </section>
  );
}
