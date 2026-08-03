import React, { useEffect, useRef, useState } from 'react';

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

/** The jungle comes round again and again; the boss comes twice and is done. */
const JUNGLE_EVERY = 5 * MINUTE;
const BOSS_AT = [6 * MINUTE, 16 * MINUTE];

/** A guild war lasts half an hour, and the server ends it at that. */
export const WAR_LENGTH = 30 * MINUTE;

interface Countdown {
  key: string;
  label: string;
  remaining: number;
}

const clock = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

function nextJungle(elapsed: number): Countdown | null {
  const round = Math.floor(elapsed / JUNGLE_EVERY) + 1;
  const at = round * JUNGLE_EVERY;
  // Nothing is worth counting down to after the war has ended.
  if (at > WAR_LENGTH) return null;
  return { key: `jungla-${round}`, label: `Jungla ${round}`, remaining: at - elapsed };
}

function nextBoss(elapsed: number): Countdown | null {
  const index = BOSS_AT.findIndex((at) => at > elapsed);
  if (index === -1) return null;
  return {
    key: `boss-${index + 1}`,
    label: `Boss ${index + 1}`,
    remaining: BOSS_AT[index] - elapsed,
  };
}

interface Props {
  /** When the war began, as the server told it. */
  startedAt: string;
  /** Server time minus this browser's time, so everyone counts together. */
  offset: number;
  /** Whether this person is one of those the guild wants warned. */
  mayBeWarned: boolean;
}

/**
 * The two clocks a war is run by, counting from the moment it started.
 *
 * Derived from the start time rather than kept ticking on the server: every
 * screen works out the same numbers from the same instant, so nothing can drift
 * apart and a reload loses nothing.
 */
const WarTimers: React.FC<Props> = ({ startedAt, offset, mayBeWarned }) => {
  const [elapsed, setElapsed] = useState(0);
  const [warnings, setWarnings] = useState<'off' | 'on'>('off');
  const fired = useRef<Set<string>>(new Set());
  const audio = useRef<AudioContext | null>(null);
  const [toast, setToast] = useState<{ label: string; when: string; colour: string } | null>(null);
  const clearing = useRef<number | undefined>(undefined);

  useEffect(() => {
    const began = Date.parse(startedAt);
    const tick = () => setElapsed(Date.now() + offset - began);
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [startedAt, offset]);

  const jungle = nextJungle(elapsed);
  const boss = nextBoss(elapsed);

  // Each warning fires once per event.
  useEffect(() => {
    for (const event of [jungle, boss]) {
      if (!event) continue;
      WARNINGS.forEach((warning, index) => {
        const floor = WARNINGS[index + 1]?.at ?? 0;
        if (event.remaining > warning.at || event.remaining <= floor) return;

        const key = `${event.key}@${warning.at}`;
        if (fired.current.has(key)) return;
        fired.current.add(key);

        // The banner is for everyone in the room. It asks no permission and
        // makes no noise, so there is no reason to keep it from the people
        // who are only there to fight.
        setToast({
          label: event.label,
          when: warning.label,
          colour: event.key.startsWith('boss') ? '#f87171' : '#a3e635',
        });
        window.clearTimeout(clearing.current);
        clearing.current = window.setTimeout(() => setToast(null), 8_000);

        if (warnings !== 'on') return;

        // Three more ways of saying it, because each fails somewhere: the sound
        // needs the volume up, the buzz needs a phone that has a motor, and the
        // notification needs a permission that may have been refused.
        if (audio.current) sound(audio.current, warning.tone);
        try {
          navigator.vibrate?.(warning.buzz);
        } catch {
          // Not every device has one, and iOS has none of this at all.
        }
        try {
          new Notification(`${event.label} en ${warning.label}`, {
            body: 'Zona Zero · sala de guerra',
            tag: key,
          });
        } catch {
          // Denied or unsupported: the banner and the panel still stand.
        }
      });
    }
  }, [warnings, jungle?.key, jungle?.remaining, boss?.key, boss?.remaining]);

  useEffect(() => () => window.clearTimeout(clearing.current), []);

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
    const imminent = [jungle, boss].some(
      (event) => event !== null && event.remaining <= WARNINGS[0].at,
    );

    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audio.current ??= new Ctor();
      await audio.current.resume();
      if (!imminent) sound(audio.current, WARNINGS[0].tone);
    } catch {
      // No audio: the notification and the panel still do their job.
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

  const Face: React.FC<{ event: Countdown | null; name: string; icon: string; colour: string }> = ({
    event,
    name,
    icon,
    colour,
  }) => {
    const close = event !== null && event.remaining <= WARNING_MS;
    return (
      <div
        className={`flex items-center gap-3 rounded-lg border px-4 py-2 ${close ? 'animate-pulse' : ''}`}
        style={{
          borderColor: event ? `${colour}${close ? 'ff' : '66'}` : '#1e293b',
          background: `${colour}${close ? '26' : '0f'}`,
        }}
      >
        <i className={`fa-solid ${icon} text-lg`} style={{ color: event ? colour : '#475569' }}></i>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-400">
            {event ? event.label : name}
          </p>
          <p
            className="text-2xl font-bold tabular-nums leading-none"
            style={{ color: event ? (close ? colour : '#e2e8f0') : '#475569' }}
          >
            {event ? clock(event.remaining) : '--:--'}
          </p>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Big enough to be caught out of the corner of an eye, and above
          everything else, because it is worth nothing a moment later. */}
      {toast && (
        // Estaba a 24 px del borde superior, es decir, debajo de la cabecera
        // pegajosa de 120 px y dentro del recorte de la pantalla: el elemento
        // más importante de la aplicación en el momento en que aparece, y el
        // peor colocado. Abajo no lo tapa nada, y además cae donde está el
        // pulgar, que es lo que hay que hacer para quitarlo de en medio.
        <div className="fixed inset-x-0 bottom-0 z-[80] flex justify-center px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pointer-events-none">
          <button
            onClick={() => setToast(null)}
            aria-live="assertive"
            className="pointer-events-auto rounded-2xl border-2 px-8 py-5 shadow-2 backdrop-blur-sm text-center animate-pulse"
            style={{
              borderColor: toast.colour,
              background: `linear-gradient(180deg, ${toast.colour}26 0%, #0b1120 100%)`,
              boxShadow: `0 0 40px ${toast.colour}55`,
            }}
          >
            <p className="cinzel text-4xl sm:text-5xl font-bold" style={{ color: toast.colour }}>
              {toast.label}
            </p>
            <p className="text-lg sm:text-xl text-slate-200 mt-1">en {toast.when}</p>
          </button>
        </div>
      )}

      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center gap-4 flex-wrap">
      <div>
        <p className="text-[10px] uppercase tracking-wider text-slate-500">En guerra</p>
        <p className="text-lg font-bold text-slate-200 tabular-nums leading-none">{clock(elapsed)}</p>
        {/* Half an hour is the whole of it, so the end is a countdown too. */}
        <p className="text-[10px] text-slate-500 tabular-nums mt-0.5">
          termina en {clock(WAR_LENGTH - elapsed)}
        </p>
      </div>

      <Face event={jungle} name="Jungla" icon="fa-leaf" colour="#a3e635" />
      <Face event={boss} name="Boss" icon="fa-dragon" colour="#f87171" />

      <div className="flex-1" />

      {mayBeWarned && (
        <button
          onClick={ask}
          title="Alarma, vibracion y notificacion un minuto y treinta segundos antes de cada temporizador, mientras esta pagina siga abierta"
          className={`text-xs font-bold px-3 py-2 rounded border transition-all flex items-center gap-2 ${
            warnings === 'on'
              ? 'border-amber-500 text-amber-400 bg-amber-500/10'
              : 'border-slate-800 text-slate-500 hover:text-slate-300'
          }`}
        >
          <i className={`fa-solid ${warnings === 'on' ? 'fa-bell' : 'fa-bell-slash'}`}></i>
          Avisos 1:00 y 0:30
        </button>
      )}
      </div>
    </>
  );
};

export default WarTimers;
