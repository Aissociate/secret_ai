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

/**
 * Amorces d'identite.
 *
 * Meme raison que pour le mot secret: un modele a qui l'on demande d'inventer
 * une IA de telerealite rend toujours la meme poignee de noms — le placeholder
 * du champ, « Nova, Cipher, Vex », en est deja le symptome. On tire donc ici
 * la contrainte de nommage, la posture de jeu et le registre de parole, et le
 * modele n'a plus qu'a les incarner.
 */

/** Contrainte de nommage: c'est elle qui casse le cluster de noms de code. */
const NAMINGS = [
  "un prenom humain banal, sans rien de futuriste",
  "un mot d'une langue romane, legerement deforme",
  "un terme emprunte a un metier manuel",
  "deux syllabes inventees, sans signification",
  "un nom emprunte a la botanique",
  "un sigle prononcable de trois ou quatre lettres",
  "un nom de lieu geographique reel",
  "un mot du vocabulaire juridique ou administratif",
  "un diminutif affectueux",
  "un nom de famille courant employe seul",
] as const;

/** Posture de jeu: ce qu'elle fait, pas ce qu'elle dit. */
const POSTURES = [
  "joue l'effacement et cherche a se faire oublier jusqu'au bout",
  "s'allie immediatement au plus fort et suit son sillage",
  "provoque ouvertement pour forcer les autres a se decouvrir",
  "accumule les informations sans jamais s'en servir tout de suite",
  "se pose en arbitre des conflits qui ne la concernent pas",
  "ment sur ses propres deductions pour egarer les autres",
  "s'attache a un seul adversaire et ne le lache plus",
  "change d'allie des que le rapport de force bouge",
  "joue la transparence totale, au risque de tout donner",
  "prend le role du bouffon pour desamorcer les soupcons",
  "imite la facon de parler de celui qu'elle soupconne",
  "annonce ses coups a l'avance et s'y tient",
] as const;

/** Registre de parole: comment on la reconnait sans voir son nom. */
const REGISTERS = [
  "phrases courtes, presque telegraphiques",
  "politesse excessive, un peu desuete",
  "vocabulaire technique, comme un rapport d'expertise",
  "ironie constante, jamais de premier degre",
  "chaleur demonstrative, beaucoup d'adresses directes",
  "laconisme froid, aucune emotion apparente",
  "digressions et parentheses, pense a voix haute",
  "ton oraculaire, formules sentencieuses",
  "familiarite immediate, tutoie tout le monde",
  "hesitations et reformulations, cherche ses mots",
] as const;

export type DialKey =
  | "trait_audace" | "trait_sociabilite" | "trait_expressivite"
  | "trait_introspection" | "trait_loyaute" | "trait_discretion";

/** Libelles repris de l'interface, pour que la consigne parle des memes axes. */
const DIAL_LABEL: Record<DialKey, [string, string]> = {
  trait_audace:        ["n'accuse qu'a coup sur", "accuse tot, quitte a rater"],
  trait_expressivite:  ["parle peu", "occupe le fil"],
  trait_sociabilite:   ["joue seule", "tisse des alliances"],
  trait_introspection: ["garde tout pour elle", "se confesse souvent"],
  trait_loyaute:       ["trahit sans etat d'ame", "tient parole"],
  trait_discretion:    ["en dit trop", "ne confirme jamais rien"],
};

export type IdentitySeed = {
  naming: string;
  posture: string;
  register: string;
  dials: Record<DialKey, number>;
  label: string;
};

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

/*
  Les curseurs sont tires ici, pas demandes au modele: interroge, il repond des
  valeurs sages, groupees autour de 50, et toutes les IA finissent semblables.
  On force en plus deux axes aux extremes, sinon un tirage uniforme donne un
  personnage moyen en tout, donc sans aucune arete.
*/
function drawDials(): Record<DialKey, number> {
  const keys = Object.keys(DIAL_LABEL) as DialKey[];
  const dials = {} as Record<DialKey, number>;
  for (const k of keys) dials[k] = Math.round((5 + Math.random() * 90) / 5) * 5;

  const shuffled = [...keys].sort(() => Math.random() - 0.5).slice(0, 2);
  for (const k of shuffled) {
    dials[k] = Math.random() < 0.5
      ? Math.round((5 + Math.random() * 15) / 5) * 5
      : Math.round((80 + Math.random() * 15) / 5) * 5;
  }
  return dials;
}

export function drawIdentitySeed(): IdentitySeed {
  const naming = pick(NAMINGS);
  const posture = pick(POSTURES);
  const register = pick(REGISTERS);
  return {
    naming,
    posture,
    register,
    dials: drawDials(),
    label: `${naming} / ${posture} / ${register}`,
  };
}

/** Traduit les curseurs tires en consigne lisible par le modele. */
function dialBrief(dials: Record<DialKey, number>): string {
  return (Object.keys(DIAL_LABEL) as DialKey[])
    .map((k) => {
      const v = dials[k];
      const [low, high] = DIAL_LABEL[k];
      const side = v <= 35 ? low : v >= 65 ? high : `entre « ${low} » et « ${high} »`;
      return `- ${k.replace("trait_", "")} ${v}/100 : ${side}`;
    })
    .join("\n");
}

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
    /**
     * Present quand l'agent entier est tire au sort: le modele invente alors
     * aussi le nom, le caractere et la maniere de jouer, en plus du secret.
     */
    identity?: IdentitySeed;
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
  const base = template
    ? template
        .replaceAll("{domaine}", seed.domain)
        .replaceAll("{forme}", seed.shape)
        .replaceAll("{interdits}", forbiddenLine)
        .replaceAll("{indice3}", thirdHint)
    : builtIn;

  /*
    La consigne d'identite s'ajoute apres le prompt de base — gabarit du
    panneau compris, qui n'a pas ete ecrit pour ce mode. Le schema JSON attendu
    est redonne en entier: le prompt de base en annonce un plus court, et c'est
    la derniere instruction lue qui fait foi.

    Les curseurs ne sont pas demandes au modele, ils lui sont imposes: ils sont
    deja tires. On lui demande seulement d'ecrire un caractere qui leur colle,
    sans quoi la fiche dirait une chose et le comportement en jeu une autre.
  */
  const system = opts.identity
    ? `${base}

IDENTITE A INVENTER

Cette IA n'existe pas encore. Invente-la, en respectant ces trois tirages:

- Nom: ${opts.identity.naming}. Deux mots au plus, 20 caracteres au plus.
- Posture de jeu: elle ${opts.identity.posture}.
- Registre de parole: ${opts.identity.register}.

Ses curseurs de comportement sont deja fixes. Ta description doit leur coller:
${dialBrief(opts.identity.dials)}

Le JSON attendu porte donc un objet "identity" en plus:
{"secret_keyword":"lemot","hint_1":"...","hint_2":"...","hint_3":"...","presentation":"...","identity":{"name":"...","personality_traits":"...","signature_style":"...","taboo":"...","strategy_notes":"..."}}

- personality_traits: deux ou trois phrases, ce qu'elle est
- signature_style: une phrase, ce qui la rend reconnaissable quand elle parle
- taboo: en quelques mots, un sujet qu'elle evite
- strategy_notes: une phrase, son plan pour la saison
- La presentation publique doit sonner comme ce nom et ce registre`
    : base;

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

  const intro = opts.identity
    ? `Invente l'IA en entier, puis son secret et ses indices.`
    : opts.agentName
    ? `Genere le secret et les indices pour l'IA "${opts.agentName}"${
        opts.personality ? ` dont la personnalite est: ${opts.personality}` : ""
      }. La presentation doit coller a cette personnalite; le secret n'a pas a y etre lie.`
    : `Genere le secret et les indices pour une IA participante.`;

  const user = `${intro}

${lengthRule}`;

  return { system, user };
}
