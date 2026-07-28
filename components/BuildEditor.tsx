import React, { useEffect, useState } from 'react';
import { api } from '../services/authService';
import { Player, PlayerBuild, Role, WeaponSet } from '../types';

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
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-3xl my-8">
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <div>
            <h2 className="cinzel text-2xl font-bold text-amber-500">Builds de {player.name}</h2>
            <p className="text-xs text-slate-500 mt-1">
              {canEdit
                ? 'Una build puede cubrir varios roles a la vez. La principal decide el rol que usa la War Room.'
                : 'Solo lectura: no tienes permiso para editar estas builds.'}
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

          {!builds && <p className="text-sm text-slate-500">Cargando...</p>}

          {builds?.length === 0 && (
            <p className="text-sm text-slate-500">
              Todavía no tiene builds registradas.
            </p>
          )}

          {builds?.map((build) => (
            <div key={build.id} className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <input
                  type="text"
                  value={build.name}
                  disabled={!canEdit}
                  placeholder="Nombre de la build"
                  onChange={(e) => update(build.id, { name: e.target.value })}
                  className="flex-1 min-w-[160px] bg-slate-900 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
                />
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
            </div>
          ))}

          {canEdit && builds && (
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setBuilds([...(builds ?? []), { ...blank(), playerId: player.id }])}
                className="flex-1 border-2 border-dashed border-slate-800 hover:border-amber-600 text-slate-500 hover:text-amber-500 rounded-lg py-3 text-sm transition-all"
              >
                <i className="fa-solid fa-plus mr-2"></i>
                Añadir build
              </button>
              <button
                onClick={save}
                disabled={busy}
                className="bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 text-white text-sm font-bold py-2 px-6 rounded transition-all flex items-center gap-2"
              >
                <i className="fa-solid fa-floppy-disk"></i>
                Guardar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BuildEditor;
