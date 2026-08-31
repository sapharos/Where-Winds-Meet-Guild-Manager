/**
 * El cuerno de guerra: un sonido del panel, canal por canal.
 *
 * Un bot sólo puede ocupar un canal de voz a la vez, así que "sonar en todos"
 * es un barrido: entra, suena, salta al siguiente. A un par de segundos por
 * canal las líneas con gente se recorren en unos segundos -- los canales
 * vacíos se saltan, que además de no avisar a nadie retrasaban a los demás.
 *
 * La mitad automática vive aquí también, y es sólo la jungla: la guerra dura
 * treinta minutos y la jungla vuelve cada cinco -- el mismo calendario que
 * pintan los relojes de la Sala de Guerra, calculado desde el mismo startedAt.
 * El planificador mira cada pocos segundos si toca avisar y dispara el barrido
 * medio minuto antes de cada vuelta.
 *
 * El boss no está aquí a conciencia. No tiene hora: sale dentro de una ventana
 * de dos minutos, en saltos de treinta segundos, y arriba o abajo. Un reloj que
 * lo cantara al sexto minuto acertaría una vez de cada cinco y gritaría en
 * falso las otras cuatro, que es peor que callarse. Lo canta quien lo ve, con
 * el botón de la Sala de Guerra, y ese botón toca este mismo cuerno.
 */

import { pool, GUILD_ID } from './db.js';
import { getSession } from './war.js';
import { botEnabled, playSoundboardSound } from './discordBot.js';
import { GatewayVoice } from './discordGateway.js';
import { VOICE_SLOTS, getVoiceChannels } from './voice.js';

const KEY = `war_horn:${GUILD_ID}`;

const MINUTE = 60_000;
/** El calendario de los relojes, duplicado a conciencia: components/WarTimers.tsx
    lo dibuja y esto lo hace sonar; si el juego cambia los tiempos, son dos sitios. */
const WAR_LENGTH = 30 * MINUTE;
const JUNGLE_EVERY = 5 * MINUTE;
/** Medio minuto y no uno: las líneas pidieron el aviso pegado a la jungla,
    porque con uno entero la mitad se olvidaba antes de que saliera. */
const WARN_BEFORE = 30_000;

/**
 * { jungle: soundId | null, boss: soundId | null, slots: string[] }
 *
 * `slots` dice en qué ranuras suena el aviso -- el mismo recorte para el
 * automático y el manual. Vacío significa todos los canales configurados,
 * que es además lo que reciben las configuraciones guardadas antes de que
 * el recorte existiera.
 */
export async function getHorn() {
  const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = $1`, [KEY]);
  const vacio = { jungle: null, boss: null, slots: [] };
  if (!rows.length) return vacio;
  try {
    const parsed = JSON.parse(rows[0].value);
    return {
      jungle: parsed.jungle ?? null,
      boss: parsed.boss ?? null,
      slots: Array.isArray(parsed.slots) ? parsed.slots : [],
    };
  } catch {
    return vacio;
  }
}

export async function setHorn(config) {
  const limpio = {};
  for (const event of ['jungle', 'boss']) {
    const value = config?.[event];
    limpio[event] = typeof value === 'string' && /^\d{5,25}$/.test(value) ? value : null;
  }
  limpio.slots = (Array.isArray(config?.slots) ? config.slots : []).filter((s) =>
    VOICE_SLOTS.includes(s),
  );
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [KEY, JSON.stringify(limpio)],
  );
  return limpio;
}

/** Un barrido cada vez: dos cuernos entrelazados se pisarían los saltos. */
let barriendo = false;

/**
 * Suena `soundId` en cada canal, en orden, y cuenta el resultado.
 * Devuelve { played, results: [{ channelId, ok, reason? }] }.
 *
 * Con `skipEmpty` mira primero en qué canales hay alguien conectado y se salta
 * los vacíos: un aviso en un canal sin gente es un bot entrando y sonando para
 * nadie, y cada canal de más retrasa el aviso en los que sí importan. Los
 * saltados vuelven en `results` con su motivo, no en silencio. Si la pasarela
 * no llega a decir quién está en voz, se avisa en todos, que es lo que había:
 * mejor un aviso de más que una jungla sin cantar.
 */
export async function sweepSound(soundId, channelIds, { skipEmpty = false } = {}) {
  if (barriendo) {
    throw Object.assign(new Error('ya hay un barrido de sonido en marcha'), { status: 409 });
  }
  barriendo = true;
  const results = [];
  const gateway = new GatewayVoice();
  try {
    await gateway.connect();
    const conGente = skipEmpty ? await gateway.occupied() : null;
    for (const channelId of channelIds) {
      if (conGente && !conGente.has(channelId)) {
        results.push({ channelId, ok: false, reason: 'sin nadie conectado' });
        continue;
      }
      if (!(await gateway.join(channelId))) {
        results.push({ channelId, ok: false, reason: 'no se pudo entrar (¿permiso de Conectar?)' });
        continue;
      }
      const out = await playSoundboardSound(channelId, soundId);
      results.push({ channelId, ok: out.played, reason: out.reason });
      // Un respiro antes de saltar: que el sonido arranque donde estamos
      // antes de que el bot desaparezca hacia el siguiente canal.
      await new Promise((done) => setTimeout(done, 1200));
    }
    await gateway.disconnect();
  } finally {
    barriendo = false;
  }
  return { played: results.filter((r) => r.ok).length, results };
}

/**
 * El aviso de un evento, tal como sonaría solo: su sonido configurado, por
 * todos los canales de guerra sin repetir. Lo comparten el planificador y el
 * disparo manual del menú Voz -- un líder que ve venir algo que los relojes
 * no saben (un asalto, una retirada) toca el mismo cuerno con la mano.
 */
export async function warnEvent(type) {
  if (!['jungle', 'boss'].includes(type)) {
    throw Object.assign(new Error('unknown event'), { status: 400 });
  }
  const horn = await getHorn();
  if (!horn[type]) {
    throw Object.assign(
      new Error('ese aviso no tiene sonido configurado (Administración → Cuerno automático)'),
      { status: 409 },
    );
  }
  const channels = await getVoiceChannels();
  // El recorte elegido en Administración; sin recorte, todos los configurados.
  const ranuras = horn.slots.length
    ? horn.slots.filter((s) => channels[s])
    : Object.keys(channels);
  const objetivo = [...new Set(ranuras.map((s) => channels[s]))];
  if (!objetivo.length) {
    throw Object.assign(new Error('ninguno de los canales del aviso está configurado'), {
      status: 409,
    });
  }
  // Sólo donde haya gente: es un aviso a quien pelea, no una ronda de canales.
  return sweepSound(horn[type], objetivo, { skipEmpty: true });
}

/* ------------------------------------------------------- el automático */

/**
 * Los eventos de una guerra que sí tienen hora, como instantes absolutos desde
 * su comienzo. Sólo la jungla: el boss se canta a mano (ver la cabecera).
 */
function schedule(startedAt) {
  // pg devuelve la fecha como objeto Date; el cliente REST, como texto.
  const began = new Date(startedAt).getTime();
  const events = [];
  for (let at = JUNGLE_EVERY; at <= WAR_LENGTH; at += JUNGLE_EVERY) {
    events.push({ key: `jungle-${at}`, type: 'jungle', when: began + at });
  }
  return events;
}

// Lo ya sonado, por guerra. En memoria a conciencia: si el contenedor se
// reinicia en mitad de una guerra lo peor posible es un aviso repetido, y
// guardarlo en la base para evitar eso no compra lo que cuesta.
const sonados = new Map();

async function tick() {
  if (!botEnabled()) return;
  // El cronómetro y no el acta: la guerra ya no existe en el historial
  // mientras se pelea, y su comienzo puede estar aún por llegar (preparación).
  const war = await getSession();
  if (!war) {
    sonados.clear();
    return;
  }
  // El del boss puede estar puesto y no importar aquí: ese sólo suena a mano.
  const horn = await getHorn();
  if (!horn.jungle) return;

  const now = Date.now();
  let fired = sonados.get(war.id);
  if (!fired) {
    fired = new Set();
    sonados.set(war.id, fired);
    // Entrar a media guerra (o tras un reinicio) no debe descargar de golpe
    // todos los avisos que ya pasaron: lo pasado, pasado está.
    for (const e of schedule(war.startedAt)) if (now >= e.when - WARN_BEFORE) fired.add(e.key);
    return;
  }

  for (const event of schedule(war.startedAt)) {
    if (!horn[event.type] || fired.has(event.key)) continue;
    if (now < event.when - WARN_BEFORE || now >= event.when) continue;
    fired.add(event.key);
    try {
      const out = await warnEvent(event.type);
      console.log(`[cuerno] ${event.key}: sonó en ${out.played}/${out.results.length} canales`);
    } catch (err) {
      console.error(`[cuerno] ${event.key} falló:`, err.message);
    }
  }
}

/** Se llama una vez al arrancar. Un latido corto: el margen de aviso es de un minuto. */
export function startHornScheduler() {
  setInterval(() => {
    tick().catch((err) => console.error('[cuerno] tick falló:', err.message));
  }, 5_000);
}
