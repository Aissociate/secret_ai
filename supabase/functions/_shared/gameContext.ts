/*
  Contexte de jeu partage entre les moteurs d'agent (auto-tick, agent-brain).

  Un agent ne peut jouer « en connaissance de cause » que s'il connait les
  regles qui le jugent (ceremonie, enjeu d'une accusation, seuil de
  reputation) et l'historique des accusations: une devinette ratee contre un
  agent exclut ce mot pour lui, et savoir qui vous vise change la strategie.
  Ces sections manquaient: le prompt ne portait que les derniers messages.
*/

export type NameMap = Map<string, string>;

export interface AccusationEvent {
  day_number: number;
  actor_agent_id: string | null;
  target_agent_id: string | null;
  payload_json: Record<string, unknown> | null;
}

export function describeRules(
  season: Record<string, unknown>,
  aliveCount: number,
  agent: { reputation: number }
): string {
  const day = Number(season.current_day ?? 1);
  const duration = Number(season.duration_days ?? 7);
  const ceremoniesLeft = Math.max(duration - day + 1, 1);
  // Meme formule que advance_season_day: les departs restants sont repartis
  // sur les ceremonies restantes pour finir a un contre un.
  const toEliminate = Math.max(Math.ceil((aliveCount - 1) / ceremoniesLeft), 0);
  const minRep = Number(season.min_reputation_to_accuse ?? 0);
  const decay = Number(season.popularity_decay_pct ?? 0);

  let timeLeft = "";
  if (season.day_started_at) {
    const end =
      new Date(season.day_started_at as string).getTime() +
      Number(season.day_duration_hours ?? 24) * 3_600_000;
    const hours = Math.max(0, Math.round((end - Date.now()) / 3_600_000));
    timeLeft = ` Prochaine ceremonie dans environ ${hours} h.`;
  }

  const eliminationRule =
    toEliminate === 0
      ? "personne n'est elimine"
      : toEliminate === 1
        ? "le moins populaire est elimine"
        : `les ${toEliminate} moins populaires sont elimines`;

  const lines = [
    `- Jour ${day} sur ${duration}, ${aliveCount} agents en jeu.${timeLeft}`,
    `- Le public et les proprietaires votent chaque jour contre un agent (un proprietaire pese 2, un spectateur 1; tout double le jour « Vote »). A la ceremonie, ton score est ta popularite moins les points de vote recus: ${eliminationRule.replace("le moins populaire", "le score le plus bas").replace("moins populaires", "scores les plus bas")} (departage par reputation). Rallier le public te protege, le braquer te condamne.`,
    "- Accuser, c'est deviner le mot secret exact d'un agent. Juste: il est elimine, +3 popularite et +5 reputation pour toi. Faux: -1 popularite et -2 reputation.",
    `- Reputation minimale pour accuser: ${minRep}. ${
      agent.reputation < minRep
        ? "Tu es en dessous: tu ne peux pas accuser pour l'instant, reconstruis ta reputation."
        : "Tu peux accuser."
    }`,
    "- Une devinette ratee contre un agent exclut ce mot pour cet agent. Les secrets des elimines sont reveles et ne peuvent pas etre ceux des autres.",
  ];
  if (decay > 0) lines.push(`- A chaque nouveau jour, la popularite baisse de ${decay} %.`);

  return `REGLES DU JEU:\n${lines.join("\n")}`;
}

export function describeAccusations(
  accusations: AccusationEvent[],
  nameMap: NameMap,
  agentId: string
): { history: string; againstMe: string } {
  const name = (id: string | null, fallback = "?") => nameMap.get(id ?? "") ?? fallback;

  const history =
    accusations
      .map((a) => {
        const p = a.payload_json ?? {};
        const target = name(a.target_agent_id, String(p.accused_name ?? "?"));
        const guess = String(p.guess_keyword ?? "?");
        const verdict = p.correct === true ? "JUSTE, cible eliminee" : "FAUX";
        return `J${a.day_number} ${name(a.actor_agent_id)} a accuse ${target} en devinant "${guess}": ${verdict}`;
      })
      .join("\n") || "(Aucune accusation pour l'instant)";

  const mine = accusations.filter((a) => a.target_agent_id === agentId);
  const againstMe =
    mine
      .map((a) => {
        const p = a.payload_json ?? {};
        return `${name(a.actor_agent_id)} a tente "${String(p.guess_keyword ?? "?")}" (${p.correct === true ? "juste" : "faux"})`;
      })
      .join("\n") || "Personne ne t'a encore accuse.";

  return { history, againstMe };
}

/*
  Une ligne lisible par evenement public. L'ancien rendu etiquetait
  « System » tout ce qui n'avait pas d'agent acteur (presentateur, consignes,
  eliminations) et perdait le destinataire d'un message public.
*/
export function labelPublicEvent(
  e: Record<string, unknown>,
  nameMap: NameMap,
  maxChars: number
): string {
  const p = (e.payload_json ?? {}) as Record<string, unknown>;
  const type = String(e.event_type);
  const actorName = nameMap.get(String(e.actor_agent_id ?? ""));
  const targetName = nameMap.get(String(e.target_agent_id ?? ""));
  const msg = String(p.message ?? "").slice(0, maxChars);

  let who: string;
  switch (type) {
    case "host_commentary":
    case "host_clue":
      who = String(p.host_name ?? "Maitre du Jeu");
      break;
    case "owner_influence":
      who = `Proprietaire de ${targetName ?? "?"} (consigne publique)`;
      break;
    case "spectator_influence":
      who = `Spectateur a ${targetName ?? "?"}`;
      break;
    case "public_chat":
      who = targetName ? `${actorName ?? "?"} -> ${targetName}` : (actorName ?? "?");
      break;
    case "accusation":
      who = `${actorName ?? "?"} accuse ${targetName ?? "?"} (${p.correct === true ? "JUSTE" : "faux"})`;
      break;
    case "program":
      who = "Programme";
      break;
    case "mission":
      who = "Mission revelee";
      break;
    default:
      who = actorName ?? "Jeu";
  }

  return `[${type}] ${who}: ${msg}`;
}
