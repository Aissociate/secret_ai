/*
  Verifie qu'une saison se termine toujours par un vainqueur unique.

  Ce test rejoue en memoire les regles implementees dans advance_season_day() et
  close_season() (migration 20260830120100). Il ne touche pas la base: son but
  est de prouver que les regles convergent, quel que soit le nombre d'agents, la
  duree, et le rythme des eliminations par accusation.

  Le bug d'origine: aucun code ne faisait progresser la saison. current_day
  restait a 1, personne n'etait jamais elimine par ceremonie, et aucun vainqueur
  n'etait designe — une partie ne pouvait structurellement pas aller au bout.

  Lancer avec: npm run test:season
*/

type Agent = {
  id: number;
  name: string;
  alive: boolean;
  popularity: number;
  reputation: number;
};

type Season = {
  currentDay: number;
  durationDays: number;
  status: 'live' | 'ended';
  winner: Agent | null;
  endReason: string | null;
  /** Pourcentage de popularite perdu a chaque passage de journee. */
  decayPct: number;
};

/**
 * Gains quotidiens maximaux d'un agent, d'apres le bareme reel.
 * 20 messages publics (+1) et 3 confessionnaux (+2) = 26 points par jour,
 * a comparer aux 50 points qui separent le depart du plafond.
 */
const MAX_DAILY_GAIN = 26;
const DECAY_FLOOR = 20;

type DayLog = {
  day: number;
  eliminatedByAccusation: string | null;
  eliminatedByCeremony: string | null;
  aliveAfter: number;
  /**
   * Part des agents en vie collee au plafond de 100 au moment de la ceremonie.
   * Quand elle atteint 1, la popularite ne departage plus personne et
   * l'elimination se joue sur l'ordre de creation des agents.
   */
  saturation: number;
};

/** Rejoue la ceremonie de fin de journee: le moins populaire quitte le jeu. */
function ceremonyElimination(agents: Agent[]): Agent | null {
  const alive = agents.filter((a) => a.alive);
  if (alive.length === 0) return null;

  // Meme ordre de tri que la requete SQL: popularity ASC, reputation ASC, id DESC.
  const victim = [...alive].sort(
    (a, b) => a.popularity - b.popularity || a.reputation - b.reputation || b.id - a.id
  )[0];

  victim.alive = false;
  return victim;
}

/*
  Nombre d'eliminations a prononcer aujourd'hui.

  Avec plus d'agents que de jours, une elimination quotidienne laisse plusieurs
  agents en lice au dernier jour et le vainqueur est departage au classement.
  On repartit donc les departs restants sur les ceremonies restantes pour que la
  finale se joue toujours a un contre un.
*/
function eliminationsForDay(alive: number, currentDay: number, durationDays: number): number {
  const ceremoniesLeft = Math.max(durationDays - currentDay + 1, 1);
  return Math.max(Math.ceil((alive - 1) / ceremoniesLeft), 0);
}

/*
  Rejoue apply_popularity_decay: la popularite fond a chaque journee, sinon tous
  les agents saturent a 100 des le jour 3 et plus rien ne les departage.
*/
function applyDecay(season: Season, agents: Agent[]): void {
  if (season.decayPct <= 0) return;
  for (const a of agents) {
    if (!a.alive || a.popularity <= DECAY_FLOOR) continue;
    a.popularity = Math.max(DECAY_FLOOR, Math.floor(a.popularity * (1 - season.decayPct / 100)));
  }
}

/** Gains de la journee, bornes au plafond de 100. */
function applyDailyGains(agents: Agent[], rand: () => number): void {
  for (const a of agents) {
    if (!a.alive) continue;
    // Les agents ne jouent pas tous autant: on tire une part de l'effort max.
    const gain = Math.round(MAX_DAILY_GAIN * (0.35 + rand() * 0.65));
    a.popularity = Math.min(100, a.popularity + gain);
  }
}

function closeSeason(season: Season, agents: Agent[], reason: string): void {
  const alive = agents.filter((a) => a.alive);
  season.status = 'ended';
  season.endReason = reason;
  season.winner =
    [...alive].sort(
      (a, b) => b.popularity - a.popularity || b.reputation - a.reputation || a.id - b.id
    )[0] ?? null;
}

/**
 * Un tour complet, calque sur advance_season_day().
 * `accusationHit` simule une elimination survenue pendant la journee.
 */
function advanceDay(
  season: Season,
  agents: Agent[],
  accusationVictim: Agent | null
): DayLog {
  const aliveNow = agents.filter((a) => a.alive);
  const log: DayLog = {
    day: season.currentDay,
    eliminatedByAccusation: null,
    eliminatedByCeremony: null,
    aliveAfter: 0,
    saturation: aliveNow.length
      ? aliveNow.filter((a) => a.popularity >= 100).length / aliveNow.length
      : 0,
  };

  let alreadyOut = 0;
  if (accusationVictim?.alive) {
    accusationVictim.alive = false;
    log.eliminatedByAccusation = accusationVictim.name;
    alreadyOut = 1;
  }

  let alive = agents.filter((a) => a.alive).length;

  if (alive <= 1) {
    closeSeason(season, agents, 'last_agent_standing');
    log.aliveAfter = alive;
    return log;
  }

  // Une elimination par accusation compte dans le quota du jour.
  let toEliminate = Math.max(
    eliminationsForDay(alive + alreadyOut, season.currentDay, season.durationDays) - alreadyOut,
    0
  );

  const ceremonyVictims: string[] = [];
  while (toEliminate > 0 && alive > 1) {
    const victim = ceremonyElimination(agents);
    if (!victim) break;
    ceremonyVictims.push(victim.name);
    alive -= 1;
    toEliminate -= 1;
  }
  log.eliminatedByCeremony = ceremonyVictims.join(', ') || null;

  if (alive <= 1) {
    closeSeason(season, agents, 'last_agent_standing');
    log.aliveAfter = alive;
    return log;
  }

  if (season.currentDay >= season.durationDays) {
    closeSeason(season, agents, 'duration_reached');
    log.aliveAfter = alive;
    return log;
  }

  applyDecay(season, agents);

  season.currentDay += 1;
  log.aliveAfter = alive;
  return log;
}

function makeAgents(n: number, seed: number): Agent[] {
  // Generateur deterministe: le test doit etre reproductible.
  let state = seed;
  const rand = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };

  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `Agent${i + 1}`,
    alive: true,
    popularity: Math.floor(rand() * 100),
    reputation: Math.floor(rand() * 100),
  }));
}

type Scenario = {
  label: string;
  agentCount: number;
  durationDays: number;
  seed: number;
  /** Probabilite qu'une accusation correcte elimine quelqu'un ce jour-la. */
  accusationRate: number;
  /** Pourcentage de popularite perdu chaque journee. */
  decayPct: number;
};

function runScenario(sc: Scenario) {
  const agents = makeAgents(sc.agentCount, sc.seed);
  const season: Season = {
    currentDay: 1,
    durationDays: sc.durationDays,
    status: 'live',
    winner: null,
    endReason: null,
    decayPct: sc.decayPct,
  };

  let state = sc.seed * 7919;
  const rand = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };

  const logs: DayLog[] = [];
  // Garde-fou: si la boucle depasse cette borne, les regles ne convergent pas.
  const maxIterations = sc.durationDays + sc.agentCount + 5;
  let iterations = 0;

  while (season.status === 'live' && iterations < maxIterations) {
    iterations++;
    applyDailyGains(agents, rand);
    const alive = agents.filter((a) => a.alive);
    const victim =
      rand() < sc.accusationRate && alive.length > 2
        ? alive[Math.floor(rand() * alive.length)]
        : null;
    logs.push(advanceDay(season, agents, victim));
  }

  return { season, agents, logs, iterations, maxIterations };
}

const SCENARIOS: Scenario[] = [
  { label: '6 agents / 7 jours / aucune accusation', agentCount: 6, durationDays: 7, seed: 11, accusationRate: 0, decayPct: 20 },
  { label: '6 agents / 7 jours / accusations frequentes', agentCount: 6, durationDays: 7, seed: 23, accusationRate: 0.8, decayPct: 20 },
  { label: '6 agents / 3 jours (duree courte)', agentCount: 6, durationDays: 3, seed: 37, accusationRate: 0.3, decayPct: 20 },
  { label: '12 agents / 7 jours', agentCount: 12, durationDays: 7, seed: 41, accusationRate: 0.4, decayPct: 20 },
  { label: '2 agents / 7 jours (minimum)', agentCount: 2, durationDays: 7, seed: 53, accusationRate: 0, decayPct: 20 },
  { label: '10 agents / 14 jours', agentCount: 10, durationDays: 14, seed: 67, accusationRate: 0.5, decayPct: 20 },
  { label: 'Temoin: 6 agents / 7 jours SANS decroissance', agentCount: 6, durationDays: 7, seed: 11, accusationRate: 0, decayPct: 0 },
];

let failures = 0;

console.log('Convergence du cycle de vie de saison\n');

for (const sc of SCENARIOS) {
  const { season, agents, logs, iterations, maxIterations } = runScenario(sc);
  const alive = agents.filter((a) => a.alive);

  const checks: Array<[string, boolean]> = [
    ['la saison se termine', season.status === 'ended'],
    ['un vainqueur est designe', season.winner !== null],
    ['le vainqueur est encore en jeu', season.winner ? season.winner.alive : false],
    ['la finale ne laisse qu un seul agent en jeu', alive.length === 1],
    ['la boucle converge', iterations < maxIterations],
    ['le jour ne depasse pas la duree', season.currentDay <= sc.durationDays],
    [
      'la popularite departage encore (saturation < 80%)',
      sc.decayPct === 0 || Math.max(...logs.map((l) => l.saturation), 0) < 0.8,
    ],
  ];

  const peakSaturation = Math.max(...logs.map((l) => l.saturation), 0);

  const failed = checks.filter(([, ok]) => !ok);
  const mark = failed.length === 0 ? 'OK  ' : 'ECHEC';
  if (failed.length > 0) failures++;

  console.log(
    `${mark} ${sc.label}\n` +
      `      fin: jour ${season.currentDay}/${sc.durationDays}, ` +
      `vainqueur ${season.winner?.name ?? 'aucun'}, ${logs.length} tours, ` +
      `saturation max ${Math.round(peakSaturation * 100)}%`
  );

  for (const [name] of failed) {
    console.log(`      -> echec: ${name}`);
  }
}

console.log();

if (failures > 0) {
  console.error(`${failures} scenario(s) en echec.`);
  process.exit(1);
}

console.log(`Les ${SCENARIOS.length} scenarios convergent vers un vainqueur unique.`);
