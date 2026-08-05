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
  setUnits,
  setBuild,
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
import { botEnabled, searchGuildMembers, listVoiceChannels } from './discordBot.js';
import { VOICE_SLOTS, getVoiceChannels, setVoiceChannels, deployVoice } from './voice.js';
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
app.use(express.json({ limit: '5mb' }));
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

/* ------------------------------------------------------------- discord bot */

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
  const mode = req.body?.mode;
  if (!['general', 'sides', 'lanes'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be general, sides or lanes' });
  }
  res.json(await deployVoice(mode));
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
  await replacePlayers(players, { mayAssignRanks: req.permissions.includes('ranks.manage') });
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

app.delete('/api/war/deployments/:side', requireAuth, requirePermission('war.edit'), asHandler(async (req, res) => {
  res.json(await clearSide(req.params.side));
}));

// A unit is a job, a lane is a position: setting one must never clear the other.
app.put('/api/war/deployments/:side/:playerId/units', requireAuth, requirePermission('war.edit'), asHandler(async (req, res) => {
  res.json(await setUnits(req.params.side, req.params.playerId, req.body?.units ?? []));
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
  .then(migrateLegacyStats)
  .then(() => {
    app.listen(PORT, () => console.log(`API listening on ${PORT}`));
  })
  .catch((err) => {
    console.error('Startup failed:', err);
    process.exit(1);
  });
