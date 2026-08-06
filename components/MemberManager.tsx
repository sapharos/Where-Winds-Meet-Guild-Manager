
import React, { useMemo, useState } from 'react';
import { Player, PlayerBuild, Role, Platform, MembershipStatus, GuildRank, SECTS, WeaponSet, WarSide, WAR_SIDE_LABELS } from '../types';
import PlayerCard, { ROLE_NAMES } from './PlayerCard';
import { SetBadge } from './BuildEditor';
import Sheet from './Sheet';

interface MemberManagerProps {
  players: Player[];
  ranks: GuildRank[];
  builds?: PlayerBuild[];
  weaponSets?: WeaponSet[];
  isViewer?: boolean;
  onAdd: (p: Player) => void;
  onUpdate: (p: Player) => void;
  onShowHistory?: (p: Player) => void;
  onShowBuilds?: (p: Player) => void;
  onToggleStarter?: (p: Player) => void;
  onCycleSide?: (p: Player) => void;
  onToggleActive?: (p: Player) => void;
}

/** One weapon in the filter list, with how many members carry it. */
const WeaponOption: React.FC<{
  weapon: string;
  count: number;
  colour: string;
  checked: boolean;
  onToggle: () => void;
}> = ({ weapon, count, colour, checked, onToggle }) => (
  // La etiqueta entera es el objetivo, no la casilla: ésta mide 20 px y no
  // crece sin deformarse, pero la fila que la envuelve sí, y pulsarla hace lo
  // mismo.
  <label className="min-h-tap flex items-center gap-2 px-2 rounded cursor-pointer hover:bg-slate-900 transition-all">
    <input type="checkbox" checked={checked} onChange={onToggle} className="accent-amber-500" />
    <span
      className={`text-sm flex-1 truncate ${checked ? 'font-semibold' : 'text-slate-400'}`}
      style={checked ? { color: colour } : undefined}
    >
      {weapon}
    </span>
    <span className={`text-[11px] tabular-nums ${count ? 'text-slate-500' : 'text-slate-700'}`}>
      {count}
    </span>
  </label>
);

const EMPTY: Omit<Player, 'id'> = {
  name: '',
  role: Role.DPS,
  level: 50,
  sect: 'Sectless',
  platform: undefined,
  status: MembershipStatus.APPRENTICE,
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
  onShowHistory,
  onShowBuilds,
  onToggleStarter,
  onCycleSide,
  onToggleActive,
}) => {
  const [editing, setEditing] = useState<Player | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formData, setFormData] = useState<Omit<Player, 'id'>>(EMPTY);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'' | Role>('');
  const [weaponFilter, setWeaponFilter] = useState<string[]>([]);
  const [startersOnly, setStartersOnly] = useState(false);
  const [sideFilter, setSideFilter] = useState<'' | WarSide>('');
  const [showGone, setShowGone] = useState(false);
  const [order, setOrder] = useState<'lineup' | 'mastery' | 'set' | 'name'>('lineup');
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);

  // The build shown on a card is the primary one; the rest describe how else
  // someone can play, which belongs in the build editor rather than here.
  const primaryOf = useMemo(() => {
    const map = new Map<string, PlayerBuild>();
    for (const build of builds) {
      if (build.isPrimary || !map.has(build.playerId)) map.set(build.playerId, build);
    }
    return map;
  }, [builds]);

  // Where a member sits when the roster is grouped by what they play: the
  // catalogue's own order, so the list reads the way the sets are listed, and
  // whoever has no set falls to the end rather than to the top.
  const setRank = useMemo(() => {
    const place = new Map(weaponSets.map((s, i) => [s.id, i]));
    return (player: Player, which: 0 | 1) => {
      const weapon = primaryOf.get(player.id)?.weapons[which];
      const set = weapon ? weaponSets.find((s) => s.weapons.includes(weapon)) : undefined;
      return set ? (place.get(set.id) ?? weaponSets.length) : Number.MAX_SAFE_INTEGER;
    };
  }, [weaponSets, primaryOf]);

  // Filtering asks who can bring a weapon, so it reads every build a member has
  // and not only the primary one: a second build is precisely where the weapon
  // you are short of tends to be.
  const weaponsOf = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const build of builds) {
      let owned = map.get(build.playerId);
      if (!owned) map.set(build.playerId, (owned = new Set()));
      for (const weapon of build.weapons) owned.add(weapon);
    }
    return map;
  }, [builds]);

  // How many of the people on the roster carry each weapon, so the list says
  // what the guild actually fields rather than what the catalogue offers.
  const usage = useMemo(() => {
    const count = new Map<string, number>();
    for (const player of players) {
      if (player.isActive === false) continue;
      for (const weapon of weaponsOf.get(player.id) ?? []) {
        count.set(weapon, (count.get(weapon) ?? 0) + 1);
      }
    }
    return count;
  }, [players, weaponsOf]);

  // The catalogue, in its own order, plus anything a build still names after the
  // catalogue moved on -- otherwise those members become unfilterable.
  const weaponGroups = useMemo(() => {
    const known = new Set(weaponSets.flatMap((s) => s.weapons));
    const loose = [...usage.keys()].filter((w) => !known.has(w)).sort();
    return { sets: weaponSets, loose };
  }, [weaponSets, usage]);

  const toggleWeapon = (weapon: string) =>
    setWeaponFilter((prev) =>
      prev.includes(weapon) ? prev.filter((w) => w !== weapon) : [...prev, weapon],
    );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return players.filter((p) => {
      if (needle && !p.name.toLowerCase().includes(needle)) return false;
      // People who left stay in the database for their history, but the roster
      // is about who is here, so they are out of the way unless asked for.
      if (!showGone && p.isActive === false) return false;
      if (startersOnly && !p.isStarter) return false;

      const build = primaryOf.get(p.id);
      // A role filter asks what somebody can play, so it looks at the build's
      // roles when there is one -- a hybrid should turn up under both.
      if (roleFilter) {
        const covered = build?.roles?.length ? build.roles : [p.role];
        if (!covered.includes(roleFilter)) return false;
      }
      // Several weapons read as "any of these": you pick the ones that would
      // serve and see who could bring one, not who brings the whole list.
      if (weaponFilter.length) {
        const owned = weaponsOf.get(p.id);
        if (!owned || !weaponFilter.some((w) => owned.has(w))) return false;
      }
      if (sideFilter && p.warSide !== sideFilter) return false;
      return true;
    })
    .sort((a, b) => {
      // Sorted by mastery, somebody never scanned goes last rather than first:
      // a missing figure is not a zero, and the list is being read to find who
      // is strongest.
      if (order === 'mastery') {
        const mine = a.martialMastery ?? -1;
        const theirs = b.martialMastery ?? -1;
        if (mine !== theirs) return theirs - mine;
        return a.name.localeCompare(b.name);
      }
      // Grouped by set, the second weapon breaks the tie, so a pair stays with
      // its pair instead of scattering by name inside the group.
      if (order === 'set') {
        const gap = setRank(a, 0) - setRank(b, 0) || setRank(a, 1) - setRank(b, 1);
        if (gap) return gap;
        return a.name.localeCompare(b.name);
      }
      // Whoever is being fielded comes first: on war day the roster is read to
      // check the line-up, not to browse the whole guild.
      if (order === 'lineup') {
        const gap = Number(Boolean(b.isStarter)) - Number(Boolean(a.isStarter));
        if (gap) return gap;
      }
      return a.name.localeCompare(b.name);
    });
  }, [players, search, roleFilter, weaponFilter, weaponsOf, startersOnly, sideFilter, showGone, order, setRank, primaryOf]);

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
      notes: p.notes,
    });
    setFormOpen(true);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isViewer) return;
    // Sobre el jugador que ya existe, no en su lugar: el formulario sólo sabe
    // de sus ocho campos, y mandarlo solo borraba todo lo demás -- titular,
    // bando, maestría, el rango puesto, hasta el estado de baja. Guardar una
    // edición sin tocar nada dejaba al miembro desnudo.
    if (editing) onUpdate({ ...editing, ...formData, id: editing.id });
    else onAdd({ ...formData, id: Date.now().toString() });
    setFormOpen(false);
    setEditing(null);
    setFormData(EMPTY);
  };

  /** Todo lo que estrecha la lista, de una vez: la salida del estado vacío. */
  const limpiarFiltros = () => {
    setSearch('');
    setRoleFilter('');
    setWeaponFilter([]);
    setSideFilter('');
    setStartersOnly(false);
    setShowGone(false);
  };

  const active = players.filter((p) => p.isActive !== false);
  const gone = players.length - active.length;
  const starters = active.filter((p) => p.isStarter).length;

  /** Cuántos filtros estrechan la lista ahora mismo, sin contar la búsqueda. */
  const filtrosPuestos = [
    roleFilter !== '',
    weaponFilter.length > 0,
    sideFilter !== '',
    startersOnly,
    showGone,
  ].filter(Boolean).length;

  /**
   * Los controles, escritos una vez y colocados en dos sitios.
   *
   * En la rejilla a partir de sm, y dentro de la hoja en el teléfono. Como
   * variable y no como componente: un componente declarado aquí dentro se
   * remonta en cada render y cerraría el desplegable de armas mientras se está
   * usando.
   */
  const controlesFiltro = (
    <>
      <select
        value={roleFilter}
        onChange={(e) => setRoleFilter(e.target.value as '' | Role)}
        aria-label="Filtrar por rol"
        className="w-full min-h-tap bg-slate-950 border border-slate-800 rounded px-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
      >
        <option value="">Todos los roles</option>
        {Object.values(Role).map((r) => (
          <option key={r} value={r}>
            {ROLE_NAMES[r]}
          </option>
        ))}
      </select>

      <details className="relative">
        <summary className="list-none cursor-pointer w-full min-h-tap bg-slate-950 border border-slate-800 rounded px-2 text-sm flex items-center justify-between gap-2 hover:border-slate-700 transition-all">
          <span className={weaponFilter.length ? 'text-amber-400 truncate' : 'text-slate-400 truncate'}>
            {weaponFilter.length === 0
              ? 'Todas las armas'
              : weaponFilter.length === 1
                ? weaponFilter[0]
                : `${weaponFilter.length} armas`}
          </span>
          <i className="fa-solid fa-chevron-down text-[10px] text-slate-600"></i>
        </summary>

        <div className="absolute z-30 mt-1 w-full sm:w-72 max-w-[calc(100vw-3rem)] max-h-80 overflow-y-auto overscroll-contain custom-scrollbar bg-slate-950 border border-slate-800 rounded-lg p-2 shadow-2">
          <button
            onClick={() => setWeaponFilter([])}
            disabled={!weaponFilter.length}
            className="w-full min-h-tap text-left text-sm px-2 rounded text-slate-500 hover:text-amber-500 disabled:text-slate-700 disabled:hover:text-slate-700 transition-all"
          >
            <i className="fa-solid fa-xmark mr-1.5"></i>
            Quitar el filtro de armas
          </button>

          {weaponGroups.sets.map((set) => (
            <div key={set.id} className="mt-1">
              <div className="flex items-center gap-1.5 px-2 py-1">
                <SetBadge set={set} size={12} />
                <span className="text-[11px] uppercase tracking-wider" style={{ color: set.color }}>
                  {set.name}
                </span>
              </div>
              {set.weapons.map((weapon) => (
                <WeaponOption
                  key={weapon}
                  weapon={weapon}
                  count={usage.get(weapon) ?? 0}
                  colour={set.color}
                  checked={weaponFilter.includes(weapon)}
                  onToggle={() => toggleWeapon(weapon)}
                />
              ))}
            </div>
          ))}

          {weaponGroups.loose.length > 0 && (
            <div className="mt-1">
              <div className="flex items-center gap-1.5 px-2 py-1">
                <i className="fa-solid fa-triangle-exclamation text-[11px] text-amber-600"></i>
                <span className="text-[11px] uppercase tracking-wider text-amber-600">
                  Fuera del catálogo
                </span>
              </div>
              {weaponGroups.loose.map((weapon) => (
                <WeaponOption
                  key={weapon}
                  weapon={weapon}
                  count={usage.get(weapon) ?? 0}
                  colour="#f59e0b"
                  checked={weaponFilter.includes(weapon)}
                  onToggle={() => toggleWeapon(weapon)}
                />
              ))}
            </div>
          )}

          {!weaponGroups.sets.length && !weaponGroups.loose.length && (
            <p className="text-sm text-slate-600 px-2 py-2">No hay conjuntos de armas definidos.</p>
          )}
        </div>
      </details>

      <select
        value={sideFilter}
        onChange={(e) => setSideFilter(e.target.value as '' | WarSide)}
        aria-label="Filtrar por bando"
        className="w-full min-h-tap bg-slate-950 border border-slate-800 rounded px-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
      >
        <option value="">Ataque y defensa</option>
        {(Object.keys(WAR_SIDE_LABELS) as WarSide[]).map((side) => (
          <option key={side} value={side}>
            {WAR_SIDE_LABELS[side]}
          </option>
        ))}
      </select>

      <select
        value={order}
        onChange={(e) => setOrder(e.target.value as 'lineup' | 'mastery' | 'set' | 'name')}
        aria-label="Orden de la lista"
        className="w-full min-h-tap bg-slate-950 border border-slate-800 rounded px-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
      >
        <option value="lineup">Titulares primero</option>
        <option value="mastery">Maestría marcial ↓</option>
        <option value="set">Conjunto de armas</option>
        <option value="name">Nombre</option>
      </select>

      <button
        onClick={() => setShowGone((v) => !v)}
        aria-pressed={showGone}
        className={`w-full min-h-tap rounded px-2 text-sm border transition-all flex items-center justify-center gap-2 ${
          showGone
            ? 'border-slate-500 text-slate-300 bg-slate-800/60'
            : 'border-slate-800 text-slate-500 hover:text-slate-300'
        }`}
      >
        <i className="fa-solid fa-user-slash"></i>
        Ver bajas{gone > 0 ? ` (${gone})` : ''}
      </button>

      <button
        onClick={() => setStartersOnly((v) => !v)}
        aria-pressed={startersOnly}
        className={`w-full min-h-tap rounded px-2 text-sm border transition-all flex items-center justify-center gap-2 ${
          startersOnly
            ? 'border-amber-500 text-amber-400 bg-amber-500/10'
            : 'border-slate-800 text-slate-500 hover:text-slate-300'
        }`}
      >
        <i className={`${startersOnly ? 'fa-solid' : 'fa-regular'} fa-star`}></i>
        Solo titulares
      </button>
    </>
  );

  return (
    <div className="space-y-5">
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
          <h2 className="cinzel text-2xl font-bold text-amber-500">
            Roster del gremio
            <span className="ml-3 text-sm font-normal text-slate-500">
              {visible.length} de {active.length}
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

        {/*
          En el teléfono, la búsqueda a la vista y el resto detrás de un botón.

          Siete controles en columna medían 380 px: la primera tarjeta de
          miembro empezaba a 735 px del borde superior, es decir, por debajo de
          la pantalla. Se veía el buscador, cinco desplegables y dos botones, y
          había que desplazar para ver a alguien -- en una pantalla cuyo trabajo
          es enseñar quién está en el gremio.

          El buscador se queda fuera porque es el que más se usa y porque
          escribir dos letras sustituye a casi cualquier filtro. Los demás
          entran en una hoja que dice cuántos hay puestos, para que esconderlos
          no signifique olvidarlos. A partir de sm vuelve la rejilla entera.
        */}
        <div className="flex gap-2 sm:hidden">
          <div className="relative flex-1 min-w-0">
            <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 text-xs"></i>
            <input
              type="search"
              value={search}
              placeholder="Buscar por nombre..."
              aria-label="Buscar por nombre"
              autoComplete="off"
              enterKeyHint="search"
              onChange={(e) => setSearch(e.target.value)}
              className="w-full min-h-tap bg-slate-950 border border-slate-800 rounded px-3 pl-8 text-sm outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>
          <button
            onClick={() => setFiltrosAbiertos(true)}
            aria-haspopup="dialog"
            className={`shrink-0 min-h-tap px-3 rounded border text-sm flex items-center gap-2 transition-colors duration-micro ${
              filtrosPuestos
                ? 'border-amber-500 text-amber-400 bg-amber-500/10'
                : 'border-slate-800 text-slate-400'
            }`}
          >
            <i className="fa-solid fa-filter"></i>
            Filtros
            {filtrosPuestos > 0 && (
              <span className="tabular-nums font-bold">({filtrosPuestos})</span>
            )}
          </button>
        </div>

        <div className="hidden sm:grid sm:grid-cols-2 lg:grid-cols-7 gap-3">
          <div className="relative">
            <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 text-xs"></i>
            <input
              type="search"
              value={search}
              placeholder="Buscar por nombre..."
              aria-label="Buscar por nombre"
              autoComplete="off"
              enterKeyHint="search"
              onChange={(e) => setSearch(e.target.value)}
              className="w-full min-h-tap bg-slate-950 border border-slate-800 rounded px-3 pl-8 text-sm outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>

          {controlesFiltro}
        </div>
      </div>

      {filtrosAbiertos && (
        <Sheet
          title="Filtros"
          subtitle={`${visible.length} de ${active.length} miembros a la vista`}
          size="sm"
          onClose={() => setFiltrosAbiertos(false)}
          footer={
            <div className="flex gap-2">
              <button
                onClick={limpiarFiltros}
                disabled={!filtrosPuestos && !search}
                className="flex-1 min-h-tap rounded border border-slate-700 text-slate-300 disabled:opacity-40 transition-colors duration-micro"
              >
                Quitar todos
              </button>
              <button
                onClick={() => setFiltrosAbiertos(false)}
                className="flex-1 min-h-tap rounded bg-amber-600 hover:bg-amber-500 text-white font-bold transition-colors duration-micro"
              >
                Ver {visible.length}
              </button>
            </div>
          }
        >
          <div className="flex flex-col gap-3">{controlesFiltro}</div>
        </Sheet>
      )}

      {visible.length === 0 ? (
        // Un estado vacío que sólo constata el vacío deja al lector con el
        // problema en la mano. Este dice además cuál es la salida, y la ofrece.
        <div className="text-center py-12 px-4">
          <i className="fa-solid fa-users text-3xl text-slate-700"></i>
          <p className="text-sm text-slate-400 mt-3">Ningún miembro coincide con estos filtros.</p>
          <button
            onClick={limpiarFiltros}
            className="mt-4 min-h-tap px-4 rounded-md border border-slate-700 text-slate-300 hover:text-amber-500 hover:border-amber-700 transition-colors duration-micro"
          >
            <i className="fa-solid fa-xmark mr-2"></i>
            Quitar todos los filtros
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {visible.map((p, at) => (
            // El escalonado se detiene en el sexto: a partir de ahí el retardo
            // deja de crecer y el resto entra a la vez. Escalonar cincuenta y
            // ocho tarjetas serían dos segundos y medio de espera para ver una
            // lista que ya estaba lista.
            <div key={p.id} className="entra" style={{ '--paso': Math.min(at, 6) } as React.CSSProperties}>
            <PlayerCard
              player={p}
              build={primaryOf.get(p.id)}
              weaponSets={weaponSets}
              ranks={ranks}
              onEdit={isViewer ? undefined : openEdit}
              onShowHistory={onShowHistory}
              onShowBuilds={onShowBuilds}
              onToggleStarter={isViewer ? undefined : onToggleStarter}
              onCycleSide={isViewer ? undefined : onCycleSide}
              onToggleActive={isViewer ? undefined : onToggleActive}
            />
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <Sheet
          title={editing ? `Editar a ${editing.name}` : 'Nuevo miembro'}
          size="md"
          onClose={() => { setFormOpen(false); setEditing(null); }}
        >
            <form onSubmit={submit} className="space-y-4">
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
                    inputMode="numeric"
                    autoComplete="off"
                    className="w-full min-h-tap bg-slate-950 border border-slate-800 rounded px-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
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

              {/* Aquí hubo un selector de "Rango del gremio" con su propio
                  editor de catálogo. Se quitó a propósito: quién es líder u
                  oficial lo dicen los roles del sistema de usuarios, y un
                  segundo sitio donde escribir lo mismo es un sitio donde
                  contradecirlo. El rankId que un miembro ya tenga se conserva
                  tal cual al guardar. */}

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
                  className="flex-1 min-h-tap text-slate-400 hover:text-slate-200 text-sm rounded transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 min-h-tap bg-amber-600 hover:bg-amber-500 text-white font-bold rounded transition-all"
                >
                  {editing ? 'Guardar cambios' : 'Registrar miembro'}
                </button>
              </div>
            </form>
        </Sheet>
      )}
    </div>
  );
};

export default MemberManager;
