import { createClient } from "npm:@supabase/supabase-js@2.57.4";

export type DB = ReturnType<typeof createClient>;

/** Client service_role: contourne la RLS, ne jamais exposer au navigateur. */
export function serviceClient(): DB {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

/**
 * Verifie le secret partage des taches planifiees.
 *
 * La cle anon suffit a franchir `verify_jwt` et est publique (presente dans le
 * bundle front): elle ne protege donc rien. Les fonctions a effets de bord
 * doivent exiger CRON_SECRET en plus.
 *
 * Retourne null si l'appel est autorise, sinon la reponse d'erreur a renvoyer.
 */
async function resolveCronSecret(): Promise<string | null> {
  const envSecret = Deno.env.get("CRON_SECRET");
  if (envSecret) return envSecret;

  try {
    const db = serviceClient();
    const { data } = await db
      .from("app_secrets")
      .select("value")
      .eq("key", "cron_secret")
      .maybeSingle();
    return data?.value ?? null;
  } catch {
    return null;
  }
}

export async function requireCronSecret(req: Request): Promise<Response | null> {
  const expected = await resolveCronSecret();

  if (!expected) {
    return new Response(
      JSON.stringify({
        error: "CRON_SECRET non configure",
        hint: "Definir le secret via `supabase secrets set CRON_SECRET=...` ou dans la table app_secrets",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const provided = req.headers.get("X-Cron-Secret");
  if (!provided || !timingSafeEqual(provided, expected)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return null;
}

/** Comparaison a duree constante, pour ne pas fuiter le secret octet par octet. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type AuthedUser = { id: string; role: string };

/**
 * Resout l'utilisateur porte par le JWT et verifie qu'il a l'un des roles requis.
 * Retourne soit l'utilisateur, soit la reponse d'erreur a renvoyer.
 */
export async function requireRole(
  req: Request,
  db: DB,
  roles: string[]
): Promise<{ user: AuthedUser } | { response: Response }> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  if (!token) {
    return {
      response: new Response(JSON.stringify({ error: "Token manquant" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  const { data: userData, error } = await db.auth.getUser(token);
  if (error || !userData?.user) {
    return {
      response: new Response(JSON.stringify({ error: "Token invalide" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  const { data: profile } = await db
    .from("users")
    .select("id, role")
    .eq("id", userData.user.id)
    .maybeSingle();

  const role = (profile?.role as string) ?? "spectator";
  if (!roles.includes(role)) {
    return {
      response: new Response(
        JSON.stringify({ error: "Acces refuse", required: roles, actual: role }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      ),
    };
  }

  return { user: { id: userData.user.id, role } };
}
