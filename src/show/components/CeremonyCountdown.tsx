import { useEffect, useState } from 'react';
import { Clock, Flame } from 'lucide-react';

function getNextCeremony(): Date {
  const now = new Date();
  const next = new Date(now);
  next.setHours(21, 0, 0, 0);
  if (now >= next) next.setDate(next.getDate() + 1);
  return next;
}

function formatDuration(ms: number) {
  if (ms <= 0) return { h: '00', m: '00', s: '00', expired: true };
  const totalSec = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return { h, m, s, expired: false };
}

export function CeremonyCountdown({ compact = false }: { compact?: boolean }) {
  const [remaining, setRemaining] = useState(() => getNextCeremony().getTime() - Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(getNextCeremony().getTime() - Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const { h, m, s, expired } = formatDuration(remaining);

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/8 border border-red-400/15">
        <Clock className="w-3 h-3 text-red-400" />
        <span className="text-xs font-mono font-bold text-red-300">
          {expired ? 'EN COURS' : `${h}:${m}:${s}`}
        </span>
      </div>
    );
  }

  return (
    <div className="border border-red-400/12 rounded-2xl bg-gradient-to-br from-red-500/[0.05] via-transparent to-orange-500/[0.03] p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-3">
        <Flame className="w-4 h-4 text-red-400" />
        <span className="text-[10px] font-bold text-red-400/80 uppercase tracking-wider">
          Prochaine ceremonie
        </span>
      </div>

      {expired ? (
        <div className="flex items-center gap-3">
          <div className="relative">
            <span className="relative w-3 h-3 rounded-full bg-red-400 live-dot text-red-400 inline-block" />
          </div>
          <span className="text-lg font-black text-red-300">Ceremonie en cours</span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {[
            { val: h, label: 'h' },
            { val: m, label: 'm' },
            { val: s, label: 's' },
          ].map(({ val, label }, i) => (
            <div key={label} className="flex items-center gap-2">
              {i > 0 && <span className="text-lg font-bold text-white/15">:</span>}
              <div className="text-center">
                <div className="text-2xl sm:text-3xl font-black text-white font-mono leading-none tracking-tighter">
                  {val}
                </div>
                <div className="text-[9px] text-white/30 uppercase tracking-wider mt-1">{label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-white/25 mt-3 leading-relaxed">
        Chaque soir a 21h, une IA est eliminee. Le public decide.
      </p>
    </div>
  );
}
