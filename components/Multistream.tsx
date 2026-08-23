import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sheet from './Sheet';
import { Marca } from './Reproductor';
import { SALTO_MS, correccion } from '../services/relojGuerra';

/**
 * Varias grabaciones de la misma guerra, a la vez y cuadradas. Ver docs/VODS.md §5.
 *
 * ## Cómo se mantienen juntas
 *
 * No se reproducen «a la vez» dándoles play y cruzando los dedos: dos vídeos
 * lanzados juntos se separan solos en cuestión de un minuto. Hay un **reloj
 * maestro** --el mosaico enfocado-- y el resto persigue su tiempo:
 *
 * - Deriva por encima de `SALTO_MS`: se corrige de un tirón, porque a esa
 *   distancia ya se ve y disimularla tardaría más que el salto.
 * - Deriva pequeña: se ajusta la velocidad un 3 % arriba o abajo hasta que
 *   alcanza. Es imperceptible y evita el tirón, que es lo que hace que el
 *   mosaico parezca roto aunque esté bien.
 *
 * Todo se lleva en **tiempo de guerra**, no en tiempo de fichero: cada
 * grabación empezó cuando quiso, y `offsetMs` es lo que las pone en la misma
 * regla. Una sin sincronizar no puede entrar, y por eso el corrector vive en el
 * reproductor de una sola.
 *
 * ## Y por qué un solo audio
 *
 * Cuatro audios a la vez no es información, es ruido -- y además los
 * navegadores no dejan autoreproducir con sonido. Suena el que tiene el foco, y
 * cambiar de foco cambia de oído.
 */

export interface VodEnMosaico {
  id: string;
  playerId: string;
  nombre: string;
  offsetMs: number;
  duracionMs: number;
  /** Playlist ya resuelta para cada calidad disponible. */
  fuentes: { calidad: string; url: string }[];
}

interface Props {
  vods: VodEnMosaico[];
  marcas: Marca[];
  onClose: () => void;
}

const HLSJS = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

async function cargarHls(): Promise<any> {
  const w = window as unknown as { Hls?: any };
  if (w.Hls) return w.Hls;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = HLSJS;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('No se pudo cargar el reproductor.'));
    document.head.appendChild(s);
  });
  return w.Hls;
}

const Multistream: React.FC<Props> = ({ vods, marcas, onClose }) => {
  const videos = useRef(new Map<string, HTMLVideoElement>());
  const [foco, setFoco] = useState(vods[0]?.id ?? '');
  const [sonando, setSonando] = useState(false);
  const [tGuerra, setTGuerra] = useState(0);
  const relojPuesto = useRef(false);

  /**
   * El reloj, en una referencia además de en el estado.
   *
   * El estado es para pintar; esta es para decidir. Lo de React sólo se refresca
   * al repintar, así que dos pulsaciones seguidas de «marca siguiente» leerían
   * las dos el mismo instante y saltarían las dos a la misma marca -- con toda
   * la pinta de que el botón está roto. Pasa igual recorriendo los hitos
   * deprisa, que es justo como se revisa una guerra.
   */
  const relojRef = useRef(0);
  const ponerReloj = useCallback((t: number) => {
    relojRef.current = t;
    setTGuerra(t);
  }, []);

  /**
   * El tramo que cubre el conjunto: del primero que empezó a grabar al último
   * que paró. La línea de tiempo es de la guerra, no de ningún vídeo, porque
   * ninguno la cubre entera.
   */
  const [desde, hasta] = useMemo(() => {
    if (!vods.length) return [0, 0];
    return [
      Math.min(...vods.map((v) => v.offsetMs)),
      Math.max(...vods.map((v) => v.offsetMs + v.duracionMs)),
    ];
  }, [vods]);

  // El reloj arranca al principio del tramo, no en cero: casi todos empiezan a
  // grabar antes de que la guerra arranque, así que `desde` es negativo y un
  // cero de partida caería fuera de la línea de tiempo.
  useEffect(() => {
    if (relojPuesto.current || !vods.length) return;
    relojPuesto.current = true;
    ponerReloj(desde);
  }, [desde, vods.length, ponerReloj]);

  const cubre = useCallback(
    (v: VodEnMosaico, t: number) => t >= v.offsetMs && t <= v.offsetMs + v.duracionMs,
    [],
  );

  // --- Enganchar cada fuente ------------------------------------------------
  useEffect(() => {
    const instancias: { destroy: () => void }[] = [];
    let vivo = true;

    vods.forEach(async (vod, at) => {
      const el = videos.current.get(vod.id);
      if (!el) return;
      // El enfocado a la mejor calidad; el resto a 360p. Cuatro mosaicos a
      // 1080p son ~30 Mbps por espectador y en los pequeños no se nota.
      const quiere = at === 0 ? 'origen' : '360p';
      const fuente = vod.fuentes.find((f) => f.calidad === quiere) ?? vod.fuentes[0];
      if (!fuente) return;

      if (el.canPlayType('application/vnd.apple.mpegurl')) {
        el.src = fuente.url;
        return;
      }
      const Hls = await cargarHls().catch(() => null);
      if (!vivo || !Hls?.isSupported()) return;
      const i = new Hls();
      i.loadSource(fuente.url);
      i.attachMedia(el);
      instancias.push(i);
    });

    return () => {
      vivo = false;
      instancias.forEach((i) => i.destroy());
    };
  }, [vods]);

  // --- Ir a un instante de la guerra ---------------------------------------
  const irA = useCallback(
    (t: number) => {
      const limitado = Math.max(desde, Math.min(t, hasta));
      ponerReloj(limitado);

      // Si quien manda no cubre el instante al que vamos, manda otro.
      //
      // El reloj maestro es el mosaico enfocado, y a un vídeo que no llega a
      // ese momento no se le puede preguntar la hora: se quedaria parado donde
      // estaba y devolveria el reloj de todos allí, con toda la pinta de que
      // el salto no ha funcionado. Nadie graba la guerra entera, asi que esto
      // pasa en cuanto alguien se mueve fuera del tramo del que esta oyendo.
      const actual = vods.find((v) => v.id === foco);
      if (!actual || !cubre(actual, limitado)) {
        const releva = vods.find((v) => cubre(v, limitado));
        if (releva) setFoco(releva.id);
      }

      vods.forEach((v) => {
        const el = videos.current.get(v.id);
        if (!el) return;
        if (cubre(v, limitado)) {
          el.currentTime = (limitado - v.offsetMs) / 1000;
        } else {
          // Fuera de su tramo no se le pide nada: dejarlo corriendo gastaría
          // ancho de banda para enseñar un fotograma que no toca.
          el.pause();
        }
      });
    },
    [vods, desde, hasta, cubre, foco, ponerReloj],
  );

  // --- El reloj maestro y la corrección de deriva --------------------------
  useEffect(() => {
    let vivo = true;
    let cuadro = 0;

    const tic = () => {
      if (!vivo) return;
      cuadro = requestAnimationFrame(tic);

      const maestro = videos.current.get(foco);
      const vodMaestro = vods.find((v) => v.id === foco);
      if (!maestro || !vodMaestro) return;

      // El vídeo sólo dicta la hora MIENTRAS ESTÁ REPRODUCIENDO.
      //
      // Leerla siempre parecía lo natural y es un error: si el maestro no puede
      // moverse --todavía cargando, la red atascada, el segmento sin bajar--
      // su posición se queda donde estaba, y publicarla cada fotograma deshace
      // el salto que acaba de pedir quien mira. Pulsas la línea de tiempo y no
      // pasa nada, sin ninguna pista de por qué.
      //
      // Parado, la autoridad es `tGuerra`, que es donde lo dejó quien manda.
      if (maestro.paused) return;

      const ahora = vodMaestro.offsetMs + maestro.currentTime * 1000;
      // Y fuera de su tramo su posición tampoco significa nada.
      if (!cubre(vodMaestro, ahora)) return;
      ponerReloj(ahora);

      for (const v of vods) {
        if (v.id === foco) continue;
        const el = videos.current.get(v.id);
        if (!el) continue;

        if (!cubre(v, ahora)) {
          if (!el.paused) el.pause();
          continue;
        }
        if (sonando && el.paused) void el.play().catch(() => {});

        const objetivo = (ahora - v.offsetMs) / 1000;
        const { saltar, velocidad } = correccion((el.currentTime - objetivo) * 1000);
        if (saltar) el.currentTime = objetivo;
        if (el.playbackRate !== velocidad) el.playbackRate = velocidad;
      }
    };

    cuadro = requestAnimationFrame(tic);
    return () => {
      vivo = false;
      cancelAnimationFrame(cuadro);
    };
  }, [foco, vods, sonando, cubre, ponerReloj]);

  // --- Sonar y parar --------------------------------------------------------
  const alternar = useCallback(() => {
    const siguiente = !sonando;
    setSonando(siguiente);
    vods.forEach((v) => {
      const el = videos.current.get(v.id);
      if (!el) return;
      if (!siguiente) return el.pause();
      if (cubre(v, relojRef.current)) void el.play().catch(() => {});
    });
  }, [sonando, vods, cubre]);

  // El audio sigue al foco. Se hace aquí y no al pulsar para que también valga
  // cuando el foco cambia por otra vía.
  useEffect(() => {
    vods.forEach((v) => {
      const el = videos.current.get(v.id);
      if (el) el.muted = v.id !== foco;
    });
  }, [foco, vods]);

  const ordenadas = useMemo(
    () => [...marcas].filter((m) => m.tMs >= desde && m.tMs <= hasta).sort((a, b) => a.tMs - b.tMs),
    [marcas, desde, hasta],
  );

  const saltarMarca = (dir: 1 | -1) => {
    const ahora = relojRef.current;
    const siguiente =
      dir === 1
        ? ordenadas.find((m) => m.tMs > ahora + 500)
        : [...ordenadas].reverse().find((m) => m.tMs < ahora - 500);
    if (siguiente) irA(siguiente.tMs);
  };

  // --- Teclado --------------------------------------------------------------
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      const donde = e.target as HTMLElement;
      if (donde?.tagName === 'INPUT' || donde?.tagName === 'TEXTAREA') return;
      const acciones: Record<string, () => void> = {
        ' ': alternar,
        k: alternar,
        ArrowLeft: () => irA(relojRef.current - 5000),
        ArrowRight: () => irA(relojRef.current + 5000),
        j: () => irA(relojRef.current - 10000),
        l: () => irA(relojRef.current + 10000),
        n: () => saltarMarca(1),
        p: () => saltarMarca(-1),
      };
      // 1..4 cambia de foco, que es lo que más se usa revisando: se sigue a uno
      // hasta que pasa algo y se salta al que lo vio de cerca.
      const numero = Number(e.key);
      if (numero >= 1 && numero <= vods.length) {
        e.preventDefault();
        setFoco(vods[numero - 1].id);
        return;
      }
      const hacer = acciones[e.key] ?? acciones[e.key.toLowerCase()];
      if (hacer) {
        e.preventDefault();
        hacer();
      }
    };
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  });

  const anchoTotal = hasta - desde || 1;
  const pct = (t: number) => ((t - desde) / anchoTotal) * 100;

  return (
    <Sheet
      title="Mosaico"
      subtitle={`${vods.length} grabaciones de la misma guerra, cuadradas`}
      size="video"
      onClose={onClose}
    >
      <div className="space-y-3">
        {/* Los mosaicos. Dos columnas desde sm: en un teléfono, cuatro vídeos
            uno al lado de otro no se ven, y apilados sí. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {vods.map((v, at) => {
            const dentro = cubre(v, tGuerra);
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setFoco(v.id)}
                aria-label={`Escuchar a ${v.nombre}`}
                className={`tap-suelto relative rounded-lg overflow-hidden bg-black text-left ${
                  v.id === foco ? 'ring-2 ring-amber-500' : 'ring-1 ring-slate-800'
                }`}
              >
                <video
                  ref={(el) => {
                    if (el) videos.current.set(v.id, el);
                    else videos.current.delete(v.id);
                  }}
                  playsInline
                  muted={v.id !== foco}
                  className={`w-full aspect-video ${dentro ? '' : 'opacity-20'}`}
                />
                <span className="absolute top-1 left-1 px-1.5 rounded bg-slate-950/85 text-[10px] text-slate-200">
                  {at + 1} · {v.nombre}
                  {v.id === foco && <span className="text-amber-400"> · sonando</span>}
                </span>
                {/* Nadie graba la guerra entera. Decirlo evita que un mosaico
                    en negro parezca un fallo. */}
                {!dentro && (
                  <span className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-400">
                    {tGuerra < v.offsetMs ? 'aún no grababa' : 'ya había parado'}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* --- La línea de tiempo, que es de la guerra y no de un vídeo --- */}
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2">
            <span className="tabular-nums">{mmss(tGuerra)} de guerra</span>
            <span>{ordenadas.length} marcas</span>
          </div>

          {/* Una franja por grabación: se ve de un vistazo quién cubre qué. */}
          <div className="space-y-1 mb-2">
            {vods.map((v) => (
              <div key={v.id} className="relative h-1.5 rounded-full bg-slate-800">
                <div
                  className={`absolute h-full rounded-full ${
                    v.id === foco ? 'bg-amber-500/70' : 'bg-slate-600'
                  }`}
                  style={{
                    left: `${pct(v.offsetMs)}%`,
                    width: `${(v.duracionMs / anchoTotal) * 100}%`,
                  }}
                />
              </div>
            ))}
          </div>

          <div
            role="slider"
            tabIndex={0}
            aria-label="Momento de la guerra"
            aria-valuenow={Math.round(tGuerra)}
            aria-valuemin={desde}
            aria-valuemax={hasta}
            onClick={(e) => {
              const caja = e.currentTarget.getBoundingClientRect();
              irA(desde + ((e.clientX - caja.left) / caja.width) * anchoTotal);
            }}
            className="tap-suelto relative h-4 flex items-center cursor-pointer"
          >
            <div className="h-1.5 w-full rounded-full bg-slate-900 overflow-hidden">
              <div className="h-full bg-amber-500" style={{ width: `${pct(tGuerra)}%` }} />
            </div>
            {ordenadas.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  irA(m.tMs);
                }}
                title={m.texto}
                aria-label={`Ir a ${mmss(m.tMs - desde)}: ${m.texto}`}
                style={{ left: `${pct(m.tMs)}%` }}
                className={`tap-suelto absolute top-0 h-4 w-1 -translate-x-1/2 rounded-full ${
                  m.hito ? 'bg-sky-600' : 'bg-slate-100'
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-1 mt-2">
            <button
              type="button"
              onClick={alternar}
              aria-label={sonando ? 'Pausar' : 'Reproducir'}
              className="min-w-tap text-slate-100"
            >
              <i className={`fa-solid ${sonando ? 'fa-pause' : 'fa-play'}`} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => saltarMarca(-1)}
              disabled={!ordenadas.length}
              aria-label="Marca anterior"
              className="min-w-tap text-slate-300 disabled:opacity-30"
            >
              <i className="fa-solid fa-backward-step" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => saltarMarca(1)}
              disabled={!ordenadas.length}
              aria-label="Marca siguiente"
              className="min-w-tap text-slate-300 disabled:opacity-30"
            >
              <i className="fa-solid fa-forward-step" aria-hidden="true" />
            </button>
            <span className="text-[11px] text-slate-500 ml-2">
              1-{vods.length} cambia de vista y de audio · N P entre marcas
            </span>
          </div>
        </div>

        {ordenadas.length > 0 && (
          <ul className="space-y-1">
            {ordenadas.map((m) => (
              <li key={m.id} className="flex items-baseline gap-2">
                <button
                  type="button"
                  onClick={() => irA(m.tMs)}
                  className="tap-suelto text-[11px] tabular-nums text-amber-400 hover:text-amber-300 shrink-0"
                >
                  {mmss(m.tMs - desde)}
                </button>
                {m.hito && <i className="fa-solid fa-flag text-[9px] text-sky-400 shrink-0" />}
                <span className="text-xs text-slate-300">
                  {m.texto}
                  {m.autor && <span className="text-slate-600"> · {m.autor}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
};

export default Multistream;
