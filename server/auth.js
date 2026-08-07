import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool, GUILD_ID } from './db.js';
import { ROLES, PERMISSIONS, DEFAULT_PERMISSIONS, applyLocked } from './permissions.js';

const COOKIE = 'wwm_session';
const TOKEN_TTL = '7d';
const BCRYPT_ROUNDS = 12;

let secret;

// Prefer an explicit secret; otherwise keep a generated one in the database so
// that restarting the container does not sign every existing session out.
async function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;

  const existing = await pool.query(`SELECT value FROM app_settings WHERE key = 'session_secret'`);
  if (existing.rows.length) return existing.rows[0].value;

  const generated = randomBytes(48).toString('hex');
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ('session_secret', $1)
       ON CONFLICT (key) DO NOTHING`,
    [generated],
  );
  const row = await pool.query(`SELECT value FROM app_settings WHERE key = 'session_secret'`);
  return row.rows[0].value;
}

export const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS);

// The Discord flow signs its own short-lived cookies with the same key.
export const sessionSecret = () => secret;

export async function initAuth() {
  secret = await loadSecret();
  await seedPermissions();
  await seedAdmin();
}

/**
 * Give a guild the defaults for any permission it has never been offered.
 *
 * The matrix belongs to the leaders once they have touched it, so this must not
 * reinstate something they deliberately revoked. What it tracks instead is
 * which permissions have ever been introduced: a name absent from that list is
 * new to this deployment, never seen by anyone, and gets its default. Every
 * other decision is left exactly as they made it.
 */
async function seedPermissions() {
  const known = await pool.query(`SELECT value FROM app_settings WHERE key = 'known_permissions'`);
  const introduced = new Set(known.rows.length ? JSON.parse(known.rows[0].value) : []);
  const fresh = PERMISSIONS.filter((p) => !introduced.has(p));
  if (!fresh.length) return;

  for (const [role, perms] of Object.entries(DEFAULT_PERMISSIONS)) {
    for (const permission of perms) {
      if (!fresh.includes(permission)) continue;
      await pool.query(
        `INSERT INTO role_permissions (guild_id, role, permission) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
        [GUILD_ID, role, permission],
      );
    }
  }

  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ('known_permissions', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify([...introduced, ...fresh])],
  );
  console.log(`Applied defaults for new permissions: ${fresh.join(', ')}`);
}

async function seedAdmin() {
  const { rows } = await pool.query(`SELECT 1 FROM users WHERE guild_id = $1 LIMIT 1`, [GUILD_ID]);
  if (rows.length) return;

  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || randomBytes(9).toString('base64url');

  await pool.query(
    `INSERT INTO users (id, guild_id, username, password_hash, role, is_root)
     VALUES ($1, $2, $3, $4, 'admin', true)`,
    [randomUUID(), GUILD_ID, username, await hashPassword(password)],
  );

  if (process.env.ADMIN_PASSWORD) {
    console.log(`Created first admin account "${username}" from ADMIN_PASSWORD.`);
  } else {
    console.log(
      '\n' +
        '='.repeat(64) +
        `\n  First admin account created.\n` +
        `    username: ${username}\n` +
        `    password: ${password}\n` +
        '  This is shown once. Change it after signing in.\n' +
        '='.repeat(64) +
        '\n',
    );
  }
}

export async function permissionsFor(role) {
  const { rows } = await pool.query(
    `SELECT permission FROM role_permissions WHERE guild_id = $1 AND role = $2`,
    [GUILD_ID, role],
  );
  return applyLocked(role, rows.map((r) => r.permission));
}

export async function permissionMatrix() {
  const { rows } = await pool.query(
    `SELECT role, permission FROM role_permissions WHERE guild_id = $1`,
    [GUILD_ID],
  );
  const matrix = Object.fromEntries(ROLES.map((r) => [r, []]));
  for (const { role, permission } of rows) {
    if (matrix[role]) matrix[role].push(permission);
  }
  for (const role of ROLES) matrix[role] = applyLocked(role, matrix[role]);
  return matrix;
}

export async function saveMatrix(incoming) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM role_permissions WHERE guild_id = $1`, [GUILD_ID]);
    for (const role of ROLES) {
      const requested = Array.isArray(incoming[role]) ? incoming[role] : [];
      const valid = requested.filter((p) => PERMISSIONS.includes(p));
      for (const permission of applyLocked(role, valid)) {
        await client.query(
          `INSERT INTO role_permissions (guild_id, role, permission) VALUES ($1, $2, $3)`,
          [GUILD_ID, role, permission],
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function verifyLogin(username, password) {
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.password_hash, u.role, u.disabled, u.player_id AS "playerId",
            COALESCE(p.is_active, true) AS "memberActive"
       FROM users u
       LEFT JOIN players p ON p.guild_id = u.guild_id AND p.id = u.player_id
      WHERE u.guild_id = $1 AND lower(u.username) = lower($2)`,
    [GUILD_ID, username],
  );
  const user = rows[0];

  // Hash even when the user is unknown, so a missing account and a wrong
  // password take about the same time to answer.
  const hash = user ? user.password_hash : '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const ok = await bcrypt.compare(password, hash);

  // Leaving the guild ends access here too. Accounts with no roster entry --
  // the one the guild was set up with, for instance -- are unaffected.
  if (!user || !ok || user.disabled || !user.memberActive) return null;
  return { id: user.id, username: user.username, role: user.role, playerId: user.playerId };
}

export function issueCookie(res, user) {
  const token = jwt.sign({ sub: user.id, role: user.role }, secret, { expiresIn: TOKEN_TTL });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    // Set COOKIE_SECURE=true once the app is served over HTTPS.
    secure: process.env.COOKIE_SECURE === 'true',
  });
}

export function clearCookie(res) {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax' });
}

// Reads the session on every request rather than trusting the token's role
// claim, so a role change or a disabled account takes effect immediately.
export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE];
    if (!token) return res.status(401).json({ error: 'not signed in' });

    const claims = jwt.verify(token, secret);
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.role, u.disabled, u.player_id AS "playerId",
              u.discord_id AS "discordId",
              COALESCE(p.is_active, true) AS "memberActive"
         FROM users u
         LEFT JOIN players p ON p.guild_id = u.guild_id AND p.id = u.player_id
        WHERE u.id = $1 AND u.guild_id = $2`,
      [claims.sub, GUILD_ID],
    );
    const user = rows[0];
    // Checked per request, so deactivating somebody ends the session they
    // already have rather than only the next one.
    if (!user || user.disabled || !user.memberActive) {
      clearCookie(res);
      return res.status(401).json({ error: 'not signed in' });
    }

    // The roster entry this account belongs to, which is what makes a personal
    // page possible and what lets a member edit their own builds.
    // `discordId` viaja porque es lo que permite preguntarle a Discord qué
    // roles lleva puesto quien contesta una encuesta restringida.
    req.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      playerId: user.playerId,
      discordId: user.discordId,
    };
    req.permissions = await permissionsFor(user.role);
    next();
  } catch {
    clearCookie(res);
    res.status(401).json({ error: 'not signed in' });
  }
}

export const requirePermission = (permission) => (req, res, next) => {
  if (!req.permissions?.includes(permission)) {
    return res.status(403).json({ error: `missing permission: ${permission}` });
  }
  next();
};
