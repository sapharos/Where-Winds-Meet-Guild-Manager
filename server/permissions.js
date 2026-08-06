// Role ids are stable identifiers, not display text -- the UI supplies the
// wording. Order matters: it is the order shown in the permission matrix.
export const ROLES = ['admin', 'leader', 'subleader', 'officer', 'member'];

export const PERMISSIONS = [
  'roster.view',
  'roster.edit',
  // Cambiar el UID del juego. Aparte de editar el resto de la ficha porque es
  // la identidad del miembro: es lo que empareja los escaneos, y tocarlo mal
  // rompe el historial de alguien sin decir nada.
  'roster.uid',
  'ranks.manage',
  'war.view',
  'war.edit',
  'war.voice',
  'events.manage',
  'data.export',
  'data.import',
  'builds.manage',
  'users.manage',
  'permissions.manage',
];

// Applied once, when a guild has no permission rows yet. After that the matrix
// is whatever the leaders have set it to.
export const DEFAULT_PERMISSIONS = {
  admin: [...PERMISSIONS],
  leader: [...PERMISSIONS],
  subleader: [
    'roster.view',
    'roster.edit',
    'roster.uid',
    'war.view',
    'war.edit',
    'war.voice',
    'events.manage',
    'data.export',
  ],
  officer: ['roster.view', 'war.view', 'war.edit', 'war.voice', 'events.manage', 'data.export'],
  member: ['roster.view', 'war.view'],
};

// Without this, one careless save could strip the last account able to reach
// the permission editor and lock everyone out of their own guild.
export const LOCKED = {
  admin: ['users.manage', 'permissions.manage'],
};

export function applyLocked(role, permissions) {
  const locked = LOCKED[role] || [];
  return [...new Set([...permissions, ...locked])];
}
