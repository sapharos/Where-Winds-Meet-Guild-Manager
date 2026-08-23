// Role ids are stable identifiers, not display text -- the UI supplies the
// wording. Order matters: it is the order shown in the permission matrix.
export const ROLES = ['admin', 'leader', 'subleader', 'officer', 'member'];

// Cómo se llaman de cara. Gemelo de ROLE_LABELS en types.ts, para que un rango
// se llame igual en la web y en cualquier cosa que escriba el servidor.
export const ROLE_LABELS = {
  admin: 'Administrador',
  leader: 'Líder',
  subleader: 'Sublíder',
  officer: 'Oficial',
  member: 'Miembro',
};

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
  // Subir la grabación de una guerra. Aparte de `war.edit` porque lo tiene todo
  // el mundo: el que graba es quien peleó, no quien organiza. Aun así el
  // servidor sólo acepta la subida si quien la manda figura en
  // `war_participants` de esa guerra -- el permiso abre la puerta, no la deja
  // sin portero.
  'war.vod.upload',
  // Publicar un VOD subido. Hasta que alguien lo mira no existe para nadie, que
  // es lo único que impide que esto se llene de grabaciones que no son de la
  // guerra.
  'war.vod.approve',
  // Salvar un VOD de la retención de 3 meses. Aparte de aprobar porque es la
  // única acción aquí que gasta disco para siempre.
  'war.vod.pin',
  'events.manage',
  // Borrar todo lo contestado de una encuesta y empezarla de cero. Aparte de
  // programar porque no se deshace: quien organiza corrige la hora a diario,
  // pero tirar cincuenta respuestas es otra cosa.
  'events.reset',
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
    'war.vod.upload',
    'war.vod.approve',
    'war.vod.pin',
    'events.manage',
    'events.reset',
    'data.export',
  ],
  officer: [
    'roster.view',
    'war.view',
    'war.edit',
    'war.voice',
    'war.vod.upload',
    'war.vod.approve',
    'events.manage',
    'data.export',
  ],
  // Subir es de todos: el que graba es el que peleó. Fijar no, que gasta disco
  // para siempre.
  member: ['roster.view', 'war.view', 'war.vod.upload'],
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
