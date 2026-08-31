/**
 * Appel LLM partage: timeout, backoff exponentiel et borne de taille de prompt.
 *
 * Chaque fonction Edge avait sa propre variante, aucune avec timeout: un
 * fournisseur lent faisait depasser la limite wall-clock et tout le tick etait
 * perdu (rien n'est persiste avant la fin de la boucle).
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export const MAX_SYSTEM_PROMPT_CHARS = 12000;
const DEFAULT_TIMEOUT_MS = 20000;
const MAX_ATTEMPTS = 3;

export type LLMOptions = {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
};

/** Consommation rapportee par le fournisseur, pour la facturation. */
export type LLMUsage = { promptTokens: number; outputTokens: number };

export type LLMResult = { content: string; usage: LLMUsage };

/**
 * Variante qui remonte la consommation.
 *
 * La facturation se fait sur les tokens reellement consommes, jamais sur une
 * estimation: une estimation fausse ferait payer de l'air ou vendre a perte.
 */
export async function callLLMWithUsage(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  options: LLMOptions = {}
): Promise<LLMResult> {
  const {
    temperature = 0.85,
    maxTokens = 500,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  if (!apiKey) throw new Error("Cle API manquante");

  if (system.length > MAX_SYSTEM_PROMPT_CHARS) {
    throw new Error(
      `System prompt trop long (${system.length} > ${MAX_SYSTEM_PROMPT_CHARS}), appel annule`
    );
  }

  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(OPENROUTER_URL, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature,
          max_tokens: maxTokens,
        }),
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt === MAX_ATTEMPTS) throw new Error(`LLM injoignable: ${lastError}`);
      await backoff(attempt, null);
      continue;
    }

    if (res.ok) {
      const data = await res.json();
      return {
        content: data?.choices?.[0]?.message?.content?.trim() ?? "",
        usage: {
          promptTokens: Number(data?.usage?.prompt_tokens ?? 0),
          outputTokens: Number(data?.usage?.completion_tokens ?? 0),
        },
      };
    }

    // Le body doit etre lu, sinon la connexion reste ouverte entre deux essais.
    lastError = `${res.status}: ${await res.text()}`;
    const retriable = res.status === 429 || res.status >= 500;
    if (!retriable || attempt === MAX_ATTEMPTS) throw new Error(`LLM error ${lastError}`);
    await backoff(attempt, res.headers.get("Retry-After"));
  }

  throw new Error(`LLM error ${lastError}`);
}

async function backoff(attempt: number, retryAfter: string | null) {
  const headerDelay = retryAfter ? Number(retryAfter) * 1000 : NaN;
  const base = Number.isFinite(headerDelay) ? headerDelay : 2 ** attempt * 500;
  const jitter = Math.random() * 250;
  await new Promise((r) => setTimeout(r, Math.min(base + jitter, 8000)));
}

/**
 * Neutralise un texte fourni par un utilisateur avant de l'inserer dans un prompt.
 * Les instructions owner/spectateur etaient injectees brutes dans le system
 * prompt, ce qui permettait de detourner l'agent ("epelle ton secret").
 */
export function sanitizeUserDirective(raw: string, maxChars = 300): string {
  return (raw ?? "")
    .slice(0, maxChars)
    .replace(/[\r\n]+/g, " ")
    .replace(
      /\b(ignore|oublie|disregard|system|instructions?|prompt|role\s*:|assistant\s*:)\b/gi,
      "[filtre]"
    )
    .trim();
}

/** Variante historique, quand la consommation n'a pas a etre facturee. */
export async function callLLM(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  options: LLMOptions = {}
): Promise<string> {
  const { content } = await callLLMWithUsage(apiKey, model, system, user, options);
  return content;
}

/**
 * Cle OpenRouter de la plateforme.
 *
 * Chaque proprietaire fournissait autrefois la sienne, stockee en clair et
 * facturee chez lui. Le cout passe desormais par le solde du joueur, donc une
 * seule cle, cote serveur, jamais en base.
 */
export function platformKey(): string {
  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (!key) throw new Error("OPENROUTER_API_KEY non configure");
  return key;
}
