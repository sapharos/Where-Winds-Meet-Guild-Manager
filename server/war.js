import { randomUUID } from 'node:crypto';
import { pool, GUILD_ID } from './db.js';

export const SIDES = ['attack', 'defense'];
export const LANES = ['left', 'center', 'right'];
export const LANE_CAPACITY = 10;

const valid = (side, lane) => SIDES.includes(side) && LANES.includes(lane);

export async function getDeployments() {
  const { rows } = await pool.query(
    `SELECT side, lane, player_id AS "playerId", unit_id AS "unitId",
            build_id AS "buildId", position
       FROM war_deployments WHERE guild_id = $1 ORDER BY side, lane, position`,
    [GUILD_ID],
  );
  return rows;
}

/**
 * Put a deployed member into a tactical unit, or take them out of one.
 *
 * Separate from placing them in a lane so that neither can silently clear the
 * other: a unit is a job and a lane is a position, and moving somebody along
 * the front does not take away what they were sent to do.
 */
export async function setUnit(side, playerId, unitId) {
  if (!SIDES.includes(side)) throw Object.assign(new Error('unknown side'), { status: 400 });

  const { rowCount } = await pool.query(
    `UPDATE war_deployments SET unit_id = $1
      WHERE guild_id = $2 AND side = $3 AND player_id = $4`,
    [unitId || null, GUILD_ID, side, playerId],
  );
  if (!rowCount) throw Object.assign(new Error('ese miembro no esta desplegado'), { status: 409 });
  return { ok: true };
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

  // Nobody fights both halves of the same war. The two boards are arranged
  // separately, often by different people, so the clash has to be refused here
  // rather than left to whoever happens to look at both.
  const other = side === 'attack' ? 'defense' : 'attack';
  const clash = await pool.query(
    `SELECT lane FROM war_deployments WHERE guild_id = $1 AND side = $2 AND player_id = $3`,
    [GUILD_ID, other, playerId],
  );
  if (clash.rows.length) {
    throw Object.assign(
      new Error(`ya esta desplegado en ${other === 'attack' ? 'Ataque' : 'Defensa'}`),
      { status: 409 },
    );
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

/**
 * Say which build a deployed member should bring.
 *
 * The build is checked against that member's own, so a plan cannot name
 * somebody else's; null puts them back on whatever they usually play.
 */
export async function setBuild(side, playerId, buildId) {
  if (!SIDES.includes(side)) throw Object.assign(new Error('unknown side'), { status: 400 });

  if (buildId) {
    const { rows } = await pool.query(
      `SELECT 1 FROM player_builds WHERE id = $1 AND guild_id = $2 AND player_id = $3`,
      [buildId, GUILD_ID, playerId],
    );
    if (!rows.length) throw Object.assign(new Error('esa build no es suya'), { status: 400 });
  }

  const { rowCount } = await pool.query(
    `UPDATE war_deployments SET build_id = $1
      WHERE guild_id = $2 AND side = $3 AND player_id = $4`,
    [buildId || null, GUILD_ID, side, playerId],
  );
  if (!rowCount) throw Object.assign(new Error('ese miembro no esta desplegado'), { status: 409 });
  return { ok: true };
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

// A unit draws from the whole side, not from one lane, so its target is bounded
// by the whole board rather than by a single lane.
const SIDE_CAPACITY = LANE_CAPACITY * LANES.length;

const count = (value, ceiling) => Math.max(0, Math.min(ceiling, Number(value) || 0));

function cleanUnits(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 24).map((unit) => ({
    id: unit?.id || randomUUID(),
    name: String(unit?.name ?? '').trim().slice(0, 60) || 'Unidad sin nombre',
    icon: String(unit?.icon ?? 'fa-users').trim() || 'fa-users',
    color: /^#[0-9a-f]{6}$/i.test(unit?.color ?? '') ? unit.color : '#f59e0b',
    tank: count(unit?.tank, SIDE_CAPACITY),
    healer: count(unit?.healer, SIDE_CAPACITY),
    dps: count(unit?.dps, SIDE_CAPACITY),
    notes: unit?.notes ? String(unit.notes).slice(0, 300) : null,
  }));
}

export async function listStrategies() {
  const { rows } = await pool.query(
    `SELECT id, side, name, composition, units, notes FROM war_strategies
      WHERE guild_id = $1 ORDER BY side, name`,
    [GUILD_ID],
  );
  return rows;
}

export async function saveStrategy(strategy) {
  if (!SIDES.includes(strategy?.side)) throw Object.assign(new Error('unknown side'), { status: 400 });
  const id = strategy.id || randomUUID();

  const units = cleanUnits(strategy.units);

  await pool.query(
    `INSERT INTO war_strategies (id, guild_id, side, name, composition, units, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name, composition = EXCLUDED.composition,
           units = EXCLUDED.units, notes = EXCLUDED.notes`,
    [
      id,
      GUILD_ID,
      strategy.side,
      String(strategy.name ?? '').trim() || 'Sin nombre',
      JSON.stringify(cleanComposition(strategy.composition)),
      JSON.stringify(units),
      strategy.notes ?? null,
    ],
  );
  await pruneUnits(strategy.side);
  return { id, units };
}

export async function deleteStrategy(id) {
  const { rows } = await pool.query(
    `DELETE FROM war_strategies WHERE id = $1 AND guild_id = $2 RETURNING side`,
    [id, GUILD_ID],
  );
  if (rows.length) await pruneUnits(rows[0].side);
}

/**
 * Forget unit assignments whose unit no longer exists anywhere.
 *
 * Editing a strategy can delete a unit that members were already assigned to.
 * The check is against every strategy on that side, not just the one edited,
 * so somebody arranged under one plan is not unassigned by a change to another.
 */
async function pruneUnits(side) {
  await pool.query(
    `UPDATE war_deployments d SET unit_id = NULL
      WHERE d.guild_id = $1 AND d.side = $2 AND d.unit_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM war_strategies s, jsonb_array_elements(s.units) u
           WHERE s.guild_id = d.guild_id AND s.side = d.side AND u->>'id' = d.unit_id
        )`,
    [GUILD_ID, side],
  );
}

export { EMPTY_LANE };
