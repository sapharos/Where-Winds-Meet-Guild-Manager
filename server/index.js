import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import express from 'express';
import { pool, migrate, replaceAll, replacePlayers, GUILD_ID } from './db.js';
import { ROLES, PERMISSIONS } from './permissions.js';
import { matchEntries, commitScan, historyFor, scanSummary } from './scans.js';
import { listBuilds, saveBuilds, mayEditBuilds } from './builds.js';
import { listWeaponSets, saveWeaponSets, seedWeaponSets } from './weapons.js';
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
    `SELECT id, username, role, disabled, player_id AS "playerId", created_at AS "createdAt"
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
      `SELECT id, name, role, level, sect, platform, status, rank_id AS "rankId", notes,
              game_uid AS "gameUid", online_id AS "onlineId", is_starter AS "isStarter", war_side AS "warSide", is_active AS "isActive"
         FROM players WHERE guild_id = $1 ORDER BY name`,
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
        SET is_starter = COALESCE($1, is_starter),
            war_side   = CASE WHEN $2::boolean THEN $3 ELSE war_side END,
            is_active  = COALESCE($4, is_active),
            -- Somebody who has left is not being fielded on Saturday.
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
  .then(() => {
    app.listen(PORT, () => console.log(`API listening on ${PORT}`));
  })
  .catch((err) => {
    console.error('Startup failed:', err);
    process.exit(1);
  });
