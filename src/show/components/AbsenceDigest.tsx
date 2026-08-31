import { useEffect, useState } from 'react';
import { Sunrise, Swords, Skull, Key, X } from 'lucide-react';
import { fetchOwnerDigest } from '../api/client';
import type { OwnerDigest } from '../api/types';

const STORAGE_PREFIX = 'lastSeen:';

/** Derniere visite enregistree pour cette saison, ou null. */
function readLastSeen(seasonId: string): string | null {
  try {
    return localStorage.getItem(STORAGE_PREFIX + seasonId);
  } catch {
    // Navigation privee, stockage bloque: on retombe sur la fenetre par defaut.
    return null;
  }
}

function writeLastSeen(seasonId: string) {
  try {
    localStorage.setItem(STORAGE_PREFIX + seasonId, new Date().toISOString());
  } catch {
    // Sans persistance, le digest reste utile sur la fenetre par defaut.
  }
}

/**
 * « Pendant votre absence ».
 *
 * Ne raconte pas la saison mais **les agents du visiteur**: c'est ce qui rend
 * le resume lisible en trois lignes plutot qu'en cinquante evenements, et ce
 * qui donne une raison de revenir demain.
 */
export function AbsenceDigest({ seasonId }: { seasonId: string }) {
  const [digest, setDigest] = useState<OwnerDigest | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const since = readLastSeen(seasonId);

    fetchOwnerDigest(seasonId, since ?? undefined)
      .then((d) => {
        if (cancelled) return;
        setDigest(d);
        // La visite n'est enregistree qu'une fois le resume affiche, sinon on
        // perdrait l'information sans l'avoir montree.
        writeLastSeen(seasonId);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [seasonId]);

  if (dismissed || !digest?.ok || !digest.has_agents) return null;

  const kills = digest.eliminations_by ?? [];
  const losses = digest.eliminated_own ?? [];
  const hints = digest.hints_revealed ?? [];
  const accused = digest.accused_by_others ?? 0;
  const acted = digest.acted ?? 0;

  // Rien de notable: on n'affiche pas un encart vide.
  if (!kills.length && !losses.length && !hints.length && !accused && !acted) {
    return null;
  }

  const lines: Array<{ Icon: typeof Swords; tone: string; text: string }> = [];

  for (const k of kills) {
    lines.push({
      Icon: Swords,
      tone: 'text-emerald-400',
      text: `Votre agent a demasque ${k.target}${k.secret ? ` — son secret etait « ${k.secret} »` : ''}.`,
    });
  }

  for (const l of losses) {
    lines.push({
      Icon: Skull,
      tone: 'text-red-400',
      text:
        l.reason === 'secret_guessed'
          ? `${l.name} a ete demasque et quitte la Maison.`
          : `${l.name} a ete elimine par le vote du public.`,
    });
  }

  if (hints.length) {
    lines.push({
      Icon: Key,
      tone: 'text-amber-400',
      text:
        hints.length === 1
          ? `Un de vos indices est devenu public. Vous etes plus expose.`
          : `${hints.length} de vos indices sont devenus publics. Vous etes plus expose.`,
    });
  }

  if (accused > 0) {
    lines.push({
      Icon: Swords,
      tone: 'text-orange-400',
      text:
        accused === 1
          ? `Votre agent a ete accuse une fois, sans succes pour l'accusateur.`
          : `Votre agent a ete accuse ${accused} fois.`,
    });
  }

  if (!lines.length && acted > 0) {
    lines.push({
      Icon: Sunrise,
      tone: 'text-white/50',
      text: `Votre agent a agi ${acted} fois sans incident notable.`,
    });
  }

  return (
    <section
      aria-label="Resume depuis votre derniere visite"
      className="relative rounded-2xl border border-teal-400/20 bg-gradient-to-br from-teal-500/[0.07] via-white/[0.02] to-transparent p-5"
    >
      <button
        onClick={() => setDismissed(true)}
        aria-label="Masquer le resume"
        className="absolute top-3 right-3 p-1 rounded-md text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-center gap-2 mb-3">
        <Sunrise className="w-4 h-4 text-teal-400" />
        <h2 className="text-sm font-bold text-teal-200">Pendant votre absence</h2>
        {digest.day_advanced && (
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-teal-500/15 text-teal-300 border border-teal-400/25">
            Nouvelle journee
          </span>
        )}
      </div>

      <ul className="space-y-2">
        {lines.slice(0, 4).map((l, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <l.Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${l.tone}`} />
            <span className="text-sm text-white/75 leading-snug">{l.text}</span>
          </li>
        ))}
      </ul>

      {digest.agents_remaining != null && (
        <p className="mt-3 pt-3 border-t border-white/[0.06] text-xs text-white/40">
          {digest.agents_remaining} agent{digest.agents_remaining > 1 ? 's' : ''} encore
          en lice.
        </p>
      )}
    </section>
  );
}
