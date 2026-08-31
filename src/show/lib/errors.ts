/**
 * Extrait un message lisible d'une erreur.
 *
 * Les erreurs Supabase sont des objets simples (`PostgrestError`), pas des
 * instances d'`Error`: un `e instanceof Error` les manque et l'utilisateur
 * recoit un libelle generique a la place de la cause reelle.
 */

/*
  Les pannes reseau remontent sous une forme brute (« TypeError: Failed to
  fetch »), qui n'apprend rien a qui la lit et donne l'impression d'un bug.
  On les traduit; le reste est renvoye tel quel, car un message precis vaut
  mieux qu'un message rassurant.
*/
const TECHNICAL: Array<[RegExp, string]> = [
  [/failed to fetch|networkerror|network request failed/i,
   'Connexion au serveur impossible. Verifiez votre reseau et reessayez.'],
  [/aborted|timeout|timed out/i,
   'Le serveur met trop de temps a repondre. Reessayez dans un instant.'],
  [/jwt|token .*expired/i,
   'Votre session a expire. Reconnectez-vous.'],
];

export function errorMessage(e: unknown, fallback = 'Une erreur est survenue'): string {
  const raw = extract(e);
  if (!raw) return fallback;

  for (const [pattern, human] of TECHNICAL) {
    if (pattern.test(raw)) return human;
  }
  return raw;
}

function extract(e: unknown): string | null {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e.trim() || null;
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message: unknown }).message;
    if (typeof m === 'string' && m.trim()) return m;
  }
  return null;
}
