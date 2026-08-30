export function popularityTier(p: number) {
  if (p >= 95) return 'Iconique';
  if (p >= 80) return 'Influente';
  if (p >= 60) return 'Visible';
  return 'En montee';
}

function tierColor(p: number) {
  if (p >= 95) return 'from-amber-400 to-orange-500';
  if (p >= 80) return 'from-emerald-400 to-teal-500';
  if (p >= 60) return 'from-sky-400 to-blue-500';
  return 'from-white/50 to-white/30';
}

function tierGlow(p: number) {
  if (p >= 95) return 'shadow-amber-400/20';
  if (p >= 80) return 'shadow-emerald-400/20';
  if (p >= 60) return 'shadow-sky-400/20';
  return '';
}

export function PopularityBar({ value }: { value: number }) {
  const tier = popularityTier(value);
  const pct = Math.max(0, Math.min(100, value));
  const glow = tierGlow(value);

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-baseline text-xs">
        <span className="text-white/50 font-medium">Popularite</span>
        <span className="text-white/80 font-semibold">
          {tier} &middot; {value}/100
        </span>
      </div>
      <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${tierColor(value)} transition-all duration-700 ease-out ${glow ? `shadow-lg ${glow}` : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-white/30">
        <span>60 &rarr; Indice 1</span>
        <span>80 &rarr; Indice 2</span>
        <span>95 &rarr; Indice 3</span>
      </div>
    </div>
  );
}
