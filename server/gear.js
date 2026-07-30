import { randomUUID } from 'node:crypto';
import { pool, GUILD_ID } from './db.js';

// The eight places a piece can go. Mirrored by GEAR_SLOTS in types.ts.
const SLOTS = [
  'leftWeapon',
  'rightWeapon',
  'disc',
  'pendant',
  'helm',
  'armor',
  'greaves',
  'bracer',
];

// Six lines, except the sixth may hold a normal and an arena tuning at once.
const MAX_LINES = 7;

/**
 * How much of a bar has to be filled before its reading is trusted to give a
 * ceiling.
 *
 * The ceiling comes out as value / fill, so the error in fill divides straight
 * into it: a one-point misread on a bar that is 90% full moves the answer by
 * about a hundredth, and the same misread on one that is 10% full moves it by
 * a tenth. Low rolls are still stored and still shown -- they are simply not
 * allowed to teach anybody what the maximum is.
 */
const TRUST_FILL = 0.5;

/**
 * How far a fresh estimate may sit from the settled figure and still be
 * believed.
 *
 * Inside this it is noise and gets averaged in. Outside it, something else is
 * going on -- a misread name, the wrong item level, a line that is really two
 * stats -- and quietly averaging that in would poison a ceiling that dozens of
 * good readings had agreed on. So it is dropped instead.
 */
const AGREEMENT = 0.15;

/**
 * Whether this request may write gear for this member.
 *
 * Same two ways in as builds: the permission covers anybody, and a member
 * linked to their own roster entry may always record their own. What somebody
 * is wearing is theirs to say.
 */
export async function mayEditGear(req, playerId) {
  if (req.permissions.includes('builds.manage')) return true;

  const { rows } = await pool.query(
    `SELECT player_id AS "playerId" FROM users WHERE id = $1 AND guild_id = $2`,
    [req.user.id, GUILD_ID],
  );
  return Boolean(rows[0]?.playerId) && rows[0].playerId === playerId;
}

export async function listGear(playerId = null) {
  const { rows } = await pool.query(
    `SELECT id, player_id AS "playerId", slot, name, level, relayed,
            tune_ready_at AS "tuneReadyAt", lines,
            captured_at AS "capturedAt", updated_at AS "updatedAt"
       FROM gear_pieces
      WHERE guild_id = $1 AND ($2::text IS NULL OR player_id = $2)
      ORDER BY player_id, slot`,
    [GUILD_ID, playerId],
  );
  return rows;
}

export async function listCeilings() {
  const { rows } = await pool.query(
    `SELECT stat, level, ceiling::float8 AS ceiling, samples
       FROM gear_stat_ceilings WHERE guild_id = $1 ORDER BY stat, level`,
    [GUILD_ID],
  );
  return rows;
}

const num = (value, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
};

/**
 * The key two members' readings of the same attribute have to agree on.
 *
 * The names are typed, or read off a screenshot, so they arrive with stray
 * case, accents and spacing -- and the game itself is inconsistent, printing
 * "Ataque físico máximo" on one line and "Ataque Físico Máximo" on the next of
 * the same piece. Left alone, each spelling would become its own attribute and
 * the ceilings would never gather enough samples to be worth anything.
 *
 * The name as typed is kept alongside as the label, because that is what the
 * member recognises on their own screen.
 */
const keyOf = (name) =>
  name
    // "[Girar]" is the game marking the line already rerolled, not part of
    // the attribute's name. Left in, the same attribute would key differently
    // before and after somebody commits to it, and its ceiling would be split
    // across two entries that never gather enough samples between them.
    .replace(/^\s*\[[^\]]*\]\s*/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * One attribute line, trimmed to what the schema promises.
 *
 * A line with neither a value nor a bar is dropped: it says nothing, and
 * keeping it would only pad the piece with rows that can never be advised on.
 */
function cleanLine(line) {
  const position = num(line?.position, 1, 6);
  if (position === null) return null;

  const value = line?.value === null || line?.value === undefined ? null : num(line.value, -1e9, 1e9);
  const fill = line?.fill === null || line?.fill === undefined ? null : num(line.fill, 0, 1);
  const label = String(line?.label ?? line?.stat ?? '').trim().slice(0, 120);
  const stat = keyOf(label);
  if (!stat || (value === null && fill === null)) return null;

  const out = {
    position: Math.round(position),
    stat,
    label,
    value,
    unit: line?.unit === 'percent' ? 'percent' : 'flat',
    fill,
    // The first line cannot be rerolled at all, so it can never be the one
    // somebody committed to, whatever the payload claims.
    committed: Math.round(position) !== 1 && Boolean(line?.committed),
    truncated: Boolean(line?.truncated),
  };
  if (Math.round(position) === 6) {
    out.tuning = line?.tuning === 'arena' ? 'arena' : 'normal';
    out.active = line?.active !== false;
  }
  return out;
}

/**
 * A whole piece as it comes in.
 *
 * The one rule enforced here rather than trusted from the client is that at
 * most one of lines 2..5 is committed. The game only ever allows one, and a
 * piece claiming two would quietly tell a member that a shut line is still
 * open -- which is the one mistake in this feature that cannot be undone.
 */
function cleanPiece(piece) {
  if (!SLOTS.includes(piece?.slot)) {
    throw Object.assign(new Error('unknown gear slot'), { status: 400 });
  }

  const lines = (Array.isArray(piece.lines) ? piece.lines : [])
    .map(cleanLine)
    .filter(Boolean)
    .slice(0, MAX_LINES);

  let claimed = false;
  for (const line of lines) {
    if (!line.committed) continue;
    if (claimed) line.committed = false;
    claimed = true;
  }

  return {
    id: piece.id || randomUUID(),
    slot: piece.slot,
    name: piece.name ? String(piece.name).trim().slice(0, 120) : null,
    level: piece.level === null || piece.level === undefined ? null : num(piece.level, 1, 999),
    relayed: Boolean(piece.relayed),
    tuneReadyAt: piece.tuneReadyAt ? new Date(piece.tuneReadyAt) : null,
    capturedAt: piece.capturedAt ? new Date(piece.capturedAt) : new Date(),
    lines,
  };
}

/**
 * Fold what a piece just taught us into the known ceilings.
 *
 * Runs on the same connection as the write that produced it, so a piece and
 * what it implies either both land or neither does.
 */
async function learn(client, piece) {
  if (piece.level === null) return;

  for (const line of piece.lines) {
    if (line.value === null || line.fill === null || line.fill < TRUST_FILL) continue;
    const estimate = line.value / line.fill;
    if (!Number.isFinite(estimate) || estimate <= 0) continue;

    const { rows } = await client.query(
      `SELECT ceiling::float8 AS ceiling, samples FROM gear_stat_ceilings
        WHERE guild_id = $1 AND stat = $2 AND level = $3`,
      [GUILD_ID, line.stat, piece.level],
    );

    if (!rows.length) {
      await client.query(
        `INSERT INTO gear_stat_ceilings (guild_id, stat, level, ceiling, samples)
         VALUES ($1, $2, $3, $4, 1)`,
        [GUILD_ID, line.stat, piece.level, estimate],
      );
      continue;
    }

    const { ceiling, samples } = rows[0];
    if (Math.abs(estimate - ceiling) / ceiling > AGREEMENT) continue;

    await client.query(
      `UPDATE gear_stat_ceilings
          SET ceiling = $4, samples = $5, updated_at = now()
        WHERE guild_id = $1 AND stat = $2 AND level = $3`,
      [GUILD_ID, line.stat, piece.level, (ceiling * samples + estimate) / (samples + 1), samples + 1],
    );
  }
}

/**
 * Record one piece, replacing whatever was in that slot.
 *
 * One row per slot rather than a history: you wear one helm, and every question
 * this answers is about what to do with it next.
 */
export async function saveGearPiece(playerId, piece) {
  const row = cleanPiece(piece ?? {});

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO gear_pieces
         (id, guild_id, player_id, slot, name, level, relayed, tune_ready_at, lines, captured_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, now())
       ON CONFLICT (guild_id, player_id, slot) DO UPDATE
          SET name = EXCLUDED.name, level = EXCLUDED.level, relayed = EXCLUDED.relayed,
              tune_ready_at = EXCLUDED.tune_ready_at, lines = EXCLUDED.lines,
              captured_at = EXCLUDED.captured_at, updated_at = now()`,
      [
        row.id,
        GUILD_ID,
        playerId,
        row.slot,
        row.name,
        row.level,
        row.relayed,
        row.tuneReadyAt,
        JSON.stringify(row.lines),
        row.capturedAt,
      ],
    );
    await learn(client, row);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { saved: row.slot, lines: row.lines.length };
}

export async function deleteGearPiece(playerId, slot) {
  const { rowCount } = await pool.query(
    `DELETE FROM gear_pieces WHERE guild_id = $1 AND player_id = $2 AND slot = $3`,
    [GUILD_ID, playerId, slot],
  );
  if (!rowCount) throw Object.assign(new Error('esa pieza no existe'), { status: 404 });
  return { removed: slot };
}
