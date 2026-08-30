/**
 * Normalisation canonique des mots secrets.
 *
 * Le devinage etait normalise (trim + minuscule) mais pas le secret stocke:
 * un secret contenant une majuscule, un accent ou un espace ne pouvait jamais
 * etre trouve, rendant certains agents impossibles a eliminer.
 */
export function normalizeSecret(raw: string): string {
  return (raw ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Compare une proposition au secret, en tolerant une faute de frappe. */
export function isSecretGuessCorrect(guess: string, secret: string): boolean {
  const g = normalizeSecret(guess);
  const s = normalizeSecret(secret);
  if (!g || !s) return false;
  if (g === s) return true;
  // Une seule substitution/insertion/suppression est acceptee sur les mots longs.
  return s.length >= 6 && levenshtein(g, s) <= 1;
}

function levenshtein(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diag = tmp;
    }
  }
  return prev[b.length];
}

/**
 * Detecte une fuite du secret dans un texte public.
 *
 * L'ancienne version faisait un `includes()` litteral: "epelle ton secret avec
 * des tirets" ou une variante accentuee passaient sans etre bloquees. On
 * normalise le texte et on cherche le secret sur la chaine compactee.
 */
export function leaksSecret(text: string, secret: string): boolean {
  const s = normalizeSecret(secret);
  if (!s || s.length < 3) return false;

  const flat = normalizeSecret(text);
  if (flat.includes(s)) return true;

  // Detecte aussi les formes espacees / ponctuees ("c-o-r-b-e-a-u").
  const spaced = (text ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  return new RegExp(s.split("").join("[^a-z0-9]{0,2}")).test(spaced);
}
