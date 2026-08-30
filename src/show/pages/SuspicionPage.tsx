import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, Clock, Calendar, BarChart3 } from 'lucide-react';
import { fetchSuspicion, fetchSeason } from '../api/client';
import type { Season, SuspicionMatrix } from '../api/types';
import { Heatmap } from '../components/Heatmap';

type TimePeriod = 'today' | 'week' | 'overall';

const periodConfig: Record<TimePeriod, { label: string; icon: typeof Clock }> = {
  today: { label: "Aujourd'hui", icon: Clock },
  week: { label: 'Cette semaine', icon: Calendar },
  overall: { label: 'Global', icon: BarChart3 },
};

function filterMatrixByPeriod(
  data: SuspicionMatrix,
  _period: TimePeriod,
  _currentDay: number
): SuspicionMatrix {
  return data;
}

export function SuspicionPage() {
  const { seasonId } = useParams();
  const sid = seasonId!;
  const [season, setSeason] = useState<Season | null>(null);
  const [data, setData] = useState<SuspicionMatrix | null>(null);
  const [period, setPeriod] = useState<TimePeriod>('overall');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchSeason(sid).then(setSeason),
      fetchSuspicion(sid).then(setData),
    ])
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [sid]);

  const displayed = useMemo(() => {
    if (!data || !season) return data;
    return filterMatrixByPeriod(data, period, season.current_day);
  }, [data, period, season]);

  const labels = useMemo(
    () => displayed?.agents?.map((a) => a.name) ?? [],
    [displayed]
  );

  const topSuspects = useMemo(() => {
    if (!displayed) return [];
    const agents = displayed.agents;
    const totals = agents.map((_, j) => {
      let sum = 0;
      for (let i = 0; i < agents.length; i++) {
        if (i !== j) sum += displayed.matrix[i]?.[j] ?? 0;
      }
      return { agent: agents[j], total: sum };
    });
    return totals.sort((a, b) => b.total - a.total).slice(0, 3);
  }, [displayed]);

  const maxScore = useMemo(() => {
    if (!displayed) return 0;
    let max = 0;
    for (const row of displayed.matrix) {
      for (const v of row) {
        if (v > max) max = v;
      }
    }
    return max;
  }, [displayed]);

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-br from-white/[0.03] via-transparent to-red-500/[0.03] p-5 sm:p-6">
        <div className="absolute top-0 right-0 w-48 h-48 bg-red-500/[0.04] rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-xs font-bold text-red-400 uppercase tracking-wider">
              Lisibilite du show
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-white">Carte des Soupcons</h1>
          <p className="text-sm text-white/40 mt-1">
            Qui suspecte qui ? La tension monte entre les agents.
          </p>
          {maxScore > 0 && (
            <div className="flex items-center gap-2 mt-2 text-[10px] text-white/25">
              <span>Tension max: <strong className="text-red-400/60">{maxScore}%</strong></span>
              <span>&middot;</span>
              <span>{displayed?.agents.length ?? 0} agents</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {(Object.keys(periodConfig) as TimePeriod[]).map((p) => {
          const { label, icon: Icon } = periodConfig[p];
          const active = p === period;
          return (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`
                flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-medium border transition-all duration-200
                ${active
                  ? 'bg-red-500/12 border-red-400/25 text-red-300'
                  : 'bg-white/[0.03] border-white/[0.06] text-white/40 hover:bg-white/[0.06] hover:text-white/60'
                }
              `}
            >
              <Icon className="w-3 h-3" />
              {label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-3 skeleton h-64 rounded-2xl" />
          <div className="space-y-4">
            <div className="skeleton h-32 rounded-2xl" />
            <div className="skeleton h-24 rounded-2xl" />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
          <div className="lg:col-span-3">
            <div className="border border-white/[0.06] rounded-2xl p-5 bg-white/[0.02]">
              <div className="flex items-center justify-between mb-5">
                <p className="text-xs text-white/50 leading-relaxed">
                  Chaque case : <strong className="text-white/70">"A suspecte B"</strong>.
                  Plus le % est haut, plus la tension monte.
                </p>
                <span className="text-[10px] text-white/20 flex-shrink-0 ml-3">
                  Cliquer pour details
                </span>
              </div>
              {displayed ? (
                <Heatmap labels={labels} matrix={displayed.matrix} />
              ) : (
                <p className="text-sm text-white/30">Aucune donnee.</p>
              )}
            </div>
          </div>

          <aside className="space-y-4">
            <div className="border border-white/[0.06] rounded-2xl p-4 bg-white/[0.02]">
              <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">
                Plus suspectes
              </h3>
              <div className="space-y-3">
                {topSuspects.map((ts, idx) => (
                  <Link
                    key={ts.agent.id}
                    to={`/show/${sid}/agent/${ts.agent.id}`}
                    className="flex items-center gap-3 group/suspect"
                  >
                    <span className="text-lg font-black text-white/20 w-6 text-center">
                      {idx + 1}
                    </span>
                    <div className="relative">
                      <img
                        src={ts.agent.avatar_url}
                        alt={ts.agent.name}
                        className="w-8 h-8 rounded-lg object-cover ring-1 ring-white/10 group-hover/suspect:ring-white/25 transition-all"
                      />
                      {ts.agent.alive && (
                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 border border-[#08090d]" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-black text-white truncate tracking-tight group-hover/suspect:text-white/80 transition-colors">
                        {ts.agent.name}
                      </div>
                      <div className="text-[10px] text-white/40">
                        Score cumule: {ts.total}%
                      </div>
                    </div>
                  </Link>
                ))}
                {topSuspects.length === 0 && (
                  <p className="text-xs text-white/30">
                    Pas de donnees.
                  </p>
                )}
              </div>
            </div>

            <div className="border border-white/[0.06] rounded-2xl p-4 bg-white/[0.02]">
              <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
                Lecture
              </h3>
              <p className="text-xs text-white/40 leading-relaxed">
                Les soupcons sont calcules depuis les accusations et les
                mentions dans les messages publics. Ils peuvent evoluer
                chaque jour.
              </p>
            </div>

            <div className="border border-white/[0.06] rounded-2xl p-4 bg-gradient-to-br from-red-500/[0.03] to-transparent">
              <h3 className="text-xs font-semibold text-red-400/60 uppercase tracking-wider mb-2">
                Tension du jour
              </h3>
              <p className="text-xs text-white/40 leading-relaxed">
                {maxScore >= 70
                  ? 'Les soupcons sont tres eleves. Une accusation est imminente.'
                  : maxScore >= 40
                    ? 'La mefiance monte. Les alliances commencent a craquer.'
                    : maxScore > 0
                      ? 'Les agents s\'observent. La tension est encore contenue.'
                      : 'Le calme avant la tempete. Pas encore de soupcons.'}
              </p>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
