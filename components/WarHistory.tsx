import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/authService';
import { impactOf, impactShade } from '../services/impact';
import {
  WAR_MATCH_TYPE_LABELS,
  WAR_OUTCOME_LABELS,
  WAR_SIDE_LABELS,
  WarLane,
  PlayerBuild,
  WarMatchType,
  WarOutcome,
  WarSide,
  WeaponSet,
} from '../types';
import ResultsReader from './ResultsReader';
import FigureCell from './FigureCell';
import { SetBadge } from './BuildEditor';

interface WarRow {
  id: string;
  name: string;
  startedAt: string;
  endedAt: string | null;
  outcome: WarOutcome | null;
  matchType: WarMatchType;
  participants: number;
  images: number;
}

interface Participant {
  playerId: string;
  name: string;
  side: WarSide;
  lane: WarLane;
  /** The build the war froze for them, if one was chosen before it started. */
  buildId: string | null;
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
async function shrink(file: Blob): Promise<string> {
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
  /** Every build in the guild, to resolve what each member carried that war. */
  builds: PlayerBuild[];
  weaponSets: WeaponSet[];
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
const WarHistory: React.FC<Props> = ({ canEdit, builds, weaponSets, onClose, onChanged }) => {
  const [wars, setWars] = useState<WarRow[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [reading, setReading] = useState(false);
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
   * The weapon sets a member fought with, from the build the war recorded for
   * them -- or the one they usually play, if the war never named one.
   *
   * Distinct sets rather than one icon per weapon: a build of four weapons is
   * two pairs, and showing the same crest twice says nothing extra.
   */
  const setsCarried = useMemo(() => {
    const byId = new Map<string, PlayerBuild>(builds.map((b) => [b.id, b]));
    const primary = new Map<string, PlayerBuild>();
    for (const b of builds) if (b.isPrimary || !primary.has(b.playerId)) primary.set(b.playerId, b);

    return (playerId: string, buildId: string | null): WeaponSet[] => {
      const build = (buildId ? byId.get(buildId) : undefined) ?? primary.get(playerId);
      const found = new Map<string, WeaponSet>();
      for (const weapon of build?.weapons ?? []) {
        const set = weaponSets.find((s) => s.weapons.includes(weapon));
        if (set) found.set(set.id, set);
      }
      return [...found.values()];
    };
  }, [builds, weaponSets]);

  // Recomputed as figures are typed, so a correction shows its effect at once.
  const scores = useMemo(
    () => new Map(impactOf(detail?.participants ?? []).map((row) => [row.playerId, row.score])),
    [detail],
  );

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

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto">
      <div ref={drop} className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-5xl my-8">
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <div>
            <h2 className="cinzel text-2xl font-bold text-amber-500">Historial de guerras</h2>
            <p className="text-xs text-slate-500 mt-1">
              {canEdit
                ? 'Pega aquí (Ctrl+V) las capturas de resultados y anota lo que aportó cada uno.'
                : 'Las guerras que se han librado y quién estuvo en ellas.'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-amber-500 transition-all">
            <i className="fa-solid fa-xmark text-xl"></i>
          </button>
        </div>

        <div className="p-6 space-y-4">
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
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {when(w.startedAt)} · {minutes(w.startedAt, w.endedAt)} · {w.participants} en campo
                      {w.images > 0 && ` · ${w.images} capturas`}
                    </p>
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

              <section>
                <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                  <h3 className="text-sm font-bold text-slate-300">
                    Resultados ({detail.images.length})
                  </h3>
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
                  <p className="text-xs text-slate-600 italic border border-dashed border-slate-800 rounded-lg py-6 text-center">
                    {canEdit
                      ? 'Copia la captura del juego y pulsa Ctrl+V con esta ventana abierta.'
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
                          <button
                            onClick={() => removeImage(img.id)}
                            title="Borrar esta imagen"
                            className="absolute top-1 right-1 w-7 h-7 rounded bg-slate-950/80 text-slate-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                          >
                            <i className="fa-solid fa-trash-can text-xs"></i>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h3 className="text-sm font-bold text-slate-300 mb-2">
                  Participantes ({detail.participants.length})
                  <span className="ml-2 text-[11px] font-normal text-slate-500">
                    · el impacto se calcula contra el resto de esta misma guerra
                  </span>
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-slate-500 text-left">
                        {[
                          { key: 'name', label: 'Miembro', right: false },
                          { key: 'side', label: 'Bando', right: false },
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
                                {setsCarried(p.playerId, p.buildId).map((set) => (
                                  <SetBadge key={set.id} set={set} size={14} />
                                ))}
                              </span>
                              {p.name}
                            </span>
                          </td>
                          <td className="py-1 pr-3 text-[11px] text-slate-500">
                            {WAR_SIDE_LABELS[p.side]}
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
      </div>

      {reading && detail && (
        <ResultsReader
          images={detail.images.map((i) => i.image)}
          participants={detail.participants.map((p) => ({ playerId: p.playerId, name: p.name }))}
          onClose={() => setReading(false)}
          onApply={async (rows) => {
            for (const row of rows) {
              if (!row.playerId) continue;
              await api(`/war/wars/${chosen}/participants/${row.playerId}`, {
                method: 'PATCH',
                body: JSON.stringify({ stats: row.figures }),
              }).catch(() => undefined);
            }
            setReading(false);
            if (chosen) await load(chosen);
            setMessage({ text: `${rows.length} filas guardadas.`, ok: true });
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
    </div>
  );
};

export default WarHistory;
