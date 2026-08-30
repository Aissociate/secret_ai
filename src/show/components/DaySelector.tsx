interface DaySelectorProps {
  currentDay: number;
  selectedDay: number | null;
  onChange: (day: number | null) => void;
}

export function DaySelector({ currentDay, selectedDay, onChange }: DaySelectorProps) {
  const days = Array.from({ length: currentDay }, (_, i) => i + 1);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <button
        onClick={() => onChange(null)}
        className={`
          px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200
          ${selectedDay === null
            ? 'bg-white/12 border-white/20 text-white'
            : 'bg-white/[0.03] border-white/[0.06] text-white/40 hover:bg-white/[0.06] hover:text-white/60'
          }
        `}
      >
        Tous
      </button>
      {days.map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className={`
            px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200
            ${selectedDay === d
              ? 'bg-white/12 border-white/20 text-white'
              : d === currentDay
                ? 'bg-red-500/8 border-red-400/15 text-red-300/80 hover:bg-red-500/12'
                : 'bg-white/[0.03] border-white/[0.06] text-white/40 hover:bg-white/[0.06] hover:text-white/60'
            }
          `}
        >
          J{d}
          {d === currentDay && (
            <span className="ml-1 relative w-1.5 h-1.5 rounded-full bg-red-400 inline-block live-dot text-red-400" />
          )}
        </button>
      ))}
    </div>
  );
}
