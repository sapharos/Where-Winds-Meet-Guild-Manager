import React, { useEffect, useState } from 'react';
import { api } from '../services/authService';
import { Player, PlayerBuild, Role, WeaponSet } from '../types';
import { ROLE_NAMES, buildColours } from './PlayerCard';
import Sheet from './Sheet';

const ROLE_STYLE: Record<Role, string> = {
  [Role.TANK]: 'border-blue-500 text-blue-300 bg-blue-500/15',
  [Role.HEALER]: 'border-green-500 text-green-300 bg-green-500/15',
  [Role.DPS]: 'border-red-500 text-red-300 bg-red-500/15',
};

/** A set's icon: a Font Awesome class, an uploaded picture, or nothing. */
export const SetBadge: React.FC<{ set: WeaponSet; size?: number }> = ({ set, size = 18 }) => {
  if (!set.icon) return <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: set.color }} />;
  if (set.icon.startsWith('data:')) {
    return <img src={set.icon} alt="" width={size} height={size} className="rounded object-cover" />;
  }
  return <i className={`fa-solid ${set.icon}`} style={{ color: set.color, fontSize: size * 0.8 }} />;
};

const blank = (): PlayerBuild => ({
  id: `build-${Date.now()}`,
  playerId: '',
  name: '',
  weapons: [],
  roles: [],
  isPrimary: false,
});

interface Props {
  player: Player;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const BuildEditor: React.FC<Props> = ({ player, canEdit, onClose, onSaved }) => {
  const [builds, setBuilds] = useState<PlayerBuild[] | null>(null);
  const [sets, setSets] = useState<WeaponSet[]>([]);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  // Which builds show the full weapon catalogue. A build that already exists is
  // read far more often than it is changed, so it arrives folded up; a brand new
  // one is opened straight away because there is nothing to read yet.
  const [open, setOpen] = useState<Set<string>>(new Set());

  const fold = (id: string, expand: boolean) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (expand) next.add(id);
      else next.delete(id);
      return next;
    });

  useEffect(() => {
    api<PlayerBuild[]>(`/players/${player.id}/builds`)
      .then(setBuilds)
      .catch((err) => setMessage({ text: err instanceof Error ? err.message : 'Error', ok: false }));
    api<WeaponSet[]>('/weapon-sets').then(setSets).catch(() => setSets([]));
  }, [player.id]);

  const update = (id: string, patch: Partial<PlayerBuild>) =>
    setBuilds((prev) => (prev ?? []).map((b) => (b.id === id ? { ...b, ...patch } : b)));

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  // Only one build can be the primary; picking a new one clears the rest.
  const makePrimary = (id: string) =>
    setBuilds((prev) => (prev ?? []).map((b) => ({ ...b, isPrimary: b.id === id })));

  const save = async () => {
    if (!builds) return;
    setBusy(true);
    try {
      await api(`/players/${player.id}/builds`, {
        method: 'PUT',
        body: JSON.stringify({ builds }),
      });
      setMessage({ text: 'Builds guardadas.', ok: true });
      onSaved();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'No se pudo guardar', ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={`Builds de ${player.name}`}
      subtitle={
        canEdit
          ? 'Una build puede cubrir varios roles a la vez. La principal decide el rol que usa la War Room.'
          : 'Solo lectura: no tienes permiso para editar estas builds.'
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

          {!builds && <p className="text-sm text-slate-500">Cargando...</p>}

          {builds?.length === 0 && (
            <p className="text-sm text-slate-500">
              Todavía no tiene builds registradas.
            </p>
          )}

          {builds?.map((build) => {
            const expanded = open.has(build.id);
            const colours = buildColours(build, sets);

            return (
            <div
              key={build.id}
              className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-3"
              style={
                expanded
                  ? undefined
                  : { background: `linear-gradient(90deg, ${colours.from}26 0%, ${colours.to}26 100%)` }
              }
            >
              <div className="flex items-center gap-3 flex-wrap">
                {expanded ? (
                  <input
                    type="text"
                    value={build.name}
                    disabled={!canEdit}
                    placeholder="Nombre de la build"
                    onChange={(e) => update(build.id, { name: e.target.value })}
                    className="flex-1 min-w-[160px] bg-slate-900 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
                  />
                ) : (
                  <h3 className="flex-1 min-w-[160px] font-bold text-slate-100">
                    {build.name || <span className="text-slate-600 italic font-normal">Sin nombre</span>}
                  </h3>
                )}
                <button
                  onClick={() => canEdit && makePrimary(build.id)}
                  disabled={!canEdit}
                  title="La build con la que juega normalmente"
                  className={`text-xs font-bold px-3 py-2 rounded border transition-all ${
                    build.isPrimary
                      ? 'border-amber-500 text-amber-400 bg-amber-500/10'
                      : 'border-slate-800 text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <i className="fa-solid fa-star mr-1"></i>
                  Principal
                </button>
                <button
                  onClick={() => fold(build.id, !expanded)}
                  title={expanded ? 'Plegar' : canEdit ? 'Editar armas y roles' : 'Ver armas y roles'}
                  className={`text-xs font-bold px-3 py-2 rounded border transition-all ${
                    expanded
                      ? 'border-slate-700 text-slate-300'
                      : 'border-slate-800 text-slate-500 hover:text-amber-500 hover:border-amber-700'
                  }`}
                >
                  <i className={`fa-solid ${expanded ? 'fa-check' : canEdit ? 'fa-pen' : 'fa-eye'} mr-1`}></i>
                  {expanded ? 'Listo' : canEdit ? 'Editar' : 'Ver'}
                </button>
                {canEdit && (
                  <button
                    onClick={() => setBuilds((prev) => (prev ?? []).filter((b) => b.id !== build.id))}
                    className="p-2 text-slate-500 hover:text-red-400 transition-all"
                    title="Eliminar esta build"
                  >
                    <i className="fa-solid fa-trash-can"></i>
                  </button>
                )}
              </div>

              {!expanded && (
                <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap">
                  {build.roles.map((role) => (
                    <span
                      key={role}
                      className={`text-[10px] font-bold px-2 py-0.5 rounded border ${ROLE_STYLE[role]}`}
                    >
                      {ROLE_NAMES[role]}
                    </span>
                  ))}
                  {!build.roles.length && (
                    <span className="text-[10px] text-slate-600 italic">Sin rol asignado</span>
                  )}

                  {build.weapons.map((weapon) => {
                    const set = sets.find((s) => s.weapons.includes(weapon));
                    return (
                      <span
                        key={weapon}
                        title={set ? set.name : 'Ya no está en ningún conjunto'}
                        className="text-[11px] px-2 py-0.5 rounded border flex items-center gap-1.5"
                        style={
                          set
                            ? { borderColor: set.color, color: set.color, backgroundColor: `${set.color}1a` }
                            : { borderColor: '#92400e', color: '#f59e0b' }
                        }
                      >
                        {set ? (
                          <SetBadge set={set} size={13} />
                        ) : (
                          <i className="fa-solid fa-triangle-exclamation text-[9px]"></i>
                        )}
                        <span className={set ? '' : 'line-through'}>{weapon}</span>
                      </span>
                    );
                  })}
                  {!build.weapons.length && (
                    <span className="text-[10px] text-slate-600 italic">Sin armas</span>
                  )}
                </div>
              )}

              {!expanded && build.notes && (
                <p className="text-xs text-slate-500 italic">{build.notes}</p>
              )}

              {expanded && (
              <>
              <div>
                <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
                  Roles que cubre
                </span>
                <div className="flex gap-2 flex-wrap">
                  {Object.values(Role).map((role) => (
                    <button
                      key={role}
                      disabled={!canEdit}
                      onClick={() => update(build.id, { roles: toggle(build.roles, role) })}
                      className={`text-xs font-bold px-3 py-1.5 rounded border transition-all ${
                        build.roles.includes(role)
                          ? ROLE_STYLE[role]
                          : 'border-slate-800 text-slate-600 hover:text-slate-400'
                      }`}
                    >
                      {role}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
                  Armas ({build.weapons.length}/4)
                </span>
                <div className="space-y-1.5">
                  {sets.map((set) => (
                    <div key={set.id} className="flex items-center gap-2 flex-wrap">
                      <SetBadge set={set} />
                      {set.weapons.map((weapon) => {
                        const picked = build.weapons.includes(weapon);
                        return (
                          <button
                            key={weapon}
                            disabled={!canEdit}
                            onClick={() => update(build.id, { weapons: toggle(build.weapons, weapon) })}
                            className="text-[11px] px-2 py-1 rounded border transition-all"
                            style={
                              picked
                                ? { borderColor: set.color, color: set.color, backgroundColor: `${set.color}1a` }
                                : undefined
                            }
                          >
                            <span className={picked ? '' : 'text-slate-600'}>{weapon}</span>
                          </button>
                        );
                      })}
                      <span className="text-[10px] text-slate-700 italic">{set.name}</span>
                    </div>
                  ))}
                  {(() => {
                    // Weapons the catalogue no longer contains -- usually because
                    // it was renamed after the build was saved. Shown so they can
                    // be dropped, instead of quietly costing the build its colour.
                    const known = new Set(sets.flatMap((s) => s.weapons));
                    const lost = build.weapons.filter((w) => !known.has(w));
                    if (!lost.length) return null;
                    return (
                      <div className="flex items-center gap-2 flex-wrap pt-1">
                        <span className="text-[10px] text-amber-500">
                          <i className="fa-solid fa-triangle-exclamation mr-1"></i>
                          ya no están en ningún conjunto:
                        </span>
                        {lost.map((weapon) => (
                          <button
                            key={weapon}
                            disabled={!canEdit}
                            title="Quitar de la build"
                            onClick={() => update(build.id, { weapons: toggle(build.weapons, weapon) })}
                            className="text-[11px] px-2 py-1 rounded border border-amber-800/70 text-amber-500/90 line-through"
                          >
                            {weapon}
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                  {!sets.length && (
                    <p className="text-xs text-slate-600">
                      No hay conjuntos de armas definidos. Se crean en Administración.
                    </p>
                  )}
                </div>
              </div>

              <input
                type="text"
                value={build.notes ?? ''}
                disabled={!canEdit}
                placeholder="Notas (opcional)"
                onChange={(e) => update(build.id, { notes: e.target.value })}
                className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs outline-none focus:ring-1 focus:ring-amber-500"
              />
              </>
              )}
            </div>
            );
          })}

          {canEdit && builds && (
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => {
                  const fresh = { ...blank(), playerId: player.id };
                  setBuilds([...(builds ?? []), fresh]);
                  fold(fresh.id, true);
                }}
                className="flex-1 min-h-tap border-2 border-dashed border-slate-800 hover:border-amber-600 text-slate-500 hover:text-amber-500 rounded-lg text-sm transition-all"
              >
                <i className="fa-solid fa-plus mr-2"></i>
                Añadir build
              </button>
              <button
                onClick={save}
                disabled={busy}
                className="min-h-tap bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 text-white text-sm font-bold px-6 rounded transition-all flex items-center gap-2"
              >
                <i className="fa-solid fa-floppy-disk"></i>
                Guardar
              </button>
            </div>
          )}
      </div>
    </Sheet>
  );
};

export default BuildEditor;
