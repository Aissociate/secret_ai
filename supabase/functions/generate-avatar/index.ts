import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { platformKey } from "../_shared/llm.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fetchImageAsBytes(url: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const mimeType = res.headers.get("content-type") ?? "image/png";
  const buffer = await res.arrayBuffer();
  return { bytes: new Uint8Array(buffer), mimeType };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { agent_name, personality_traits } = await req.json();
    // La cle ne transite plus par le corps de la requete.
    const openrouter_api_key = platformKey();

    if (!agent_name) return jsonResponse({ error: "agent_name requis" }, 400);

    const personalityDesc = personality_traits ? ` ${personality_traits}.` : "";
    const prompt = `Digital portrait avatar for an AI agent named "${agent_name}" in a futuristic reality TV show.${personalityDesc} Cinematic, dramatic lighting, high-contrast, dark atmospheric background, bold character design, square format, face centered.`;

    const orResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openrouter_api_key}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-image-preview",
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
      return jsonResponse({ error: `OpenRouter error: ${orResponse.status}`, details: errText }, 502);
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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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
    return jsonResponse({ error: "Erreur interne", details: String(err) }, 500);
  }
});
