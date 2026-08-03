import React, { useEffect, useState } from 'react';
import { api } from '../services/authService';
import { WeaponSet } from '../types';
import { SetBadge } from './BuildEditor';
import { ICON_GROUPS } from './iconCatalog';
import { TUNABLE_AXES } from '../services/impact';
import Sheet from './Sheet';

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
    <Sheet title="Elegir icono" size="md" onClose={onClose}>
      <input
        type="text"
        autoFocus
        value={search}
        placeholder="Buscar…"
        aria-label="Buscar icono"
        enterKeyHint="search"
        onChange={(e) => setSearch(e.target.value)}
        className="w-full min-h-tap bg-slate-950 border border-slate-800 rounded px-3 text-sm outline-none focus:ring-1 focus:ring-amber-500 mb-4"
      />

      <div className="space-y-5">
        {groups.map((group) => (
          <div key={group.group}>
            <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">{group.group}</p>
            <div className="flex flex-wrap gap-1.5">
              {group.icons.map((icon) => (
                <button
                  key={icon}
                  title={icon}
                  aria-label={icon.replace('fa-', '').replace(/-/g, ' ')}
                  onClick={() => onPick(icon)}
                  className={`min-h-tap min-w-tap rounded border flex items-center justify-center transition-all ${
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
    </Sheet>
  );
};

/**
 * What a set is expected to put on the results screen.
 *
 * Phrased as a percentage of the war's best rather than as a weight, because
 * "de este conjunto esperamos el 60% del mejor daño de la noche" is a claim
 * about the weapons that anyone who plays them can argue with, while "daño
 * x0.6" is a knob. The score still compares people to each other; this only
 * moves the bar each set is asked to clear.
 */
const ImpactTuning: React.FC<{
  set: WeaponSet;
  canEdit: boolean;
  onChange: (impact: Record<string, number>) => void;
}> = ({ set, canEdit, onChange }) => {
  // What is being typed, before it means anything. Without this the box is
  // driven straight from the stored figure, so clearing it to retype reads as
  // "0", clamps to the floor, and you find yourself typing 80 into a field
  // that already says 30. Held only while the box is focused.
  const [draft, setDraft] = useState<Record<string, string>>({});

  const at = (key: string) => Math.round((set.impact?.[key] ?? 1) * 100);
  const put = (key: string, raw: string) => {
    setDraft((prev) => ({ ...prev, [key]: raw }));
    const pct = Number(raw);
    // Half-typed is not the same as wrong: an empty box commits nothing and
    // leaves the last good value standing.
    if (raw.trim() === '' || !Number.isFinite(pct)) return;
    const next = { ...(set.impact ?? {}) };
    // A hundred is the default, so it is stored as nothing at all -- otherwise
    // an untouched set looks deliberately tuned to whoever reads it next.
    if (pct === 100) delete next[key];
    else next[key] = Math.min(2, Math.max(0.3, pct / 100));
    onChange(next);
  };
  const settle = (key: string) => setDraft(({ [key]: _gone, ...rest }) => rest);

  return (
    <div className="border-t border-slate-800/70 pt-2 space-y-2">
      <p className="text-[10px] text-slate-500">
        Qué se le pide a este conjunto en cada apartado, como % del mejor de la guerra. Al 100% se
        mide contra el mejor sin más. Bájalo donde las armas no puedan llegar —{' '}
        <span className="text-slate-400">
          un conjunto de objetivo único al 60% de daño marca el máximo con 60% del mejor daño
        </span>
        .
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {TUNABLE_AXES.map((axis) => {
          const pct = at(axis.key);
          return (
            <label key={axis.key} className="flex items-center gap-2 text-[11px]">
              <span className={`flex-1 truncate ${pct === 100 ? 'text-slate-500' : 'text-amber-400'}`}>
                {axis.label}
              </span>
              <input
                type="number"
                min={30}
                max={200}
                step={5}
                value={draft[axis.key] ?? pct}
                disabled={!canEdit}
                onChange={(e) => put(axis.key, e.target.value)}
                onBlur={() => settle(axis.key)}
                className={`w-16 bg-slate-900 border rounded px-1.5 py-1 text-right tabular-nums outline-none focus:ring-1 focus:ring-amber-500 ${
                  pct === 100 ? 'border-slate-800 text-slate-400' : 'border-amber-700/60 text-amber-300'
                }`}
              />
              <span className="text-slate-600">%</span>
            </label>
          );
        })}
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

const WeaponSets: React.FC<{ canEdit: boolean; onSaved: () => void }> = ({ canEdit, onSaved }) => {
  const [sets, setSets] = useState<WeaponSet[] | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [tuning, setTuning] = useState<string | null>(null);

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
      // The impact score is worked out from these every time a war table is
      // drawn, so a saved allowance has to reach the rest of the app at once.
      onSaved();
      setMessage({ text: 'Conjuntos guardados. Los puntajes de impacto ya usan estos valores.', ok: true });
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
                  {/* Sin `aria-label` eran dos botones que un lector de
                      pantalla anuncia como "botón" y nada más: la flecha es un
                      dibujo, no un nombre. */}
                  <button
                    onClick={() => move(set.id, -1)}
                    disabled={index === 0}
                    aria-label={`Subir ${set.name || 'este conjunto'} en el orden`}
                    className="p-2 text-slate-500 hover:text-slate-200 disabled:text-slate-800 transition-all"
                  >
                    <i className="fa-solid fa-arrow-up"></i>
                  </button>
                  <button
                    onClick={() => move(set.id, 1)}
                    disabled={index === (sets?.length ?? 0) - 1}
                    aria-label={`Bajar ${set.name || 'este conjunto'} en el orden`}
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

            <button
              onClick={() => setTuning((prev) => (prev === set.id ? null : set.id))}
              className="text-[11px] text-slate-500 hover:text-amber-500 transition-all flex items-center gap-2"
            >
              <i className={`fa-solid ${tuning === set.id ? 'fa-chevron-down' : 'fa-chevron-right'}`}></i>
              Puntaje de impacto
              {Object.keys(set.impact ?? {}).length > 0 && (
                <span className="text-[9px] uppercase tracking-wider text-amber-500 border border-amber-700/60 rounded px-1 py-0.5">
                  ajustado
                </span>
              )}
            </button>

            {tuning === set.id && (
              <ImpactTuning
                set={set}
                canEdit={canEdit}
                onChange={(impact) => update(set.id, { impact })}
              />
            )}
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
