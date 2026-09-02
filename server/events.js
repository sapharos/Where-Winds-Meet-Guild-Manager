/**
 * La agenda del gremio: lo que hay programado y quién dice que va.
 *
 * Dos reglas sostienen el módulo entero:
 *
 * 1. **La respuesta es del miembro, no del sitio donde la dio.** Una fila por
 *    evento y jugador, y da igual que llegue de la web, del bot o de un oficial
 *    contestando por alguien. Sin esto habría dos verdades que reconciliar cada
 *    vez que alguien cambia de idea.
 * 2. **Se contesta sí, no o tal vez, y nada más.** La guerra llegó a preguntar
 *    a cuántas partidas se llegaba; el gremio pidió quitarlo, y con ello se fue
 *    la única diferencia entre lo que se pregunta de un tipo de evento y de
 *    otro. Todos se responden igual.
 * 3. **Se puede acotar quién contesta.** Un evento lleva una lista de roles, y
 *    vacía quiere decir el gremio entero. Son los roles del sistema de
 *    usuarios, que es como este gremio nombra sus rangos.
 */

import { randomUUID } from 'node:crypto';
import { pool, GUILD_ID } from './db.js';

export const EVENT_KINDS = ['war', 'practice', 'pve', 'casual'];
export const EVENT_ANSWERS = ['yes', 'no', 'maybe'];

/**
 * Qué se puede contestar, según lo que se pregunte, y en el orden en que se
 * lee.
 *
 * En una guerra no hay «tal vez»: las líneas se reparten con nombres, y quien
 * dice que quizá ocupa un hueco que a la hora de armar el tablero está vacío.
 * Es el sitio donde un maybe cuesta una plaza, así que se pregunta lo único
 * que se puede usar. En lo demás sigue teniendo sentido.
 *
 * Lo ya contestado no se toca: las guerras de antes tienen sus «tal vez»
 * guardados y se siguen enseñando donde los haya. Lo que cambia es lo que se
 * ofrece de aquí en adelante.
 */
/**
 * Cómo se recuerda una convocatoria a quien no ha contestado.
 *
 * En el canal, por privado, o nada. El canal es lo que había, y por eso es el
 * valor de partida: un evento guardado antes de que esto existiera sigue
 * comportándose igual.
 */
export const REMINDER_MODES = ['channel', 'dm', 'none'];

/** Una hora de pared, «HH:MM», o null si no lo es. */
export const horaDePared = (valor) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(valor ?? '').trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

/**
 * Cada cuántos días se repite el recordatorio, o null para el de siempre.
 *
 * Se acota a treinta: más que eso, en una encuesta que dura una semana, es
 * escribir «cada 90 días» y creer que se ha programado algo.
 */
const cadaDias = (valor) => {
  const n = Math.trunc(Number(valor));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 30) : null;
};

export const respuestasDe = (kind) =>
  kind === 'war' ? ['yes', 'no'] : ['yes', 'maybe', 'no'];

const MAX_MINUTES = 60 * 12;

/**
 * Quién puede contestar una encuesta: una lista de roles del servidor de
 * Discord, y vacía quiere decir todo el gremio.
 *
 * Se guardan los ids, que son lo único estable: un rol renombrado sigue siendo
 * el mismo rol, y quien tenga que escribirlo pone `<@&id>` y deja que Discord
 * ponga el nombre y el color de ahora.
 *
 * No se comprueba contra la lista real del servidor a propósito. Haría falta
 * una llamada a Discord para guardar un evento, y un rol borrado no rompe
 * nada: no lo lleva nadie, así que deja de dejar entrar a nadie por él.
 */
export const limpiarRolesDiscord = (valor) => {
  if (!Array.isArray(valor)) return [];
  // Los ids de Discord son snowflakes: sólo dígitos, y de diecisiete o
  // dieciocho cifras. Con exigir que sean números largos se cae la basura sin
  // atarse a un tamaño que Discord puede cambiar.
  const ids = valor.filter((r) => typeof r === 'string' && /^\d{5,25}$/.test(r));
  return [...new Set(ids)];
};

/**
 * Si alguien puede contestar este evento, según los roles que lleve puestos.
 *
 * `misRoles` en null es «no se sabe»: no está vinculado, o se fue del
 * servidor, o Discord no contestó. No es lo mismo que no tener ninguno, pero
 * se responde igual cuando hay restricción -- no se puede afirmar que tenga el
 * rol, que es justo lo que se estaba preguntando.
 */
export const puedeContestar = (allowedRoles, misRoles) =>
  !allowedRoles?.length || (misRoles ?? []).some((r) => allowedRoles.includes(r));

const texto = (valor, tope) => {
  const limpio = String(valor ?? '').trim();
  return limpio ? limpio.slice(0, tope) : null;
};

const fecha = (valor) => {
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) {
    throw Object.assign(new Error('esa fecha no se entiende'), { status: 400 });
  }
  return d;
};

const entero = (valor, tope, porDefecto = null) => {
  if (valor === undefined || valor === null || valor === '') return porDefecto;
  const n = Math.trunc(Number(valor));
  if (!Number.isFinite(n) || n < 1) return porDefecto;
  return Math.min(n, tope);
};

/**
 * Un evento tal y como se guarda, a partir de lo que llegó del formulario.
 *
 * Se valida aquí y no en la pantalla porque el bot va a escribir en la misma
 * tabla, y una regla que sólo vive en el formulario es una regla que la mitad
 * de las escrituras no cumple.
 */
function limpiar(body) {
  const kind = EVENT_KINDS.includes(body?.kind) ? body.kind : null;
  if (!kind) throw Object.assign(new Error('tipo de evento desconocido'), { status: 400 });

  const title = texto(body?.title, 120);
  if (!title) throw Object.assign(new Error('el evento necesita un nombre'), { status: 400 });

  const startsAt = fecha(body?.startsAt);
  // La apertura es de todos: en una encuesta es cuándo se puede empezar a
  // contestar, y en un aviso es cuándo se anuncia -- las dos son «cuándo se
  // publica», y ponerla programa la publicación. El cierre sí es sólo de la
  // encuesta: no se cierra lo que no se contesta.
  const poll = body?.poll !== false;
  const opensAt = body?.opensAt ? fecha(body.opensAt) : null;
  const closesAt = poll && body?.closesAt ? fecha(body.closesAt) : null;

  if (opensAt && closesAt && closesAt <= opensAt) {
    throw Object.assign(new Error('la encuesta no puede cerrarse antes de abrirse'), { status: 400 });
  }

  return {
    kind,
    title,
    poll,
    startsAt,
    minutes: entero(body?.minutes, MAX_MINUTES, 60),
    allowedRoles: limpiarRolesDiscord(body?.allowedRoles),
    reminderMode: REMINDER_MODES.includes(body?.reminderMode) ? body.reminderMode : 'channel',
    // Los dos van juntos: una cadencia sin hora no sabe cuándo, y una hora sin
    // cadencia no sabe cada cuánto. Con uno solo se cae al aviso de siempre.
    reminderEveryDays: horaDePared(body?.reminderTime) ? cadaDias(body?.reminderEveryDays) : null,
    reminderTime: cadaDias(body?.reminderEveryDays) ? horaDePared(body?.reminderTime) : null,
    notes: texto(body?.notes, 1000),
    opensAt,
    closesAt,
  };
}

// Cualificados con `e.` -- el alias que usan las cuatro consultas -- porque
// `notes` existe también en `event_responses`, y en cuanto una de
// ellas se une con las respuestas, sin el prefijo Postgres no sabe cuál se le
// está pidiendo.
const CAMPOS = `e.id, e.kind, e.title, e.poll, e.starts_at AS "startsAt", e.minutes, e.notes,
                e.allowed_discord_roles AS "allowedRoles",
                e.reminder_mode AS "reminderMode",
                e.reminder_every_days AS "reminderEveryDays",
                e.reminder_time AS "reminderTime",
                e.opens_at AS "opensAt", e.closes_at AS "closesAt",
                e.cancelled_at AS "cancelledAt", e.created_by AS "createdBy",
                e.discord_channel_id AS "discordChannelId",
                e.discord_message_id AS "discordMessageId"`;

/**
 * El enlace al mensaje de la encuesta, cuando está publicada.
 *
 * Se compone aquí y no en la pantalla porque hace falta el id del servidor de
 * Discord, que vive en el entorno del servidor. Sin él -- bot sin configurar --
 * queda null y la interfaz enseña que está publicada sin ofrecer un enlace roto.
 */
/** El canal que le toca a un tipo, sacado del mapa que devuelve getAgendaChannels. */
const canalPara = (mapa, kind) => mapa?.byKind?.[kind] || mapa?.channel || null;

const conEnlace = (fila, canalActual = null) => {
  if (!fila) return fila;
  const servidor = process.env.DISCORD_GUILD_ID;
  const publicada = Boolean(fila.discordChannelId && fila.discordMessageId);
  return {
    ...fila,
    discordUrl:
      servidor && publicada
        ? `https://discord.com/channels/${servidor}/${fila.discordChannelId}/${fila.discordMessageId}`
        : null,
    // Publicada, pero en un canal que ya no es el de la agenda. La encuesta
    // sigue funcionando -- los botones saben de qué evento son -- pero está
    // donde ya nadie mira, y quien organiza tiene que poder enterarse sin
    // comparar ids a mano.
    discordStale: publicada && Boolean(canalActual) && fila.discordChannelId !== canalActual,
  };
};

/**
 * Dónde se publica cada cosa.
 *
 * Un canal general y, si se quiere, uno por tipo de evento: las guerras a
 * #guerras y el PvE a #pve, que es gente distinta mirando cosas distintas. Sin
 * decidir nada por tipo se usa el general, que es como funcionó siempre y lo
 * que sigue valiendo para un gremio con un solo canal.
 *
 * Se guardan en `app_settings` y no en una tabla nueva porque son cinco filas
 * de texto: `agenda_channel` el general y `agenda_channel:pve` los de cada tipo.
 */
const CLAVE_CANAL = (kind) => (kind ? `agenda_channel:${kind}` : 'agenda_channel');

const ID_CANAL = (valor) => (/^\d{5,25}$/.test(String(valor ?? '')) ? String(valor) : null);

/**
 * El canal donde se publica un evento de este tipo. Vacío: no se publica nada.
 *
 * Sin tipo devuelve el general, que es lo que preguntan las pantallas que no
 * hablan de un evento concreto.
 */
export async function getAgendaChannel(kind = null) {
  const claves = kind ? [CLAVE_CANAL(kind), CLAVE_CANAL(null)] : [CLAVE_CANAL(null)];
  const { rows } = await pool.query(
    `SELECT key, value FROM app_settings WHERE key = ANY($1)`,
    [claves],
  );
  const porClave = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  // El del tipo manda; el general es la reserva.
  for (const clave of claves) if (porClave[clave]) return porClave[clave];
  return null;
}

/** Todos, para la pantalla que los configura: el general y los de cada tipo. */
export async function getAgendaChannels() {
  const { rows } = await pool.query(
    `SELECT key, value FROM app_settings WHERE key = ANY($1)`,
    [[CLAVE_CANAL(null), ...EVENT_KINDS.map(CLAVE_CANAL)]],
  );
  const porClave = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    channel: porClave[CLAVE_CANAL(null)] || null,
    byKind: Object.fromEntries(
      EVENT_KINDS.map((k) => [k, porClave[CLAVE_CANAL(k)] || null]),
    ),
  };
}

/**
 * Elige el canal de un tipo, o el general si no se dice tipo.
 *
 * Vacío borra la fila en vez de guardar un vacío: un tipo sin fila cae al
 * general, y es la única forma de volver a «como el general» después de
 * haberle puesto uno propio.
 */
export async function setAgendaChannel(channelId, kind = null) {
  if (kind && !EVENT_KINDS.includes(kind)) {
    throw Object.assign(new Error('ese tipo de evento no existe'), { status: 400 });
  }
  const clave = CLAVE_CANAL(kind);
  const limpio = ID_CANAL(channelId);
  if (!limpio) {
    await pool.query(`DELETE FROM app_settings WHERE key = $1`, [clave]);
    return null;
  }
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [clave, limpio],
  );
  return limpio;
}

/** Dónde quedó publicada la encuesta de un evento. */
export async function setDiscordMessage(id, channelId, messageId) {
  await pool.query(
    `UPDATE guild_events SET discord_channel_id = $3, discord_message_id = $4
      WHERE guild_id = $1 AND id = $2`,
    [GUILD_ID, id, channelId, messageId],
  );
}

/**
 * La agenda.
 *
 * Lo que viene primero y lo pasado después, porque a esta pantalla se entra a
 * mirar lo que hay por delante. Lo ya celebrado no se borra: es el registro de
 * quién dijo que iba, y sirve para saber con quién se cuenta de verdad.
 */
export async function listEvents({ past = false, from = null, to = null } = {}) {
  // Con un tramo pedido manda el tramo: la vista de mes necesita justo ese mes,
  // pasado incluido, y no toda la historia del gremio para quedarse con ocho.
  const tramo = Boolean(from && to);
  const { rows } = await pool.query(
    `SELECT ${CAMPOS},
            (SELECT count(*)::int FROM event_responses r
              WHERE r.guild_id = e.guild_id AND r.event_id = e.id AND r.answer = 'yes') AS "yes",
            (SELECT count(*)::int FROM event_responses r
              WHERE r.guild_id = e.guild_id AND r.event_id = e.id AND r.answer = 'maybe') AS "maybe",
            (SELECT count(*)::int FROM event_responses r
              WHERE r.guild_id = e.guild_id AND r.event_id = e.id AND r.answer = 'no') AS "no"
       FROM guild_events e
      WHERE e.guild_id = $1
        AND ($3::timestamptz IS NULL OR (e.starts_at >= $3 AND e.starts_at < $4))
        AND ($3::timestamptz IS NOT NULL OR $2
             OR e.starts_at + make_interval(mins => e.minutes) >= now())
      ORDER BY e.starts_at`,
    [GUILD_ID, past, tramo ? fecha(from) : null, tramo ? fecha(to) : null],
  );
  // Un solo viaje para los cinco: la lista puede traer eventos de varios tipos
  // y cada uno se compara con el canal que le toca.
  const canales = await getAgendaChannels();
  return rows.map((r) => conEnlace(r, canalPara(canales, r.kind)));
}

/** Un evento con todo lo que se ha contestado, con nombres. */
export async function getEvent(id) {
  const { rows } = await pool.query(
    `SELECT ${CAMPOS} FROM guild_events e WHERE e.guild_id = $1 AND e.id = $2`,
    [GUILD_ID, id],
  );
  if (!rows[0]) throw Object.assign(new Error('no existe ese evento'), { status: 404 });

  const respuestas = await pool.query(
    `SELECT r.player_id AS "playerId", p.name, p.role, r.answer, r.note,
            r.answered_by AS "answeredBy", r.source, r.updated_at AS "updatedAt"
       FROM event_responses r
       JOIN players p ON p.guild_id = r.guild_id AND p.id = r.player_id
      WHERE r.guild_id = $1 AND r.event_id = $2
      ORDER BY p.name`,
    [GUILD_ID, id],
  );
  return {
    ...conEnlace(rows[0], await getAgendaChannel(rows[0].kind)),
    responses: respuestas.rows,
  };
}

/**
 * Lo que viene, visto por un miembro: cada evento con lo que él contestó.
 *
 * Una sola consulta y no una por evento. La alternativa era pedir la lista y
 * después el detalle de cada uno para buscarse dentro, que son diez peticiones
 * para leer diez respuestas propias.
 *
 * Devuelve también lo que no ha contestado -- `mine` en null -- porque quien
 * mira su perfil necesita las dos cosas: a qué se apuntó y qué le falta por
 * decir. Y los cancelados a los que dijo que sí, porque quien organizó su
 * sábado alrededor de una guerra es justo a quien hay que avisar.
 *
 * `soloPublicados` es para el bot. Un evento sin publicar no se ha convocado
 * todavía: está escrito, se está mirando, y aún puede cambiar de hora o no
 * llegar a existir. En la web eso se entiende porque la ficha dice «todavía no
 * se ha publicado» y quien la ve es quien la programa; en Discord una línea de
 * una lista no lleva ese matiz, y el gremio se organiza el sábado alrededor de
 * algo que nadie había convocado.
 */
export async function myEvents(playerId, { conCancelados = false, soloPublicados = false } = {}) {
  const { rows } = await pool.query(
    `SELECT ${CAMPOS}, r.answer AS "myAnswer",
            (SELECT count(*)::int FROM event_responses x
              WHERE x.guild_id = e.guild_id AND x.event_id = e.id AND x.answer = 'yes') AS "yes",
            (SELECT count(*)::int FROM event_responses x
              WHERE x.guild_id = e.guild_id AND x.event_id = e.id AND x.answer = 'maybe') AS "maybe",
            (SELECT count(*)::int FROM event_responses x
              WHERE x.guild_id = e.guild_id AND x.event_id = e.id AND x.answer = 'no') AS "no"
       FROM guild_events e
       LEFT JOIN event_responses r
         ON r.guild_id = e.guild_id AND r.event_id = e.id AND r.player_id = $2
      WHERE e.guild_id = $1
        AND e.starts_at + make_interval(mins => e.minutes) >= now()
        -- Un cancelado se cae salvo que uno se hubiera comprometido, que es a
        -- quien hay que avisar. La agenda del bot los quiere todos: allí la
        -- pregunta es «qué hay», no «a qué me apunté».
        AND ($3 OR e.cancelled_at IS NULL OR r.answer = 'yes')
        AND (NOT $4 OR e.discord_message_id IS NOT NULL)
      ORDER BY e.starts_at`,
    [GUILD_ID, playerId, conCancelados, soloPublicados],
  );

  const canales = await getAgendaChannels();
  return rows.map(({ myAnswer, ...evento }) => ({
    ...conEnlace(evento, canalPara(canales, evento.kind)),
    mine: myAnswer ? { answer: myAnswer } : null,
  }));
}

/**
 * La guerra que viene, con lo que ha contestado cada uno.
 *
 * Es lo que la Sala de Guerra necesita para que armar la formación deje de ser
 * a ciegas: quién confirmó, quién dijo que no y quién no ha dicho nada. «La que
 * viene» es la primera que todavía no ha terminado -- durante la guerra sigue
 * siendo esa, que es cuando más falta hace mirarla.
 *
 * Devuelve null sin ninguna programada, y la Sala de Guerra se comporta como
 * antes: la agenda ayuda cuando existe, no es un requisito para desplegar.
 */
export async function nextWar() {
  const { rows } = await pool.query(
    `SELECT ${CAMPOS} FROM guild_events e
      WHERE e.guild_id = $1 AND e.kind = 'war' AND e.cancelled_at IS NULL
        AND e.starts_at + make_interval(mins => e.minutes) >= now()
      ORDER BY e.starts_at LIMIT 1`,
    [GUILD_ID],
  );
  if (!rows[0]) return null;

  const respuestas = await pool.query(
    `SELECT player_id AS "playerId", answer
       FROM event_responses WHERE guild_id = $1 AND event_id = $2`,
    [GUILD_ID, rows[0].id],
  );
  return {
    ...conEnlace(rows[0], await getAgendaChannel(rows[0].kind)),
    responses: respuestas.rows,
  };
}

export async function saveEvent(body, createdBy) {
  const limpio = limpiar(body);
  const id = body?.id || randomUUID();

  // Nada se programa hacia atrás: un evento que empieza ayer no convoca a
  // nadie, y una publicación en el pasado saldría en el próximo turno del
  // reloj, que nunca es lo que se quiso decir. Sólo se mira lo que cambia --
  // corregirle las notas a una guerra ya jugada tiene que seguir pudiéndose --
  // y con un minuto de cortesía, que entre escribir y guardar pasa tiempo.
  const { rows: previas } = await pool.query(
    `SELECT starts_at AS "startsAt", opens_at AS "opensAt", closes_at AS "closesAt"
       FROM guild_events WHERE guild_id = $1 AND id = $2`,
    [GUILD_ID, id],
  );
  const antes = previas[0] ?? null;
  const limite = Date.now() - 60000;
  const distinto = (nuevo, viejo) =>
    nuevo.getTime() !== (viejo ? new Date(viejo).getTime() : null);
  for (const [campo, queja] of [
    ['startsAt', 'el evento no puede empezar en el pasado'],
    ['opensAt', 'la publicación no puede quedar en el pasado'],
    ['closesAt', 'el cierre de la encuesta no puede quedar en el pasado'],
  ]) {
    const valor = limpio[campo];
    if (valor && valor.getTime() < limite && (!antes || distinto(valor, antes[campo]))) {
      throw Object.assign(new Error(queja), { status: 400 });
    }
  }

  await pool.query(
    `INSERT INTO guild_events
       (id, guild_id, kind, title, poll, starts_at, minutes, allowed_discord_roles, notes, opens_at, closes_at,
        reminder_mode, reminder_every_days, reminder_time, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (guild_id, id) DO UPDATE
       SET kind = EXCLUDED.kind, title = EXCLUDED.title, poll = EXCLUDED.poll, starts_at = EXCLUDED.starts_at,
           minutes = EXCLUDED.minutes, allowed_discord_roles = EXCLUDED.allowed_discord_roles, notes = EXCLUDED.notes,
           opens_at = EXCLUDED.opens_at, closes_at = EXCLUDED.closes_at,
           reminder_mode = EXCLUDED.reminder_mode,
           reminder_every_days = EXCLUDED.reminder_every_days,
           reminder_time = EXCLUDED.reminder_time`,
    [
      id,
      GUILD_ID,
      limpio.kind,
      limpio.title,
      limpio.poll,
      limpio.startsAt,
      limpio.minutes,
      JSON.stringify(limpio.allowedRoles),
      limpio.notes,
      limpio.opensAt,
      limpio.closesAt,
      limpio.reminderMode,
      limpio.reminderEveryDays,
      limpio.reminderTime,
      createdBy ?? null,
    ],
  );


  return getEvent(id);
}

/**
 * Cancelar, no borrar.
 *
 * Quien dijo que iba se organizó para ir, y hacer desaparecer el evento del
 * calendario no se lo cuenta a nadie. Cancelado sigue viéndose, tachado, con lo
 * que se había contestado; borrar queda para lo que se creó por error.
 */
export async function cancelEvent(id, cancelado = true) {
  const { rowCount } = await pool.query(
    `UPDATE guild_events SET cancelled_at = $3 WHERE guild_id = $1 AND id = $2`,
    [GUILD_ID, id, cancelado ? new Date() : null],
  );
  if (!rowCount) throw Object.assign(new Error('no existe ese evento'), { status: 404 });
  return getEvent(id);
}

/**
 * Reiniciar la encuesta: se borra lo contestado y el evento se queda intacto.
 *
 * Sirve cuando lo que se preguntó cambia debajo de las respuestas -- se mueve
 * la hora, se acota a otros roles, se convoca de nuevo lo que se había caído --
 * y lo que hay guardado ya no dice lo que dice que dice.
 *
 * No se deshace, y por eso no lo puede hacer cualquiera que programe: la ruta
 * pide `events.reset`, que de fábrica llega hasta sublíder.
 *
 * Devuelve cuántas se borraron. Es lo que permite decir «se borraron 23» en vez
 * de un «hecho» que no distingue reiniciar una encuesta llena de reiniciar dos
 * veces la misma.
 */
export async function resetResponses(id) {
  const { rows } = await pool.query(
    `SELECT 1 FROM guild_events WHERE guild_id = $1 AND id = $2`,
    [GUILD_ID, id],
  );
  if (!rows.length) throw Object.assign(new Error('no existe ese evento'), { status: 404 });

  const { rowCount } = await pool.query(
    `DELETE FROM event_responses WHERE guild_id = $1 AND event_id = $2`,
    [GUILD_ID, id],
  );
  return { borradas: rowCount, evento: await getEvent(id) };
}

export async function deleteEvent(id) {
  await pool.query(`DELETE FROM event_responses WHERE guild_id = $1 AND event_id = $2`, [GUILD_ID, id]);
  await pool.query(`DELETE FROM guild_events WHERE guild_id = $1 AND id = $2`, [GUILD_ID, id]);
}

/**
 * Contestar.
 *
 * `porOtro` distingue las dos formas de que aparezca una respuesta: la que
 * escribe el propio miembro y la que escribe un oficial en su nombre. La
 * segunda es necesaria -- hay gente que no entra ni a la web ni a Discord -- y
 * por eso mismo tiene que quedar dicho quién la puso.
 */
export async function respond(
  eventId,
  playerId,
  body,
  { source = 'web', porOtro = null, misRoles = null } = {},
) {
  const answer = EVENT_ANSWERS.includes(body?.answer) ? body.answer : null;
  if (!answer) throw Object.assign(new Error('respuesta desconocida'), { status: 400 });

  const { rows } = await pool.query(
    `SELECT kind, poll, allowed_discord_roles AS "allowedRoles", cancelled_at AS "cancelledAt",
            opens_at AS "opensAt", closes_at AS "closesAt"
       FROM guild_events WHERE guild_id = $1 AND id = $2`,
    [GUILD_ID, eventId],
  );
  const evento = rows[0];
  if (!evento) throw Object.assign(new Error('no existe ese evento'), { status: 404 });
  if (evento.cancelledAt) {
    throw Object.assign(new Error('ese evento está cancelado'), { status: 409 });
  }
  // Un aviso no se contesta, venga de donde venga la respuesta: la pantalla no
  // enseña botones, pero esta puerta es la misma para la web, el bot y el
  // oficial que anota, y la regla tiene que vivir donde entran los tres.
  if (evento.poll === false) {
    throw Object.assign(new Error('ese evento es un aviso y no lleva encuesta'), { status: 409 });
  }

  // Se comprueba aquí y no arriba porque depende del tipo, que hay que ir a
  // buscar. Vale para todos los caminos: la web, el bot y el oficial que anota
  // por otro escriben por esta misma puerta.
  if (!respuestasDe(evento.kind).includes(answer)) {
    throw Object.assign(new Error('esa respuesta no vale en este evento'), { status: 400 });
  }

  // Quién puede contestar, en el mismo sitio y por la misma razón que la
  // ventana: son tres los que preguntan, y una restricción que cada uno decide
  // si respeta no restringe nada. Quien organiza queda fuera de la regla --
  // anotar lo que alguien dijo por voz no es votar en su lugar.
  //
  // Los roles se piden aquí dentro y no antes: cuestan una llamada a Discord
  // cuando se vota desde la web, y la inmensa mayoría de las convocatorias no
  // restringen nada. Sin lista no se pregunta.
  if (!porOtro && evento.allowedRoles?.length) {
    const suyos = typeof misRoles === 'function' ? await misRoles() : misRoles;
    if (!puedeContestar(evento.allowedRoles, suyos)) {
      throw Object.assign(
        new Error(
          suyos === null
            ? 'esta convocatoria es sólo para ciertos roles de Discord, y no encuentro tu cuenta en el servidor'
            : 'esta convocatoria no está abierta a tus roles de Discord',
        ),
        { status: 403 },
      );
    }
  }

  // La ventana no la comprueba quien pregunta sino esto, porque son tres los
  // que preguntan -- la web, el bot y un oficial -- y la fecha de cierre no
  // significa nada si cada uno decide si la respeta. Un oficial sí puede
  // escribir fuera de plazo: para eso está el que organiza.
  const ahora = new Date();
  if (!porOtro) {
    if (evento.opensAt && ahora < new Date(evento.opensAt)) {
      throw Object.assign(new Error('esa encuesta todavía no está abierta'), { status: 409 });
    }
    if (evento.closesAt && ahora > new Date(evento.closesAt)) {
      throw Object.assign(new Error('esa encuesta ya está cerrada'), { status: 409 });
    }
  }

  const jugador = await pool.query(`SELECT 1 FROM players WHERE guild_id = $1 AND id = $2`, [
    GUILD_ID,
    playerId,
  ]);
  if (!jugador.rows.length) throw Object.assign(new Error('no existe ese miembro'), { status: 404 });

  await pool.query(
    `INSERT INTO event_responses
       (guild_id, event_id, player_id, answer, note, answered_by, source, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (guild_id, event_id, player_id) DO UPDATE
       SET answer = EXCLUDED.answer, note = EXCLUDED.note,
           answered_by = EXCLUDED.answered_by, source = EXCLUDED.source, updated_at = now()`,
    [GUILD_ID, eventId, playerId, answer, texto(body?.note, 300), porOtro, source],
  );

  return getEvent(eventId);
}
