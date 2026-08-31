import React, { useEffect, useRef, useState } from 'react';
import { api } from '../services/authService';
import { CALL_SPOT_LABELS, CallSpot, WarCall } from '../types';

const MINUTE = 60_000;

/**
 * When to interrupt somebody: a minute out to get ready, thirty seconds out to
 * go. Each fires inside its own band -- opening the page twenty seconds before
 * an event should bring one warning, not both at once.
 *
 * The two sound different on purpose, and not merely louder: a pair of low
 * notes against a rising four-note siren. In the middle of a fight nobody reads
 * the screen to find out which warning just went off, so the warning has to say
 * which it is by its shape.
 */
const WARNINGS = [
  {
    at: 60_000,
    label: '1 minuto',
    tone: [
      [620, 0.18],
      [620, 0.18],
    ] as [number, number][],
    buzz: [180, 120, 180],
  },
  {
    at: 30_000,
    label: '30 segundos',
    tone: [
      [988, 0.12],
      [1319, 0.12],
      [988, 0.12],
      [1319, 0.26],
    ] as [number, number][],
    buzz: [90, 70, 90, 70, 90, 70, 320],
  },
];

/**
 * El grito del boss, que no es ninguno de los dos avisos de arriba.
 *
 * Los dos de arriba dicen "prepárate": queda un minuto, quedan treinta
 * segundos. Este dice "ya", y tiene que distinguirse de ambos en la oscuridad
 * -- cinco notas subiendo y una vibración larga, más urgente que nada que
 * suene por el reloj.
 */
const CALL_TONE: [number, number][] = [
  [880, 0.1],
  [1175, 0.1],
  [1568, 0.1],
  [1175, 0.1],
  [1568, 0.42],
];
const CALL_BUZZ = [70, 60, 70, 60, 70, 60, 480];

/**
 * A short alarm built on the spot rather than fetched: no file to ship, no
 * request to fail at the worst moment, and the browser will not refuse to play
 * it because it never left the page.
 */
function sound(ctx: AudioContext, steps: [number, number][]) {
  let at = ctx.currentTime + 0.02;
  for (const [frequency, length] of steps) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    // Square, because a sine reads as a notification and this is an alarm.
    osc.type = 'square';
    osc.frequency.value = frequency;
    // Ramped rather than switched, so it does not click on the way in or out.
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.75, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + length + 0.02);
    at += length + 0.07;
  }
}

/** From the first warning onwards the panel says so without being asked. */
const WARNING_MS = WARNINGS[0].at;

/** The jungle comes round again and again, on the clock. */
const JUNGLE_EVERY = 5 * MINUTE;

/**
 * El boss no tiene hora, tiene ventana.
 *
 * Sale entre el minuto 4 y el 6 el primero, entre el 14 y el 16 el segundo, y
 * siempre en un salto de treinta segundos: 4:00, 4:30, 5:00... Y sale arriba o
 * abajo, que cambia a dónde corre la mitad del gremio.
 *
 * Un reloj que lo cantara al sexto minuto acertaría una vez de cada cinco, así
 * que aquí no se canta: se dibuja la ventana, se cuenta el próximo salto, y el
 * aviso lo da con el dedo quien lo ve salir. El servidor lo reparte a las
 * demás pantallas -- ver `callBoss` en server/war.js.
 */
const BOSS_WINDOWS = [
  { from: 4 * MINUTE, to: 6 * MINUTE },
  { from: 14 * MINUTE, to: 16 * MINUTE },
];
const BOSS_STEP = 30_000;

/** A guild war lasts half an hour, and the server ends it at that. */
export const WAR_LENGTH = 30 * MINUTE;

interface Countdown {
  key: string;
  label: string;
  remaining: number;
}

/**
 * El color de cada reloj, como peldaño de rampa y no como número.
 *
 * Estaba escrito a mano -- `#a3e635` para la jungla, `#f87171` para el boss, y
 * `#e2e8f0` para las cifras -- y eso es un tema oscuro cableado dentro de un
 * producto que tiene dos. En claro la cifra caía en gris casi blanco sobre una
 * tarjeta casi blanca y no se leía (docs/DIRECCION_VISUAL.md §2). Los peldaños
 * se resuelven contra la variable del tema vigente, así que el mismo nombre
 * vale de día y de noche.
 *
 * El 500 y no el 400 a propósito: es el peldaño que pasa AA en los dos temas
 * sobre la superficie de tarjeta, que es donde cae.
 */
const TONOS = {
  jungla: '--s-500',
  boss: '--d-500',
  // El arranque de la partida, que sólo suena si los relojes se armaron en la
  // preparación. En latón, que es el color de lo que ordena y no de lo que ataca.
  partida: '--a-500',
} as const;

type Tono = keyof typeof TONOS;

const tinta = (tono: Tono, alpha?: number) =>
  alpha === undefined ? `rgb(var(${TONOS[tono]}))` : `rgb(var(${TONOS[tono]}) / ${alpha})`;

const clock = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/** Un instante de la guerra como se dice en voz alta: «4:30». */
const mark = (ms: number) => `${Math.floor(ms / MINUTE)}:${String((ms / 1000) % 60).padStart(2, '0')}`;

function nextJungle(elapsed: number): Countdown | null {
  // En preparación (tiempo negativo) la que viene es la primera: sin el suelo,
  // la división saldría en una «Jungla 0» puesta en el arranque de la partida.
  const round = Math.max(0, Math.floor(elapsed / JUNGLE_EVERY)) + 1;
  const at = round * JUNGLE_EVERY;
  // Nothing is worth counting down to after the war has ended.
  if (at > WAR_LENGTH) return null;
  return { key: `jungla-${round}`, label: `Jungla ${round}`, remaining: at - elapsed };
}

interface BossWindow {
  /** El primero o el segundo. */
  index: number;
  from: number;
  to: number;
  /** Si ya puede salir. */
  open: boolean;
  /** Lo que falta: para que abra la ventana, o para el próximo salto. */
  remaining: number;
}

function bossWindow(elapsed: number): BossWindow | null {
  const at = BOSS_WINDOWS.findIndex((w) => elapsed < w.to);
  if (at === -1) return null;
  const { from, to } = BOSS_WINDOWS[at];
  const open = elapsed >= from;
  return {
    index: at + 1,
    from,
    to,
    open,
    remaining: open ? BOSS_STEP - ((elapsed - from) % BOSS_STEP) : from - elapsed,
  };
}

/**
 * Un reloj, con la misma pauta que las fichas del tablero: superficie opaca
 * del tema, y el color del evento sólido y pequeño -- la barra del canto y el
 * icono. Era un lavado del color al 6% sobre un fondo oscuro fijo, y eso en
 * tema claro es un color al 6% sobre blanco, que no es nada.
 *
 * La cifra es tinta del tema salvo cuando el momento ha llegado: entonces se
 * tiñe, que es la única vez que el color dice algo que el número no diga ya.
 *
 * Va fuera del componente y no dentro, que es donde vivía su antecesor. Una
 * función declarada dentro del `render` es un tipo nuevo en cada pasada, así
 * que React desmonta y vuelve a montar lo que devuelve -- cuatro veces por
 * segundo, que es lo que tarda el reloj en latir. El `animate-pulse` se
 * reiniciaba antes de llegar a ninguna parte y la ventana abierta no llegaba
 * a parpadear nunca.
 */
const Reloj: React.FC<{
  tono: Tono;
  icon: string;
  /** Lo que hay encima: el nombre del evento o su ventana. */
  etiqueta: string;
  /** La cifra, o null si ya no queda nada que contar. */
  valor: string | null;
  /** La línea de abajo, si el reloj cuenta algo que hay que explicar. */
  pie?: string;
  /** Si esto es ya: cuenta atrás dentro del aviso, o ventana abierta. */
  urgente: boolean;
}> = ({ tono, icon, etiqueta, valor, pie, urgente }) => (
  <div
    className={`relative overflow-hidden flex items-center gap-3 rounded-lg border bg-slate-900 pl-4 pr-4 py-2 ${
      urgente ? 'animate-pulse' : ''
    }`}
    style={{ borderColor: valor ? tinta(tono, urgente ? 1 : 0.4) : 'rgb(var(--n-800))' }}
  >
    {/* La barra del canto: 4 px de color sólido, que es lo único que no
        depende de contra qué fondo cae. Recortada por la tarjeta. */}
    <span
      aria-hidden
      className="absolute left-0 top-0 bottom-0 w-1"
      style={{ backgroundColor: valor ? tinta(tono) : 'rgb(var(--n-800))' }}
    />
    <i
      className={`fa-solid ${icon} text-lg`}
      style={{ color: valor ? tinta(tono) : 'rgb(var(--n-700))' }}
    ></i>
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{etiqueta}</p>
      <p
        className={`text-2xl font-bold tabular-nums leading-none ${
          valor ? (urgente ? '' : 'text-slate-100') : 'text-slate-700'
        }`}
        style={urgente && valor ? { color: tinta(tono) } : undefined}
      >
        {valor ?? '--:--'}
      </p>
      {pie && <p className="text-[10px] text-slate-500 mt-0.5">{pie}</p>}
    </div>
  </div>
);

interface Props {
  /** Cuándo empieza (o empezó) la PARTIDA, según el servidor. Puede estar en
      el futuro: los relojes se pueden armar desde la fase de preparación, y
      entonces todo esto cuenta primero hacia el arranque. */
  startedAt: string;
  /** Server time minus this browser's time, so everyone counts together. */
  offset: number;
  /** Quién puede cantar el boss: el mismo permiso con el que se arma el tablero. */
  canCall: boolean;
}

/**
 * Los relojes de una guerra, y el botón con el que se canta lo que no tiene
 * reloj.
 *
 * Lo que sí tiene hora se deriva del momento de arranque en vez de llevarse
 * contado en el servidor: cada pantalla saca los mismos números del mismo
 * instante, así que nada se desincroniza y recargar no pierde nada.
 *
 * Lo que no tiene hora -- el boss -- llega al revés: alguien lo canta, el
 * servidor lo guarda veinte segundos y todas las pantallas lo recogen
 * sondeando. Es la única cosa de la aplicación que va de una pantalla a otra
 * en caliente, y por eso es un sondeo corto y no media infraestructura.
 */
const WarTimers: React.FC<Props> = ({ startedAt, offset, canCall }) => {
  const [elapsed, setElapsed] = useState(0);
  const [warnings, setWarnings] = useState<'off' | 'on'>('off');
  const fired = useRef<Set<string>>(new Set());
  const audio = useRef<AudioContext | null>(null);
  const [toast, setToast] = useState<{ title: string; sub: string; tono: Tono } | null>(null);
  const clearing = useRef<number | undefined>(undefined);
  /** Los gritos ya enseñados: el sondeo devuelve el mismo hasta que caduca. */
  const heard = useRef<Set<string>>(new Set());
  const [calling, setCalling] = useState<CallSpot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const began = Date.parse(startedAt);
    const tick = () => setElapsed(Date.now() + offset - began);
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [startedAt, offset]);

  const jungle = nextJungle(elapsed);
  const boss = bossWindow(elapsed);
  // Antes del arranque se está en preparación, y lo que se cuenta es cuánto
  // falta. Jungla y boss no necesitan saberlo: sus cuentas restan sobre el
  // mismo instante y con tiempo negativo sencillamente salen más largas.
  const enPreparacion = elapsed < 0;
  /** El arranque como un evento más, para que el aviso de «ya casi» suene igual. */
  const inicio = enPreparacion
    ? { key: 'inicio', label: 'La partida', remaining: -elapsed }
    : null;

  /** Enseñar algo a pantalla completa, y hacer ruido si esta pantalla lo pidió. */
  const announce = (
    title: string,
    sub: string,
    tono: Tono,
    alarm: { tone: [number, number][]; buzz: number[]; tag: string },
  ) => {
    // The banner is for everyone in the room. It asks no permission and makes
    // no noise, so there is no reason to keep it from the people who are only
    // there to fight.
    setToast({ title, sub, tono });
    window.clearTimeout(clearing.current);
    clearing.current = window.setTimeout(() => setToast(null), 8_000);

    if (warnings !== 'on') return;

    // Three more ways of saying it, because each fails somewhere: the sound
    // needs the volume up, the buzz needs a phone that has a motor, and the
    // notification needs a permission that may have been refused.
    if (audio.current) sound(audio.current, alarm.tone);
    try {
      navigator.vibrate?.(alarm.buzz);
    } catch {
      // Not every device has one, and iOS has none of this at all.
    }
    try {
      new Notification(`${title} · ${sub}`, { body: 'Zona Zero · sala de guerra', tag: alarm.tag });
    } catch {
      // Denied or unsupported: the banner and the panel still stand.
    }
  };

  // Each warning fires once, and only for what has an hour of its own: la
  // jungla, y el arranque de la partida si se armó desde la preparación. El
  // boss no se avisa solo -- se canta.
  useEffect(() => {
    for (const evento of [inicio, jungle]) {
      if (!evento) continue;
      WARNINGS.forEach((warning, index) => {
        const floor = WARNINGS[index + 1]?.at ?? 0;
        if (evento.remaining > warning.at || evento.remaining <= floor) return;

        const key = `${evento.key}@${warning.at}`;
        if (fired.current.has(key)) return;
        fired.current.add(key);

        announce(evento.label, `en ${warning.label}`, evento.key === 'inicio' ? 'partida' : 'jungla', {
          tone: warning.tone,
          buzz: warning.buzz,
          tag: key,
        });
      });
    }
  }, [warnings, inicio?.remaining, jungle?.key, jungle?.remaining]);

  /** El grito que llega de otra pantalla, recogido cada pocos segundos. */
  useEffect(() => {
    let alive = true;
    const recoger = async () => {
      const call = await api<WarCall | null>('/war/call').catch(() => null);
      if (!alive || !call || heard.current.has(call.id)) return;
      heard.current.add(call.id);
      announce(
        CALL_SPOT_LABELS[call.spot],
        call.by ? `¡Sale ahora! · lo canta ${call.by}` : '¡Sale ahora!',
        'boss',
        { tone: CALL_TONE, buzz: CALL_BUZZ, tag: call.id },
      );
    };
    void recoger();
    const timer = window.setInterval(() => void recoger(), 3_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
    // `warnings` entra porque `announce` lo lee: sin él, armar la alarma a
    // mitad de guerra dejaría el sondeo mudo con la copia vieja de la función.
  }, [warnings]);

  useEffect(() => () => window.clearTimeout(clearing.current), []);

  /** Abrir el audio con el gesto que sea, que es lo único que pide el navegador. */
  const abrirAudio = async () => {
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audio.current ??= new Ctor();
      await audio.current.resume();
      return true;
    } catch {
      // No audio: the notification and the panel still do their job.
      return false;
    }
  };

  /**
   * Turning warnings on is the click the browser was waiting for.
   *
   * Audio cannot start without one, so the context is opened here and kept, and
   * the first alarm is played back straight away -- it doubles as proof that the
   * volume is up, which is worth knowing before the war rather than during it.
   */
  const ask = async () => {
    if (warnings === 'on') {
      setWarnings('off');
      return;
    }

    // Unless a warning is about to sound anyway: arming inside the last minute
    // would otherwise play the sample and the real thing on top of each other,
    // which lands as one muddled noise at the moment attention matters most.
    const imminent =
      (jungle !== null && jungle.remaining <= WARNINGS[0].at) ||
      (inicio !== null && inicio.remaining <= WARNINGS[0].at);

    if ((await abrirAudio()) && !imminent && audio.current) {
      sound(audio.current, WARNINGS[0].tone);
    }
    try {
      if (!imminent) navigator.vibrate?.(WARNINGS[0].buzz);
    } catch {
      // As above.
    }

    setWarnings('on');
    // Asked for, not required: refusing notifications must not cost the alarm.
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      await Notification.requestPermission().catch(() => undefined);
    }
  };

  /**
   * Cantar el boss: un clic, y suena en todas las pantallas y en las líneas.
   *
   * El grito se enseña aquí sin esperar al sondeo -- quien lo canta tiene que
   * ver que salió -- y se apunta como oído para que el sondeo no lo repita.
   */
  const cantar = async (spot: CallSpot) => {
    setCalling(spot);
    setError(null);
    // El clic es el gesto que el navegador pedía: si la alarma está armada y el
    // audio aún no se abrió, este es el momento.
    if (warnings === 'on') await abrirAudio();
    try {
      const out = await api<{ call: WarCall; horn: string }>('/war/call', {
        method: 'POST',
        body: JSON.stringify({ spot }),
      });
      heard.current.add(out.call.id);
      announce(CALL_SPOT_LABELS[spot], '¡Sale ahora! · lo cantas tú', 'boss', {
        tone: CALL_TONE,
        buzz: CALL_BUZZ,
        tag: out.call.id,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cantar el boss');
    } finally {
      setCalling(null);
    }
  };


  return (
    <>
      {/*
        El aviso ocupa la pantalla, porque es lo único que importa mientras dura.

        Estaba a 24 px del borde superior -- debajo de la cabecera pegajosa y
        dentro del recorte de la pantalla -- y era una caja pequeña en mitad de
        una interfaz llena de cosas. Un aviso que llega a los treinta segundos de
        un boss compite con todo lo que hay alrededor, y pierde.

        Ahora cubre lo que hay detrás y toda ella cierra: no hay que apuntar a
        nada, con tocar en cualquier sitio basta. Y se va sola, así que quien no
        esté mirando el teléfono no se lo encuentra puesto diez minutos después.
      */}
      {toast && (
        <button
          onClick={() => setToast(null)}
          aria-live="assertive"
          aria-label={`${toast.title}. ${toast.sub}. Toca para descartar.`}
          className="fixed inset-0 z-[95] flex flex-col items-center justify-center gap-3 px-6 text-center animate-hoja"
          style={{
            // El resplandor va encima de una base casi opaca, no mezclado con
            // ella: mezclados, el color teñía la pantalla entera y lo que había
            // detrás seguía leyéndose a través, que es justo lo que un aviso no
            // debe permitir.
            background: `radial-gradient(circle at 50% 42%, ${tinta(toast.tono, 0.19)} 0%, transparent 58%), rgb(var(--n-950) / 0.97)`,
            backdropFilter: 'blur(4px)',
          }}
        >
          <span
            className="rounded-full border-2 px-4 py-1 text-[11px] uppercase tracking-[0.2em] font-bold animate-pulse"
            style={{ borderColor: tinta(toast.tono), color: tinta(toast.tono) }}
          >
            Aviso
          </span>

          <span
            className="cinzel text-[clamp(2.75rem,14vw,6rem)] font-bold leading-[0.95] drop-shadow-lg"
            style={{ color: tinta(toast.tono), textShadow: `0 0 44px ${tinta(toast.tono, 0.5)}` }}
          >
            {toast.title}
          </span>

          <span className="text-[clamp(1.25rem,6vw,2rem)] text-slate-100 font-semibold">
            {toast.sub}
          </span>

          <span className="mt-6 text-sm text-slate-400">Toca para cerrar</span>
        </button>
      )}

      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center gap-4 flex-wrap">
      {/* En preparación el reloj principal cuenta hacia el arranque, que es lo
          único que está pasando; con la partida en marcha, lo transcurrido. */}
      {enPreparacion ? (
        <div>
          <p className="text-[10px] uppercase tracking-wider" style={{ color: tinta('partida') }}>
            <i className="fa-solid fa-hourglass-half mr-1"></i>
            Preparación
          </p>
          <p className="text-lg font-bold text-slate-200 tabular-nums leading-none">
            {clock(-elapsed)}
          </p>
          <p className="text-[10px] text-slate-500 tabular-nums mt-0.5">para que empiece la partida</p>
        </div>
      ) : (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500">En guerra</p>
          <p className="text-lg font-bold text-slate-200 tabular-nums leading-none">{clock(elapsed)}</p>
          {/* Half an hour is the whole of it, so the end is a countdown too. */}
          <p className="text-[10px] text-slate-500 tabular-nums mt-0.5">
            termina en {clock(WAR_LENGTH - elapsed)}
          </p>
        </div>
      )}

      <Reloj
        tono="jungla"
        icon="fa-leaf"
        etiqueta={jungle ? jungle.label : 'Jungla'}
        valor={jungle ? clock(jungle.remaining) : null}
        urgente={jungle !== null && jungle.remaining <= WARNING_MS}
      />

      {/* La ventana del boss, que no es una cuenta atrás sino un aviso de que
          hay que mirar. Abierta cuenta lo que falta para el próximo salto de
          treinta segundos, que es cuando puede aparecer; cerrada, lo que falta
          para que empiece a poder. */}
      <Reloj
        tono="boss"
        icon="fa-dragon"
        etiqueta={boss ? `Boss ${boss.index} · ${mark(boss.from)}–${mark(boss.to)}` : 'Boss'}
        valor={boss ? clock(boss.remaining) : null}
        pie={!boss ? 'no quedan' : boss.open ? 'para el próximo salto' : 'para que pueda salir'}
        urgente={boss?.open === true}
      />

      {/*
        Los dos botones del grito.

        Van aquí y no escondidos en un menú porque el momento de usarlos es el
        peor posible para buscar nada: el boss acaba de aparecer, hay que decir
        dónde, y cada segundo que se tarde es media línea corriendo al sitio
        equivocado. Dos dianas grandes, arriba y abajo, y ya está.
      */}
      {canCall && (
        <div className="flex items-stretch gap-2">
          {(
            [
              { spot: 'upper', icon: 'fa-arrow-up', label: 'Arriba' },
              { spot: 'lower', icon: 'fa-arrow-down', label: 'Abajo' },
            ] as const
          ).map(({ spot, icon, label }) => (
            <button
              key={spot}
              onClick={() => void cantar(spot)}
              disabled={calling !== null}
              title={`Avisar a todas las líneas de que el boss salió ${label.toLowerCase()}`}
              // Relleno y no contorno, que era un texto teñido sobre un lavado
              // al 10%: en tema claro se quedaba en 3,94 sobre la tarjeta, por
              // debajo de AA para los 16 px en negrita que tiene. Los peldaños
              // de relleno de la rampa (600-950) existen justo para esto --
              // llevan texto blanco y valen en los dos temas, así que el
              // contraste deja de depender de cuál esté puesto.
              //
              // Y es además lo que estos dos botones son. Un contorno se lee
              // como una etiqueta; esto es la acción más urgente de la pantalla.
              className="min-h-tap px-4 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2 font-bold shadow-sm"
            >
              <i
                className={`fa-solid ${calling === spot ? 'fa-circle-notch fa-spin' : icon} text-lg`}
              ></i>
              <span className="text-left leading-tight">
                <span className="block text-[9px] uppercase tracking-wider text-white/75 font-normal">
                  Cantar boss
                </span>
                {label}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="flex-1" />

      {error && <p className="text-xs text-red-400 w-full sm:w-auto">{error}</p>}

      {/* Para todos, no sólo para quien manda: el grito es para quien pelea, y
          la alarma de este teléfono no le cuesta nada a nadie más. */}
      <button
        onClick={ask}
        title="Alarma, vibración y notificación con la jungla y con el grito del boss, mientras esta página siga abierta"
        className={`text-xs font-bold px-3 py-2 rounded border transition-all flex items-center gap-2 ${
          warnings === 'on'
            ? 'border-amber-500 text-amber-400 bg-amber-500/10'
            : 'border-slate-800 text-slate-500 hover:text-slate-300'
        }`}
      >
        <i className={`fa-solid ${warnings === 'on' ? 'fa-bell' : 'fa-bell-slash'}`}></i>
        Avisos sonoros
      </button>
      </div>
    </>
  );
};

export default WarTimers;
