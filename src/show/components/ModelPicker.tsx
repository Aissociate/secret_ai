import { useMemo, useState } from 'react';
import { Search, Check, ChevronDown, X } from 'lucide-react';

/**
 * Selection d'un modele dans le catalogue OpenRouter.
 *
 * Le catalogue comptait quatre entrees maison; il en compte desormais 395,
 * reels. Les deux ecrans qui le presentaient n'avaient pas ete repris a cette
 * echelle: la page agent affichait les 395 fiches d'affilee, sans recherche, et
 * le panneau d'administration se contentait d'un filtre texte tronque a 120
 * resultats sans dire lequel etait retenu.
 *
 * Trois principes ici:
 *
 * 1. **Le choix courant reste visible.** Il est epingle en tete, meme quand le
 *    filtre l'exclut. Sans cela on fait defiler une liste sans savoir ce qui
 *    est selectionne, et on ne peut pas comparer une piste au choix en place.
 * 2. **On reduit avant de parcourir.** Recherche, fournisseur et « gratuits »
 *    ramenent 395 lignes a une dizaine; le tri par palier ou par prix repond
 *    aux deux questions qu'on se pose reellement.
 * 3. **La liste est bornee.** Elle s'allonge a la demande plutot que de rendre
 *    quelques centaines de lignes qu'aucun oeil ne parcourt.
 */

export type PickerModel = {
  slug: string;
  label: string;
  provider: string;
  tier: string;
  is_free: boolean;
  blurb: string | null;
  price_in_per_mtok: number;
  price_out_per_mtok: number;
  context_length: number;
};

const TIER_LABEL: Record<string, string> = {
  gratuit: 'Recrue — Gratuit',
  economique: 'Soldat — Economique',
  standard: 'Officier — Standard',
  avance: 'General — Avance',
  elite: 'Marechal — Elite',
};

const TIER_ORDER = ['gratuit', 'economique', 'standard', 'avance', 'elite'];

const TIER_COLOR: Record<string, string> = {
  gratuit: 'text-emerald-400 bg-emerald-400/10',
  economique: 'text-sky-400 bg-sky-400/10',
  standard: 'text-orange-400 bg-orange-400/10',
  avance: 'text-rose-400 bg-rose-400/10',
  elite: 'text-amber-300 bg-amber-300/10',
};

/*
  Les classes sont ecrites en toutes lettres: Tailwind lit le source et ne
  verrait pas une classe assemblee a l'execution.
*/
const ACCENT = {
  orange: {
    radio: 'accent-orange-400',
    ring: 'focus-visible:ring-orange-400',
    selected: 'border-orange-400/40 bg-orange-500/[0.07]',
    pinned: 'border-orange-400/30 bg-orange-500/[0.06]',
    chip: 'text-orange-300 bg-orange-400/10',
    action: 'text-orange-300 border-orange-400/25 hover:bg-orange-500/10',
  },
  teal: {
    radio: 'accent-teal-400',
    ring: 'focus-visible:ring-teal-400',
    selected: 'border-teal-400/40 bg-teal-500/[0.09]',
    pinned: 'border-teal-400/30 bg-teal-500/[0.07]',
    chip: 'text-teal-300 bg-teal-400/10',
    action: 'text-teal-300 border-teal-400/25 hover:bg-teal-500/10',
  },
} as const;

const PAGE = 25;

/** Un tarif sous 1 perd tout son sens arrondi au centieme. */
function money(value: number): string {
  if (value >= 1) return value.toFixed(2);
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function priceLabel(m: PickerModel, margin: number, currency: string): string {
  if (m.is_free || (m.price_in_per_mtok === 0 && m.price_out_per_mtok === 0)) {
    return 'Gratuit';
  }
  return `${money(m.price_in_per_mtok * margin)} / ${money(m.price_out_per_mtok * margin)} ${currency} par Mtok`;
}

function contextLabel(tokens: number): string | null {
  if (!tokens) return null;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M contexte`;
  return `${Math.round(tokens / 1000)}k contexte`;
}

export function ModelPicker({
  models,
  value,
  onChange,
  name,
  accent = 'orange',
  margin = 1,
  currency = 'USDC',
}: {
  models: PickerModel[];
  value: string | null;
  onChange: (slug: string) => void;
  /** Distingue les groupes radio quand deux listes coexistent sur la page. */
  name: string;
  accent?: keyof typeof ACCENT;
  /** Multiplicateur applique aux tarifs affiches (marge de la plateforme). */
  margin?: number;
  currency?: string;
}) {
  const c = ACCENT[accent];

  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);
  const [byPrice, setByPrice] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  const selected = useMemo(
    () => models.find((m) => m.slug === value) ?? null,
    [models, value]
  );

  const providers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of models) counts.set(m.provider, (counts.get(m.provider) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [models]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = models.filter((m) => {
      if (freeOnly && !m.is_free) return false;
      if (provider && m.provider !== provider) return false;
      if (!q) return true;
      return (
        m.slug.toLowerCase().includes(q) ||
        m.label.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q)
      );
    });

    if (byPrice) {
      return [...out].sort(
        (a, b) => a.price_out_per_mtok - b.price_out_per_mtok || a.slug.localeCompare(b.slug)
      );
    }
    return [...out].sort(
      (a, b) =>
        TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) ||
        a.price_out_per_mtok - b.price_out_per_mtok ||
        a.slug.localeCompare(b.slug)
    );
  }, [models, query, provider, freeOnly, byPrice]);

  const shown = matches.slice(0, limit);
  const filtering = Boolean(query.trim() || provider || freeOnly);

  function reset() {
    setQuery('');
    setProvider('');
    setFreeOnly(false);
    setLimit(PAGE);
  }

  function pick(slug: string) {
    onChange(slug);
  }

  /*
    Les en-tetes de palier n'apparaissent que dans le tri par palier: en tri par
    prix elles decouperaient la liste a contretemps de ce qu'on lit.
  */
  let lastTier: string | null = null;

  return (
    <div className="space-y-3">
      {selected && (
        <div className={`rounded-xl border p-3 ${c.pinned}`}>
          <div className="flex items-start gap-2.5">
            <Check className={`w-4 h-4 mt-0.5 flex-shrink-0 ${c.chip.split(' ')[0]}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-white truncate">{selected.label}</span>
                <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${TIER_COLOR[selected.tier] ?? 'bg-white/[0.06] text-white/40'}`}>
                  {TIER_LABEL[selected.tier]?.split(' — ')[0] ?? selected.tier}
                </span>
              </div>
              <p className="text-[10px] font-mono text-white/35 truncate mt-0.5">{selected.slug}</p>
              <p className="text-[11px] text-white/45 mt-1">
                {priceLabel(selected, margin, currency)}
                {contextLabel(selected.context_length) && ` · ${contextLabel(selected.context_length)}`}
              </p>
              {selected.blurb && (
                <p className="text-[11px] text-white/40 mt-1.5 leading-relaxed">{selected.blurb}</p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/25 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
            aria-label={`Rechercher parmi ${models.length} modeles`}
            placeholder={`Rechercher parmi ${models.length} modeles…`}
            className={`w-full pl-9 pr-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white text-sm placeholder:text-white/25 focus:outline-none focus-visible:ring-2 ${c.ring}`}
          />
        </div>

        <div className="relative">
          <select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              setLimit(PAGE);
            }}
            aria-label="Filtrer par fournisseur"
            className={`appearance-none pl-3 pr-8 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white/80 text-xs focus:outline-none focus-visible:ring-2 ${c.ring}`}
          >
            <option value="">Tous fournisseurs</option>
            {providers.map(([p, n]) => (
              <option key={p} value={p}>
                {p} ({n})
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/25 pointer-events-none" />
        </div>

        <button
          type="button"
          onClick={() => {
            setFreeOnly((v) => !v);
            setLimit(PAGE);
          }}
          aria-pressed={freeOnly}
          className={`px-3 py-2 rounded-xl border text-xs font-medium transition-colors ${
            freeOnly
              ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
              : 'border-white/10 bg-white/[0.04] text-white/50 hover:text-white/75'
          }`}
        >
          Gratuits
        </button>

        <button
          type="button"
          onClick={() => setByPrice((v) => !v)}
          aria-pressed={byPrice}
          className={`px-3 py-2 rounded-xl border text-xs font-medium transition-colors ${
            byPrice
              ? `border-white/20 bg-white/[0.08] text-white/80`
              : 'border-white/10 bg-white/[0.04] text-white/50 hover:text-white/75'
          }`}
        >
          {byPrice ? 'Par prix' : 'Par palier'}
        </button>
      </div>

      <div className="flex items-center justify-between text-[11px] text-white/35">
        <span>
          {matches.length === models.length
            ? `${models.length} modeles`
            : `${matches.length} sur ${models.length}`}
        </span>
        {filtering && (
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-1 text-white/40 hover:text-white/70 transition-colors"
          >
            <X className="w-3 h-3" />
            Reinitialiser
          </button>
        )}
      </div>

      <div
        role="radiogroup"
        aria-label="Modele"
        className="max-h-[30rem] overflow-y-auto rounded-xl border border-white/[0.08] divide-y divide-white/[0.04]"
      >
        {shown.map((m) => {
          const isSelected = value === m.slug;
          const header = !byPrice && m.tier !== lastTier ? m.tier : null;
          lastTier = m.tier;

          return (
            <div key={m.slug}>
              {header && (
                <p
                  className={`sticky top-0 z-10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-black/80 backdrop-blur-sm ${
                    TIER_COLOR[header]?.split(' ')[0] ?? 'text-white/40'
                  }`}
                >
                  {TIER_LABEL[header] ?? header}
                </p>
              )}
              <label
                className={`flex items-start gap-3 px-3 py-2.5 cursor-pointer border-l-2 transition-colors ${
                  isSelected
                    ? `${c.selected} border-l-current`
                    : 'border-l-transparent hover:bg-white/[0.03]'
                }`}
              >
                <input
                  type="radio"
                  name={name}
                  value={m.slug}
                  checked={isSelected}
                  onChange={() => pick(m.slug)}
                  className={`mt-0.5 flex-shrink-0 ${c.radio}`}
                />
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white">{m.label}</span>
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/[0.06] text-white/45">
                      {m.provider}
                    </span>
                    {m.is_free && (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded text-emerald-300 bg-emerald-400/10">
                        Gratuit
                      </span>
                    )}
                  </span>
                  <span className="flex flex-wrap items-baseline gap-x-2 text-[10px] font-mono text-white/35 mt-0.5">
                    <span className="text-white/30 truncate max-w-full">{m.slug}</span>
                    <span aria-hidden="true" className="text-white/15">·</span>
                    <span>{priceLabel(m, margin, currency)}</span>
                    {contextLabel(m.context_length) && (
                      <>
                        <span aria-hidden="true" className="text-white/15">·</span>
                        <span>{contextLabel(m.context_length)}</span>
                      </>
                    )}
                  </span>
                  {/* Pas de `block` ici: il ecraserait le display:-webkit-box de line-clamp. */}
                  {m.blurb && (
                    <span className="text-xs text-white/35 mt-1 line-clamp-1">{m.blurb}</span>
                  )}
                </span>
              </label>
            </div>
          );
        })}

        {matches.length === 0 && (
          <p className="p-4 text-xs text-white/35">
            Aucun modele ne correspond. Elargissez la recherche ou reinitialisez les filtres.
          </p>
        )}
      </div>

      {matches.length > shown.length && (
        <button
          type="button"
          onClick={() => setLimit((n) => n + PAGE * 2)}
          className={`w-full py-2 rounded-xl border text-xs font-medium transition-colors ${c.action}`}
        >
          Afficher plus ({matches.length - shown.length} restants)
        </button>
      )}
    </div>
  );
}
