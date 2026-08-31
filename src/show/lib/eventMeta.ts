import {
  MessageCircle, Video, Key, Users, Zap, Skull, AlertTriangle,
  Radio, Lock, Mic, Eye, Sunrise, Crown,
} from 'lucide-react';
import type { EventType } from '../api/types';

/**
 * Niveau de mise en avant d'un evenement.
 *
 * Le fil souffrait d'uniformite plus que de densite: une elimination avait
 * exactement le meme poids visuel qu'un bonjour, donc rien ne marquait. Trois
 * niveaux suffisent, et pas un de plus.
 *
 * - `ambient` : bavardage, s'efface
 * - `info`    : information utile, lecture normale
 * - `beat`    : coup de theatre, pleine largeur et couleur
 */
export type EventTier = 'ambient' | 'info' | 'beat';

export type EventMeta = {
  /** Libelle court. Affiche en second plan: le contenu passe avant l'etiquette. */
  label: string;
  icon: typeof MessageCircle;
  tier: EventTier;
  /** Classe de couleur du texte d'accent. */
  color: string;
  /** Fond de la pastille d'icone. */
  bg: string;
};

export const EVENT_META: Record<EventType, EventMeta> = {
  public_chat: {
    label: 'Discussion', icon: MessageCircle, tier: 'ambient',
    color: 'text-sky-400', bg: 'bg-sky-500/10',
  },
  confessional: {
    label: 'Confessionnal', icon: Video, tier: 'info',
    color: 'text-amber-400', bg: 'bg-amber-500/10',
  },
  hint_reveal: {
    label: 'Indice revele', icon: Key, tier: 'beat',
    color: 'text-emerald-400', bg: 'bg-emerald-500/10',
  },
  owner_influence: {
    label: 'Directive', icon: Users, tier: 'ambient',
    color: 'text-teal-400', bg: 'bg-teal-500/10',
  },
  spectator_influence: {
    label: 'Influence du public', icon: Zap, tier: 'ambient',
    color: 'text-orange-400', bg: 'bg-orange-500/10',
  },
  accusation: {
    label: 'Accusation', icon: AlertTriangle, tier: 'info',
    color: 'text-red-400', bg: 'bg-red-500/10',
  },
  elimination: {
    label: 'Elimination', icon: Skull, tier: 'beat',
    color: 'text-red-400', bg: 'bg-red-500/10',
  },
  system: {
    label: 'Maitre du Jeu', icon: Radio, tier: 'ambient',
    color: 'text-white/50', bg: 'bg-white/5',
  },
  private_dm: {
    label: 'Message prive', icon: Lock, tier: 'info',
    color: 'text-rose-400', bg: 'bg-rose-500/10',
  },
  host_commentary: {
    label: 'Presentateur', icon: Mic, tier: 'info',
    color: 'text-cyan-400', bg: 'bg-cyan-500/10',
  },
  host_clue: {
    label: 'Indice du Maitre', icon: Eye, tier: 'info',
    color: 'text-violet-400', bg: 'bg-violet-500/10',
  },
  day_advanced: {
    label: 'Nouvelle journee', icon: Sunrise, tier: 'ambient',
    color: 'text-white/50', bg: 'bg-white/5',
  },
  season_ended: {
    label: 'Fin de saison', icon: Crown, tier: 'beat',
    color: 'text-amber-400', bg: 'bg-amber-500/10',
  },
};

/** Repli pour un type inconnu, plutot qu'un rendu casse. */
export const FALLBACK_META: EventMeta = {
  label: 'Evenement', icon: Radio, tier: 'ambient',
  color: 'text-white/50', bg: 'bg-white/5',
};

export function metaFor(type: string): EventMeta {
  return EVENT_META[type as EventType] ?? FALLBACK_META;
}

/**
 * Une accusation correcte est un coup de theatre, une accusation ratee ne l'est
 * pas: le niveau depend donc aussi du contenu, pas seulement du type.
 */
export function tierFor(type: string, payload?: Record<string, unknown>): EventTier {
  if (type === 'accusation' && payload?.correct === true) return 'beat';
  return metaFor(type).tier;
}

/** Onglets de filtrage, dans l'ordre d'importance narrative. */
export const FEED_FILTERS: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'Tout' },
  { key: 'elimination', label: 'Eliminations' },
  { key: 'accusation', label: 'Accusations' },
  { key: 'hint_reveal', label: 'Indices' },
  { key: 'public_chat', label: 'Discussions' },
  { key: 'private_dm', label: 'Messages prives' },
  { key: 'confessional', label: 'Confessionnaux' },
  { key: 'host_commentary', label: 'Presentateur' },
  { key: 'spectator_influence', label: 'Influences' },
];

/** Libelle de chapitre: « Jour 3 · Soir ». */
export function chapterLabel(dayNumber: number, iso?: string): string {
  if (!iso) return `Jour ${dayNumber}`;
  const h = new Date(iso).getHours();
  const moment = h < 6 ? 'Nuit' : h < 12 ? 'Matin' : h < 18 ? 'Apres-midi' : 'Soir';
  return `Jour ${dayNumber} · ${moment}`;
}
