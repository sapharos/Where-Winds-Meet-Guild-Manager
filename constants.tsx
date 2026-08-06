
import React from 'react';
import { Role, Lane, TacticalGroup, Platform } from './types';

// Relleno sólido con icono blanco, no el tinte al 10% de antes: un icono de
// color sobre su propio color diluido era lo primero que se perdía con poco
// contraste, y en tema claro directamente desaparecía. Los peldaños 700 llevan
// blanco encima con holgura en los dos temas.
export const ROLE_COLORS = {
  [Role.TANK]: 'bg-sky-700 text-white',
  [Role.HEALER]: 'bg-emerald-700 text-white',
  [Role.DPS]: 'bg-red-700 text-white'
};

export const ROLE_ICONS = {
  [Role.TANK]: <i className="fa-solid fa-shield-halved"></i>,
  [Role.HEALER]: <i className="fa-solid fa-heart-pulse"></i>,
  [Role.DPS]: <i className="fa-solid fa-burst"></i>
};

export const PLATFORM_ICONS = {
  [Platform.PC]: <i className="fa-solid fa-desktop"></i>,
  [Platform.PS5]: <i className="fa-brands fa-playstation"></i>,
  [Platform.MOBILE]: <i className="fa-solid fa-mobile-screen-button"></i>
};

export const LANE_DATA = [
  { id: Lane.TOP, icon: <i className="fa-solid fa-arrow-up"></i>, color: 'border-cyan-900' },
  { id: Lane.MID, icon: <i className="fa-solid fa-arrows-left-right"></i>, color: 'border-amber-900' },
  { id: Lane.BOT, icon: <i className="fa-solid fa-arrow-down"></i>, color: 'border-emerald-900' }
];

export const DEFAULT_GROUPS: TacticalGroup[] = [
  { id: 'g-performer', name: 'Half-Time Performers', icon: 'fa-user-ninja', color: 'amber' },
  { id: 'g-jungle', name: 'Jungle/Camp Squad', icon: 'fa-leaf', color: 'indigo' },
  { id: 'g-escort', name: 'Coffin Escort Team', icon: 'fa-truck-moving', color: 'cyan' }
];

export const GROUP_ICONS = [
  'fa-user-ninja', 'fa-leaf', 'fa-truck-moving', 'fa-fire', 'fa-skull', 'fa-bolt', 'fa-eye', 'fa-anchor'
];

export const GROUP_COLORS = [
  'amber', 'indigo', 'cyan', 'rose', 'emerald', 'violet', 'orange', 'sky'
];

export const MAX_WAR_PLAYERS = 30;
