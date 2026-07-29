import React, { useEffect, useState } from 'react';
import { api } from '../services/authService';
import { WeaponSet } from '../types';
import { SetBadge } from './BuildEditor';
import { ICON_GROUPS } from './iconCatalog';

/** Picks an icon by eye. Names alone mean nothing until you see the glyph. */
export const IconPicker: React.FC<{
  value?: string | null;
  onPick: (icon: string) => void;
  onClose: () => void;
}> = ({ value, onPick, onClose }) => {
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();

  const groups = ICON_GROUPS.map((g) => ({
    ...g,
    icons: needle
      ? g.icons.filter((i) => i.includes(needle) || g.group.toLowerCase().includes(needle))
      : g.icons,
  })).filter((g) => g.icons.length);

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-2xl my-8">
        <div className="flex items-center justify-between p-5 border-b border-slate-800 gap-4">
          <h3 className="cinzel text-xl font-bold text-amber-500">Elegir icono</h3>
          <input
            type="text"
            autoFocus
            value={search}
            placeholder="Buscar..."
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 max-w-xs bg-slate-950 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
          />
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-amber-500 transition-all">
            <i className="fa-solid fa-xmark text-xl"></i>
          </button>
        </div>

        <div className="p-5 space-y-5">
          {groups.map((group) => (
            <div key={group.group}>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">{group.group}</p>
              <div className="flex flex-wrap gap-1.5">
                {group.icons.map((icon) => (
                  <button
                    key={icon}
                    title={icon}
                    onClick={() => onPick(icon)}
                    className={`w-10 h-10 rounded border flex items-center justify-center transition-all ${
                      value === icon
                        ? 'border-amber-500 text-amber-400 bg-amber-500/10'
                        : 'border-slate-800 text-slate-400 hover:text-amber-500 hover:border-slate-600'
                    }`}
                  >
                    <i className={`fa-solid ${icon}`}></i>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {!groups.length && <p className="text-sm text-slate-500">Ningún icono coincide.</p>}
        </div>
      </div>
    </div>
  );
};

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
  const [picking, setPicking] = useState<string | null>(null);

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
                  <button
                    onClick={() => setPicking(set.id)}
                    className="text-xs py-2 px-3 rounded border border-slate-800 text-slate-400 hover:text-amber-500 hover:border-slate-600 transition-all"
                  >
                    Elegir icono
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

      {picking && (
        <IconPicker
          value={sets?.find((s) => s.id === picking)?.icon ?? null}
          onPick={(icon) => {
            update(picking, { icon });
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </section>
  );
};

export default WeaponSets;
