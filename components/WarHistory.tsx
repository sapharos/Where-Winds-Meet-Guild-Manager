import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/authService';
import { expectationOf, impactOf, impactShade } from '../services/impact';
import {
  Player,
  WAR_LANES,
  WAR_MATCH_TYPE_LABELS,
  WAR_OUTCOME_LABELS,
  WAR_SIDE_LABELS,
  WarLane,
  WarMatchType,
  WarOutcome,
  WarSide,
  WeaponSet,
} from '../types';
import ImportWar from './ImportWar';
import MissedSwaps from './MissedSwaps';
import ResultsReader, { ReadRow } from './ResultsReader';
import FigureCell from './FigureCell';
import { SetBadge } from './BuildEditor';
import Sheet from './Sheet';
import WarVods from './WarVods';

interface WarRow {
  id: string;
  name: string;
  startedAt: string;
  endedAt: string | null;
  outcome: WarOutcome | null;
  matchType: WarMatchType;
  /** Reconstruida desde sus capturas en vez de arbitrada en vivo. */
  imported: boolean;
  participants: number;
  images: number;
  /** Grabaciones publicadas y todavía con vídeo. Ver docs/VODS.md. */
  vods: number;
}

interface Participant {
  playerId: string;
  name: string;
  side: WarSide;
  /**
   * Nula cuando no consta: una guerra cargada desde su pantallazo final sabe
   * quién peleó, nunca dónde estaba, y meses después nadie lo recuerda.
   */
  lane: WarLane | null;
  /** Cuándo se salió, si se salió antes de que acabara. */
  leftAt: string | null;
  /** Cuándo entró, si entró a mitad para cubrir a alguien. */
  joinedAt: string | null;
  /** The build the war froze for them, if one was chosen before it started. */
  buildId: string | null;
  /**
   * What they actually fought with, resolved on the server from that frozen
   * build and falling back to their primary. Resolved there rather than here
   * so the crests and the score can never disagree about what someone carried.
   */
  weapons: string[];
  contribution: number | null;
  stats: Record<string, number>;
}

interface WarImage {
  id: string;
  image: string;
  caption: string | null;
}

interface Detail extends Omit<WarRow, 'participants' | 'images'> {
  participants: Participant[];
  images: WarImage[];
}

/**
 * The results screen's own columns, in its own order.
 *
 * The game heads two of them "Derrotado" -- kills and deaths -- so they are
 * named here for what they are rather than for what the screen calls them.
 */
export const FIGURES: { key: string; label: string }[] = [
  { key: 'kills', label: 'Kills' },
  { key: 'assists', label: 'Asistencias' },
  { key: 'deaths', label: 'Muertes' },
  { key: 'coin', label: 'Monedas' },
  { key: 'damage', label: 'Daño' },
  { key: 'taken', label: 'Daño recibido' },
  { key: 'healing', label: 'Curación' },
  { key: 'siege', label: 'Daño de asedio' },
];

const when = (iso: string) =>
  new Date(iso).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });

const minutes = (from: string, to: string | null) =>
  to ? `${Math.round((Date.parse(to) - Date.parse(from)) / 60000)} min` : 'en curso';

/**
 * Shrunk before it is sent. A results screen is three or four megabytes of PNG
 * and nothing in it needs that: the figures have to be legible to a reader and
 * to whatever reads them later, which a wide JPEG manages at a tenth the size.
 */
export async function shrink(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

interface Props {
  canEdit: boolean;
  weaponSets: WeaponSet[];
  /** El gremio, para emparejar los nombres de una guerra que se carga entera. */
  players: Player[];
  /** Las grabaciones. Ver docs/VODS.md. */
  canUploadVod: boolean;
  canApproveVod: boolean;
  canPinVod: boolean;
  canDeleteVod: boolean;
  /** La ficha de quien mira, para saber cuál de las grabaciones es la suya. */
  miPlayerId: string | null;
  /** Su cuenta, que es lo que firma las marcas de los vídeos. */
  miUserId: string | null;
  /**
   * Como página de la aplicación en vez de como hoja encima de la Sala de
   * Guerra. Es el mismo contenido y a propósito: repasar una guerra y repartir
   * la formación de la siguiente son tareas distintas, pero el historial que se
   * mira es el mismo, y tener dos copias sería garantizar que se separan.
   */
  comoPagina?: boolean;
  onClose: () => void;
  /**
   * Something changed here that the board behind is also showing. Deleting the
   * war in progress is the case that matters: without telling the board, it
   * would go on displaying a war that no longer exists, with both formations
   * still frozen by it.
   */
  onChanged: () => void;
}

/**
 * What the wars left behind: who was there, what they did, and the screens the
 * game showed at the end.
 */
const WarHistory: React.FC<Props> = ({
  canEdit,
  weaponSets,
  players,
  canUploadVod,
  canApproveVod,
  canPinVod,
  canDeleteVod,
  miPlayerId,
  miUserId,
  comoPagina,
  onClose,
  onChanged,
}) => {
  const [wars, setWars] = useState<WarRow[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  // Lo leído, esperando a que se decidan los cambios que nadie apuntó. No se
  // guarda nada hasta entonces: media lectura escrita sería peor que ninguna.
  const [pending, setPending] = useState<ReadRow[] | null>(null);
  // Impact first, because a results table nobody ordered is read top to bottom
  // looking for who mattered, and that is the column that answers it.
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: 'impact', desc: true });
  const drop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<WarRow[]>('/war/wars')
      .then(setWars)
      .catch(() => setWars([]));
  }, []);

  const load = async (id: string) => {
    setDetail(await api<Detail>(`/war/wars/${id}`).catch(() => null));
  };

  useEffect(() => {
    if (chosen) void load(chosen);
  }, [chosen]);

  const attach = async (blob: Blob) => {
    if (!chosen) return;
    setMessage(null);
    try {
      const image = await shrink(blob);
      await api(`/war/wars/${chosen}/images`, { method: 'POST', body: JSON.stringify({ image }) });
      await load(chosen);
      setMessage({ text: 'Imagen guardada.', ok: true });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'No se pudo guardar', ok: false });
    }
  };

  // Pasting is how a screenshot actually arrives: the game is captured with
  // the keyboard and dropped straight in, with no file ever hitting the disk.
  useEffect(() => {
    if (!canEdit) return;
    const onPaste = (event: ClipboardEvent) => {
      for (const item of event.clipboardData?.items ?? []) {
        if (!item.type.startsWith('image/')) continue;
        const blob = item.getAsFile();
        if (blob) {
          event.preventDefault();
          void attach(blob);
        }
        return;
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [canEdit, chosen]);

  // Arrow keys, because a carousel that only answers to the mouse makes you
  // reach for it once per page while reading five of them.
  useEffect(() => {
    if (zoom === null || !detail) return;
    const total = detail.images.length;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') setZoom((at) => ((at ?? 0) - 1 + total) % total);
      if (event.key === 'ArrowRight') setZoom((at) => ((at ?? 0) + 1) % total);
      if (event.key === 'Escape') setZoom(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoom, detail]);

  const removeImage = async (imageId: string) => {
    if (!chosen || !window.confirm('¿Borrar esta imagen?')) return;
    await api(`/war/wars/${chosen}/images/${imageId}`, { method: 'DELETE' }).catch(() => undefined);
    await load(chosen);
  };

  /**
   * The crests for what somebody carried.
   *
   * Distinct sets rather than one icon per weapon: a build of four weapons is
   * two pairs, and showing the same crest twice says nothing extra.
   */
  const setsCarried = useMemo(
    () =>
      (weapons: string[]): WeaponSet[] => {
        const found = new Map<string, WeaponSet>();
        for (const weapon of weapons ?? []) {
          const set = weaponSets.find((s) => s.weapons.includes(weapon));
          if (set) found.set(set.id, set);
        }
        return [...found.values()];
      },
    [weaponSets],
  );

  // Recomputed as figures are typed, so a correction shows its effect at once.
  // Also as the sets change, since what a set is expected to reach is part of
  // the sum now.
  const scores = useMemo(() => {
    const rows = (detail?.participants ?? []).map((p) => ({
      ...p,
      expects: expectationOf(p.weapons, weaponSets),
    }));
    return new Map(impactOf(rows).map((row) => [row.playerId, row.score]));
  }, [detail, weaponSets]);

  /**
   * The rows in the order asked for.
   *
   * A missing figure sorts as if it were nothing rather than as zero: somebody
   * whose row was never read should not be ranked above somebody who genuinely
   * healed nothing, and the two look identical once you call them both 0.
   */
  const ordered = useMemo(() => {
    const rows = [...(detail?.participants ?? [])];
    const of = (p: Participant): string | number => {
      if (sort.key === 'name') return p.name.toLowerCase();
      if (sort.key === 'side') return p.side;
      // Sin línea va al final ordenando de la A a la Z: "no consta" no es una
      // línea más, y ponerla entre la amarilla y la roja la haría parecerlo.
      if (sort.key === 'lane') return p.lane ?? 'zzz';
      if (sort.key === 'impact') return scores.get(p.playerId) ?? 0;
      return p.stats?.[sort.key] ?? -1;
    };
    return rows.sort((a, b) => {
      const left = of(a);
      const right = of(b);
      const gap =
        typeof left === 'string' && typeof right === 'string'
          ? left.localeCompare(right)
          : Number(left) - Number(right);
      return (sort.desc ? -gap : gap) || a.name.localeCompare(b.name);
    });
  }, [detail, scores, sort]);

  // Numbers open on their biggest, names on their first letter -- whichever way
  // round the reader would have clicked twice to reach.
  const sortBy = (key: string) =>
    setSort((current) =>
      current.key === key
        ? { key, desc: !current.desc }
        : { key, desc: key !== 'name' && key !== 'side' },
    );

  /**
   * Both are decided in the rush of starting a war, so both are the fields most
   * likely to need a correction afterwards. The list is patched in place rather
   * than reloaded, so a correction does not scroll the reader away from it.
   */
  const amend = async (changes: {
    name?: string;
    matchType?: WarMatchType;
    outcome?: WarOutcome | null;
  }) => {
    if (!chosen) return;
    setDetail((prev) => (prev ? { ...prev, ...changes } : prev));
    setWars((prev) => (prev ?? []).map((w) => (w.id === chosen ? { ...w, ...changes } : w)));
    await api(`/war/wars/${chosen}`, { method: 'PATCH', body: JSON.stringify(changes) }).catch((err) =>
      setMessage({ text: err instanceof Error ? err.message : 'No se pudo guardar', ok: false }),
    );
  };

  /**
   * A war that should not exist has nothing worth keeping -- but it takes the
   * results screens and everyone's figures with it, so the warning says exactly
   * what is about to be lost rather than asking a vague "are you sure".
   */
  const remove = async () => {
    if (!detail || !chosen) return;
    const cost = [
      `${detail.participants.length} participantes`,
      detail.images.length > 0 ? `${detail.images.length} capturas` : null,
    ]
      .filter(Boolean)
      .join(' y ');
    if (!window.confirm(`¿Borrar «${detail.name}»? Se pierden sus ${cost}. No se puede deshacer.`)) {
      return;
    }
    try {
      await api(`/war/wars/${chosen}`, { method: 'DELETE' });
      const left = (wars ?? []).filter((w) => w.id !== chosen);
      setWars(left);
      setDetail(null);
      setChosen(null);
      setMessage({ text: 'Guerra borrada.', ok: true });
      onChanged();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'No se pudo borrar', ok: false });
    }
  };

  /**
   * Las cifras leídas, escritas una a una.
   *
   * Sale del lector para poder llamarse dos veces: directamente cuando todas
   * las filas son de gente que ya figura, y después de registrar los cambios
   * cuando no. Recarga al final porque los cambios habrán movido el acta, y
   * porque el puntaje de impacto se recalcula sobre todo el reparto.
   */
  const saveRows = async (rows: ReadRow[]) => {
    for (const row of rows) {
      if (!row.playerId) continue;
      await api(`/war/wars/${chosen}/participants/${row.playerId}`, {
        method: 'PATCH',
        body: JSON.stringify({ stats: row.figures }),
      }).catch(() => undefined);
    }
    if (chosen) await load(chosen);
    setMessage({ text: `${rows.length} filas guardadas.`, ok: true });
  };

  const setFigure = async (playerId: string, key: string, value: number | null) => {
    if (!chosen) return;
    setDetail((prev) =>
      prev
        ? {
            ...prev,
            participants: prev.participants.map((p) =>
              p.playerId === playerId
                ? { ...p, stats: { ...p.stats, [key]: value as number } }
                : p,
            ),
          }
        : prev,
    );
    await api(`/war/wars/${chosen}/participants/${playerId}`, {
      method: 'PATCH',
      body: JSON.stringify({ stats: { [key]: value } }),
    }).catch((err) =>
      setMessage({ text: err instanceof Error ? err.message : 'No se pudo guardar', ok: false }),
    );
  };

  const cuerpo = (
    <>
      <div ref={drop} className="space-y-4">
          {message && (
            <div
              className={`text-sm rounded-lg px-4 py-2 flex items-center gap-3 border ${
                message.ok
                  ? 'bg-emerald-950/60 border-emerald-900 text-emerald-200'
                  : 'bg-red-950/60 border-red-900 text-red-200'
              }`}
            >
              <i className={`fa-solid ${message.ok ? 'fa-circle-check' : 'fa-triangle-exclamation'}`}></i>
              {message.text}
            </div>
          )}

          {!wars && <p className="text-sm text-slate-500">Cargando...</p>}
          {wars?.length === 0 && (
            <p className="text-sm text-slate-500">Todavía no se ha librado ninguna guerra.</p>
          )}

          {/* Arriba y no al final de la lista: de las guerras que faltan por
              cargar suele haber muchas seguidas, y buscar el botón bajo cien
              filas cada vez es lo que hace que se cargue una sola. */}
          {!chosen && canEdit && wars && (
            <button
              onClick={() => setImporting(true)}
              className="w-full min-h-tap border border-dashed border-slate-700 hover:border-amber-700 rounded-lg text-sm text-slate-400 hover:text-amber-500 transition-all flex items-center justify-center gap-2 py-3"
            >
              <i className="fa-solid fa-clock-rotate-left"></i>
              Cargar una guerra pasada desde su captura
            </button>
          )}

          {/* The list until one is picked. A war brings thirty rows and five
              screens with it, and opening the newest for you buries the rest. */}
          {!chosen && wars && wars.length > 0 && (
            <div className="flex flex-col gap-2">
              {wars.map((w) => (
                <button
                  key={w.id}
                  onClick={() => setChosen(w.id)}
                  className="text-left rounded-lg border border-slate-800 hover:border-amber-700 hover:bg-slate-800/40 px-4 py-3 transition-all flex items-center gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-slate-200">{w.name}</p>
                      <span className="text-[9px] uppercase tracking-wider text-slate-500 border border-slate-700 rounded px-1 py-0.5">
                        {WAR_MATCH_TYPE_LABELS[w.matchType]}
                      </span>
                      {w.outcome && (
                        <span
                          className={`text-[9px] uppercase tracking-wider font-bold rounded px-1 py-0.5 border ${
                            w.outcome === 'win'
                              ? 'border-emerald-700 text-emerald-400 bg-emerald-500/10'
                              : 'border-red-800 text-red-400 bg-red-500/10'
                          }`}
                        >
                          {WAR_OUTCOME_LABELS[w.outcome]}
                        </span>
                      )}
                      {/* Dicho, porque cambia lo que se puede esperar del
                          registro: sin plan, con líneas que pueden faltar y
                          con cifras que alguien leyó meses después. */}
                      {w.imported && (
                        <span
                          title="Reconstruida desde sus capturas"
                          className="text-[9px] uppercase tracking-wider text-slate-500 border border-slate-700 rounded px-1 py-0.5"
                        >
                          <i className="fa-solid fa-clock-rotate-left mr-1"></i>
                          Cargada
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {when(w.startedAt)} · {minutes(w.startedAt, w.endedAt)} · {w.participants} en campo
                      {w.images > 0 && ` · ${w.images} capturas`}
                    </p>
                    {/*
                      Que se pueda ver desde el listado cuáles tienen
                      grabación: es la razón por la que alguien abre un acta
                      vieja, y sin la pista hay que entrar en cada una a
                      probar suerte. En ámbar y no en gris para que destaque
                      entre los datos de siempre.
                    */}
                    {w.vods > 0 && (
                      <p className="text-[11px] text-amber-400 mt-0.5 flex items-center gap-1.5">
                        <i className="fa-solid fa-video text-[10px]" aria-hidden="true" />
                        {w.vods === 1 ? '1 grabación' : `${w.vods} grabaciones`}
                        {w.vods > 1 && (
                          <span className="text-slate-500">· se pueden ver a la vez</span>
                        )}
                      </p>
                    )}
                  </div>
                  <i className="fa-solid fa-chevron-right text-slate-600 text-xs shrink-0"></i>
                </button>
              ))}
            </div>
          )}

          {chosen && (
            <button
              onClick={() => {
                setChosen(null);
                setDetail(null);
              }}
              className="text-xs text-slate-500 hover:text-amber-500 transition-all flex items-center gap-2"
            >
              <i className="fa-solid fa-arrow-left"></i>
              Volver al listado
            </button>
          )}

          {detail && (
            <>
              {canEdit && (
                <div className="flex items-end gap-3 flex-wrap bg-slate-950/40 border border-slate-800 rounded-lg p-3">
                  <div className="flex-1 min-w-[180px]">
                    <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                      Nombre
                    </label>
                    <input
                      type="text"
                      defaultValue={detail.name}
                      key={detail.id}
                      onBlur={(e) => {
                        const name = e.target.value.trim();
                        if (name && name !== detail.name) void amend({ name });
                        else e.target.value = detail.name;
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                      Tipo de partida
                    </label>
                    <select
                      value={detail.matchType}
                      onChange={(e) => void amend({ matchType: e.target.value as WarMatchType })}
                      className="bg-slate-950 border border-slate-800 rounded px-2 py-[5px] text-sm outline-none focus:ring-1 focus:ring-amber-500"
                    >
                      {(Object.keys(WAR_MATCH_TYPE_LABELS) as WarMatchType[]).map((type) => (
                        <option key={type} value={type}>
                          {WAR_MATCH_TYPE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                      Resultado
                    </label>
                    <select
                      value={detail.outcome ?? ''}
                      onChange={(e) =>
                        void amend({ outcome: (e.target.value || null) as WarOutcome | null })
                      }
                      className={`bg-slate-950 border rounded px-2 py-[5px] text-sm outline-none focus:ring-1 focus:ring-amber-500 ${
                        detail.outcome === 'win'
                          ? 'border-emerald-700 text-emerald-400'
                          : detail.outcome === 'loss'
                            ? 'border-red-800 text-red-400'
                            : 'border-slate-800 text-slate-400'
                      }`}
                    >
                      <option value="">Sin marcar</option>
                      {(Object.keys(WAR_OUTCOME_LABELS) as WarOutcome[]).map((option) => (
                        <option key={option} value={option}>
                          {WAR_OUTCOME_LABELS[option]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={remove}
                    title="Borrar esta guerra y todo lo registrado en ella"
                    className="text-xs text-slate-500 hover:text-red-400 border border-slate-800 hover:border-red-900 rounded px-3 py-1.5 transition-all flex items-center gap-2"
                  >
                    <i className="fa-solid fa-trash-can"></i>
                    Borrar guerra
                  </button>
                </div>
              )}


              {/*
                Las grabaciones van LAS PRIMERAS.

                Antes abrían las capturas de resultados y no es lo que se viene
                a ver: una captura es el material de trabajo de quien apunta las
                cifras --se mira una vez, se transcribe y no se vuelve-- y una
                grabación es lo que alguien abre el acta para mirar. Quien
                anota sigue teniendo las suyas a una pulsación, plegadas justo
                debajo.
              */}
              <WarVods
                warId={detail.id}
                nombres={Object.fromEntries(players.map((p) => [p.id, p.name]))}
                miPlayerId={miPlayerId}
                miUserId={miUserId}
                puedeEditar={canEdit}
                puedeSubir={canUploadVod}
                puedeAprobar={canApproveVod}
                puedeFijar={canPinVod}
                puedeBorrarVod={canDeleteVod}
                participantes={detail.participants.map((p) => ({ id: p.playerId, nombre: p.name }))}
              />

              {/*
                Plegada, y con `<details>` en vez de estado propio por lo mismo
                que Seccion.tsx: el navegador ya sabe hacerlo con el teclado, lo
                anuncia un lector de pantalla y el buscador del navegador
                encuentra texto dentro aunque esté cerrada.

                Los botones van DENTRO y no en el tirador: pulsar cualquier cosa
                de un `<summary>` abre y cierra la sección, así que «Subir
                imagen» la habría cerrado en la cara de quien iba a usarla.
              */}
              <details className="group/cap">
                <summary className="list-none cursor-pointer min-h-tap flex items-center gap-2 text-sm font-bold text-slate-300">
                  <i className="fa-solid fa-chevron-right text-[10px] text-slate-600 transition-transform duration-micro group-open/cap:rotate-90" aria-hidden="true" />
                  Resultados
                  <span className="font-normal text-slate-500">
                    {detail.images.length === 0
                      ? 'sin capturas'
                      : detail.images.length === 1
                        ? '1 captura'
                        : `${detail.images.length} capturas`}
                  </span>
                </summary>

                <div className="mt-2">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                  {canEdit && (
                    <div className="flex items-center gap-4">
                      {detail.images.length > 0 && (
                        <button
                          onClick={() => setReading(true)}
                          title="Leer las cifras de las capturas. La primera vez descarga el lector."
                          className="text-xs text-slate-500 hover:text-amber-500 transition-all"
                        >
                          <i className="fa-solid fa-wand-magic-sparkles mr-1.5"></i>
                          Leer resultados
                        </button>
                      )}
                    <label className="text-xs text-slate-500 hover:text-amber-500 cursor-pointer transition-all">
                      <i className="fa-solid fa-image mr-1.5"></i>
                      Subir imagen
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void attach(file);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    </div>
                  )}
                </div>

                {detail.images.length === 0 ? (
                  <p className="text-sm text-slate-500 border border-dashed border-slate-800 rounded-lg py-6 px-4 text-center">
                    {/* Decía «pulsa Ctrl+V» a quien está en un teléfono, que no
                        tiene esa tecla -- y el botón para subir la imagen
                        llevaba ahí todo el tiempo, dos líneas más arriba. */}
                    {canEdit
                      ? 'Sin capturas todavía. Usa «Subir imagen», o pega la captura con Ctrl+V si estás en un ordenador.'
                      : 'Sin capturas de resultados.'}
                  </p>
                ) : (
                  <div className="grid sm:grid-cols-3 gap-3">
                    {detail.images.map((img, at) => (
                      <div key={img.id} className="relative group">
                        <img
                          src={img.image}
                          alt="Resultados"
                          onClick={() => setZoom(at)}
                          className="w-full rounded border border-slate-800 cursor-zoom-in"
                        />
                        {canEdit && (
                          // Era `opacity-0 group-hover:opacity-100`: en una
                          // pantalla táctil no hay hover, así que borrar una
                          // captura era sencillamente imposible desde el
                          // teléfono. Ahora se ve siempre, y mide 44.
                          <button
                            onClick={() => removeImage(img.id)}
                            aria-label="Borrar esta captura"
                            className="absolute top-1 right-1 min-h-tap min-w-tap flex items-center justify-center rounded-md bg-slate-950/80 border border-slate-800 text-slate-300 hover:text-red-400 transition-colors duration-micro"
                          >
                            <i className="fa-solid fa-trash-can"></i>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                </div>
              </details>

              <section>
                <h3 className="text-sm font-bold text-slate-300 mb-2">
                  Participantes ({detail.participants.length})
                  <span className="ml-2 text-[11px] font-normal text-slate-500">
                    · el impacto se calcula contra el resto de esta misma guerra
                  </span>
                </h3>
                {/*
                  Una tarjeta por participante en el móvil, la tabla desde md.

                  Once columnas dentro de una hoja de 343 px no se leen: había
                  que arrastrar de lado y, en cuanto lo hacías, perdías el
                  nombre y quedaban cifras sin dueño. La tarjeta pone delante lo
                  que se viene a mirar -- quién, de qué bando y qué impacto -- y
                  deja las ocho cifras debajo, en rejilla y con su etiqueta al
                  lado, que además es lo que las hace editables con el dedo.
                */}
                <div className="flex flex-col gap-2 md:hidden">
                  <label className="flex items-center gap-2 text-meta text-slate-500">
                    Ordenar por
                    <select
                      value={sort.key}
                      onChange={(e) => sortBy(e.target.value)}
                      className="flex-1 min-h-tap bg-slate-950 border border-slate-800 rounded px-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
                    >
                      <option value="impact">Impacto</option>
                      <option value="name">Miembro</option>
                      <option value="side">Bando</option>
                      {FIGURES.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {ordered.map((p) => (
                    <article
                      key={p.playerId}
                      className="rounded-md border border-slate-800 bg-slate-950/40 p-3"
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1 shrink-0">
                          {setsCarried(p.weapons).map((set) => (
                            <SetBadge key={set.id} set={set} size={14} />
                          ))}
                        </span>
                        <span className="flex-1 min-w-0 truncate text-slate-100 font-semibold">
                          {p.name}
                          {p.leftAt && (
                            <i
                              className="fa-solid fa-arrow-right-from-bracket text-red-500/70 text-[10px] ml-1.5"
                              title="Se salió antes de que acabara"
                            ></i>
                          )}
                          {p.joinedAt && (
                            <i
                              className="fa-solid fa-arrow-right-to-bracket text-emerald-500/70 text-[10px] ml-1.5"
                              title="Entró a mitad de la guerra"
                            ></i>
                          )}
                        </span>
                        <span className="text-meta text-slate-500">
                          {WAR_SIDE_LABELS[p.side]}
                          {p.lane && (
                            <span
                              className="ml-1.5"
                              style={{ color: WAR_LANES.find((l) => l.id === p.lane)?.colour }}
                            >
                              {WAR_LANES.find((l) => l.id === p.lane)?.label}
                            </span>
                          )}
                        </span>
                        <span
                          className="text-lg font-bold tabular-nums"
                          style={{ color: impactShade(scores.get(p.playerId) ?? 0) }}
                        >
                          {scores.get(p.playerId) ?? 0}
                        </span>
                      </div>

                      {/* Igual que en Mis guerras: una columna hasta 400 px, dos
                          a partir de ahí. En dos, "Daño de asedio" se recortaba
                          a "Daño d..." y quedaba indistinguible de "Daño". */}
                      <div className="mt-2 grid grid-cols-1 xs:grid-cols-2 gap-x-4 gap-y-1">
                        {FIGURES.map((f) => (
                          <div key={f.key} className="flex items-baseline justify-between gap-2">
                            <span className="text-[11px] uppercase tracking-wider text-slate-500 leading-tight">
                              {f.label}
                            </span>
                            <FigureCell
                              value={p.stats?.[f.key]}
                              readOnly={!canEdit}
                              onChange={(value) => setFigure(p.playerId, f.key, value)}
                            />
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>

                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-slate-500 text-left">
                        {[
                          { key: 'name', label: 'Miembro', right: false },
                          { key: 'side', label: 'Bando', right: false },
                          { key: 'lane', label: 'Línea', right: false },
                          { key: 'impact', label: 'Impacto', right: true },
                          ...FIGURES.map((f) => ({ key: f.key, label: f.label, right: true })),
                        ].map((column) => (
                          <th
                            key={column.key}
                            onClick={() => sortBy(column.key)}
                            title={`Ordenar por ${column.label}`}
                            className={`py-1 pr-3 cursor-pointer select-none hover:text-slate-300 transition-colors ${
                              column.right ? 'text-right' : ''
                            } ${sort.key === column.key ? 'text-amber-500' : ''}`}
                          >
                            {column.label}
                            {sort.key === column.key && (
                              <i
                                className={`fa-solid ${sort.desc ? 'fa-caret-down' : 'fa-caret-up'} ml-1`}
                              ></i>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ordered.map((p) => (
                        <tr key={p.playerId} className="border-t border-slate-800/70">
                          <td className="py-1 pr-3 text-slate-200">
                            <span className="flex items-center gap-1.5">
                              <span className="flex items-center gap-1 w-9 shrink-0">
                                {setsCarried(p.weapons).map((set) => (
                                  <SetBadge key={set.id} set={set} size={14} />
                                ))}
                              </span>
                              {p.name}
                              {/* Quien no peleó la guerra entera lo dice aquí:
                                  sus cifras son de menos minutos que las del
                                  resto, y compararlas sin saberlo engaña. */}
                              {p.leftAt && (
                                <i
                                  className="fa-solid fa-arrow-right-from-bracket text-red-500/70 text-[10px]"
                                  title="Se salió antes de que acabara"
                                ></i>
                              )}
                              {p.joinedAt && (
                                <i
                                  className="fa-solid fa-arrow-right-to-bracket text-emerald-500/70 text-[10px]"
                                  title="Entró a mitad de la guerra"
                                ></i>
                              )}
                            </span>
                          </td>
                          <td className="py-1 pr-3 text-[11px] text-slate-500">
                            {WAR_SIDE_LABELS[p.side]}
                          </td>
                          {/* La línea se guardaba desde siempre y no se
                              enseñaba en ninguna parte, que es exactamente lo
                              que se va a mirar de una guerra de hace meses. */}
                          <td className="py-1 pr-3 text-[11px] whitespace-nowrap">
                            {p.lane ? (
                              <span style={{ color: WAR_LANES.find((l) => l.id === p.lane)?.colour }}>
                                {WAR_LANES.find((l) => l.id === p.lane)?.label}
                              </span>
                            ) : (
                              <span className="text-slate-700" title="No consta">
                                —
                              </span>
                            )}
                          </td>
                          <td
                            className="py-1 pr-3 text-right font-bold tabular-nums"
                            style={{ color: impactShade(scores.get(p.playerId) ?? 0) }}
                          >
                            {scores.get(p.playerId) ?? 0}
                          </td>
                          {FIGURES.map((f) => (
                            <td key={f.key} className="py-1 pr-3 text-right">
                              <FigureCell
                                value={p.stats?.[f.key]}
                                readOnly={!canEdit}
                                onChange={(value) => setFigure(p.playerId, f.key, value)}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
      </div>

      {importing && (
        <ImportWar
          players={players}
          onClose={() => setImporting(false)}
          onImported={async (id) => {
            setImporting(false);
            setWars(await api<WarRow[]>('/war/wars').catch(() => wars));
            // Se abre la recién cargada: es donde se comprueba que quedó bien,
            // y buscarla en una lista de cien no es comprobar nada.
            setChosen(id);
            setMessage({ text: 'Guerra cargada.', ok: true });
          }}
        />
      )}

      {reading && detail && (
        <ResultsReader
          images={detail.images.map((i) => i.image)}
          participants={detail.participants.map((p) => ({ playerId: p.playerId, name: p.name }))}
          others={players
            .filter((p) => !detail.participants.some((q) => q.playerId === p.id))
            .map((p) => ({ playerId: p.id, name: p.name }))}
          onClose={() => setReading(false)}
          onApply={async (rows) => {
            const known = new Set(detail.participants.map((p) => p.playerId));
            const extras = rows.filter((r) => r.playerId && !known.has(r.playerId));
            setReading(false);
            // Alguien a quien el acta no menciona no puede recibir sus cifras
            // todavía: primero hay que decir por quién entró, que es lo que le
            // da bando y línea. Las filas esperan a que se decida.
            if (extras.length) {
              setPending(rows);
              return;
            }
            await saveRows(rows);
          }}
        />
      )}

      {pending && detail && (
        <MissedSwaps
          extras={pending
            .filter((r) => r.playerId && !detail.participants.some((p) => p.playerId === r.playerId))
            .map((r) => ({
              playerId: r.playerId as string,
              name: players.find((p) => p.id === r.playerId)?.name ?? r.read,
            }))}
          absent={detail.participants
            .filter((p) => !pending.some((r) => r.playerId === p.playerId))
            .map((p) => ({ playerId: p.playerId, name: p.name, side: p.side }))}
          onClose={() => setPending(null)}
          onConfirm={async (swaps) => {
            for (const swap of swaps) {
              await api(`/war/wars/${chosen}/substitute`, {
                method: 'POST',
                body: JSON.stringify({ out: swap.out, in: swap.in, side: swap.side }),
              });
            }
            const rows = pending;
            setPending(null);
            await saveRows(rows);
          }}
        />
      )}

      {/* The screens are pages of one table, so they are read one after
          another rather than opened and closed one at a time. */}
      {zoom !== null && detail && detail.images[zoom] && (
        <div
          className="fixed inset-0 z-[90] bg-black/90 flex items-center justify-center"
          onClick={() => setZoom(null)}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              setZoom((at) => ((at ?? 0) - 1 + detail.images.length) % detail.images.length);
            }}
            title="Anterior"
            className="absolute left-4 w-12 h-12 rounded-full bg-slate-900/80 border border-slate-700 text-slate-300 hover:text-amber-400 hover:border-amber-700 transition-all"
          >
            <i className="fa-solid fa-chevron-left"></i>
          </button>

          <img
            src={detail.images[zoom].image}
            alt={`Resultados ${zoom + 1} de ${detail.images.length}`}
            onClick={(e) => e.stopPropagation()}
            className="max-w-[90vw] max-h-[85vh] rounded"
          />

          <button
            onClick={(e) => {
              e.stopPropagation();
              setZoom((at) => ((at ?? 0) + 1) % detail.images.length);
            }}
            title="Siguiente"
            className="absolute right-4 w-12 h-12 rounded-full bg-slate-900/80 border border-slate-700 text-slate-300 hover:text-amber-400 hover:border-amber-700 transition-all"
          >
            <i className="fa-solid fa-chevron-right"></i>
          </button>

          <span className="absolute bottom-6 text-sm text-slate-400 tabular-nums bg-slate-900/80 border border-slate-800 rounded-full px-4 py-1">
            {zoom + 1} / {detail.images.length}
          </span>
        </div>
      )}
    </>
  );

  // De página no lleva hoja ni botón de cerrar: ya está dentro de la aplicación.
  return comoPagina ? (
    cuerpo
  ) : (
    <Sheet
      title="Historial de guerras"
      subtitle={
        canEdit
          ? 'Sube las capturas de resultados —o pégalas con Ctrl+V desde un ordenador— y anota lo que aportó cada uno.'
          : 'Las guerras que se han librado y quién estuvo en ellas.'
      }
      size="xl"
      onClose={onClose}
    >
      {cuerpo}
    </Sheet>
  );
};

export default WarHistory;
