import { randomUUID } from 'node:crypto';
import { pool, GUILD_ID } from './db.js';

// Columns a scan carries, in the order they are written. Anything the parser
// did not read arrives as null rather than being left out, so a gap in the
// history is visible instead of looking like a value that never changed.
export const SCAN_FIELDS = [
  'position',
  'level',
  'sect',
  'region',
  'language',
  'days_joined',
  'week_activity',
  'treasure_tokens_week',
  'treasure_tokens_total',
  'weekly_clears',
  'last_week_clears',
  'highest_floor',
  'league_participations',
  'ranked_participations',
  'duel_participations',
  'martial_mastery',
  'exploration_mastery',
  'profession_mastery',
];

const TEXT_FIELDS = new Set(['position', 'sect', 'region', 'language']);

/** Fold away case, accents and punctuation so Subâru and Subaru compare equal. */
function fold(value) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// Levenshtein, bounded by the shorter string, expressed as a 0..1 score.
function similarity(a, b) {
  const s = fold(a);
  const t = fold(b);
  if (!s || !t) return 0;
  if (s === t) return 1;

  let previous = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i++) {
    const current = [i];
    for (let j = 1; j <= t.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return 1 - previous[t.length] / Math.max(s.length, t.length);
}

// Below this a suggestion is noise; a person picks from the roster instead.
const SUGGEST_FLOOR = 0.6;

/**
 * Work out who each scanned name belongs to. An alias settles it outright;
 * otherwise the roster is ranked by similarity and left for a person to
 * confirm, which is the only step that ever needs one.
 */
export async function matchEntries(entries) {
  const [aliases, players] = await Promise.all([
    pool.query(`SELECT alias, player_id FROM player_aliases WHERE guild_id = $1`, [GUILD_ID]),
    pool.query(`SELECT id, name, game_uid AS "gameUid" FROM players WHERE guild_id = $1`, [GUILD_ID]),
  ]);

  const byAlias = new Map(aliases.rows.map((r) => [fold(r.alias), r.player_id]));
  const byUid = new Map(players.rows.filter((p) => p.gameUid).map((p) => [p.gameUid, p.id]));
  const roster = players.rows;

  return entries.map((entry) => {
    const read = entry.nameAsRead ?? '';
    const base = { nameAsRead: read, fields: entry.fields ?? {}, uid: entry.uid ?? null };

    // The account number outranks everything: it is the one identifier the
    // member cannot change, so it still matches after a rename.
    const uidMatch = entry.uid ? byUid.get(String(entry.uid)) : undefined;
    if (uidMatch) {
      const player = roster.find((p) => p.id === uidMatch);
      return {
        ...base,
        match: 'uid',
        playerId: uidMatch,
        playerName: player?.name ?? null,
        renamed: player ? fold(player.name) !== fold(read) : false,
        suggestions: [],
      };
    }

    const knownId = byAlias.get(fold(read));
    if (knownId) {
      const player = roster.find((p) => p.id === knownId);
      return {
        ...base,
        match: 'alias',
        playerId: knownId,
        playerName: player?.name ?? null,
        renamed: false,
        suggestions: [],
      };
    }

    const ranked = roster
      .map((p) => ({ playerId: p.id, name: p.name, score: Number(similarity(read, p.name).toFixed(3)) }))
      .filter((s) => s.score >= SUGGEST_FLOOR)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // An exact fold match is the same person spelled with accents; anything
    // less is a suggestion, never an automatic decision.
    const certain = ranked.find((s) => s.score === 1);
    return {
      ...base,
      match: certain ? 'exact' : ranked.length ? 'suggested' : 'none',
      playerId: certain?.playerId ?? null,
      playerName: certain?.name ?? null,
      renamed: false,
      suggestions: ranked,
    };
  });
}

/**
 * Write one scan. Entries name either an existing player or a new one to
 * create; either way the reading is remembered as an alias so the next scan
 * matches without asking. Rolls back whole if any single entry fails.
 */
export async function commitScan({ scannedAt, entries }) {
  const client = await pool.connect();
  const created = [];
  let stored = 0;

  try {
    await client.query('BEGIN');
    const when = scannedAt ? new Date(scannedAt) : new Date();

    for (const entry of entries) {
      let playerId = entry.playerId;

      if (!playerId && entry.createAs) {
        playerId = randomUUID();
        const f = entry.fields ?? {};
        await client.query(
          `INSERT INTO players (guild_id, id, name, role, level, sect, status, game_uid, online_id)
           VALUES ($1, $2, $3, 'DPS', $4, $5, 'Full Member', $6, $7)`,
          [
            GUILD_ID,
            playerId,
            entry.createAs,
            f.level ?? 1,
            f.sect ?? 'Sectless',
            entry.uid ? String(entry.uid) : null,
            entry.onlineId ?? null,
          ],
        );
        created.push({ id: playerId, name: entry.createAs });
      }

      if (!playerId) continue;

      // Learn the account number the first time a sweep supplies it, so later
      // sweeps match on it instead of on the name.
      if (entry.uid) {
        await client.query(
          `UPDATE players SET game_uid = $1, online_id = COALESCE($2, online_id)
            WHERE guild_id = $3 AND id = $4`,
          [String(entry.uid), entry.onlineId ?? null, GUILD_ID, playerId],
        );
      }

      if (entry.nameAsRead) {
        await client.query(
          `INSERT INTO player_aliases (guild_id, alias, player_id) VALUES ($1, $2, $3)
             ON CONFLICT (guild_id, alias) DO UPDATE SET player_id = EXCLUDED.player_id`,
          [GUILD_ID, entry.nameAsRead, playerId],
        );
      }

      const values = SCAN_FIELDS.map((key) => {
        const value = entry.fields?.[key];
        if (value === undefined || value === null || value === '') return null;
        return TEXT_FIELDS.has(key) ? String(value) : Number(value);
      });

      const placeholders = SCAN_FIELDS.map((_, i) => `$${i + 4}`).join(', ');
      await client.query(
        `INSERT INTO player_scans (guild_id, player_id, scanned_at, ${SCAN_FIELDS.join(', ')})
         VALUES ($1, $2, $3, ${placeholders})`,
        [GUILD_ID, playerId, when, ...values],
      );
      stored++;

      // Keep the roster showing what the game last reported.
      await client.query(
        `UPDATE players SET level = COALESCE($1, level), sect = COALESCE($2, sect),
                            game_position = COALESCE($3, game_position)
          WHERE guild_id = $4 AND id = $5`,
        [
          entry.fields?.level ?? null,
          entry.fields?.sect ?? null,
          entry.fields?.position ?? null,
          GUILD_ID,
          playerId,
        ],
      );
    }

    await client.query('COMMIT');
    return { stored, created, scannedAt: when.toISOString() };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function historyFor(playerId) {
  const { rows } = await pool.query(
    `SELECT scanned_at AS "scannedAt", ${SCAN_FIELDS.join(', ')}
       FROM player_scans WHERE guild_id = $1 AND player_id = $2
      ORDER BY scanned_at`,
    [GUILD_ID, playerId],
  );
  return rows;
}

export async function scanSummary() {
  const { rows } = await pool.query(
    `SELECT scanned_at AS "scannedAt", count(*)::int AS members
       FROM player_scans WHERE guild_id = $1
      GROUP BY scanned_at ORDER BY scanned_at DESC LIMIT 50`,
    [GUILD_ID],
  );
  return rows;
}
