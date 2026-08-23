import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MarcaDeReloj from './MarcaDeReloj';
import { enPalabras } from '../services/relojGuerra';
import { agrupar } from '../services/marcas';

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
  const [pantallaCompleta, setPantallaCompleta] = useState(false);
  const [mandosVisibles, setMandosVisibles] = useState(true);
  const ocultar = useRef<number | null>(null);

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

  useEffect(() => {
    const mirar = () => setPantallaCompleta(document.fullscreenElement === caja.current);
    document.addEventListener('fullscreenchange', mirar);
    return () => document.removeEventListener('fullscreenchange', mirar);
  }, []);

  const alternarPantalla = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void caja.current?.requestFullscreen?.().catch(() => {});
  }, []);

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

  // --- Los mandos se esconden solos ----------------------------------------

  /** Un comentario se escribe pausado, así que la tecla vale reproduciendo o no. */
  const puedeMarcar = Boolean(onMarcar) && offsetMs !== null;

  /**
   * Tres segundos sin mover el ratón y los controles se van.
   *
   * Nunca mientras esté PAUSADO ni mientras se esté ESCRIBIENDO una marca: en
   * los dos casos quien mira está haciendo algo con ellos, y esconderlos sería
   * quitarle la herramienta de las manos. Tampoco con el ratón encima.
   */
  const despertar = useCallback(() => {
    setMandosVisibles(true);
    if (ocultar.current) window.clearTimeout(ocultar.current);
    ocultar.current = window.setTimeout(() => {
      const el = video.current;
      if (!el || el.paused) return;
      setMandosVisibles(false);
    }, 3000);
  }, []);

  useEffect(() => {
    // Pausar o ponerse a escribir los trae de vuelta y los deja quietos.
    if (!sonando || escribiendo) {
      if (ocultar.current) window.clearTimeout(ocultar.current);
      setMandosVisibles(true);
      return;
    }
    despertar();
    return () => {
      if (ocultar.current) window.clearTimeout(ocultar.current);
    };
  }, [sonando, escribiendo, despertar]);

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
        // Comentar. Es lo que hace posible marcar sin salir de pantalla
        // completa: C, escribir, Enter.
        c: () => {
          if (!puedeMarcar) return;
          el.pause();
          setEscribiendo(true);
        },
        f: alternarPantalla,
      };
      const hacer = atajos[e.key] ?? atajos[e.key.toLowerCase()];
      if (hacer) {
        e.preventDefault();
        hacer();
      }
    };
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, [alternar, saltarA, saltarMarca, alternarPantalla, puedeMarcar]);

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
    /*
      En pantalla ancha, el vídeo a la izquierda y lo escrito a la derecha.
      
      Apilado, un 16:9 dejaba media pantalla vacía a los lados y la lista de
      marcas empujaba el vídeo hacia arriba; aquí lo que se viene a mirar es la
      imagen. La altura se topa en 70vh para que no haya que desplazarse para
      ver los controles, y el vídeo se ajusta dentro sin recortarse.
    */
    // La columna lateral sólo a partir de `xl`. En `lg` le quitaba 320 px al
    // vídeo y salía más pequeño que antes, que es lo contrario de lo que se
    // pedía: por debajo de eso, la anchura entera es para la imagen.
    <div className="xl:flex xl:items-start xl:gap-4">
      <div className="space-y-3 xl:flex-1 xl:min-w-0">
      <div
        ref={caja}
        onMouseMove={despertar}
        onTouchStart={despertar}
        className={`relative bg-black rounded-lg overflow-hidden group ${
          mandosVisibles ? '' : 'cursor-none'
        }`}
      >
        <video
          ref={video}
          playsInline
          onClick={() => {
            // Con los mandos escondidos, el primer toque sólo los trae de
            // vuelta. En un teléfono no hay ratón que mover, así que sin esto
            // el gesto de «quiero ver los controles» pausaría el vídeo -- y
            // quien mira acaba dando dos toques a ciegas cada vez.
            if (!mandosVisibles) {
              despertar();
              return;
            }
            alternar();
          }}
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
        <div
          // Al pasar el ratón por encima no se van: se está yendo a pulsarlos.
          onMouseEnter={() => setMandosVisibles(true)}
          className={`absolute inset-x-2 bottom-2 rounded-md border border-slate-700 bg-slate-950/95 shadow-1 px-3 pt-2 pb-1.5 transition-opacity duration-tap ${
            mandosVisibles ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/*
            Marcar, dentro del mismo panel que los mandos.

            Dentro y no flotando por encima, por dos razones. Una: el panel es
            lo que entra en pantalla completa, y antes el formulario vivía fuera
            del contenedor, así que a pantalla completa había que salir, marcar
            y volver a entrar -- o sea, no se marcaba. Y dos: flotándolo a una
            altura fija se solapaba con los mandos en un teléfono, donde el
            vídeo mide 192 px y el panel 86. Aquí no hay número que calcular.
          */}
          {puedeMarcar && escribiendo && (
            <div className="flex flex-wrap items-center gap-2 mb-2 pb-2 border-b border-slate-800">
              <span className="text-xs text-amber-400 tabular-nums">{mmss(posicion)}</span>
              <input
                autoFocus
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  // Se paran aquí: si subieran, la barra espaciadora de una
                  // frase pausaría el vídeo y la J escribiría un salto.
                  e.stopPropagation();
                  if (e.key === 'Enter') enviarMarca();
                  if (e.key === 'Escape') setEscribiendo(false);
                }}
                maxLength={280}
                placeholder="Qué pasó aquí"
                className="flex-1 min-w-32 px-3 rounded bg-slate-900 border border-slate-700 text-slate-100 text-sm"
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
                className="px-3 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-xs"
              >
                Marcar
              </button>
              <button
                type="button"
                onClick={() => setEscribiendo(false)}
                aria-label="Dejarlo"
                className="tap-suelto text-slate-500 hover:text-slate-300 text-xs px-1"
              >
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </div>
          )}

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

            {puedeMarcar && !escribiendo && (
              <button
                type="button"
                onClick={() => {
                  video.current?.pause();
                  setEscribiendo(true);
                }}
                aria-label="Marcar este momento"
                title="Marcar este momento (C)"
                className="min-w-tap rounded text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                <i className="fa-solid fa-flag" aria-hidden="true" />
              </button>
            )}

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
              onClick={alternarPantalla}
              aria-label={pantallaCompleta ? 'Salir de pantalla completa' : 'Pantalla completa'}
              title="Pantalla completa (F)"
              className="min-w-tap rounded text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <i
                className={`fa-solid ${pantallaCompleta ? 'fa-compress' : 'fa-expand'}`}
                aria-hidden="true"
              />
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
      </div>

      {/* La columna de al lado. En móvil vuelve a caer debajo, sin más. */}
      <aside className="space-y-3 mt-3 xl:mt-0 xl:w-72 xl:shrink-0">
      <p className="text-[11px] text-slate-600">
        Espacio reproduce · ← → 5 s · J L 10 s · N P entre marcas · C comentar · M silencio · F pantalla completa
      </p>

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
      </aside>
    </div>
  );
};

/**
 * La barra, con las marcas encima. *
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
  const [globo, setGlobo] = useState<{ texto: React.ReactNode; segundo: number } | null>(null);
  const [ancho, setAncho] = useState(0);

  // El ancho de la pista, para agrupar por solape real y no por una distancia
  // en segundos elegida a ojo. Se vigila porque cambia al girar el teléfono,
  // al entrar en pantalla completa y al arrastrar la ventana.
  useEffect(() => {
    const el = pista.current;
    if (!el) return;
    const medir = () => setAncho(el.getBoundingClientRect().width);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const grupos = useMemo(
    () => agrupar(marcas, duracion, ancho),
    [marcas, duracion, ancho],
  );

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
          // `bottom-full` y no `-top-9`: un racimo de cinco marcas es una
          // burbuja de cinco renglones, y con la altura fija los de arriba se
          // salían por encima de la barra.
          className="absolute bottom-full mb-2 z-10 -translate-x-1/2 w-max max-w-72 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 shadow-1 pointer-events-none"
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

        {grupos.map(({ centro, miembros }) => {
          const solo = miembros.length === 1 ? miembros[0].marca : null;
          const hayHito = miembros.some((m) => m.marca.hito);
          return (
            <button
              key={miembros[0].marca.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSaltar(centro);
              }}
              onMouseEnter={() =>
                setGlobo({
                  segundo: centro,
                  texto: solo ? (
                    `${mmss(centro)} · ${solo.texto}`
                  ) : (
                    // Apiladas y todas legibles. Antes, dos marcas juntas se
                    // pintaban una encima de otra y sólo se veía la última: las
                    // demás desaparecían sin decir que estaban.
                    <span className="block">
                      {miembros.map(({ marca, segundo }) => (
                        <span key={marca.id} className="block truncate">
                          <span className="text-amber-400 tabular-nums">{mmss(segundo)}</span>{' '}
                          {marca.texto}
                        </span>
                      ))}
                    </span>
                  ),
                })
              }
              onMouseLeave={() => setGlobo(null)}
              onFocus={() => setGlobo({ segundo: centro, texto: `${mmss(centro)} · ${miembros.length} marcas` })}
              onBlur={() => setGlobo(null)}
              aria-label={
                solo
                  ? `Ir a ${mmss(centro)}: ${solo.texto}`
                  : `Ir a ${mmss(centro)}: ${miembros.length} marcas juntas`
              }
              style={{ left: `${pct(centro)}%` }}
              /*
                El botón mide 20 px y el punto 10: el área de acierto es el
                doble de lo que se ve, que con el dedo es la diferencia entre
                dar y no dar.

                No llega a los 44 px de la casa, y es una excepción con motivo:
                en 375 px de ancho, cuatro marcas de 44 px se solapan y tapan la
                barra entera. Por eso lleva `tap-suelto` --la excepción
                declarada, no supuesta (docs/DIRECCION_VISUAL.md)-- y por eso
                hay dos caminos táctiles que sí miden: los botones de marca
                anterior y siguiente, y la lista de al lado. Fallar el punto
                tampoco es grave: la pista de debajo también salta, y deja
                cerca.
              */
              className="tap-suelto absolute h-5 w-5 -translate-x-1/2 flex items-center justify-center group/marca"
            >
              <span
                className={`flex items-center justify-center rounded-full border-2 border-slate-950 text-[8px] font-bold leading-none transition-transform duration-micro group-hover/marca:scale-150 ${
                  miembros.length > 1 ? 'h-3.5 w-3.5 text-slate-950' : 'h-3 w-3'
                } ${hayHito ? 'bg-sky-300' : 'bg-white'}`}
              >
                {/* El número dice que hay más de una. Sin él, un racimo de
                    cinco se lee como una sola marca. */}
                {miembros.length > 1 ? miembros.length : ''}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default Reproductor;
