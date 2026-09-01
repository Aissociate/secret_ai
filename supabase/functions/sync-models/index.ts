import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { jsonResponse, preflight } from "../_shared/cors.ts";
import { serviceClient, requireCronSecret } from "../_shared/auth.ts";

/*
  Reimporte le catalogue OpenRouter.

  Les tarifs changent et des modeles disparaissent — l'ancien catalogue ecrit a
  la main contenait deja un identifiant retire (`anthropic/claude-3.5-haiku`),
  sur lequel tout appel aurait echoue. Une liste figee vieillit mal: elle fait
  vendre a perte quand un prix monte, et casse les agents quand un modele part.

  L'endpoint est public: aucune cle n'est necessaire pour le lire.
*/
const CATALOG_URL = "https://openrouter.ai/api/v1/models";

type ORModel = {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  expiration_date?: string | null;
  pricing?: { prompt?: string; completion?: string };
};

/** OpenRouter facture au token; le catalogue raisonne par million. */
function perMillion(value: string | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 1_000_000 * 1e6) / 1e6 : 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();

  const denied = requireCronSecret(req);
  if (denied) return denied;

  try {
    const res = await fetch(CATALOG_URL, {
      signal: AbortSignal.timeout(30_000),
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      return jsonResponse(
        { error: `OpenRouter ${res.status}`, details: await res.text() },
        502
      );
    }

    const payload = await res.json();
    const models: ORModel[] = payload?.data ?? [];

    if (!models.length) {
      // Un catalogue vide desactiverait tous les modeles: on refuse plutot.
      return jsonResponse({ error: "Catalogue vide, import annule" }, 502);
    }

    const db = serviceClient();
    const now = new Date().toISOString();

    const rows = models.map((m) => {
      const pin = perMillion(m.pricing?.prompt);
      const pout = perMillion(m.pricing?.completion);
      return {
        slug: m.id,
        label: m.name ?? m.id,
        provider: m.id.split("/")[0] ?? "",
        provider_model: m.id,
        price_in_per_mtok: pin,
        price_out_per_mtok: pout,
        context_length: m.context_length ?? 0,
        is_free: pin === 0 && pout === 0,
        expires_at: m.expiration_date ?? null,
        blurb: (m.description ?? "").replace(/\s+/g, " ").trim().slice(0, 240),
        enabled: true,
        synced_at: now,
      };
    });

    // Par lots: un upsert de plusieurs centaines de lignes depasse les limites
    // de taille de requete de PostgREST.
    const BATCH = 100;
    let written = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error } = await db
        .from("llm_models")
        .upsert(rows.slice(i, i + BATCH), { onConflict: "slug" });
      if (error) {
        return jsonResponse({ error: error.message, written }, 500);
      }
      written += Math.min(BATCH, rows.length - i);
    }

    /*
      Un modele retire du catalogue est desactive, jamais supprime: des agents
      y font reference, et resolve_agent_model bascule proprement sur le palier
      gratuit quand le modele choisi n'est plus actif.
    */
    const { data: retired } = await db
      .from("llm_models")
      .update({ enabled: false })
      .lt("synced_at", now)
      .eq("enabled", true)
      .select("slug");

    return jsonResponse({
      ok: true,
      imported: written,
      retired: retired?.length ?? 0,
      free: rows.filter((r) => r.is_free).length,
    });
  } catch (err) {
    return jsonResponse(
      { error: "Import impossible", details: err instanceof Error ? err.message : String(err) },
      500
    );
  }
});
