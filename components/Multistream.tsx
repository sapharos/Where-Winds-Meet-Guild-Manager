import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sheet from './Sheet';
import { Marca } from './Reproductor';
import { SALTO_MS, comoReloj, correccion } from '../services/relojGuerra';

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
 * navegadores no dejan autoreproducir con sonido. Suena la que está en grande,
 * y ponerse a otra en grande cambia de oído.
 *
 * ## La disposición
 *
 * Una grande y una columna al lado, no una rejilla de iguales. Revisar una
 * guerra no es mirar cuatro vídeos a la vez: es mirar UNO y tener los otros a
 * mano para saltar cuando algo pasa fuera de cuadro. La rejilla repartía la
 * pantalla en partes iguales entre un vídeo que se mira y tres que se vigilan,
 * y así el que se mira quedaba a un cuarto del tamaño que podía tener.
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

/** Cuánto va de un tramo, que siempre es positivo. Para el reloj de guerra, que
 *  tiene signo, está `comoReloj`. */
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

/**
 * La barra de búsqueda de la GUERRA, con sus marcas.
 *
 * Una sola definición para los dos sitios donde aparece --sobre la grande y en
 * el bloque de abajo-- porque tienen que comportarse igual. Dos copias de esto
 * acabarían divergiendo en el reparto de las marcas o en el redondeo, y entonces
 * pulsar el mismo sitio en una y en otra llevaría a instantes distintos.
 *
 * De la guerra y no del fichero: cada grabación empezó cuando quiso, así que el
 * minuto 3 de una no es el minuto 3 de la de al lado. Aquí se pulsa un instante
 * de la guerra y se mueven todas.
 */
const BarraGuerra: React.FC<{
  desde: number;
  hasta: number;
  tGuerra: number;
  marcas: Marca[];
  irA: (t: number) => void;
  alto?: string;
}> = ({ desde, hasta, tGuerra, marcas, irA, alto = 'h-1.5' }) => {
  const ancho = hasta - desde || 1;
  const pct = (t: number) => ((t - desde) / ancho) * 100;
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Momento de la guerra"
      aria-valuenow={Math.round(tGuerra)}
      aria-valuemin={desde}
      aria-valuemax={hasta}
      onClick={(e) => {
        const caja = e.currentTarget.getBoundingClientRect();
        irA(desde + ((e.clientX - caja.left) / caja.width) * ancho);
      }}
      className="tap-suelto relative h-4 flex items-center cursor-pointer"
    >
      <div className={`${alto} w-full rounded-full bg-slate-900 overflow-hidden`}>
        <div className="h-full bg-amber-500" style={{ width: `${pct(tGuerra)}%` }} />
      </div>
      {marcas.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            irA(m.tMs);
          }}
          title={m.texto}
          aria-label={`Ir a ${comoReloj(m.tMs)}: ${m.texto}`}
          style={{ left: `${pct(m.tMs)}%` }}
          className={`tap-suelto absolute top-0 h-4 w-1 -translate-x-1/2 rounded-full ${
            m.hito ? 'bg-sky-600' : 'bg-slate-100'
          }`}
        />
      ))}
    </div>
  );
};

/**
 * Un vídeo del mosaico, grande o de la columna.
 *
 * Uno solo para las dos posiciones para que las dos se pinten igual, no para
 * conservar el nodo: al intercambiar, React **destruye y recrea** el `<video>`
 * que cambia de contenedor -- se comprobó marcando los nodos y mirando cuáles
 * sobreviven. Los de la columna que no se tocan sí se conservan, gracias a su
 * `key`; los dos que se intercambian, no.
 *
 * Da igual, y esa es la parte que importa: esos dos son justo los que cambian
 * de calidad, así que iban a volver a abrir su fuente de todas formas. Lo que
 * NO puede depender de que el nodo sobreviva es dónde se retoma, y por eso se
 * retoma contra el reloj de guerra y no contra el `currentTime` que tuviera el
 * elemento. Ver `volver()`.
 */
const MosaicoVideo: React.FC<{
  vod: VodEnMosaico;
  dentro: boolean;
  tGuerra: number;
  numero: number;
  /**
   * La que ocupa el hueco grande. Se ajusta a su caja por los dos lados, y por
   * eso ya no hace falta un caso aparte para la pantalla completa: entonces la
   * caja ES la pantalla, y el vídeo la llena sin que este componente se entere.
   */
  grande?: boolean;
  registrar: (id: string, el: HTMLVideoElement | null) => void;
}> = ({ vod, dentro, tGuerra, numero, grande, registrar }) => (
  <div
    className={`relative bg-black ${
      grande ? 'w-full h-full flex items-center justify-center' : 'overflow-hidden'
    }`}
  >
    <video
      ref={(el) => registrar(vod.id, el)}
      playsInline
      className={
        grande
          ? // Llena la caja y se ajusta dentro con `object-contain`, en vez de
            // llevar `aspect-video` propio: la caja puede no ser 16:9 --a
            // pantalla entera en un monitor 16:10 no lo es-- y una proporción
            // fija ahí desperdicia justo el hueco que se acaba de ganar.
            //
            // `w-full h-full` y no `max-w/max-h`: sin fuente cargada un
            // `<video>` no tiene tamaño propio y se queda en los 300x150 de
            // fábrica, así que el mosaico aparecía diminuto hasta que llegaba
            // el primer fotograma. La caja manda; el vídeo se acomoda.
            `w-full h-full object-contain ${dentro ? '' : 'opacity-20'}`
          : `w-full aspect-video ${dentro ? '' : 'opacity-20'}`
      }
    />
    <span className="absolute top-1 left-1 px-1.5 rounded bg-slate-950/85 text-[10px] text-slate-200 max-w-[90%] truncate">
      {numero} · {vod.nombre}
      {grande && <span className="text-amber-400"> · sonando</span>}
    </span>
    {/* Nadie graba la guerra entera. Decirlo evita que un mosaico en negro
        parezca un fallo. */}
    {!dentro && (
      <span className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-400">
        {tGuerra < vod.offsetMs ? 'aún no grababa' : 'ya había parado'}
      </span>
    )}
  </div>
);

const Multistream: React.FC<Props> = ({ vods, marcas, onClose }) => {
  const videos = useRef(new Map<string, HTMLVideoElement>());
  /**
   * La que ocupa el hueco grande: se ve a 1080p y es la que suena.
   *
   * Antes esto no existía y la calidad iba atada a la POSICIÓN en el array --
   * `at === 0` se llevaba el 1080p y el resto 360p, pasara lo que pasara con el
   * foco. O sea que pulsar otro mosaico cambiaba el audio y nada más: seguías
   * viendo en pequeño y borroso justo lo que acababas de decir que querías
   * mirar. Ahora la calidad sigue al hueco grande, que es lo que se esperaba.
   */
  const [principal, setPrincipal] = useState(vods[0]?.id ?? '');
  const [sonando, setSonando] = useState(false);
  // En referencia además de en estado: lo lee `volver()`, que corre desde un
  // oyente de `loadedmetadata` y por tanto fuera del renderizado que lo creo.
  const sonandoRef = useRef(false);
  const [tGuerra, setTGuerra] = useState(0);
  const relojPuesto = useRef(false);
  const [silenciado, setSilenciado] = useState(false);

  /**
   * La caja de la grande, que es lo que se pone a pantalla completa.
   *
   * La caja y no el `<video>` a pelo: el elemento solo se llevaría el navegador
   * sus propios mandos, y con ellos el derecho a buscar por su cuenta -- que en
   * un mosaico significa romper la sincronía de los otros cuatro. Poniendo la
   * caja, lo que llena la pantalla es el vídeo CON la barra de aquí, que mueve
   * el reloj de guerra y por tanto a todos a la vez.
   */
  const caja = useRef<HTMLDivElement>(null);
  const [pantallaCompleta, setPantallaCompleta] = useState(false);

  useEffect(() => {
    const mirar = () => setPantallaCompleta(document.fullscreenElement === caja.current);
    document.addEventListener('fullscreenchange', mirar);
    return () => document.removeEventListener('fullscreenchange', mirar);
  }, []);

  const alternarPantalla = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void caja.current?.requestFullscreen?.().catch(() => {});
  }, []);

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

  // --- Enganchar cada fuente, con la calidad que le toque ahora -------------

  /**
   * Qué calidad tiene enganchada cada vídeo ahora mismo, y con qué instancia.
   *
   * Hace falta recordarlo para poder cambiar SÓLO las dos que se intercambian.
   * Rehacerlo todo en cada cambio de principal volvería a bajar los primeros
   * segmentos de las cinco, y el mosaico entero se quedaría en negro durante un
   * par de segundos cada vez que alguien pulsa una miniatura.
   */
  const adjuntos = useRef(new Map<string, { calidad: string; hls: { destroy: () => void } | null }>());

  useEffect(() => {
    let vivo = true;

    // La grande a la mejor calidad; la columna a 360p. Seis mosaicos a 1080p
    // son ~30 Mbps por espectador y en los pequeños no se nota.
    const cambian = vods
      .map((vod) => {
        const el = videos.current.get(vod.id);
        const quiere = vod.id === principal ? 'origen' : '360p';
        const fuente = vod.fuentes.find((f) => f.calidad === quiere) ?? vod.fuentes[0];
        return { vod, el, fuente };
      })
      .filter(
        (x) => x.el && x.fuente && adjuntos.current.get(x.vod.id)?.calidad !== x.fuente.calidad,
      );

    /*
      Primero se sueltan TODAS las que cambian, y después se engancha.

      En una sola pasada hay una carambola que muerde: al intercambiar, React
      recicla el `<video>` de la que baja para la que sube. Si la que sube se
      enganchara antes de que la que baja soltara, el `destroy()` de la que baja
      --que sigue apuntando a ESE MISMO elemento-- le arrancaría la fuente
      recién puesta, y la grande se quedaría en negro. Dependía del orden en
      que estuvieran en la lista, que es la peor clase de fallo: funciona hasta
      que alguien elige las perspectivas al revés.
    */
    for (const { vod } of cambian) adjuntos.current.get(vod.id)?.hls?.destroy();

    void (async () => {
      for (const { vod, el, fuente } of cambian) {
        if (!el || !fuente) continue;

        /**
         * Retomar donde estaba el MOSAICO, no donde estaba el elemento.
         *
         * Cambiar de calidad es volver a abrir la fuente desde cero, y sin esto
         * el intercambio mandaría al recién ascendido al segundo cero de su
         * fichero -- que ni siquiera es el mismo instante de guerra que el
         * resto, así que el mosaico se rompería entero por haber querido ver a
         * alguien más grande.
         *
         * Y se lee del reloj de guerra en vez del `currentTime` anterior porque
         * ese elemento puede no existir ya: React recrea el `<video>` que pasa
         * de la columna al hueco grande, así que su posición anterior es cero y
         * copiarla mandaría a todo el mundo al principio. El reloj sobrevive al
         * intercambio; el nodo no.
         */
        const volver = () => {
          if (!cubre(vod, relojRef.current)) return;
          el.currentTime = (relojRef.current - vod.offsetMs) / 1000;
          if (sonandoRef.current) void el.play().catch(() => {});
        };

        if (el.canPlayType('application/vnd.apple.mpegurl')) {
          el.src = fuente.url;
          adjuntos.current.set(vod.id, { calidad: fuente.calidad, hls: null });
          el.addEventListener('loadedmetadata', volver, { once: true });
          continue;
        }
        const Hls = await cargarHls().catch(() => null);
        if (!vivo || !Hls?.isSupported()) continue;
        const i = new Hls();
        i.loadSource(fuente.url);
        i.attachMedia(el);
        adjuntos.current.set(vod.id, { calidad: fuente.calidad, hls: i });
        el.addEventListener('loadedmetadata', volver, { once: true });
      }
    })();

    return () => {
      vivo = false;
    };
  }, [vods, principal, cubre]);

  // Al cerrar, todo. La limpieza NO va en el efecto de arriba: ése corre en
  // cada cambio de principal, y destruir ahí las instancias buenas dejaría sin
  // fuente a las que no se estaban tocando.
  useEffect(
    () => () => {
      for (const a of adjuntos.current.values()) a.hls?.destroy();
      adjuntos.current.clear();
    },
    [],
  );

  // --- Ir a un instante de la guerra ---------------------------------------
  /**
   * Quién dicta la hora en este instante.
   *
   * La principal, mientras cubra el momento; si no, la primera que lo cubra. A
   * un vídeo que no llega a ese momento no se le puede preguntar la hora: se
   * quedaría parado donde estaba y devolvería el reloj de todos allí, con toda
   * la pinta de que el salto no ha funcionado. Nadie graba la guerra entera,
   * así que esto pasa en cuanto alguien se mueve fuera del tramo del que está
   * mirando.
   *
   * Se calcula en cada uso y ya no es estado, que es lo que antes hacía que
   * salirse del tramo CAMBIARA el mosaico enfocado. Con la calidad atada al
   * hueco grande eso sería peor todavía: un salto de la línea de tiempo
   * reabriría dos fuentes y pondría a otro en grande sin que nadie lo pidiera.
   * El hueco grande sólo lo mueve quien mira.
   */
  const maestroEn = useCallback(
    (t: number) => {
      const suyo = vods.find((v) => v.id === principal);
      if (suyo && cubre(suyo, t)) return suyo;
      return vods.find((v) => cubre(v, t));
    },
    [vods, principal, cubre],
  );

  const irA = useCallback(
    (t: number) => {
      const limitado = Math.max(desde, Math.min(t, hasta));
      ponerReloj(limitado);

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
    [vods, desde, hasta, cubre, ponerReloj],
  );

  // --- El reloj maestro y la corrección de deriva --------------------------
  useEffect(() => {
    let vivo = true;
    let cuadro = 0;

    const tic = () => {
      if (!vivo) return;
      cuadro = requestAnimationFrame(tic);

      const vodMaestro = maestroEn(relojRef.current);
      const maestro = vodMaestro && videos.current.get(vodMaestro.id);
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
        if (v.id === vodMaestro.id) continue;
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
  }, [maestroEn, vods, sonando, cubre, ponerReloj]);

  // --- Sonar y parar --------------------------------------------------------
  const alternar = useCallback(() => {
    const siguiente = !sonando;
    sonandoRef.current = siguiente;
    setSonando(siguiente);
    vods.forEach((v) => {
      const el = videos.current.get(v.id);
      if (!el) return;
      if (!siguiente) return el.pause();
      if (cubre(v, relojRef.current)) void el.play().catch(() => {});
    });
  }, [sonando, vods, cubre]);

  // El audio sale de la grande. Aquí y no al pulsar, para que también valga
  // cuando cambia por otra vía -- el teclado, o quedarse sin candidatas.
  useEffect(() => {
    vods.forEach((v) => {
      const el = videos.current.get(v.id);
      if (el) el.muted = silenciado || v.id !== principal;
    });
  }, [principal, vods, silenciado]);

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
      // 1..6 pone a uno en grande, que es lo que más se usa revisando: se sigue
      // a uno hasta que pasa algo y se salta al que lo vio de cerca.
      const numero = Number(e.key);
      if (numero >= 1 && numero <= vods.length) {
        e.preventDefault();
        setPrincipal(vods[numero - 1].id);
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

  const principalVod = vods.find((v) => v.id === principal);
  // En el orden original y no con la principal quitada del medio: la columna
  // debe quedarse quieta al intercambiar. Reordenarla haría que la miniatura
  // que acabas de pulsar arrastre a las de abajo un hueco hacia arriba, y la
  // siguiente pulsación caería sobre otra persona.
  const secundarios = vods.filter((v) => v.id !== principal);

  /**
   * Quién es el `<video>` de cada grabación.
   *
   * Al desmontar no se borra a ciegas. React recrea el elemento que cambia de
   * contenedor, y según el orden en que confirme el montaje y el desmontaje, el
   * `null` del viejo puede llegar DESPUÉS del elemento nuevo: borrar entonces
   * dejaría a esa grabación sin nodo registrado, y el efecto de enganche la
   * saltaría por no encontrarla. Se comprueba que el registrado siga en el
   * documento, que es cierto exactamente cuando es el bueno.
   */
  const registrar = useCallback((id: string, el: HTMLVideoElement | null) => {
    if (el) {
      videos.current.set(id, el);
      return;
    }
    const puesto = videos.current.get(id);
    if (puesto && !puesto.isConnected) videos.current.delete(id);
  }, []);

  return (
    <Sheet
      title="Mosaico"
      subtitle={`${vods.length} grabaciones de la misma guerra, cuadradas`}
      size="lleno"
      onClose={onClose}
    >
      {/*
        `h-full` y `min-h-0` en cadena hasta el vídeo.

        Sin la cadena entera, ocupar la pantalla no sirve de nada: un hijo con
        `flex-1` dentro de un padre sin altura definida se queda en su altura
        natural, y el hueco de más se lo reparte el aire de abajo en vez de la
        imagen. Y `min-h-0` porque un elemento flex se niega a encogerse por
        debajo de su contenido salvo que se le diga -- que es lo que hace que la
        línea de tiempo se salga por el pie en vez de que el vídeo ceda.
      */}
      <div className="h-full flex flex-col gap-2 min-h-0">
        {/*
          Una grande y una columna al lado.

          En escritorio la grande se lleva todo el alto que quede de la hoja
          --de ahí el `max-h` en viewport en vez de un `aspect-video`, que la
          dejaría corta en pantallas anchas-- y la columna se ajusta a ese
          mismo alto con su propio scroll. En el móvil no hay columna que valga:
          la grande arriba y las demás en una tira horizontal debajo, que se
          arrastra con el dedo.
        */}
        <div className="flex flex-col lg:flex-row gap-2 grow min-h-0">
          {/*
            `group` para que la barra salga al pasar por encima. A pantalla
            completa y en pausa se queda puesta: son los dos momentos en que se
            busca un mando, y esconderlo justo entonces obliga a mover el ratón
            a ciegas para encontrarlo.
          */}
          <div
            ref={caja}
            // `aspect-video` sólo hasta `lg`. Ahí la columna es una tira debajo
            // y esta caja se apila, así que sin proporción propia no tiene de
            // dónde sacar alto y se queda en una rendija. Desde `lg` manda
            // `flex-1`: la caja se lleva todo el alto de la hoja y el vídeo se
            // acomoda dentro, que es de lo que va ocupar la pantalla.
            className={`group relative min-w-0 min-h-0 bg-black flex items-center justify-center ${
              pantallaCompleta
                ? 'w-full h-full'
                : 'aspect-video lg:aspect-auto lg:flex-1 rounded-lg overflow-hidden'
            }`}
          >
            <MosaicoVideo
              vod={principalVod ?? vods[0]}
              grande
              dentro={principalVod ? cubre(principalVod, tGuerra) : false}
              tGuerra={tGuerra}
              numero={vods.findIndex((v) => v.id === principal) + 1}
              registrar={registrar}
            />

            <div
              // `pt-3` en el móvil y `pt-6` desde sm: el degradado es
              // decoración, y sobre un vídeo de 192 px de alto se comía la
              // mitad del cuadro. Los botones se quedan en 44 px pasen los que
              // pasen, que ésos sí son el mínimo para el dedo.
              className={`absolute inset-x-0 bottom-0 px-2 pb-2 pt-3 sm:pt-6 bg-gradient-to-t from-slate-950/90 to-transparent transition-opacity duration-micro ${
                pantallaCompleta || !sonando
                  ? 'opacity-100'
                  : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
              }`}
            >
              {/*
                La barra de búsqueda es la de la GUERRA, no la del fichero. En
                un mosaico son cosas distintas: cada grabación empezó cuando
                quiso, así que el minuto 3 de este vídeo no es el minuto 3 del
                de al lado. Arrastrar aquí mueve a los cinco al mismo instante,
                que es de lo que va todo esto.
              */}
              <BarraGuerra
                desde={desde}
                hasta={hasta}
                tGuerra={tGuerra}
                marcas={ordenadas}
                irA={irA}
                alto="h-1"
              />

              <div className="flex items-center gap-1 mt-1">
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

                <span className="text-[11px] tabular-nums text-slate-300 ml-1">
                  {comoReloj(tGuerra)}
                </span>

                {/* A pantalla completa no hay columna, así que se recuerda cómo
                    cambiar de perspectiva sin salir. */}
                {pantallaCompleta && (
                  <span className="text-[11px] text-slate-500 ml-2 hidden sm:inline">
                    1-{vods.length} cambia de perspectiva
                  </span>
                )}

                <span className="flex-1" />

                <button
                  type="button"
                  onClick={() => setSilenciado((v) => !v)}
                  aria-label={silenciado ? 'Quitar el silencio' : 'Silenciar'}
                  className="min-w-tap text-slate-300"
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
                  className="min-w-tap text-slate-300"
                >
                  <i
                    className={`fa-solid ${pantallaCompleta ? 'fa-compress' : 'fa-expand'}`}
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>
          </div>

          <div
            className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-x-visible lg:overflow-y-auto lg:w-[22%] shrink-0 min-h-0"
            role="list"
            aria-label="Otras perspectivas"
          >
            {secundarios.map((v) => (
              <button
                key={v.id}
                type="button"
                role="listitem"
                onClick={() => setPrincipal(v.id)}
                aria-label={`Poner a ${v.nombre} en grande`}
                // `w-40` en el móvil para que la tira enseñe que hay más a la
                // derecha; en escritorio, todo el ancho de la columna.
                className="tap-suelto w-40 lg:w-full shrink-0 rounded-lg overflow-hidden ring-1 ring-slate-800 hover:ring-amber-500/60 transition-colors duration-micro"
              >
                <MosaicoVideo
                  vod={v}
                  dentro={cubre(v, tGuerra)}
                  tGuerra={tGuerra}
                  numero={vods.findIndex((x) => x.id === v.id) + 1}
                  registrar={registrar}
                />
              </button>
            ))}
          </div>
        </div>

        {/* --- La línea de tiempo, que es de la guerra y no de un vídeo --- */}
        {/* `shrink-0`: es el bloque de altura fija, y lo que cede al repartir el
            hueco tiene que ser el vídeo -- que es lo que se mira -- y no al
            revés. Sin esto, la línea de tiempo se encoge hasta hacerse ilegible
            en cuanto el vídeo pide sitio. */}
        <div className="shrink-0 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2">
            {/* Con signo: en negativo va la preparación, y `mmss` la recortaba
                a cero -- toda la cuenta atrás se leía «0:00 de guerra». */}
            <span className="tabular-nums">{comoReloj(tGuerra)} de guerra</span>
            <span>{ordenadas.length} marcas</span>
          </div>

          {/* Una franja por grabación: se ve de un vistazo quién cubre qué. */}
          <div className="space-y-1 mb-2">
            {vods.map((v) => (
              <div key={v.id} className="relative h-1.5 rounded-full bg-slate-800">
                <div
                  className={`absolute h-full rounded-full ${
                    v.id === principal ? 'bg-amber-500/70' : 'bg-slate-600'
                  }`}
                  style={{
                    left: `${pct(v.offsetMs)}%`,
                    width: `${(v.duracionMs / anchoTotal) * 100}%`,
                  }}
                />
              </div>
            ))}
          </div>

          <BarraGuerra
            desde={desde}
            hasta={hasta}
            tGuerra={tGuerra}
            marcas={ordenadas}
            irA={irA}
          />

          {/*
            Los mandos ya no se repiten aquí: viven sobre la grande, como en
            cualquier reproductor, y esta barra es la que enseña la cobertura y
            las marcas. Dos juegos de botones para lo mismo, uno encima del
            vídeo y otro debajo, obligaban a mirar dos sitios para saber si
            estaba sonando.
          */}
          <p className="text-[11px] text-slate-500 mt-2">
            Espacio reproduce · 1-{vods.length} pone a uno en grande · N P entre marcas ·
            ← → 5 s
          </p>
        </div>

        {/*
          Acotada y con su propio scroll. Es el único bloque de aquí que crece
          con los datos --una guerra bien anotada trae veinte marcas-- y sin
          tope se comería el alto que se acaba de ganar para el vídeo. Que ceda
          la lista, que se puede desplazar, y no la imagen, que no.
        */}
        {ordenadas.length > 0 && (
          <ul className="space-y-1 shrink-0 max-h-28 overflow-y-auto overscroll-contain">
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
