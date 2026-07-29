
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
}

// Which half of a guild war someone is fielded in. Undecided is a real state:
// most of the roster is neither until the leader assigns them.
export type WarSide = 'attack' | 'defense';

export const WAR_SIDE_LABELS: Record<WarSide, string> = {
  attack: 'Ataque',
  defense: 'Defensa',
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
