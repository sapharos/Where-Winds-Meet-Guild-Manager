
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

export interface TacticalGroup {
  id: string;
  name: string;
  icon: string;
  color: string;
}

// Ranks the game shows in its Positions column, mapped to what we call them.
// Anything absent from this table is treated as an officer rank on purpose:
// ordinary members are always labelled "Members", so an unfamiliar label is
// some kind of elevated rank, and reading it as one errs the safer way.
export const GAME_POSITIONS: Record<string, string> = {
  members: 'Miembro',
  member: 'Miembro',
  miembros: 'Miembro',
  apprentice: 'Aprendiz',
  oficiales: 'Oficial',
  officers: 'Oficial',
  officer: 'Oficial',
  elites: 'Oficial',
};

export function positionLabel(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined;
  return GAME_POSITIONS[raw.trim().toLowerCase()] ?? 'Oficial';
}

export interface Player {
  id: string;
  name: string;
  gameUid?: string;
  onlineId?: string;
  gamePosition?: string;
  role: Role;
  level: number;
  sect: string;
  platform?: Platform;
  status: MembershipStatus;
  rankId?: string; 
  notes?: string;
}

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
  'users.manage': 'Gestionar usuarios',
  'permissions.manage': 'Editar permisos',
};

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
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
