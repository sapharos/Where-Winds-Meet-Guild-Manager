import { randomUUID } from 'node:crypto';
import { pool, GUILD_ID } from './db.js';
import { TUNABLE_AXES } from './impact.js';

// Only a starting point. The sets live in the database because the game keeps
// adding weapons, and a guild should not wait on a code change to record what
// it is already playing.
const DEFAULT_SETS = [
  { name: 'Movilidad, objetivo único', color: '#60a5fa', icon: 'fa-wind', weapons: ['Nameless Sword', 'Nameless Spear'] },
  { name: 'Movilidad, sangrado', color: '#f87171', icon: 'fa-droplet', weapons: ['Strategic Sword', 'Heavenquaker Spear'] },
  { name: 'DPS y movilidad, sin defensa', color: '#fb923c', icon: 'fa-burst', weapons: ['Infernal Twinblades', 'Mortal Rope Dart'] },
  { name: 'Soporte y curación', color: '#4ade80', icon: 'fa-heart-pulse', weapons: ['Panacea Fan', 'Soulshade Umbrella'] },
  { name: 'Distancia, ataques aéreos', color: '#a78bfa', icon: 'fa-feather', weapons: ['Inkwell Fan', 'Vernal Umbrella'] },
  { name: 'Supervivencia, reducción de daño', color: '#38bdf8', icon: 'fa-shield-halved', weapons: ['Stormbreaker Spear', 'Thundercry Blade'] },
  { name: 'Control, buffs y debuffs', color: '#c084fc', icon: 'fa-hand-sparkles', weapons: ['Everspring Umbrella', 'Unfettered Rope Dart'] },
  { name: 'Objetivo único, daño explosivo', color: '#fbbf24', icon: 'fa-bolt', weapons: ['Snowparting Blade', 'Phalanxbane Blade'] },
];

// An icon is either a Font Awesome class or a small inline picture. Anything
// larger than this belongs in a file store, and this app deliberately has none.
const MAX_ICON = 96 * 1024;

// The axes a set may be given an allowance on. Deliberately not all of them:
// monedas is about taking objectives rather than what you carry, and muertes is
// a penalty, where an allowance would pay people for dying.
//
// Leída de la propia tabla de pesos y no escrita a mano: estuvo copiada aquí
// mientras el cálculo vivía en TypeScript y no había forma de importarlo, con
// un comentario pidiendo que se mantuvieran a la par. Ahora que el cálculo está
// en `./impact.js` no hay nada que mantener.
const TUNABLE = TUNABLE_AXES.map((axis) => axis.key);

// Below a third, an allowance stops being a correction and starts being a
// different scoring system for one set. Above 1 it is a handicap, which is
// allowed -- an AoE set can fairly be asked for more damage than the rest.
const MIN_EXPECT = 0.3;
const MAX_EXPECT = 2;

/**
 * The expectations for one set, kept sparse.
 *
 * Anything at 1 is dropped rather than stored: 1 is the default, and a row full
 * of ones would make an untouched set look deliberately tuned.
 */
function cleanImpact(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of TUNABLE) {
    const value = Number(raw[key]);
    if (!Number.isFinite(value) || value === 1) continue;
    out[key] = Math.min(MAX_EXPECT, Math.max(MIN_EXPECT, Math.round(value * 100) / 100));
  }
  return out;
}

export async function seedWeaponSets() {
  const { rows } = await pool.query(`SELECT 1 FROM weapon_sets WHERE guild_id = $1 LIMIT 1`, [GUILD_ID]);
  if (rows.length) return;

  for (const [index, set] of DEFAULT_SETS.entries()) {
    await pool.query(
      `INSERT INTO weapon_sets (id, guild_id, name, weapons, color, icon, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), GUILD_ID, set.name, JSON.stringify(set.weapons), set.color, set.icon, index],
    );
  }
  console.log(`Seeded ${DEFAULT_SETS.length} weapon sets`);
}

export async function listWeaponSets() {
  const { rows } = await pool.query(
    `SELECT id, name, weapons, color, icon, impact, sort_order AS "sortOrder"
       FROM weapon_sets WHERE guild_id = $1 ORDER BY sort_order, name`,
    [GUILD_ID],
  );
  return rows;
}

function clean(set, index) {
  const icon = typeof set.icon === 'string' ? set.icon.trim() : '';
  if (icon.length > MAX_ICON) {
    throw Object.assign(new Error('the icon is too large; use a smaller picture'), { status: 400 });
  }
  return [
    set.id || randomUUID(),
    GUILD_ID,
    String(set.name ?? '').trim() || 'Conjunto sin nombre',
    JSON.stringify(Array.isArray(set.weapons) ? set.weapons.map(String).filter(Boolean) : []),
    /^#[0-9a-f]{6}$/i.test(set.color ?? '') ? set.color : '#f59e0b',
    icon || null,
    JSON.stringify(cleanImpact(set.impact)),
    index,
  ];
}

/**
 * Replace the whole catalogue. Written as one list because the order is part of
 * it, and because a build referring to a weapon by name keeps working whatever
 * happens to the set that used to hold it.
 */
export async function saveWeaponSets(sets) {
  if (!Array.isArray(sets)) throw Object.assign(new Error('expected a list of sets'), { status: 400 });

  const rows = sets.map(clean);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM weapon_sets WHERE guild_id = $1`, [GUILD_ID]);
    for (const row of rows) {
      await client.query(
        `INSERT INTO weapon_sets (id, guild_id, name, weapons, color, icon, impact, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        row,
      );
    }
    await client.query('COMMIT');
    return { saved: rows.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
