import React, { useEffect, useRef, useState } from 'react';
import { api } from '../services/authService';
import { WeaponSet } from '../types';
import { SetBadge } from './BuildEditor';

// Uploaded pictures are stored inline in the database, so they are shrunk here
// first: a set badge is never shown large, and a full-size screenshot would
// bloat every request that lists the catalogue.
const ICON_PX = 48;

async function toSmallIcon(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = ICON_PX;
  canvas.height = ICON_PX;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo procesar la imagen');

  // Cover: crop to a square from the middle rather than squashing the picture.
  const side = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    ICON_PX,
    ICON_PX,
  );
  return canvas.toDataURL('image/png');
}

const blank = (): WeaponSet => ({
  id: `set-${Date.now()}`,
  name: '',
  weapons: [],
  color: '#f59e0b',
  icon: null,
});

const WeaponSets: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const [sets, setSets] = useState<WeaponSet[] | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const uploadFor = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<WeaponSet[]>('/weapon-sets')
      .then(setSets)
      .catch((err) => setMessage({ text: err instanceof Error ? err.message : 'Error', ok: false }));
  }, []);

  const update = (id: string, patch: Partial<WeaponSet>) =>
    setSets((prev) => (prev ?? []).map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const move = (id: string, by: number) =>
    setSets((prev) => {
      const list = [...(prev ?? [])];
      const at = list.findIndex((s) => s.id === id);
      const to = at + by;
      if (at < 0 || to < 0 || to >= list.length) return list;
      [list[at], list[to]] = [list[to], list[at]];
      return list;
    });

  const pickIcon = async (file: File) => {
    const id = uploadFor.current;
    if (!id) return;
    try {
      update(id, { icon: await toSmallIcon(file) });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'No se pudo leer la imagen', ok: false });
    }
  };

  const save = async () => {
    if (!sets) return;
    setBusy(true);
    try {
      await api('/weapon-sets', { method: 'PUT', body: JSON.stringify({ sets }) });
      setMessage({ text: 'Conjuntos guardados.', ok: true });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'No se pudo guardar', ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-1">
        <h2 className="cinzel text-2xl font-bold text-amber-500">Conjuntos de armas</h2>
        {canEdit && sets && (
          <button
            onClick={save}
            disabled={busy}
            className="bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 text-white text-sm font-bold py-2 px-4 rounded transition-all flex items-center gap-2"
          >
            <i className="fa-solid fa-floppy-disk"></i>
            Guardar
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500 mb-5">
        {canEdit
          ? 'Cuando el juego añada armas, créalas aquí. Una build las elige por nombre, así que reordenar o renombrar un conjunto no rompe las builds ya guardadas.'
          : 'Solo lectura. Se necesita el permiso "Editar builds de cualquiera".'}
      </p>

      {message && (
        <div
          className={`text-sm rounded-lg px-4 py-2 mb-4 flex items-center gap-3 border ${
            message.ok
              ? 'bg-emerald-950/60 border-emerald-900 text-emerald-200'
              : 'bg-red-950/60 border-red-900 text-red-200'
          }`}
        >
          <i className={`fa-solid ${message.ok ? 'fa-circle-check' : 'fa-triangle-exclamation'}`}></i>
          {message.text}
        </div>
      )}

      <div className="space-y-3">
        {sets?.map((set, index) => (
          <div key={set.id} className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="w-8 h-8 flex items-center justify-center bg-slate-900 border border-slate-800 rounded shrink-0">
                <SetBadge set={set} size={22} />
              </span>

              <input
                type="text"
                value={set.name}
                disabled={!canEdit}
                placeholder="Nombre del conjunto"
                onChange={(e) => update(set.id, { name: e.target.value })}
                className="flex-1 min-w-[160px] bg-slate-900 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
              />

              <input
                type="color"
                value={set.color}
                disabled={!canEdit}
                title="Color del conjunto"
                onChange={(e) => update(set.id, { color: e.target.value })}
                className="w-10 h-9 bg-slate-900 border border-slate-800 rounded cursor-pointer"
              />

              {canEdit && (
                <>
                  <input
                    type="text"
                    value={set.icon?.startsWith('data:') ? '' : (set.icon ?? '')}
                    placeholder="fa-shield-halved"
                    title="Clase de Font Awesome, o sube una imagen"
                    onChange={(e) => update(set.id, { icon: e.target.value || null })}
                    className="w-36 bg-slate-900 border border-slate-800 rounded p-2 text-xs font-mono outline-none focus:ring-1 focus:ring-amber-500"
                  />
                  <button
                    onClick={() => {
                      uploadFor.current = set.id;
                      fileRef.current?.click();
                    }}
                    title="Subir una imagen como icono"
                    className="p-2 text-slate-400 hover:text-amber-500 transition-all"
                  >
                    <i className="fa-solid fa-image"></i>
                  </button>
                  <button
                    onClick={() => move(set.id, -1)}
                    disabled={index === 0}
                    className="p-2 text-slate-500 hover:text-slate-200 disabled:text-slate-800 transition-all"
                  >
                    <i className="fa-solid fa-arrow-up"></i>
                  </button>
                  <button
                    onClick={() => move(set.id, 1)}
                    disabled={index === (sets?.length ?? 0) - 1}
                    className="p-2 text-slate-500 hover:text-slate-200 disabled:text-slate-800 transition-all"
                  >
                    <i className="fa-solid fa-arrow-down"></i>
                  </button>
                  <button
                    onClick={() => setSets((prev) => (prev ?? []).filter((s) => s.id !== set.id))}
                    className="p-2 text-slate-500 hover:text-red-400 transition-all"
                    title="Eliminar el conjunto"
                  >
                    <i className="fa-solid fa-trash-can"></i>
                  </button>
                </>
              )}
            </div>

            <input
              type="text"
              value={set.weapons.join(', ')}
              disabled={!canEdit}
              placeholder="Armas separadas por comas"
              onChange={(e) =>
                update(set.id, {
                  weapons: e.target.value.split(',').map((w) => w.trim()).filter(Boolean),
                })
              }
              className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>
        ))}
      </div>

      {canEdit && sets && (
        <button
          onClick={() => setSets([...(sets ?? []), blank()])}
          className="mt-3 w-full border-2 border-dashed border-slate-800 hover:border-amber-600 text-slate-500 hover:text-amber-500 rounded-lg py-3 text-sm transition-all"
        >
          <i className="fa-solid fa-plus mr-2"></i>
          Añadir conjunto
        </button>
      )}

      <input
        type="file"
        ref={fileRef}
        className="hidden"
        accept="image/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void pickIcon(file);
          e.target.value = '';
        }}
      />
    </section>
  );
};

export default WeaponSets;
