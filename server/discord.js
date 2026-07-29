import { randomUUID, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { pool, GUILD_ID } from './db.js';

const AUTHORIZE = 'https://discord.com/oauth2/authorize';
const TOKEN = 'https://discord.com/api/oauth2/token';
const ME = 'https://discord.com/api/users/@me';

const STATE_COOKIE = 'wwm_oauth_state';
const PENDING_COOKIE = 'wwm_discord';
const PENDING_MINUTES = 15;

export const discordEnabled = () =>
  Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET && process.env.PUBLIC_URL);

const redirectUri = () => `${(process.env.PUBLIC_URL ?? '').replace(/\/$/, '')}/api/auth/discord/callback`;

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.COOKIE_SECURE === 'true',
});

/** Send the member to Discord, remembering a nonce to recognise them coming back. */
export function beginDiscord(res) {
  const state = randomBytes(16).toString('hex');
  res.cookie(STATE_COOKIE, state, { ...cookieOptions(), maxAge: 10 * 60 * 1000 });

  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'identify',
    state,
  });
  res.redirect(`${AUTHORIZE}?${params}`);
}

async function exchange(code) {
  const body = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    client_secret: process.env.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
  });

  const token = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!token.ok) throw Object.assign(new Error('Discord rejected the sign-in'), { status: 502 });

  const { access_token: accessToken } = await token.json();
  const me = await fetch(ME, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!me.ok) throw Object.assign(new Error('Discord would not identify the account'), { status: 502 });

  const profile = await me.json();
  return { id: profile.id, username: profile.global_name || profile.username };
}

/**
 * Finish the round trip.
 *
 * Returns the member's own account when their Discord is already linked. When
 * it is not, the identity is parked in a short-lived signed cookie rather than
 * written anywhere: someone Discord recognises is not yet someone this guild
 * knows, and the claim they are about to make still has to be approved.
 */
export async function finishDiscord(req, res, secret) {
  const { code, state } = req.query;
  if (!code || !state || state !== req.cookies?.[STATE_COOKIE]) {
    throw Object.assign(new Error('the sign-in could not be verified; try again'), { status: 400 });
  }
  res.clearCookie(STATE_COOKIE, cookieOptions());

  const profile = await exchange(String(code));
  const { rows } = await pool.query(
    `SELECT id, username, role, disabled FROM users WHERE guild_id = $1 AND discord_id = $2`,
    [GUILD_ID, profile.id],
  );

  if (rows[0] && !rows[0].disabled) {
    // Keep the display name current: people rename themselves on Discord.
    await pool.query(`UPDATE users SET discord_username = $1 WHERE id = $2`, [profile.username, rows[0].id]);
    return { user: { id: rows[0].id, username: rows[0].username, role: rows[0].role } };
  }
  if (rows[0]?.disabled) throw Object.assign(new Error('that account is disabled'), { status: 403 });

  const pending = jwt.sign({ did: profile.id, name: profile.username }, secret, {
    expiresIn: `${PENDING_MINUTES}m`,
  });
  res.cookie(PENDING_COOKIE, pending, { ...cookieOptions(), maxAge: PENDING_MINUTES * 60 * 1000 });
  return { pending: profile };
}

export function readPending(req, secret) {
  const token = req.cookies?.[PENDING_COOKIE];
  if (!token) return null;
  try {
    const claims = jwt.verify(token, secret);
    return { id: claims.did, username: claims.name };
  } catch {
    return null;
  }
}

export const clearPending = (res) => res.clearCookie(PENDING_COOKIE, cookieOptions());

/** Record a claim on a roster entry, for a leader to approve or refuse. */
export async function requestRegistration(discord, uid) {
  const clean = String(uid ?? '').replace(/[^0-9]/g, '');
  if (!clean) throw Object.assign(new Error('escribe tu UID del juego'), { status: 400 });

  const { rows } = await pool.query(
    `SELECT id, name FROM players WHERE guild_id = $1 AND game_uid = $2`,
    [GUILD_ID, clean],
  );
  // Saying whether the uid exists would let anyone probe the roster, but it
  // would also leave a real member stuck with no idea why nothing happened.
  // The guild is small and its members are known to each other; being useful
  // wins.
  if (!rows.length) {
    throw Object.assign(new Error('Ese UID no está en el roster. Avisa a un líder.'), { status: 404 });
  }

  const taken = await pool.query(
    `SELECT 1 FROM users WHERE guild_id = $1 AND player_id = $2`,
    [GUILD_ID, rows[0].id],
  );
  if (taken.rows.length) {
    throw Object.assign(new Error('Ese miembro ya tiene cuenta. Habla con un líder.'), { status: 409 });
  }

  await pool.query(
    `INSERT INTO registration_requests (id, guild_id, discord_id, discord_username, claimed_uid, player_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (guild_id, discord_id)
       DO UPDATE SET claimed_uid = EXCLUDED.claimed_uid,
                     player_id = EXCLUDED.player_id,
                     discord_username = EXCLUDED.discord_username,
                     created_at = now()`,
    [randomUUID(), GUILD_ID, discord.id, discord.username, clean, rows[0].id],
  );
  return { player: rows[0].name };
}

export async function listRegistrations() {
  const { rows } = await pool.query(
    `SELECT r.id, r.discord_id AS "discordId", r.discord_username AS "discordUsername",
            r.claimed_uid AS "claimedUid", r.player_id AS "playerId",
            p.name AS "playerName", r.created_at AS "createdAt"
       FROM registration_requests r
       LEFT JOIN players p ON p.guild_id = r.guild_id AND p.id = r.player_id
      WHERE r.guild_id = $1
      ORDER BY r.created_at`,
    [GUILD_ID],
  );
  return rows;
}

export async function approveRegistration(id, role = 'member') {
  const { rows } = await pool.query(
    `SELECT * FROM registration_requests WHERE id = $1 AND guild_id = $2`,
    [id, GUILD_ID],
  );
  const request = rows[0];
  if (!request) throw Object.assign(new Error('no such request'), { status: 404 });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userId = randomUUID();
    // No password: this account only ever signs in through Discord, so the
    // hash is a value nothing can match rather than something guessable.
    await client.query(
      `INSERT INTO users (id, guild_id, username, password_hash, role, player_id, discord_id, discord_username)
       VALUES ($1, $2, $3, '-', $4, $5, $6, $7)`,
      [
        userId,
        GUILD_ID,
        request.discord_username,
        role,
        request.player_id,
        request.discord_id,
        request.discord_username,
      ],
    );
    await client.query(`DELETE FROM registration_requests WHERE id = $1`, [id]);
    await client.query('COMMIT');
    return { userId };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      throw Object.assign(new Error('ya existe una cuenta con ese nombre o Discord'), { status: 409 });
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function rejectRegistration(id) {
  await pool.query(`DELETE FROM registration_requests WHERE id = $1 AND guild_id = $2`, [id, GUILD_ID]);
}
