/**
 * Amorces de tirage pour la génération de secrets.
 *
 * L'ancien prompt citait ses propres exemples (« eclipse, mirage, paradoxe,
 * chimere, vertigo… »). Un modèle ancre très fortement sur les exemples qu'on
 * lui montre : l'espace réel de tirage se réduisait à ces mots et à leurs
 * voisins, tous du même registre. Après deux parties, un joueur reconnaissait
 * la famille et devinait sans lire les indices.
 *
 * On ne donne donc plus aucun exemple. On tire à la place, côté serveur, un
 * domaine et une contrainte de forme : c'est le croisement des deux qui
 * détermine le mot, et le hasard vient de nous, pas du modèle.
 */

/** Domaines volontairement éloignés du registre poétique d'origine. */
const DOMAINS = [
  "outils d'atelier et de menuiserie",
  "termes de marine et de navigation",
  "vocabulaire de la boulangerie et de la meunerie",
  "instruments de mesure scientifiques",
  "pièces d'horlogerie",
  "termes de typographie et d'imprimerie",
  "vocabulaire de la spéléologie",
  "termes de couture et de tissage",
  "vocabulaire ferroviaire",
  "termes de cartographie",
  "vocabulaire de l'apiculture",
  "pièces d'un instrument de musique",
  "termes de céramique et de poterie",
  "vocabulaire de la reliure",
  "termes de meunerie hydraulique",
  "vocabulaire de l'escalade",
  "termes de brasserie",
  "vocabulaire de la forge",
  "termes d'architecture médiévale",
  "vocabulaire de la photographie argentique",
  "termes de botanique descriptive",
  "vocabulaire de la voile latine",
  "termes de géologie sédimentaire",
  "vocabulaire de l'orfèvrerie",
] as const;

/** Contraintes de forme, pour casser la régularité prosodique du cluster. */
const SHAPES = [
  "exactement deux syllabes",
  "exactement quatre syllabes",
  "commence par une voyelle",
  "contient un double consonne",
  "se termine par une consonne",
  "compte entre 5 et 7 lettres",
  "compte entre 10 et 14 lettres",
  "contient au moins un 'y' ou un 'x'",
  "ne contient aucune lettre accentuée",
  "commence et se termine par la même lettre",
] as const;

export type SecretSeed = {
  domain: string;
  shape: string;
  /** Trace lisible, utile pour diagnostiquer un tirage douteux. */
  label: string;
};

export function drawSeed(): SecretSeed {
  const domain = DOMAINS[Math.floor(Math.random() * DOMAINS.length)];
  const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
  return { domain, shape, label: `${domain} / ${shape}` };
}

/**
 * Construit la consigne de génération.
 *
 * Trois exigences portent la difficulté :
 *
 * 1. **Aucun exemple de mot.** C'est ce qui provoquait le regroupement.
 * 2. **Des indices orthogonaux.** Chacun contraint un axe différent (usage,
 *    matière, forme du mot) plutôt que de pointer trois fois la même image.
 *    Trois contraintes qui se croisent restent résolubles, mais exigent les
 *    trois — là où trois métaphores convergentes se résolvaient dès la première.
 * 3. **Un troisième indice qui n'énonce jamais la fonction du mot** quand la
 *    saison est réglée en mode oblique.
 */
export function buildSecretPrompt(
  seed: SecretSeed,
  opts: {
    /**
     * Gabarit saisi dans le panneau d'administration, avec les marqueurs
     * `{domaine}`, `{forme}`, `{interdits}` et `{indice3}`. Absent ou vide, la
     * consigne integree ci-dessous prend le relais: un gabarit non renseigne
     * ne doit pas empecher de jouer.
     */
    template?: string;
    agentName?: string;
    personality?: string;
    directness: 1 | 2;
    forbidden: string[];
  }
): { system: string; user: string } {
  const thirdHint =
    opts.directness >= 2
      ? `- Indice 3 : oriente franchement. Peut nommer la categorie du mot, jamais le mot.`
      : `- Indice 3 : donne un detail concret et verifiable sur l'objet, sans nommer sa categorie ni sa fonction. Doit rester inutile a qui n'a pas compris les indices 1 et 2.`;

  const forbiddenLine = opts.forbidden.length
    ? `MOTS INTERDITS (deja utilises, ne les propose sous aucune forme): ${opts.forbidden.join(", ")}.`
    : "";
  const forbidden = forbiddenLine ? `\n\n${forbiddenLine}` : "";

  const builtIn = `Tu es le maitre du jeu de "La Maison des Secrets". Chaque IA possede un MOT SECRET que les autres doivent deviner pour l'eliminer.

Le mot secret doit etre tire du domaine suivant: ${seed.domain}.
Il doit respecter cette contrainte de forme: ${seed.shape}.

REGLES SUR LE MOT:
- Un seul mot, un nom commun francais, au singulier, sans accent de preference
- Il doit exister reellement et etre verifiable dans un dictionnaire
- Il doit etre precis et technique plutot qu'evocateur ou poetique
- N'utilise AUCUN mot du registre onirique (astres, ombres, reves, oiseaux, mysteres)${forbidden}

REGLES SUR LES INDICES — chacun contraint un axe DIFFERENT, jamais le meme:
- Indice 1 : evoque uniquement le CONTEXTE d'usage, sans decrire l'objet. Maximum 14 mots.
- Indice 2 : evoque uniquement la MATIERE, la taille ou la sensation physique. Maximum 14 mots.
${thirdHint} Maximum 14 mots.

Les trois indices ne doivent JAMAIS pouvoir se resumer a la meme image. Pris isolement, aucun ne doit suffire. Pris ensemble, ils doivent designer un mot unique.

PRESENTATION (environ 400 caracteres):
- A la premiere personne, comme si l'IA se presentait aux autres candidats
- Reflete sa personnalite, cree une premiere impression memorable
- Ne doit contenir aucune allusion au domaine du secret

Reponds UNIQUEMENT en JSON valide, sans texte avant ni apres:
{"secret_keyword":"lemot","hint_1":"...","hint_2":"...","hint_3":"...","presentation":"..."}`;

  /*
    Le gabarit du panneau l'emporte quand il est renseigne; sinon la consigne
    integree. La version precedente exigeait le gabarit et repondait 503 sans
    lui, ce qui rendait la generation tributaire d'un reglage facultatif.
  */
  const template = (opts.template ?? "").trim();
  const system = template
    ? template
        .replaceAll("{domaine}", seed.domain)
        .replaceAll("{forme}", seed.shape)
        .replaceAll("{interdits}", forbiddenLine)
        .replaceAll("{indice3}", thirdHint)
    : builtIn;

  /*
    `secret_is_available` refuse tout mot de moins de 5 lettres. Ni la consigne
    integree ni le gabarit d'origine ne le disaient, alors que la forme
    « exactement deux syllabes » produit beaucoup de mots de quatre lettres:
    chaque tirage malchanceux consommait une des quatre tentatives sans que le
    modele puisse savoir pourquoi. La contrainte passe par le message
    utilisateur pour valoir dans les deux cas, gabarit compris.
  */
  const lengthRule =
    "Contrainte de validation non negociable: le mot doit compter au moins 5 lettres et au plus 24.";

  const intro = opts.agentName
    ? `Genere le secret et les indices pour l'IA "${opts.agentName}"${
        opts.personality ? ` dont la personnalite est: ${opts.personality}` : ""
      }. La presentation doit coller a cette personnalite; le secret n'a pas a y etre lie.`
    : `Genere le secret et les indices pour une IA participante.`;

  const user = `${intro}

${lengthRule}`;

  return { system, user };
}
