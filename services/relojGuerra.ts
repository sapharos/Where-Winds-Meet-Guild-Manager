/**
 * Leer el cronómetro del juego dentro de una grabación, en el navegador y
 * antes de subir nada. Ver docs/VODS.md §4.
 *
 * Es la única vía de sincronía que no depende del programa con el que se grabó:
 * lee el juego, no el fichero. ShadowPlay, OBS, Steam, Medal y Game Bar nombran
 * y etiquetan cada uno a su manera, pero el reloj de la guerra está en el mismo
 * sitio de la imagen para todos.
 *
 * ## El contrato
 *
 * `offsetMs` son los milisegundos entre **el comienzo de la preparación** y el
 * primer fotograma del vídeo. Negativo si empezó a grabar antes de que la
 * guerra arrancara --lo normal-- y positivo si le dio a grabar a mitad.
 *
 * La preparación cuenta 5:00 → 0:00 y la partida 30:00 → 0:00, así que el
 * tiempo de guerra de un fotograma es:
 *
 *     preparación:  300 - restante
 *     partida:      300 + (1800 - restante)
 *
 * y de ahí `offset = tiempoDeGuerra - posiciónEnElVídeo`.
 */

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

/** 5 minutos de preparación y 30 de partida. Gemelo de lo que sabe WarTimers. */
export const PREPARACION_S = 300;
export const PARTIDA_S = 1800;

export type Fase = 'preparacion' | 'partida';

export interface LecturaReloj {
  /** Lo que marcaba el reloj, en segundos restantes de su fase. */
  restante: number;
  fase: Fase;
  /** Dónde estaba el vídeo cuando se leyó. */
  posicionS: number;
}

/** Segundos de guerra desde que empezó la preparación. */
export const tiempoDeGuerra = (l: { restante: number; fase: Fase }) =>
  l.fase === 'preparacion'
    ? PREPARACION_S - l.restante
    : PREPARACION_S + (PARTIDA_S - l.restante);

/** El número que se guarda: dónde cae el primer fotograma del vídeo. */
export const offsetDesde = (l: LecturaReloj) =>
  Math.round((tiempoDeGuerra(l) - l.posicionS) * 1000);

// --- El motor ---------------------------------------------------------------

async function motor(): Promise<{ createWorker: (lang: string) => Promise<any> }> {
  const cargado = (window as unknown as { Tesseract?: unknown }).Tesseract;
  if (cargado) return cargado as { createWorker: (lang: string) => Promise<any> };
  await new Promise<void>((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = TESSERACT;
    tag.onload = () => resolve();
    tag.onerror = () => reject(new Error('No se pudo descargar el lector'));
    document.head.appendChild(tag);
  });
  return (window as unknown as { Tesseract: { createWorker: (lang: string) => Promise<any> } })
    .Tesseract;
}

// --- Fotogramas -------------------------------------------------------------

/** Coloca el vídeo en un instante y devuelve ese fotograma pintado. */
export function fotograma(video: HTMLVideoElement, segundo: number): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const listo = () => {
      video.removeEventListener('seeked', listo);
      const lienzo = document.createElement('canvas');
      lienzo.width = video.videoWidth;
      lienzo.height = video.videoHeight;
      lienzo.getContext('2d')!.drawImage(video, 0, 0);
      resolve(lienzo);
    };
    video.addEventListener('seeked', listo, { once: true });
    video.addEventListener('error', () => reject(new Error('No se pudo leer el vídeo')), { once: true });
    video.currentTime = segundo;
  });
}

/**
 * Las dos zonas que interesan, **en proporción del fotograma y no en píxeles**.
 *
 * En píxeles esto sólo funcionaría con quien grabe exactamente a 1920x1080. En
 * proporción aguanta 720p, 1440p y la mayoría de los ultrapanorámicos, que es
 * la diferencia entre que le sirva a todo el gremio o sólo a quien tenga el
 * mismo monitor que yo.
 *
 * Las bandas van holgadas a propósito: la lista blanca de caracteres se encarga
 * de tirar lo que sobre, y una banda estrecha que se sale por dos píxeles no
 * lee nada en absoluto.
 */
const ZONA_RELOJ = { x: 0.42, y: 0.12, ancho: 0.16, alto: 0.08 };
const ZONA_FASE = { x: 0.40, y: 0.185, ancho: 0.20, alto: 0.055 };

/**
 * Recorta y deja los dígitos legibles.
 *
 * El reloj es texto claro sobre una escena oscura y con movimiento, así que se
 * queda sólo con lo muy brillante y se tira el resto: el fondo de un combate
 * tiene más textura que la tabla de resultados, y sin este umbral tesseract
 * lee la escena en vez del número. Escalado x4 porque son cuatro caracteres y
 * el reconocedor trabaja mucho mejor con trazo grueso.
 */
function prepararZona(
  origen: HTMLCanvasElement,
  zona: { x: number; y: number; ancho: number; alto: number },
  umbral = 165,
): HTMLCanvasElement {
  const sx = Math.round(origen.width * zona.x);
  const sy = Math.round(origen.height * zona.y);
  const sw = Math.round(origen.width * zona.ancho);
  const sh = Math.round(origen.height * zona.alto);

  const escala = 4;
  const lienzo = document.createElement('canvas');
  lienzo.width = sw * escala;
  lienzo.height = sh * escala;
  const ctx = lienzo.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(origen, sx, sy, sw, sh, 0, 0, lienzo.width, lienzo.height);

  const marco = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
  const p = marco.data;
  for (let i = 0; i < p.length; i += 4) {
    const gris = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    // Negro sobre blanco, que es como mejor lee: lo brillante pasa a texto.
    const v = gris > umbral ? 0 : 255;
    p[i] = p[i + 1] = p[i + 2] = v;
    p[i + 3] = 255;
  }
  ctx.putImageData(marco, 0, 0);
  return lienzo;
}

// --- Lectura ----------------------------------------------------------------

const aSegundos = (texto: string): number | null => {
  const m = texto.match(/(\d{1,2})\s*[:.]\s*(\d{2})/);
  if (!m) return null;
  const min = Number(m[1]);
  const seg = Number(m[2]);
  if (seg > 59) return null;
  const total = min * 60 + seg;
  // Nada de la guerra pasa de 30:00. Un 47:13 es basura leída del fondo.
  return total > PARTIDA_S ? null : total;
};

/**
 * Un trabajador de tesseract configurado para dígitos y una sola línea.
 *
 * La lista blanca es la mitad del asunto: sin ella, «4:21» sobre una escena de
 * combate vuelve como «A:2I» o con letras del rótulo de al lado. Con ella el
 * problema pasa de reconocimiento general a elegir entre once símbolos.
 */
async function trabajadorDeDigitos() {
  const T = await motor();
  const w = await T.createWorker('eng');
  await w.setParameters({
    tessedit_char_whitelist: '0123456789:',
    // 7 = una sola línea de texto, que es exactamente lo que se le pasa.
    tessedit_pageseg_mode: '7',
  });
  return w;
}

async function leerReloj(trabajador: any, marco: HTMLCanvasElement): Promise<number | null> {
  // Dos umbrales antes de rendirse: cuánto brilla el reloj depende del fondo
  // que le toque detrás, y un mapa nevado no se parece a una plaza de noche.
  for (const umbral of [165, 120, 200]) {
    const { data } = await trabajador.recognize(prepararZona(marco, ZONA_RELOJ, umbral));
    const leido = aSegundos(String(data?.text ?? ''));
    if (leido !== null) return leido;
  }
  return null;
}

/**
 * ¿Preparación o partida?
 *
 * Hace falta porque las dos cuentan hacia atrás y **un mismo «4:21» aparece dos
 * veces en la misma guerra**, separado por media hora: dar por buena la
 * equivocada desplaza el vídeo treinta minutos, que es el peor error posible.
 *
 * El atajo primero: por encima de 5:00 sólo puede ser partida, porque la
 * preparación no llega ahí. Sólo por debajo hay que mirar el rótulo.
 */
async function leerFase(marco: HTMLCanvasElement, restante: number): Promise<Fase> {
  if (restante > PREPARACION_S) return 'partida';
  const T = await motor();
  const w = await T.createWorker('eng');
  try {
    const { data } = await w.recognize(prepararZona(marco, ZONA_FASE, 150));
    const texto = String(data?.text ?? '').toLowerCase();
    return /prep/.test(texto) ? 'preparacion' : 'partida';
  } finally {
    await w.terminate();
  }
}

export interface Sondeo {
  ok: boolean;
  lectura?: LecturaReloj;
  offsetMs?: number;
  /** Para enseñar por qué no se pudo, en vez de un «no se pudo» a secas. */
  motivo?: string;
}

/**
 * Lee el reloj y comprueba que lo ha leído bien.
 *
 * **La verificación es lo que hace esto fiable.** Se leen dos fotogramas
 * separados diez segundos y el cronómetro tiene que haber bajado exactamente
 * diez. Un OCR que se equivoca no se equivoca dos veces de forma consistente,
 * así que si los dos números encajan la lectura no es «probablemente correcta»,
 * está verificada — y si no encajan lo sabemos y se pregunta, en vez de subir
 * una sincronía falsa con cara de buena.
 *
 * Se intenta en varios puntos del vídeo porque el primero puede caer en una
 * pantalla de carga, en el corte entre preparación y partida, o en un momento
 * con el rótulo tapado por un efecto.
 */
export async function sondearReloj(
  video: HTMLVideoElement,
  alProgresar?: (texto: string) => void,
): Promise<Sondeo> {
  const duracion = video.duration;
  if (!Number.isFinite(duracion) || duracion < 15) {
    return { ok: false, motivo: 'El vídeo es demasiado corto para leer el reloj.' };
  }

  alProgresar?.('Descargando el lector…');
  let trabajador: any;
  try {
    trabajador = await trabajadorDeDigitos();
  } catch (err) {
    return { ok: false, motivo: err instanceof Error ? err.message : 'No se pudo cargar el lector' };
  }

  const SALTO = 10;
  const candidatos = [5, 45, 120, 300, Math.max(5, duracion / 2)].filter((s) => s + SALTO < duracion);

  try {
    for (const posicion of candidatos) {
      alProgresar?.(`Leyendo el cronómetro (minuto ${Math.round(posicion / 60)})…`);

      const primero = await leerReloj(trabajador, await fotograma(video, posicion));
      if (primero === null) continue;

      const segundo = await leerReloj(trabajador, await fotograma(video, posicion + SALTO));
      // Aquí está la comprobación. Diez segundos de vídeo son diez de reloj.
      if (segundo === null || primero - segundo !== SALTO) continue;

      const fase = await leerFase(await fotograma(video, posicion), primero);
      const lectura: LecturaReloj = { restante: primero, fase, posicionS: posicion };
      return { ok: true, lectura, offsetMs: offsetDesde(lectura) };
    }
    return {
      ok: false,
      motivo: 'No se pudo leer el cronómetro con seguridad. Márcalo a mano.',
    };
  } finally {
    await trabajador.terminate();
  }
}

// --- La comprobación cruzada del nombre -------------------------------------

/**
 * La hora que algunos programas dejan en el nombre del fichero.
 *
 * **Nunca como fuente única**, sólo para contrastar: ShadowPlay pone
 * `Juego 2026.08.22 - 19.58.46.03`, pero OBS lleva plantilla configurable, Game
 * Bar escribe la fecha en formato local con AM/PM y Medal usa el título que le
 * pusiera quien recortó el clip. Si esto y el OCR coinciden, la sincronía se
 * puede dar por buena sin preguntar nada.
 *
 * Es hora local de quien grabó, que es la misma zona del gremio.
 */
export function horaDelNombre(nombre: string): Date | null {
  const patrones: RegExp[] = [
    // ShadowPlay / NVIDIA App: 2026.08.22 - 19.58.46
    /(\d{4})[.\-](\d{2})[.\-](\d{2})\s*-\s*(\d{2})[.\-](\d{2})[.\-](\d{2})/,
    // OBS por defecto: 2026-08-22 19-58-46
    /(\d{4})-(\d{2})-(\d{2})[ _](\d{2})-(\d{2})-(\d{2})/,
  ];
  for (const patron of patrones) {
    const m = nombre.match(patron);
    if (!m) continue;
    const fecha = new Date(
      Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(m[4]), Number(m[5]), Number(m[6]),
    );
    if (!Number.isNaN(fecha.getTime())) return fecha;
  }
  return null;
}

/** Para escribirlo: `-4:41` es «cuatro minutos y pico antes de empezar». */
export const comoReloj = (ms: number) => {
  const signo = ms < 0 ? '-' : '';
  const total = Math.round(Math.abs(ms) / 1000);
  return `${signo}${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/** Lo que dirá la ficha del VOD: «empieza 4:41 antes de la guerra». */
export const enPalabras = (ms: number) =>
  ms < 0
    ? `empieza ${comoReloj(-ms)} antes de la preparación`
    : `empieza en el minuto ${comoReloj(ms)} de la guerra`;

// --- Mantener varios vídeos cuadrados ---------------------------------------

/** Más allá de esto la deriva se ve, y se corrige de golpe. */
export const SALTO_MS = 250;
/** Por debajo de esto no vale la pena tocar nada. */
export const QUIETO_MS = 40;

/**
 * Qué hacer con la deriva de un vídeo esclavo respecto al reloj maestro del
 * mosaico. Ver docs/VODS.md §5.
 *
 * Vive aquí y no en el componente porque es aritmética, no interfaz, y porque
 * un signo cambiado separaría los vídeos en vez de juntarlos -- despacio, y por
 * eso costaría verlo mirando. Aquí se puede probar.
 *
 * `derivaMs` positiva = ese vídeo va ADELANTADO respecto a donde debería.
 */
export function correccion(derivaMs: number): { saltar: boolean; velocidad: number } {
  if (Math.abs(derivaMs) > SALTO_MS) return { saltar: true, velocidad: 1 };
  if (Math.abs(derivaMs) > QUIETO_MS) {
    // Adelantado, frenar; atrasado, correr. Un 3 % no se oye ni se ve, y evita
    // el tirón, que es lo que hace que un mosaico bien cuadrado parezca roto.
    return { saltar: false, velocidad: derivaMs > 0 ? 0.97 : 1.03 };
  }
  return { saltar: false, velocidad: 1 };
}
