import { randomUUID } from 'node:crypto';
import { pool, GUILD_ID } from './db.js';

export const SIDES = ['attack', 'defense'];
export const LANES = ['left', 'center', 'right'];
export const LANE_CAPACITY = 10;
// The guild fields thirty people in a war, and attack and defence share them.
// Ten to a lane still holds, but the two boards draw on one pool.
export const WAR_CAPACITY = 30;

const valid = (side, lane) => SIDES.includes(side) && LANES.includes(lane);

export async function getDeployments() {
  const { rows } = await pool.query(
    `SELECT side, lane, player_id AS "playerId", unit_ids AS "unitIds",
            build_id AS "buildId", position
       FROM war_deployments WHERE guild_id = $1 ORDER BY side, lane, position`,
    [GUILD_ID],
  );
  return rows;
}

/**
 * Say which tactical units a deployed member belongs to.
 *
 * Separate from placing them in a lane so that neither can silently clear the
 * other: a unit is a job and a lane is a position, and moving somebody along
 * the front does not take away what they were sent to do. More than one job at
 * a time is ordinary -- the same healer can be on the escort and in the camps.
 */
export async function setUnits(side, playerId, unitIds) {
  if (!SIDES.includes(side)) throw Object.assign(new Error('unknown side'), { status: 400 });
  await assertOpen(side);

  const wanted = Array.isArray(unitIds) ? unitIds : [];
  const clean = [...new Set(wanted.filter((id) => typeof id === 'string' && id))].slice(0, 24);

  const { rowCount } = await pool.query(
    `UPDATE war_deployments SET unit_ids = $1::jsonb
      WHERE guild_id = $2 AND side = $3 AND player_id = $4`,
    [JSON.stringify(clean), GUILD_ID, side, playerId],
  );
  if (!rowCount) throw Object.assign(new Error('ese miembro no esta desplegado'), { status: 409 });
  return { units: clean };
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
  await assertOpen(side);

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

  // The war has a size, and the two boards spend from the same allowance: what
  // attack takes, defence cannot. Counted across both sides, and excluding this
  // member so that moving somebody already on the board is never refused.
  const total = await pool.query(
    `SELECT count(*)::int AS held FROM war_deployments WHERE guild_id = $1 AND player_id <> $2`,
    [GUILD_ID, playerId],
  );
  if (total.rows[0].held >= WAR_CAPACITY) {
    throw Object.assign(
      new Error(`la guerra ya tiene ${WAR_CAPACITY} desplegados entre ataque y defensa`),
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
  await assertOpen(side);

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
  await assertOpen(side);
  await pool.query(`DELETE FROM war_deployments WHERE guild_id = $1 AND side = $2`, [GUILD_ID, side]);
  return { cleared: side };
}

/* ------------------------------------------------------------------ wars */

export async function currentWar() {
  const { rows } = await pool.query(
    `SELECT id, name, started_at AS "startedAt" FROM wars
      WHERE guild_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
    [GUILD_ID],
  );
  return rows[0] ?? null;
}

/**
 * Begin a war: take down who stands where, and under what plan.
 *
 * A copy rather than a reference to the board, because the board goes on being
 * rearranged for next week and the record of a war must not follow it. Both
 * sides have to be settled first -- half a line-up is not a line-up.
 */
export async function startWar(name) {
  if (await currentWar()) {
    throw Object.assign(new Error('ya hay una guerra en curso'), { status: 409 });
  }
  for (const side of SIDES) {
    if (!(await isLocked(side))) {
      throw Object.assign(
        new Error('bloquea las dos formaciones antes de iniciar la guerra'),
        { status: 409 },
      );
    }
  }

  const deployed = await getDeployments();
  if (!deployed.length) {
    throw Object.assign(new Error('no hay nadie desplegado'), { status: 409 });
  }

  const strategies = await listStrategies();
  const { active } = await getBoard();
  const plans = {};
  for (const side of SIDES) {
    plans[side] = strategies.find((s) => s.id === active[side]) ?? null;
  }

  const id = randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO wars (id, guild_id, name, plans) VALUES ($1, $2, $3, $4)`,
      [id, GUILD_ID, String(name ?? '').trim() || 'Guerra de gremio', JSON.stringify(plans)],
    );
    for (const d of deployed) {
      await client.query(
        `INSERT INTO war_participants (war_id, player_id, side, lane, unit_ids, build_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, d.playerId, d.side, d.lane, JSON.stringify(d.unitIds ?? []), d.buildId ?? null],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { id, participants: deployed.length };
}

/** Close the war and open both boards again for the next one. */
export async function endWar(id) {
  const { rowCount } = await pool.query(
    `UPDATE wars SET ended_at = now() WHERE id = $1 AND guild_id = $2 AND ended_at IS NULL`,
    [id, GUILD_ID],
  );
  if (!rowCount) throw Object.assign(new Error('esa guerra no esta en curso'), { status: 404 });

  await pool.query(`DELETE FROM app_settings WHERE key = ANY($1)`, [SIDES.map(lockKey)]);
  return { ended: id };
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

/* --------------------------------------------------- the plan in force */

// Which strategy each side is being arranged against. Kept on the server and
// not in the browser: two officers arranging the two halves are working from
// one plan, and a member's tactical units are only legible under the strategy
// that names them -- a selection that lived in one tab would make everyone
// else's assignments look like they had vanished.
const activeKey = (side) => `war_strategy:${GUILD_ID}:${side}`;
const lockKey = (side) => `war_locked:${GUILD_ID}:${side}`;

/** The plan in force and whether each side is settled, for the whole war. */
export async function getBoard() {
  const { rows } = await pool.query(`SELECT key, value FROM app_settings WHERE key = ANY($1)`, [
    [...SIDES.map(activeKey), ...SIDES.map(lockKey)],
  ]);
  const value = (key) => rows.find((r) => r.key === key)?.value ?? null;

  const active = {};
  const locked = {};
  for (const side of SIDES) {
    active[side] = value(activeKey(side));
    locked[side] = value(lockKey(side)) === 'true';
  }
  return { active, locked, current: await currentWar() };
}

/**
 * Settle a side, or open it again.
 *
 * A locked side is the line-up as it will be fielded, so the server stops
 * accepting changes to it rather than trusting every screen to hide its own
 * buttons: the point of settling is that it cannot drift afterwards.
 */
export async function setLock(side, locked) {
  if (!SIDES.includes(side)) throw Object.assign(new Error('unknown side'), { status: 400 });

  if (locked) {
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ($1, 'true')
       ON CONFLICT (key) DO UPDATE SET value = 'true'`,
      [lockKey(side)],
    );
  } else {
    if (await currentWar()) {
      throw Object.assign(new Error('hay una guerra en curso: finalizala primero'), { status: 409 });
    }
    await pool.query(`DELETE FROM app_settings WHERE key = $1`, [lockKey(side)]);
  }
  return { locked: Boolean(locked) };
}

async function isLocked(side) {
  const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = $1`, [lockKey(side)]);
  return rows[0]?.value === 'true';
}

async function assertOpen(side) {
  if (await isLocked(side)) {
    throw Object.assign(new Error('esa formacion esta bloqueada'), { status: 409 });
  }
}

export async function setActiveStrategy(side, id) {
  if (!SIDES.includes(side)) throw Object.assign(new Error('unknown side'), { status: 400 });
  await assertOpen(side);

  if (!id) {
    await pool.query(`DELETE FROM app_settings WHERE key = $1`, [activeKey(side)]);
    return { active: null };
  }

  const { rows } = await pool.query(
    `SELECT 1 FROM war_strategies WHERE id = $1 AND guild_id = $2 AND side = $3`,
    [id, GUILD_ID, side],
  );
  if (!rows.length) throw Object.assign(new Error('esa estrategia no existe'), { status: 404 });

  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [activeKey(side), id],
  );
  return { active: id };
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
  if (!rows.length) return;
  await pruneUnits(rows[0].side);
  // A side cannot be arranged against a plan that no longer exists.
  await pool.query(`DELETE FROM app_settings WHERE key = $1 AND value = $2`, [
    activeKey(rows[0].side),
    id,
  ]);
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
    `UPDATE war_deployments d
        SET unit_ids = COALESCE((
              SELECT jsonb_agg(held)
                FROM jsonb_array_elements_text(d.unit_ids) AS held
               WHERE EXISTS (
                 SELECT 1 FROM war_strategies s, jsonb_array_elements(s.units) u
                  WHERE s.guild_id = d.guild_id AND s.side = d.side AND u->>'id' = held
               )
            ), '[]'::jsonb)
      WHERE d.guild_id = $1 AND d.side = $2 AND jsonb_array_length(d.unit_ids) > 0`,
    [GUILD_ID, side],
  );
}

export { EMPTY_LANE };
