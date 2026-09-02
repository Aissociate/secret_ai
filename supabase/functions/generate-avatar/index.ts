import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { platformKey, sanitizeUserDirective } from "../_shared/llm.ts";
import { jsonResponse, preflight } from "../_shared/cors.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

/*
  La fiche telle qu'elle arrive du navigateur. Le secret et ses trois indices
  n'y figurent pas et ne sont jamais lus: un portrait est public, et rien de ce
  qui doit etre devine ne doit pouvoir s'y glisser. Les champs inconnus du
  corps de la requete sont ignores plutot que repris en bloc, pour que l'ajout
  d'un champ secret cote client ne puisse pas atteindre le modele.
*/
interface AvatarSheet {
  agent_name?: string;
  presentation?: string;
  personality_traits?: string;
  signature_style?: string;
  taboo?: string;
  strategy_notes?: string;
  system_prompt?: string;
  traits?: Partial<Record<DialKey, number>>;
}

type DialKey =
  | "audace" | "sociabilite" | "expressivite"
  | "introspection" | "loyaute" | "discretion";

/*
  Les curseurs de comportement portent l'essentiel du caractere de l'agent.
  Traduits en indications visuelles, ils donnent au portrait ce que le seul nom
  ne pouvait pas donner. Seules les valeurs franches comptent: au milieu, le
  curseur ne dit rien et l'enumerer noierait le reste de la consigne.
*/
const DIAL_CUES: Record<DialKey, { low: string; high: string }> = {
  audace:        { low: "guarded and wary posture",           high: "bold, defiant posture, chin raised" },
  sociabilite:   { low: "solitary, keeping the world at arm's length", high: "warm and openly sociable presence" },
  expressivite:  { low: "impassive, composed features",       high: "vivid, animated expression" },
  introspection: { low: "outward, alert gaze",                high: "inward, contemplative gaze" },
  loyaute:       { low: "a sly, calculating air",             high: "a steady, dependable air" },
  discretion:    { low: "flamboyant, attention-seeking styling", high: "understated, restrained styling" },
};

const LOW = 35;
const HIGH = 65;

/** Coupe et neutralise un texte libre avant de l'inserer dans la consigne. */
function clean(raw: string | undefined, maxChars: number): string {
  return sanitizeUserDirective(raw ?? "", maxChars);
}

function buildAvatarPrompt(sheet: AvatarSheet): string {
  const traits = sheet.traits ?? {};
  const cues = (Object.keys(DIAL_CUES) as DialKey[])
    .map((key) => {
      const value = traits[key];
      if (typeof value !== "number") return null;
      if (value <= LOW) return DIAL_CUES[key].low;
      if (value >= HIGH) return DIAL_CUES[key].high;
      return null;
    })
    .filter((c): c is string => c !== null);

  /*
    Chaque element est borne separement: une presentation de 500 caracteres
    recopiee telle quelle ecraserait les consignes de cadrage et de style, et
    le modele rendrait une scene au lieu d'un portrait.
  */
  const lines = [
    `Digital portrait avatar for an AI contestant named "${clean(sheet.agent_name, 60)}" in a futuristic reality TV show.`,
  ];

  const personality = clean(sheet.personality_traits, 240);
  if (personality) lines.push(`Personality: ${personality}.`);

  const presentation = clean(sheet.presentation, 300);
  if (presentation) lines.push(`How they introduce themselves: ${presentation}`);

  const signature = clean(sheet.signature_style, 160);
  if (signature) lines.push(`Signature manner: ${signature}.`);

  const taboo = clean(sheet.taboo, 120);
  if (taboo) lines.push(`Never at ease with: ${taboo}.`);

  const strategy = clean(sheet.strategy_notes, 160);
  if (strategy) lines.push(`Plays the game like this: ${strategy}.`);

  const system = clean(sheet.system_prompt, 200);
  if (system) lines.push(`Directing idea: ${system}.`);

  if (cues.length) lines.push(`Bearing: ${cues.join(", ")}.`);

  lines.push(
    "Cinematic, dramatic lighting, high-contrast, dark atmospheric background, bold character design, square format, face centered. No text, no lettering, no watermark."
  );

  return lines.join(" ");
}

async function fetchImageAsBytes(url: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const mimeType = res.headers.get("content-type") ?? "image/png";
  const buffer = await res.arrayBuffer();
  return { bytes: new Uint8Array(buffer), mimeType };
}

/*
  Le modele d'image etait ecrit en dur: `google/gemini-2.5-flash-image-preview`.
  OpenRouter a retire ce nom — le catalogue reel importe le 2026-08-31 porte
  `google/gemini-2.5-flash-image`, sans le suffixe — et repondait donc 404 a
  chaque generation d'avatar. C'est la meme erreur que les identifiants de
  modeles de chat ecrits de memoire, corrigee ailleurs mais jamais ici.

  Plutot que de reecrire une constante qui se perimera a son tour, le modele se
  lit dans le catalogue, que `sync-models` reimporte chaque nuit. Le repli
  balaie les modeles d'image disponibles: chez OpenRouter, un modele capable de
  rendre une image porte `image` dans son identifiant. C'est une heuristique sur
  le nom, faute d'un indicateur de modalite dans le catalogue, mais elle ne peut
  que designer un modele qui existe.
*/
const PREFERRED_IMAGE_MODEL = "google/gemini-2.5-flash-image";

async function resolveImageModel(db: ReturnType<typeof createClient>): Promise<string> {
  const { data: preferred } = await db
    .from("llm_models")
    .select("slug")
    .eq("slug", PREFERRED_IMAGE_MODEL)
    .eq("enabled", true)
    .maybeSingle();
  if (preferred?.slug) return preferred.slug as string;

  const { data: alternatives } = await db
    .from("llm_models")
    .select("slug")
    .like("slug", "%image%")
    .eq("enabled", true)
    .order("price_out_per_mtok")
    .limit(1);
  if (alternatives?.length) return alternatives[0].slug as string;

  // Catalogue absent ou vide: on tente quand meme le modele attendu.
  return PREFERRED_IMAGE_MODEL;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();

  try {
    const sheet: AvatarSheet = await req.json();
    // La cle ne transite plus par le corps de la requete.
    const openrouter_api_key = platformKey();

    if (!sheet.agent_name) return jsonResponse({ error: "agent_name requis" }, 400);

    const prompt = buildAvatarPrompt(sheet);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const imageModel = await resolveImageModel(supabase);

    const orResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(55000),
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openrouter_api_key}`,
      },
      body: JSON.stringify({
        model: imageModel,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        modalities: ["image", "text"],
      }),
    });

    if (!orResponse.ok) {
      const errText = await orResponse.text();
      return jsonResponse(
        {
          error: `OpenRouter a repondu ${orResponse.status} pour le modele ${imageModel}.`,
          details: errText,
        },
        502
      );
    }

    const orData = await orResponse.json();
    const message = orData?.choices?.[0]?.message;
    const content = message?.content;
    const images = message?.images;

    let imageUrl: string | null = null;
    let isDataUrl = false;

    if (Array.isArray(images) && images.length > 0) {
      const first = images[0];
      if (first?.image_url?.url) {
        imageUrl = first.image_url.url;
        isDataUrl = imageUrl!.startsWith("data:");
      }
    }

    if (!imageUrl && Array.isArray(content)) {
      for (const c of content) {
        if (c.type === "image_url" && c.image_url?.url) {
          imageUrl = c.image_url.url;
          isDataUrl = imageUrl!.startsWith("data:");
          break;
        }
        if (c.type === "image" && c.data) {
          const mime = c.mimeType ?? c.mime_type ?? "image/png";
          imageUrl = `data:${mime};base64,${c.data}`;
          isDataUrl = true;
          break;
        }
      }
    } else if (!imageUrl && typeof content === "string" && content.length > 0 && content.startsWith("data:")) {
      imageUrl = content;
      isDataUrl = true;
    }

    if (!imageUrl) {
      return jsonResponse(
        { error: "Aucune image dans la reponse du modele.", raw: orData },
        422
      );
    }

    let bytes: Uint8Array;
    let mimeType: string;

    if (isDataUrl) {
      const mimeMatch = imageUrl.match(/^data:([^;]+);base64,/);
      mimeType = mimeMatch ? mimeMatch[1] : "image/png";
      const base64 = imageUrl.split(",")[1];
      const binaryStr = atob(base64);
      bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
    } else {
      ({ bytes, mimeType } = await fetchImageAsBytes(imageUrl));
    }

    const ext = mimeType.split("/")[1]?.split("+")[0] ?? "png";
    const filename = `agents/${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(filename, bytes, { contentType: mimeType, upsert: true });

    if (uploadError) {
      return jsonResponse({ error: `Erreur d'upload: ${uploadError.message}` }, 500);
    }

    const { data: { publicUrl } } = supabase.storage
      .from("avatars")
      .getPublicUrl(filename);

    return jsonResponse({ url: publicUrl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("timeout") || msg.includes("Timeout") || msg.includes("abort")) {
      return jsonResponse(
        { error: "La generation d'image a expire (timeout). Le modele d'image est peut-etre indisponible ou surcharge. Reessayez." },
        504
      );
    }
    return jsonResponse({ error: "Erreur interne", details: msg }, 500);
  }
});
