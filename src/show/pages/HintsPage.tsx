import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Key, Lock, Unlock, TrendingUp, MessageSquare } from 'lucide-react';
import { fetchHintsBoard } from '../api/client';
import type { SeasonHintsBoard } from '../api/types';
import { HintCard } from '../components/HintCard';

const THRESHOLDS = [60, 80, 95];

export function HintsPage() {
  const { seasonId } = useParams();
  const sid = seasonId!;
  const [board, setBoard] = useState<SeasonHintsBoard>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchHintsBoard(sid)
      .then(setBoard)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [sid]);

  const stats = useMemo(() => {
    let totalHints = 0;
    let unlockedHints = 0;
    const closestUnlock: { agent: string; points: number } | null = (() => {
      let best: { agent: string; points: number } | null = null;
      for (const row of board) {
        totalHints += row.hints.length;
        unlockedHints += row.hints.filter((h) => h.unlocked).length;
        const unlockedCount = row.hints.filter((h) => h.unlocked).length;
        const nextThreshold = THRESHOLDS[unlockedCount];
        if (nextThreshold !== undefined) {
          const remaining = nextThreshold - row.agent.popularity;
          if (remaining > 0 && (!best || remaining < best.points)) {
            best = { agent: row.agent.name, points: remaining };
          }
        }
      }
      return best;
    })();
    return { totalHints, unlockedHints, closestUnlock };
  }, [board]);

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-br from-white/[0.03] via-transparent to-emerald-500/[0.03] p-5 sm:p-6">
        <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-500/[0.04] rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-2">
            <Key className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
              Theories & indices
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-white">Hint Board</h1>
          <p className="text-sm text-white/40 mt-1">
            Les indices se debloquent via la popularite. Plus une IA est regardee, plus ses secrets se revelent.
          </p>
        </div>
      </div>

      {!loading && board.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="border border-white/[0.06] rounded-xl p-3 bg-white/[0.02]">
            <div className="flex items-center gap-1.5 mb-1">
              <Key className="w-3 h-3 text-emerald-400" />
              <span className="text-[10px] text-white/40 font-bold uppercase">Indices</span>
            </div>
            <div className="text-lg font-black text-white">{stats.unlockedHints}/{stats.totalHints}</div>
            <div className="text-[10px] text-white/25">debloques</div>
          </div>

          <div className="border border-white/[0.06] rounded-xl p-3 bg-white/[0.02]">
            <div className="flex items-center gap-1.5 mb-1">
              <Lock className="w-3 h-3 text-white/30" />
              <span className="text-[10px] text-white/40 font-bold uppercase">Restants</span>
            </div>
            <div className="text-lg font-black text-white">{stats.totalHints - stats.unlockedHints}</div>
            <div className="text-[10px] text-white/25">a debloquer</div>
          </div>

          <div className="border border-white/[0.06] rounded-xl p-3 bg-white/[0.02]">
            <div className="flex items-center gap-1.5 mb-1">
              <Unlock className="w-3 h-3 text-amber-400" />
              <span className="text-[10px] text-white/40 font-bold uppercase">Prochain</span>
            </div>
            <div className="text-sm font-bold text-white truncate">
              {stats.closestUnlock ? stats.closestUnlock.agent : '--'}
            </div>
            <div className="text-[10px] text-white/25">
              {stats.closestUnlock ? `${stats.closestUnlock.points} pts restants` : 'aucun'}
            </div>
          </div>

          <div className="border border-white/[0.06] rounded-xl p-3 bg-white/[0.02]">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingUp className="w-3 h-3 text-sky-400" />
              <span className="text-[10px] text-white/40 font-bold uppercase">Paliers</span>
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              {THRESHOLDS.map((t) => (
                <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] text-white/40 font-mono">
                  {t}
                </span>
              ))}
            </div>
            <div className="text-[10px] text-white/25 mt-1">pts popularite</div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-48 rounded-2xl" />
          ))}
        </div>
      ) : board.length === 0 ? (
        <div className="text-center py-16 text-white/40 text-sm border border-white/[0.06] rounded-2xl bg-white/[0.01]">
          Aucun agent dans cette saison.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {board.map((row) => (
              <HintCard key={row.agent.id} agent={row.agent} hints={row.hints} />
            ))}
          </div>

          <div className="border border-emerald-400/10 rounded-2xl p-5 bg-gradient-to-br from-emerald-500/[0.03] to-transparent">
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-emerald-300">Theories du public</h3>
            </div>
            <p className="text-xs text-white/40 leading-relaxed mb-3">
              Un espace pour partager vos theories sur le mot secret de chaque agent.
              Observez les indices, analysez les comportements, et tentez de deviner avant les autres.
            </p>
            <div className="text-[10px] text-white/20">
              Bientot disponible : discussions et votes sur les theories.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
