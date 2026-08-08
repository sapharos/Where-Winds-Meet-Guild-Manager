/**
 * Un gremio inventado, para trabajar la interfaz sin pedirle nada a nadie.
 *
 * No es un juego de datos bonito: es un juego de datos incómodo. Lo que hace
 * falta para diseñar no es el caso medio, que ya se ve en cualquier captura,
 * sino los que rompen la maqueta y casi nunca están delante cuando toca --
 * el nombre que no cabe, la línea llena, quien no ha registrado ninguna build,
 * la guerra con treinta participantes, el miembro dado de baja. Aquí están
 * todos a la vez y a propósito.
 *
 * Los nombres son inventados. Ningún dato de aquí sale del gremio real.
 */

import {
  Deployment,
  GuildRank,
  MembershipStatus,
  Platform,
  Player,
  PlayerBuild,
  Role,
  WarLane,
  WarSide,
  WarStrategy,
  WeaponSet,
} from '../types';

export const weaponSets: WeaponSet[] = [
  { id: 'ws-1', name: 'Filo', weapons: ['Espada larga', 'Sable'], color: '#c2564a', icon: 'fa-khanda', sortOrder: 1 },
  { id: 'ws-2', name: 'Asta', weapons: ['Lanza', 'Alabarda'], color: '#4a7fc2', icon: 'fa-staff-snake', sortOrder: 2 },
  { id: 'ws-3', name: 'Cuerda y viento', weapons: ['Abanico', 'Sombrilla', 'Laúd'], color: '#5fa383', icon: 'fa-fan', sortOrder: 3 },
  { id: 'ws-4', name: 'Puño', weapons: ['Guanteletes', 'Nudillos'], color: '#b08a3a', icon: 'fa-hand-fist', sortOrder: 4 },
];

export const ranks: GuildRank[] = [
  { id: 'rank-leader', name: 'Líder', color: '#c99b45' },
  { id: 'rank-officer', name: 'Oficial', color: '#4a7fc2' },
  { id: 'rank-veteran', name: 'Veterano', color: '#5fa383' },
];

/** Nombres inventados, con un par pensados para no caber. */
const NAMES = [
  'Mei Lin', 'Wei Chen', 'Jinwei Zhao', 'Ruolan', 'Bai Hu', 'Shen Yue',
  'Cang Ming', 'Li Qiu', 'Han Xue', 'Yun Fei', 'Tao Ran', 'Zhu Yin',
  'Gu Wen', 'Nian Nian', 'Xiao Die', 'Lu Bei', 'An Ning', 'Feng Ling',
  'Qi Yuan', 'Song Mei', 'Ye Hua', 'Mo Yan', 'Chen Xi', 'Ding Yi',
  'Wu Kong', 'Su Ling', 'Pei Ran', 'Kong Que', 'Bao Zhu', 'Lan Yin',
  'La Sombra que Camina Bajo la Lluvia', // el que no cabe en 140px
  'Yu', // el que sobra sitio
  'Jiang Li', 'Xu Ming', 'Zhou Ping',
];

const ROLES = [Role.TANK, Role.HEALER, Role.DPS];
const SECT_POOL = ['Well of Heaven', 'Silver Needle', 'Midnight Blades', 'Lone Cloud', 'Sectless'];

export const players: Player[] = NAMES.map((name, at) => ({
  id: `p-${at + 1}`,
  name,
  gameUid: at % 4 === 0 ? undefined : String(100000000 + at * 7919),
  role: ROLES[at % 3],
  level: 55 + ((at * 3) % 25),
  sect: SECT_POOL[at % SECT_POOL.length],
  platform: at % 3 === 0 ? Platform.PC : at % 3 === 1 ? Platform.MOBILE : Platform.PS5,
  status: at % 7 === 0 ? MembershipStatus.APPRENTICE : MembershipStatus.FULL_MEMBER,
  rankId: at === 0 ? 'rank-leader' : at < 4 ? 'rank-officer' : at < 9 ? 'rank-veteran' : undefined,
  isStarter: at % 3 !== 2,
  warSide: at % 5 === 4 ? null : at % 2 === 0 ? 'attack' : 'defense',
  // Dos fuera del gremio: el roster tiene que saber dibujar una baja.
  isActive: at === 31 || at === 33 ? false : true,
  martialMastery: 9000 + ((at * 617) % 6000),
}));

/**
 * Builds. Tres miembros se quedan sin ninguna a propósito: la tarjeta sin
 * build es un estado real y es el que se olvida al maquetar.
 */
export const builds: PlayerBuild[] = players
  .filter((_, at) => at % 8 !== 5)
  .flatMap((player, at) => {
    const first: PlayerBuild = {
      id: `b-${player.id}-1`,
      playerId: player.id,
      name: ['Doble hoja', 'Muro de hierro', 'Soporte de línea', 'Viento cortante'][at % 4],
      weapons: [weaponSets[at % 4].weapons[0], weaponSets[(at + 2) % 4].weapons[0]],
      roles: at % 5 === 0 ? [Role.DPS, Role.TANK] : [ROLES[at % 3]],
      isPrimary: true,
    };
    if (at % 3 !== 0) return [first];
    return [
      first,
      {
        id: `b-${player.id}-2`,
        playerId: player.id,
        name: 'Alternativa de asedio',
        // Un arma que ya no está en ningún conjunto: PlayerCard tiene un aviso
        // para esto y hay que poder verlo.
        weapons: at % 9 === 0 ? ['Hacha de guerra'] : [weaponSets[(at + 1) % 4].weapons[0]],
        roles: [ROLES[(at + 1) % 3]],
        isPrimary: false,
      },
    ];
  });

const targets = (tank: number, healer: number, dps: number) => ({ tank, healer, dps });

export const strategies: WarStrategy[] = [
  {
    id: 'st-1',
    side: 'attack',
    name: 'Vanguardia Sombría',
    composition: { left: targets(2, 1, 4), center: targets(3, 2, 5), right: targets(2, 1, 3) },
    // La escolta va con canal de voz propio y las otras dos sin él a
    // propósito: los botones de reunir y devolver sólo se entienden viendo al
    // lado una unidad que todavía no tiene dónde reunirse.
    units: [
      { id: 'u-1', name: 'Punta de lanza', icon: 'fa-khanda', color: '#c2564a', tank: 2, healer: 1, dps: 2 },
      {
        id: 'u-2',
        name: 'Escolta del féretro',
        icon: 'fa-box',
        color: '#4a7fc2',
        tank: 1,
        healer: 2,
        dps: 1,
        voiceChannelId: '200000000000000010',
      },
      { id: 'u-3', name: 'Campamentos', icon: 'fa-fire', color: '#5fa383', tank: 1, healer: 1, dps: 3 },
    ],
  },
  {
    id: 'st-2',
    side: 'defense',
    name: 'Muro de Nueve Puertas',
    composition: { left: targets(3, 2, 2), center: targets(4, 2, 4), right: targets(3, 1, 2) },
    units: [{ id: 'u-4', name: 'Reserva', icon: 'fa-shield', color: '#b08a3a', tank: 2, healer: 1, dps: 2 }],
  },
];

/**
 * El despliegue: la línea central llena a 10/10 y las otras a medias.
 * Una línea llena es el caso que decide si la maqueta aguanta.
 */
const LANES: WarLane[] = ['left', 'center', 'right'];

export const deployments: Deployment[] = (() => {
  const out: Deployment[] = [];
  const reparto: [WarSide, WarLane, number][] = [
    ['attack', 'center', 10],
    ['attack', 'left', 5],
    ['attack', 'right', 2],
    ['defense', 'center', 6],
    ['defense', 'left', 3],
    ['defense', 'right', 2],
  ];
  let next = 0;
  for (const [side, lane, howMany] of reparto) {
    for (let i = 0; i < howMany; i++) {
      const player = players.filter((p) => p.isActive !== false)[next++];
      if (!player) break;
      out.push({
        side,
        lane,
        playerId: player.id,
        unitIds: side === 'attack' && i % 2 === 0 ? [strategies[0].units[i % 3].id] : [],
        buildId: null,
      });
    }
  }
  return out;
})();

/**
 * Una guerra empezada hace doce minutos, para que los relojes corran.
 *
 * Con `?aviso` arranca donde falta poco para la jungla, que es la única forma
 * de ver la alerta sin esperar cinco minutos delante de la pantalla. La jungla
 * sale cada cinco minutos y avisa a falta de uno, así que empezar hace 3:55
 * deja el aviso a cinco segundos vista.
 *
 * Con `?boss` arranca dentro de la ventana del primer boss (del 4:00 al 6:00),
 * que es el estado en el que los botones de cantarlo tienen sentido y el panel
 * cuenta el próximo salto de treinta segundos.
 */
const HACE = () => {
  const query = new URLSearchParams(location.search);
  if (query.has('aviso')) return 3 * 60_000 + 55_000;
  if (query.has('boss')) return 4 * 60_000 + 40_000;
  return 12 * 60_000;
};

export const board = () => ({
  active: { attack: 'st-1', defense: 'st-2' } as Record<WarSide, string | null>,
  locked: { attack: true, defense: true } as Record<WarSide, boolean>,
  current: {
    id: 'w-actual',
    name: 'Asedio del Paso Norte',
    startedAt: new Date(Date.now() - HACE()).toISOString(),
    matchType: 'league' as const,
  },
  now: new Date().toISOString(),
});

const FIGURE_KEYS = ['kills', 'assists', 'deaths', 'coin', 'damage', 'taken', 'healing', 'siege'];

const figuresFor = (seed: number): Record<string, number> =>
  Object.fromEntries(
    FIGURE_KEYS.map((key, at) => [
      key,
      Math.round(((seed * 37 + at * 911) % 100) * (key === 'damage' || key === 'siege' ? 4200 : key === 'coin' ? 90 : 1)),
    ]),
  );

const participantsFor = (howMany: number, seed: number) =>
  players.slice(0, howMany).map((p, at) => ({
    playerId: p.id,
    name: p.name,
    side: (at % 2 === 0 ? 'attack' : 'defense') as WarSide,
    stats: figuresFor(seed + at),
    weapons: builds.find((b) => b.playerId === p.id)?.weapons ?? [],
  }));

const day = (ago: number) => new Date(Date.now() - ago * 86400000).toISOString();

/** Cinco guerras cerradas. La primera trae treinta participantes. */
export const wars = [
  { id: 'w-1', name: 'Asedio del Paso Norte', startedAt: day(2), endedAt: day(2), matchType: 'league' as const, outcome: 'win' as const, seed: 3, count: 30 },
  { id: 'w-2', name: 'Puente de Sauces', startedAt: day(5), endedAt: day(5), matchType: 'ranked' as const, outcome: 'loss' as const, seed: 11, count: 24 },
  { id: 'w-3', name: 'Reto contra Nube Errante', startedAt: day(9), endedAt: day(9), matchType: 'custom' as const, outcome: 'win' as const, seed: 19, count: 18 },
  { id: 'w-4', name: 'Vado de Piedra', startedAt: day(14), endedAt: day(14), matchType: 'league' as const, outcome: null, seed: 27, count: 12 },
  { id: 'w-5', name: 'La primera', startedAt: day(21), endedAt: day(21), matchType: 'league' as const, outcome: 'loss' as const, seed: 41, count: 8 },
];

export const warRows = wars.map((w) => ({
  id: w.id,
  name: w.name,
  startedAt: w.startedAt,
  endedAt: w.endedAt,
  matchType: w.matchType,
  outcome: w.outcome,
  participants: w.count,
  images: w.id === 'w-1' ? 3 : 0,
}));

export const warDetail = (id: string) => {
  const w = wars.find((x) => x.id === id);
  if (!w) return null;
  return { ...w, images: [], participants: participantsFor(w.count, w.seed) };
};

export const warsOf = (playerId: string) =>
  wars
    .filter((w) => participantsFor(w.count, w.seed).some((p) => p.playerId === playerId))
    .map((w) => ({
      id: w.id,
      name: w.name,
      startedAt: w.startedAt,
      endedAt: w.endedAt,
      matchType: w.matchType,
      outcome: w.outcome,
      participants: participantsFor(w.count, w.seed),
    }));

/** Cuatro barridos, para que "Mis estadísticas" tenga cambio que enseñar. */
export const scansOf = (playerId: string) => {
  const at = players.findIndex((p) => p.id === playerId);
  if (at < 0) return [];
  return [21, 14, 7, 0].map((ago, i) => ({
    scannedAt: day(ago),
    level: 55 + ((at * 3) % 25),
    sect: SECT_POOL[at % SECT_POOL.length],
    days_joined: 40 + i * 7 + at,
    week_activity: 1800 + i * 220 + ((at * 91) % 400),
    treasure_tokens_week: 12 + i * 3,
    treasure_tokens_total: 180 + i * 40 + at,
    weekly_clears: 4 + (i % 3),
    highest_floor: 30 + i + (at % 5),
    league_participations: 3 + i,
    ranked_participations: 2 + (i % 2),
    martial_mastery: 9000 + ((at * 617) % 6000) + i * 180,
    exploration_mastery: 4000 + i * 90,
    profession_mastery: 2600 + i * 55,
  }));
};

export const session = {
  user: { id: 'u-1', username: 'jinwei', role: 'leader' as const, playerId: 'p-3' },
  permissions: [
    'roster.view', 'roster.edit', 'roster.uid', 'ranks.manage', 'war.view', 'war.edit', 'war.voice',
    'events.manage', 'events.reset', 'data.export', 'data.import', 'builds.manage',
    'users.manage',
    'permissions.manage',
  ],
};
