import React, { useEffect, useRef, useState } from 'react';
import { api } from '../services/authService';
import {
  LANE_CAPACITY,
  Player,
  WAR_LANES,
  WAR_MATCH_TYPE_LABELS,
  WAR_OUTCOME_LABELS,
  WAR_SIDE_LABELS,
  WarLane,
  WarMatchType,
  WarOutcome,
  WarSide,
} from '../types';
import ResultsReader, { ReadRow } from './ResultsReader';
import Sheet from './Sheet';
import { FIGURES, shrink } from './WarHistory';

/** Dónde suele jugar alguien, contado sobre las guerras ya registradas. */
interface UsualLane {
  playerId: string;
  side: WarSide;
  lane: WarLane;
  games: number;
}

/** Una captura a la espera de ser leída, con el bando al que pertenece. */
interface Shot {
  image: string;
  side: WarSide;
}

/** Una fila de la guerra que se está reconstruyendo. */
interface Row {
  playerId: string;
  side: WarSide;
  lane: WarLane | null;
  stats: Record<string, number>;
}

interface Props {
  players: Player[];
  onClose: () => void;
  onImported: (id: string) => void;
}

const SIDES: WarSide[] = ['attack', 'defense'];
const TYPES: WarMatchType[] = ['league', 'ranked', 'custom'];

/** El valor que quiere `datetime-local`: local, sin zona y sin segundos. */
const localInput = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
};

/** Un número largo, legible de un vistazo: 20.400.000 se lee «20,4 M». */
const brief = (value: number | undefined) => {
  if (!value) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace('.0', '')} M`;
  if (value >= 1_000) return `${Math.round(value / 1000)} k`;
  return String(value);
};

/**
 * Recuperar una guerra de la que sólo quedó el pantallazo final.
 *
 * Es el camino de vuelta para el historial que se perdió: las guerras que se
 * jugaron antes de que existiera esta pantalla, y las que se jugaron sin que a
 * nadie le diera tiempo a abrirla. Sin esto, esos meses son un hueco, y un
 * historial con huecos no contesta la única pregunta para la que sirve: quién
 * viene rindiendo y quién no.
 *
 * Va en tres pasos porque son tres cosas distintas: lo que fue la guerra, lo
 * que dice la pantalla de resultados, y dónde estaba cada uno. Los dos
 * primeros los resuelve la máquina -- el lector ya existe y se reaprovecha
 * entero. El tercero no lo sabe nadie más que quien estuvo, así que se le da
 * hecho lo más probable, la línea en la que ese jugador juega siempre, y sólo
 * tiene que corregir a los pocos que ese día se movieron.
 */
const ImportWar: React.FC<Props> = ({ players, onClose, onImported }) => {
  const [step, setStep] = useState<'datos' | 'filas'>('datos');

  const [name, setName] = useState('');
  const [when, setWhen] = useState(() => localInput(new Date()));
  const [matchType, setMatchType] = useState<WarMatchType>('league');
  const [outcome, setOutcome] = useState<WarOutcome | null>(null);

  const [shots, setShots] = useState<Shot[]>([]);
  // El bando que se le pone a lo que se suba ahora. Cada captura es de una
  // batalla, y una guerra son dos: no se puede deducir de la imagen.
  const [tagging, setTagging] = useState<WarSide>('attack');

  // La cola de lectura: el lector abre una vez por bando, porque las filas de
  // cada pantalla pertenecen a esa batalla y perder eso sería perder el bando.
  const [queue, setQueue] = useState<WarSide[]>([]);
  const [reading, setReading] = useState<WarSide | null>(null);

  const [rows, setRows] = useState<Row[]>([]);
  const [usual, setUsual] = useState<Map<string, UsualLane>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const byId = new Map(players.map((p) => [p.id, p]));
  const nameOf = (id: string) => byId.get(id)?.name ?? id;

  useEffect(() => {
    api<UsualLane[]>('/war/usual-lanes')
      .then((list) => setUsual(new Map(list.map((u) => [u.playerId, u]))))
      .catch(() => undefined);
  }, []);

  const attach = async (blobs: Blob[]) => {
    setError(null);
    try {
      const added = await Promise.all(
        blobs.map(async (blob) => ({ image: await shrink(blob), side: tagging })),
      );
      setShots((prev) => [...prev, ...added]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo leer la imagen');
    }
  };

  // Pegar es como llega de verdad una captura: se hace con el teclado y se
  // suelta aquí, sin que ningún archivo llegue a tocar el disco.
  useEffect(() => {
    if (step !== 'datos') return;
    const onPaste = (event: ClipboardEvent) => {
      const blobs: Blob[] = [];
      for (const item of event.clipboardData?.items ?? []) {
        if (!item.type.startsWith('image/')) continue;
        const blob = item.getAsFile();
        if (blob) blobs.push(blob);
      }
      if (blobs.length) {
        event.preventDefault();
        void attach(blobs);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [step, tagging]);

  /** Empieza la lectura por el primer bando que tenga capturas. */
  const read = () => {
    const pending = SIDES.filter((s) => shots.some((shot) => shot.side === s));
    if (!pending.length) return;
    setRows([]);
    setQueue(pending.slice(1));
    setReading(pending[0]);
  };

  /**
   * Lo leído de un bando, ya emparejado con el gremio, pasa a ser filas.
   *
   * La línea se propone aquí y no en el paso siguiente para que llegue
   * colocada: el paso siguiente es para corregir, no para repartir. Quien no
   * tenga historial se queda sin línea, que es lo honesto -- adivinarle una
   * sería inventar un dato que nadie podrá distinguir de uno real.
   */
  const collect = async (side: WarSide, found: ReadRow[]) => {
    setRows((prev) => {
      const already = new Set(prev.map((r) => r.playerId));
      const fresh = found
        .filter((r) => r.playerId && !already.has(r.playerId))
        .map((r) => ({
          playerId: r.playerId as string,
          side,
          lane: usual.get(r.playerId as string)?.lane ?? null,
          stats: r.figures,
        }));
      return [...prev, ...fresh];
    });

    const next = queue[0] ?? null;
    setQueue((rest) => rest.slice(1));
    setReading(next);
    if (!next) setStep('filas');
  };

  const setLane = (playerId: string, lane: WarLane | null) =>
    setRows((prev) => prev.map((r) => (r.playerId === playerId ? { ...r, lane } : r)));

  const setSide = (playerId: string, side: WarSide) =>
    setRows((prev) => prev.map((r) => (r.playerId === playerId ? { ...r, side } : r)));

  const drop = (playerId: string) =>
    setRows((prev) => prev.filter((r) => r.playerId !== playerId));

  /** Devuelve a todo el mundo a su línea de siempre, deshaciendo los retoques. */
  const resetLanes = () =>
    setRows((prev) => prev.map((r) => ({ ...r, lane: usual.get(r.playerId)?.lane ?? null })));

  const add = (playerId: string) => {
    if (!playerId || rows.some((r) => r.playerId === playerId)) return;
    const known = usual.get(playerId);
    setRows((prev) => [
      ...prev,
      { playerId, side: known?.side ?? 'attack', lane: known?.lane ?? null, stats: {} },
    ]);
  };

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const { id } = await api<{ id: string }>('/war/wars/import', {
        method: 'POST',
        body: JSON.stringify({
          name,
          matchType,
          outcome,
          startedAt: new Date(when).toISOString(),
          participants: rows,
        }),
      });
      // Las capturas van después y una a una: son el original del que salieron
      // las cifras, y quien dude de una lectura tiene que poder volver a ella.
      // Si alguna falla, la guerra ya está guardada -- que es lo que cuesta
      // rehacer -- y la imagen se puede añadir luego desde el historial.
      for (const shot of shots) {
        await api(`/war/wars/${id}/images`, {
          method: 'POST',
          body: JSON.stringify({ image: shot.image, caption: WAR_SIDE_LABELS[shot.side] }),
        }).catch(() => undefined);
      }
      onImported(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la guerra');
      setBusy(false);
    }
  };

  const ready = Boolean(when) && rows.length > 0;
  const missing = rows.filter((r) => !r.lane).length;

  /* ------------------------------------------------------------- capturas */

  if (step === 'datos') {
    return (
      <Sheet
        title="Cargar una guerra pasada"
        subtitle="De una guerra que ya se jugó sólo queda el pantallazo final. Con él y la fecha se reconstruye la entrada del historial."
        size="lg"
        onClose={onClose}
      >
        <div className="space-y-4">
          {error && (
            <div className="text-sm rounded-lg px-4 py-2 flex items-center gap-3 border bg-red-950/60 border-red-900 text-red-200">
              <i className="fa-solid fa-triangle-exclamation"></i>
              {error}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1">
                Nombre
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Guerra de gremio"
                className="w-full min-h-tap bg-slate-950 border border-slate-800 rounded px-3 text-sm outline-none focus:ring-1 focus:ring-amber-500"
              />
            </label>

            <label className="block">
              <span className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1">
                Cuándo se jugó
              </span>
              <input
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                className="w-full min-h-tap bg-slate-950 border border-slate-800 rounded px-3 text-sm outline-none focus:ring-1 focus:ring-amber-500"
              />
            </label>

            <label className="block">
              <span className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1">
                Tipo de partida
              </span>
              <select
                value={matchType}
                onChange={(e) => setMatchType(e.target.value as WarMatchType)}
                className="w-full min-h-tap bg-slate-950 border border-slate-800 rounded px-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {WAR_MATCH_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>

            <div>
              <span className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1">
                Cómo terminó
              </span>
              <div className="grid grid-cols-3 gap-1">
                {([null, 'win', 'loss'] as (WarOutcome | null)[]).map((option) => (
                  <button
                    key={option ?? 'none'}
                    type="button"
                    onClick={() => setOutcome(option)}
                    className={`min-h-tap text-sm font-bold rounded border transition-all ${
                      outcome === option
                        ? option === 'win'
                          ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10'
                          : option === 'loss'
                            ? 'border-red-500 text-red-400 bg-red-500/10'
                            : 'border-slate-500 text-slate-300 bg-slate-500/10'
                        : 'border-slate-800 text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    {option ? WAR_OUTCOME_LABELS[option] : 'No consta'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Cada captura es de una batalla, y una guerra son dos. Cuál es cuál
              no está en la imagen, así que se dice al subirla. */}
          <div className="pt-3 border-t border-slate-800">
            <div className="flex items-center gap-3 flex-wrap mb-2">
              <span className="text-[11px] uppercase tracking-wider text-slate-500">
                Estas capturas son de
              </span>
              <div className="flex gap-1">
                {SIDES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setTagging(s)}
                    className={`min-h-tap px-4 text-sm font-bold rounded border transition-all ${
                      tagging === s
                        ? 'border-amber-500 text-amber-400 bg-amber-500/10'
                        : 'border-slate-800 text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    {WAR_SIDE_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>

            <input
              ref={file}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                void attach([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => file.current?.click()}
              className="w-full min-h-tap border border-dashed border-slate-700 hover:border-amber-700 rounded-lg text-sm text-slate-400 hover:text-amber-500 transition-all flex items-center justify-center gap-2 py-4"
            >
              <i className="fa-solid fa-image"></i>
              Añadir capturas de {WAR_SIDE_LABELS[tagging]} — o pégalas con Ctrl+V
            </button>

            {shots.length > 0 && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                {shots.map((shot, at) => (
                  <figure key={at} className="relative rounded overflow-hidden border border-slate-800">
                    <img src={shot.image} alt={`Captura ${at + 1}`} className="w-full h-20 object-cover" />
                    <figcaption className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-slate-950/85 px-1.5 py-0.5">
                      <button
                        type="button"
                        onClick={() =>
                          setShots((prev) =>
                            prev.map((s, i) =>
                              i === at ? { ...s, side: s.side === 'attack' ? 'defense' : 'attack' } : s,
                            ),
                          )
                        }
                        title="Cambiar de bando"
                        className="text-[10px] uppercase tracking-wider text-amber-400 hover:text-amber-300"
                      >
                        {WAR_SIDE_LABELS[shot.side]}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShots((prev) => prev.filter((_, i) => i !== at))}
                        aria-label="Quitar la captura"
                        className="text-slate-500 hover:text-red-400"
                      >
                        <i className="fa-solid fa-xmark text-[10px]"></i>
                      </button>
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2 justify-end pt-2">
            {/* Sin capturas también se puede: una guerra que sólo se recuerda
                vale más en el historial que un hueco, aunque no traiga cifras. */}
            <button
              type="button"
              onClick={() => setStep('filas')}
              className="min-h-tap text-sm text-slate-400 hover:text-slate-200 px-4 transition-all"
            >
              Sin capturas, la escribo a mano
            </button>
            <button
              type="button"
              onClick={read}
              disabled={!shots.length || !when}
              className="min-h-tap bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-sm font-bold px-6 rounded transition-all flex items-center gap-2"
            >
              <i className="fa-solid fa-wand-magic-sparkles"></i>
              Leer {shots.length} {shots.length === 1 ? 'captura' : 'capturas'}
            </button>
          </div>
        </div>

        {reading && (
          <ResultsReader
            images={shots.filter((s) => s.side === reading).map((s) => s.image)}
            participants={players.map((p) => ({ playerId: p.id, name: p.name }))}
            title={`Leer ${WAR_SIDE_LABELS[reading]}`}
            subtitle="Los nombres se emparejan contra el gremio entero. Corrige lo que la lectura entendió mal antes de seguir."
            applyLabel="Aceptar"
            onClose={() => {
              setReading(null);
              setQueue([]);
            }}
            onApply={(found) => collect(reading, found)}
          />
        )}
      </Sheet>
    );
  }

  /* ---------------------------------------------------------------- filas */

  const free = players.filter((p) => !rows.some((r) => r.playerId === p.id));

  return (
    <Sheet
      title="Dónde estaba cada uno"
      subtitle={
        usual.size > 0
          ? 'Cada uno llega en la línea en la que juega siempre, según las guerras ya registradas. Corrige a los que ese día se movieron.'
          : 'Todavía no hay guerras registradas de las que deducir dónde juega cada uno, así que las líneas van en blanco.'
      }
      size="xl"
      onClose={onClose}
      footer={
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] text-slate-500">
            {rows.length} en campo
            {missing > 0 && ` · ${missing} sin línea`}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setStep('datos')}
            className="min-h-tap text-sm text-slate-400 hover:text-slate-200 px-4 transition-all"
          >
            Atrás
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!ready || busy}
            className="min-h-tap bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-sm font-bold px-6 rounded transition-all flex items-center gap-2"
          >
            <i className={`fa-solid ${busy ? 'fa-circle-notch fa-spin' : 'fa-floppy-disk'}`}></i>
            Guardar la guerra
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && (
          <div className="text-sm rounded-lg px-4 py-2 flex items-center gap-3 border bg-red-950/60 border-red-900 text-red-200">
            <i className="fa-solid fa-triangle-exclamation"></i>
            {error}
          </div>
        )}

        {/* Cuántos quedan en cada línea, que es lo que dice si el reparto es
            creíble: once en la roja significa que algo está mal colocado. */}
        <div className="flex items-center gap-3 flex-wrap text-[11px]">
          {SIDES.map((s) => (
            <span key={s} className="flex items-center gap-2 text-slate-500">
              <span className="uppercase tracking-wider">{WAR_SIDE_LABELS[s]}</span>
              {WAR_LANES.map((l) => {
                const held = rows.filter((r) => r.side === s && r.lane === l.id).length;
                return (
                  <span
                    key={l.id}
                    className={`tabular-nums ${held > LANE_CAPACITY ? 'text-red-400 font-bold' : ''}`}
                    style={held && held <= LANE_CAPACITY ? { color: l.colour } : undefined}
                    title={l.label}
                  >
                    {held}
                  </span>
                );
              })}
            </span>
          ))}
          {usual.size > 0 && (
            <button
              type="button"
              onClick={resetLanes}
              className="ml-auto text-slate-500 hover:text-amber-500 transition-colors"
            >
              <i className="fa-solid fa-rotate-left mr-1"></i>
              Volver a donde suelen jugar
            </button>
          )}
        </div>

        {rows.length === 0 && (
          <p className="text-sm text-slate-500 py-4 text-center">
            Nadie todavía. Añádelos abajo.
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <article
              key={row.playerId}
              className="rounded-md border border-slate-800 bg-slate-950/40 px-3 py-2 flex items-center gap-3 flex-wrap"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-100 truncate">{nameOf(row.playerId)}</p>
                <p className="text-meta text-slate-500 truncate">
                  {FIGURES.filter((f) => row.stats[f.key]).length === 0
                    ? 'Sin cifras'
                    : `${brief(row.stats.damage)} daño · ${brief(row.stats.healing)} cura · ${
                        row.stats.kills ?? 0
                      } kills`}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSide(row.playerId, row.side === 'attack' ? 'defense' : 'attack')}
                title="Cambiar de bando"
                className="min-h-tap px-2 text-[11px] uppercase tracking-wider rounded border border-slate-800 text-slate-400 hover:border-amber-700 hover:text-amber-500 transition-all"
              >
                {WAR_SIDE_LABELS[row.side]}
              </button>

              {/* Botones y no un desplegable: son tres opciones y esta es la
                  pantalla donde se tocan treinta veces seguidas. */}
              <div className="flex gap-1">
                {WAR_LANES.map((l) => {
                  const on = row.lane === l.id;
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => setLane(row.playerId, on ? null : l.id)}
                      title={l.label}
                      aria-label={`${l.label} para ${nameOf(row.playerId)}`}
                      aria-pressed={on}
                      className="min-h-tap min-w-tap rounded border transition-all flex items-center justify-center"
                      style={{
                        borderColor: on ? l.colour : 'rgb(30 41 59)',
                        backgroundColor: on ? `${l.colour}1a` : undefined,
                        color: on ? l.colour : 'rgb(100 116 139)',
                      }}
                    >
                      <i className={`fa-solid ${on ? 'fa-circle' : 'fa-circle-notch'} text-[10px]`}></i>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => drop(row.playerId)}
                aria-label={`Quitar a ${nameOf(row.playerId)}`}
                className="min-h-tap min-w-tap flex items-center justify-center rounded text-slate-600 hover:text-red-400 transition-colors"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </article>
          ))}
        </div>

        {/* A quien la lectura no vio -- tapado por un icono, o de una página
            que ya nadie tiene -- se le añade a mano, sin cifras. Estuvo. */}
        <label className="block pt-2 border-t border-slate-800">
          <span className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1">
            Añadir a alguien que la lectura no vio
          </span>
          <select
            value=""
            onChange={(e) => add(e.target.value)}
            className="w-full min-h-tap bg-slate-950 border border-slate-800 rounded px-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
          >
            <option value="">— elige un miembro —</option>
            {free.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isActive === false ? ' (ya no está)' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Sheet>
  );
};

export default ImportWar;
