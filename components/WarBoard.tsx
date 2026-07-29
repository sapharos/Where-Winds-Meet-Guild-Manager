import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../services/authService';
import {
  Deployment,
  LANE_CAPACITY,
  Player,
  PlayerBuild,
  Role,
  WAR_LANES,
  WAR_SIDE_LABELS,
  WarLane,
  WarSide,
  WarStrategy,
} from '../types';
import { ROLE_NAMES } from './PlayerCard';

const ROLE_KEYS: Record<Role, 'tank' | 'healer' | 'dps'> = {
  [Role.TANK]: 'tank',
  [Role.HEALER]: 'healer',
  [Role.DPS]: 'dps',
};

interface Props {
  players: Player[];
  builds: PlayerBuild[];
  canEdit: boolean;
}

/**
 * Where the line-up is arranged: two sides, three lanes, ten to a lane.
 *
 * Attack and defence are kept apart because the same member is rarely wanted in
 * both, and a strategy is only ever advice -- it says what a lane should look
 * like, and the board says what it does, but nothing is stopped from differing.
 * A leader short of people needs to see the gap, not be blocked by it.
 */
const WarBoard: React.FC<Props> = ({ players, builds, canEdit }) => {
  const [side, setSide] = useState<WarSide>('attack');
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [strategies, setStrategies] = useState<WarStrategy[]>([]);
  const [chosen, setChosen] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'' | Role>('');
  const [markFilter, setMarkFilter] = useState<'' | WarSide | 'none'>('');

  const load = async () => {
    setDeployments(await api<Deployment[]>('/war/deployments').catch(() => []));
    setStrategies(await api<WarStrategy[]>('/war/strategies').catch(() => []));
  };

  useEffect(() => {
    void load();
  }, []);

  // A member's roles come from their primary build when they have one, since
  // that is what describes how they actually play.
  const rolesOf = useMemo(() => {
    const primary = new Map<string, PlayerBuild>();
    for (const b of builds) if (b.isPrimary || !primary.has(b.playerId)) primary.set(b.playerId, b);
    return (player: Player): Role[] => {
      const build = primary.get(player.id);
      return build?.roles?.length ? build.roles : [player.role];
    };
  }, [builds]);

  const active = players.filter((p) => p.isActive !== false);
  const here = deployments.filter((d) => d.side === side);
  const byId = new Map(players.map((p) => [p.id, p]));

  const inLane = (lane: WarLane) =>
    here.filter((d) => d.lane === lane).map((d) => byId.get(d.playerId)).filter(Boolean) as Player[];

  const placed = new Set(here.map((d) => d.playerId));
  // Where somebody stands on the other board: nobody fights both halves, so
  // this is what makes them unavailable here.
  const elsewhere = new Map<string, WarSide>(
    deployments.filter((d) => d.side !== side).map((d) => [d.playerId, d.side] as const),
  );

  /**
   * How high somebody sits in the list of who is left to field.
   *
   * Reading downwards: this side's starters, then the rest of this side, then
   * the other side's starters and the rest of them, then whoever is unmarked.
   * Last of all come those already standing on the other board, who cannot be
   * picked at all -- kept visible so their absence is explained rather than
   * merely noticed.
   */
  const rank = (p: Player) => {
    if (elsewhere.has(p.id)) return -1;
    if (p.warSide === side) return p.isStarter ? 6 : 5;
    if (p.warSide) return p.isStarter ? 4 : 3;
    return p.isStarter ? 2 : 1;
  };

  const needle = search.trim().toLowerCase();
  const bench = active
    .filter((p) => !placed.has(p.id))
    .filter((p) => !needle || p.name.toLowerCase().includes(needle))
    .filter((p) => !roleFilter || rolesOf(p).includes(roleFilter))
    .filter((p) =>
      !markFilter || (markFilter === 'none' ? !p.warSide : p.warSide === markFilter),
    )
    .sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name));

  const strategy = strategies.find((s) => s.id === chosen && s.side === side);

  const move = async (playerId: string, lane: WarLane | null) => {
    setError(null);
    try {
      await api(`/war/deployments/${side}/${playerId}`, {
        method: 'PUT',
        body: JSON.stringify({ lane }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo mover');
    }
  };

  const clear = async () => {
    if (!window.confirm(`¿Vaciar todo el despliegue de ${WAR_SIDE_LABELS[side]}?`)) return;
    await api(`/war/deployments/${side}`, { method: 'DELETE' }).catch(() => undefined);
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
            {(['attack', 'defense'] as WarSide[]).map((s) => (
              <button
                key={s}
                onClick={() => setSide(s)}
                className={`px-5 py-2 rounded-md text-sm font-bold transition-all flex items-center gap-2 ${
                  side === s
                    ? s === 'attack'
                      ? 'bg-red-700 text-white'
                      : 'bg-sky-700 text-white'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <i className={`fa-solid ${s === 'attack' ? 'fa-khanda' : 'fa-shield'}`}></i>
                Despliegue {WAR_SIDE_LABELS[s]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={chosen}
              onChange={(e) => setChosen(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
            >
              <option value="">Sin estrategia de referencia</option>
              {strategies.filter((s) => s.side === side).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <span className="text-sm text-slate-500">
              {here.length} / {LANE_CAPACITY * WAR_LANES.length} desplegados
            </span>
            {canEdit && here.length > 0 && (
              <button onClick={clear} className="text-xs text-slate-500 hover:text-red-400 px-2 py-2 transition-all">
                Vaciar
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-3 text-sm rounded-lg px-4 py-2 flex items-center gap-3 border bg-red-950/60 border-red-900 text-red-200">
            <i className="fa-solid fa-triangle-exclamation"></i>
            {error}
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-4 gap-4">
        {WAR_LANES.map((lane) => {
          const members = inLane(lane.id);
          const target = strategy?.composition?.[lane.id];
          const counts = { tank: 0, healer: 0, dps: 0 };
          for (const m of members) for (const r of rolesOf(m)) counts[ROLE_KEYS[r]]++;

          return (
            <section
              key={lane.id}
              className="rounded-xl border p-4"
              style={{ borderColor: `${lane.colour}66`, background: `${lane.colour}0f` }}
            >
              <div className="flex items-center justify-between mb-1">
                <h3 className="cinzel font-bold text-lg" style={{ color: lane.colour }}>
                  {lane.label}
                </h3>
                <span
                  className={`text-sm font-bold tabular-nums ${
                    members.length >= LANE_CAPACITY ? 'text-amber-400' : 'text-slate-400'
                  }`}
                >
                  {members.length}/{LANE_CAPACITY}
                </span>
              </div>

              {/* A strategy states the shape a lane should have; the difference
                  from what it does have is the whole reason to record one. */}
              <div className="flex gap-2 mb-3 text-[10px] uppercase tracking-wider">
                {(['tank', 'healer', 'dps'] as const).map((key) => {
                  const want = target?.[key];
                  const has = counts[key];
                  const short = want !== undefined && has < want;
                  return (
                    <span
                      key={key}
                      className={short ? 'text-amber-400 font-bold' : 'text-slate-500'}
                      title={short ? `Faltan ${want - has}` : undefined}
                    >
                      {key === 'tank' ? 'Tanques' : key === 'healer' ? 'Sanadores' : 'DPS'} {has}
                      {want !== undefined ? `/${want}` : ''}
                    </span>
                  );
                })}
              </div>

              <div className="space-y-1.5 min-h-[60px]">
                {members.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-2 bg-slate-950/70 border border-slate-800 rounded p-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-slate-100 truncate">{p.name}</p>
                      <p className="text-[10px] text-slate-500">
                        {rolesOf(p).map((r) => ROLE_NAMES[r]).join(' · ')}
                      </p>
                    </div>
                    {canEdit && (
                      <button
                        onClick={() => move(p.id, null)}
                        title="Quitar de la línea"
                        className="text-slate-600 hover:text-red-400 shrink-0 transition-all"
                      >
                        <i className="fa-solid fa-xmark"></i>
                      </button>
                    )}
                  </div>
                ))}
                {!members.length && (
                  <p className="text-xs text-slate-600 italic py-3 text-center">Sin nadie asignado</p>
                )}
              </div>
            </section>
          );
        })}

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="cinzel font-bold text-lg text-slate-300">Disponibles</h3>
            <span className="text-sm text-slate-500 tabular-nums">{bench.length}</span>
          </div>

          <div className="space-y-2 mb-3">
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
            <div className="grid grid-cols-2 gap-2">
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
                value={markFilter}
                onChange={(e) => setMarkFilter(e.target.value as '' | WarSide | 'none')}
                className="bg-slate-950 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
              >
                <option value="">Cualquier marca</option>
                <option value="attack">{WAR_SIDE_LABELS.attack}</option>
                <option value="defense">{WAR_SIDE_LABELS.defense}</option>
                <option value="none">Sin asignar</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5 max-h-[520px] overflow-y-auto custom-scrollbar pr-1">
            {bench.map((p) => {
              const busy = elsewhere.get(p.id);
              return (
              <div
                key={p.id}
                className={`bg-slate-950/70 border border-slate-800 rounded p-2 ${busy ? 'opacity-45' : ''}`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  {p.isStarter && (
                    <i className="fa-solid fa-star text-amber-400 text-[10px] shrink-0" title="Titular"></i>
                  )}
                  {p.warSide && (
                    <i
                      className={`fa-solid text-[10px] shrink-0 ${
                        p.warSide === 'attack' ? 'fa-khanda text-red-400' : 'fa-shield text-sky-400'
                      }`}
                      title={WAR_SIDE_LABELS[p.warSide]}
                    ></i>
                  )}
                  <p className="text-sm text-slate-100 truncate">{p.name}</p>
                </div>
                <p className="text-[10px] text-slate-500 mb-1.5">
                  {rolesOf(p).map((r) => ROLE_NAMES[r]).join(' · ')}
                </p>
                {busy ? (
                  <p className="text-[10px] text-slate-500 italic">
                    Ya desplegado en {WAR_SIDE_LABELS[busy]}
                  </p>
                ) : (
                  canEdit && (
                    <div className="flex gap-1">
                      {WAR_LANES.map((lane) => (
                        <button
                          key={lane.id}
                          onClick={() => move(p.id, lane.id)}
                          disabled={inLane(lane.id).length >= LANE_CAPACITY}
                          title={`Enviar a ${lane.label}`}
                          className="flex-1 text-[10px] py-1 rounded border transition-all disabled:opacity-30"
                          style={{ borderColor: `${lane.colour}80`, color: lane.colour }}
                        >
                          {lane.label.replace('Línea ', '')}
                        </button>
                      ))}
                    </div>
                  )
                )}
              </div>
              );
            })}
            {!bench.length && (
              <p className="text-xs text-slate-600 italic py-3 text-center">
                {needle || roleFilter || markFilter ? 'Nadie coincide con el filtro' : 'Todos asignados'}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default WarBoard;
