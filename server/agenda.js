/**
 * Lo que hace que la agenda ocurra sola.
 *
 * Una serie describe algo que pasa todas las semanas -- «las guerras son los
 * sábados y los domingos a las 7:30» -- y de ahí salen los eventos concretos,
 * con su fecha, su encuesta y su publicación. Nadie tiene que acordarse el
 * lunes: acordarse es justo lo que falla.
 *
 * La serie guarda la hora **de pared** y su zona, no un instante. «Los sábados
 * a las 7:30 de Colombia» tiene que seguir significando lo mismo dentro de seis
 * meses, y un instante guardado se desfasa en cuanto una zona cambia de hora.
 * Colombia no la cambia, pero la regla no puede depender de eso: el gremio
 * podría fijar otra zona, y entonces el error aparecería dos veces al año y
 * costaría media guerra descubrirlo.
 */

import { randomUUID } from 'node:crypto';
import { pool, GUILD_ID } from './db.js';

/* --------------------------------------------------------------- husos */

/**
 * El desfase de una zona en un instante, en milisegundos.
 *
 * Se lee del propio formateador: no hay forma de preguntarle a JavaScript el
 * desfase de una zona, pero sí de pedirle la hora de pared y restarla.
 */
function desfase(zona, fecha) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(fecha);

  const v = {};
  for (const p of partes) if (p.type !== 'literal') v[p.type] = Number(p.value);
  // La medianoche sale como «24» en algunos entornos.
  const comoUTC = Date.UTC(v.year, v.month - 1, v.day, v.hour % 24, v.minute, v.second);
  return comoUTC - fecha.getTime();
}

/**
 * El instante en el que un reloj de esa zona marca esa hora.
 *
 * Dos pasadas y no una: la primera supone que la hora es UTC y corrige por el
 * desfase de ese instante supuesto, que junto a un cambio de hora no es el del
 * instante real. La segunda ya corrige sobre el bueno.
 */
export function instante(zona, y, m, d, hh, mm) {
  const supuesto = Date.UTC(y, m - 1, d, hh, mm);
  const primera = supuesto - desfase(zona, new Date(supuesto));
  return new Date(supuesto - desfase(zona, new Date(primera)));
}

/** La fecha del calendario de esa zona en un instante. */
function fechaLocal(zona, fecha) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(fecha)
    .split('-')
    .map(Number);
  return { y, m, d };
}

const HORA = (texto) => {
  const [hh, mm] = String(texto ?? '00:00').split(':').map(Number);
  return { hh: Number.isFinite(hh) ? hh : 0, mm: Number.isFinite(mm) ? mm : 0 };
};

/**
 * Las próximas veces que toca, a partir de un instante.
 *
 * Se recorre el calendario **de la zona**, día a día, y de cada día que cae en
 * el día de la semana buscado se compone su instante. Recorrer instantes en vez
 * de días de calendario es lo que se rompe cuando una zona cambia de hora: un
 * día no siempre dura veinticuatro.
 */
export function proximas(zona, weekday, horaTexto, desde, cuantas) {
  const { hh, mm } = HORA(horaTexto);
  const hoy = fechaLocal(zona, desde);
  const salida = [];

  for (let i = 0; i < 7 * (cuantas + 1) + 7 && salida.length < cuantas; i++) {
    // Aritmética de calendario pura: `Date.UTC` resuelve el cambio de mes, y de
    // aquí sólo se saca el día de la semana y la fecha, nunca un instante.
    const dia = new Date(Date.UTC(hoy.y, hoy.m - 1, hoy.d + i));
    if (dia.getUTCDay() !== weekday) continue;

    const cuando = instante(zona, dia.getUTCFullYear(), dia.getUTCMonth() + 1, dia.getUTCDate(), hh, mm);
    if (cuando > desde) salida.push(cuando);
  }
  return salida;
}

/** Una hora de pared, tantos días antes de un evento, en su misma zona. */
function relativo(zona, evento, diasAntes, horaTexto) {
  if (diasAntes === null || diasAntes === undefined) return null;
  const { hh, mm } = HORA(horaTexto);
  const f = fechaLocal(zona, evento);
  const dia = new Date(Date.UTC(f.y, f.m - 1, f.d - diasAntes));
  return instante(zona, dia.getUTCFullYear(), dia.getUTCMonth() + 1, dia.getUTCDate(), hh, mm);
}

/* --------------------------------------------------------------- series */

const CAMPOS = `id, kind, title, weekday, time_local AS "timeLocal", timezone,
                minutes, rounds, notes,
                opens_days_before AS "opensDaysBefore", opens_time AS "opensTime",
                closes_days_before AS "closesDaysBefore", closes_time AS "closesTime",
                auto_publish AS "autoPublish", active`;

export async function listSeries() {
  const { rows } = await pool.query(
    `SELECT ${CAMPOS} FROM event_series WHERE guild_id = $1 ORDER BY weekday, time_local`,
    [GUILD_ID],
  );
  return rows;
}

const entero = (v, min, max, porDefecto) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : porDefecto;
};

const HHMM = (v, porDefecto) => (/^\d{1,2}:\d{2}$/.test(String(v ?? '')) ? String(v) : porDefecto);

export async function saveSeries(body) {
  const id = body?.id || randomUUID();
  const zona = String(body?.timezone ?? '').trim() || 'America/Bogota';
  // Una zona inventada haría que la serie no generara nada, en silencio y para
  // siempre. Se comprueba aquí, que es donde se puede decir.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zona });
  } catch {
    throw Object.assign(new Error(`«${zona}» no es una zona horaria conocida`), { status: 400 });
  }

  await pool.query(
    `INSERT INTO event_series
       (id, guild_id, kind, title, weekday, time_local, timezone, minutes, rounds, notes,
        opens_days_before, opens_time, closes_days_before, closes_time, auto_publish, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (guild_id, id) DO UPDATE
       SET kind = EXCLUDED.kind, title = EXCLUDED.title, weekday = EXCLUDED.weekday,
           time_local = EXCLUDED.time_local, timezone = EXCLUDED.timezone,
           minutes = EXCLUDED.minutes, rounds = EXCLUDED.rounds, notes = EXCLUDED.notes,
           opens_days_before = EXCLUDED.opens_days_before, opens_time = EXCLUDED.opens_time,
           closes_days_before = EXCLUDED.closes_days_before, closes_time = EXCLUDED.closes_time,
           auto_publish = EXCLUDED.auto_publish, active = EXCLUDED.active`,
    [
      id,
      GUILD_ID,
      ['war', 'practice', 'pve', 'casual'].includes(body?.kind) ? body.kind : 'war',
      String(body?.title ?? '').trim().slice(0, 120) || 'Evento semanal',
      entero(body?.weekday, 0, 6, 6),
      HHMM(body?.timeLocal, '19:30'),
      zona,
      entero(body?.minutes, 1, 720, 150),
      body?.kind === 'war' ? entero(body?.rounds, 1, 12, 5) : null,
      String(body?.notes ?? '').trim().slice(0, 1000) || null,
      entero(body?.opensDaysBefore, 0, 60, 5),
      HHMM(body?.opensTime, '00:00'),
      entero(body?.closesDaysBefore, 0, 60, 0),
      HHMM(body?.closesTime, '12:00'),
      body?.autoPublish !== false,
      body?.active !== false,
    ],
  );
  return (await listSeries()).find((s) => s.id === id);
}

/**
 * Las dos guerras de la semana, una sola vez.
 *
 * Sábado y domingo a las 7:30 de la tarde en Colombia; la encuesta abre el
 * lunes y cierra el sábado al mediodía -- para la del domingo eso son seis y un
 * día antes, que caen en el mismo lunes y el mismo mediodía. Todo se puede
 * cambiar en Administración; esto es sólo no empezar con la pantalla vacía.
 *
 * El marcador hace que no vuelvan si alguien las borra a propósito.
 */
export async function seedSeries() {
  const { rows } = await pool.query(`SELECT 1 FROM app_settings WHERE key = 'seeded:event_series'`);
  if (rows.length) return;

  for (const s of [
    { id: 'serie-guerra-sabado', title: 'Guerra del sábado', weekday: 6, opensDaysBefore: 5, closesDaysBefore: 0 },
    { id: 'serie-guerra-domingo', title: 'Guerra del domingo', weekday: 0, opensDaysBefore: 6, closesDaysBefore: 1 },
  ]) {
    await saveSeries({
      ...s,
      kind: 'war',
      timeLocal: '19:30',
      timezone: 'America/Bogota',
      minutes: 150,
      rounds: 5,
      opensTime: '00:00',
      closesTime: '12:00',
    });
  }

  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ('seeded:event_series', 'true')
       ON CONFLICT (key) DO NOTHING`,
  );
}

export async function deleteSeries(id) {
  // Los eventos ya creados se quedan: la gente contestó, y borrar la regla no
  // es borrar el sábado que ya está convocado. Sólo dejan de venir más.
  await pool.query(`UPDATE guild_events SET series_id = NULL WHERE guild_id = $1 AND series_id = $2`, [
    GUILD_ID,
    id,
  ]);
  await pool.query(`DELETE FROM event_series WHERE guild_id = $1 AND id = $2`, [GUILD_ID, id]);
}

/* ------------------------------------------------------ materializar */

/**
 * Crea los eventos que faltan de aquí a unas semanas.
 *
 * Idempotente por el índice único de (serie, instante): el programador puede
 * pasar cada cinco minutos, y el arranque puede repetirse, sin que aparezcan
 * dos sábados. Y no toca los eventos ya creados: si un oficial le cambió la
 * hora a la guerra de este sábado, la serie no se la devuelve.
 */
export async function asegurarEventos({ semanas = 3, ahora = new Date() } = {}) {
  const series = (await listSeries()).filter((s) => s.active);
  const creados = [];

  for (const s of series) {
    for (const cuando of proximas(s.timezone, s.weekday, s.timeLocal, ahora, semanas)) {
      const { rows } = await pool.query(
        `INSERT INTO guild_events
           (id, guild_id, series_id, kind, title, starts_at, minutes, rounds, notes, opens_at, closes_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (guild_id, series_id, starts_at) WHERE series_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [
          randomUUID(),
          GUILD_ID,
          s.id,
          s.kind,
          s.title,
          cuando,
          s.minutes,
          s.rounds,
          s.notes,
          relativo(s.timezone, cuando, s.opensDaysBefore, s.opensTime),
          relativo(s.timezone, cuando, s.closesDaysBefore, s.closesTime),
        ],
      );
      if (rows[0]) creados.push(rows[0].id);
    }
  }
  return creados;
}

/**
 * Los que ya toca publicar: abierta la encuesta y sin mensaje todavía.
 *
 * La condición es la fecha de apertura y no la de creación, que es lo que hace
 * que se pueda crear el calendario de tres semanas por delante sin llenar el
 * canal de encuestas que no tocan hasta dentro de un mes.
 */
export async function pendientesDePublicar({ ahora = new Date() } = {}) {
  const { rows } = await pool.query(
    `SELECT e.id FROM guild_events e
       JOIN event_series s ON s.guild_id = e.guild_id AND s.id = e.series_id
      WHERE e.guild_id = $1 AND s.auto_publish AND e.discord_message_id IS NULL
        AND e.cancelled_at IS NULL
        AND (e.opens_at IS NULL OR e.opens_at <= $2)
        AND e.starts_at > $2
      ORDER BY e.starts_at`,
    [GUILD_ID, ahora],
  );
  return rows.map((r) => r.id);
}

/** Cuánto antes del cierre se avisa a quien no ha contestado. */
export const AVISO_HORAS = 6;

/**
 * Los que hay que recordar: la encuesta está a punto de cerrarse, hay gente sin
 * contestar y todavía no se avisó.
 *
 * Una sola vez por evento, y por eso queda anotado: un recordatorio que se
 * repite deja de leerse, y el gremio aprende a ignorar al bot.
 */
export async function pendientesDeAviso({ ahora = new Date() } = {}) {
  const { rows } = await pool.query(
    `SELECT e.id FROM guild_events e
      WHERE e.guild_id = $1 AND e.reminded_at IS NULL AND e.cancelled_at IS NULL
        AND e.discord_message_id IS NOT NULL
        AND e.closes_at IS NOT NULL
        AND e.closes_at > $2
        AND e.closes_at <= $2 + make_interval(hours => $3::int)
      ORDER BY e.closes_at`,
    [GUILD_ID, ahora, AVISO_HORAS],
  );
  return rows.map((r) => r.id);
}

export async function marcarAvisado(id) {
  await pool.query(`UPDATE guild_events SET reminded_at = now() WHERE guild_id = $1 AND id = $2`, [
    GUILD_ID,
    id,
  ]);
}

/**
 * Quién no ha dicho nada todavía, con su Discord si lo tiene.
 *
 * Sólo los del gremio: a quien está de baja no se le recuerda una guerra.
 */
export async function sinContestar(eventId) {
  const { rows } = await pool.query(
    `SELECT p.id, p.name,
            (SELECT u.discord_id FROM users u
              WHERE u.guild_id = p.guild_id AND u.player_id = p.id
                AND u.disabled = false AND u.discord_id IS NOT NULL
              ORDER BY u.created_at LIMIT 1) AS "discordId"
       FROM players p
      WHERE p.guild_id = $1 AND COALESCE(p.is_active, true)
        AND NOT EXISTS (
          SELECT 1 FROM event_responses r
           WHERE r.guild_id = p.guild_id AND r.event_id = $2 AND r.player_id = p.id)
      ORDER BY p.name`,
    [GUILD_ID, eventId],
  );
  return rows;
}
