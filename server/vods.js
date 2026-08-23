/**
 * Las grabaciones de guerra: recibirlas, comprobar quién las manda, dejarlas
 * reproducibles y borrarlas cuando caducan. Ver docs/VODS.md.
 *
 * Los bytes no están en la base de datos ni en este contenedor: viven en
 * `VODS_DIR`, que es el almacén del NAS montado. Aquí sólo se decide quién
 * puede escribir ahí y qué se hace con lo que llega.
 *
 * El reparto de trabajo con tusd es el de siempre en estas integraciones: él
 * sabe recibir un fichero de 2 GB por una línea que se corta, y no sabe nada de
 * gremios ni de guerras. Así que pregunta dos veces --antes de abrir la subida
 * y al cerrarla-- y las dos respuestas salen de aquí.
 *
 * El secreto viaja en la ruta del gancho y no en una cabecera porque tusd
 * reenvía las cabeceras *del cliente*, no las suyas: no hay forma de que ponga
 * una constante nuestra. La URL nunca sale de la red de Docker, y aun así
 * nginx tapa `/api/vods/hook` desde fuera. Sin secreto configurado no se puede
 * subir nada, igual que sin DISCORD_PUBLIC_KEY no hay comandos.
 */

import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pool, GUILD_ID } from './db.js';

const DIR = process.env.VODS_DIR || '/vods';
const ENTRADA = path.join(DIR, 'entrada');
const HLS = path.join(DIR, 'hls');

const SECRETO = process.env.VODS_HOOK_SECRET || '';
const MAX_BYTES = Number(process.env.VODS_MAX_BYTES) || 6 * 1024 ** 3;
const DIAS = Number(process.env.VODS_RETENTION_DAYS) || 90;

/** Vacío el secreto, la funcionalidad no existe. */
export const vodsHabilitados = () => Boolean(SECRETO);

/**
 * Validado aquí y no con una restricción en el esquema, igual que side, lane y
 * match_type: un estado nuevo no debería pedir una migración.
 *
 * subiendo -> procesando -> listo -> aprobado. `rechazado` lo pone una persona,
 * `error` lo pone ffmpeg, y `caducado` la barrida: la fila sigue ahí cuando ya
 * no están los bytes, que es lo que permite decir «hubo VOD» en vez de dar un
 * enlace roto.
 */
export const ESTADOS = [
  'subiendo', 'procesando', 'listo', 'aprobado', 'rechazado', 'error', 'caducado',
];

/** De dónde salió `offset_ms`. Null mientras nadie lo sepa. */
export const CONFIANZAS = ['ocr', 'nombre', 'manual'];

const esId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);

/**
 * Comparación en tiempo constante del secreto de la ruta. Es exagerado para
 * algo que sólo se llama desde la red interna, pero cuesta una línea y evita
 * tener que razonar sobre si alguien puede llegar hasta aquí.
 */
export function secretoValido(candidato) {
  if (!SECRETO || typeof candidato !== 'string') return false;
  const a = Buffer.from(candidato);
  const b = Buffer.from(SECRETO);
  return a.length === b.length && timingSafeEqual(a, b);
}

// --- El gancho de tusd ------------------------------------------------------

/**
 * Traduce lo que manda tusd a lo que entiende el resto del módulo, y su
 * respuesta a lo que espera tusd.
 *
 * `pre-create` es la puerta: se contesta antes de aceptar el primer byte, y de
 * paso se le dice con qué nombre guardar el fichero para que coincida con la
 * fila. `post-finish` es el aviso de que ya está entero.
 *
 * Los metadatos de tus son siempre cadenas, vengan como vengan del navegador.
 */
export async function manejarGancho(cuerpo, user, permisos) {
  const tipo = cuerpo?.Type;
  const subida = cuerpo?.Event?.Upload ?? {};
  const meta = subida.MetaData ?? {};
  const entero = (v) => (/^-?\d+$/.test(String(v ?? '')) ? Number(v) : null);

  if (tipo === 'pre-create') {
    const veredicto = await autorizarSubida({
      user,
      permisos,
      warId: meta.warId,
      playerId: meta.playerId || null,
      bytes: subida.Size,
    });
    if (!veredicto.ok) {
      return {
        RejectUpload: true,
        HTTPResponse: { StatusCode: veredicto.codigo, Body: veredicto.motivo },
      };
    }
    // Que el fichero en disco se llame como la fila ahorra una tabla de
    // correspondencias entre el id de tus y el nuestro.
    return { ChangeFileInfo: { ID: veredicto.id } };
  }

  if (tipo === 'post-finish') {
    const id = subida.ID;
    if (!esId(id)) return {};
    await registrarSubida({
      id,
      warId: meta.warId,
      playerId: meta.playerId || user?.playerId,
      nombreOriginal: meta.filename || meta.nombre || null,
      bytes: subida.Size ?? null,
      recorte: { iniMs: entero(meta.recorteIniMs), finMs: entero(meta.recorteFinMs) },
    });
    return {};
  }

  return {};
}

// --- Quién puede subir ------------------------------------------------------

/**
 * El permiso abre la puerta; esto es el portero. `war.vod.upload` lo tiene
 * hasta un miembro raso --el que graba es el que peleó-- así que lo que de
 * verdad limita es haber estado en esa guerra concreta.
 *
 * Se mira `war_participants` y no el despliegue actual porque el despliegue se
 * sigue editando después y la lista de participantes se congela al empezar: lo
 * que importa es quién peleó, no quién estaba previsto.
 */
export async function participoEnLaGuerra(playerId, warId) {
  if (!playerId || !warId) return false;
  const { rows } = await pool.query(
    `SELECT 1
       FROM war_participants wp
       JOIN wars w ON w.id = wp.war_id
      WHERE wp.war_id = $1 AND wp.player_id = $2 AND w.guild_id = $3`,
    [warId, playerId, GUILD_ID],
  );
  return rows.length > 0;
}

/**
 * La respuesta al gancho `pre-create`. Devuelve el id con el que se guardará el
 * fichero, o el motivo del rechazo.
 *
 * Se rechaza aquí y no al terminar porque rechazar después de que alguien haya
 * esperado nueve minutos a que suban 2 GB es una crueldad innecesaria: tusd
 * pregunta antes de aceptar el primer byte precisamente para esto.
 */
export async function autorizarSubida({ user, permisos = [], warId, playerId, bytes }) {
  if (!vodsHabilitados()) return { ok: false, codigo: 503, motivo: 'grabaciones desactivadas' };
  if (!user) return { ok: false, codigo: 401, motivo: 'sin sesión' };
  if (!permisos.includes('war.vod.upload')) {
    return { ok: false, codigo: 403, motivo: 'sin permiso para subir grabaciones' };
  }
  if (!esId(warId)) return { ok: false, codigo: 400, motivo: 'falta la guerra' };

  // Subir la grabación de otro es cosa de quien aprueba, no de cualquiera: si
  // no, un miembro podría colgarle a un compañero un vídeo que no es suyo.
  const dueño = playerId || user.playerId;
  if (!dueño) return { ok: false, codigo: 400, motivo: 'la cuenta no tiene ficha en el roster' };
  if (dueño !== user.playerId && !permisos.includes('war.vod.approve')) {
    return { ok: false, codigo: 403, motivo: 'sólo puedes subir tus propias grabaciones' };
  }

  if (!(await participoEnLaGuerra(dueño, warId))) {
    return { ok: false, codigo: 403, motivo: 'no consta que jugaras esa guerra' };
  }

  if (Number(bytes) > MAX_BYTES) {
    return { ok: false, codigo: 413, motivo: `el máximo son ${Math.round(MAX_BYTES / 1024 ** 3)} GiB` };
  }

  const id = `vod_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return { ok: true, id, playerId: dueño };
}

/**
 * La respuesta al gancho `post-finish`: el fichero ya está entero en disco.
 *
 * La fila nace aquí y no en `pre-create` para que una subida abandonada a
 * medias no deje un registro fantasma que alguien tenga que limpiar. Lo que se
 * abandona en `entrada/` lo recoge la barrida.
 */
export async function registrarSubida({ id, warId, playerId, nombreOriginal, bytes, recorte }) {
  const expira = new Date(Date.now() + DIAS * 24 * 3600 * 1000);
  await pool.query(
    `INSERT INTO war_vods (id, war_id, player_id, estado, nombre_original, bytes,
                           recorte_ini_ms, recorte_fin_ms, expira_en)
     VALUES ($1, $2, $3, 'subiendo', $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO NOTHING`,
    [
      id, warId, playerId, nombreOriginal || null, bytes || null,
      recorte?.iniMs ?? null, recorte?.finMs ?? null, expira,
    ],
  );
  encolar(id);
  return id;
}

// --- La cola ----------------------------------------------------------------

/**
 * De uno en uno, y con `nice`.
 *
 * Uno en uno porque el remux es de disco y dos a la vez sólo se estorban; y
 * `nice` en vez de un tope de CPU en el contenedor porque hay otros servicios
 * en este Proxmox: ceder el turno cuando alguien lo necesita es mejor que ir
 * frenado también cuando la máquina está ociosa.
 */
const cola = [];
let trabajando = false;

export function encolar(id) {
  if (!cola.includes(id)) cola.push(id);
  arrancar();
}

async function arrancar() {
  if (trabajando) return;
  trabajando = true;
  try {
    while (cola.length) {
      const id = cola.shift();
      try {
        await procesar(id);
      } catch (err) {
        console.error(`[vods] ${id} falló:`, err.message);
        await pool.query(`UPDATE war_vods SET estado = 'error' WHERE id = $1`, [id]);
      }
    }
  } finally {
    trabajando = false;
  }
}

/** ffmpeg/ffprobe, siempre cediendo el turno. */
const conNice = (programa, args) =>
  new Promise((resolve, reject) => {
    const p = spawn('nice', ['-n', '15', programa, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let salida = '';
    let error = '';
    p.stdout.on('data', (d) => (salida += d));
    p.stderr.on('data', (d) => (error += d));
    p.on('error', reject);
    p.on('close', (codigo) =>
      codigo === 0 ? resolve(salida) : reject(new Error(`${programa} salió ${codigo}: ${error.slice(-500)}`)),
    );
  });

/**
 * Costura para las pruebas: sustituyendo esto se puede correr la cola entera
 * --estados, filas de calidades, borrado del original-- sin tener ffmpeg
 * delante ni un vídeo de 2 GB que darle.
 */
let corredor = conNice;
export const usarCorredor = (fn) => { corredor = fn || conNice; };

const correr = (programa, args) => corredor(programa, args);

async function sondear(fichero) {
  const json = await correr('ffprobe', [
    '-v', 'error', '-print_format', 'json',
    '-show_entries', 'format=duration:stream=codec_type,codec_name',
    fichero,
  ]);
  const d = JSON.parse(json);
  const video = d.streams?.find((s) => s.codec_type === 'video');
  const audio = d.streams?.find((s) => s.codec_type === 'audio');
  return {
    duracionMs: Math.round(Number(d.format?.duration || 0) * 1000),
    // El camino barato existe sólo si ya viene en lo que HLS sabe llevar sin
    // tocar. Es lo que sueltan ShadowPlay, OBS, Steam, Medal y Game Bar por
    // defecto, así que es el caso normal y no la excepción.
    copiable: video?.codec_name === 'h264' && (!audio || audio.codec_name === 'aac'),
  };
}

/** Los cortes de `-ss`/`-to` van ANTES de `-i` para que ffmpeg salte en vez de leerlo todo. */
const recorteArgs = (vod) => {
  const args = [];
  if (vod.recorte_ini_ms > 0) args.push('-ss', (vod.recorte_ini_ms / 1000).toFixed(3));
  if (vod.recorte_fin_ms > 0) args.push('-to', (vod.recorte_fin_ms / 1000).toFixed(3));
  return args;
};

const hlsArgs = (destino, calidad) => [
  '-f', 'hls',
  '-hls_time', '6',
  '-hls_playlist_type', 'vod',
  '-hls_segment_filename', path.join(destino, `${calidad}-%05d.ts`),
  path.join(destino, `${calidad}.m3u8`),
];

async function procesar(id) {
  const { rows } = await pool.query(`SELECT * FROM war_vods WHERE id = $1`, [id]);
  const vod = rows[0];
  if (!vod) return;

  const origen = path.join(ENTRADA, id);
  const destino = path.join(HLS, id);
  await mkdir(destino, { recursive: true });
  await pool.query(`UPDATE war_vods SET estado = 'procesando' WHERE id = $1`, [id]);

  const { duracionMs, copiable } = await sondear(origen);
  const corte = recorteArgs(vod);

  // La calidad de origen. Copiando es cuestión de segundos; recodificando, de
  // minutos -- pero eso sólo le pasa a quien graba en HEVC.
  await correr('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    ...corte, '-i', origen,
    ...(copiable ? ['-c', 'copy'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac']),
    ...hlsArgs(destino, 'origen'),
  ]);

  const util = corte.length
    ? (vod.recorte_fin_ms || duracionMs) - (vod.recorte_ini_ms || 0)
    : duracionMs;

  // Reproducible ya, con una calidad. La de 360p llega después y no es motivo
  // para hacer esperar a nadie.
  await pool.query(
    `INSERT INTO war_vod_renditions (vod_id, calidad, ruta_playlist)
     VALUES ($1, 'origen', $2)
     ON CONFLICT (vod_id, calidad) DO UPDATE SET ruta_playlist = EXCLUDED.ruta_playlist`,
    [id, path.join(id, 'origen.m3u8')],
  );
  await pool.query(
    `UPDATE war_vods SET estado = 'listo', duracion_ms = $2, ruta = $3 WHERE id = $1`,
    [id, util, id],
  );

  // La de 360p: la que usan los mosaicos del multistream, y la única que
  // sobreviviría si algún día se recorta la retención.
  await correr('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    ...corte, '-i', origen,
    '-vf', 'scale=-2:360', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
    '-c:a', 'aac', '-b:a', '64k',
    ...hlsArgs(destino, '360p'),
  ]);
  await pool.query(
    `INSERT INTO war_vod_renditions (vod_id, calidad, ruta_playlist)
     VALUES ($1, '360p', $2)
     ON CONFLICT (vod_id, calidad) DO UPDATE SET ruta_playlist = EXCLUDED.ruta_playlist`,
    [id, path.join(id, '360p.m3u8')],
  );

  // El original ya no hace falta: lo que se sirve son los segmentos, y son 2 GB.
  await rm(origen, { force: true });
  await rm(`${origen}.info`, { force: true });
}

// --- Retención --------------------------------------------------------------

/**
 * Borra LOS BYTES de lo caducado, NO LA FILA.
 *
 * Las guerras son permanentes --el puntaje de impacto lee las de hace un año--
 * así que el acta tiene que poder decir «hubo VOD, caducó» en vez de dar un
 * enlace roto. Lo fijado no caduca nunca: es la válvula de escape para la
 * guerra que la gente recuerda.
 */
export async function barrerCaducados() {
  if (!vodsHabilitados()) return { borrados: 0 };
  const { rows } = await pool.query(
    `SELECT id FROM war_vods
      WHERE NOT fijado AND ruta IS NOT NULL AND expira_en < now()`,
  );
  for (const { id } of rows) {
    await rm(path.join(HLS, id), { recursive: true, force: true });
    await rm(path.join(ENTRADA, id), { force: true });
    await pool.query(`DELETE FROM war_vod_renditions WHERE vod_id = $1`, [id]);
    await pool.query(`UPDATE war_vods SET ruta = NULL, estado = 'caducado' WHERE id = $1`, [id]);
  }
  if (rows.length) console.log(`[vods] caducados ${rows.length}`);
  return { borrados: rows.length };
}

/**
 * Las dos barridas, cada seis horas. Sin secreto configurado no hace nada, así
 * que un despliegue sin grabaciones no paga ni una consulta.
 */
export function startVodSweeper() {
  if (!vodsHabilitados()) return;
  const correr = () =>
    Promise.all([barrerCaducados(), barrerAbandonados()]).catch((err) =>
      console.error('[vods] barrida falló:', err.message),
    );
  void correr();
  setInterval(correr, 6 * 3600 * 1000);
}

/**
 * Lo que se quedó a medias en `entrada/`: subidas que nadie terminó. tusd las
 * mantiene por si vuelven a continuarlas, pero pasada una semana son basura de
 * 2 GB cada una y aquí el disco no sobra.
 */
export async function barrerAbandonados() {
  if (!vodsHabilitados()) return { borrados: 0 };
  let borrados = 0;
  const limite = Date.now() - 7 * 24 * 3600 * 1000;
  const { rows } = await pool.query(
    `SELECT id FROM war_vods WHERE estado = 'subiendo' AND subido_en < now() - interval '7 days'`,
  );
  for (const { id } of rows) {
    const fichero = path.join(ENTRADA, id);
    const info = await stat(fichero).catch(() => null);
    if (info && info.mtimeMs > limite) continue;
    await rm(fichero, { force: true });
    await rm(`${fichero}.info`, { force: true });
    await pool.query(`DELETE FROM war_vods WHERE id = $1`, [id]);
    borrados++;
  }
  return { borrados };
}

// --- Consultas para la interfaz ---------------------------------------------

/** Lo de una guerra. Quien no puede aprobar sólo ve lo aprobado y lo suyo. */
export async function vodsDeLaGuerra(warId, user, permisos = []) {
  const puedeAprobar = permisos.includes('war.vod.approve');
  const { rows } = await pool.query(
    `SELECT v.id, v.war_id AS "warId", v.player_id AS "playerId", v.estado,
            v.duracion_ms AS "duracionMs", v.offset_ms AS "offsetMs",
            v.offset_confianza AS "offsetConfianza", v.fijado,
            v.expira_en AS "expiraEn", v.subido_en AS "subidoEn",
            COALESCE(
              (SELECT json_agg(json_build_object('calidad', r.calidad, 'playlist', r.ruta_playlist))
                 FROM war_vod_renditions r WHERE r.vod_id = v.id), '[]'::json
            ) AS calidades
       FROM war_vods v
       JOIN wars w ON w.id = v.war_id
      WHERE v.war_id = $1 AND w.guild_id = $2
        AND ($3::boolean OR v.estado = 'aprobado' OR v.player_id = $4)
      ORDER BY v.subido_en`,
    [warId, GUILD_ID, Boolean(puedeAprobar), user?.playerId || null],
  );
  return rows;
}

/** Aprobar o rechazar. Rechazar borra los bytes en el acto: ocupan y no valen. */
export async function resolverVod(id, aprobado, userId) {
  const estado = aprobado ? 'aprobado' : 'rechazado';
  const { rows } = await pool.query(
    `UPDATE war_vods SET estado = $2, aprobado_por = $3
      WHERE id = $1 AND estado IN ('listo', 'aprobado', 'rechazado')
      RETURNING id`,
    [id, estado, userId],
  );
  if (!rows.length) return null;
  if (!aprobado) {
    await rm(path.join(HLS, id), { recursive: true, force: true });
    await pool.query(`DELETE FROM war_vod_renditions WHERE vod_id = $1`, [id]);
    await pool.query(`UPDATE war_vods SET ruta = NULL WHERE id = $1`, [id]);
  }
  return { id, estado };
}

/** Fijar salva de la caducidad; soltar le devuelve una cuenta nueva desde hoy. */
export async function fijarVod(id, fijado) {
  const expira = fijado ? null : new Date(Date.now() + DIAS * 24 * 3600 * 1000);
  const { rows } = await pool.query(
    `UPDATE war_vods SET fijado = $2, expira_en = $3 WHERE id = $1 RETURNING id, fijado`,
    [id, Boolean(fijado), expira],
  );
  return rows[0] || null;
}

/** El offset y de dónde salió. Ver docs/VODS.md: negativo si grabó desde antes. */
export async function ajustarSincronia(id, offsetMs, confianza) {
  if (!Number.isInteger(offsetMs)) return null;
  const fuente = CONFIANZAS.includes(confianza) ? confianza : null;
  const { rows } = await pool.query(
    `UPDATE war_vods SET offset_ms = $2, offset_confianza = $3
      WHERE id = $1 RETURNING id, offset_ms AS "offsetMs", offset_confianza AS "offsetConfianza"`,
    [id, offsetMs, fuente],
  );
  return rows[0] || null;
}
