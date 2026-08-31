import React, { useEffect, useRef } from 'react';

/**
 * Un vídeo de YouTube que se deja mandar como si fuera un `<video>`.
 *
 * Existe porque hay grabaciones de guerra que viven en el canal de su dueño en
 * vez de en nuestro almacén, y el reproductor y el mosaico ya saben mover un
 * HTMLVideoElement: buscar, pausar, silenciar, preguntar la hora. YouTube sólo
 * se reproduce dentro de su iframe y sólo se maneja por su API, así que esto
 * envuelve el iframe y expone **la misma superficie** que un elemento de vídeo
 * -- la fachada de abajo --, y todo lo demás sigue funcionando sin saber de
 * dónde vienen los bytes.
 *
 * Dos diferencias honestas con un `<video>`, que quien lo use debe conocer:
 *
 * - **La velocidad no se ajusta fino.** YouTube sólo acepta peldaños (0.25,
 *   0.5, 1…), así que la corrección de deriva del ±3 % del mosaico no existe
 *   aquí: la fachada la ignora y la sincronía se mantiene sólo a saltos, cuando
 *   la deriva pasa del umbral. En la práctica es un salto cada varios minutos.
 * - **El iframe no recibe el ratón** (`pointer-events: none`) salvo que se pida
 *   `interactivo`. Sin eso, los clics del mosaico caerían dentro del iframe y
 *   la miniatura de la columna no se podría pulsar; y en el reproductor, sus
 *   controles pelearían con los nuestros, que son los que llevan las marcas.
 */

/**
 * Lo que el reproductor y el mosaico necesitan de una fuente de vídeo.
 *
 * Un HTMLVideoElement la cumple tal cual; la fachada de YouTube la imita. Es
 * la forma de que el mosaico corrija la deriva de una mezcla de ambos sin
 * preguntar de qué clase es cada uno.
 */
export interface FuenteVideo {
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  muted: boolean;
  playbackRate: number;
  play(): Promise<void>;
  pause(): void;
  /** Si su nodo sigue en el documento: el mosaico lo usa al intercambiar. */
  readonly isConnected: boolean;
}

const API = 'https://www.youtube.com/iframe_api';

/** PLAYING y BUFFERING cuentan como «andando», igual que un `<video>` que se
 *  atasca cargando no pasa a `paused`. */
const ANDANDO = new Set([1, 3]);

let apiCargando: Promise<any> | null = null;

/** La API del iframe, una sola vez por página. Se baja al abrir el primer
 *  vídeo de YouTube y no en el paquete de todo el mundo, igual que hls.js. */
function cargarApi(): Promise<any> {
  const w = window as unknown as { YT?: any; onYouTubeIframeAPIReady?: () => void };
  if (w.YT?.Player) return Promise.resolve(w.YT);
  if (apiCargando) return apiCargando;
  apiCargando = new Promise((resolve, reject) => {
    // La API avisa por un nombre global fijo; se conserva lo que hubiera.
    const previo = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      previo?.();
      resolve(w.YT);
    };
    const s = document.createElement('script');
    s.src = API;
    s.onerror = () => {
      apiCargando = null;
      reject(new Error('No se pudo cargar el reproductor de YouTube.'));
    };
    document.head.appendChild(s);
  });
  return apiCargando;
}

/** Lo que YouTube sabe decir de por qué no reproduce, en palabras de aquí. */
const ERRORES: Record<number, string> = {
  2: 'El enlace de YouTube no es válido.',
  5: 'El reproductor de YouTube falló al cargar el vídeo.',
  100: 'Ese vídeo ya no existe en YouTube o es privado.',
  101: 'El dueño del vídeo no permite verlo fuera de YouTube.',
  150: 'El dueño del vídeo no permite verlo fuera de YouTube.',
};

interface Props {
  videoId: string;
  className?: string;
  /**
   * Deja que YouTube reciba el ratón y enseñe sus propios controles. Sólo lo
   * usa la pantalla de traer el enlace, donde hay que poder buscar el momento
   * del cronómetro ANTES de que exista nuestra fila con sus mandos.
   */
  interactivo?: boolean;
  /** Recibe la fachada al quedar listo, y null al desmontar. */
  registrar?: (fuente: FuenteVideo | null) => void;
  /** El reproductor quedó listo (también si se recreó al reordenar el DOM). */
  onListo?: (fuente: FuenteVideo) => void;
  /** El pulso del tiempo, cada cuarto de segundo. Sustituye a `timeupdate`. */
  onTiempo?: (posicionS: number, duracionS: number, cargadoS: number) => void;
  /** Sustituye a los eventos `play`/`pause`. */
  onEstado?: (sonando: boolean) => void;
  onError?: (mensaje: string) => void;
}

const YouTubeVideo: React.FC<Props> = ({
  videoId, className, interactivo, registrar, onListo, onTiempo, onEstado, onError,
}) => {
  const caja = useRef<HTMLDivElement>(null);
  // Las llamadas viven en referencias para que el efecto de montar no dependa
  // de ellas: recrear el player porque el padre redefinió un callback tiraría
  // el vídeo entero por un render.
  const avisos = useRef({ registrar, onListo, onTiempo, onEstado, onError });
  avisos.current = { registrar, onListo, onTiempo, onEstado, onError };

  useEffect(() => {
    const contenedor = caja.current;
    if (!contenedor) return;

    // YT.Player SUSTITUYE el nodo que se le da por su iframe, así que se le
    // entrega un hijo de usar y tirar y la caja (con su clase y su tamaño)
    // queda intacta.
    const hueco = document.createElement('div');
    contenedor.appendChild(hueco);

    let player: any = null;
    let pulso: number | null = null;
    let ro: ResizeObserver | null = null;
    let vivo = true;

    void cargarApi()
      .then((YT) => {
        if (!vivo) return;
        player = new YT.Player(hueco, {
          videoId,
          playerVars: {
            // Sin controles propios salvo que se pidan: los nuestros llevan
            // las marcas, y dos barras de mandos sobre el mismo vídeo pelean.
            controls: interactivo ? 1 : 0,
            disablekb: interactivo ? 0 : 1,
            rel: 0,
            playsinline: 1,
            iv_load_policy: 3,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              if (!vivo) return;
              const iframe = player.getIframe() as HTMLIFrameElement;
              if (!interactivo) iframe.style.pointerEvents = 'none';

              /*
                YouTube se niega a reproducir en un lienzo menor de 200x200:
                el player se queda con la rueda girando para siempre, que es
                exactamente lo que pasaba en las miniaturas de la columna del
                mosaico (160x90 en el móvil). Así que el iframe se dibuja
                siempre a por lo menos ese mínimo y, cuando la caja es más
                pequeña, se encoge con `transform` para caber: YouTube mide la
                caja del elemento, no lo que ocupa en pantalla, y un transform
                no cambia lo primero.
              */
              const MINIMO = 200;
              iframe.style.position = 'absolute';
              iframe.style.top = '0';
              iframe.style.left = '0';
              iframe.style.transformOrigin = 'top left';
              const ajustar = () => {
                const w = contenedor.clientWidth;
                const h = contenedor.clientHeight;
                if (!w || !h) return;
                const factor = Math.max(1, MINIMO / w, MINIMO / h);
                iframe.style.width = `${Math.ceil(w * factor)}px`;
                iframe.style.height = `${Math.ceil(h * factor)}px`;
                iframe.style.transform = factor > 1 ? `scale(${1 / factor})` : '';
              };
              ajustar();
              // La caja cambia con la ventana, al girar el teléfono y al
              // pasar de la columna al hueco grande.
              ro = new ResizeObserver(ajustar);
              ro.observe(contenedor);

              const fuente: FuenteVideo = {
                get currentTime() {
                  return player.getCurrentTime?.() ?? 0;
                },
                set currentTime(s: number) {
                  // Sobre un vídeo todavía en «cued», seekTo arranca la
                  // reproducción por su cuenta -- así lo documenta YouTube. Un
                  // salto no es una orden de sonar: sin esta guarda, abrir un
                  // mosaico en pausa dejaba al de YouTube corriendo solo y a
                  // los demás persiguiéndolo a saltos.
                  const estado = player.getPlayerState?.();
                  player.seekTo?.(Math.max(0, s), true);
                  if (estado === 5 || estado === -1) player.pauseVideo?.();
                },
                get duration() {
                  return player.getDuration?.() ?? 0;
                },
                get paused() {
                  return !ANDANDO.has(player.getPlayerState?.());
                },
                get muted() {
                  return Boolean(player.isMuted?.());
                },
                set muted(v: boolean) {
                  if (v) player.mute?.();
                  else player.unMute?.();
                },
                get playbackRate() {
                  return player.getPlaybackRate?.() ?? 1;
                },
                set playbackRate(r: number) {
                  // Sólo el retorno a 1: los peldaños de YouTube no saben de la
                  // corrección fina del mosaico, y pedir 0.97 dejaría el vídeo
                  // a 0.75 -- peor que la deriva que venía a arreglar.
                  if (r === 1 && player.getPlaybackRate?.() !== 1) player.setPlaybackRate?.(1);
                },
                async play() {
                  player.playVideo?.();
                },
                pause() {
                  player.pauseVideo?.();
                },
                get isConnected() {
                  return iframe.isConnected;
                },
              };

              avisos.current.registrar?.(fuente);
              avisos.current.onListo?.(fuente);

              if (avisos.current.onTiempo) {
                pulso = window.setInterval(() => {
                  const dur = player.getDuration?.() ?? 0;
                  avisos.current.onTiempo?.(
                    player.getCurrentTime?.() ?? 0,
                    dur,
                    (player.getVideoLoadedFraction?.() ?? 0) * dur,
                  );
                }, 250);
              }
            },
            onStateChange: (e: { data: number }) => {
              avisos.current.onEstado?.(ANDANDO.has(e.data));
            },
            onError: (e: { data: number }) => {
              avisos.current.onError?.(
                ERRORES[e.data] ?? 'YouTube no pudo reproducir el vídeo.',
              );
            },
          },
        });
      })
      .catch((err) => avisos.current.onError?.(err.message));

    return () => {
      vivo = false;
      if (pulso !== null) window.clearInterval(pulso);
      ro?.disconnect();
      avisos.current.registrar?.(null);
      try {
        player?.destroy();
      } catch {
        // Un player a medio nacer no siempre se deja destruir; el iframe se va
        // igual con el contenedor.
      }
      hueco.remove();
    };
    // `interactivo` no cambia en vida de un mismo vídeo; sólo el id recrea.
  }, [videoId, interactivo]);

  // `overflow-hidden` por el redondeo del ajuste de tamaño mínimo: el iframe
  // sobredimensionado y encogido puede sobrar un píxel.
  return <div ref={caja} className={`relative overflow-hidden bg-black ${className ?? ''}`} />;
};

export default YouTubeVideo;
