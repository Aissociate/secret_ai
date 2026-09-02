import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { verifyMessage } from "npm:ethers@6.16.0";
import { jsonResponse, preflight } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/auth.ts";
// deployed via mcp tool

/*
  Authentification par portefeuille (SIWE, EIP-4361 simplifie).

  Remplace l'ancien schema ou le mot de passe etait derive de l'adresse publique
  (`metamask_${addr.slice(0,10)}_temp`): l'adresse etant publique, le mot de
  passe l'etait aussi, et n'importe qui pouvait prendre le controle d'un compte.

  Deux etapes:
    1. `nonce`  : le serveur emet un defi a usage unique, valable 5 minutes.
    2. `verify` : le client renvoie la signature du defi. Le serveur verifie
                  qu'elle correspond bien a l'adresse annoncee, puis emet une
                  session Supabase.

  Le nonce est indispensable: sans lui, une signature interceptee resterait
  rejouable indefiniment.
*/

const NONCE_TTL_MS = 5 * 60 * 1000;
const DOMAIN = Deno.env.get("APP_DOMAIN") ?? "secret-house";

function buildMessage(address: string, nonce: string, issuedAt: string): string {
  return [
    `${DOMAIN} souhaite verifier que vous controlez cette adresse.`,
    "",
    `Adresse : ${address}`,
    `Nonce : ${nonce}`,
    `Emis le : ${issuedAt}`,
    "",
    "Signer ce message ne declenche aucune transaction et ne coute aucun frais.",
  ].join("\n");
}

function isValidAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();

  if (req.method !== "POST") {
    return jsonResponse({ error: "Methode non autorisee" }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const step = body?.step;
    const walletAddress = String(body?.wallet_address ?? "").toLowerCase();

    if (!isValidAddress(walletAddress)) {
      return jsonResponse({ error: "Adresse invalide" }, 400);
    }

    const db = serviceClient();

    // -----------------------------------------------------------------------
    // Etape 1: emission du defi
    // -----------------------------------------------------------------------
    if (step === "nonce") {
      const nonce = crypto.randomUUID();
      const issuedAt = new Date().toISOString();
      const message = buildMessage(walletAddress, nonce, issuedAt);

      const { error } = await db.from("wallet_nonces").upsert(
        {
          wallet_address: walletAddress,
          nonce,
          message,
          expires_at: new Date(Date.now() + NONCE_TTL_MS).toISOString(),
        },
        { onConflict: "wallet_address" }
      );

      if (error) {
        return jsonResponse({ error: "Impossible d'emettre le defi", details: error.message }, 500);
      }

      return jsonResponse({ message, nonce });
    }

    // -----------------------------------------------------------------------
    // Etape 2: verification de la signature
    // -----------------------------------------------------------------------
    if (step === "verify") {
      const signature = String(body?.signature ?? "");
      if (!signature.startsWith("0x")) {
        return jsonResponse({ error: "Signature manquante" }, 400);
      }

      const { data: challenge } = await db
        .from("wallet_nonces")
        .select("message, expires_at")
        .eq("wallet_address", walletAddress)
        .maybeSingle();

      if (!challenge) {
        return jsonResponse({ error: "Aucun defi en cours, recommencez" }, 400);
      }

      if (new Date(challenge.expires_at as string) < new Date()) {
        await db.from("wallet_nonces").delete().eq("wallet_address", walletAddress);
        return jsonResponse({ error: "Defi expire, recommencez" }, 400);
      }

      let recovered: string;
      try {
        recovered = verifyMessage(challenge.message as string, signature).toLowerCase();
      } catch {
        return jsonResponse({ error: "Signature illisible" }, 401);
      }

      if (recovered !== walletAddress) {
        return jsonResponse({ error: "La signature ne correspond pas a l'adresse" }, 401);
      }

      // Le defi est consomme: une signature ne vaut qu'une fois.
      await db.from("wallet_nonces").delete().eq("wallet_address", walletAddress);

      const email = `${walletAddress}@wallet.local`;

      const { data: existingProfile } = await db
        .from("users")
        .select("id")
        .eq("wallet_address", walletAddress)
        .maybeSingle();

      let userId = existingProfile?.id as string | undefined;

      if (!userId) {
        // Mot de passe aleatoire jamais communique: la seule voie d'acces est
        // la signature du portefeuille.
        const { data: created, error: createError } = await db.auth.admin.createUser({
          email,
          password: crypto.randomUUID() + crypto.randomUUID(),
          email_confirm: true,
          user_metadata: { wallet_address: walletAddress },
        });

        if (createError || !created?.user) {
          return jsonResponse(
            { error: "Creation du compte impossible", details: createError?.message },
            500
          );
        }

        userId = created.user.id;

        await db.from("users").insert({
          id: userId,
          username: `user_${walletAddress.slice(2, 8)}`,
          role: "spectator",
          wallet_address: walletAddress,
        });
      }

      // Lien magique converti en session sans envoi d'e-mail.
      const { data: link, error: linkError } = await db.auth.admin.generateLink({
        type: "magiclink",
        email,
      });

      if (linkError || !link?.properties?.hashed_token) {
        return jsonResponse(
          { error: "Emission de session impossible", details: linkError?.message },
          500
        );
      }

      const { data: verified, error: verifyError } = await db.auth.verifyOtp({
        type: "magiclink",
        token_hash: link.properties.hashed_token,
      });

      if (verifyError || !verified?.session) {
        return jsonResponse(
          { error: "Session non emise", details: verifyError?.message },
          500
        );
      }

      return jsonResponse({
        access_token: verified.session.access_token,
        refresh_token: verified.session.refresh_token,
        wallet_address: walletAddress,
      });
    }

    return jsonResponse({ error: "Etape inconnue (attendu: nonce | verify)" }, 400);
  } catch (err) {
    return jsonResponse(
      { error: "Erreur interne", details: err instanceof Error ? err.message : String(err) },
      500
    );
  }
});
