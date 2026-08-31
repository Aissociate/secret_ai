import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { jsonResponse, preflight } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/auth.ts";
import { callLLM, platformKey } from "../_shared/llm.ts";
import { normalizeSecret } from "../_shared/secret.ts";
import { drawSeed, buildSecretPrompt } from "../_shared/secretSeed.ts";

interface RequestBody {
  /** Slug du catalogue; la cle vient de l'environnement. */
  model_slug?: string;
  agent_name?: string;
  personality_traits?: string;
  config_id?: string;
  season_id?: string;
}

interface GeneratedSecret {
  secret_keyword: string;
  hint_1: string;
  hint_2: string;
  hint_3: string;
  presentation: string;
}

/*
  Un mot rejete est reessaye avec une nouvelle amorce: c'est le tirage du
  domaine et de la contrainte de forme qui porte la variete, pas la
  temperature du modele.
*/
const MAX_ATTEMPTS = 4;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();

  try {
    const body: RequestBody = await req.json();
    const db = serviceClient();

    /*
      La generation est un cout de plateforme, pas une action de jeu: elle
      passe par le palier economique quel que soit le modele choisi par le
      proprietaire pour jouer, et n'est pas facturee a son solde.
    */
    const { data: genModel } = await db
      .from("llm_models")
      .select("provider_model")
      .eq("slug", body.model_slug ?? "rapide")
      .maybeSingle();

    const providerModel =
      (genModel?.provider_model as string) ?? "openai/gpt-4o-mini";

    /*
      L'endpoint acceptait n'importe quel appelant porteur de la cle anon, qui
      est publique: n'importe qui pouvait declencher des generations facturees.
      On exige desormais le JWT du proprietaire.
    */
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: userData } = await db.auth.getUser(token);
    if (!userData?.user) {
      return jsonResponse({ error: "Authentification requise." }, 401);
    }

    // Reglage de la saison quand il est connu, sinon le mode oblique.
    let directness: 1 | 2 = 1;
    if (body.season_id) {
      const { data: season } = await db
        .from("seasons")
        .select("hint_directness")
        .eq("id", body.season_id)
        .maybeSingle();
      if (season?.hint_directness === 2) directness = 2;
    }

    /*
      Mots deja portes par les agents de la saison: on les nomme au modele pour
      qu'il ne retente pas les memes, en plus de la validation qui suit.
    */
    let forbidden: string[] = [];
    if (body.season_id) {
      const { data: taken } = await db
        .from("agents")
        .select("secret_keyword")
        .eq("season_id", body.season_id);
      forbidden = (taken ?? [])
        .map((a: { secret_keyword: string }) => a.secret_keyword)
        .filter(Boolean)
        .slice(0, 20);
    }

    const rejected: Array<{ word: string; reason: string }> = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const seed = drawSeed();
      const { system, user } = buildSecretPrompt(seed, {
        agentName: body.agent_name,
        personality: body.personality_traits,
        directness,
        forbidden: [...forbidden, ...rejected.map((r) => r.word)],
      });

      const raw = await callLLM(platformKey(), providerModel, system, user, {
        temperature: 0.95,
        maxTokens: 500,
      });

      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) {
        rejected.push({ word: "(json invalide)", reason: "parse" });
        continue;
      }

      let generated: GeneratedSecret;
      try {
        generated = JSON.parse(match[0]);
      } catch {
        rejected.push({ word: "(json invalide)", reason: "parse" });
        continue;
      }

      if (
        !generated.secret_keyword || !generated.hint_1 ||
        !generated.hint_2 || !generated.hint_3 || !generated.presentation
      ) {
        rejected.push({ word: generated.secret_keyword ?? "(vide)", reason: "incomplet" });
        continue;
      }

      const word = normalizeSecret(generated.secret_keyword);

      // Un indice qui contient le mot le rend inutile.
      const leaks = [generated.hint_1, generated.hint_2, generated.hint_3, generated.presentation]
        .some((t) => normalizeSecret(t).includes(word) && word.length >= 4);
      if (leaks) {
        rejected.push({ word, reason: "indice_fuite" });
        continue;
      }

      const { data: check } = await db.rpc("secret_is_available", {
        p_secret: word,
        p_season_id: body.season_id ?? null,
      });

      const verdict = check as { available?: boolean; reason?: string } | null;
      if (!verdict?.available) {
        rejected.push({ word, reason: verdict?.reason ?? "indisponible" });
        continue;
      }

      return jsonResponse({
        ...generated,
        secret_keyword: word,
        // Trace du tirage: utile pour diagnostiquer un domaine qui produirait
        // systematiquement des mots refuses.
        seed: seed.label,
        attempts: attempt,
      });
    }

    return jsonResponse(
      {
        error: "Aucun mot exploitable apres plusieurs tentatives. Reessayez.",
        rejected,
      },
      422
    );
  } catch (err) {
    return jsonResponse(
      { error: "Erreur interne", details: err instanceof Error ? err.message : String(err) },
      500
    );
  }
});
