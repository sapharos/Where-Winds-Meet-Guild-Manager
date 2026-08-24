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

/** Una fila de la guerra que se está reconstruyendo. */
interface Row {
  playerId: string;
  side: WarSide;
  lane: WarLane | null;
  stats: Record<string, number>;
  /** Por qué se le puso ese bando, para poder decirlo en pantalla. */
  why: 'siege' | 'usual' | 'guess' | 'manual';
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
 * Va en dos pasos porque son dos cosas distintas: lo que fue la guerra, y
 * quién la peleó y desde dónde. Lo primero lo escribe quien la recuerda; lo
 * segundo lo resuelve la máquina y él sólo corrige.
 *
 * Ni el bando ni la línea vienen en la captura -- el juego lista a los
 * miembros con sus cifras y nada más --, así que los dos se deducen. La línea,
 * de dónde juega siempre esa persona. El bando, del daño de asedio, que sólo
 * lo puede haber hecho quien atacaba: derribar puertas es objetivo de ataque y
 * la defensa no tiene manera de producir esa cifra. Lo que la evidencia no
 * alcanza cae en lo más probable, y lo probable se corrige de un toque.
 */
const ImportWar: React.FC<Props> = ({ players, onClose, onImported }) => {
  const [step, setStep] = useState<'datos' | 'filas'>('datos');

  const [name, setName] = useState('');
  const [when, setWhen] = useState(() => localInput(new Date()));
  const [matchType, setMatchType] = useState<WarMatchType>('league');
  /**
   * Lo que el lector leyó pero no supo a quién atribuir.
   *
   * Antes se tiraban: un `.filter((r) => r.playerId)` y con la fila se iban
   * también sus cifras, sin decir nada. Quien importaba veía veintiocho
   * personas de treinta y no tenía forma de saber que faltaban dos, ni menos
   * de recuperarlas -- el «añadir a mano» que ya existía las mete con las
   * cifras en blanco, que es justo lo que no sirve.
   */
  const [pendientes, setPendientes] = useState<{ read: string; figures: Record<string, number> }[]>([]);
  const [outcome, setOutcome] = useState<WarOutcome | null>(null);

  // Las capturas, sin más: no se les pregunta de qué bando son porque la
  // pantalla del juego no lo dice y quien sube la imagen tampoco lo sabe.
  const [shots, setShots] = useState<string[]>([]);
  const [reading, setReading] = useState(false);

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
      const added = await Promise.all(blobs.map((blob) => shrink(blob)));
      setShots((prev) => [...prev, ...added]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo leer la imagen');
    }
  };

  /**
   * De qué bando peleó alguien, que la captura no dice.
   *
   * El daño de asedio es prueba y no indicio: derribar puertas es un objetivo
   * de ataque y la defensa no tiene forma de producir esa cifra, así que
   * cualquier número ahí sitúa a esa persona en ataque sin lugar a duda.
   *
   * Sin asedio no hay prueba, sólo probabilidad: puede ser un defensor o un
   * atacante que no llegó a tocar la puerta. Se recurre entonces al bando en
   * el que esa persona suele jugar, y a falta de historial se supone defensa,
   * que es lo que queda cuando no hay ni rastro de ataque.
   */
  const sideOf = (
    playerId: string,
    stats: Record<string, number>,
  ): { side: WarSide; why: Row['why'] } => {
    if ((stats.siege ?? 0) > 0) return { side: 'attack', why: 'siege' };
    const known = usual.get(playerId);
    if (known) return { side: known.side, why: 'usual' };
    return { side: 'defense', why: 'guess' };
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
  }, [step]);

  /**
   * Lo leído, ya emparejado con el gremio, pasa a ser filas.
   *
   * Todas las capturas se leen de una vez y no una por una: son páginas de una
   * misma tabla, y lo que separa a unos de otros no es en qué imagen salieron
   * sino lo que hicieron. El lector ya deduplica por persona entre imágenes.
   *
   * El bando y la línea se proponen aquí y no en el paso siguiente para que
   * lleguen puestos: el paso siguiente es para corregir, no para repartir.
   * Quien no tenga historial se queda sin línea, que es lo honesto -- inventarle
   * una sería un dato que nadie podrá distinguir después de uno real.
   */
  const collect = async (found: ReadRow[]) => {
    setRows(
      found
        .filter((r) => r.playerId)
        .map((r) => {
          const playerId = r.playerId as string;
          const { side, why } = sideOf(playerId, r.figures);
          return { playerId, side, why, lane: usual.get(playerId)?.lane ?? null, stats: r.figures };
        }),
    );
    // Lo que no se pudo emparejar se aparta, no se tira: las cifras están
    // leídas y son buenas, lo único que falta es de quién son.
    setPendientes(
      found
        .filter((r) => !r.playerId && r.read.trim())
        .map((r) => ({ read: r.read.trim(), figures: r.figures })),
    );
    setReading(false);
    setStep('filas');
  };

  /**
   * «Esta fila es esta persona.» Con sus cifras, que es el punto.
   *
   * Y si se pide, se le enseña al lector: se guarda el nombre leído como alias
   * del miembro, así que la próxima captura con ese mismo nombre --y los
   * escaneos, que comparten la tabla-- lo emparejan solos. Arreglarlo una vez
   * en vez de cada semana.
   */
  const identificar = async (read: string, figures: Record<string, number>, playerId: string, recordar: boolean) => {
    if (!playerId) return;
    setPendientes((prev) => prev.filter((p) => p.read !== read));

    setRows((prev) => {
      // Si ya estaba en la lista --añadido a mano antes, con las cifras en
      // blanco-- se le rellenan en vez de duplicar la fila.
      const ya = prev.find((r) => r.playerId === playerId);
      if (ya) {
        return prev.map((r) =>
          r.playerId === playerId ? { ...r, stats: { ...r.stats, ...figures }, ...sideOf(playerId, figures) } : r,
        );
      }
      const { side, why } = sideOf(playerId, figures);
      return [...prev, { playerId, side, why, lane: usual.get(playerId)?.lane ?? null, stats: figures }];
    });

    if (recordar) {
      // Que falle enseñar el alias no puede costar la fila, que es lo que de
      // verdad se venía a recuperar.
      await api(`/players/${playerId}/alias`, {
        method: 'POST',
        body: JSON.stringify({ alias: read }),
      }).catch(() => {});
    }
  };

  const setLane = (playerId: string, lane: WarLane | null) =>
    setRows((prev) => prev.map((r) => (r.playerId === playerId ? { ...r, lane } : r)));

  // Cambiado a mano deja de ser deducido, incluso si contradice al asedio:
  // quien estuvo ahí sabe más que la cifra, y la marca de "seguro" no puede
  // seguir puesta sobre algo que ya no dice lo que decía la prueba.
  const setSide = (playerId: string, side: WarSide) =>
    setRows((prev) =>
      prev.map((r) => (r.playerId === playerId ? { ...r, side, why: 'manual' as const } : r)),
    );

  const drop = (playerId: string) =>
    setRows((prev) => prev.filter((r) => r.playerId !== playerId));

  /** Devuelve a todo el mundo a su línea de siempre, deshaciendo los retoques. */
  const resetLanes = () =>
    setRows((prev) => prev.map((r) => ({ ...r, lane: usual.get(r.playerId)?.lane ?? null })));

  /**
   * Todos al mismo bando de un toque.
   *
   * Está aquí por si la captura resultó ser de una sola de las dos batallas:
   * entonces todas sus filas son del mismo bando, y deducirlas una a una las
   * habría repartido entre los dos. Se respeta a quien tenga asedio, que es el
   * único dato duro de la pantalla y no una suposición que convenga pisar.
   */
  const allTo = (side: WarSide) =>
    setRows((prev) =>
      prev.map((r) => (r.why === 'siege' ? r : { ...r, side, why: 'manual' as const })),
    );

  const add = (playerId: string) => {
    if (!playerId || rows.some((r) => r.playerId === playerId)) return;
    const known = usual.get(playerId);
    setRows((prev) => [
      ...prev,
      {
        playerId,
        side: known?.side ?? 'defense',
        why: known ? ('usual' as const) : ('guess' as const),
        lane: known?.lane ?? null,
        stats: {},
      },
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
          body: JSON.stringify({ image: shot }),
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
  // A cuántos les consta el bando por prueba y no por conjetura.
  const sure = rows.filter((r) => r.why === 'siege').length;

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

          {/* No se pregunta de qué bando es cada captura: la pantalla del juego
              lista a los miembros con sus cifras y no lo dice, así que
              preguntarlo era pedir un dato que nadie tiene. Se deduce después,
              del daño de asedio, y se corrige en el paso siguiente. */}
          <div className="pt-3 border-t border-slate-800">
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
              Añadir las capturas de resultados — o pégalas con Ctrl+V
            </button>

            {shots.length > 0 && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                {shots.map((shot, at) => (
                  <figure key={at} className="relative rounded overflow-hidden border border-slate-800">
                    <img src={shot} alt={`Captura ${at + 1}`} className="w-full h-20 object-cover" />
                    <button
                      type="button"
                      onClick={() => setShots((prev) => prev.filter((_, i) => i !== at))}
                      aria-label={`Quitar la captura ${at + 1}`}
                      className="absolute top-0 right-0 min-h-tap min-w-tap flex items-center justify-center text-slate-400 hover:text-red-400 bg-slate-950/70 rounded-bl"
                    >
                      <i className="fa-solid fa-xmark text-xs"></i>
                    </button>
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
              onClick={() => setReading(true)}
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
            images={shots}
            participants={players.map((p) => ({ playerId: p.id, name: p.name }))}
            title="Leer los resultados"
            subtitle="Los nombres se emparejan contra el gremio entero, bajas incluidas. Corrige lo que la lectura entendió mal antes de seguir."
            applyLabel="Aceptar"
            onClose={() => setReading(false)}
            onApply={collect}
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
      subtitle="Ni el bando ni la línea vienen en la captura, así que van deducidos. Quien hizo daño de asedio estaba atacando y eso es seguro; el resto llega donde suele jugar. Corrige lo que no cuadre."
      size="xl"
      onClose={onClose}
      footer={
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] text-slate-500">
            {rows.length} en campo
            {missing > 0 && ` · ${missing} sin línea`}
            {/*
              Y aquí también, no sólo arriba: se guarda desde el pie, y guardar
              con filas sin identificar pierde sus cifras para siempre. Que se
              vea justo al lado del botón que las pierde.
            */}
            {pendientes.length > 0 && (
              <span className="text-amber-400"> · {pendientes.length} sin identificar</span>
            )}
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

        {/* Si la captura resultó ser de una sola de las dos batallas, todas sus
            filas son del mismo bando y deducirlas una a una las habrá repartido
            entre los dos. Un toque lo arregla, y quien tenga asedio se queda
            donde está: es lo único que la pantalla dice sin lugar a duda. */}
        {rows.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-500">
            <span>
              {sure} con asedio, en Ataque seguro.{' '}
              {rows.length - sure > 0 && `Los otros ${rows.length - sure}, a lo más probable:`}
            </span>
            {rows.length - sure > 0 &&
              SIDES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => allTo(s)}
                  className="min-h-tap px-3 rounded border border-slate-800 text-slate-400 hover:border-amber-700 hover:text-amber-500 transition-all"
                >
                  Todos a {WAR_SIDE_LABELS[s]}
                </button>
              ))}
          </div>
        )}

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

              {/* El bando, con de dónde salió. Un dato deducido que se
                  presenta igual que uno sabido es un dato en el que se acaba
                  confiando de más, y de éste depende el puntaje de impacto. */}
              <button
                type="button"
                onClick={() => setSide(row.playerId, row.side === 'attack' ? 'defense' : 'attack')}
                title={
                  row.why === 'siege'
                    ? 'Hizo daño de asedio, así que estaba atacando'
                    : row.why === 'usual'
                      ? 'El bando en el que suele jugar'
                      : row.why === 'manual'
                        ? 'Puesto a mano'
                        : 'Supuesto: ni hay asedio ni hay historial'
                }
                className={`min-h-tap px-2 text-[11px] uppercase tracking-wider rounded border transition-all ${
                  row.why === 'siege'
                    ? 'border-amber-800/70 text-amber-500/90 hover:border-amber-600'
                    : 'border-dashed border-slate-700 text-slate-500 hover:border-amber-700 hover:text-amber-500'
                }`}
              >
                {row.why === 'siege' && <i className="fa-solid fa-tower-observation mr-1"></i>}
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

        {/*
          Lo que se leyó pero no se supo de quién era.

          Va ARRIBA de todo y en ámbar porque es lo único de esta pantalla que
          se pierde si nadie lo mira: sus cifras están leídas y son buenas, y en
          cuanto se guarde la guerra sin ellas ya no hay forma de recuperarlas
          salvo volver a empezar con las mismas capturas.
        */}
        {pendientes.length > 0 && (
          <section className="rounded-lg border border-amber-900/60 bg-amber-950/20 p-3 space-y-2">
            <h4 className="text-xs font-semibold text-amber-400">
              {pendientes.length === 1
                ? 'Una fila leída sin identificar'
                : `${pendientes.length} filas leídas sin identificar`}
              <span className="block font-normal text-[11px] text-slate-400 mt-0.5">
                El lector sacó sus cifras pero no reconoció el nombre. Di de quién es y se
                añaden con todo lo leído; si marcas «recordar», la próxima captura lo
                emparejará sola.
              </span>
            </h4>

            {pendientes.map((p) => (
              <FilaSinIdentificar
                key={p.read}
                pendiente={p}
                libres={free}
                onIdentificar={(playerId, recordar) =>
                  void identificar(p.read, p.figures, playerId, recordar)
                }
                onDescartar={() => setPendientes((prev) => prev.filter((x) => x.read !== p.read))}
              />
            ))}
          </section>
        )}

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

/**
 * Una fila leída de la que no se sabe quién es.
 *
 * Enseña lo que se leyó --el nombre tal cual salió, y dos cifras para poder
 * reconocerla-- y pide a quién asignarla. Las cifras importan: con treinta
 * filas, «Subaru» y «Subâru» sólo se distinguen por lo que hicieron.
 */
const FilaSinIdentificar: React.FC<{
  pendiente: { read: string; figures: Record<string, number> };
  libres: Player[];
  onIdentificar: (playerId: string, recordar: boolean) => void;
  onDescartar: () => void;
}> = ({ pendiente, libres, onIdentificar, onDescartar }) => {
  // Marcado de entrada: casi siempre es un nombre que el lector va a volver a
  // leer igual la semana que viene, así que lo normal es querer recordarlo.
  const [recordar, setRecordar] = useState(true);

  const pistas = FIGURES.filter((f) => (pendiente.figures[f.key] ?? 0) > 0)
    .slice(0, 3)
    .map((f) => `${f.label} ${pendiente.figures[f.key].toLocaleString('es')}`)
    .join(' · ');

  return (
    <div className="rounded border border-slate-800 bg-slate-900/60 p-2 space-y-2">
      <div className="min-w-0">
        <p className="text-sm text-slate-200 truncate">
          «{pendiente.read}»
        </p>
        <p className="text-[11px] text-slate-500 truncate">{pistas || 'sin cifras legibles'}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          defaultValue=""
          onChange={(e) => e.target.value && onIdentificar(e.target.value, recordar)}
          aria-label={`Quién es «${pendiente.read}»`}
          className="flex-1 min-w-40 min-h-tap bg-slate-950 border border-slate-800 rounded px-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
        >
          <option value="">— ¿quién es? —</option>
          {libres.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.isActive === false ? ' (ya no está)' : ''}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <input
            type="checkbox"
            checked={recordar}
            onChange={(e) => setRecordar(e.target.checked)}
            className="tap-suelto"
          />
          Recordar este nombre
        </label>

        {/* Descartar existe porque no todo lo que sale en la captura es del
            gremio: la tabla lista a los treinta del rival también. */}
        <button
          type="button"
          onClick={onDescartar}
          className="tap-suelto text-[11px] text-slate-500 hover:text-slate-300 underline"
        >
          No es del gremio
        </button>
      </div>
    </div>
  );
};

export default ImportWar;
