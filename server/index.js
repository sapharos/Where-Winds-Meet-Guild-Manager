import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import express from 'express';
import { pool, migrate, replaceAll, replacePlayers, GUILD_ID } from './db.js';
import { ROLES, PERMISSIONS } from './permissions.js';
import { matchEntries, commitScan, historyFor, scanSummary } from './scans.js';
import { listBuilds, saveBuilds, mayEditBuilds } from './builds.js';
import {
  listGear,
  listGearSets,
  saveGearSet,
  deleteGearSet,
  listCeilings,
  listStatLabels,
  listStatOverrides,
  setStatOverride,
  renameStat,
  saveGearPiece,
  deleteGearPiece,
  migrateLegacyStats,
  mayEditGear,
} from './gear.js';
import { listWeaponSets, saveWeaponSets, seedWeaponSets } from './weapons.js';
import {
  getDeployments,
  place,
  reorder,
  setUnits,
  setBuild,
  setLaneLeader,
  clearSide,
  listStrategies,
  saveStrategy,
  deleteStrategy,
  getBoard,
  setActiveStrategy,
  setLock,
  startWar,
  endWar,
  updateWar,
  deleteWar,
  listWars,
  warDetail,
  warsFor,
  addWarImage,
  removeWarImage,
  setContribution,
  listLineups,
  saveLineup,
  applyLineup,
  deleteLineup,
  currentWar,
  callBoss,
  currentCall,
} from './war.js';
import {
  discordEnabled,
  beginDiscord,
  finishDiscord,
  readPending,
  clearPending,
  requestRegistration,
  listRegistrations,
  approveRegistration,
  rejectRegistration,
} from './discord.js';
import { botEnabled, searchGuildMembers, listVoiceChannels, listSoundboardSounds } from './discordBot.js';
import {
  commandsEnabled,
  verifyInteraction,
  handleInteraction,
  nombreDeInteraccion,
  quienManda,
  registerCommands,
  getBotRoles,
  setBotRoles,
  publicarEvento,
  refrescarEvento,
  repintarEvento,
  retirarEvento,
  startAgendaScheduler,
} from './discordCommands.js';
import { listSeries, saveSeries, deleteSeries, seedSeries, asegurarEventos } from './agenda.js';
import {
  listTextChannels,
  listGuildRoles,
  memberRoles,
  editOriginalInteraction,
  followUpInteraction,
} from './discordBot.js';
import { VOICE_SLOTS, getVoiceChannels, setVoiceChannels, deployVoice, moveUnit } from './voice.js';
import {
  listEvents,
  getEvent,
  saveEvent,
  cancelEvent,
  deleteEvent,
  respond,
  resetResponses,
  puedeContestar,
  getAgendaChannel,
  getAgendaChannels,
  setAgendaChannel,
  nextWar,
  myEvents,
} from './events.js';
import { getHorn, setHorn, sweepSound, warnEvent, startHornScheduler } from './horn.js';
import {
  initAuth,
  hashPassword,
  sessionSecret,
  verifyLogin,
  issueCookie,
  clearCookie,
  requireAuth,
  requirePermission,
  permissionMatrix,
  saveMatrix,
} from './auth.js';

const app = express();
app.use(
  express.json({
    limit: '5mb',
    // Discord firma los bytes exactos que manda, así que la ruta de comandos
    // necesita el cuerpo antes de que nadie lo interprete: volver a serializar
    // el objeto ya parseado cambia el orden de las claves y el espaciado, y
    // con ello la firma deja de cuadrar. Se guarda sólo para esa ruta; el
    // resto de la API no tiene por qué arrastrar una copia de cada cuerpo.
    verify: (req, _res, buf) => {
      if (req.url.startsWith('/api/discord/interactions')) req.rawBody = buf;
    },
  }),
);
app.use(cookieParser());

const PORT = Number(process.env.PORT) || 3001;
const MIN_PASSWORD = 8;

const asHandler = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(`${req.method} ${req.path} failed:`, err);
    res.status(500).json({ error: 'internal error' });
  });

const requireArray = (req, res) => {
  if (Array.isArray(req.body)) return req.body;
  res.status(400).json({ error: 'expected a JSON array' });
  return null;
};

app.get('/api/health', asHandler(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok', guild: GUILD_ID });
}));

/* ---------------------------------------------------------------- session */

app.post('/api/auth/login', asHandler(async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });

  const user = await verifyLogin(username, password);
  if (!user) return res.status(401).json({ error: 'invalid credentials' });

  issueCookie(res, user);
  res.json({ user, permissions: await permissionMatrix().then((m) => m[user.role] ?? []) });
}));

app.post('/api/auth/logout', (_req, res) => {
  clearCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, asHandler(async (req, res) => {
  res.json({ user: req.user, permissions: req.permissions });
}));

app.post('/api/auth/change-password', requireAuth, asHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!newPassword || newPassword.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `password must be at least ${MIN_PASSWORD} characters` });
  }
  if (!(await verifyLogin(req.user.username, currentPassword ?? ''))) {
    return res.status(403).json({ error: 'current password is incorrect' });
  }
  await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
    await hashPassword(newPassword),
    req.user.id,
  ]);
  res.json({ ok: true });
}));

/* ---------------------------------------------------------------- discord */

// Lets the sign-in screen offer the Discord button only when it would work.
app.get('/api/auth/config', (_req, res) => res.json({ discord: discordEnabled() }));

app.get('/api/auth/discord/start', asHandler(async (_req, res) => {
  if (!discordEnabled()) return res.status(503).json({ error: 'Discord no esta configurado' });
  beginDiscord(res);
}));

app.get('/api/auth/discord/callback', asHandler(async (req, res) => {
  if (!discordEnabled()) return res.status(503).json({ error: 'Discord no esta configurado' });

  const result = await finishDiscord(req, res, sessionSecret());
  if (result.user) {
    issueCookie(res, result.user);
    clearPending(res);
    return res.redirect('/');
  }
  // Recognised by Discord, unknown here: send them to claim a roster entry.
  res.redirect('/?registro=1');
}));

// What the claim screen needs to greet them and to know a claim is possible.
app.get('/api/auth/discord/pending', asHandler(async (req, res) => {
  const pending = readPending(req, sessionSecret());
  if (!pending) return res.status(404).json({ error: 'no hay un registro en curso' });
  res.json(pending);
}));

app.post('/api/auth/discord/claim', asHandler(async (req, res) => {
  const pending = readPending(req, sessionSecret());
  if (!pending) return res.status(440).json({ error: 'el registro caduco; vuelve a empezar' });
  res.json(await requestRegistration(pending, req.body?.uid));
}));

app.get('/api/registrations', requireAuth, requirePermission('users.manage'), asHandler(async (_req, res) => {
  res.json(await listRegistrations());
}));

app.post('/api/registrations/:id/approve', requireAuth, requirePermission('users.manage'), asHandler(async (req, res) => {
  const role = req.body?.role ?? 'member';
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'unknown role' });

  // Approving grants a role like any other assignment, so it obeys the same
  // rules -- otherwise it would be the way around them.
  if (role === 'admin' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'solo un administrador puede nombrar a otro' });
  }
  const holder = await alreadyHeldBy(role, null);
  if (holder) {
    return res.status(409).json({
      error: `${holder} ya tiene ese rol. Quitaselo primero para poder asignarlo.`,
    });
  }

  res.json(await approveRegistration(req.params.id, role));
}));

app.post('/api/registrations/:id/reject', requireAuth, requirePermission('users.manage'), asHandler(async (req, res) => {
  await rejectRegistration(req.params.id);
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ users */

app.get('/api/users', requireAuth, requirePermission('users.manage'), asHandler(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, username, role, disabled, player_id AS "playerId", created_at AS "createdAt",
            discord_id AS "discordId", discord_username AS "discordUsername"
       FROM users WHERE guild_id = $1 ORDER BY username`,
    [GUILD_ID],
  );
  res.json(rows);
}));

app.post('/api/users', requireAuth, requirePermission('users.manage'), asHandler(async (req, res) => {
  const { username, password, role } = req.body ?? {};
  if (!username?.trim()) return res.status(400).json({ error: 'username required' });
  if (!password || password.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `password must be at least ${MIN_PASSWORD} characters` });
  }
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'unknown role' });
  if (role === 'admin' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'solo un administrador puede nombrar a otro' });
  }

  const holder = await alreadyHeldBy(role, null);
  if (holder) {
    return res.status(409).json({
      error: `${holder} ya tiene ese rol. Quitaselo primero para poder asignarlo.`,
    });
  }

  const taken = await pool.query(
    `SELECT 1 FROM users WHERE guild_id = $1 AND lower(username) = lower($2)`,
    [GUILD_ID, username.trim()],
  );
  if (taken.rows.length) return res.status(409).json({ error: 'that username is taken' });

  const id = randomUUID();
  await pool.query(
    `INSERT INTO users (id, guild_id, username, password_hash, role) VALUES ($1, $2, $3, $4, $5)`,
    [id, GUILD_ID, username.trim(), await hashPassword(password), role],
  );
  res.status(201).json({ id, username: username.trim(), role, disabled: false });
}));

// Roles only one person may hold at a time. Handing one over means taking it
// off whoever has it first, which keeps the guild's chain of command something
// somebody decided rather than something that drifted.
const SINGULAR_ROLES = ['leader', 'subleader'];

async function alreadyHeldBy(role, exceptUserId) {
  if (!SINGULAR_ROLES.includes(role)) return null;
  const { rows } = await pool.query(
    `SELECT username FROM users WHERE guild_id = $1 AND role = $2 AND id <> $3`,
    [GUILD_ID, role, exceptUserId ?? ''],
  );
  return rows[0]?.username ?? null;
}

/**
 * Whether this actor may touch this administrator.
 *
 * Administrators are peers in everything except each other: only the account
 * the guild was set up with may take the role away, so no administrator can
 * quietly remove the person who appointed them, and a leader -- who manages
 * accounts but does not outrank an administrator -- cannot touch them at all.
 */
async function mayActOnAdmin(actorId) {
  const { rows } = await pool.query(
    `SELECT is_root AS "isRoot" FROM users WHERE id = $1 AND guild_id = $2`,
    [actorId, GUILD_ID],
  );
  return Boolean(rows[0]?.isRoot);
}

// Refuses any edit that would remove the last account able to administer the
// guild -- changing its role, disabling it, or deleting it.
async function wouldStrandGuild(targetId, { role, disabled } = {}) {
  const { rows } = await pool.query(
    `SELECT id, role FROM users WHERE guild_id = $1 AND disabled = false`,
    [GUILD_ID],
  );
  const remaining = rows.filter((u) => {
    if (u.id !== targetId) return u.role === 'admin';
    if (disabled === true) return false;
    return (role ?? u.role) === 'admin';
  });
  return remaining.length === 0;
}

app.patch('/api/users/:id', requireAuth, requirePermission('users.manage'), asHandler(async (req, res) => {
  const { role, password, disabled } = req.body ?? {};
  const { id } = req.params;

  const { rows } = await pool.query(
    `SELECT id, username, role FROM users WHERE id = $1 AND guild_id = $2`,
    [id, GUILD_ID],
  );
  if (!rows.length) return res.status(404).json({ error: 'no such user' });
  const target = rows[0];

  if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: 'unknown role' });

  // Changing, disabling or deleting an administrator all remove them just the
  // same, so they are guarded together rather than only the obvious one.
  const touchesAdmin = target.role === 'admin' && (role !== undefined || disabled !== undefined);
  if (touchesAdmin && !(await mayActOnAdmin(req.user.id))) {
    return res.status(403).json({
      error: 'solo la cuenta con la que se creo el gremio puede cambiar a un administrador',
    });
  }
  if (role === 'admin' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'solo un administrador puede nombrar a otro' });
  }

  const holder = role === undefined ? null : await alreadyHeldBy(role, id);
  if (holder) {
    return res.status(409).json({
      error: `${holder} ya tiene ese rol. Quitaselo primero para poder asignarlo.`,
    });
  }
  if (password !== undefined && password.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `password must be at least ${MIN_PASSWORD} characters` });
  }
  if ((role !== undefined || disabled !== undefined) && (await wouldStrandGuild(id, { role, disabled }))) {
    return res.status(409).json({ error: 'this is the last administrator account' });
  }

  if (role !== undefined) await pool.query(`UPDATE users SET role = $1 WHERE id = $2`, [role, id]);
  if (disabled !== undefined) await pool.query(`UPDATE users SET disabled = $1 WHERE id = $2`, [disabled, id]);
  if (password !== undefined) {
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [await hashPassword(password), id]);
  }
  res.json({ ok: true });
}));

app.delete('/api/users/:id', requireAuth, requirePermission('users.manage'), asHandler(async (req, res) => {
  const { id } = req.params;
  if (id === req.user.id) return res.status(409).json({ error: 'you cannot delete your own account' });

  const { rows } = await pool.query(`SELECT role FROM users WHERE id = $1 AND guild_id = $2`, [id, GUILD_ID]);
  if (rows[0]?.role === 'admin' && !(await mayActOnAdmin(req.user.id))) {
    return res.status(403).json({
      error: 'solo la cuenta con la que se creo el gremio puede eliminar a un administrador',
    });
  }
  if (await wouldStrandGuild(id, { disabled: true })) {
    return res.status(409).json({ error: 'this is the last administrator account' });
  }
  await pool.query(`DELETE FROM users WHERE id = $1 AND guild_id = $2`, [id, GUILD_ID]);
  res.json({ ok: true });
}));

/* ----------------------------------------------------------------- agenda */

// Ver lo que hay programado no pide permiso: es de lo que va el gremio, y una
// agenda que no se puede leer no convoca a nadie.
app.get('/api/events', requireAuth, asHandler(async (req, res) => {
  res.json(
    await listEvents({
      past: req.query.past === 'true',
      from: req.query.from ?? null,
      to: req.query.to ?? null,
    }),
  );
}));

/*
 * Todas las rutas de nombre fijo, antes que las de `:id`.
 *
 * Express prueba en el orden en que se registran, y `/api/events/:id` casa con
 * un solo segmento -- o sea, también con `/api/events/series`. Puestas después,
 * pedir las series contestaba «no existe ese evento» y crear una guardaba un
 * evento llamado «series». No lo vio el banco de pruebas porque su servidor
 * falso enruta por su cuenta y allí sí estaban en orden.
 */
app.get('/api/events/next-war', requireAuth, asHandler(async (_req, res) => {
  res.json(await nextWar());
}));

// Lo que viene, con lo que contestó quien pregunta. Sin ficha en el roster no
// hay nada que contestar, así que se devuelve vacío en vez de un error: es una
// sección de una pantalla, no una acción que alguien pidió.
app.get('/api/events/mine', requireAuth, asHandler(async (req, res) => {
  res.json(req.user.playerId ? await myEvents(req.user.playerId) : []);
}));

// Los roles del servidor de Discord: los elige quien programa, y los lee todo
// el mundo -- una convocatoria restringida tiene que poder decir a qué roles
// está abierta, y quien la mira no siempre es quien la creó. No pide permiso
// porque no hay nada que guardar: son los mismos nombres que cualquiera del
// gremio ve en la lista de miembros de Discord.
//
// Sin bot devuelve la lista vacía y no un error: la pantalla tiene que poder
// dibujarse igual y decir que falta configurar el bot, que es distinto de
// haberse roto.
app.get('/api/events/config/roles', requireAuth, asHandler(async (_req, res) => {
  res.json({
    bot: botEnabled(),
    roles: botEnabled() ? await listGuildRoles().catch(() => []) : [],
  });
}));

// A qué roles del servidor atiende el bot. Vacío es a todo el mundo, que es el
// estado de fábrica: un gremio que no lo configure tiene el bot abierto, no
// roto. Se lee con la misma llave con la que se escribe porque esta lista sólo
// se enseña en Administración, y ahí ya se está dentro.
app.get('/api/discord/bot-roles', requireAuth, requirePermission('users.manage'), asHandler(async (_req, res) => {
  res.json({
    bot: botEnabled(),
    roles: botEnabled() ? await listGuildRoles().catch(() => []) : [],
    allowed: await getBotRoles(),
  });
}));

app.put('/api/discord/bot-roles', requireAuth, requirePermission('users.manage'), asHandler(async (req, res) => {
  res.json({ allowed: await setBotRoles(req.body?.allowed ?? []) });
}));

// El canal donde se publican las encuestas, elegido de una lista y no copiado a
// mano. Leerlo pide gestionar eventos, que es quien va a publicar en él.
app.get('/api/events/config/channel', requireAuth, requirePermission('events.manage'), asHandler(async (_req, res) => {
  const elegidos = await getAgendaChannels();
  res.json({
    bot: botEnabled(),
    ...elegidos,
    channels: botEnabled() ? await listTextChannels().catch(() => []) : [],
  });
}));

// Sin `kind` se toca el general; con `kind`, el de ese tipo. Vacío lo borra, que
// es como se vuelve a «el mismo que el general».
app.put('/api/events/config/channel', requireAuth, requirePermission('events.manage'), asHandler(async (req, res) => {
  await setAgendaChannel(req.body?.channel, req.body?.kind ?? null);
  res.json(await getAgendaChannels());
}));

/* --- lo que se repite cada semana --- */

app.get('/api/events/series', requireAuth, requirePermission('events.manage'), asHandler(async (_req, res) => {
  res.json(await listSeries());
}));

app.put('/api/events/series/:id?', requireAuth, requirePermission('events.manage'), asHandler(async (req, res) => {
  const serie = await saveSeries({ ...req.body, id: req.params.id || req.body?.id });
  // Al guardar se mira ya si a alguna le toca convocar, para no esperar al
  // siguiente turno del reloj. Lo que todavía no abre sigue sin aparecer: una
  // serie es lo que se repite, no lo que ya está convocado.
  await asegurarEventos();
  res.json(serie);
}));

app.delete('/api/events/series/:id', requireAuth, requirePermission('events.manage'), asHandler(async (req, res) => {
  await deleteSeries(req.params.id);
  res.json({ ok: true });
}));

/**
 * El detalle de un evento, con si quien lo pide puede contestarlo.
 *
 * `mayAnswer` se calcula aquí y no en la pantalla porque los roles de Discord
 * de cada uno los sabe el servidor, no el navegador. Enseñar los botones y que
 * el servidor los rechace luego también funcionaría, pero es peor: quien no
 * está invitado merece saberlo antes de pulsar, no después.
 *
 * `discordLinked` distingue los dos motivos por los que puede salir en false, y
 * son motivos con arreglos distintos: uno se resuelve vinculando la cuenta y el
 * otro pidiéndole el rol a un oficial.
 */
app.get('/api/events/:id', requireAuth, asHandler(async (req, res) => {
  const evento = await getEvent(req.params.id);
  if (!evento.allowedRoles?.length) {
    return res.json({ ...evento, mayAnswer: true, discordLinked: true });
  }
  const suyos = await memberRoles(req.user.discordId);
  res.json({
    ...evento,
    mayAnswer: puedeContestar(evento.allowedRoles, suyos),
    discordLinked: suyos !== null,
  });
}));

app.post('/api/events', requireAuth, requirePermission('events.manage'), asHandler(async (req, res) => {
  res.json(await saveEvent(req.body, req.user.id));
}));

app.put('/api/events/:id', requireAuth, requirePermission('events.manage'), asHandler(async (req, res) => {
  const guardado = await saveEvent({ ...req.body, id: req.params.id }, req.user.id);
  void refrescarEvento(guardado.id);
  res.json(guardado);
}));

app.post('/api/events/:id/cancel', requireAuth, requirePermission('events.manage'), asHandler(async (req, res) => {
  const actualizado = await cancelEvent(req.params.id, req.body?.cancelled !== false);
  void refrescarEvento(actualizado.id);
  res.json(actualizado);
}));

// Reiniciar la encuesta: borra todo lo contestado y deja el evento en pie.
//
// Permiso propio y no `events.manage`: programar es lo de todos los días y esto
// no se deshace. De fábrica llega hasta sublíder.
//
// El mensaje de Discord se reescribe después, que si no se queda enseñando una
// lista de gente que ya no está guardada en ningún sitio.
app.post('/api/events/:id/reset', requireAuth, requirePermission('events.reset'), asHandler(async (req, res) => {
  const { borradas, evento } = await resetResponses(req.params.id);
  void refrescarEvento(evento.id);
  res.json({ ...evento, borradas });
}));

// Lanzar la encuesta al canal. Es un acto y no un efecto de guardar: un evento
// se crea, se corrige y se mira antes de convocar a nadie, y publicar dos veces
// por haber arreglado una errata sería avisar dos veces al gremio.
app.post('/api/events/:id/publish', requireAuth, requirePermission('events.manage'), asHandler(async (req, res) => {
  // El del tipo del evento, con el general de reserva: publicar una guerra no
  // puede fallar porque nadie haya elegido aún dónde va el PvE.
  const suyo = await getEvent(req.params.id).catch(() => null);
  if (!(await getAgendaChannel(suyo?.kind))) {
    return res.status(409).json({ error: 'falta elegir el canal de la agenda en Administración' });
  }
  let mensaje;
  try {
    mensaje = await publicarEvento(req.params.id);
  } catch (err) {
    // El canal elegido puede haber desaparecido, o el bot haber perdido el
    // permiso de escribir en él. Decirlo con el canal delante ahorra buscarlo.
    return res.status(502).json({
      error: `Discord no aceptó el mensaje: ${err.message}. Comprueba el canal en Administración → Agenda.`,
    });
  }
  if (!mensaje) return res.status(503).json({ error: 'el bot de Discord no está configurado' });
  res.json(await getEvent(req.params.id));
}));

/**
 * Borrar un evento, con sus respuestas y su encuesta.
 *
 * Programar basta para borrar lo que aún no ha contestado nadie -- un evento
 * creado con una errata es de quien lo creó y no tiene por qué sobrevivir
 * tachado. En cuanto hay respuestas se pide además `events.reset`, que es el
 * mismo permiso que hace falta para tirarlas sin borrar el evento: la
 * diferencia entre las dos cosas no puede ser la forma de saltarse el permiso.
 *
 * Cancelar sigue existiendo y es lo contrario a propósito: el evento y sus
 * respuestas se quedan, tachados, porque hubo gente que organizó una noche
 * alrededor.
 */
app.delete('/api/events/:id', requireAuth, requirePermission('events.manage'), asHandler(async (req, res) => {
  // Se lee antes de borrar: después ya no hay de dónde sacar dónde quedó
  // publicada su encuesta, y dejarla en el canal es dejar botones que
  // contestan «no existe ese evento».
  const evento = await getEvent(req.params.id).catch(() => null);
  if (evento?.responses?.length && !req.permissions.includes('events.reset')) {
    return res.status(403).json({
      error: `este evento ya tiene ${evento.responses.length} respuestas; borrarlo pide el permiso de reiniciar encuestas`,
    });
  }
  await deleteEvent(req.params.id);
  if (evento) void retirarEvento(evento);
  res.json({ ok: true });
}));

// La propia respuesta. No pide permiso, pide tener ficha: se contesta por uno
// mismo, y quien no está en el roster no tiene por qué aparecer en una lista de
// asistencia.
app.put('/api/events/:id/response', requireAuth, asHandler(async (req, res) => {
  if (!req.user.playerId) {
    return res.status(403).json({ error: 'tu cuenta no está unida a una ficha del roster' });
  }
  // Los roles de Discord de quien contesta son lo que decide si la convocatoria
  // está abierta a él. Va como función y no como lista porque cuesta una
  // llamada a Discord: el modelo sólo la invoca si el evento restringe algo,
  // que es lo raro.
  const actualizado = await respond(req.params.id, req.user.playerId, req.body, {
    misRoles: () => memberRoles(req.user.discordId),
  });
  // El mensaje de Discord se pone al día aunque la respuesta se diera aquí: es
  // la misma lista, y una encuesta que no cuenta lo contestado en la web es una
  // segunda verdad de las que este modelo existe para no tener.
  //
  // Por el ciclo agrupado y no directo, igual que los votos del botón: son el
  // mismo aluvión visto desde otra puerta, y compartirlo es además lo que hace
  // que un voto en la web y otro en Discord a la vez no se pisen el recuento.
  repintarEvento(req.params.id);
  res.json(actualizado);
}));

// Y la de otro, que es cosa de quien organiza: hay miembros que no entran ni a
// la web ni a Discord y alguien tiene que poder anotar lo que dijeron por voz.
app.put(
  '/api/events/:id/responses/:playerId',
  requireAuth,
  requirePermission('events.manage'),
  asHandler(async (req, res) => {
    const actualizado = await respond(req.params.id, req.params.playerId, req.body, {
      porOtro: req.user.id,
    });
    repintarEvento(req.params.id);
    res.json(actualizado);
  }),
);

/* ------------------------------------------------------------- discord bot */

/**
 * Los comandos de barra entran por aquí.
 *
 * Sin sesión y sin cookie: quien llama es Discord, no un navegador, y lo que
 * hace de autenticación es la firma Ed25519 del cuerpo. Es la única ruta de la
 * API abierta al mundo, y por eso lo primero que hace es rechazar lo que no
 * venga firmado -- con 401, que es además lo que Discord espera ver cuando
 * comprueba la URL al guardarla en el portal.
 */
app.post('/api/discord/interactions', asHandler(async (req, res) => {
  const llegada = Date.now();
  const quien = quienManda(req.body);
  const qué = nombreDeInteraccion(req.body);
  // Una interacción que funciona no dejaba rastro, y por eso un fallo que el
  // miembro sí veía se investigaba sobre un log vacío: no se podía distinguir
  // «llegó y falló» de «nunca llegó». Ahora se anotan las dos mitades por
  // separado, porque miden cosas distintas. El acuse es el que corre contra los
  // tres segundos de Discord; el trabajo tiene quince minutos y sólo importa que
  // termine. Un acuse que se acerque al segundo ya es una explicación.
  const anota = (cómo, extra = '') =>
    console.log(`[discord] ${qué} · ${quien} · ${cómo}${extra}`);

  if (!commandsEnabled()) {
    anota('503 sin configurar');
    return res.status(503).json({ error: 'los comandos no están configurados' });
  }
  if (!verifyInteraction(req)) {
    // Con la clave bien puesta esto no pasa, así que si aparece repetido es que
    // alguien está llamando a la puerta o que DISCORD_PUBLIC_KEY es de otra
    // aplicación. Las dos cosas se quieren ver.
    anota('401 firma inválida');
    return res.status(401).send('invalid request signature');
  }

  const respuesta = await handleInteraction(req.body);
  if (!respuesta) {
    anota('400 no soportada');
    return res.status(400).json({ error: 'unsupported interaction' });
  }

  // Respuesta inmediata: el PING, el autocompletado y los avisos que no tocan
  // la base de datos.
  if (!respuesta.diferido) {
    res.json(respuesta);
    return anota(`${Date.now() - llegada} ms`);
  }

  // Diferida: se acusa recibo ahora -- que es lo que tiene tres segundos de
  // plazo -- y el contenido se manda cuando esté. Lo que tarde deja de poder
  // tumbar la interacción.
  const { ack, trabajo } = respuesta.diferido;
  res.json(ack);
  const acusado = Date.now();
  anota(`acuse ${acusado - llegada} ms`);

  const token = req.body?.token;
  void (async () => {
    try {
      const { contenido, recado } = await trabajo();
      if (recado) await followUpInteraction(token, recado);
      // Sin contenido no hay nada que reescribir: se acusó y el mensaje lo
      // dibuja otro. Mandar `{}` sería un PATCH que borra el mensaje.
      else if (contenido) await editOriginalInteraction(token, contenido);
      anota(`trabajo ${Date.now() - acusado} ms`);
    } catch (err) {
      console.error(`[discord] ${qué} · ${quien} · falló a los ${Date.now() - acusado} ms:`, err);
      // Ya se acusó recibo, así que el «pensando…» se queda ahí para siempre
      // salvo que se sustituya por algo. Decir que falló es peor que nada, y
      // mucho mejor que unos puntos suspensivos eternos.
      await editOriginalInteraction(token, {
        content: `No se pudo completar: ${err.message ?? 'error inesperado'}. Inténtalo otra vez.`,
        embeds: [],
        components: [],
      }).catch(() => null);
    }
  })();
}));

// El ID de Discord es un snowflake: sólo dígitos. Validarlo aquí evita que un
// nombre pegado por error en el campo equivocado acabe guardado como llave.
const DISCORD_ID = /^\d{5,25}$/;

app.get('/api/discord/status', requireAuth, requirePermission('users.manage'), (_req, res) => {
  res.json({ bot: botEnabled() });
});

app.get('/api/discord/members', requireAuth, requirePermission('users.manage'), asHandler(async (req, res) => {
  if (!botEnabled()) {
    return res.status(503).json({ error: 'el bot de Discord no está configurado' });
  }
  const q = String(req.query.q ?? '').trim();
  res.json(q ? await searchGuildMembers(q) : []);
}));

app.get('/api/discord/voice-channels', requireAuth, requirePermission('users.manage'), asHandler(async (_req, res) => {
  if (!botEnabled()) {
    return res.status(503).json({ error: 'el bot de Discord no está configurado' });
  }
  res.json(await listVoiceChannels());
}));

/* ------------------------------------------------------------- war voice */

// La lectura sólo pide sesión: la Sala de Guerra la necesita para saber si
// enseña el botón, y saber a qué canal va cada línea no es ningún secreto
// dentro del gremio.
app.get('/api/war/voice-channels', requireAuth, asHandler(async (_req, res) => {
  res.json({ bot: botEnabled(), slots: VOICE_SLOTS, channels: await getVoiceChannels() });
}));

app.put('/api/war/voice-channels', requireAuth, requirePermission('users.manage'), asHandler(async (req, res) => {
  res.json({ channels: await setVoiceChannels(req.body?.channels ?? {}) });
}));

app.post('/api/war/voice/move', requireAuth, requirePermission('war.voice'), asHandler(async (req, res) => {
  if (!botEnabled()) {
    return res.status(503).json({ error: 'el bot de Discord no está configurado' });
  }
  const { mode, side } = req.body ?? {};
  if (!['general', 'sides', 'lanes', 'leaders'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be general, sides, lanes or leaders' });
  }
  if (!['attack', 'defense'].includes(side)) {
    return res.status(400).json({ error: 'side must be attack or defense' });
  }
  res.json(await deployVoice(mode, side));
}));

// Los canales del servidor, para poder colgarle uno a una unidad táctica sin
// pasar por el panel de administración: quien arma la guerra inventa las
// unidades sobre la marcha, y pedirle a un administrador que le abra una
// ranura cada vez es no tener la función. Con war.edit, que es el permiso de
// escribir el plan, y no con users.manage: los nombres de los canales de voz
// ya los ve cualquiera desde Discord.
app.get('/api/war/voice/channels', requireAuth, requirePermission('war.edit'), asHandler(async (_req, res) => {
  if (!botEnabled()) {
    return res.status(503).json({ error: 'el bot de Discord no está configurado' });
  }
  res.json(await listVoiceChannels());
}));

app.post('/api/war/voice/unit', requireAuth, requirePermission('war.voice'), asHandler(async (req, res) => {
  if (!botEnabled()) {
    return res.status(503).json({ error: 'el bot de Discord no está configurado' });
  }
  const { side, unitId, mode } = req.body ?? {};
  if (!['attack', 'defense'].includes(side)) {
    return res.status(400).json({ error: 'side must be attack or defense' });
  }
  if (!['gather', 'return'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be gather or return' });
  }
  if (!unitId) return res.status(400).json({ error: 'unitId is required' });
  res.json(await moveUnit(side, String(unitId), mode));
}));

/* -------------------------------------------------------------- war horn */

// Sólo sesión: la lista de sonidos no es secreta y la leen dos pantallas con
// permisos distintos (el cuerno manual con war.voice, la configuración con
// users.manage). Tocarlos sigue detrás de sus permisos.
app.get('/api/discord/soundboard', requireAuth, asHandler(async (_req, res) => {
  if (!botEnabled()) {
    return res.status(503).json({ error: 'el bot de Discord no está configurado' });
  }
  res.json(await listSoundboardSounds());
}));

app.get('/api/war/horn', requireAuth, asHandler(async (_req, res) => {
  res.json(await getHorn());
}));

app.put('/api/war/horn', requireAuth, requirePermission('users.manage'), asHandler(async (req, res) => {
  res.json(await setHorn(req.body ?? {}));
}));

// El mismo aviso que dispararía el reloj, pero a mano: el sonido ya elegido
// del evento, por todos los canales configurados, con un clic.
app.post('/api/war/horn/warn', requireAuth, requirePermission('war.voice'), asHandler(async (req, res) => {
  if (!botEnabled()) {
    return res.status(503).json({ error: 'el bot de Discord no está configurado' });
  }
  res.json(await warnEvent(req.body?.event));
}));

app.post('/api/war/horn/play', requireAuth, requirePermission('war.voice'), asHandler(async (req, res) => {
  if (!botEnabled()) {
    return res.status(503).json({ error: 'el bot de Discord no está configurado' });
  }
  const { soundId, slots } = req.body ?? {};
  if (!/^\d{5,25}$/.test(String(soundId ?? ''))) {
    return res.status(400).json({ error: 'soundId must be a Discord snowflake' });
  }
  const channels = await getVoiceChannels();
  const wanted = (Array.isArray(slots) ? slots : []).filter((s) => channels[s]);
  if (!wanted.length) {
    return res.status(400).json({ error: 'ninguna de esas ranuras tiene canal configurado' });
  }
  // El mismo canal puede estar en dos ranuras; sonaría dos veces.
  const ids = [...new Set(wanted.map((s) => channels[s]))];
  const out = await sweepSound(String(soundId), ids);
  res.json(out);
}));

/* ----------------------------------------------------- el grito del boss */

// Lo lee todo el mundo, cada pocos segundos: el aviso es para quien pelea, no
// para quien manda. Sondeo y no empuje porque no hay nada más en la aplicación
// que lo necesite, y veinte segundos de vida hacen que un sondeo corto baste.
app.get('/api/war/call', requireAuth, asHandler(async (_req, res) => {
  res.json(currentCall());
}));

// Cantarlo es de quien lleva la guerra (war.edit), que es el mismo permiso con
// el que se arma el tablero. Un grito falso vacía tres líneas.
app.post('/api/war/call', requireAuth, requirePermission('war.edit'), asHandler(async (req, res) => {
  if (!(await currentWar())) {
    return res.status(409).json({ error: 'no hay ninguna guerra en curso' });
  }
  const call = callBoss(req.body?.spot, req.user?.username ?? null);

  // El cuerno va detrás y sin esperarlo: el barrido tarda un cuarto de minuto
  // en recorrer las líneas y las pantallas no pueden enterarse después que él.
  // Que falle es cosa del cuerno, y no puede llevarse por delante el grito.
  let horn = 'off';
  if (botEnabled() && (await getHorn()).boss) {
    horn = 'sweeping';
    warnEvent('boss').catch((err) => console.error('[cuerno] grito de boss:', err.message));
  }
  res.json({ call, horn });
}));

/**
 * Vincular (o desvincular) el Discord de una cuenta existente, a mano.
 *
 * El camino normal sigue siendo que cada miembro entre con Discord y lo
 * demuestre. Esto es el atajo del líder que ya sabe quién es quién: no hay
 * prueba de propiedad, sólo su criterio, y por eso queda detrás del mismo
 * permiso que crear y borrar cuentas. Lo que guarda es una llave de entrada --
 * quien inicie sesión con ese Discord entra como esta cuenta.
 */
app.patch('/api/users/:id/discord', requireAuth, requirePermission('users.manage'), asHandler(async (req, res) => {
  const { discordId, discordUsername } = req.body ?? {};
  const { id } = req.params;

  const { rows } = await pool.query(
    `SELECT 1 FROM users WHERE id = $1 AND guild_id = $2`, [id, GUILD_ID],
  );
  if (!rows.length) return res.status(404).json({ error: 'no such user' });

  if (discordId === null) {
    await pool.query(
      `UPDATE users SET discord_id = NULL, discord_username = NULL WHERE id = $1 AND guild_id = $2`,
      [id, GUILD_ID],
    );
    return res.json({ ok: true });
  }

  if (!DISCORD_ID.test(String(discordId ?? ''))) {
    return res.status(400).json({ error: 'discordId must be a Discord snowflake' });
  }
  try {
    await pool.query(
      `UPDATE users SET discord_id = $1, discord_username = $2 WHERE id = $3 AND guild_id = $4`,
      [String(discordId), String(discordUsername ?? '').trim() || null, id, GUILD_ID],
    );
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'ese Discord ya está enlazado a otra cuenta' });
    }
    throw err;
  }
  res.json({ ok: true });
}));

/**
 * Crear la cuenta de un jugador directamente desde su identidad de Discord,
 * sin que pase por el flujo de reclamar y aprobar. La cuenta sale igual que
 * una aprobada: sin contraseña, sólo entra con Discord, y con el rol más bajo
 * -- subirlo después es un cambio normal en la tabla de cuentas.
 */
app.post('/api/users/discord', requireAuth, requirePermission('users.manage'), asHandler(async (req, res) => {
  const { playerId, discordId, discordUsername } = req.body ?? {};
  if (!DISCORD_ID.test(String(discordId ?? ''))) {
    return res.status(400).json({ error: 'discordId must be a Discord snowflake' });
  }
  const username = String(discordUsername ?? '').trim();
  if (!username) return res.status(400).json({ error: 'discordUsername required' });

  const player = await pool.query(
    `SELECT 1 FROM players WHERE guild_id = $1 AND id = $2`, [GUILD_ID, playerId],
  );
  if (!player.rows.length) return res.status(404).json({ error: 'no such member' });

  const taken = await pool.query(
    `SELECT username FROM users WHERE guild_id = $1 AND player_id = $2`, [GUILD_ID, playerId],
  );
  if (taken.rows.length) {
    return res.status(409).json({ error: `ese miembro ya tiene la cuenta "${taken.rows[0].username}"` });
  }

  const id = randomUUID();
  try {
    // Sin contraseña: '-' no es el hash de nada, así que el formulario clásico
    // nunca podrá acertar. Es el mismo criterio que la aprobación de registro.
    await pool.query(
      `INSERT INTO users (id, guild_id, username, password_hash, role, player_id, discord_id, discord_username)
       VALUES ($1, $2, $3, '-', 'member', $4, $5, $6)`,
      [id, GUILD_ID, username, playerId, String(discordId), username],
    );
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'ya existe una cuenta con ese nombre o Discord' });
    }
    throw err;
  }
  res.status(201).json({ id, username, role: 'member' });
}));

/* ------------------------------------------------------------ permissions */

app.get('/api/permissions', requireAuth, asHandler(async (_req, res) => {
  res.json({ roles: ROLES, permissions: PERMISSIONS, matrix: await permissionMatrix() });
}));

app.put('/api/permissions', requireAuth, requirePermission('permissions.manage'), asHandler(async (req, res) => {
  const matrix = req.body?.matrix;
  if (!matrix || typeof matrix !== 'object') return res.status(400).json({ error: 'expected { matrix }' });
  await saveMatrix(matrix);
  res.json({ matrix: await permissionMatrix() });
}));

/* ------------------------------------------------------------- guild data */

app.get('/api/state', requireAuth, asHandler(async (_req, res) => {
  const [players, ranks, sessions] = await Promise.all([
    pool.query(
      // Martial mastery is scanned, not typed, so it comes from the last sweep
      // that actually read it -- a sweep that missed the field for somebody
      // should leave their old figure standing rather than blank it.
      `SELECT p.id, p.name, p.role, p.level, p.sect, p.platform, p.status,
              p.rank_id AS "rankId", p.notes, p.game_uid AS "gameUid",
              p.online_id AS "onlineId", p.is_starter AS "isStarter",
              p.war_side AS "warSide", p.is_active AS "isActive",
              s.martial_mastery AS "martialMastery"
         FROM players p
         LEFT JOIN LATERAL (
           SELECT martial_mastery FROM player_scans
            WHERE guild_id = p.guild_id AND player_id = p.id AND martial_mastery IS NOT NULL
            ORDER BY scanned_at DESC LIMIT 1
         ) s ON true
        WHERE p.guild_id = $1 ORDER BY p.name`,
      [GUILD_ID],
    ),
    pool.query(`SELECT id, name, color FROM ranks WHERE guild_id = $1`, [GUILD_ID]),
    pool.query(
      `SELECT id, name, date, assignments, tactical_groups AS groups
         FROM war_sessions WHERE guild_id = $1 ORDER BY date DESC`,
      [GUILD_ID],
    ),
  ]);

  res.json({
    players: players.rows.map((p) => ({
      ...p,
      platform: p.platform ?? undefined,
      rankId: p.rankId ?? undefined,
      notes: p.notes ?? undefined,
      gameUid: p.gameUid ?? undefined,
      onlineId: p.onlineId ?? undefined,
      martialMastery: p.martialMastery ?? undefined,
    })),
    ranks: ranks.rows,
    sessions: sessions.rows.map((s) => ({ ...s, date: s.date.toISOString() })),
  });
}));

app.put('/api/players', requireAuth, requirePermission('roster.edit'), asHandler(async (req, res) => {
  const players = requireArray(req, res);
  if (!players) return;
  await replacePlayers(players, {
    mayAssignRanks: req.permissions.includes('ranks.manage'),
    mayEditUid: req.permissions.includes('roster.uid'),
  });
  res.json({ saved: players.length });
}));

app.put('/api/ranks', requireAuth, requirePermission('ranks.manage'), asHandler(async (req, res) => {
  const ranks = requireArray(req, res);
  if (!ranks) return;
  await replaceAll('ranks', ['id', 'name', 'color'], ranks, (r) => [r.id, r.name, r.color]);
  res.json({ saved: ranks.length });
}));

app.put('/api/sessions', requireAuth, requirePermission('war.edit'), asHandler(async (req, res) => {
  const sessions = requireArray(req, res);
  if (!sessions) return;
  await replaceAll(
    'war_sessions',
    ['id', 'name', 'date', 'assignments', 'tactical_groups'],
    sessions,
    (s) => [s.id, s.name, s.date, JSON.stringify(s.assignments ?? []), JSON.stringify(s.groups ?? [])],
  );
  res.json({ saved: sessions.length });
}));

/* ----------------------------------------------------------------- scans */

// Reading a scan changes nothing; it reports who each name matched so a person
// can settle the ones the roster could not.
app.post('/api/scans/preview', requireAuth, requirePermission('roster.edit'), asHandler(async (req, res) => {
  const entries = req.body?.entries;
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'expected { entries: [...] }' });
  res.json({ entries: await matchEntries(entries) });
}));

app.post('/api/scans/commit', requireAuth, requirePermission('roster.edit'), asHandler(async (req, res) => {
  const entries = req.body?.entries;
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'expected { entries: [...] }' });
  if (!entries.some((e) => e.playerId || e.createAs)) {
    return res.status(400).json({ error: 'no entry names a player to store against' });
  }
  res.json(await commitScan({ scannedAt: req.body?.scannedAt, entries }));
}));

app.get('/api/scans', requireAuth, asHandler(async (_req, res) => {
  res.json(await scanSummary());
}));

app.get('/api/players/:id/scans', requireAuth, asHandler(async (req, res) => {
  res.json(await historyFor(req.params.id));
}));

// The war-day flags: fielded or not, and which half of the fight. Their own
// route rather than resending the roster, which would be wasteful for a
// checkbox and would race with anyone else editing at the same moment. Only
// the flags named in the body are touched.
const WAR_SIDES = ['attack', 'defense'];

app.patch('/api/players/:id/flags', requireAuth, requirePermission('roster.edit'), asHandler(async (req, res) => {
  const { isStarter, warSide, isActive } = req.body ?? {};
  if (warSide !== undefined && warSide !== null && !WAR_SIDES.includes(warSide)) {
    return res.status(400).json({ error: 'warSide must be attack, defense or null' });
  }

  const { rows } = await pool.query(
    `UPDATE players
        SET war_side  = CASE WHEN $2::boolean THEN $3 ELSE war_side END,
            is_active = COALESCE($4, is_active),
            -- One assignment covering both rules, because a column may only be
            -- set once: keep what was asked for, unless the member is being
            -- marked as gone, in which case they are not being fielded either.
            is_starter = CASE WHEN $4::boolean IS false THEN false
                              ELSE COALESCE($1, is_starter) END
      WHERE guild_id = $5 AND id = $6
      RETURNING id`,
    [
      isStarter === undefined ? null : Boolean(isStarter),
      warSide !== undefined,
      warSide ?? null,
      isActive === undefined ? null : Boolean(isActive),
      GUILD_ID,
      req.params.id,
    ],
  );
  if (!rows.length) return res.status(404).json({ error: 'no such member' });
  res.json({ ok: true });
}));

/* ------------------------------------------------------------- guild war */

app.get('/api/war/deployments', requireAuth, asHandler(async (_req, res) => {
  res.json(await getDeployments());
}));

// One member at a time rather than the whole board, so two officers arranging
// different lanes at once do not overwrite each other.
app.put('/api/war/deployments/:side/:playerId', requireAuth, requirePermission('war.edit'), asHandler(async (req, res) => {
  res.json(await place(req.params.side, req.body?.lane ?? null, req.params.playerId));
}));

// El orden dentro de una línea. Tres segmentos y el último literal, así que no
// se cruza con `:side/:playerId` ni con `:side/:playerId/units`.
app.put('/api/war/deployments/:side/:lane/order', requireAuth, requirePermission('war.edit'), asHandler(async (req, res) => {
  res.json(await reorder(req.params.side, req.params.lane, req.body?.order ?? []));
}));

app.delete('/api/war/deployments/:side', requireAuth, requirePermission('war.edit'), asHandler(async (req, res) => {
  res.json(await clearSide(req.params.side));
}));

// A unit is a job, a lane is a position: setting one must never clear the other.
app.put('/api/war/deployments/:side/:playerId/units', requireAuth, requirePermission('war.edit'), asHandler(async (req, res) => {
  res.json(await setUnits(req.params.side, req.params.playerId, req.body?.units ?? []));
}));

app.put('/api/war/deployments/:side/:playerId/leader', requireAuth, requirePermission('war.edit'), asHandler(async (req, res) => {
  res.json(await setLaneLeader(req.params.side, req.params.playerId, req.body?.leader));
}));

app.put('/api/war/deployments/:side/:playerId/build', requireAuth, requirePermission('war.edit'), asHandler(async (req, res) => {
  res.json(await setBuild(req.params.side, req.params.playerId, req.body?.build ?? null));
}));

app.get('/api/war/strategies', requireAuth, asHandler(async (_req, res) => {
  res.json(await listStrategies());
}));

app.get('/api/war/board', requireAuth, asHandler(async (_req, res) => {
  res.json(await getBoard());
}));

app.put('/api/war/active/:side', requireAuth, requirePermission('war.edit'), asHandler(async (req, res) => {
  res.json(await setActiveStrategy(req.params.side, req.body?.strategy ?? null));
}));

app.put('/api/war/lock/:side', requireAuth, requirePermission('war.edit'), asHandler(async (req, res) => {
  res.json(await setLock(req.params.side, req.body?.locked === true));
}));

app.post('/api/war/wars', requireAuth, requirePermission('war.edit'), asHandler(async (req, res) => {
  res.json(await startWar(req.body?.name, req.body?.matchType));
}));

app.post('/api/war/wars/:id/end', requireAuth, requirePermission('war.edit'), asHandler(async (req, res) => {
  res.json(await endWar(req.params.id, req.body?.outcome));
}));

app.patch('/api/war/wars/:id', requireAuth, requirePermission('war.edit'), asHandler(async (req, res) => {
  // Only the keys actually sent are touched: outcome accepts null to unmark.
  const changes = {};
  if ('name' in (req.body ?? {})) changes.name = req.body.name;
  if ('matchType' in (req.body ?? {})) changes.matchType = req.body.matchType;
  if ('outcome' in (req.body ?? {})) changes.outcome = req.body.outcome;
  res.json(await updateWar(req.params.id, changes));
}));

app.delete('/api/war/wars/:id', requireAuth, requirePermission('war.edit'), asHandler(async (req, res) => {
  res.json(await deleteWar(req.params.id));
}));

// The record a war leaves behind. Readable by the guild -- everyone wants to
// know how the war went, and members want to find their own part in it.
app.get('/api/war/wars', requireAuth, asHandler(async (_req, res) => {
  res.json(await listWars());
}));

app.get('/api/war/wars/:id', requireAuth, asHandler(async (req, res) => {
  res.json(await warDetail(req.params.id));
}));

// A member's own record. Readable by anyone signed in: the guild compares
// itself, and hiding what one person did while showing the war they did it in
// would only make the comparison worse informed.
app.get('/api/players/:id/wars', requireAuth, asHandler(async (req, res) => {
  res.json(await warsFor(req.params.id));
}));

app.post('/api/war/wars/:id/images', requireAuth, requirePermission('war.edit'), asHandler(async (req, res) => {
  res.json(await addWarImage(req.params.id, req.body?.image, req.body?.caption));
}));

app.delete('/api/war/wars/:id/images/:imageId', requireAuth, requirePermission('war.edit'), asHandler(async (req, res) => {
  res.json(await removeWarImage(req.params.id, req.params.imageId));
}));

app.patch('/api/war/wars/:id/participants/:playerId', requireAuth, requirePermission('war.edit'), asHandler(async (req, res) => {
  res.json(await setContribution(req.params.id, req.params.playerId, req.body));
}));

app.put('/api/war/strategies', requireAuth, requirePermission('war.edit'), asHandler(async (req, res) => {
  res.json(await saveStrategy(req.body?.strategy));
}));

app.delete('/api/war/strategies/:id', requireAuth, requirePermission('war.edit'), asHandler(async (req, res) => {
  await deleteStrategy(req.params.id);
  res.json({ ok: true });
}));

// Saved line-ups: the deployment of one side photographed under a name.
// Readable by the guild like the strategies; writing them is arranging a war.
app.get('/api/war/lineups', requireAuth, asHandler(async (_req, res) => {
  res.json(await listLineups());
}));

app.post('/api/war/lineups', requireAuth, requirePermission('war.edit'), asHandler(async (req, res) => {
  res.json(await saveLineup(req.body?.side, req.body?.name));
}));

app.post('/api/war/lineups/:id/apply', requireAuth, requirePermission('war.edit'), asHandler(async (req, res) => {
  res.json(await applyLineup(req.params.id));
}));

app.delete('/api/war/lineups/:id', requireAuth, requirePermission('war.edit'), asHandler(async (req, res) => {
  await deleteLineup(req.params.id);
  res.json({ ok: true });
}));

/* ---------------------------------------------------------- weapon sets */

app.get('/api/weapon-sets', requireAuth, asHandler(async (_req, res) => {
  res.json(await listWeaponSets());
}));

// Curating the vocabulary builds are described with is the same job as editing
// them, so it needs no permission of its own.
app.put('/api/weapon-sets', requireAuth, requirePermission('builds.manage'), asHandler(async (req, res) => {
  res.json(await saveWeaponSets(req.body?.sets));
}));

/* ---------------------------------------------------------------- builds */

app.get('/api/builds', requireAuth, asHandler(async (_req, res) => {
  res.json(await listBuilds());
}));

app.get('/api/players/:id/builds', requireAuth, asHandler(async (req, res) => {
  res.json(await listBuilds(req.params.id));
}));

app.put('/api/players/:id/builds', requireAuth, asHandler(async (req, res) => {
  if (!(await mayEditBuilds(req, req.params.id))) {
    return res.status(403).json({ error: 'you may only edit your own builds' });
  }
  res.json(await saveBuilds(req.params.id, req.body?.builds));
}));

/* ------------------------------------------------------------------ gear */

// Readable by the whole guild, like builds and war records: the point of
// keeping this is comparing notes on what people are wearing.
app.get('/api/gear', requireAuth, asHandler(async (_req, res) => {
  res.json(await listGear());
}));

app.get('/api/players/:id/gear', requireAuth, asHandler(async (req, res) => {
  res.json(await listGear(req.params.id));
}));

// How high each attribute rolls, learned from everything uploaded so far.
// Guild-wide rather than per member -- one person's helm teaches everybody
// what a helm can reach.
app.get('/api/gear/ceilings', requireAuth, asHandler(async (_req, res) => {
  res.json(await listCeilings());
}));

// The attribute names actually sitting on pieces right now. No longer the
// suggestion list -- that is a closed catalogue in services/gearCatalog.ts --
// but still the way to find what the old free-text field left behind: anything
// here that is not a catalogue key is a line somebody has to re-pick, and
// renameStat below is how the junk ones get taken off.
app.get('/api/gear/stats', requireAuth, asHandler(async (_req, res) => {
  res.json(await listStatLabels());
}));

// Correcting an attribute's name touches everybody's pieces, so it needs the
// permission that covers anybody's builds -- not just your own gear.
app.patch('/api/gear/stats/:key', requireAuth, requirePermission('builds.manage'), asHandler(async (req, res) => {
  res.json(await renameStat(req.params.key, req.body?.label ?? ''));
}));

// The Spanish names, and the corrections to them. Readable by everybody
// because the screenshot reader needs them to match at all, not just to draw.
app.get('/api/gear/labels', requireAuth, asHandler(async (_req, res) => {
  res.json(await listStatOverrides());
}));

// Correcting a name changes what every member sees and what their screenshots
// match against, so it needs the permission that covers anybody's gear.
app.put('/api/gear/labels/:key', requireAuth, requirePermission('builds.manage'), asHandler(async (req, res) => {
  res.json(await setStatOverride(req.params.key, req.body?.label ?? ''));
}));

/* ------------------------------------------------------------- gear sets */

app.get('/api/players/:id/gear-sets', requireAuth, asHandler(async (req, res) => {
  res.json(await listGearSets(req.params.id));
}));

app.put('/api/players/:id/gear-sets', requireAuth, asHandler(async (req, res) => {
  if (!(await mayEditGear(req, req.params.id))) {
    return res.status(403).json({ error: 'you may only edit your own gear' });
  }
  res.json(await saveGearSet(req.params.id, req.body ?? {}));
}));

app.delete('/api/players/:id/gear-sets/:setId', requireAuth, asHandler(async (req, res) => {
  if (!(await mayEditGear(req, req.params.id))) {
    return res.status(403).json({ error: 'you may only edit your own gear' });
  }
  res.json(await deleteGearSet(req.params.id, req.params.setId));
}));

app.put('/api/players/:id/gear-sets/:setId/:slot', requireAuth, asHandler(async (req, res) => {
  if (!(await mayEditGear(req, req.params.id))) {
    return res.status(403).json({ error: 'you may only edit your own gear' });
  }
  res.json(await saveGearPiece(req.params.id, req.params.setId, { ...req.body, slot: req.params.slot }));
}));

app.delete('/api/players/:id/gear-sets/:setId/:slot', requireAuth, asHandler(async (req, res) => {
  if (!(await mayEditGear(req, req.params.id))) {
    return res.status(403).json({ error: 'you may only edit your own gear' });
  }
  res.json(await deleteGearPiece(req.params.id, req.params.setId, req.params.slot));
}));

// Which roster entry an account belongs to, which is what lets a member edit
// their own builds without any permission at all.
app.patch('/api/users/:id/player', requireAuth, requirePermission('users.manage'), asHandler(async (req, res) => {
  const playerId = req.body?.playerId ?? null;
  if (playerId) {
    const { rows } = await pool.query(`SELECT 1 FROM players WHERE guild_id = $1 AND id = $2`, [GUILD_ID, playerId]);
    if (!rows.length) return res.status(404).json({ error: 'no such member' });
  }
  await pool.query(`UPDATE users SET player_id = $1 WHERE id = $2 AND guild_id = $3`, [
    playerId,
    req.params.id,
    GUILD_ID,
  ]);
  res.json({ ok: true });
}));

migrate()
  .then(initAuth)
  .then(seedWeaponSets)
  .then(seedSeries)
  .then(migrateLegacyStats)
  .then(() => {
    // El cuerno automático de jungla y boss. Sin bot configurado no hace nada.
    startHornScheduler();
    // Los comandos de barra, al día en cada despliegue. No bloquea el arranque:
    // que Discord no conteste no puede dejar la API sin levantar.
    void registerCommands();
    // Las guerras de la semana se crean y se publican solas. Sin bot sigue
    // creándolas: la agenda de la web no depende de Discord.
    startAgendaScheduler();
    app.listen(PORT, () => console.log(`API listening on ${PORT}`));
  })
  .catch((err) => {
    console.error('Startup failed:', err);
    process.exit(1);
  });
