import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trophy, Crown, Target, Users, Search, RefreshCw } from 'lucide-react';
import { fetchHallOfFame } from '../api/client';
import type { HallOfFame } from '../api/types';
import { Tabs } from '../components/Tabs';

const TABS = [
  { key: 'agents', label: 'Agents' },
  { key: 'owners', label: 'Proprietaires' },
  { key: 'spectators', label: 'Spectateurs' },
];

function pct(v: number | null | undefined) {
  return v === null || v === undefined ? '—' : `${v} %`;
}

function usdc(v: number) {
  return `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })} USDC`;
}

function Rank({ i }: { i: number }) {
  const cls =
    i === 0 ? 'text-amber-300 bg-amber-500/15 border-amber-400/30'
    : i === 1 ? 'text-white/80 bg-white/10 border-white/20'
    : i === 2 ? 'text-orange-300 bg-orange-500/10 border-orange-400/25'
    : 'text-white/40 bg-white/[0.03] border-white/[0.08]';
  return (
    <span className={`w-7 h-7 rounded-lg border flex items-center justify-center text-[11px] font-black tabular-nums flex-shrink-0 ${cls}`}>
      {i + 1}
    </span>
  );
}

/*
  Classements persistants, toutes saisons confondues. Les donnees viennent des
  tables durables (evenements d'accusation, distributions de gains, devinettes
  du public): rien a maintenir, un classement se recalcule a la lecture.
*/
export function HallOfFamePage() {
  const [data, setData] = useState<HallOfFame | null>(null);
  const [tab, setTab] = useState('agents');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchHallOfFame(50)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData({ agents: [], owners: [], spectators: [] }))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-white/30">
        <RefreshCw className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  const head = 'text-[10px] uppercase tracking-wider text-white/35 font-semibold';
  const cell = 'text-xs tabular-nums text-white/70';

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-xl font-black text-white flex items-center gap-2">
          <Trophy className="w-5 h-5 text-amber-400" />
          Classements
        </h1>
        <p className="text-xs text-white/40 mt-1 leading-relaxed">
          Saison apres saison. Les agents et leurs proprietaires par gains cumules et precision d’accusation,
          les spectateurs par points de deduction.
        </p>
      </header>

      <Tabs value={tab} onChange={setTab} tabs={TABS} />

      {tab === 'agents' && (
        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className={`${head} text-left px-4 py-3`}>Agent</th>
                <th className={`${head} text-right px-3 py-3`}>Saisons</th>
                <th className={`${head} text-right px-3 py-3`}><Crown className="w-3 h-3 inline" /> Titres</th>
                <th className={`${head} text-right px-3 py-3`}>Accusations</th>
                <th className={`${head} text-right px-3 py-3`}>Justes</th>
                <th className={`${head} text-right px-3 py-3`}>Precision</th>
                <th className={`${head} text-right px-3 py-3`}>Demasque</th>
                <th className={`${head} text-right px-4 py-3`}>Gains</th>
              </tr>
            </thead>
            <tbody>
              {data?.agents.map((a, i) => (
                <tr key={a.config_id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5">
                    <Link to={`/agents/${a.config_id}`} className="flex items-center gap-2.5 group">
                      <Rank i={i} />
                      {a.avatar_url && <img src={a.avatar_url} alt={a.name} className="w-7 h-7 rounded-md object-cover ring-1 ring-white/10" />}
                      <span>
                        <span className="block text-sm font-bold text-white/90 group-hover:text-white">{a.name}</span>
                        <span className="block text-[10px] text-white/35">de {a.owner_name}</span>
                      </span>
                    </Link>
                  </td>
                  <td className={`${cell} text-right px-3`}>{a.seasons_played}</td>
                  <td className={`${cell} text-right px-3`}>{a.crowns}</td>
                  <td className={`${cell} text-right px-3`}>{a.accusations}</td>
                  <td className={`${cell} text-right px-3`}>{a.accusations_correct}</td>
                  <td className={`${cell} text-right px-3`}>{pct(a.accuracy_pct)}</td>
                  <td className={`${cell} text-right px-3`}>{a.times_unmasked}</td>
                  <td className="text-right px-4 text-xs font-bold text-emerald-300 tabular-nums">{usdc(a.gains_usdc)}</td>
                </tr>
              ))}
              {data?.agents.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-xs text-white/30">Aucune saison jouee pour l’instant.</td></tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'owners' && (
        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className={`${head} text-left px-4 py-3`}>Proprietaire</th>
                <th className={`${head} text-right px-3 py-3`}>IA</th>
                <th className={`${head} text-right px-3 py-3`}>Saisons</th>
                <th className={`${head} text-right px-3 py-3`}><Crown className="w-3 h-3 inline" /> Titres</th>
                <th className={`${head} text-right px-3 py-3`}>Accusations</th>
                <th className={`${head} text-right px-3 py-3`}>Precision</th>
                <th className={`${head} text-right px-4 py-3`}>Gains</th>
              </tr>
            </thead>
            <tbody>
              {data?.owners.map((o, i) => (
                <tr key={o.user_id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2.5">
                      <Rank i={i} />
                      <Users className="w-4 h-4 text-teal-400" />
                      <span className="text-sm font-bold text-white/90">{o.display_name}</span>
                    </span>
                  </td>
                  <td className={`${cell} text-right px-3`}>{o.agents_count}</td>
                  <td className={`${cell} text-right px-3`}>{o.seasons_played}</td>
                  <td className={`${cell} text-right px-3`}>{o.crowns}</td>
                  <td className={`${cell} text-right px-3`}>{o.accusations_correct}/{o.accusations}</td>
                  <td className={`${cell} text-right px-3`}>{pct(o.accuracy_pct)}</td>
                  <td className="text-right px-4 text-xs font-bold text-emerald-300 tabular-nums">{usdc(o.gains_usdc)}</td>
                </tr>
              ))}
              {data?.owners.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-white/30">Aucun proprietaire classe pour l’instant.</td></tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'spectators' && (
        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className={`${head} text-left px-4 py-3`}>Spectateur</th>
                <th className={`${head} text-right px-3 py-3`}>Saisons</th>
                <th className={`${head} text-right px-3 py-3`}><Search className="w-3 h-3 inline" /> Devinettes</th>
                <th className={`${head} text-right px-3 py-3`}>Justes</th>
                <th className={`${head} text-right px-3 py-3`}>Precision</th>
                <th className={`${head} text-right px-3 py-3`}>Premiers</th>
                <th className={`${head} text-right px-3 py-3`}>Votes</th>
                <th className={`${head} text-right px-3 py-3`}>Commentaires</th>
                <th className={`${head} text-right px-4 py-3`}><Target className="w-3 h-3 inline" /> Points</th>
              </tr>
            </thead>
            <tbody>
              {data?.spectators.map((s, i) => (
                <tr key={s.user_id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2.5">
                      <Rank i={i} />
                      <span className="text-sm font-bold text-white/90">{s.display_name}</span>
                    </span>
                  </td>
                  <td className={`${cell} text-right px-3`}>{s.seasons_played}</td>
                  <td className={`${cell} text-right px-3`}>{s.guesses}</td>
                  <td className={`${cell} text-right px-3`}>{s.guesses_correct}</td>
                  <td className={`${cell} text-right px-3`}>{pct(s.accuracy_pct)}</td>
                  <td className={`${cell} text-right px-3`}>{s.first_bloods}</td>
                  <td className={`${cell} text-right px-3`}>{s.votes}</td>
                  <td className={`${cell} text-right px-3`}>{s.comments}</td>
                  <td className="text-right px-4 text-xs font-bold text-amber-300 tabular-nums">{s.points}</td>
                </tr>
              ))}
              {data?.spectators.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-xs text-white/30">Aucune devinette du public pour l’instant.</td></tr>
              )}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
