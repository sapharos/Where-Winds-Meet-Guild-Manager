import { randomUUID } from 'node:crypto';
import { pool, GUILD_ID } from './db.js';

export const SIDES = ['attack', 'defense'];
export const LANES = ['left', 'center', 'right'];
export const LANE_CAPACITY = 10;

const valid = (side, lane) => SIDES.includes(side) && LANES.includes(lane);

export async function getDeployments() {
  const { rows } = await pool.query(
    `SELECT side, lane, player_id AS "playerId", position
       FROM war_deployments WHERE guild_id = $1 ORDER BY side, lane, position`,
    [GUILD_ID],
  );
  return rows;
}

/**
 * Put a member in a lane, or take them off the board when lane is null.
 *
 * One statement per member rather than saving the whole board: two officers
 * arranging different lanes at the same time should not overwrite each other,
 * which is exactly what sending the entire deployment would do.
 */
export async function place(side, lane, playerId) {
  if (!SIDES.includes(side)) throw Object.assign(new Error('unknown side'), { status: 400 });

  if (lane === null) {
    await pool.query(`DELETE FROM war_deployments WHERE guild_id = $1 AND side = $2 AND player_id = $3`, [
      GUILD_ID,
      side,
      playerId,
    ]);
    return { removed: true };
  }
  if (!valid(side, lane)) throw Object.assign(new Error('unknown lane'), { status: 400 });

  const member = await pool.query(
    `SELECT is_active AS "isActive" FROM players WHERE guild_id = $1 AND id = $2`,
    [GUILD_ID, playerId],
  );
  if (!member.rows.length) throw Object.assign(new Error('no such member'), { status: 404 });
  // Somebody who left the guild will not be there on the day.
  if (member.rows[0].isActive === false) {
    throw Object.assign(new Error('ese miembro ya no esta en el gremio'), { status: 409 });
  }

  const { rows } = await pool.query(
    `SELECT count(*)::int AS held FROM war_deployments
      WHERE guild_id = $1 AND side = $2 AND lane = $3 AND player_id <> $4`,
    [GUILD_ID, side, lane, playerId],
  );
  if (rows[0].held >= LANE_CAPACITY) {
    throw Object.assign(new Error(`esa linea ya tiene ${LANE_CAPACITY} jugadores`), { status: 409 });
  }

  await pool.query(
    `INSERT INTO war_deployments (guild_id, side, lane, player_id, position)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (guild_id, side, player_id)
       DO UPDATE SET lane = EXCLUDED.lane, position = EXCLUDED.position`,
    [GUILD_ID, side, lane, playerId, rows[0].held],
  );
  return { placed: true };
}

export async function clearSide(side) {
  if (!SIDES.includes(side)) throw Object.assign(new Error('unknown side'), { status: 400 });
  await pool.query(`DELETE FROM war_deployments WHERE guild_id = $1 AND side = $2`, [GUILD_ID, side]);
  return { cleared: side };
}

/* ------------------------------------------------------------ strategies */

const EMPTY_LANE = { tank: 0, healer: 0, dps: 0 };

function cleanComposition(raw) {
  const composition = {};
  for (const lane of LANES) {
    const given = raw?.[lane] ?? {};
    composition[lane] = {
      tank: Math.max(0, Math.min(LANE_CAPACITY, Number(given.tank) || 0)),
      healer: Math.max(0, Math.min(LANE_CAPACITY, Number(given.healer) || 0)),
      dps: Math.max(0, Math.min(LANE_CAPACITY, Number(given.dps) || 0)),
    };
  }
  return composition;
}

export async function listStrategies() {
  const { rows } = await pool.query(
    `SELECT id, side, name, composition, notes FROM war_strategies
      WHERE guild_id = $1 ORDER BY side, name`,
    [GUILD_ID],
  );
  return rows;
}

export async function saveStrategy(strategy) {
  if (!SIDES.includes(strategy?.side)) throw Object.assign(new Error('unknown side'), { status: 400 });
  const id = strategy.id || randomUUID();

  await pool.query(
    `INSERT INTO war_strategies (id, guild_id, side, name, composition, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name, composition = EXCLUDED.composition, notes = EXCLUDED.notes`,
    [
      id,
      GUILD_ID,
      strategy.side,
      String(strategy.name ?? '').trim() || 'Sin nombre',
      JSON.stringify(cleanComposition(strategy.composition)),
      strategy.notes ?? null,
    ],
  );
  return { id };
}

export async function deleteStrategy(id) {
  await pool.query(`DELETE FROM war_strategies WHERE id = $1 AND guild_id = $2`, [id, GUILD_ID]);
}

export { EMPTY_LANE };
