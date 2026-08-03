import React, { useEffect, useState } from 'react';
import { api } from '../services/authService';
import {
  LANE_CAPACITY,
  RoleTargets,
  TacticalUnit,
  WAR_LANES,
  WAR_SIDE_LABELS,
  WarSide,
  WarStrategy,
} from '../types';
import { IconPicker } from './WeaponSets';
import Sheet from './Sheet';

const ROLES: { key: keyof RoleTargets; label: string; colour: string }[] = [
  { key: 'tank', label: 'Tanques', colour: '#60a5fa' },
  { key: 'healer', label: 'Sanadores', colour: '#4ade80' },
  { key: 'dps', label: 'DPS', colour: '#f87171' },
];

const SIDE_CAPACITY = LANE_CAPACITY * WAR_LANES.length;

const emptyTargets = (): RoleTargets => ({ tank: 0, healer: 0, dps: 0 });

const blankStrategy = (side: WarSide): WarStrategy => ({
  id: '',
  side,
  name: '',
  composition: {
    left: emptyTargets(),
    center: emptyTargets(),
    right: emptyTargets(),
  },
  units: [],
  notes: null,
});

/** A number cell. Small, because there are twelve of them per strategy. */
const Count: React.FC<{
  value: number;
  disabled: boolean;
  etiqueta: string;
  onChange: (n: number) => void;
}> = ({ value, disabled, etiqueta, onChange }) => (
  <input
    type="number"
    inputMode="numeric"
    min={0}
    max={SIDE_CAPACITY}
    value={value}
    disabled={disabled}
    aria-label={etiqueta}
    onChange={(e) => onChange(Math.max(0, Math.min(SIDE_CAPACITY, Number(e.target.value) || 0)))}
    className={`w-full sm:w-14 bg-slate-950 border rounded px-1 text-sm text-center tabular-nums outline-none focus:ring-1 focus:ring-amber-500 ${
      value ? 'border-slate-700 text-slate-100' : 'border-slate-800 text-slate-600'
    }`}
  />
);

interface Props {
  side: WarSide;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Where a plan is written down: how many of each role a lane should hold, and
 * what tactical units the side is meant to field.
 *
 * A strategy is advice and never a rule -- the board is free to differ from it,
 * because on the day you field who turned up. What it buys you is the
 * difference being visible instead of remembered.
 */
const StrategyPlanner: React.FC<Props> = ({ side, canEdit, onClose, onSaved }) => {
  const [drafts, setDrafts] = useState<WarStrategy[] | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [iconFor, setIconFor] = useState<{ strategy: number; unit: string } | null>(null);

  const load = async () => {
    const all = await api<WarStrategy[]>('/war/strategies').catch(() => []);
    setDrafts(all.filter((s) => s.side === side).map((s) => ({ ...s, units: s.units ?? [] })));
  };

  useEffect(() => {
    void load();
  }, [side]);

  const patch = (index: number, changes: Partial<WarStrategy>) =>
    setDrafts((prev) => (prev ?? []).map((s, i) => (i === index ? { ...s, ...changes } : s)));

  const patchUnit = (index: number, unitId: string, changes: Partial<TacticalUnit>) =>
    setDrafts((prev) =>
      (prev ?? []).map((s, i) =>
        i === index
          ? { ...s, units: s.units.map((u) => (u.id === unitId ? { ...u, ...changes } : u)) }
          : s,
      ),
    );

  const addUnit = (index: number) =>
    patch(index, {
      units: [
        ...(drafts?.[index].units ?? []),
        {
          // Local until saved; the server keeps whatever id it is given.
          id: `unit-${Date.now()}-${Math.floor(performance.now())}`,
          name: '',
          icon: 'fa-users',
          color: '#f59e0b',
          ...emptyTargets(),
        },
      ],
    });

  const save = async (index: number) => {
    const strategy = drafts?.[index];
    if (!strategy) return;
    setBusy(strategy.id || `new-${index}`);
    setMessage(null);
    try {
      await api('/war/strategies', {
        method: 'PUT',
        body: JSON.stringify({ strategy: { ...strategy, id: strategy.id || undefined } }),
      });
      await load();
      onSaved();
      setMessage({ text: `«${strategy.name || 'Sin nombre'}» guardada.`, ok: true });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'No se pudo guardar', ok: false });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (index: number) => {
    const strategy = drafts?.[index];
    if (!strategy) return;
    if (strategy.id && !window.confirm(`¿Borrar la estrategia «${strategy.name}»?`)) return;

    if (!strategy.id) {
      setDrafts((prev) => (prev ?? []).filter((_, i) => i !== index));
      return;
    }
    await api(`/war/strategies/${strategy.id}`, { method: 'DELETE' }).catch(() => undefined);
    await load();
    onSaved();
  };

  return (
    <Sheet
      title={`Estrategias de ${WAR_SIDE_LABELS[side]}`}
      subtitle={
        canEdit
          ? 'Cuánta gente de cada rol quieres por línea, y qué unidades tácticas debe llevar el bando. Es una referencia: el tablero puede diferir.'
          : 'Solo lectura: no tienes permiso para editar la sala de guerra.'
      }
      size="lg"
      onClose={onClose}
    >
      <div className="space-y-4">
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

          {!drafts && <p className="text-sm text-slate-500">Cargando...</p>}
          {drafts?.length === 0 && (
            <p className="text-sm text-slate-500">
              Todavía no hay estrategias para {WAR_SIDE_LABELS[side]}.
            </p>
          )}

          {drafts?.map((strategy, index) => {
            const laneTotal = WAR_LANES.reduce(
              (sum, lane) =>
                sum +
                ROLES.reduce((n, role) => n + (strategy.composition?.[lane.id]?.[role.key] ?? 0), 0),
              0,
            );

            return (
              <div key={strategy.id || `new-${index}`} className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <input
                    type="text"
                    value={strategy.name}
                    disabled={!canEdit}
                    placeholder="Nombre de la estrategia"
                    onChange={(e) => patch(index, { name: e.target.value })}
                    className="flex-1 min-w-[200px] bg-slate-900 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
                  />
                  {canEdit && (
                    <>
                      <button
                        onClick={() => save(index)}
                        disabled={busy !== null}
                        className="bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 text-white text-xs font-bold py-2 px-4 rounded transition-all flex items-center gap-2"
                      >
                        <i className="fa-solid fa-floppy-disk"></i>
                        Guardar
                      </button>
                      <button
                        onClick={() => remove(index)}
                        className="p-2 text-slate-500 hover:text-red-400 transition-all"
                        title="Borrar esta estrategia"
                      >
                        <i className="fa-solid fa-trash-can"></i>
                      </button>
                    </>
                  )}
                </div>

                {/* ------------------------------------------------- lanes */}
                <div>
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="text-[10px] uppercase tracking-wider text-slate-500">
                      Por línea
                    </span>
                    <span className="text-[10px] text-slate-600 tabular-nums">
                      {laneTotal} puestos pedidos
                    </span>
                  </div>

                  <div className="hidden sm:flex items-center gap-2 mb-1 pl-[132px]">
                    {ROLES.map((role) => (
                      <span key={role.key} className="w-14 text-center text-[10px]" style={{ color: role.colour }}>
                        {role.label}
                      </span>
                    ))}
                  </div>

                  <div className="space-y-1.5">
                    {WAR_LANES.map((lane) => {
                      const targets = strategy.composition?.[lane.id] ?? emptyTargets();
                      const total = ROLES.reduce((n, role) => n + targets[role.key], 0);
                      const excede = total > LANE_CAPACITY;
                      const aviso = excede
                        ? `Una línea son ${LANE_CAPACITY} personas. Pasa de ahí solo si cuentas con híbridos, que cubren dos roles a la vez.`
                        : undefined;

                      return (
                        /*
                          En el teléfono, cada línea es un bloque con sus tres
                          cifras etiquetadas; a partir de sm vuelve a ser la fila
                          de siempre, con la cabecera de columnas arriba.

                          La cabecera era `hidden sm:flex` y no había nada que la
                          sustituyera: en un teléfono se veían tres casillas con
                          2, 1 y 4 dentro y ninguna forma de saber cuál era
                          tanques, cuál sanadores y cuál DPS. Tres números sin
                          nombre no son un formulario, son una adivinanza.
                        */
                        <div
                          key={lane.id}
                          className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-md border border-slate-800 p-2 sm:border-0 sm:p-0"
                        >
                          <div className="flex items-baseline justify-between gap-2 sm:block sm:w-[124px] sm:shrink-0">
                            <span className="text-sm sm:text-xs font-bold" style={{ color: lane.colour }}>
                              {lane.label}
                            </span>
                            <span
                              className={`sm:hidden text-meta tabular-nums ${
                                excede ? 'text-amber-500 font-bold' : 'text-slate-500'
                              }`}
                              title={aviso}
                            >
                              {excede && <i className="fa-solid fa-triangle-exclamation mr-1"></i>}
                              {total}/{LANE_CAPACITY}
                            </span>
                          </div>

                          <div className="flex gap-2 sm:contents">
                            {ROLES.map((role) => (
                              <label key={role.key} className="flex-1 min-w-0 sm:flex-none">
                                <span
                                  className="sm:hidden block text-[11px] uppercase tracking-wider mb-0.5 truncate"
                                  style={{ color: role.colour }}
                                >
                                  {role.label}
                                </span>
                                <Count
                                  value={targets[role.key]}
                                  disabled={!canEdit}
                                  etiqueta={`${role.label} en ${lane.label}`}
                                  onChange={(n) =>
                                    patch(index, {
                                      composition: {
                                        ...strategy.composition,
                                        [lane.id]: { ...targets, [role.key]: n },
                                      },
                                    })
                                  }
                                />
                              </label>
                            ))}
                          </div>

                          <span
                            className={`hidden sm:inline text-[10px] tabular-nums ${
                              excede ? 'text-amber-500' : 'text-slate-600'
                            }`}
                            title={aviso}
                          >
                            {excede && <i className="fa-solid fa-triangle-exclamation mr-1"></i>}
                            {total}/{LANE_CAPACITY}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* ------------------------------------------------- units */}
                <div>
                  <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-2">
                    Unidades tácticas ({strategy.units.length})
                  </span>

                  <div className="space-y-1.5">
                    {strategy.units.map((unit) => (
                      // Mismo reparto que las líneas: identidad arriba, cifras
                      // etiquetadas debajo. Sin las etiquetas, las tres casillas
                      // de una unidad eran tan mudas como las de una línea.
                      <div
                        key={unit.id}
                        className="flex flex-col sm:flex-row sm:items-center gap-2 rounded p-1.5"
                        style={{ backgroundColor: `${unit.color}10` }}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <button
                            disabled={!canEdit}
                            onClick={() => setIconFor({ strategy: index, unit: unit.id })}
                            title="Elegir icono"
                            aria-label={`Icono de ${unit.name || 'la unidad'}`}
                            className="min-h-tap min-w-tap shrink-0 rounded border border-slate-800 flex items-center justify-center hover:border-slate-600 transition-all"
                            style={{ color: unit.color }}
                          >
                            <i className={`fa-solid ${unit.icon}`}></i>
                          </button>
                          <input
                            type="color"
                            value={unit.color}
                            disabled={!canEdit}
                            onChange={(e) => patchUnit(index, unit.id, { color: e.target.value })}
                            title="Color de la unidad"
                            aria-label={`Color de ${unit.name || 'la unidad'}`}
                            className="w-11 shrink-0 bg-transparent border-none cursor-pointer"
                          />
                          <input
                            type="text"
                            value={unit.name}
                            disabled={!canEdit}
                            placeholder="Nombre de la unidad"
                            aria-label="Nombre de la unidad"
                            onChange={(e) => patchUnit(index, unit.id, { name: e.target.value })}
                            className="flex-1 min-w-0 sm:min-w-[140px] bg-slate-900 border border-slate-800 rounded px-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
                          />
                          {canEdit && (
                            <button
                              onClick={() =>
                                patch(index, { units: strategy.units.filter((u) => u.id !== unit.id) })
                              }
                              aria-label={`Quitar ${unit.name || 'esta unidad'}`}
                              className="sm:hidden min-h-tap min-w-tap shrink-0 flex items-center justify-center text-slate-500 hover:text-red-400 transition-all"
                            >
                              <i className="fa-solid fa-xmark"></i>
                            </button>
                          )}
                        </div>

                        <div className="flex gap-2 sm:contents">
                          {ROLES.map((role) => (
                            <label key={role.key} className="flex-1 min-w-0 sm:flex-none">
                              <span
                                className="sm:hidden block text-[11px] uppercase tracking-wider mb-0.5 truncate"
                                style={{ color: role.colour }}
                              >
                                {role.label}
                              </span>
                              <Count
                                value={unit[role.key]}
                                disabled={!canEdit}
                                etiqueta={`${role.label} en ${unit.name || 'la unidad'}`}
                                onChange={(n) => patchUnit(index, unit.id, { [role.key]: n })}
                              />
                            </label>
                          ))}
                        </div>

                        {canEdit && (
                          <button
                            onClick={() =>
                              patch(index, { units: strategy.units.filter((u) => u.id !== unit.id) })
                            }
                            aria-label={`Quitar ${unit.name || 'esta unidad'}`}
                            className="hidden sm:flex min-h-tap min-w-tap shrink-0 items-center justify-center text-slate-600 hover:text-red-400 transition-all"
                          >
                            <i className="fa-solid fa-xmark"></i>
                          </button>
                        )}
                      </div>
                    ))}

                    {!strategy.units.length && (
                      <p className="text-xs text-slate-600 italic">
                        Sin unidades. Una unidad es un cometido —escoltar el féretro, tomar los
                        campamentos— y toma gente de cualquiera de las tres líneas.
                      </p>
                    )}
                  </div>

                  {canEdit && (
                    <button
                      onClick={() => addUnit(index)}
                      className="mt-2 text-xs text-slate-500 hover:text-amber-500 transition-all"
                    >
                      <i className="fa-solid fa-plus mr-1.5"></i>
                      Añadir unidad táctica
                    </button>
                  )}
                </div>

                <input
                  type="text"
                  value={strategy.notes ?? ''}
                  disabled={!canEdit}
                  placeholder="Notas (opcional)"
                  onChange={(e) => patch(index, { notes: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>
            );
          })}

          {canEdit && drafts && (
            <button
              onClick={() => setDrafts([...drafts, blankStrategy(side)])}
              className="w-full min-h-tap border-2 border-dashed border-slate-800 hover:border-amber-600 text-slate-500 hover:text-amber-500 rounded-lg text-sm transition-all"
            >
              <i className="fa-solid fa-plus mr-2"></i>
              Nueva estrategia de {WAR_SIDE_LABELS[side]}
            </button>
          )}
      </div>

      {iconFor && (
        <IconPicker
          value={drafts?.[iconFor.strategy]?.units.find((u) => u.id === iconFor.unit)?.icon}
          onPick={(icon) => {
            patchUnit(iconFor.strategy, iconFor.unit, { icon });
            setIconFor(null);
          }}
          onClose={() => setIconFor(null)}
        />
      )}
    </Sheet>
  );
};

export default StrategyPlanner;
