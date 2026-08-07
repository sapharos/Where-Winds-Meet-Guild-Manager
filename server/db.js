import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. See .env.example.');
  process.exit(1);
}

/**
 * El pool, con techo y con relojes.
 *
 * Venía con los valores de fábrica: diez conexiones y ninguna espera acotada.
 * Eso aguanta una web donde cada pantalla pide una vez, pero no un bot: el
 * autocompletado de Discord dispara una interacción **por tecla pulsada**, y
 * cada una traía sus consultas. Escribir ocho letras deprisa, entre dos
 * personas, y las diez conexiones estaban ocupadas; lo que llegaba después
 * esperaba, y esperar más de tres segundos es que Discord dé la interacción por
 * perdida y enseñe un error.
 *
 * `statement_timeout` es lo que impide que una consulta atascada se quede con
 * su conexión para siempre: prefiere fallar y soltarla. Y `connectionTimeout`
 * hace que pedir una conexión que no llega falle rápido en vez de colgarse.
 */
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.DATABASE_POOL_MAX) || 30,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // Ninguna consulta de este producto tarda segundos; una que lo haga está
  // atascada, y sostenerla sólo propaga la espera al resto.
  statement_timeout: 8_000,
});

// Una conexión inactiva que el servidor corta emite 'error' en el pool, y sin
// oyente eso tumba el proceso entero. Se anota y se sigue: el pool abre otra.
pool.on('error', (err) => console.error('[pg] conexión inactiva perdida:', err.message));

export const GUILD_ID = process.env.GUILD_ID || 'default-guild';
const GUILD_NAME = process.env.GUILD_NAME || 'My Guild';

// Postgres may still be booting when this container starts.
async function waitForDatabase(attempts = 30) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i === attempts) throw err;
      console.log(`Database not ready (${err.code || err.message}), retry ${i}/${attempts}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

export async function migrate() {
  await waitForDatabase();
  const schema = await readFile(join(here, 'schema.sql'), 'utf8');
  await pool.query(schema);
  await pool.query(
    `INSERT INTO guilds (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [GUILD_ID, GUILD_NAME],
  );
  console.log(`Schema ready, guild "${GUILD_ID}"`);
}

/**
 * Save the roster without disturbing rows that merely stayed put.
 *
 * Scan history and recogniser aliases hang off players with ON DELETE CASCADE,
 * so the delete-then-insert used for the other collections would throw away
 * every past sweep each time somebody renamed a member. Only players actually
 * removed from the roster are deleted; the rest are updated in place, which
 * also leaves server-owned columns alone -- the UI never sends most of them
 * back and would otherwise blank them.
 */
export async function replacePlayers(
  players,
  { mayAssignRanks = false, mayEditUid = false } = {},
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Rank is a leader's decision, not part of ordinary roster upkeep. Whoever
    // may not assign it gets their submitted rank_id ignored rather than an
    // error, so editing a member's level never depends on rights they lack.
    //
    // The account number works the same way, and for a stronger reason: it is
    // what matches a member across sweeps, so a wrong one silently detaches
    // somebody from their own history. Same treatment -- ignored, not refused --
    // so an officer can still fix a typo in a name.
    const { rows: previos } = await client.query(
      `SELECT id, rank_id AS "rankId", game_uid AS "gameUid" FROM players WHERE guild_id = $1`,
      [GUILD_ID],
    );
    const antes = new Map(previos.map((r) => [r.id, r]));

    players = players.map((p) => ({
      ...p,
      rankId: mayAssignRanks ? p.rankId : (antes.get(p.id)?.rankId ?? null),
      gameUid: mayEditUid ? limpiarUid(p.gameUid) : (antes.get(p.id)?.gameUid ?? null),
    }));

    const keep = players.map((p) => p.id);
    if (keep.length) {
      await client.query(`DELETE FROM players WHERE guild_id = $1 AND NOT (id = ANY($2))`, [GUILD_ID, keep]);
    } else {
      await client.query(`DELETE FROM players WHERE guild_id = $1`, [GUILD_ID]);
    }

    for (const p of players) {
      await client.query(
        `INSERT INTO players (guild_id, id, name, role, level, sect, platform, status, rank_id, notes, game_uid)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (guild_id, id) DO UPDATE SET
           name = EXCLUDED.name, role = EXCLUDED.role, level = EXCLUDED.level,
           sect = EXCLUDED.sect, platform = EXCLUDED.platform, status = EXCLUDED.status,
           rank_id = EXCLUDED.rank_id, notes = EXCLUDED.notes, game_uid = EXCLUDED.game_uid`,
        [
          GUILD_ID, p.id, p.name, p.role, p.level, p.sect,
          p.platform ?? null, p.status, p.rankId ?? null, p.notes ?? null,
          p.gameUid ?? null,
        ],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    // Dos miembros con el mismo UID es lo único que el índice prohíbe, y ocurre
    // al copiar mal un número. Vale la pena decirlo con palabras.
    if (err.code === '23505' && err.constraint === 'players_game_uid_idx') {
      throw Object.assign(new Error('ese UID ya lo tiene otro miembro'), { status: 409 });
    }
    throw err;
  } finally {
    client.release();
  }
}

/** El UID como lo escribe el juego: sólo dígitos, o nada. */
const limpiarUid = (valor) => {
  const limpio = String(valor ?? '').replace(/[^0-9]/g, '');
  return limpio ? limpio.slice(0, 20) : null;
};

// Replace a whole collection atomically. The UI edits arrays in place and saves
// the result, so a delete-then-insert inside one transaction matches what it
// expects and never leaves a half-written roster behind. Only safe for tables
// nothing else references.
export async function replaceAll(table, columns, rows, toValues) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM ${table} WHERE guild_id = $1`, [GUILD_ID]);
    for (const row of rows) {
      const values = toValues(row);
      // $1 is guild_id, so the row's own values start at $2.
      const placeholders = values.map((_, i) => `$${i + 2}`).join(', ');
      await client.query(
        `INSERT INTO ${table} (guild_id, ${columns.join(', ')}) VALUES ($1, ${placeholders})`,
        [GUILD_ID, ...values],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
