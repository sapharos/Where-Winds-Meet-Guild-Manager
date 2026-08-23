import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MarcaDeReloj from './MarcaDeReloj';
import { enPalabras } from '../services/relojGuerra';

/**
 * El reproductor de las grabaciones de guerra. Ver docs/VODS.md.
 *
 * Propio y no el de fábrica del navegador por una razón concreta y no por
 * gusto: **los controles nativos no admiten marcas en la barra**, y las marcas
 * son la mitad de lo que se viene a hacer aquí. Revisar una guerra de 35
 * minutos sin poder saltar a «aquí cayó la puerta» es arrastrar a ciegas.
 *
 * Está escrito para que la fase 4 lo reutilice tal cual: el tiempo se lleva
 * dentro, pero todo lo que mueve el vídeo pasa por `saltarA`, así que un reloj
 * maestro de multistream sólo tendrá que llamarlo desde fuera en vez de que lo
 * llamen los botones.
 */

export interface Marca {
  id: string;
  /** Milisegundos desde que empezó la preparación. La misma referencia que offsetMs. */
  tMs: number;
  texto: string;
  hito: boolean;
  autor?: string | null;
  autorId?: string | null;
}

interface Props {
  src: string | null;
  /** Dónde cae el primer fotograma en tiempo de guerra. Sin esto no hay marcas. */
  offsetMs: number | null;
  marcas: Marca[];
  /** Null si esta persona no puede marcar. */
  onMarcar?: (tMs: number, texto: string, hito: boolean) => void;
  onBorrarMarca?: (id: string) => void;
  puedeBorrar?: (m: Marca) => boolean;
  /**
   * Corregir la sincronía de una grabación YA SUBIDA. Null si esta persona no
   * puede. Existe porque sin esto una grabación que subió antes de que hubiera
   * OCR --o a la que el OCR le falló-- se quedaba sin arreglo posible y fuera
   * del multistream para siempre.
   */
  onSincronizar?: (offsetMs: number) => void;
}

const HLSJS = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';

const mmss = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

const Reproductor: React.FC<Props> = ({
  src, offsetMs, marcas, onMarcar, onBorrarMarca, puedeBorrar, onSincronizar,
}) => {
  const video = useRef<HTMLVideoElement>(null);
  const caja = useRef<HTMLDivElement>(null);
  const [sonando, setSonando] = useState(false);
  const [posicion, setPosicion] = useState(0);
  const [duracion, setDuracion] = useState(0);
  const [silenciado, setSilenciado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [hito, setHito] = useState(false);
  const [escribiendo, setEscribiendo] = useState(false);
  const [ajustando, setAjustando] = useState(false);
  const [cargado, setCargado] = useState(0);

  // --- HLS ------------------------------------------------------------------
  useEffect(() => {
    const el = video.current;
    if (!el || !src) return;

    // Safari lo lleva de fábrica; el resto necesita hls.js, que se baja sólo al
    // abrir un vídeo y no en el paquete de todo el mundo.
    if (el.canPlayType('application/vnd.apple.mpegurl')) {
      el.src = src;
      return;
    }
    let hls: { destroy: () => void } | null = null;
    let vivo = true;
    (async () => {
      const w = window as unknown as { Hls?: any };
      if (!w.Hls) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement('script');
          s.src = HLSJS;
          s.onload = () => resolve();
          s.onerror = () => reject(new Error('No se pudo cargar el reproductor.'));
          document.head.appendChild(s);
        });
      }
      if (!vivo || !w.Hls?.isSupported()) return;
      const i = new w.Hls();
      hls = i;
      i.loadSource(src);
      i.attachMedia(el);
    })().catch((e) => setError(e.message));
    return () => {
      vivo = false;
      hls?.destroy();
    };
  }, [src]);

  // --- Movimiento -----------------------------------------------------------

  /** Todo lo que mueve el vídeo pasa por aquí. La fase 4 engancha justo aquí. */
  const saltarA = useCallback((segundo: number) => {
    const el = video.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(segundo, el.duration || segundo));
  }, []);

  const alternar = useCallback(() => {
    const el = video.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }, []);

  // --- Marcas ---------------------------------------------------------------

  /**
   * Las marcas viven en tiempo de guerra y el vídeo en tiempo de fichero, así
   * que hay que traducir en los dos sentidos. Sin `offsetMs` no se puede: no se
   * sabe dónde cae ninguna, y por eso una grabación sin sincronizar las esconde
   * en vez de pintarlas en un sitio inventado.
   */
  const aVideo = useCallback(
    (tMs: number) => (offsetMs === null ? null : (tMs - offsetMs) / 1000),
    [offsetMs],
  );
  const aGuerra = useCallback(
    (segundo: number) => (offsetMs === null ? null : Math.round(offsetMs + segundo * 1000)),
    [offsetMs],
  );

  /** Sólo las que caen dentro de esta grabación: el resto no tiene dónde ir. */
  const visibles = useMemo(() => {
    if (offsetMs === null || !duracion) return [];
    return marcas
      .map((m) => ({ marca: m, segundo: aVideo(m.tMs)! }))
      .filter((x) => x.segundo >= 0 && x.segundo <= duracion)
      .sort((a, b) => a.segundo - b.segundo);
  }, [marcas, offsetMs, duracion, aVideo]);

  const saltarMarca = useCallback(
    (direccion: 1 | -1) => {
      const el = video.current;
      if (!el || !visibles.length) return;
      // Se le pregunta al vídeo, NO al estado de React.
      //
      // `posicion` sólo se refresca con `timeupdate`, que llega cada ~250 ms.
      // Dos pulsaciones seguidas de «siguiente» leerían la misma posición vieja
      // y volverían las dos a la misma marca, con toda la pinta de que el botón
      // no funciona. El elemento sabe dónde está al instante.
      const ahora = el.currentTime;
      // Medio segundo de margen: sin él, «anterior» justo después de saltar a
      // una marca vuelve a la misma.
      const siguiente =
        direccion === 1
          ? visibles.find((x) => x.segundo > ahora + 0.5)
          : [...visibles].reverse().find((x) => x.segundo < ahora - 0.5);
      if (siguiente) saltarA(siguiente.segundo);
    },
    [visibles, saltarA],
  );

  // --- Teclado --------------------------------------------------------------
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      // Escribiendo una marca, el teclado es del campo de texto y no del vídeo.
      const donde = e.target as HTMLElement;
      if (donde?.tagName === 'INPUT' || donde?.tagName === 'TEXTAREA') return;

      const el = video.current;
      if (!el) return;
      const atajos: Record<string, () => void> = {
        ' ': alternar,
        k: alternar,
        ArrowLeft: () => saltarA(el.currentTime - 5),
        ArrowRight: () => saltarA(el.currentTime + 5),
        j: () => saltarA(el.currentTime - 10),
        l: () => saltarA(el.currentTime + 10),
        m: () => {
          el.muted = !el.muted;
          setSilenciado(el.muted);
        },
        n: () => saltarMarca(1),
        p: () => saltarMarca(-1),
        f: () => void caja.current?.requestFullscreen?.().catch(() => {}),
      };
      const hacer = atajos[e.key] ?? atajos[e.key.toLowerCase()];
      if (hacer) {
        e.preventDefault();
        hacer();
      }
    };
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, [alternar, saltarA, saltarMarca]);

  /**
   * La marca por la que se está pasando, para asomarla sobre el vídeo.
   *
   * Es lo que hace SoundCloud y es la mitad de la gracia: revisando una guerra
   * se mira el vídeo, no la barra, así que un comentario que sólo existe al
   * poner el ratón encima de un punto de 4 px no lo lee nadie.
   *
   * DERIVADO de la posición, sin temporizador. El primer intento fue un estado
   * con un `setTimeout` de seis segundos y estaba roto de una forma que no se
   * ve en una prueba a mano: la limpieza del efecto cancelaba el temporizador
   * en cada `timeupdate` --cuatro veces por segundo mientras reproduce-- y el
   * camino de salida temprana no lo volvía a armar, así que el comentario se
   * quedaba pegado en pantalla para siempre. Así no hay nada que cancelar, y
   * además se porta bien al retroceder.
   */
  const VENTANA_S = 6;
  const alPaso =
    visibles.find((x) => posicion >= x.segundo && posicion < x.segundo + VENTANA_S)?.marca ?? null;

  const enviarMarca = () => {
    // Igual que arriba: el instante lo dice el vídeo, no el estado.
    const t = aGuerra(video.current?.currentTime ?? posicion);
    if (t === null || !texto.trim() || !onMarcar) return;
    onMarcar(t, texto.trim(), hito);
    setTexto('');
    setHito(false);
    setEscribiendo(false);
  };

  const progreso = duracion ? (posicion / duracion) * 100 : 0;

  if (!src) return <p className="text-sm text-slate-400">Esta grabación ya no tiene vídeo.</p>;

  return (
    <div className="space-y-3">
      <div ref={caja} className="relative bg-black rounded-lg overflow-hidden group">
        <video
          ref={video}
          playsInline
          onClick={alternar}
          onPlay={() => setSonando(true)}
          onPause={() => setSonando(false)}
          onLoadedMetadata={(e) => setDuracion(e.currentTarget.duration)}
          onTimeUpdate={(e) => setPosicion(e.currentTarget.currentTime)}
          onProgress={(e) => {
            const b = e.currentTarget.buffered;
            setCargado(b.length ? b.end(b.length - 1) : 0);
          }}
          onError={() => setError('No se pudo reproducir el vídeo.')}
          className="w-full aspect-video cursor-pointer"
        />

        {/*
          Los controles: una pieza OPACA que flota sobre el vídeo, no un
          degradado encima.

          El degradado era lo que traía antes y no vale aquí: el metraje del
          juego es brillante, saturado y no para quieto, así que unos iconos
          semitransparentes sobre él desaparecen -- y desaparecen justo cuando
          hace falta mirarlos, que es durante una pelea. La regla de la casa ya
          lo decía para las fichas de miembro: la superficie es del tema y va
          opaca (docs/DIRECCION_VISUAL.md §2). Aquí es lo mismo con vídeo
          detrás en vez de color de usuario.
        */}
        <div className="absolute inset-x-2 bottom-2 rounded-md border border-slate-700 bg-slate-950/95 shadow-1 px-3 pt-2 pb-1.5">
          <Barra
            posicion={posicion}
            duracion={duracion}
            cargado={cargado}
            marcas={visibles}
            onSaltar={saltarA}
          />

          <div className="flex items-center gap-1 mt-1.5">
            <button
              type="button"
              onClick={alternar}
              aria-label={sonando ? 'Pausar' : 'Reproducir'}
              className="min-w-tap rounded text-slate-100 hover:bg-slate-800"
            >
              <i className={`fa-solid ${sonando ? 'fa-pause' : 'fa-play'} text-base`} aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => saltarMarca(-1)}
              disabled={!visibles.length}
              aria-label="Marca anterior"
              title="Marca anterior (P)"
              className="min-w-tap rounded text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-25"
            >
              <i className="fa-solid fa-backward-step" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => saltarMarca(1)}
              disabled={!visibles.length}
              aria-label="Marca siguiente"
              title="Marca siguiente (N)"
              className="min-w-tap rounded text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-25"
            >
              <i className="fa-solid fa-forward-step" aria-hidden="true" />
            </button>

            {/* Tabular para que los dígitos no bailen al pasar los segundos. */}
            <span className="text-xs text-slate-300 tabular-nums px-2">
              {mmss(posicion)}
              <span className="text-slate-600"> / {mmss(duracion)}</span>
            </span>

            <div className="flex-1" />

            {visibles.length > 0 && (
              <span className="hidden sm:inline text-[11px] text-slate-500 px-2">
                {visibles.length} {visibles.length === 1 ? 'marca' : 'marcas'}
              </span>
            )}

            <button
              type="button"
              onClick={() => {
                const el = video.current;
                if (!el) return;
                el.muted = !el.muted;
                setSilenciado(el.muted);
              }}
              aria-label={silenciado ? 'Quitar el silencio' : 'Silenciar'}
              className="min-w-tap rounded text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <i
                className={`fa-solid ${silenciado ? 'fa-volume-xmark' : 'fa-volume-high'}`}
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              onClick={() => void caja.current?.requestFullscreen?.().catch(() => {})}
              aria-label="Pantalla completa"
              title="Pantalla completa (F)"
              className="min-w-tap rounded text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <i className="fa-solid fa-expand" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/*
          La marca por la que se acaba de pasar, asomada arriba unos segundos.
          Sin esto un comentario sólo existe si alguien pasa el ratón por encima
          de un punto de 4 px, y revisando una guerra se mira el vídeo, no la
          barra.
        */}
        {alPaso && (
          <div className="absolute top-2 left-2 right-2 sm:right-auto sm:max-w-[70%] rounded-md border border-slate-700 bg-slate-950/95 shadow-1 px-3 py-2">
            <p className="text-xs text-slate-200">
              {alPaso.hito && (
                <i className="fa-solid fa-flag text-[9px] text-sky-400 mr-1.5" aria-hidden="true" />
              )}
              {alPaso.texto}
              {alPaso.autor && <span className="text-slate-500"> · {alPaso.autor}</span>}
            </p>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <p className="text-[11px] text-slate-600">
        Espacio reproduce · ← → 5 s · J L 10 s · N P entre marcas · M silencio · F pantalla completa
      </p>

      {/* --- Marcar este momento --- */}
      {onMarcar && offsetMs !== null && (
        escribiendo ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400 tabular-nums">{mmss(posicion)}</span>
            <input
              autoFocus
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') enviarMarca();
                if (e.key === 'Escape') setEscribiendo(false);
              }}
              maxLength={280}
              placeholder="Qué pasó aquí"
              className="flex-1 min-w-40 px-3 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-sm"
            />
            <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <input
                type="checkbox"
                checked={hito}
                onChange={(e) => setHito(e.target.checked)}
                className="tap-suelto"
              />
              Hito
            </label>
            <button
              type="button"
              onClick={enviarMarca}
              disabled={!texto.trim()}
              className="px-3 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-xs"
            >
              Marcar
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              video.current?.pause();
              setEscribiendo(true);
            }}
            className="px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs flex items-center gap-2"
          >
            <i className="fa-solid fa-flag" aria-hidden="true" />
            Marcar este momento ({mmss(posicion)})
          </button>
        )
      )}

      {/*
        La sincronía, y cómo arreglarla. No es un detalle escondido: sin ella no
        hay marcas ni multistream, así que cuando falta se dice y se ofrece el
        arreglo en el sitio, en vez de dejar a la grabación inservible.
      */}
      {offsetMs === null ? (
        <div className="rounded-lg border border-amber-900/60 bg-amber-950/20 p-3">
          <p className="text-[11px] text-amber-400 mb-2">
            Sin sincronizar: no se sabe a qué momento de la guerra corresponde, así que no
            puede llevar marcas ni entrar en un mosaico.
          </p>
          {onSincronizar ? (
            <MarcaDeReloj posicionS={posicion} onAplicar={onSincronizar} />
          ) : (
            <p className="text-[11px] text-slate-500">
              Alguien que pueda editar la guerra tiene que sincronizarla.
            </p>
          )}
        </div>
      ) : (
        onSincronizar && (
          <p className="text-[11px] text-slate-500">
            {enPalabras(offsetMs)}
            {' · '}
            <button
              type="button"
              onClick={() => setAjustando((v) => !v)}
              className="tap-suelto underline hover:text-slate-300"
            >
              {ajustando ? 'dejarlo' : 'corregir'}
            </button>
          </p>
        )
      )}

      {ajustando && onSincronizar && offsetMs !== null && (
        <div className="rounded-lg border border-slate-800 p-3">
          <MarcaDeReloj
            posicionS={posicion}
            onAplicar={(ms) => {
              onSincronizar(ms);
              setAjustando(false);
            }}
          />
        </div>
      )}

      {/* --- Lo marcado --- */}
      {visibles.length > 0 && (
        <ul className="space-y-1">
          {visibles.map(({ marca, segundo }) => (
            <li key={marca.id} className="flex items-baseline gap-2 group/marca">
              <button
                type="button"
                onClick={() => saltarA(segundo)}
                className="tap-suelto text-[11px] tabular-nums text-amber-400 hover:text-amber-300 shrink-0"
              >
                {mmss(segundo)}
              </button>
              {marca.hito && (
                <i className="fa-solid fa-flag text-[9px] text-sky-400 shrink-0" title="Hito" />
              )}
              <span className="text-xs text-slate-300 min-w-0">
                {marca.texto}
                {marca.autor && <span className="text-slate-600"> · {marca.autor}</span>}
              </span>
              {onBorrarMarca && puedeBorrar?.(marca) && (
                <button
                  type="button"
                  onClick={() => onBorrarMarca(marca.id)}
                  aria-label="Borrar esta marca"
                  className="tap-suelto ml-auto text-[11px] text-slate-600 hover:text-red-400 shrink-0"
                >
                  <i className="fa-solid fa-trash-can" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/**
 * La barra, con las marcas encima.
 *
 * Es la razón de tener reproductor propio: los controles nativos no admiten
 * marcas, y pintar dónde están los momentos que alguien señaló convierte media
 * hora de arrastrar a ciegas en una lectura de un vistazo.
 *
 * El modelo es el de SoundCloud: los comentarios viven **sobre la propia
 * barra**, no en una lista aparte que hay que cruzar mentalmente con el tiempo.
 * Cada punto se puede pulsar para ir, y al pasar por encima enseña lo que dice
 * -- porque un punto de 4 px sin texto no informa de nada.
 */
const Barra: React.FC<{
  posicion: number;
  duracion: number;
  cargado: number;
  marcas: { marca: Marca; segundo: number }[];
  onSaltar: (s: number) => void;
}> = ({ posicion, duracion, cargado, marcas, onSaltar }) => {
  const pista = useRef<HTMLDivElement>(null);
  const [encima, setEncima] = useState<number | null>(null);
  // El globo lleva SU posición además del texto: sin ella se pintaba encima de
  // la cabeza lectora y señalaba a un punto de la barra que no era el suyo.
  const [globo, setGlobo] = useState<{ texto: string; segundo: number } | null>(null);

  const pct = (s: number) => (duracion ? Math.min(100, (s / duracion) * 100) : 0);

  const desdeRaton = (clientX: number) => {
    const caja = pista.current?.getBoundingClientRect();
    if (!caja || !duracion) return null;
    return Math.max(0, Math.min(1, (clientX - caja.left) / caja.width)) * duracion;
  };

  return (
    <div className="relative">
      {/* La burbuja: la marca que se está señalando, o la hora del punto que se
          está mirando. Arriba y no abajo, que abajo está la barra de controles. */}
      {(globo || encima !== null) && (
        <div
          className="absolute -top-9 z-10 -translate-x-1/2 max-w-64 truncate rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 shadow-1 pointer-events-none"
          style={{ left: `${pct(globo ? globo.segundo : (encima ?? posicion))}%` }}
        >
          {globo ? globo.texto : mmss(encima ?? 0)}
        </div>
      )}

      <div
        ref={pista}
        role="slider"
        tabIndex={0}
        aria-label="Posición del vídeo"
        aria-valuenow={Math.round(posicion)}
        aria-valuemin={0}
        aria-valuemax={Math.round(duracion)}
        onClick={(e) => {
          const s = desdeRaton(e.clientX);
          if (s !== null) onSaltar(s);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') onSaltar(posicion - 5);
          if (e.key === 'ArrowRight') onSaltar(posicion + 5);
        }}
        onMouseMove={(e) => setEncima(desdeRaton(e.clientX))}
        onMouseLeave={() => setEncima(null)}
        // Alto generoso y no los 4 px de costumbre: con el dedo, una barra fina
        // se falla, y aquí se busca un instante concreto.
        className="tap-suelto group/pista relative h-5 flex items-center cursor-pointer"
      >
        <div className="h-1.5 w-full rounded-full bg-white/20 overflow-hidden">
          {/* Lo descargado, por detrás: sin esto, una pausa para cargar parece
              que el reproductor se colgó. */}
          <div className="absolute h-1.5 rounded-full bg-white/25" style={{ width: `${pct(cargado)}%` }} />
          <div className="relative h-full rounded-full bg-amber-500" style={{ width: `${pct(posicion)}%` }} />
        </div>

        {/* El tirador. Aparece al acercarse: en reposo la barra se lee mejor
            limpia, y al ir a arrastrar es cuando hace falta saber dónde agarrar. */}
        <div
          className="absolute h-3 w-3 -translate-x-1/2 rounded-full bg-amber-400 opacity-0 group-hover/pista:opacity-100 transition-opacity duration-micro"
          style={{ left: `${pct(posicion)}%` }}
        />

        {marcas.map(({ marca, segundo }) => (
          <button
            key={marca.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSaltar(segundo);
            }}
            onMouseEnter={() => setGlobo({ texto: `${mmss(segundo)} · ${marca.texto}`, segundo })}
            onMouseLeave={() => setGlobo(null)}
            onFocus={() => setGlobo({ texto: `${mmss(segundo)} · ${marca.texto}`, segundo })}
            onBlur={() => setGlobo(null)}
            aria-label={`Ir a ${mmss(segundo)}: ${marca.texto}`}
            style={{ left: `${pct(segundo)}%` }}
            /*
              El botón mide 20 px y el punto 10: el área de acierto es el doble
              de lo que se ve, que con el dedo es la diferencia entre dar y no
              dar.
              
              No llega a los 44 px de la casa, y es una excepción con motivo:
              en 375 px de ancho, cuatro marcas de 44 px se solapan y tapan la
              barra entera. Por eso lleva `tap-suelto` --la excepción declarada,
              no supuesta (docs/DIRECCION_VISUAL.md)-- y por eso hay dos
              caminos táctiles que sí miden: los botones de marca anterior y
              siguiente, y la lista de abajo. Fallar el punto tampoco es grave:
              la pista de debajo también salta, y deja cerca.
            */
            className="tap-suelto absolute h-5 w-5 -translate-x-1/2 flex items-center justify-center group/marca"
          >
            <span
              className={`h-2.5 w-2.5 rounded-full border border-slate-950 transition-transform duration-micro group-hover/marca:scale-150 ${
                marca.hito ? 'bg-sky-300' : 'bg-white'
              }`}
            />
          </button>
        ))}
      </div>
    </div>
  );
};

export default Reproductor;
