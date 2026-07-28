import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. See .env.example.');
  process.exit(1);
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

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
 * also leaves server-owned columns like game_uid alone -- the UI never sends
 * those back and would otherwise blank them.
 */
export async function replacePlayers(players) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const keep = players.map((p) => p.id);
    if (keep.length) {
      await client.query(`DELETE FROM players WHERE guild_id = $1 AND NOT (id = ANY($2))`, [GUILD_ID, keep]);
    } else {
      await client.query(`DELETE FROM players WHERE guild_id = $1`, [GUILD_ID]);
    }

    for (const p of players) {
      await client.query(
        `INSERT INTO players (guild_id, id, name, role, level, sect, platform, status, rank_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (guild_id, id) DO UPDATE SET
           name = EXCLUDED.name, role = EXCLUDED.role, level = EXCLUDED.level,
           sect = EXCLUDED.sect, platform = EXCLUDED.platform, status = EXCLUDED.status,
           rank_id = EXCLUDED.rank_id, notes = EXCLUDED.notes`,
        [
          GUILD_ID, p.id, p.name, p.role, p.level, p.sect,
          p.platform ?? null, p.status, p.rankId ?? null, p.notes ?? null,
        ],
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
