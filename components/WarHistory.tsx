import React, { useEffect, useRef, useState } from 'react';
import { api } from '../services/authService';
import { WAR_SIDE_LABELS, WarLane, WarSide } from '../types';

interface WarRow {
  id: string;
  name: string;
  startedAt: string;
  endedAt: string | null;
  outcome: string | null;
  participants: number;
  images: number;
}

interface Participant {
  playerId: string;
  name: string;
  side: WarSide;
  lane: WarLane;
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

const FIGURES: { key: string; label: string }[] = [
  { key: 'damage', label: 'Daño' },
  { key: 'healing', label: 'Curación' },
  { key: 'kills', label: 'Bajas' },
  { key: 'deaths', label: 'Muertes' },
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
  onClose: () => void;
}

/**
 * What the wars left behind: who was there, what they did, and the screens the
 * game showed at the end.
 */
const WarHistory: React.FC<Props> = ({ canEdit, onClose }) => {
  const [wars, setWars] = useState<WarRow[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const drop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<WarRow[]>('/war/wars')
      .then((rows) => {
        setWars(rows);
        setChosen((current) => current ?? rows[0]?.id ?? null);
      })
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

  const removeImage = async (imageId: string) => {
    if (!chosen || !window.confirm('¿Borrar esta imagen?')) return;
    await api(`/war/wars/${chosen}/images/${imageId}`, { method: 'DELETE' }).catch(() => undefined);
    await load(chosen);
  };

  const setFigure = async (playerId: string, key: string, raw: string) => {
    if (!chosen) return;
    const value = raw.trim() === '' ? null : Number(raw.replace(/\./g, ''));
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

          {wars && wars.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {wars.map((w) => (
                <button
                  key={w.id}
                  onClick={() => setChosen(w.id)}
                  className={`text-left rounded-lg border px-3 py-2 transition-all ${
                    chosen === w.id
                      ? 'border-amber-500 bg-amber-500/10'
                      : 'border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <p className={`text-sm font-bold ${chosen === w.id ? 'text-amber-400' : 'text-slate-200'}`}>
                    {w.name}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {when(w.startedAt)} · {minutes(w.startedAt, w.endedAt)} · {w.participants} en campo
                    {w.images > 0 && ` · ${w.images} img`}
                  </p>
                </button>
              ))}
            </div>
          )}

          {detail && (
            <>
              <section>
                <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                  <h3 className="text-sm font-bold text-slate-300">
                    Resultados ({detail.images.length})
                  </h3>
                  {canEdit && (
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
                    {detail.images.map((img) => (
                      <div key={img.id} className="relative group">
                        <img
                          src={img.image}
                          alt="Resultados"
                          onClick={() => setZoom(img.image)}
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
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-slate-500 text-left">
                        <th className="py-1 pr-3">Miembro</th>
                        <th className="py-1 pr-3">Bando</th>
                        {FIGURES.map((f) => (
                          <th key={f.key} className="py-1 pr-3 text-right">
                            {f.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {detail.participants.map((p) => (
                        <tr key={p.playerId} className="border-t border-slate-800/70">
                          <td className="py-1 pr-3 text-slate-200">{p.name}</td>
                          <td className="py-1 pr-3 text-[11px] text-slate-500">
                            {WAR_SIDE_LABELS[p.side]}
                          </td>
                          {FIGURES.map((f) => (
                            <td key={f.key} className="py-1 pr-3 text-right">
                              {canEdit ? (
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  defaultValue={p.stats?.[f.key] ?? ''}
                                  placeholder="—"
                                  onBlur={(e) => setFigure(p.playerId, f.key, e.target.value)}
                                  className="w-24 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-right tabular-nums outline-none focus:ring-1 focus:ring-amber-500"
                                />
                              ) : (
                                <span className="tabular-nums text-slate-300">
                                  {p.stats?.[f.key]?.toLocaleString('es') ?? '—'}
                                </span>
                              )}
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

      {zoom && (
        <div
          className="fixed inset-0 z-[90] bg-black/90 flex items-center justify-center p-6 cursor-zoom-out"
          onClick={() => setZoom(null)}
        >
          <img src={zoom} alt="Resultados" className="max-w-full max-h-full rounded" />
        </div>
      )}
    </div>
  );
};

export default WarHistory;
