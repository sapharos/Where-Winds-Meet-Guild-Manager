/**
 * Los avisos por privado de las grabaciones. Ver docs/VODS.md §9.
 *
 * Dos, y en direcciones contrarias: cuando una grabación queda lista se avisa a
 * quien puede publicarla, y cuando alguien la publica se le da las gracias a
 * quien la subió. Los dos existen por lo mismo -- entre subir y publicar hay una
 * persona esperando a que otra entre a la web sin motivo para entrar, y esa
 * espera era de días.
 *
 * Módulo aparte de `vods.js` por dónde puede fallar. Discord es una red que se
 * cae, tiene límites de ritmo y contesta 403 a quien tiene los privados
 * cerrados; nada de eso puede tumbar un remux ni impedir que se publique una
 * grabación. Así que **nada de aquí lanza nunca**: se llama sin esperarlo y lo
 * peor que puede pasar es que no llegue un mensaje.
 *
 * En JavaScript llano y con los tipos en JSDoc, como el resto de `server/`.
 */

import { pool, GUILD_ID } from './db.js';
import { botEnabled, sendDirectMessage } from './discordBot.js';
import { ZONA } from './agenda.js';

/** El latón de la casa, el mismo que usan los embeds del bot. */
const LATON = 0xd3a155;
/** El verde de victoria, para lo que sale bien. Gemelo de COLOR_RESULTADO.win. */
const VERDE = 0x204a36;

/** Copiado de WAR_MATCH_TYPE_LABELS en types.ts, como hace discordCommands. */
const TIPOS = { league: 'Liga', ranked: 'Ranked', custom: 'Reto' };

/**
 * La fecha de la guerra en la hora del gremio.
 *
 * En la del gremio y no en UTC: el contenedor va en UTC, así que una guerra de
 * las nueve de la noche se anunciaría como del día siguiente para media
 * América. Es la misma zona que usan la agenda y el resto de los embeds.
 *
 * @param {Date | string} fecha
 */
const cuando = (fecha) =>
  new Intl.DateTimeFormat('es', {
    timeZone: ZONA,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(fecha));

/** @param {number | null} ms */
const duracion = (ms) => {
  if (!ms) return null;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/**
 * A dónde mandar a quien lea el aviso.
 *
 * Sin `PUBLIC_URL` no se pone enlace en vez de poner uno roto: un privado que
 * lleva a ninguna parte es peor que un privado sin enlace, porque el segundo al
 * menos no parece estropeado.
 */
const enlace = () => {
  const base = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
  return base || null;
};

/**
 * Todo lo que hace falta para redactar cualquiera de los dos avisos.
 *
 * El Discord de quien la subió llega por subconsulta y no por JOIN, por lo
 * mismo que en el tablero: nada impide que dos cuentas apunten a la misma
 * ficha, y un JOIN devolvería la fila dos veces.
 *
 * @param {string} id
 */
async function datos(id) {
  const { rows } = await pool.query(
    `SELECT v.id, v.player_id AS "playerId", v.estado,
            v.duracion_ms AS "duracionMs",
            v.aviso_revision_en AS "avisoRevision",
            v.aviso_aprobada_en AS "avisoAprobada",
            w.name AS guerra, w.match_type AS tipo, w.started_at AS empezo,
            COALESCE(p.name, v.player_id) AS jugador,
            (SELECT u.discord_id FROM users u
              WHERE u.guild_id = w.guild_id AND u.player_id = v.player_id
                AND u.disabled = false AND u.discord_id IS NOT NULL
              ORDER BY u.created_at LIMIT 1) AS "discordId"
       FROM war_vods v
       JOIN wars w ON w.id = v.war_id
       LEFT JOIN players p ON p.guild_id = w.guild_id AND p.id = v.player_id
      WHERE v.id = $1 AND w.guild_id = $2`,
    [id, GUILD_ID],
  );
  return rows[0] ?? null;
}

/** La línea de contexto que llevan los dos avisos: qué guerra fue. */
const laGuerra = (d) =>
  [TIPOS[d.tipo] ?? d.tipo, cuando(d.empezo), duracion(d.duracionMs)]
    .filter(Boolean)
    .join(' · ');

/**
 * Quién puede publicar, con Discord vinculado.
 *
 * Por PERMISO y no por rango. El gremio puede mover la matriz -- para eso está
 * -- y una lista de rangos escrita aquí a mano se quedaría contestando por un
 * reparto que ya no es el suyo. Preguntando por `war.vod.approve` se avisa
 * exactamente a quien puede hacer algo con el aviso, hoy.
 *
 * Se consulta `role_permissions` en crudo, que sólo vale porque
 * `war.vod.approve` no está entre los permisos fijos de `LOCKED` que
 * `permissionsFor` añade por su cuenta. No generaliza a `users.manage`.
 *
 * @param {string | null} exceptoPlayerId A quien no hay que avisar: quien
 *   acaba de subirla ya sabe que la subió, y decírselo sólo lo convierte en
 *   ruido para el único que no lo necesita.
 */
async function quienesAprueban(exceptoPlayerId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT u.discord_id AS "discordId"
       FROM users u
       JOIN role_permissions rp ON rp.guild_id = u.guild_id AND rp.role = u.role
      WHERE u.guild_id = $1
        AND rp.permission = 'war.vod.approve'
        AND u.disabled = false
        AND u.discord_id IS NOT NULL
        AND (u.player_id IS NULL OR u.player_id IS DISTINCT FROM $2)`,
    [GUILD_ID, exceptoPlayerId],
  );
  return rows.map((r) => r.discordId);
}

/**
 * «Hay una grabación esperando a que la mires.»
 *
 * Se manda cuando queda LISTA, no cuando se termina de subir. Entre las dos
 * cosas hay un remux, y a veces un recodificado de media hora: avisar antes
 * mandaría a un oficial a mirar un vídeo que todavía no se puede reproducir,
 * que es la forma más rápida de que deje de hacer caso a estos avisos.
 *
 * @param {string} id
 */
export async function avisarRevision(id) {
  if (!botEnabled()) return { enviados: 0 };
  const d = await datos(id);
  if (!d || d.avisoRevision) return { enviados: 0 };

  const destinos = await quienesAprueban(d.playerId);
  if (!destinos.length) {
    // Se marca igual. Si nadie tiene Discord vinculado, reintentarlo en cada
    // repreparación no va a encontrar a nadie tampoco.
    await marcar(id, 'aviso_revision_en');
    return { enviados: 0 };
  }

  const donde = enlace();
  const embed = {
    color: LATON,
    title: 'Grabación por revisar',
    description: `**${d.jugador}** ha subido su grabación de **${d.guerra}**.`,
    fields: [{ name: 'La guerra', value: laGuerra(d), inline: false }],
    footer: { text: 'Nadie la ve hasta que alguien la publica.' },
  };
  if (donde) embed.url = donde;

  let enviados = 0;
  for (const discordId of destinos) {
    if (await sendDirectMessage(discordId, { embeds: [embed], allowed_mentions: { parse: [] } })) {
      enviados++;
    }
  }
  await marcar(id, 'aviso_revision_en');
  console.log(`[vods] aviso de revisión de ${id}: ${enviados}/${destinos.length}`);
  return { enviados };
}

/**
 * «Tu grabación ya está publicada, y gracias.»
 *
 * Las gracias no son adorno: subir 2 GB por una línea doméstica es un favor al
 * gremio que hasta ahora no tenía ni acuse de recibo. Quien la subía se
 * quedaba sin saber si había servido de algo.
 *
 * @param {string} id
 * @param {string | null} aprobadorId La cuenta que la publicó.
 */
export async function avisarAprobada(id, aprobadorId) {
  if (!botEnabled()) return { enviado: false };
  const d = await datos(id);
  if (!d || d.avisoAprobada) return { enviado: false };

  // Sin Discord vinculado no hay a dónde escribir. Se marca igual, para no
  // volver a intentarlo en cada pulsación de «Publicar».
  if (!d.discordId) {
    await marcar(id, 'aviso_aprobada_en');
    return { enviado: false };
  }

  const quien = await nombreDe(aprobadorId);
  const donde = enlace();
  const embed = {
    color: VERDE,
    title: 'Tu grabación está publicada',
    description: [
      `Tu grabación de **${d.guerra}** ya la puede ver el gremio.`,
      '',
      'Gracias por subirla: sin grabaciones no hay nada que repasar después de una guerra.',
    ].join('\n'),
    fields: [{ name: 'La guerra', value: laGuerra(d), inline: false }],
  };
  if (quien) embed.footer = { text: `La publicó ${quien}.` };
  if (donde) embed.url = donde;

  const enviado = await sendDirectMessage(d.discordId, {
    embeds: [embed],
    allowed_mentions: { parse: [] },
  });
  await marcar(id, 'aviso_aprobada_en');
  console.log(`[vods] gracias por ${id}: ${enviado ? 'entregado' : 'no se pudo entregar'}`);
  return { enviado };
}

/**
 * Cómo se llama quien publicó, para firmarlo.
 *
 * Su nombre del roster antes que el de la cuenta: en Discord se reconoce a la
 * gente por el personaje, no por el usuario con el que entra a la web.
 *
 * @param {string | null} userId
 */
async function nombreDe(userId) {
  if (!userId) return null;
  const { rows } = await pool.query(
    `SELECT COALESCE(p.name, u.username) AS nombre
       FROM users u
       LEFT JOIN players p ON p.guild_id = u.guild_id AND p.id = u.player_id
      WHERE u.id = $1 AND u.guild_id = $2`,
    [userId, GUILD_ID],
  );
  return rows[0]?.nombre ?? null;
}

/**
 * @param {string} id
 * @param {'aviso_revision_en' | 'aviso_aprobada_en'} columna
 */
async function marcar(id, columna) {
  // El nombre de columna se interpola, y sólo se puede porque no viene de
  // fuera: los dos valores posibles están escritos ahí arriba en el @param.
  await pool.query(`UPDATE war_vods SET ${columna} = now() WHERE id = $1`, [id]);
}

/**
 * Lanzar un aviso sin que pueda estropear lo que lo disparó.
 *
 * Envolver aquí y no en cada sitio que avisa: lo que llama a esto está en
 * mitad de un remux o de una petición que ya ha hecho su trabajo, y ninguna de
 * las dos cosas puede caerse porque Discord conteste mal.
 *
 * @param {Promise<unknown>} promesa
 */
export const sinRomperNada = (promesa) =>
  void Promise.resolve(promesa).catch((err) =>
    console.error('[vods] el aviso por privado falló:', err?.message ?? err),
  );
