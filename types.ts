
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

export const WAR_LANES: { id: WarLane; label: string; colour: string }[] = [
  { id: 'left', label: 'Línea Izquierda', colour: '#eab308' },
  { id: 'center', label: 'Línea Central', colour: '#ef4444' },
  { id: 'right', label: 'Línea Derecha', colour: '#3b82f6' },
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

export const PERMISSION_LABELS: Record<string, string> = {
  'roster.view': 'Ver el roster',
  'roster.edit': 'Editar miembros',
  'ranks.manage': 'Gestionar rangos',
  'war.view': 'Ver la War Room',
  'war.edit': 'Editar despliegues y unidades',
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

// Collaboration types
export type PeerRole = 'HOST' | 'CLIENT' | 'STANDALONE';

export interface SyncPacket {
  players: Player[];
  sessions: GuildWarSession[];
  ranks: GuildRank[];
  timestamp: number;
}
