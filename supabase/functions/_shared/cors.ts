/**
 * En-tetes CORS partages par toutes les fonctions Edge.
 *
 * ALLOWED_ORIGIN restreint qui peut appeler les fonctions depuis un navigateur.
 * Laisser "*" ouvre les endpoints a n'importe quel site tiers: definir la variable
 * d'environnement en production.
 */
const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "*";

export const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, X-Cron-Secret",
  "Vary": "Origin",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function preflight(): Response {
  return new Response(null, { status: 200, headers: corsHeaders });
}
