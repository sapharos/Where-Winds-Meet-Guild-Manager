/**
 * La guerra hablada: repartir a los desplegados por los canales de voz.
 *
 * La configuración es un mapa ranura → canal de Discord: el canal general de
 * la guerra, uno por bando, y uno por cada línea de cada bando. Vive en
 * app_settings como un JSON porque se lee y se escribe siempre entero, igual
 * que hacen los cerrojos de bando.
 *
 * El reparto cruza tres cosas que ya existen: los despliegues dicen quién
 * juega y en qué línea, la tabla de usuarios dice qué Discord tiene cada
 * jugador, y el bot mueve. Todo lo que falle por persona -- sin Discord
 * vinculado, sin conectar a voz, canal sin configurar -- se cuenta y se
 * devuelve con nombre, porque "moví a 14" sin decir a quién no, obliga a
 * pasar lista a gritos, que es justo lo que esto viene a evitar.
 */

import { pool, GUILD_ID } from './db.js';
import { LANES, SIDES } from './war.js';
import { moveToVoice } from './discordBot.js';

const KEY = `war_voice:${GUILD_ID}`;

/** Las ranuras válidas: general, cada bando, y bando:línea. */
export const VOICE_SLOTS = [
  'general',
  ...SIDES,
  ...SIDES.flatMap((side) => LANES.map((lane) => `${side}:${lane}`)),
];

export async function getVoiceChannels() {
  const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = $1`, [KEY]);
  if (!rows.length) return {};
  try {
    return JSON.parse(rows[0].value);
  } catch {
    return {};
  }
}

export async function setVoiceChannels(map) {
  const limpio = {};
  for (const slot of VOICE_SLOTS) {
    const value = map?.[slot];
    if (typeof value === 'string' && /^\d{5,25}$/.test(value)) limpio[slot] = value;
  }
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [KEY, JSON.stringify(limpio)],
  );
  return limpio;
}

/**
 * Mueve a todos los desplegados según el modo: todos al general, cada bando a
 * su canal, o cada uno a su línea. Devuelve el recuento con nombres.
 *
 * Va en serie y no en paralelo a conciencia: treinta PATCH simultáneos contra
 * el mismo servidor de Discord es pedir un 429 seguro; de uno en uno tarda
 * unos segundos y llega entero.
 */
export async function deployVoice(mode) {
  const channels = await getVoiceChannels();
  const targetOf = (d) =>
    mode === 'general'
      ? channels.general
      : mode === 'sides'
        ? channels[d.side]
        : channels[`${d.side}:${d.lane}`];

  const { rows: deployed } = await pool.query(
    `SELECT d.side, d.lane, d.player_id AS "playerId", p.name,
            u.discord_id AS "discordId"
       FROM war_deployments d
       JOIN players p ON p.guild_id = d.guild_id AND p.id = d.player_id
       LEFT JOIN users u ON u.guild_id = d.guild_id AND u.player_id = d.player_id
      WHERE d.guild_id = $1
      ORDER BY d.side, d.lane, p.name`,
    [GUILD_ID],
  );

  let moved = 0;
  const skipped = [];
  for (const d of deployed) {
    const channel = targetOf(d);
    if (!channel) {
      skipped.push({ name: d.name, reason: 'canal sin configurar' });
      continue;
    }
    if (!d.discordId) {
      skipped.push({ name: d.name, reason: 'sin Discord vinculado' });
      continue;
    }
    const result = await moveToVoice(d.discordId, channel);
    if (result.moved) moved++;
    else skipped.push({ name: d.name, reason: result.reason });
  }
  return { total: deployed.length, moved, skipped };
}
