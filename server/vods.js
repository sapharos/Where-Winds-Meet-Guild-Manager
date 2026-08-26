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
import { avisarAprobada, avisarRevision, sinRomperNada } from './vodAvisos.js';

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
      sincronia: { offsetMs: entero(meta.offsetMs), confianza: meta.offsetConfianza },
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
export async function registrarSubida({
  id, warId, playerId, nombreOriginal, bytes, recorte, sincronia,
}) {
  const expira = new Date(Date.now() + DIAS * 24 * 3600 * 1000);
  // La sincronía llega del navegador, que es donde se leyó el cronómetro del
  // juego. La confianza se valida contra el catálogo en vez de guardarse tal
  // cual: viene de fuera, y una etiqueta inventada haría que la interfaz
  // presentara como verificado algo que no lo está.
  const offset = Number.isInteger(sincronia?.offsetMs) ? sincronia.offsetMs : null;
  const confianza =
    offset !== null && CONFIANZAS.includes(sincronia?.confianza) ? sincronia.confianza : null;

  await pool.query(
    `INSERT INTO war_vods (id, war_id, player_id, estado, nombre_original, bytes,
                           recorte_ini_ms, recorte_fin_ms, offset_ms, offset_confianza,
                           expira_en)
     VALUES ($1, $2, $3, 'subiendo', $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO NOTHING`,
    [
      id, warId, playerId, nombreOriginal || null, bytes || null,
      recorte?.iniMs ?? null, recorte?.finMs ?? null, offset, confianza, expira,
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
/**
 * Lo que se está preparando ahora mismo.
 *
 * Existe para que «reintentar» no pueda encolar por segunda vez algo que sigue
 * vivo: quien mira la pantalla no puede distinguir un recodificado lento de un
 * trabajo muerto --de eso va todo este módulo-- así que va a darle al botón, y
 * sin esto se recodificaría el mismo fichero dos veces seguidas.
 */
let enCurso = null;

export function encolar(id) {
  if (id === enCurso || cola.includes(id)) return false;
  cola.push(id);
  arrancar();
  return true;
}

/** Si está en la cola o debajo del cabezal. Lo consulta el reintento. */
export const estaEnLaCola = (id) => id === enCurso || cola.includes(id);

async function arrancar() {
  if (trabajando) return;
  trabajando = true;
  try {
    while (cola.length) {
      const id = cola.shift();
      enCurso = id;
      try {
        await procesar(id);
      } catch (err) {
        // El motivo va a la fila y no sólo al log. Antes vivía únicamente en
        // `docker logs`, así que a quien había esperado veinte minutos a que
        // subieran sus 2 GB le llegaba «Falló al preparar» y nada más.
        console.error(`[vods] ${id} falló:`, err.message);
        await pool
          .query(
            `UPDATE war_vods
                SET estado = 'error', proceso_fase = NULL, proceso_latido = now(),
                    proceso_error = $2
              WHERE id = $1`,
            [id, String(err?.message ?? 'falló sin decir por qué').slice(0, ERROR_MAX)],
          )
          .catch((otro) => console.error(`[vods] ${id} ni se pudo anotar el fallo:`, otro.message));
      } finally {
        enCurso = null;
      }
    }
  } finally {
    trabajando = false;
  }
}

/** Lo que cabe de un mensaje de ffmpeg en la fila. Sobra: lo útil va al final. */
const ERROR_MAX = 600;

/**
 * Cada cuánto se anota el avance.
 *
 * ffmpeg informa cada segundo y eso son miles de UPDATE por vídeo, que es mucho
 * ruido para un número que se enseña con un sondeo de cinco segundos. Cada tres
 * basta para que la barra se mueva y para que el latido sirva de señal de vida.
 */
const LATIDO_MS = 3000;

/**
 * El lector del `-progress` de ffmpeg.
 *
 * Se lee `out_time` y no `out_time_ms` a propósito: pese al nombre, `out_time_ms`
 * viene en MICROsegundos en buena parte de las compilaciones -- un viejo desliz
 * de ffmpeg que nadie corrige ya por no romper a quien lo compensa. `out_time`
 * es `HH:MM:SS.ffffff` y no admite dos lecturas.
 *
 * El avance se mide sobre la SALIDA, que es lo que `out_time` cuenta: con `-ss`
 * antes de `-i`, ffmpeg pone su reloj a cero, así que el total contra el que se
 * divide es la duración recortada y no la del fichero entero.
 *
 * Los UPDATE van sueltos, sin esperarlos: si uno se pierde, lo único que pasa
 * es que la barra se queda quieta tres segundos. Llevan `proceso_fase` en el
 * WHERE para que un avance que llegue tarde no pise el 100 % de una fase que ya
 * terminó.
 */
function seguidor(id, fase, totalMs) {
  let ultimo = 0;
  return (linea) => {
    const m = /^out_time=(\d+):(\d\d):(\d\d(?:\.\d+)?)$/.exec(linea.trim());
    if (!m) return;
    const ahora = Date.now();
    if (ahora - ultimo < LATIDO_MS) return;
    ultimo = ahora;

    const ms = ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000;
    // Tope en 99: el 100 lo pone quien termina, para que una barra llena
    // signifique siempre «ya está» y no «ya casi».
    const pct = totalMs > 0 ? Math.max(0, Math.min(99, Math.round((ms / totalMs) * 100))) : null;
    void pool
      .query(
        `UPDATE war_vods SET proceso_pct = $3, proceso_latido = now()
          WHERE id = $1 AND proceso_fase = $2`,
        [id, fase, pct],
      )
      .catch(() => {});
  };
}

/**
 * ffmpeg/ffprobe, siempre cediendo el turno.
 *
 * Con `alLinea` la salida estándar se trocea en renglones y se tira según se
 * lee, en vez de acumularse: `-progress` escupe unas cuantas líneas por segundo
 * durante toda la codificación, y guardarlas sería juntar un megabyte de
 * telemetría para quedarse con un número. Sin `alLinea` se comporta como antes,
 * que es lo que necesita ffprobe para devolver su JSON de una pieza.
 */
const conNice = (programa, args, alLinea) =>
  new Promise((resolve, reject) => {
    const p = spawn('nice', ['-n', '15', programa, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let salida = '';
    let error = '';
    let resto = '';
    p.stdout.on('data', (d) => {
      if (!alLinea) {
        salida += d;
        return;
      }
      resto += d;
      const lineas = resto.split('\n');
      // El último trozo puede ser media línea: se guarda para el siguiente
      // pedazo en vez de interpretarse a medias.
      resto = lineas.pop() ?? '';
      for (const linea of lineas) alLinea(linea);
    });
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

const correr = (programa, args, alLinea) => corredor(programa, args, alLinea);

/** Lo que se le pide a ffmpeg para que cuente por dónde va. */
const PROGRESO = ['-progress', 'pipe:1', '-nostats'];

/**
 * Los formatos de píxel que un navegador sabe decodificar. No hay más.
 *
 * H.264 de 8 bits y croma 4:2:0, que es lo que exige el perfil que implementan
 * los navegadores. `yuvj420p` es el mismo con el rango de color completo, y
 * también vale.
 *
 * Esto existe porque `codec_name` MIENTE por omisión. Un vídeo de 10 bits
 * (`yuv420p10le`, el Hi10P que sueltan las capturadoras modernas por defecto) o
 * uno con croma 4:2:2 o 4:4:4 se llama «h264» igual que cualquier otro, y ffprobe
 * lo dice así. Se ve perfectamente en el ordenador de quien lo grabó --VLC y el
 * reproductor de Windows los decodifican sin pestañear-- y en un navegador no se
 * ve en absoluto: el audio suena y la imagen se queda clavada en uno de los
 * primeros fotogramas, porque el decodificador no puede con el primer cuadro y
 * la pista de sonido sigue su camino. Es exactamente ese síntoma.
 */
const PIX_NAVEGABLE = new Set(['yuv420p', 'yuvj420p']);

/**
 * Qué trae el fichero y qué se puede aprovechar tal cual.
 *
 * Las dos pistas se deciden por separado: quien graba en H.264 con audio Opus
 * --que pasa-- no tiene por qué pagar un recodificado de vídeo entero por una
 * pista de sonido, que se convierte en segundos.
 */
async function sondear(fichero) {
  const json = await correr('ffprobe', [
    '-v', 'error', '-print_format', 'json',
    '-show_entries', 'format=duration:stream=codec_type,codec_name,pix_fmt,profile',
    fichero,
  ]);
  const d = JSON.parse(json);
  const video = d.streams?.find((s) => s.codec_type === 'video');
  const audio = d.streams?.find((s) => s.codec_type === 'audio');
  return {
    duracionMs: Math.round(Number(d.format?.duration || 0) * 1000),
    pixFmt: video?.pix_fmt ?? null,
    perfil: video?.profile ?? null,
    // El camino barato existe sólo si ya viene en lo que HLS sabe llevar sin
    // tocar. Es lo que sueltan ShadowPlay, OBS, Steam, Medal y Game Bar por
    // defecto, así que es el caso normal y no la excepción -- pero el nombre
    // del códec no basta para decidirlo. Ver PIX_NAVEGABLE.
    copiarVideo: video?.codec_name === 'h264' && PIX_NAVEGABLE.has(video?.pix_fmt),
    copiarAudio: !audio || audio.codec_name === 'aac',
  };
}

/**
 * Recodificar a algo que se pueda ver en un navegador, pase lo que pase.
 *
 * `-pix_fmt yuv420p` es la línea que faltaba, y su ausencia era el fallo peor de
 * los dos: sin ella libx264 conserva el formato de la ENTRADA, así que el camino
 * de recodificado --el que existe precisamente para arreglar lo que no se puede
 * copiar-- convertía un HEVC de 10 bits en un H.264 de 10 bits, igual de
 * imposible de reproducir. Se pagaban veinte minutos de CPU para acabar en el
 * mismo sitio.
 *
 * `-fps_mode cfr` normaliza la tasa de fotogramas. Game Bar y algunas
 * configuraciones de OBS graban a tasa variable, y eso en HLS produce marcas de
 * tiempo que hacen que la imagen se atasque mientras el audio corre.
 */
const recodificar = (extra = []) => [
  '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
  '-profile:v', 'high', '-fps_mode', 'cfr', ...extra,
];

/**
 * El recorte, en dos mitades porque van a distinto lado de `-i`.
 *
 * `-ss` ANTES de la entrada: así ffmpeg salta hasta ahí en vez de leerse el
 * fichero entero, que con 2 GB es la diferencia entre segundos y minutos.
 *
 * Y el final se expresa como DURACIÓN (`-t`) y no como instante (`-to`). Con
 * `-ss` de entrada, ffmpeg pone a cero el reloj de la salida, así que un `-to`
 * no significa «hasta el segundo N del original» sino «N segundos de salida»:
 * pedir `-ss 5 -to 20` da veinte segundos, no quince. Se comprobó, y no se ve
 * hasta que alguien sube un vídeo de verdad.
 *
 * CAVEAT para la fase 3: copiando sin recodificar, `-ss` cae en el fotograma
 * clave más cercano, así que el corte real puede irse un par de segundos de lo
 * pedido. Da igual para ver el vídeo y NO da igual para `offset_ms`: cuando se
 * implemente la sincronía hay que medir el desplazamiento realmente aplicado
 * sobre la salida en vez de fiarse de `recorte_ini_ms`.
 */
const recorteArgs = (vod) => {
  const ini = vod.recorte_ini_ms > 0 ? vod.recorte_ini_ms : 0;
  const fin = vod.recorte_fin_ms > 0 ? vod.recorte_fin_ms : null;
  return {
    antes: ini ? ['-ss', (ini / 1000).toFixed(3)] : [],
    despues: fin && fin > ini ? ['-t', ((fin - ini) / 1000).toFixed(3)] : [],
  };
};

/**
 * ¿Lo que acaba de salir se puede reproducir de verdad?
 *
 * Se pregunta lo que un navegador necesita saber y no se fía de que ffmpeg
 * terminara con código 0: un remux puede acabar perfectamente y dejar un vídeo
 * que ningún navegador decodifica, que es justo el fallo que trajo esto aquí.
 *
 * Dos preguntas, y las dos baratas:
 *
 * 1. **El formato de píxel de la SALIDA.** Es la que descarta el 10 bits y los
 *    cromas 4:2:2 y 4:4:4, que es lo que deja la imagen congelada con el audio
 *    corriendo. No cuesta nada: ffprobe lo lee de la cabecera.
 * 2. **Que salgan fotogramas.** Se decodifican de verdad los primeros cuatro
 *    segundos. Un vídeo cuyos segmentos no empiezan en fotograma clave, o con
 *    marcas de tiempo rotas, pasa la primera prueba y falla ésta.
 *
 * Lanzar es lo correcto: lo recoge el `catch` de la cola, que escribe el motivo
 * en la fila y deja el original donde está para poder reintentar.
 */
async function comprobarSalida(destino, calidad) {
  const playlist = path.join(destino, `${calidad}.m3u8`);
  const json = await correr('ffprobe', [
    '-v', 'error', '-print_format', 'json',
    '-select_streams', 'v:0',
    // Sólo los primeros cuatro segundos: decodificar media hora para saber si
    // el decodificador arranca sería pagar el precio del recodificado otra vez.
    '-read_intervals', '%+4', '-count_frames',
    '-show_entries', 'stream=pix_fmt,profile,nb_read_frames',
    playlist,
  ]);

  const via = JSON.parse(json).streams?.[0];
  if (!via) throw new Error(`la copia en ${calidad} salió sin pista de vídeo`);

  if (!PIX_NAVEGABLE.has(via.pix_fmt)) {
    throw new Error(
      `la copia en ${calidad} quedó en ${via.pix_fmt ?? 'un formato desconocido'}` +
        `${via.profile ? ` (perfil ${via.profile})` : ''}, que ningún navegador sabe reproducir: ` +
        'se vería el audio corriendo y la imagen congelada. Hace falta 8 bits y croma 4:2:0.',
    );
  }

  if (!(Number(via.nb_read_frames) > 0)) {
    throw new Error(
      `la copia en ${calidad} no soltó ni un fotograma en los primeros cuatro segundos, ` +
        'así que la imagen no llegaría a arrancar.',
    );
  }
}

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
  await pool.query(
    `UPDATE war_vods
        SET estado = 'procesando', proceso_fase = 'origen', proceso_pct = 0,
            proceso_desde = now(), proceso_latido = now(), proceso_error = NULL
      WHERE id = $1`,
    [id],
  );

  const { duracionMs, copiarVideo, copiarAudio, pixFmt } = await sondear(origen);
  const corte = recorteArgs(vod);
  if (!copiarVideo) {
    console.log(`[vods] ${id}: se recodifica el vídeo (pix_fmt ${pixFmt ?? 'desconocido'})`);
  }

  // Lo que va a durar la SALIDA, que es contra lo que se mide el avance. Se
  // calcula antes de codificar y no después porque es el denominador del
  // porcentaje: sin él la barra no puede existir, aunque el vídeo salga igual.
  const util = (vod.recorte_fin_ms || duracionMs) - (vod.recorte_ini_ms || 0);

  // La calidad de origen. Copiando es cuestión de segundos; recodificando, de
  // minutos -- y no le pasa sólo a quien graba en HEVC, como se creía aquí: un
  // H.264 de 10 bits también hay que recodificarlo entero, aunque el códec sea
  // el bueno, porque el navegador no sabe decodificar esa profundidad.
  await correr(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y', ...PROGRESO,
      ...corte.antes, '-i', origen, ...corte.despues,
      ...(copiarVideo ? ['-c:v', 'copy'] : recodificar(['-crf', '23'])),
      ...(copiarAudio ? ['-c:a', 'copy'] : ['-c:a', 'aac']),
      ...hlsArgs(destino, 'origen'),
    ],
    seguidor(id, 'origen', util),
  );

  // Antes de decir que está lista, y antes de borrar el original.
  //
  // Nadie comprobaba nunca que lo producido se pudiera reproducir: se marcaba
  // «listo», se borraban los 2 GB de origen y el fallo lo encontraba un miembro
  // días después, con la única copia buena ya en la papelera. Lanzar aquí deja
  // la fila en `error` con el motivo escrito y --lo que importa-- CONSERVA el
  // fichero de entrada, así que se puede reintentar sin volver a subir nada.
  await comprobarSalida(destino, 'origen');

  // Reproducible ya, con una calidad. La de 360p llega después y no es motivo
  // para hacer esperar a nadie.
  await pool.query(
    `INSERT INTO war_vod_renditions (vod_id, calidad, ruta_playlist)
     VALUES ($1, 'origen', $2)
     ON CONFLICT (vod_id, calidad) DO UPDATE SET ruta_playlist = EXCLUDED.ruta_playlist`,
    [id, path.join(id, 'origen.m3u8')],
  );
  // Pasa a 'listo' y la fase pasa a '360p' en el mismo movimiento: el vídeo ya
  // se puede ver, pero el trabajo no ha terminado, y eran las dos cosas que se
  // confundían. Sin la fase, quien miraba veía «Esperando revisión» mientras la
  // máquina seguía media hora ocupada con los mosaicos.
  await pool.query(
    `UPDATE war_vods
        SET estado = 'listo', duracion_ms = $2, ruta = $3,
            proceso_fase = '360p', proceso_pct = 0, proceso_latido = now()
      WHERE id = $1`,
    [id, util, id],
  );

  // Aquí y no al terminar de subir: es AHORA cuando hay algo que mirar. Avisar
  // en el gancho `post-finish` mandaría a un oficial a abrir un vídeo que
  // todavía se está preparando, que es la forma más rápida de que deje de
  // hacerle caso a estos avisos. Sin esperarlo, porque la copia de 360p que
  // viene debajo no depende de que Discord conteste.
  sinRomperNada(avisarRevision(id));

  // La de 360p: la que usan los mosaicos del multistream, y la única que
  // sobreviviría si algún día se recorta la retención.
  await correr(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y', ...PROGRESO,
      ...corte.antes, '-i', origen, ...corte.despues,
      '-vf', 'scale=-2:360', ...recodificar(['-crf', '28']),
      '-c:a', 'aac', '-b:a', '64k',
      ...hlsArgs(destino, '360p'),
    ],
    seguidor(id, '360p', util),
  );
  // La de los mosaicos también se comprueba: se recodifica siempre, así que
  // arrastraba el mismo defecto de formato de píxel que la de origen -- y como
  // el vídeo ya se veía en calidad original, un 360p roto no se descubría hasta
  // que alguien intentaba montar un multistream.
  await comprobarSalida(destino, '360p');
  await pool.query(
    `INSERT INTO war_vod_renditions (vod_id, calidad, ruta_playlist)
     VALUES ($1, '360p', $2)
     ON CONFLICT (vod_id, calidad) DO UPDATE SET ruta_playlist = EXCLUDED.ruta_playlist`,
    [id, path.join(id, '360p.m3u8')],
  );

  // Nada en marcha: la fase vuelve a vacío y el 100 es de verdad. A partir de
  // aquí ya no hay a qué volver -- el original se borra abajo -- así que esto
  // es también lo que le dice al reintento que aquí no queda trabajo.
  await pool.query(
    `UPDATE war_vods SET proceso_fase = NULL, proceso_pct = 100, proceso_latido = now()
      WHERE id = $1`,
    [id],
  );

  // El original ya no hace falta: lo que se sirve son los segmentos, y son 2 GB.
  await rm(origen, { force: true });
  await rm(`${origen}.info`, { force: true });
}

// --- Lo que dejó a medias un reinicio ---------------------------------------

/**
 * Devuelve a la cola lo que se quedó a mitad, y se llama al arrancar.
 *
 * La cola vive en la memoria de este proceso, que es lo correcto para lo que
 * hace --de uno en uno, con `nice`, sin una tabla de trabajos ni un Redis para
 * cuatro vídeos a la semana-- y tiene un precio que hasta ahora no se pagaba:
 * al reiniciar la API, lo que estuviera preparándose desaparecía de la cola sin
 * desaparecer de la tabla. La fila se quedaba en `procesando` PARA SIEMPRE. La
 * barrida de abandonados no la tocaba --sólo mira `subiendo`-- y nadie la volvía
 * a encolar, así que en pantalla se leía «Preparando» hasta el fin de los
 * tiempos. Con los redespliegues que lleva esto, no era un caso raro.
 *
 * Se recogen también las que están en `subiendo`: la fila sólo nace en el
 * gancho `post-finish`, o sea que si existe, los bytes están enteros y lo único
 * que falta es el turno.
 *
 * Lo que ya no tiene fichero de origen no se puede rehacer, y decirlo es mejor
 * que dejarlo girando: pasa a `error` con el motivo escrito, que es accionable
 * -- «vuelve a subirla» -- mientras que «Preparando» no lo era.
 */
export async function recuperarPendientes() {
  if (!vodsHabilitados()) return { recuperados: 0, perdidos: 0 };
  const { rows } = await pool.query(
    `SELECT id FROM war_vods WHERE estado IN ('subiendo', 'procesando') ORDER BY subido_en`,
  );

  let recuperados = 0;
  let perdidos = 0;
  for (const { id } of rows) {
    if (await stat(path.join(ENTRADA, id)).catch(() => null)) {
      await pool.query(
        `UPDATE war_vods
            SET proceso_fase = 'cola', proceso_pct = NULL, proceso_error = NULL,
                proceso_latido = now()
          WHERE id = $1`,
        [id],
      );
      encolar(id);
      recuperados++;
    } else {
      await pool.query(
        `UPDATE war_vods
            SET estado = 'error', proceso_fase = NULL, proceso_latido = now(), proceso_error = $2
          WHERE id = $1`,
        [id, 'La preparación se interrumpió y el fichero de origen ya no está en el almacén. Hay que subir la grabación otra vez.'],
      );
      perdidos++;
    }
  }

  if (recuperados || perdidos) {
    console.log(`[vods] al arrancar: ${recuperados} de vuelta a la cola, ${perdidos} sin origen`);
  }
  return { recuperados, perdidos };
}

/**
 * Volver a intentarlo, a mano.
 *
 * La suya, quien la subió; la de otro, quien aprueba. Reintentar no publica
 * nada ni escribe en el acta --deja el fichero exactamente donde estaba-- así
 * que no hace falta un permiso propio para algo cuyo peor resultado es gastar
 * un rato de CPU.
 *
 * Se niega si sigue en la cola: quien mira la pantalla no puede distinguir un
 * recodificado lento de un trabajo muerto, así que va a darle al botón, y
 * encolar dos veces el mismo fichero sólo lo recodificaría dos veces.
 */
export async function reintentarVod(id, user, permisos = []) {
  if (!vodsHabilitados()) return { ok: false, codigo: 503, motivo: 'grabaciones desactivadas' };

  const { rows } = await pool.query(
    `SELECT v.player_id AS "playerId", v.estado
       FROM war_vods v JOIN wars w ON w.id = v.war_id
      WHERE v.id = $1 AND w.guild_id = $2`,
    [id, GUILD_ID],
  );
  const vod = rows[0];
  if (!vod) return { ok: false, codigo: 404, motivo: 'no such vod' };

  if (vod.playerId !== user?.playerId && !permisos.includes('war.vod.approve')) {
    return { ok: false, codigo: 403, motivo: 'sólo puedes reintentar tus propias grabaciones' };
  }
  if (!['error', 'procesando', 'subiendo'].includes(vod.estado)) {
    return { ok: false, codigo: 409, motivo: 'esa grabación no está pendiente de preparar' };
  }
  if (estaEnLaCola(id)) {
    return { ok: false, codigo: 409, motivo: 'ya está en la cola; sigue trabajando' };
  }
  if (!(await stat(path.join(ENTRADA, id)).catch(() => null))) {
    return { ok: false, codigo: 409, motivo: 'el fichero de origen ya no está; hay que subirla otra vez' };
  }

  await pool.query(
    `UPDATE war_vods
        SET estado = 'subiendo', proceso_fase = 'cola', proceso_pct = NULL,
            proceso_desde = NULL, proceso_latido = now(), proceso_error = NULL
      WHERE id = $1`,
    [id],
  );
  encolar(id);
  return { ok: true };
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

// --- Marcas -----------------------------------------------------------------

/**
 * Los momentos señalados de una guerra, en tiempo de guerra.
 *
 * No se filtran por grabación a propósito: quien está viendo el VOD de uno
 * quiere ver también lo que marcó el que jugaba en la otra línea. Es lo que
 * convierte cuatro revisiones sueltas en una sola lectura de la guerra.
 */
export async function marcasDeLaGuerra(warId) {
  const { rows } = await pool.query(
    `SELECT m.id, m.war_id AS "warId", m.vod_id AS "vodId", m.autor_id AS "autorId",
            m.t_ms AS "tMs", m.texto, m.hito, m.creada_en AS "creadaEn",
            u.username AS autor
       FROM war_marcas m
       JOIN wars w ON w.id = m.war_id
       LEFT JOIN users u ON u.id = m.autor_id
      WHERE m.war_id = $1 AND w.guild_id = $2
      ORDER BY m.t_ms`,
    [warId, GUILD_ID],
  );
  return rows;
}

const TEXTO_MAX = 280;

/**
 * Marcar un momento. El instante llega ya en tiempo de guerra: lo convierte
 * quien lo crea, que es el único que sabe desde qué grabación y con qué offset
 * estaba mirando.
 */
export async function crearMarca({ warId, vodId, autorId, tMs, texto, hito }) {
  if (!Number.isInteger(tMs)) return null;
  const limpio = String(texto ?? '').trim().slice(0, TEXTO_MAX);
  if (!limpio) return null;

  const { rows: guerra } = await pool.query(
    `SELECT 1 FROM wars WHERE id = $1 AND guild_id = $2`,
    [warId, GUILD_ID],
  );
  if (!guerra.length) return null;

  const id = `mrc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await pool.query(
    `INSERT INTO war_marcas (id, war_id, vod_id, autor_id, t_ms, texto, hito)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, warId, vodId || null, autorId || null, tMs, limpio, Boolean(hito)],
  );
  const { rows } = await pool.query(
    `SELECT m.id, m.war_id AS "warId", m.vod_id AS "vodId", m.autor_id AS "autorId",
            m.t_ms AS "tMs", m.texto, m.hito, m.creada_en AS "creadaEn",
            u.username AS autor
       FROM war_marcas m LEFT JOIN users u ON u.id = m.autor_id
      WHERE m.id = $1`,
    [id],
  );
  return rows[0];
}

/**
 * Borrar. La suya, cualquiera; la de otro, sólo quien edita la guerra.
 *
 * Se resuelve en una sola consulta en vez de leer y luego borrar: entre las dos
 * cabe que otro la borre, y entonces el borrado «ajeno» se aplicaría a una fila
 * que ya no es la que se comprobó.
 */
export async function borrarMarca(id, userId, puedeEditar) {
  const { rows } = await pool.query(
    `DELETE FROM war_marcas m
      USING wars w
      WHERE m.id = $1 AND w.id = m.war_id AND w.guild_id = $2
        AND ($3::boolean OR m.autor_id = $4)
      RETURNING m.id`,
    [id, GUILD_ID, Boolean(puedeEditar), userId || null],
  );
  return rows[0] ?? null;
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
            v.proceso_fase AS "procesoFase", v.proceso_pct AS "procesoPct",
            v.proceso_error AS "procesoError",
            -- Cuánto lleva y si sigue vivo, resueltos aquí y no en el navegador
            -- a propósito: el latido lo escribe el now() de Postgres, y restarlo
            -- del reloj del que mira convertiría un ordenador con la hora mal
            -- puesta en «todas tus grabaciones están colgadas». Las dos cuentas
            -- se hacen contra el mismo reloj que las escribió.
            CASE WHEN v.proceso_desde IS NOT NULL
                 THEN GREATEST(0, EXTRACT(EPOCH FROM (now() - v.proceso_desde))::int)
            END AS "procesoSegundos",
            -- Estar en la cola no es estar parado: es esperar turno detrás de
            -- otro, y ahí nadie late. Lo que sí es sospechoso es una fase en
            -- marcha cuyo último latido se quedó atrás -- ffmpeg informa cada
            -- segundo, así que si no informa es que ya no está.
            (v.proceso_fase IS DISTINCT FROM 'cola'
             AND (v.estado IN ('subiendo', 'procesando') OR v.proceso_fase IS NOT NULL)
             AND COALESCE(v.proceso_latido, v.subido_en) < now() - interval '2 minutes'
            ) AS "procesoParado",
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

/**
 * Los ficheros que un reproductor puede pedir de un VOD: la playlist de una
 * calidad y sus segmentos, y nada más.
 *
 * El nombre se valida con una lista blanca y no quitando `..`: el fichero llega
 * en la URL y termina en una ruta del sistema, así que aquí un descuido se lee
 * como «devuélveme /etc/passwd». Todo lo que genera la cola encaja en este
 * patrón, y lo que no encaje no existe.
 */
const FICHERO_HLS = /^(origen|360p)(-\d{5})?\.(m3u8|ts)$/;

export function tipoDeFichero(nombre) {
  if (!FICHERO_HLS.test(nombre)) return null;
  return nombre.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t';
}

/**
 * ¿Puede esta persona ver este VOD? Mismas reglas que el listado: lo aprobado
 * lo ve el gremio, lo suyo lo ve su dueño, y todo lo ve quien aprueba.
 *
 * Se comprueba en cada segmento y no sólo al abrir el reproductor. Suena
 * excesivo hasta que se piensa en el caso que importa: a quien se va del gremio
 * a mitad de la tarde se le corta la reproducción, en vez de seguir sirviéndole
 * la guerra entera porque ya tenía la playlist.
 */
export async function vodAccesible(id, user, permisos = []) {
  const { rows } = await pool.query(
    `SELECT v.id, v.ruta, v.estado, v.player_id AS "playerId"
       FROM war_vods v
       JOIN wars w ON w.id = v.war_id
      WHERE v.id = $1 AND w.guild_id = $2`,
    [id, GUILD_ID],
  );
  const vod = rows[0];
  // `ruta` nula es un VOD caducado: la fila sigue para contarlo, los bytes no.
  if (!vod || !vod.ruta) return null;
  if (vod.estado === 'aprobado') return vod;
  if (permisos.includes('war.vod.approve')) return vod;
  if (user?.playerId && vod.playerId === user.playerId) return vod;
  return null;
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
  } else {
    // Las gracias, por privado. Sólo al publicar: un rechazo se explica en
    // persona o no se explica, y un bot dando una mala noticia sin poder
    // decir por qué es peor que el silencio.
    sinRomperNada(avisarAprobada(id, userId));
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
