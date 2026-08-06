import { randomUUID } from 'node:crypto';
import { pool, GUILD_ID } from './db.js';

export const SIDES = ['attack', 'defense'];

/**
 * Las líneas: su id, que es lo guardado, y el nombre y el color con que se
 * dicen. Gemelas de `WAR_LANES` en types.ts -- allí las lee la interfaz, aquí
 * el bot, y no se pueden compartir porque este servidor es JavaScript sin
 * compilar. Si se renombra una línea, se renombra en los dos sitios.
 *
 * El id no sigue al nombre a propósito: `left`/`center`/`right` está escrito
 * en cada despliegue guardado, y cambiarlo obligaría a reescribir las guerras
 * pasadas para no ganar nada.
 */
export const LANE_INFO = [
  { id: 'left', label: 'Línea Amarilla', colour: 0xeab308 },
  { id: 'center', label: 'Línea Roja', colour: 0xef4444 },
  { id: 'right', label: 'Línea Azul', colour: 0x3b82f6 },
];

// Derivado y no escrito aparte: eran dos listas que había que mantener en el
// mismo orden, y el orden importa -- lo usan las ranuras de voz.
export const LANES = LANE_INFO.map((l) => l.id);
export const LANE_CAPACITY = 10;
// The guild fields thirty people in a war, and attack and defence share them.
// Ten to a lane still holds, but the two boards draw on one pool.
export const WAR_CAPACITY = 30;

const valid = (side, lane) => SIDES.includes(side) && LANES.includes(lane);

export async function getDeployments() {
  const { rows } = await pool.query(
    `SELECT side, lane, player_id AS "playerId", unit_ids AS "unitIds",
            build_id AS "buildId", position, is_lane_leader AS "isLaneLeader"
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
 * Marca o desmarca a un desplegado como líder de su línea.
 *
 * El marcador viaja con la persona si luego cambia de línea: quien manda no
 * deja de mandar por moverse, y si el traslado lo degrada, quitárselo es un
 * clic. Varios líderes en la misma línea se permiten a conciencia.
 */
export async function setLaneLeader(side, playerId, leader) {
  if (!SIDES.includes(side)) throw Object.assign(new Error('unknown side'), { status: 400 });
  await assertOpen(side);

  const { rowCount } = await pool.query(
    `UPDATE war_deployments SET is_lane_leader = $1
      WHERE guild_id = $2 AND side = $3 AND player_id = $4`,
    [Boolean(leader), GUILD_ID, side, playerId],
  );
  if (!rowCount) throw Object.assign(new Error('ese miembro no esta desplegado'), { status: 409 });
  return { leader: Boolean(leader) };
}

/**
 * Reordena una línea.
 *
 * El orden ya se guardaba -- `position` existe desde el principio y es por
 * donde se leen los despliegues -- pero sólo lo escribía el reparto, poniendo a
 * cada uno al final. Esto lo hace escribible, que es lo que convierte una lista
 * en una formación: quién entra primero y quién cubre.
 *
 * Se manda el orden entero de la línea y no «este va al puesto tres» a
 * propósito: mover a alguien cambia el puesto de todos los que estaban debajo,
 * y calcular eso en el servidor a partir de un solo movimiento es reconstruir
 * la lista que quien arrastra ya tiene delante.
 *
 * Lo que llega se filtra contra lo que hay: ids repetidos, de otra línea o de
 * nadie se caen, y a quien esté en la línea y no venga en la lista se le
 * respeta el sitio al final. Así una pantalla desactualizada reordena lo que
 * conoce sin tirar a nadie del tablero.
 */
export async function reorder(side, lane, order) {
  if (!valid(side, lane)) throw Object.assign(new Error('unknown lane'), { status: 400 });
  await assertOpen(side);

  const { rows } = await pool.query(
    `SELECT player_id AS "playerId" FROM war_deployments
      WHERE guild_id = $1 AND side = $2 AND lane = $3 ORDER BY position`,
    [GUILD_ID, side, lane],
  );
  const enLinea = new Set(rows.map((r) => r.playerId));

  const pedidos = [];
  for (const id of Array.isArray(order) ? order : []) {
    if (enLinea.has(id) && !pedidos.includes(id)) pedidos.push(id);
  }
  const final = [...pedidos, ...rows.map((r) => r.playerId).filter((id) => !pedidos.includes(id))];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [at, playerId] of final.entries()) {
      await client.query(
        `UPDATE war_deployments SET position = $4
          WHERE guild_id = $1 AND side = $2 AND lane = $3 AND player_id = $5`,
        [GUILD_ID, side, lane, at, playerId],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { order: final };
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

/** A guild war lasts half an hour. Nothing about it outlives that. */
export const WAR_MINUTES = 30;

/** Liga, ranked, or a challenge arranged against one particular guild. */
export const MATCH_TYPES = ['league', 'ranked', 'custom'];

/**
 * How it went. Null is a real state and stays allowed: a war nobody closed by
 * hand is shut by the clock at thirty minutes, with nobody there to say.
 */
export const OUTCOMES = ['win', 'loss'];

export async function currentWar() {
  // Closed by the clock rather than by remembering to. Whoever opens the war
  // room next is the one who notices, and the end time is the war's own thirty
  // minutes, not the moment somebody happened to look.
  const done = await pool.query(
    `UPDATE wars SET ended_at = started_at + make_interval(mins => $2::int)
      WHERE guild_id = $1 AND ended_at IS NULL
        AND started_at + make_interval(mins => $2::int) <= now()
      RETURNING id`,
    [GUILD_ID, WAR_MINUTES],
  );
  if (done.rowCount) {
    await pool.query(`DELETE FROM app_settings WHERE key = ANY($1)`, [SIDES.map(lockKey)]);
  }

  const { rows } = await pool.query(
    `SELECT id, name, started_at AS "startedAt", match_type AS "matchType" FROM wars
      WHERE guild_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
    [GUILD_ID],
  );
  return rows[0] ?? null;
}

/* --------------------------------------------------- what a war left behind */

export async function listWars() {
  const { rows } = await pool.query(
    `SELECT w.id, w.name, w.started_at AS "startedAt", w.ended_at AS "endedAt",
            w.outcome, w.notes, w.match_type AS "matchType",
            (SELECT count(*)::int FROM war_participants p WHERE p.war_id = w.id) AS "participants",
            (SELECT count(*)::int FROM war_images i WHERE i.war_id = w.id) AS "images"
       FROM wars w WHERE w.guild_id = $1 ORDER BY w.started_at DESC LIMIT 100`,
    [GUILD_ID],
  );
  return rows;
}

/**
 * The weapons a participant fought with, best effort.
 *
 * A war freezes the build somebody was carrying, but only if whoever set the
 * line-up said which one -- and a build recorded years of renames ago can since
 * have been deleted. So it prefers the build the war actually recorded, falls
 * back to their primary, and failing that to whatever they last edited. Empty
 * for a member with no builds at all, which the scoring reads as "no
 * allowance" rather than as an error.
 *
 * Both $1 (the war) and $2 (the guild) are already bound where this is spliced
 * in; it takes no parameters of its own.
 */
const CARRIED = `
  SELECT b.weapons
    FROM player_builds b
   WHERE b.guild_id = $2 AND b.player_id = p.player_id
   ORDER BY (b.id IS NOT DISTINCT FROM p.build_id) DESC, b.is_primary DESC, b.updated_at DESC
   LIMIT 1`;

export async function warDetail(id) {
  const war = await pool.query(
    `SELECT id, name, started_at AS "startedAt", ended_at AS "endedAt", outcome, notes, plans,
            match_type AS "matchType"
       FROM wars WHERE id = $1 AND guild_id = $2`,
    [id, GUILD_ID],
  );
  if (!war.rows.length) throw Object.assign(new Error('esa guerra no existe'), { status: 404 });

  // The name is joined rather than frozen: somebody who renamed themselves is
  // still the same person, and the record is read to find out what they did.
  const participants = await pool.query(
    `SELECT p.player_id AS "playerId", COALESCE(m.name, p.player_id) AS name,
            p.side, p.lane, p.unit_ids AS "unitIds", p.build_id AS "buildId",
            p.contribution, p.stats, COALESCE(carried.weapons, '[]'::jsonb) AS weapons
       FROM war_participants p
       LEFT JOIN players m ON m.guild_id = $2 AND m.id = p.player_id
       LEFT JOIN LATERAL (${CARRIED}) carried ON true
      WHERE p.war_id = $1
      ORDER BY p.side, p.lane, name`,
    [id, GUILD_ID],
  );

  const images = await pool.query(
    `SELECT id, image, caption, uploaded_at AS "uploadedAt"
       FROM war_images WHERE war_id = $1 ORDER BY uploaded_at`,
    [id],
  );

  return { ...war.rows[0], participants: participants.rows, images: images.rows };
}

/**
 * The wars one member fought, each with everyone who fought it.
 *
 * The whole line-up comes with every war and not just their own row, because
 * what a figure means is decided by the rest of the war: twenty million damage
 * is a good night or an ordinary one depending on what everybody else did.
 */
export async function warsFor(playerId) {
  const { rows } = await pool.query(
    // A war has a name and so does a member, and this row carries both. They
    // are spelled apart on purpose: called the same thing, the driver keeps
    // whichever came last and the war silently takes a member's name.
    `SELECT w.id, w.name AS "warName", w.started_at AS "startedAt",
            w.ended_at AS "endedAt", w.match_type AS "matchType", w.outcome,
            p.player_id AS "playerId", COALESCE(m.name, p.player_id) AS "playerName",
            p.side, p.lane, p.stats, COALESCE(carried.weapons, '[]'::jsonb) AS weapons
       FROM wars w
       JOIN war_participants p ON p.war_id = w.id
       LEFT JOIN players m ON m.guild_id = $2 AND m.id = p.player_id
       LEFT JOIN LATERAL (${CARRIED}) carried ON true
      WHERE w.guild_id = $2
        AND EXISTS (
          SELECT 1 FROM war_participants mine
           WHERE mine.war_id = w.id AND mine.player_id = $1
        )
      ORDER BY w.started_at DESC, "playerName"`,
    [playerId, GUILD_ID],
  );

  const wars = new Map();
  for (const row of rows) {
    let war = wars.get(row.id);
    if (!war) {
      war = {
        id: row.id,
        name: row.warName,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        matchType: row.matchType,
        outcome: row.outcome,
        participants: [],
      };
      wars.set(row.id, war);
    }
    war.participants.push({
      playerId: row.playerId,
      name: row.playerName,
      side: row.side,
      lane: row.lane,
      stats: row.stats ?? {},
      weapons: row.weapons ?? [],
    });
  }
  return [...wars.values()].slice(0, 30);
}

export async function addWarImage(warId, image, caption) {
  if (typeof image !== 'string' || !image.startsWith('data:image/')) {
    throw Object.assign(new Error('eso no es una imagen'), { status: 400 });
  }
  const { rows } = await pool.query(`SELECT 1 FROM wars WHERE id = $1 AND guild_id = $2`, [
    warId,
    GUILD_ID,
  ]);
  if (!rows.length) throw Object.assign(new Error('esa guerra no existe'), { status: 404 });

  const id = randomUUID();
  await pool.query(
    `INSERT INTO war_images (id, war_id, image, caption) VALUES ($1, $2, $3, $4)`,
    [id, warId, image, caption ?? null],
  );
  return { id };
}

export async function removeWarImage(warId, imageId) {
  await pool.query(
    `DELETE FROM war_images i USING wars w
      WHERE i.id = $1 AND i.war_id = $2 AND w.id = i.war_id AND w.guild_id = $3`,
    [imageId, warId, GUILD_ID],
  );
  return { ok: true };
}

// The columns the results screen actually reports, in its own order.
const FIGURES = ['kills', 'assists', 'deaths', 'coin', 'damage', 'taken', 'healing', 'siege'];

/** Record what one member did. Absent figures are left as they were. */
export async function setContribution(warId, playerId, body) {
  const { rows } = await pool.query(
    `SELECT stats FROM war_participants p
       JOIN wars w ON w.id = p.war_id AND w.guild_id = $3
      WHERE p.war_id = $1 AND p.player_id = $2`,
    [warId, playerId, GUILD_ID],
  );
  if (!rows.length) throw Object.assign(new Error('no participo en esa guerra'), { status: 404 });

  const stats = { ...(rows[0].stats ?? {}) };
  for (const figure of FIGURES) {
    if (!(figure in (body?.stats ?? {}))) continue;
    const value = body.stats[figure];
    if (value === null || value === '') delete stats[figure];
    else stats[figure] = Math.max(0, Math.round(Number(value) || 0));
  }

  await pool.query(
    `UPDATE war_participants
        SET stats = $1::jsonb,
            contribution = COALESCE($2, contribution)
      WHERE war_id = $3 AND player_id = $4`,
    [
      JSON.stringify(stats),
      body?.contribution === undefined || body.contribution === null
        ? null
        : Math.max(0, Math.round(Number(body.contribution) || 0)),
      warId,
      playerId,
    ],
  );
  return { stats };
}

/**
 * Begin a war: take down who stands where, and under what plan.
 *
 * A copy rather than a reference to the board, because the board goes on being
 * rearranged for next week and the record of a war must not follow it. Both
 * sides have to be settled first -- half a line-up is not a line-up.
 */
export async function startWar(name, matchType) {
  if (!MATCH_TYPES.includes(matchType)) {
    throw Object.assign(new Error('elige que tipo de partida fue: liga, ranked o personalizada'), {
      status: 400,
    });
  }
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
      `INSERT INTO wars (id, guild_id, name, plans, match_type) VALUES ($1, $2, $3, $4, $5)`,
      [id, GUILD_ID, String(name ?? '').trim() || 'Guerra de gremio', JSON.stringify(plans), matchType],
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

/**
 * Close the war and open both boards again for the next one.
 *
 * Whoever closes it says how it went, since they were there. The clock closing
 * it at thirty minutes leaves that unsaid, to be filled in from the history.
 */
export async function endWar(id, outcome) {
  if (!OUTCOMES.includes(outcome)) {
    throw Object.assign(new Error('marca si la guerra se gano o se perdio'), { status: 400 });
  }
  const { rowCount } = await pool.query(
    `UPDATE wars SET ended_at = now(), outcome = $3
      WHERE id = $1 AND guild_id = $2 AND ended_at IS NULL`,
    [id, GUILD_ID, outcome],
  );
  if (!rowCount) throw Object.assign(new Error('esa guerra no esta en curso'), { status: 404 });

  await pool.query(`DELETE FROM app_settings WHERE key = ANY($1)`, [SIDES.map(lockKey)]);
  return { ended: id };
}

/**
 * Correct the name or the match type after the fact.
 *
 * Decided in the rush of starting a war, so it is the one thing about the
 * record most likely to be picked wrong or typed in a hurry.
 */
export async function updateWar(id, { name, matchType, outcome } = {}) {
  if (matchType !== undefined && !MATCH_TYPES.includes(matchType)) {
    throw Object.assign(new Error('tipo de partida invalido'), { status: 400 });
  }
  // Null is meaningful here -- it puts a war back to unmarked -- so it has to
  // be told apart from "not mentioned in this request".
  if (outcome !== undefined && outcome !== null && !OUTCOMES.includes(outcome)) {
    throw Object.assign(new Error('resultado invalido'), { status: 400 });
  }
  const { rowCount } = await pool.query(
    `UPDATE wars SET
        name = COALESCE($1, name),
        match_type = COALESCE($2, match_type),
        outcome = CASE WHEN $5::boolean THEN $3 ELSE outcome END
      WHERE id = $4 AND guild_id = $6`,
    [
      name === undefined ? null : String(name).trim() || null,
      matchType ?? null,
      outcome ?? null,
      id,
      outcome !== undefined,
      GUILD_ID,
    ],
  );
  if (!rowCount) throw Object.assign(new Error('esa guerra no existe'), { status: 404 });
  return { ok: true };
}

/**
 * Throw away a war and everything recorded about it.
 *
 * Unlike a member -- who leaves the guild but keeps a history worth reading --
 * a war that should not exist has nothing worth keeping: it is a mistake, a
 * test, or a false start, and leaving it in place skews every ranking computed
 * against the wars around it. The participants and result screens go with it
 * through ON DELETE CASCADE.
 *
 * Deleting the war in progress is allowed on purpose: starting one by accident
 * is exactly when this is needed, and refusing would leave someone with a live
 * war they must first finish in order to erase. The locks are released either
 * way, so the boards can never be left frozen by a war that no longer exists.
 */
export async function deleteWar(id) {
  const { rows } = await pool.query(
    `DELETE FROM wars WHERE id = $1 AND guild_id = $2 RETURNING ended_at AS "endedAt"`,
    [id, GUILD_ID],
  );
  if (!rows.length) throw Object.assign(new Error('esa guerra no existe'), { status: 404 });

  if (rows[0].endedAt === null) {
    await pool.query(`DELETE FROM app_settings WHERE key = ANY($1)`, [SIDES.map(lockKey)]);
  }
  return { deleted: id };
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
  // The clock comes with it: the war timers count from when the war started,
  // and everyone has to be counting the same seconds. A browser whose clock is
  // a minute out would otherwise call the boss a minute early, for itself only.
  return { active, locked, current: await currentWar(), now: new Date().toISOString() };
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

/* -------------------------------------------------------------------------
   Formaciones guardadas: el tablero de un bando, fotografiado con nombre.
   ------------------------------------------------------------------------- */

export async function listLineups() {
  const { rows } = await pool.query(
    `SELECT id, side, name, members, created_at AS "createdAt"
       FROM war_saved_lineups WHERE guild_id = $1 ORDER BY side, name`,
    [GUILD_ID],
  );
  return rows;
}

/**
 * Photograph the current deployment of one side under a name.
 *
 * It reads the board rather than accepting a body, on purpose: the board is
 * already the only editor of line-ups, and a second way to write one would be
 * a second place for the two to disagree. Arrange, then save what you see.
 */
export async function saveLineup(side, name) {
  if (!SIDES.includes(side)) throw Object.assign(new Error('unknown side'), { status: 400 });

  const { rows } = await pool.query(
    `SELECT player_id AS "playerId", lane, unit_ids AS "unitIds",
            build_id AS "buildId", position, is_lane_leader AS "isLaneLeader"
       FROM war_deployments WHERE guild_id = $1 AND side = $2
      ORDER BY lane, position`,
    [GUILD_ID, side],
  );
  // An empty photograph is not worth keeping, and saving one by accident --
  // right after clearing the board -- would quietly shadow a real one.
  if (!rows.length) {
    throw Object.assign(new Error('no hay nadie desplegado en este bando'), { status: 409 });
  }

  const id = randomUUID();
  await pool.query(
    `INSERT INTO war_saved_lineups (id, guild_id, side, name, members)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, GUILD_ID, side, String(name ?? '').trim() || 'Sin nombre', JSON.stringify(rows)],
  );
  return { id, members: rows.length };
}

/**
 * Field a saved line-up again, and say honestly what could not come back.
 *
 * The roster drifts under a snapshot: people leave, get fielded on the other
 * side, or the war fills up. Applying replaces this side's whole board inside
 * one transaction -- half a line-up is not a line-up -- but each member is
 * admitted one by one against today's rules, and the ones refused come back
 * in the answer with their reason. Silently dropping them would read as the
 * save having lost people.
 */
export async function applyLineup(id) {
  const { rows } = await pool.query(
    `SELECT side, members FROM war_saved_lineups WHERE id = $1 AND guild_id = $2`,
    [id, GUILD_ID],
  );
  if (!rows.length) throw Object.assign(new Error('esa formacion no existe'), { status: 404 });

  const { side, members } = rows[0];
  await assertOpen(side);

  const other = side === 'attack' ? 'defense' : 'attack';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Who is still in the guild, and who is already spoken for elsewhere.
    const roster = await client.query(
      `SELECT id, name, is_active AS "isActive" FROM players WHERE guild_id = $1`,
      [GUILD_ID],
    );
    const known = new Map(roster.rows.map((p) => [p.id, p]));
    const elsewhere = new Set(
      (
        await client.query(
          `SELECT player_id FROM war_deployments WHERE guild_id = $1 AND side = $2`,
          [GUILD_ID, other],
        )
      ).rows.map((r) => r.player_id),
    );

    await client.query(`DELETE FROM war_deployments WHERE guild_id = $1 AND side = $2`, [
      GUILD_ID,
      side,
    ]);

    // The war's allowance is shared with the other side, so what is left is
    // what the other board has not already spent.
    let room = WAR_CAPACITY - elsewhere.size;
    const perLane = Object.fromEntries(LANES.map((lane) => [lane, 0]));
    const omitted = [];
    let position = 0;

    for (const member of Array.isArray(members) ? members : []) {
      const who = known.get(member.playerId);
      const label = who?.name ?? member.playerId;
      if (!who || who.isActive === false) {
        omitted.push({ playerId: member.playerId, name: label, reason: 'ya no está en el gremio' });
        continue;
      }
      if (elsewhere.has(member.playerId)) {
        omitted.push({
          playerId: member.playerId,
          name: label,
          reason: `ya desplegado en ${other === 'attack' ? 'Ataque' : 'Defensa'}`,
        });
        continue;
      }
      if (!LANES.includes(member.lane) || perLane[member.lane] >= LANE_CAPACITY) {
        omitted.push({ playerId: member.playerId, name: label, reason: 'su línea está llena' });
        continue;
      }
      if (room <= 0) {
        omitted.push({ playerId: member.playerId, name: label, reason: 'sin cupo en la guerra' });
        continue;
      }

      await client.query(
        `INSERT INTO war_deployments (guild_id, side, lane, player_id, position, unit_ids, build_id, is_lane_leader)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
        [
          GUILD_ID,
          side,
          member.lane,
          member.playerId,
          position++,
          JSON.stringify(Array.isArray(member.unitIds) ? member.unitIds : []),
          member.buildId ?? null,
          // Las fotos de antes de que existieran líderes vuelven sin ninguno.
          Boolean(member.isLaneLeader),
        ],
      );
      perLane[member.lane]++;
      room--;
    }

    await client.query('COMMIT');
    return { side, applied: position, omitted };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteLineup(id) {
  await pool.query(`DELETE FROM war_saved_lineups WHERE id = $1 AND guild_id = $2`, [id, GUILD_ID]);
}

export { EMPTY_LANE };
