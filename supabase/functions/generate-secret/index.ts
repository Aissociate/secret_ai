import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface RequestBody {
  openrouter_api_key: string;
  openrouter_model: string;
  agent_name: string;
  personality_traits?: string;
}

interface GeneratedSecret {
  secret_keyword: string;
  hint_1: string;
  hint_2: string;
  hint_3: string;
  presentation: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json();
    const { openrouter_api_key, openrouter_model, agent_name, personality_traits } = body;

    if (!openrouter_api_key || !openrouter_model) {
      return new Response(
        JSON.stringify({ error: "Cle API et modele requis." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = `Tu es le maitre du jeu d'un reality show d'IA appele "Secret House". Chaque IA participante possede un MOT SECRET unique que les autres doivent deviner pour l'eliminer.

Tu dois generer:
1. Un mot-cle secret (un seul mot, original, ni trop simple ni trop complexe - des mots comme: eclipse, mirage, paradoxe, chimere, vertigo, obsidienne, nocturne, etc.)
2. Exactement 3 indices progressifs:
   - Indice 1 (niveau 60% popularite): TRES VAGUE. Une metaphore lointaine, presque poetique. Ne doit pas permettre de deviner le mot. Maximum 15 mots.
   - Indice 2 (niveau 80% popularite): UN PEU PLUS PRECIS. Donne un domaine ou une sensation liee au mot, mais reste ambigu. Maximum 15 mots.
   - Indice 3 (niveau 95% popularite): PLUS REVELATEUR mais jamais explicite. Oriente fortement sans jamais dire le mot directement. Maximum 15 mots.
3. Une presentation de l'agent (environ 400 caracteres):
   - Ecrite a la premiere personne comme si l'IA se presentait aux autres candidats
   - Reflete la personnalite de l'IA
   - Strategique: masque ou detourne subtilement du secret sans jamais le mentionner
   - Naturelle, authentique, memorable
   - Cree une premiere impression qui influence la perception des autres

Les indices et la presentation doivent etre en francais, evocateurs et dignes d'un show televisuel dramatique.

IMPORTANT: Reponds UNIQUEMENT en JSON valide, sans texte avant ni apres:
{"secret_keyword":"lemot","hint_1":"...","hint_2":"...","hint_3":"...","presentation":"..."}`;

    const userPrompt = agent_name
      ? `Genere un secret et 3 indices pour l'IA "${agent_name}"${personality_traits ? ` dont la personnalite est: ${personality_traits}` : ""}. Le secret doit etre surprenant et en lien subtil avec sa personnalite.`
      : `Genere un secret et 3 indices pour une IA participante du show.`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openrouter_api_key}`,
      },
      body: JSON.stringify({
        model: openrouter_model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.9,
        max_tokens: 400,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return new Response(
        JSON.stringify({ error: `OpenRouter error: ${response.status}`, details: errText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content ?? "";

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return new Response(
        JSON.stringify({ error: "L'IA n'a pas retourne un JSON valide.", raw: content }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const generated: GeneratedSecret = JSON.parse(jsonMatch[0]);

    if (!generated.secret_keyword || !generated.hint_1 || !generated.hint_2 || !generated.hint_3 || !generated.presentation) {
      return new Response(
        JSON.stringify({ error: "Reponse incomplete de l'IA.", raw: content }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    generated.secret_keyword = generated.secret_keyword.toLowerCase().replace(/\s+/g, "");

    return new Response(JSON.stringify(generated), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Erreur interne", details: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
