import React, { useEffect, useRef, useState } from 'react';

const MINUTE = 60_000;

/**
 * When to interrupt somebody: a minute out to get ready, thirty seconds out to
 * go. Each fires inside its own band -- opening the page twenty seconds before
 * an event should bring one warning, not both at once.
 */
const WARNINGS = [
  { at: 60_000, label: '1 minuto' },
  { at: 30_000, label: '30 segundos' },
];

/** From the first warning onwards the panel says so without being asked. */
const WARNING_MS = WARNINGS[0].at;

/** The jungle comes round again and again; the boss comes twice and is done. */
const JUNGLE_EVERY = 5 * MINUTE;
const BOSS_AT = [6 * MINUTE, 16 * MINUTE];

interface Countdown {
  key: string;
  label: string;
  remaining: number;
}

const clock = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

function nextJungle(elapsed: number): Countdown {
  const round = Math.floor(elapsed / JUNGLE_EVERY) + 1;
  return {
    key: `jungla-${round}`,
    label: `Jungla ${round}`,
    remaining: round * JUNGLE_EVERY - elapsed,
  };
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

  useEffect(() => {
    const began = Date.parse(startedAt);
    const tick = () => setElapsed(Date.now() + offset - began);
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [startedAt, offset]);

  const jungle = nextJungle(elapsed);
  const boss = nextBoss(elapsed);

  // Each warning fires once per event, and only for the people who asked.
  useEffect(() => {
    if (warnings !== 'on') return;
    for (const event of [jungle, boss]) {
      if (!event) continue;
      WARNINGS.forEach((warning, index) => {
        const floor = WARNINGS[index + 1]?.at ?? 0;
        if (event.remaining > warning.at || event.remaining <= floor) return;

        const key = `${event.key}@${warning.at}`;
        if (fired.current.has(key)) return;
        fired.current.add(key);
        try {
          new Notification(`${event.label} en ${warning.label}`, {
            body: 'Zona Zero · sala de guerra',
            tag: key,
          });
        } catch {
          // Denied or unsupported: the panel still shows the countdown.
        }
      });
    }
  }, [warnings, jungle.key, jungle.remaining, boss?.key, boss?.remaining]);

  const ask = async () => {
    if (warnings === 'on') {
      setWarnings('off');
      return;
    }
    const granted =
      typeof Notification !== 'undefined' &&
      (Notification.permission === 'granted' ||
        (await Notification.requestPermission()) === 'granted');
    setWarnings(granted ? 'on' : 'off');
  };

  const Face: React.FC<{ event: Countdown | null; icon: string; colour: string }> = ({
    event,
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
            {event ? event.label : 'Boss'}
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
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center gap-4 flex-wrap">
      <div>
        <p className="text-[10px] uppercase tracking-wider text-slate-500">En guerra</p>
        <p className="text-lg font-bold text-slate-200 tabular-nums leading-none">{clock(elapsed)}</p>
      </div>

      <Face event={jungle} icon="fa-leaf" colour="#a3e635" />
      <Face event={boss} icon="fa-dragon" colour="#f87171" />

      <div className="flex-1" />

      {mayBeWarned && (
        <button
          onClick={ask}
          title="Avisar un minuto y treinta segundos antes de cada temporizador, mientras esta pagina siga abierta"
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
  );
};

export default WarTimers;
