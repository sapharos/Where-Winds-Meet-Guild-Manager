import { randomUUID } from 'node:crypto';
import { pool, GUILD_ID } from './db.js';

// The three combat roles a build can fill, in any combination: a weapon pair
// played as tank and healer at once is the case a single role never described.
const ROLES = ['Tank', 'Healer', 'DPS'];

const MAX_BUILDS = 12;
// Dos, que es lo que se lleva a una guerra: el juego deja equipar un arma
// principal y una secundaria. Eran cuatro y no correspondía a nada -- una build
// con tres armas describía algo que no se puede jugar.
export const MAX_WEAPONS = 2;

/**
 * Whether this request may write builds for this member.
 *
 * Two ways in, on purpose: the permission covers anybody's builds and belongs
 * to whoever runs the guild, while a member linked to their own roster entry
 * may always edit their own. Nobody needs elevating just to describe how they
 * play.
 */
export async function mayEditBuilds(req, playerId) {
  if (req.permissions.includes('builds.manage')) return true;

  const { rows } = await pool.query(
    `SELECT player_id AS "playerId" FROM users WHERE id = $1 AND guild_id = $2`,
    [req.user.id, GUILD_ID],
  );
  return Boolean(rows[0]?.playerId) && rows[0].playerId === playerId;
}

export async function listBuilds(playerId = null) {
  const { rows } = await pool.query(
    `SELECT id, player_id AS "playerId", name, weapons, roles,
            is_primary AS "isPrimary", notes
       FROM player_builds
      WHERE guild_id = $1 AND ($2::text IS NULL OR player_id = $2)
      ORDER BY is_primary DESC, name`,
    [GUILD_ID, playerId],
  );
  return rows;
}

function clean(build) {
  const weapons = Array.isArray(build.weapons) ? build.weapons.filter(Boolean).slice(0, MAX_WEAPONS) : [];
  const roles = Array.isArray(build.roles) ? build.roles.filter((r) => ROLES.includes(r)) : [];
  return {
    id: build.id || randomUUID(),
    name: String(build.name ?? '').trim() || 'Sin nombre',
    weapons,
    roles,
    isPrimary: Boolean(build.isPrimary),
    notes: build.notes ? String(build.notes) : null,
  };
}

/**
 * Replace one member's builds. Written whole rather than one at a time because
 * only one can be the primary, and applying that as separate edits would leave
 * a moment with two -- or none.
 */
export async function saveBuilds(playerId, builds) {
  if (!Array.isArray(builds)) throw Object.assign(new Error('expected a list of builds'), { status: 400 });
  if (builds.length > MAX_BUILDS) {
    throw Object.assign(new Error(`at most ${MAX_BUILDS} builds per member`), { status: 400 });
  }

  const rows = builds.map(clean);
  // The roster still carries one combat role, which the war room counts for
  // lane balance, so the primary build decides what it says.
  const primary = rows.find((b) => b.isPrimary) ?? rows[0];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM player_builds WHERE guild_id = $1 AND player_id = $2`, [GUILD_ID, playerId]);

    for (const build of rows) {
      await client.query(
        `INSERT INTO player_builds (id, guild_id, player_id, name, weapons, roles, is_primary, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          build.id,
          GUILD_ID,
          playerId,
          build.name,
          JSON.stringify(build.weapons),
          JSON.stringify(build.roles),
          build === primary,
          build.notes,
        ],
      );
    }

    // A gear set points at the build it was assembled for, without a foreign
    // key: deleting a build must not take a record of eight tuned pieces down
    // with it. So the pointer is cleared by hand and the set survives, asking
    // to be pointed at something again.
    await client.query(
      `UPDATE gear_sets SET build_id = NULL, updated_at = now()
        WHERE guild_id = $1 AND player_id = $2
          AND build_id IS NOT NULL AND NOT (build_id = ANY($3::text[]))`,
      [GUILD_ID, playerId, rows.map((b) => b.id)],
    );

    if (primary?.roles.length) {
      await client.query(`UPDATE players SET role = $1 WHERE guild_id = $2 AND id = $3`, [
        primary.roles[0],
        GUILD_ID,
        playerId,
      ]);
    }

    await client.query('COMMIT');
    return { saved: rows.length, primary: primary?.name ?? null };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
