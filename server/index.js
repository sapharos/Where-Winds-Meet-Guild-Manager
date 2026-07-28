import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import express from 'express';
import { pool, migrate, replaceAll, replacePlayers, GUILD_ID } from './db.js';
import { ROLES, PERMISSIONS } from './permissions.js';
import { matchEntries, commitScan, historyFor, scanSummary } from './scans.js';
import {
  initAuth,
  hashPassword,
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

/* ------------------------------------------------------------------ users */

app.get('/api/users', requireAuth, requirePermission('users.manage'), asHandler(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, username, role, disabled, created_at AS "createdAt"
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

  const { rows } = await pool.query(`SELECT id FROM users WHERE id = $1 AND guild_id = $2`, [id, GUILD_ID]);
  if (!rows.length) return res.status(404).json({ error: 'no such user' });

  if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: 'unknown role' });
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
              game_uid AS "gameUid", online_id AS "onlineId"
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
  await replacePlayers(players);
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

migrate()
  .then(initAuth)
  .then(() => {
    app.listen(PORT, () => console.log(`API listening on ${PORT}`));
  })
  .catch((err) => {
    console.error('Startup failed:', err);
    process.exit(1);
  });
