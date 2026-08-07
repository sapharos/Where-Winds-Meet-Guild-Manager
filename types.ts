
export enum Role {
  TANK = 'Tank',
  HEALER = 'Healer',
  DPS = 'DPS'
}

export enum Lane {
  TOP = 'Top Lane',
  MID = 'Mid Lane',
  BOT = 'Bottom Lane',
  UNASSIGNED = 'Unassigned'
}

// Shown instead of the enum values, which are stored on every assignment in the
// database and so cannot be translated without rewriting past war plans.
export const LANE_NAMES: Record<Lane, string> = {
  [Lane.TOP]: 'Línea superior',
  [Lane.MID]: 'Línea central',
  [Lane.BOT]: 'Línea inferior',
  [Lane.UNASSIGNED]: 'Sin asignar',
};

// The battlefield as the guild fights it: three lanes, each side fielding ten.
export type WarLane = 'left' | 'center' | 'right';

// Los nombres son de color y los ids de posición, y no es una incoherencia: el
// gremio las llama por su color, pero `left`/`center`/`right` está escrito en
// cada despliegue guardado desde que existe el tablero. Renombrar el id sería
// reescribir todas las guerras pasadas para no ganar nada -- el nombre que se
// lee es este `label`, y con cambiarlo aquí cambia en todo el producto.
//
// El color ya era el que ahora da nombre: amarillo, rojo y azul estaban en el
// tablero mucho antes de que nadie los dijera en voz alta.
export const WAR_LANES: { id: WarLane; label: string; colour: string }[] = [
  { id: 'left', label: 'Línea Amarilla', colour: '#eab308' },
  { id: 'center', label: 'Línea Roja', colour: '#ef4444' },
  { id: 'right', label: 'Línea Azul', colour: '#3b82f6' },
];

export const LANE_CAPACITY = 10;

// Attack and defence are two halves of one war and share the same thirty
// people: ten to a lane is still the limit, but filling one board empties the
// other. The server enforces this too.
export const WAR_CAPACITY = 30;

export interface Deployment {
  side: WarSide;
  lane: WarLane;
  playerId: string;
  // The tactical units they belong to. More than one is ordinary: the same
  // healer can be on the escort and in the camps.
  unitIds?: string[];
  // Which of their builds they are meant to bring to this war. Unset means the
  // one they usually play.
  buildId?: string | null;
  // Quien habla por la línea. Puede haber varios por línea a propósito.
  isLaneLeader?: boolean;
}

export interface RoleTargets {
  tank: number;
  healer: number;
  dps: number;
}

/**
 * A job within the war -- escorting the coffin, holding the camps -- carried out
 * by people drawn from any of the three lanes. A unit says what it needs, not
 * where it stands, which is why it is not part of a lane.
 */
export interface TacticalUnit extends RoleTargets {
  id: string;
  name: string;
  icon: string;
  color: string;
  notes?: string | null;
}

/**
 * Una formación guardada: el despliegue de un bando, fotografiado con nombre.
 *
 * Es una instantánea y no filas vivas: el roster deriva por debajo, y aplicar
 * una se encarga de la deriva en ese momento -- quien ya no está, quien pelea
 * en el otro bando -- devolviendo a los omitidos con su motivo.
 */
export interface SavedLineup {
  id: string;
  side: WarSide;
  name: string;
  members: {
    playerId: string;
    lane: WarLane;
    unitIds?: string[];
    buildId?: string | null;
    isLaneLeader?: boolean;
  }[];
  createdAt: string;
}

export interface WarStrategy {
  id: string;
  side: WarSide;
  name: string;
  // Per lane, how many of each role the lane is meant to hold.
  composition: Record<WarLane, RoleTargets>;
  units: TacticalUnit[];
  notes?: string | null;
}

export enum Platform {
  PC = 'PC',
  PS5 = 'PS5',
  MOBILE = 'Mobile'
}

export enum MembershipStatus {
  APPRENTICE = 'Apprentice',
  FULL_MEMBER = 'Full Member'
}

export const SECTS = [
  'Sectless',
  'Well of Heaven',
  'Silver Needle',
  'Midnight Blades',
  'Nine Mortal Ways',
  'Velvet Shade',
  'Lone Cloud',
  'Hollow Vale',
  'Mohist Hill',
  'Inkbound Order',
  'Raging Tides',
  'The Masked Troupe'
] as const;

export type Sect = typeof SECTS[number];

export interface GuildRank {
  id: string;
  name: string;
  color: string;
}

// A weapon set as the guild defines it. Kept on the server rather than here
// because the game keeps adding weapons: recording what people already play
// should not wait on a code change. The icon is either a Font Awesome class or
// a small inline picture.
export interface WeaponSet {
  id: string;
  name: string;
  weapons: string[];
  color: string;
  icon?: string | null;
  sortOrder?: number;
  /**
   * What this set is expected to reach on each impact axis, as a fraction of
   * the war's best: { damage: 0.6 } asks a single-target set for 60% of the
   * night's best damage before calling it full marks. Sparse -- an axis that
   * is not listed is expected in full, so an untuned set scores as it always
   * has and a new weapon costs nothing until somebody decides otherwise.
   */
  impact?: Record<string, number> | null;
}

/** The eight places a piece can go, named as the game names them. */
export const GEAR_SLOTS = [
  'leftWeapon',
  'rightWeapon',
  'disc',
  'pendant',
  'helm',
  'armor',
  'greaves',
  'bracer',
] as const;
export type GearSlot = (typeof GEAR_SLOTS)[number];

export const GEAR_SLOT_LABELS: Record<GearSlot, string> = {
  leftWeapon: 'Arma izquierda',
  rightWeapon: 'Arma derecha',
  disc: 'Disco',
  pendant: 'Colgante',
  helm: 'Yelmo',
  armor: 'Armadura',
  greaves: 'Grebas',
  bracer: 'Brazal',
};

/**
 * One attribute line on a piece.
 *
 * Position is what decides what can be done with it, so it is not decoration:
 * 1 never changes, 2 to 5 are the four candidates of which only ever one gets
 * chosen, and 6 is the unlimited one.
 *
 * The pools differ too. Lines 1 to 5 draw from one long list -- forty-six
 * attributes -- shared by every slot and every spec. Line 6 draws from a short
 * list that depends on the piece: three penetration and resistance figures on a
 * weapon, disc or pendant, and the skill-damage boosts tied to the spec's own
 * weapons on a helm, armour, greaves or bracer.
 *
 * Both pools are closed lists now, in services/gearCatalog.ts. They used to be
 * gathered from whatever members typed, which was honest about not knowing the
 * list but had a failure with no bottom to it: a misreading saved once joined
 * everybody's suggestions and then matched every later copy of itself
 * perfectly.
 */
export interface GearLine {
  position: 1 | 2 | 3 | 4 | 5 | 6;
  /**
   * The attribute, folded to a key everyone's readings agree on: accents and
   * case stripped, and the game's "[Girar]" marker removed so a line keys the
   * same before and after somebody rerolls it. Computed on the server.
   *
   * Folded from the catalogue's English name rather than from what the member
   * saw, so a Spanish and an English client agree on one key for one attribute
   * -- which is what the shared ceilings rest on.
   */
  stat: string;
  /** The name as the member reads it on their own screen. */
  label: string;
  /** Null when the game clipped the line and no ceiling is known yet to infer it. */
  value: number | null;
  unit: 'flat' | 'percent';
  /**
   * How much of this attribute's maximum the roll reached, 0 to 1, measured off
   * the bar the game draws. The whole point of reading the picture rather than
   * just the text: it gives the ceiling without anyone looking anything up.
   */
  fill: number | null;
  /**
   * The one line of 2..5 already rerolled, which the game marks "[Girar]" and
   * rings with a glow. Once one is set the other three are shut for good, so
   * this is the single most consequential fact about a piece.
   */
  committed: boolean;
  /** The name overflowed and the value never rendered. Recoverable from fill x ceiling. */
  truncated: boolean;
  /** Position 6 only: the two lists are separate and a piece may hold one of each. */
  tuning?: 'normal' | 'arena';
  /** Position 6 only: which of the two is switched on. Only the active one is captured. */
  active?: boolean;
  /**
   * The colour the game draws this line's bar in, gold or violet.
   *
   * Recorded and reproduced without being interpreted. An earlier guess that
   * violet meant "cannot be rerolled" held on the Afinación screen, where only
   * the first line was violet, and fell apart on a relayed piece where four of
   * the six are. So it is drawn because the game draws it, and nothing is
   * inferred from it.
   */
  hue?: 'gold' | 'violet';
}

/**
 * A whole set of eight pieces, built for one path with one of your builds.
 *
 * A member does not have "their gear" -- they have the set they take to war and
 * the set they farm in, and the same helm is a good piece in one and a wasted
 * slot in the other. So a piece belongs to a set, and a set belongs to a build
 * and declares which of the nine paths it is aiming at. That declaration is the
 * whole reason the dropdowns can be closed lists: without knowing the path,
 * every attribute in the game is equally plausible on every line.
 */
export interface GearSet {
  id: string;
  playerId: string;
  /** Which build in the member's profile this set is for. */
  buildId: string | null;
  name: string;
  /** A Spec id from services/gearCatalog.ts. Decides every dropdown's pool. */
  spec: string;
  /** The one that opens when the member has not picked. */
  isPrimary: boolean;
  updatedAt: string;
}

export interface GearPiece {
  id: string;
  playerId: string;
  /** The set this piece belongs to. One piece per slot per set. */
  setId: string;
  slot: GearSlot;
  name: string | null;
  level: number | null;
  /** Carried up from an older set, which freezes every line. Nothing to advise. */
  relayed: boolean;
  /** When it can be tuned again, from the countdown the screen shows. */
  tuneReadyAt: string | null;
  lines: GearLine[];
  capturedAt: string | null;
  updatedAt: string;
}

/** How high one attribute rolls at one item level, learned from what people upload. */
export interface GearCeiling {
  stat: string;
  level: number;
  ceiling: number;
  samples: number;
}

export interface PlayerBuild {
  id: string;
  playerId: string;
  name: string;
  weapons: string[];
  // More than one is the point: a pair played as Tank and Healer at once is a
  // real build, and a single primary role cannot describe it.
  roles: Role[];
  isPrimary: boolean;
  notes?: string;
}

export interface TacticalGroup {
  id: string;
  name: string;
  icon: string;
  color: string;
}

export interface Player {
  id: string;
  name: string;
  gameUid?: string;
  onlineId?: string;
  role: Role;
  level: number;
  sect: string;
  platform?: Platform;
  status: MembershipStatus;
  rankId?: string; 
  notes?: string;
  isStarter?: boolean;
  warSide?: WarSide | null;
  isActive?: boolean;
  // Read from the last sweep that captured it. Scanned, never typed, which is
  // why the roster editor neither shows it nor sends it back.
  martialMastery?: number;
}

// Which half of a guild war someone is fielded in. Undecided is a real state:
// most of the roster is neither until the leader assigns them.
export type WarSide = 'attack' | 'defense';

export const WAR_SIDE_LABELS: Record<WarSide, string> = {
  attack: 'Ataque',
  defense: 'Defensa',
};

// Liga, ranked o un reto concertado contra un gremio concreto. Decidido al
// iniciar la guerra, que es cuando quien la organiza ya lo sabe.
export type WarMatchType = 'league' | 'ranked' | 'custom';

export const WAR_MATCH_TYPE_LABELS: Record<WarMatchType, string> = {
  league: 'Liga',
  ranked: 'Ranked',
  custom: 'Personalizada (reto)',
};

// Cómo terminó. Puede quedar sin marcar: una guerra que nadie cerró a mano la
// cierra el reloj a los treinta minutos, sin nadie delante que lo diga.
export type WarOutcome = 'win' | 'loss';

export const WAR_OUTCOME_LABELS: Record<WarOutcome, string> = {
  win: 'Victoria',
  loss: 'Derrota',
};

export interface WarAssignment {
  playerId: string;
  lane: Lane;
  groupId: string | null; 
}

export interface GuildWarSession {
  id: string;
  name: string;
  date: string;
  assignments: WarAssignment[];
  groups: TacticalGroup[];
}

// Authentication and access control. Named UserRole to keep it distinct from
// Role above, which is a player's combat role.
export type UserRole = 'admin' | 'leader' | 'subleader' | 'officer' | 'member';

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  leader: 'Líder',
  subleader: 'Sublíder',
  officer: 'Oficial',
  member: 'Miembro',
};

// De más mando a menos, que es como se leen. Gemelo de ROLES en
// server/permissions.js, del que sale el orden de la matriz de permisos.
export const USER_ROLES: UserRole[] = ['admin', 'leader', 'subleader', 'officer', 'member'];

/**
 * Un rol del servidor de Discord, como lo devuelve el bot.
 *
 * No son los rangos de arriba: son los que el gremio ya usa a diario en su
 * servidor -- «Guerra A», «Veterano» -- y tienen el grano que hace falta para
 * decidir a quién se le pregunta en una convocatoria.
 *
 * `color` es null cuando el rol no tiene ninguno, que Discord pinta gris.
 */
export interface DiscordRole {
  id: string;
  name: string;
  color: string | null;
}

export const PERMISSION_LABELS: Record<string, string> = {
  'roster.view': 'Ver el roster',
  'roster.edit': 'Editar miembros',
  'roster.uid': 'Cambiar el UID del juego',
  'ranks.manage': 'Gestionar rangos',
  'war.view': 'Ver la War Room',
  'war.edit': 'Editar despliegues y unidades',
  'war.voice': 'Mover a canales de voz',
  'events.manage': 'Programar eventos',
  'data.export': 'Exportar datos',
  'data.import': 'Importar datos',
  'builds.manage': 'Editar builds de cualquiera',
  'users.manage': 'Gestionar usuarios',
  'permissions.manage': 'Editar permisos',
};

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  // The roster entry this account belongs to, when a leader has linked one.
  playerId?: string | null;
}

export interface ManagedUser extends AuthUser {
  disabled: boolean;
  createdAt?: string;
  // Enlazado al entrar con Discord, o a mano por un líder desde el panel.
  discordId?: string | null;
  discordUsername?: string | null;
}

/** Un miembro del servidor de Discord, tal como lo devuelve el bot. */
export interface DiscordMember {
  id: string;
  username: string;
  globalName: string | null;
  nick: string | null;
}

/** Un canal de voz del servidor de Discord, para elegirlo en la configuración. */
export interface DiscordVoiceChannel {
  id: string;
  name: string;
}

/**
 * Qué canal de voz corresponde a cada ranura de la guerra: 'general', un
 * bando ('attack'), o una línea de un bando ('attack:left'). Ranura sin
 * entrada = sin canal asignado, y el reparto se salta a quien caiga en ella.
 */
export type VoiceChannelMap = Record<string, string>;

/**
 * Las ranuras con su nombre de cara, en el orden en que se leen. Los ids
 * calcan los VOICE_SLOTS del servidor: cambiarlos aquí sin cambiarlos allí es
 * guardar en ranuras que nadie leerá. Lo usan la configuración del panel y el
 * cuerno de la Sala de Guerra, por eso vive junto a los tipos.
 */
export const VOICE_SLOT_LABELS: { slot: string; label: string }[] = [
  { slot: 'general', label: 'Reunión general' },
  { slot: 'leaders', label: 'Líderes de línea' },
  { slot: 'attack', label: 'Bando · Ataque' },
  { slot: 'defense', label: 'Bando · Defensa' },
  ...WAR_LANES.map((l) => ({ slot: `attack:${l.id}`, label: `Ataque · ${l.label}` })),
  ...WAR_LANES.map((l) => ({ slot: `defense:${l.id}`, label: `Defensa · ${l.label}` })),
];

/* ------------------------------------------------------------------ agenda */

export type EventKind = 'war' | 'practice' | 'pve' | 'casual';

export const EVENT_KINDS: EventKind[] = ['war', 'practice', 'pve', 'casual'];

export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  war: 'Guerra de gremio',
  practice: 'Guerra de práctica',
  pve: 'Evento PvE',
  casual: 'Actividad del gremio',
};

// Cada tipo con su icono, del mismo juego que ya usa la aplicación.
export const EVENT_KIND_ICONS: Record<EventKind, string> = {
  war: 'fa-chess-knight',
  practice: 'fa-dumbbell',
  pve: 'fa-dragon',
  casual: 'fa-mug-hot',
};

export type EventAnswer = 'yes' | 'no' | 'maybe';

export const EVENT_ANSWER_LABELS: Record<EventAnswer, string> = {
  yes: 'Voy',
  maybe: 'Tal vez',
  no: 'No puedo',
};

/**
 * Qué se puede contestar, según lo que se pregunte, y en el orden en que se
 * lee.
 *
 * En una guerra no hay «tal vez»: las líneas se reparten con nombres, y quien
 * dice que quizá ocupa un hueco que a la hora de armar el tablero está vacío.
 *
 * Gemelo de `respuestasDe` en server/events.js, que es quien manda: aquí
 * decide qué botones se enseñan, allí decide qué se guarda.
 */
export const respuestasDe = (kind: EventKind): EventAnswer[] =>
  kind === 'war' ? ['yes', 'no'] : ['yes', 'maybe', 'no'];

export interface EventResponse {
  playerId: string;
  name: string;
  role: Role;
  answer: EventAnswer;
  note: string | null;
  /** El id del usuario que la escribió, cuando no fue el propio miembro. */
  answeredBy: string | null;
  source: string;
  updatedAt: string;
}

export interface GuildEvent {
  id: string;
  kind: EventKind;
  title: string;
  startsAt: string;
  minutes: number;
  notes: string | null;
  /**
   * Qué roles de Discord pueden contestar la encuesta. Vacío: el gremio entero.
   *
   * Son ids de roles del servidor de Discord. Se guardan los ids y no los
   * nombres: un rol renombrado sigue siendo el mismo rol.
   */
  allowedRoles: string[];
  opensAt: string | null;
  closesAt: string | null;
  cancelledAt: string | null;
  createdBy: string | null;
  /** Dónde quedó publicada la encuesta, cuando se publicó. */
  discordChannelId?: string | null;
  discordMessageId?: string | null;
  /** El enlace a ese mensaje, si el servidor sabe componerlo. */
  discordUrl?: string | null;
  /** Publicada, pero en un canal que ya no es el de la agenda. */
  discordStale?: boolean;
  /** Sólo al listar: el recuento de cada respuesta. */
  yes?: number;
  maybe?: number;
  no?: number;
  /** Sólo al pedir uno concreto. */
  responses?: EventResponse[];
  /**
   * Sólo al pedir uno concreto: si quien lo pidió puede contestarlo, y si su
   * cuenta está vinculada a Discord.
   *
   * Lo decide el servidor porque los roles de Discord de cada uno los sabe él;
   * `discordLinked` separa los dos motivos de un `mayAnswer` en false, que se
   * arreglan de formas distintas.
   */
  mayAnswer?: boolean;
  discordLinked?: boolean;
  /** Sólo en «lo mío»: lo que contestó quien pregunta, o null si no contestó. */
  mine?: { answer: EventAnswer } | null;
}

/** Lo que se repite cada semana y de lo que salen los eventos concretos. */
export interface EventSeries {
  id: string;
  kind: EventKind;
  title: string;
  /** 0 = domingo … 6 = sábado. */
  weekday: number;
  timeLocal: string;
  timezone: string;
  minutes: number;
  notes: string | null;
  allowedRoles: string[];
  opensDaysBefore: number;
  opensTime: string;
  closesDaysBefore: number;
  closesTime: string;
  autoPublish: boolean;
  active: boolean;
}

export const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/** Un sonido del panel de sonidos del servidor de Discord. */
export interface DiscordSoundboardSound {
  id: string;
  name: string;
  emoji: string | null;
}

export interface PermissionCatalog {
  roles: UserRole[];
  permissions: string[];
  matrix: Record<string, string[]>;
}

// Captured guild data
export type ScanFields = Record<string, string | number | null>;

// Every value a sweep carries, in the order the game's panel lists them, so a
// gap can be filled in by hand without hunting for it.
export const SCAN_FIELD_CATALOG: { key: string; label: string; kind: 'int' | 'text' }[] = [
  { key: 'level', label: 'Nivel', kind: 'int' },
  { key: 'sect', label: 'Secta', kind: 'text' },
  { key: 'region', label: 'Región', kind: 'text' },
  { key: 'language', label: 'Idioma', kind: 'text' },
  { key: 'days_joined', label: 'Días en el gremio', kind: 'int' },
  { key: 'week_activity', label: 'Actividad semanal', kind: 'int' },
  { key: 'treasure_tokens_week', label: 'Tokens de la semana', kind: 'int' },
  { key: 'treasure_tokens_total', label: 'Tokens totales', kind: 'int' },
  { key: 'weekly_clears', label: 'Clears de la semana', kind: 'int' },
  { key: 'last_week_clears', label: 'Clears semana previa', kind: 'int' },
  { key: 'highest_floor', label: 'Piso más alto', kind: 'int' },
  { key: 'league_participations', label: 'Partidas de liga', kind: 'int' },
  { key: 'ranked_participations', label: 'Partidas ranked', kind: 'int' },
  { key: 'duel_participations', label: 'Duelos', kind: 'int' },
  { key: 'martial_mastery', label: 'Maestría marcial', kind: 'int' },
  { key: 'exploration_mastery', label: 'Maestría exploración', kind: 'int' },
  { key: 'profession_mastery', label: 'Maestría profesión', kind: 'int' },
];

export interface ScanDocument {
  scannedAt?: string;
  source?: string;
  entries: { nameAsRead: string; fields: ScanFields; uid?: string; onlineId?: string }[];
}

export interface ScanPreviewEntry {
  nameAsRead: string;
  fields: ScanFields;
  uid: string | null;
  // 'uid' outranks the rest: the account number cannot be changed, so it still
  // identifies a member who renamed themselves.
  match: 'uid' | 'alias' | 'exact' | 'suggested' | 'none';
  renamed?: boolean;
  playerId: string | null;
  playerName: string | null;
  suggestions: { playerId: string; name: string; score: number }[];
}

export interface ScanRecord extends ScanFields {
  scannedAt: string;
}

// Los tipos de la colaboración por PeerJS vivieron aquí hasta agosto de 2026,
// cuando la función se retiró entera: era de antes de que existiera la API.
