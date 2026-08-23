import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
}

const HLSJS = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';

const mmss = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

const Reproductor: React.FC<Props> = ({
  src, offsetMs, marcas, onMarcar, onBorrarMarca, puedeBorrar,
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
          onError={() => setError('No se pudo reproducir el vídeo.')}
          className="w-full aspect-video cursor-pointer"
        />

        {/* Los controles, encima del vídeo y siempre visibles en táctil: en un
            teléfono no hay hover, y esconderlos ahí los haría inalcanzables. */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent pt-8 px-3 pb-2">
          <Barra
            progreso={progreso}
            duracion={duracion}
            marcas={visibles}
            onSaltar={saltarA}
          />

          <div className="flex items-center gap-1 mt-1">
            <button
              type="button"
              onClick={alternar}
              aria-label={sonando ? 'Pausar' : 'Reproducir'}
              className="min-w-tap text-slate-100 hover:text-white"
            >
              <i className={`fa-solid ${sonando ? 'fa-pause' : 'fa-play'}`} aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => saltarMarca(-1)}
              disabled={!visibles.length}
              aria-label="Marca anterior"
              title="Marca anterior (P)"
              className="min-w-tap text-slate-300 hover:text-white disabled:opacity-30"
            >
              <i className="fa-solid fa-backward-step" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => saltarMarca(1)}
              disabled={!visibles.length}
              aria-label="Marca siguiente"
              title="Marca siguiente (N)"
              className="min-w-tap text-slate-300 hover:text-white disabled:opacity-30"
            >
              <i className="fa-solid fa-forward-step" aria-hidden="true" />
            </button>

            <span className="text-[11px] text-slate-300 tabular-nums px-2">
              {mmss(posicion)} / {mmss(duracion)}
            </span>

            <div className="flex-1" />

            <button
              type="button"
              onClick={() => {
                const el = video.current;
                if (!el) return;
                el.muted = !el.muted;
                setSilenciado(el.muted);
              }}
              aria-label={silenciado ? 'Quitar el silencio' : 'Silenciar'}
              className="min-w-tap text-slate-300 hover:text-white"
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
              className="min-w-tap text-slate-300 hover:text-white"
            >
              <i className="fa-solid fa-expand" aria-hidden="true" />
            </button>
          </div>
        </div>
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

      {onMarcar && offsetMs === null && (
        <p className="text-[11px] text-amber-400">
          Esta grabación no está sincronizada, así que no se puede saber a qué momento de la
          guerra corresponde lo que se marque.
        </p>
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
 * Es la razón de tener reproductor propio: pintar dónde están los momentos que
 * alguien señaló convierte media hora de arrastrar a ciegas en una lectura de
 * un vistazo.
 */
const Barra: React.FC<{
  progreso: number;
  duracion: number;
  marcas: { marca: Marca; segundo: number }[];
  onSaltar: (s: number) => void;
}> = ({ progreso, duracion, marcas, onSaltar }) => {
  const pista = useRef<HTMLDivElement>(null);

  const alPulsar = (e: React.MouseEvent) => {
    const caja = pista.current?.getBoundingClientRect();
    if (!caja || !duracion) return;
    onSaltar(((e.clientX - caja.left) / caja.width) * duracion);
  };

  return (
    <div
      ref={pista}
      onClick={alPulsar}
      role="slider"
      tabIndex={0}
      aria-label="Posición del vídeo"
      aria-valuenow={Math.round(progreso)}
      aria-valuemin={0}
      aria-valuemax={100}
      // Alto generoso y no los 4 px de costumbre: con el dedo, una barra fina
      // se falla, y aquí se busca un instante concreto.
      className="tap-suelto relative h-4 flex items-center cursor-pointer"
    >
      <div className="h-1.5 w-full rounded-full bg-white/25 overflow-hidden">
        <div className="h-full bg-amber-500" style={{ width: `${progreso}%` }} />
      </div>

      {marcas.map(({ marca, segundo }) => (
        <button
          key={marca.id}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSaltar(segundo);
          }}
          title={marca.texto}
          aria-label={`Ir a ${mmss(segundo)}: ${marca.texto}`}
          style={{ left: `${duracion ? (segundo / duracion) * 100 : 0}%` }}
          className={`tap-suelto absolute top-0 h-4 w-1 -translate-x-1/2 rounded-full ${
            marca.hito ? 'bg-sky-300' : 'bg-white/80'
          } hover:scale-x-[2.5] transition-transform duration-micro`}
        />
      ))}
    </div>
  );
};

export default Reproductor;
