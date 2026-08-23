/**
 * Subida reanudable por el protocolo tus, a mano.
 *
 * A mano y no con `tus-js-client` porque este proyecto tiene tres
 * dependencias y las quiere seguir teniendo: lo que se usa de tus cabe en
 * cien líneas -- crear, mandar por trozos, preguntar por dónde iba -- y una
 * librería de 40 KB para eso no sale a cuenta.
 *
 * Lo que importa aquí es que **se pueda continuar**. Un VOD son 2 GB y quien
 * sube desde casa tarda diez minutos; que se corte el wifi, se cierre el
 * portátil o se recargue la página no puede significar empezar de cero. Por eso
 * la URL de la subida se guarda en localStorage contra una firma del fichero:
 * al volver a elegir el mismo, se pregunta por dónde iba y se sigue desde ahí.
 *
 * Se usa XHR y no fetch para el envío porque fetch no informa del progreso de
 * subida, y una barra parada diez minutos se lee como que se ha colgado.
 */

const BASE = '/vods-upload/';
const VERSION = '1.0.0';
/** Ocho megas: pocos viajes, y poco que repetir cuando uno falla. */
const TROZO = 8 * 1024 * 1024;
const REINTENTOS = 5;

export interface ProgresoSubida {
  enviados: number;
  total: number;
  /** Sólo cuando hay suficiente historia para que la cifra no baile. */
  bytesPorSegundo: number | null;
}

export interface OpcionesSubida {
  fichero: File;
  /** Van tal cual a los metadatos de tus, y de ahí al gancho de la API. */
  metadatos: Record<string, string>;
  alProgresar?: (p: ProgresoSubida) => void;
  señal?: AbortSignal;
}

/** Los metadatos de tus son `clave base64(valor)`, separados por comas. */
const cabeceraMetadatos = (meta: Record<string, string>) =>
  Object.entries(meta)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k} ${btoa(unescape(encodeURIComponent(String(v))))}`)
    .join(',');

/**
 * Identifica al fichero sin leerlo. Nombre, tamaño y fecha bastan: la
 * posibilidad de que dos grabaciones distintas coincidan en los tres es
 * despreciable, y la alternativa --resumir 2 GB para sacar un hash-- tardaría
 * más que volver a subirlo.
 */
const firma = (f: File, extra: string) => `tus:${extra}:${f.name}:${f.size}:${f.lastModified}`;

const recordar = (clave: string, url: string) => {
  try {
    localStorage.setItem(clave, url);
  } catch {
    // Modo privado o cuota llena: se pierde la reanudación, no la subida.
  }
};

const olvidar = (clave: string) => {
  try {
    localStorage.removeItem(clave);
  } catch {
    /* da igual */
  }
};

async function crear(fichero: File, metadatos: Record<string, string>): Promise<string> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: {
      'Tus-Resumable': VERSION,
      'Upload-Length': String(fichero.size),
      'Upload-Metadata': cabeceraMetadatos(metadatos),
    },
  });
  if (res.status === 413) throw new Error('El fichero pasa del tamaño permitido.');
  if (!res.ok) {
    // El servidor explica el rechazo en el cuerpo: «no consta que jugaras esa
    // guerra» vale mucho más que «error 403».
    throw new Error((await res.text()).trim() || `El servidor rechazó la subida (${res.status})`);
  }
  const url = res.headers.get('Location');
  if (!url) throw new Error('El servidor no dijo dónde subir.');

  // Sólo la ruta, descartando el esquema y el host que venga en `Location`.
  //
  // No es tiquismiquis: tusd construye esa URL a partir de las cabeceras
  // `X-Forwarded-*`, y en este despliegue el TLS termina en un proxy de
  // delante, así que el nginx de dentro ve `$scheme` = http y tusd acaba
  // diciendo `http://…`. Desde una página https el navegador bloquea eso como
  // contenido mixto y la subida muere justo después de crearse. Quedándonos con
  // la ruta y resolviéndola contra el origen actual, ninguna combinación de
  // proxies mal configurados puede mandarnos al sitio equivocado.
  const partes = new URL(url, location.href);
  return `${partes.pathname}${partes.search}`;
}

/** Por dónde iba. `null` si esa subida ya no existe y hay que empezar otra. */
async function desplazamiento(url: string): Promise<number | null> {
  const res = await fetch(url, { method: 'HEAD', headers: { 'Tus-Resumable': VERSION } });
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) throw new Error(`No se pudo comprobar la subida (${res.status})`);
  const n = Number(res.headers.get('Upload-Offset'));
  return Number.isFinite(n) ? n : null;
}

function mandarTrozo(
  url: string,
  trozo: Blob,
  desde: number,
  señal: AbortSignal | undefined,
  alSubir: (bytesDelTrozo: number) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PATCH', url, true);
    xhr.setRequestHeader('Tus-Resumable', VERSION);
    xhr.setRequestHeader('Upload-Offset', String(desde));
    xhr.setRequestHeader('Content-Type', 'application/offset+octet-stream');

    xhr.upload.onprogress = (e) => alSubir(e.loaded);
    xhr.onerror = () => reject(new Error('Se cortó la conexión.'));
    xhr.onabort = () => reject(new DOMException('cancelada', 'AbortError'));
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        return reject(new Error(`El servidor devolvió ${xhr.status}`));
      }
      const n = Number(xhr.getResponseHeader('Upload-Offset'));
      resolve(Number.isFinite(n) ? n : desde + trozo.size);
    };

    señal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(trozo);
  });
}

/**
 * Sube el fichero entero y devuelve el id con el que quedó guardado, que es el
 * último tramo de la URL de tus y también el id de la fila en `war_vods`.
 */
export async function subir({ fichero, metadatos, alProgresar, señal }: OpcionesSubida): Promise<string> {
  const clave = firma(fichero, metadatos.warId ?? '');
  let url = localStorage.getItem(clave) ?? null;
  let enviados = 0;

  if (url) {
    // Puede haber caducado o haberla barrido la limpieza; entonces, de cero.
    const donde = await desplazamiento(url).catch(() => null);
    if (donde === null) {
      olvidar(clave);
      url = null;
    } else {
      enviados = donde;
    }
  }

  if (!url) {
    url = await crear(fichero, metadatos);
    recordar(clave, url);
  }

  const arranque = Date.now();
  const arrancoEn = enviados;
  const avisar = (n: number) => {
    const transcurrido = (Date.now() - arranque) / 1000;
    alProgresar?.({
      enviados: n,
      total: fichero.size,
      // Sólo tras cinco segundos: antes de eso la cifra da saltos absurdos y
      // el «faltan 4 horas» de los primeros instantes asusta sin motivo.
      bytesPorSegundo: transcurrido > 5 ? (n - arrancoEn) / transcurrido : null,
    });
  };
  avisar(enviados);

  let fallos = 0;
  while (enviados < fichero.size) {
    señal?.throwIfAborted();
    const hasta = Math.min(enviados + TROZO, fichero.size);
    const base = enviados;
    try {
      enviados = await mandarTrozo(url, fichero.slice(base, hasta), base, señal, (n) => avisar(base + n));
      avisar(enviados);
      fallos = 0;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      if (++fallos > REINTENTOS) throw err;
      // Preguntar por dónde iba en vez de dar por hecho que el trozo no entró:
      // una respuesta perdida en el camino de vuelta ya lo había guardado, y
      // reenviarlo desde el sitio equivocado corrompe el fichero.
      await new Promise((r) => setTimeout(r, 1000 * fallos));
      let causa: unknown = null;
      const donde = await desplazamiento(url).catch((e) => {
        causa = e;
        return null;
      });
      if (donde === null) {
        // Con el motivo delante. Sin él, este mensaje decía «se perdió» y
        // dejaba a quien lo lee sin saber si fue la red, el proxy, el tamaño o
        // que la subida caducó -- que son arreglos distintos.
        const detalle = causa instanceof Error ? causa.message : (err as Error)?.message;
        throw new Error(`La subida se perdió y hay que empezarla de nuevo. Causa: ${detalle}`);
      }
      enviados = donde;
    }
  }

  olvidar(clave);
  return url.split('/').filter(Boolean).pop()!;
}

/** Para la interfaz: «1,8 GB», «340 MB». */
export const enBytes = (n: number) =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`;

/** Lo que falta, en palabras. Null mientras no se sepa. */
export const loQueFalta = (p: ProgresoSubida) => {
  if (!p.bytesPorSegundo || p.bytesPorSegundo <= 0) return null;
  const seg = Math.round((p.total - p.enviados) / p.bytesPorSegundo);
  if (seg < 60) return 'menos de un minuto';
  const min = Math.round(seg / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
};
