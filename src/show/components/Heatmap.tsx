import { useState } from 'react';

interface HeatmapProps {
  labels: string[];
  matrix: number[][];
}

function cellBg(value: number, isDiag: boolean) {
  if (isDiag) return 'bg-white/[0.02]';
  const intensity = Math.max(0, Math.min(1, value / 100));
  if (intensity > 0.7) return 'bg-red-500/30 border-red-400/20';
  if (intensity > 0.4) return 'bg-amber-500/20 border-amber-400/15';
  if (intensity > 0.1) return 'bg-sky-500/15 border-sky-400/10';
  return 'bg-white/[0.03]';
}

export function Heatmap({ labels, matrix }: HeatmapProps) {
  const [focus, setFocus] = useState<string | null>(null);

  if (labels.length === 0) {
    return (
      <div className="text-sm text-white/40 text-center py-8">
        Pas de donnees de suspicion.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto -mx-2 px-2">
        <table className="border-separate" style={{ borderSpacing: 3 }}>
          <thead>
            <tr>
              <th className="w-24" />
              {labels.map((l, idx) => (
                <th
                  key={idx}
                  className="text-[10px] text-white/50 font-medium px-1 text-center"
                  style={{ minWidth: 52 }}
                >
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((rowLabel, i) => (
              <tr key={i}>
                <td className="text-[11px] text-white/60 font-medium pr-2 text-right whitespace-nowrap">
                  {rowLabel}
                </td>
                {labels.map((colLabel, j) => {
                  const v = matrix?.[i]?.[j] ?? 0;
                  const isDiag = i === j;
                  return (
                    <td key={j}>
                      <button
                        onClick={() =>
                          setFocus(
                            isDiag
                              ? null
                              : `${rowLabel} suspecte ${colLabel} : ${v}%`
                          )
                        }
                        className={`
                          w-12 h-9 rounded-lg border border-white/[0.06] text-xs font-mono
                          transition-all duration-200 hover:scale-105
                          ${cellBg(v, isDiag)}
                          ${isDiag ? 'text-white/20 cursor-default' : 'text-white/70 cursor-pointer hover:border-white/20'}
                        `}
                        title={
                          isDiag
                            ? ''
                            : `${rowLabel} suspecte ${colLabel}: ${v}%`
                        }
                      >
                        {isDiag ? '\u2014' : `${v}%`}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {focus && (
        <div className="text-sm text-white/70 bg-white/5 border border-white/[0.08] rounded-xl px-4 py-2.5 animate-fade-up">
          {focus}
        </div>
      )}
    </div>
  );
}
