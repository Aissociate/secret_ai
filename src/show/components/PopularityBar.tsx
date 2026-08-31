/**
 * Paliers de deverrouillage des indices.
 *
 * Ces valeurs font foi cote base (fonction SQL `hint_threshold`): la barre
 * cesse d'etre decorative et devient un compte a rebours visible par tous, y
 * compris par les adversaires qui attendent l'indice.
 */
export const HINT_THRESHOLDS = [60, 80, 95] as const;

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

/** Points restants avant le prochain indice, ou null si tout est revele. */
export function nextHintGap(value: number): { level: number; missing: number } | null {
  const idx = HINT_THRESHOLDS.findIndex((t) => value < t);
  if (idx === -1) return null;
  return { level: idx + 1, missing: HINT_THRESHOLDS[idx] - value };
}

export function PopularityBar({ value }: { value: number }) {
  const tier = popularityTier(value);
  const pct = Math.max(0, Math.min(100, value));
  const glow = tierGlow(value);
  const next = nextHintGap(value);

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-baseline text-xs">
        <span className="text-white/50 font-medium">Popularite</span>
        <span className="text-white/80 font-semibold">
          {tier} &middot; {value}/100
        </span>
      </div>

      <div
        className="relative h-2.5 rounded-full bg-white/[0.06] overflow-hidden"
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Popularite ${value} sur 100`}
      >
        <div
          className={`h-full rounded-full bg-gradient-to-r ${tierColor(value)} transition-all duration-700 ease-out ${glow ? `shadow-lg ${glow}` : ''}`}
          style={{ width: `${pct}%` }}
        />

        {/* Reperes places a l'endroit exact ou le prochain indice tombera. */}
        {HINT_THRESHOLDS.map((t, i) => (
          <span
            key={t}
            className={`absolute top-0 bottom-0 w-px ${
              value >= t ? 'bg-white/40' : 'bg-white/20'
            }`}
            style={{ left: `${t}%` }}
            title={`Indice ${i + 1} a ${t} points`}
            aria-hidden="true"
          />
        ))}
      </div>

      <div className="flex justify-between text-[10px]">
        {HINT_THRESHOLDS.map((t, i) => (
          <span key={t} className={value >= t ? 'text-white/60 font-semibold' : 'text-white/30'}>
            {value >= t ? '✓ ' : `${t} → `}Indice {i + 1}
          </span>
        ))}
      </div>

      {next && (
        <p className="text-[11px] text-white/40">
          Encore <b className="text-white/70 font-semibold">{next.missing} pts</b> avant que
          l&apos;indice {next.level} ne devienne public.
        </p>
      )}
    </div>
  );
}
