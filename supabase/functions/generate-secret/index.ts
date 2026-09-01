import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { jsonResponse, preflight } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/auth.ts";
import { callLLM, platformKey } from "../_shared/llm.ts";
import { normalizeSecret } from "../_shared/secret.ts";
import {
  drawSeed,
  drawIdentitySeed,
  buildSecretPrompt,
  type DialKey,
} from "../_shared/secretSeed.ts";

interface RequestBody {
  /*
    `model_slug` n'est plus lu: le modele de generation vient du panneau
    d'administration, pas du modele de jeu du proprietaire. Le champ reste
    tolere dans le corps de la requete pour les fronts en cache.
  */
  agent_name?: string;
  personality_traits?: string;
  config_id?: string;
  season_id?: string;
  /**
   * Tire l'agent entier: nom, caractere, maniere de jouer et curseurs, en plus
   * du secret. `agent_name` et `personality_traits` sont alors ignores, puisque
   * c'est precisement ce qu'il s'agit d'inventer.
   */
  randomize_identity?: boolean;
}

interface GeneratedIdentity {
  name?: string;
  personality_traits?: string;
  signature_style?: string;
  taboo?: string;
  strategy_notes?: string;
}

interface GeneratedSecret {
  secret_keyword: string;
  hint_1: string;
  hint_2: string;
  hint_3: string;
  presentation: string;
  identity?: GeneratedIdentity;
}

/** Coupe un texte libre revenu du modele avant de le rendre au navigateur. */
function trim(raw: unknown, max: number): string {
  return typeof raw === "string" ? raw.trim().slice(0, max) : "";
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
      Modele et gabarit viennent du panneau d'administration. La generation est
      un cout de plateforme, pas une action de jeu: elle n'est pas facturee au
      solde du proprietaire, et n'a donc pas a passer par le modele qu'il a
      choisi pour jouer.

      Le code lisait pourtant `body.model_slug`, contredisant le commentaire
      qu'il portait. Deux consequences: le reglage « modele de generation » du
      panneau ne commandait rien, et depuis le retour du catalogue OpenRouter
      complet le proprietaire peut choisir un modele de raisonnement, dont les
      jetons de reflexion epuisent `max_tokens` avant la reponse. Le contenu
      revient alors vide, le JSON ne parse pas, et les quatre tentatives
      echouent d'affilee. Le defaut `'rapide'` n'existait plus au catalogue
      depuis l'import du catalogue reel.
    */
    const { data: settings } = await db
      .from("game_settings")
      .select("secret_model_slug, secret_prompt, default_hint_directness")
      .maybeSingle();

    const { data: genModel } = await db
      .from("llm_models")
      .select("provider_model")
      .eq("slug", (settings?.secret_model_slug as string | null) ?? "openai/gpt-4o-mini")
      .eq("enabled", true)
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

    // Reglage de la saison quand il est connu, sinon celui du panneau.
    let directness: 1 | 2 =
      (settings?.default_hint_directness as number) === 2 ? 2 : 1;
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

    /*
      Le tirage d'identite est fait une fois, hors de la boucle: les curseurs et
      les amorces ne doivent pas changer d'une tentative a l'autre, sinon le
      personnage rendu ne serait pas celui dont le secret a ete valide.
    */
    const identitySeed = body.randomize_identity ? drawIdentitySeed() : undefined;

    const rejected: Array<{ word: string; reason: string }> = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const seed = drawSeed();
      const { system, user } = buildSecretPrompt(seed, {
        template: (settings?.secret_prompt as string | null) ?? undefined,
        identity: identitySeed,
        agentName: identitySeed ? undefined : body.agent_name,
        personality: identitySeed ? undefined : body.personality_traits,
        directness,
        forbidden: [...forbidden, ...rejected.map((r) => r.word)],
      });

      /*
        Le JSON attendu porte un mot, trois indices et une presentation
        d'environ 400 caracteres: entre 250 et 300 jetons en francais. La borne
        a 500 ne laissait presque aucune marge, et un modele un peu bavard
        rendait un JSON tronque, donc illisible.
      */
      const raw = await callLLM(platformKey(), providerModel, system, user, {
        temperature: 0.95,
        // La fiche d'identite double a peu pres le volume attendu.
        maxTokens: identitySeed ? 1600 : 900,
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

      // Un agent sans nom n'est pas exploitable: on retente plutot que de rendre
      // une fiche a moitie remplie que le proprietaire devrait completer.
      if (identitySeed && !trim(generated.identity?.name, 30)) {
        rejected.push({ word: generated.secret_keyword, reason: "identite_incomplete" });
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

      /*
        Les curseurs rendus sont ceux tires par le serveur, jamais ceux que le
        modele aurait pu glisser dans sa reponse: c'est le tirage qui porte la
        variete, et le modele n'a fait que l'habiller.
      */
      const identity = identitySeed
        ? {
            name: trim(generated.identity?.name, 30),
            personality_traits: trim(generated.identity?.personality_traits, 400),
            signature_style: trim(generated.identity?.signature_style, 200),
            taboo: trim(generated.identity?.taboo, 120),
            strategy_notes: trim(generated.identity?.strategy_notes, 300),
            ...(identitySeed.dials as Record<DialKey, number>),
          }
        : undefined;

      return jsonResponse({
        ...generated,
        identity,
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
