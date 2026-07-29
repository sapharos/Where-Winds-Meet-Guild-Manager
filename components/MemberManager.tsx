
import React, { useMemo, useState } from 'react';
import { Player, PlayerBuild, Role, Platform, MembershipStatus, GuildRank, SECTS, WeaponSet } from '../types';
import PlayerCard, { ROLE_NAMES } from './PlayerCard';

interface MemberManagerProps {
  players: Player[];
  ranks: GuildRank[];
  builds?: PlayerBuild[];
  weaponSets?: WeaponSet[];
  isViewer?: boolean;
  onAdd: (p: Player) => void;
  onUpdate: (p: Player) => void;
  onDelete: (id: string) => void;
  onAddRank: (r: GuildRank) => void;
  onDeleteRank: (id: string) => void;
  onShowHistory?: (p: Player) => void;
  onShowBuilds?: (p: Player) => void;
  onToggleStarter?: (p: Player) => void;
  canManageRanks?: boolean;
}

const EMPTY: Omit<Player, 'id'> = {
  name: '',
  role: Role.DPS,
  level: 50,
  sect: 'Sectless',
  platform: undefined,
  status: MembershipStatus.APPRENTICE,
  rankId: undefined,
  notes: '',
};

const MemberManager: React.FC<MemberManagerProps> = ({
  players,
  ranks,
  builds = [],
  weaponSets = [],
  isViewer = false,
  onAdd,
  onUpdate,
  onDelete,
  onAddRank,
  onDeleteRank,
  onShowHistory,
  onShowBuilds,
  onToggleStarter,
  canManageRanks = false,
}) => {
  const [editing, setEditing] = useState<Player | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formData, setFormData] = useState<Omit<Player, 'id'>>(EMPTY);

  const [showRankEditor, setShowRankEditor] = useState(false);
  const [newRankName, setNewRankName] = useState('');
  const [newRankColor, setNewRankColor] = useState('#f59e0b');

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'' | Role>('');
  const [buildFilter, setBuildFilter] = useState('');
  const [startersOnly, setStartersOnly] = useState(false);

  // The build shown on a card is the primary one; the rest describe how else
  // someone can play, which belongs in the build editor rather than here.
  const primaryOf = useMemo(() => {
    const map = new Map<string, PlayerBuild>();
    for (const build of builds) {
      if (build.isPrimary || !map.has(build.playerId)) map.set(build.playerId, build);
    }
    return map;
  }, [builds]);

  const buildNames = useMemo(
    () => [...new Set(builds.map((b) => b.name).filter(Boolean))].sort(),
    [builds],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return players.filter((p) => {
      if (needle && !p.name.toLowerCase().includes(needle)) return false;
      if (startersOnly && !p.isStarter) return false;

      const build = primaryOf.get(p.id);
      // A role filter asks what somebody can play, so it looks at the build's
      // roles when there is one -- a hybrid should turn up under both.
      if (roleFilter) {
        const covered = build?.roles?.length ? build.roles : [p.role];
        if (!covered.includes(roleFilter)) return false;
      }
      if (buildFilter && build?.name !== buildFilter) return false;
      return true;
    });
  }, [players, search, roleFilter, buildFilter, startersOnly, primaryOf]);

  const openNew = () => {
    setEditing(null);
    setFormData(EMPTY);
    setFormOpen(true);
  };

  const openEdit = (p: Player) => {
    if (isViewer) return;
    setEditing(p);
    setFormData({
      name: p.name,
      role: p.role,
      level: p.level,
      sect: p.sect || 'Sectless',
      platform: p.platform,
      status: p.status || MembershipStatus.FULL_MEMBER,
      rankId: p.rankId,
      notes: p.notes,
    });
    setFormOpen(true);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isViewer) return;
    if (editing) onUpdate({ ...formData, id: editing.id });
    else onAdd({ ...formData, id: Date.now().toString() });
    setFormOpen(false);
    setEditing(null);
    setFormData(EMPTY);
  };

  const addRank = (e: React.FormEvent) => {
    e.preventDefault();
    if (isViewer || !newRankName.trim()) return;
    onAddRank({ id: `rank-${Date.now()}`, name: newRankName, color: newRankColor });
    setNewRankName('');
  };

  const starters = players.filter((p) => p.isStarter).length;

  return (
    <div className="space-y-5">
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
          <h2 className="cinzel text-2xl font-bold text-amber-500">
            Roster del gremio
            <span className="ml-3 text-sm font-normal text-slate-500">
              {visible.length} de {players.length}
              {starters > 0 && <span className="text-amber-500/80"> · {starters} titulares</span>}
            </span>
          </h2>
          {!isViewer && (
            <button
              onClick={openNew}
              className="bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold py-2 px-4 rounded transition-all flex items-center gap-2"
            >
              <i className="fa-solid fa-user-plus"></i>
              Nuevo miembro
            </button>
          )}
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 text-xs"></i>
            <input
              type="text"
              value={search}
              placeholder="Buscar por nombre..."
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded p-2 pl-8 text-sm outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>

          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as '' | Role)}
            className="bg-slate-950 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
          >
            <option value="">Todos los roles</option>
            {Object.values(Role).map((r) => (
              <option key={r} value={r}>
                {ROLE_NAMES[r]}
              </option>
            ))}
          </select>

          <select
            value={buildFilter}
            onChange={(e) => setBuildFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
          >
            <option value="">Todas las builds</option>
            {buildNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <button
            onClick={() => setStartersOnly((v) => !v)}
            className={`rounded p-2 text-sm border transition-all flex items-center justify-center gap-2 ${
              startersOnly
                ? 'border-amber-500 text-amber-400 bg-amber-500/10'
                : 'border-slate-800 text-slate-500 hover:text-slate-300'
            }`}
          >
            <i className={`${startersOnly ? 'fa-solid' : 'fa-regular'} fa-star`}></i>
            Solo titulares
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-12">
          Ningún miembro coincide con estos filtros.
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {visible.map((p) => (
            <PlayerCard
              key={p.id}
              player={p}
              build={primaryOf.get(p.id)}
              weaponSets={weaponSets}
              ranks={ranks}
              onEdit={isViewer ? undefined : openEdit}
              onDelete={isViewer ? undefined : onDelete}
              onShowHistory={onShowHistory}
              onShowBuilds={onShowBuilds}
              onToggleStarter={isViewer ? undefined : onToggleStarter}
            />
          ))}
        </div>
      )}

      {formOpen && (
        <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-lg my-8">
            <div className="flex items-center justify-between p-6 border-b border-slate-800">
              <h2 className="cinzel text-2xl font-bold text-amber-500">
                {editing ? `Editar a ${editing.name}` : 'Nuevo miembro'}
              </h2>
              <button
                onClick={() => { setFormOpen(false); setEditing(null); }}
                className="p-2 text-slate-400 hover:text-amber-500 transition-all"
              >
                <i className="fa-solid fa-xmark text-xl"></i>
              </button>
            </div>

            <form onSubmit={submit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">Nombre</label>
                <input
                  type="text"
                  required
                  autoFocus
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">Rol principal</label>
                  <select
                    className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value as Role })}
                  >
                    {Object.values(Role).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_NAMES[r]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">Nivel</label>
                  <input
                    type="number"
                    className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
                    value={formData.level}
                    onChange={(e) => setFormData({ ...formData, level: parseInt(e.target.value) || 1 })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">Secta</label>
                <select
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
                  value={formData.sect}
                  onChange={(e) => setFormData({ ...formData, sect: e.target.value })}
                >
                  {SECTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">
                  Rango del gremio
                  {!canManageRanks && (
                    <span className="ml-2 normal-case tracking-normal text-slate-600">
                      solo el líder y el administrador
                    </span>
                  )}
                </label>
                <div className="flex gap-2">
                  <select
                    disabled={!canManageRanks}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
                    value={formData.rankId || ''}
                    onChange={(e) => setFormData({ ...formData, rankId: e.target.value || undefined })}
                  >
                    <option value="">Sin rango especial</option>
                    {ranks.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  {canManageRanks && (
                    <button
                      type="button"
                      onClick={() => setShowRankEditor(!showRankEditor)}
                      className={`p-2 rounded border transition-colors ${
                        showRankEditor
                          ? 'bg-amber-600 border-amber-500 text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-500'
                      }`}
                    >
                      <i className="fa-solid fa-gear"></i>
                    </button>
                  )}
                </div>
              </div>

              {showRankEditor && canManageRanks && (
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-2">
                  <p className="text-[10px] text-slate-500 uppercase font-bold">Gestionar rangos</p>
                  {ranks.map((r) => (
                    <div key={r.id} className="flex items-center justify-between text-xs bg-slate-900 p-1.5 rounded border border-slate-800">
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: r.color }} />
                        {r.name}
                      </span>
                      <button type="button" onClick={() => onDeleteRank(r.id)} className="text-slate-600 hover:text-red-500">
                        <i className="fa-solid fa-trash-can"></i>
                      </button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newRankName}
                      placeholder="Nombre del rango"
                      onChange={(e) => setNewRankName(e.target.value)}
                      className="flex-1 bg-slate-900 border border-slate-800 rounded p-1.5 text-xs outline-none"
                    />
                    <input
                      type="color"
                      value={newRankColor}
                      onChange={(e) => setNewRankColor(e.target.value)}
                      className="w-9 h-8 bg-slate-900 border border-slate-800 rounded cursor-pointer"
                    />
                    <button
                      type="button"
                      onClick={addRank}
                      className="bg-slate-800 hover:bg-slate-700 text-xs px-3 rounded transition-all"
                    >
                      Añadir
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">Membresía</label>
                <div className="flex gap-2">
                  {[MembershipStatus.APPRENTICE, MembershipStatus.FULL_MEMBER].map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setFormData({ ...formData, status })}
                      className={`flex-1 py-2 rounded border transition-all text-xs font-bold ${
                        formData.status === status
                          ? 'bg-amber-900/30 border-amber-600 text-amber-500'
                          : 'bg-slate-950 border-slate-800 text-slate-500'
                      }`}
                    >
                      {status === MembershipStatus.APPRENTICE ? 'Aprendiz' : 'Miembro pleno'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">Plataforma</label>
                <select
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
                  value={formData.platform ?? ''}
                  onChange={(e) =>
                    setFormData({ ...formData, platform: (e.target.value || undefined) as Platform | undefined })
                  }
                >
                  <option value="">Sin especificar</option>
                  {Object.values(Platform).map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">Notas</label>
                <input
                  type="text"
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
                  value={formData.notes ?? ''}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setFormOpen(false); setEditing(null); }}
                  className="flex-1 text-slate-400 hover:text-slate-200 text-sm py-2 rounded transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-bold py-2 rounded transition-all"
                >
                  {editing ? 'Guardar cambios' : 'Registrar miembro'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default MemberManager;
