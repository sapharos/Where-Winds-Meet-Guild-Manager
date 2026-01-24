
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

export interface Player {
  id: string;
  name: string;
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

// Collaboration types
export type PeerRole = 'HOST' | 'CLIENT' | 'STANDALONE';

export interface SyncPacket {
  players: Player[];
  sessions: GuildWarSession[];
  ranks: GuildRank[];
  timestamp: number;
}
