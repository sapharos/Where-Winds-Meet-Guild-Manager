import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/authService';
import {
  Deployment,
  LANE_CAPACITY,
  Player,
  PlayerBuild,
  Role,
  WAR_CAPACITY,
  WAR_LANES,
  WAR_MATCH_TYPE_LABELS,
  WAR_SIDE_LABELS,
  WarLane,
  WarMatchType,
  WarOutcome,
  WarSide,
  WarStrategy,
  WeaponSet,
} from '../types';
import { ROLE_ICONS } from '../constants';
import { ROLE_NAMES, buildColours } from './PlayerCard';
import StrategyPlanner from './StrategyPlanner';
import WarTimers from './WarTimers';
import WarHistory from './WarHistory';
import StartWarModal from './StartWarModal';
import FinishWarModal from './FinishWarModal';

const ROLE_KEYS: Record<Role, 'tank' | 'healer' | 'dps'> = {
  [Role.TANK]: 'tank',
  [Role.HEALER]: 'healer',
  [Role.DPS]: 'dps',
};

const ROLE_TEXT: Record<Role, string> = {
  [Role.TANK]: 'text-blue-400',
  [Role.HEALER]: 'text-green-400',
  [Role.DPS]: 'text-red-400',
};

interface WarBoardState {
  active: Record<WarSide, string | null>;
  locked: Record<WarSide, boolean>;
  current: { id: string; name: string; startedAt: string; matchType: WarMatchType } | null;
  now?: string;
}

interface Props {
  players: Player[];
  builds: PlayerBuild[];
  weaponSets: WeaponSet[];
  canEdit: boolean;
}

/**
 * The colours of a build, as a left-to-right wash behind a card.
 *
 * Painted over an opaque base rather than left translucent: a lane has its own
 * colour, and a see-through card sitting on it came out tinted by the lane
 * instead of by the build, which is the one thing the wash is there to say.
 */
const wash = (build: PlayerBuild | undefined, sets: WeaponSet[]) => {
  const { from, to } = buildColours(build, sets);
  // Each colour holds its own end before the blend, as on the roster card: a
  // plain ramp reaches the second weapon only at the last column of pixels.
  return {
    background: `linear-gradient(90deg, ${from}40 0%, ${from}40 22%, ${to}40 78%, ${to}40 100%), #0b1120`,
  };
};

/**
 * Where the line-up is arranged: two sides, three lanes, ten to a lane.
 *
 * Attack and defence are kept apart because the same member is rarely wanted in
 * both, and a strategy is only ever advice -- it says what a lane should look
 * like, and the board says what it does, but nothing is stopped from differing.
 * A leader short of people needs to see the gap, not be blocked by it.
 */
const WarBoard: React.FC<Props> = ({ players, builds, weaponSets, canEdit }) => {
  const [side, setSide] = useState<WarSide>('attack');
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [strategies, setStrategies] = useState<WarStrategy[]>([]);
  const [inForce, setInForce] = useState<Record<WarSide, string | null>>({ attack: null, defense: null });
  const [locked, setLocked] = useState<Record<WarSide, boolean>>({ attack: false, defense: false });
  const [war, setWar] = useState<
    { id: string; name: string; startedAt: string; matchType: WarMatchType } | null
  >(null);
  const [starting, setStarting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  // Who is being dragged, and which lane is under the cursor. The lane is kept
  // so the target can light up: a drop with no feedback beforehand is a guess.
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<WarLane | null>(null);
  // The same id, written the instant the drag begins. The state above exists to
  // redraw the board; this exists to be correct. A drag can raise dragstart and
  // dragenter before React has re-rendered, and a handler reading the state
  // would still see nobody being dragged and quietly do nothing.
  const dragged = useRef<string | null>(null);
  // Server time minus ours, so the war clocks agree between screens.
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'' | Role>('');
  const [markFilter, setMarkFilter] = useState<'' | WarSide | 'none'>('');
  const [planning, setPlanning] = useState(false);
  const [history, setHistory] = useState(false);

  // What the board holds right now, for handlers that fire faster than a render.
  const latest = useRef<Deployment[]>([]);

  const load = async () => {
    const fresh = await api<Deployment[]>('/war/deployments').catch(() => []);
    latest.current = fresh;
    setDeployments(fresh);
    const plans = await api<WarStrategy[]>('/war/strategies').catch(() => []);
    // Strategies written before units existed come back without them.
    setStrategies(plans.map((s) => ({ ...s, units: s.units ?? [] })));
    const board = await api<WarBoardState>('/war/board').catch(() => null);
    if (board) {
      setInForce(board.active);
      setLocked(board.locked);
      setWar(board.current);
      if (board.now) setOffset(Date.parse(board.now) - Date.now());
    }
  };

  // Choosing the plan is a change to the war, not to this browser: it is what
  // makes everyone's tactical units visible, so it is saved for the guild.
  const choose = async (id: string) => {
    const before = inForce;
    setInForce({ ...inForce, [side]: id || null });
    try {
      await api(`/war/active/${side}`, { method: 'PUT', body: JSON.stringify({ strategy: id || null }) });
    } catch (err) {
      setInForce(before);
      setError(err instanceof Error ? err.message : 'No se pudo fijar la estrategia');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const owned = useMemo(() => {
    const map = new Map<string, PlayerBuild[]>();
    for (const b of builds) map.set(b.playerId, [...(map.get(b.playerId) ?? []), b]);
    return map;
  }, [builds]);

  const active = players.filter((p) => p.isActive !== false);
  const here = deployments.filter((d) => d.side === side);
  const byId = new Map(players.map((p) => [p.id, p]));
  const buildIdOf = new Map(here.map((d) => [d.playerId, d.buildId ?? null]));

  /**
   * The build a member is fighting with: the one the plan names for them, or
   * the one they usually play. Everything else follows from it -- the colours
   * on their card, and which roles they count towards.
   */
  const buildOf = (player: Player): PlayerBuild | undefined => {
    const list = owned.get(player.id) ?? [];
    const named = buildIdOf.get(player.id);
    return list.find((b) => b.id === named) ?? list.find((b) => b.isPrimary) ?? list[0];
  };

  const rolesOf = (player: Player): Role[] => {
    const build = buildOf(player);
    return build?.roles?.length ? build.roles : [player.role];
  };

  const inLane = (lane: WarLane) =>
    here.filter((d) => d.lane === lane).map((d) => byId.get(d.playerId)).filter(Boolean) as Player[];

  const placed = new Set(here.map((d) => d.playerId));
  const full = deployments.length >= WAR_CAPACITY;
  // A settled side is read-only: this is the line-up as it will be fielded.
  const shut = locked[side];
  const arranging = canEdit && !shut;
  const unitsOf = new Map<string, string[]>(here.map((d) => [d.playerId, d.unitIds ?? []]));
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

  const strategy = strategies.find((s) => s.id === inForce[side] && s.side === side);

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

  /**
   * Whether this lane will take the person currently being dragged.
   *
   * Refused when the lane is already full, unless they are being dragged within
   * it -- moving somebody inside a lane they already occupy takes no new place.
   */
  const accepts = (lane: WarLane, playerId: string | null) => {
    if (!playerId) return false;
    const here = inLane(lane).some((p) => p.id === playerId);
    if (here) return true;
    if (inLane(lane).length >= LANE_CAPACITY) return false;
    // Somebody coming off the bench needs a place in the war, not just the lane.
    return placed.has(playerId) || !full;
  };

  const drop = (lane: WarLane) => {
    const playerId = dragged.current;
    dragged.current = null;
    setDragging(null);
    setOver(null);
    if (!accepts(lane, playerId) || !playerId) return;
    // Already there: nothing to ask the server for.
    if (inLane(lane).some((p) => p.id === playerId)) return;
    void move(playerId, lane);
  };

  /** Marks a card as the thing being dragged, for cards inside lanes and out. */
  const grip = (playerId: string) =>
    arranging
      ? {
          draggable: true,
          onDragStart: (event: React.DragEvent) => {
            dragged.current = playerId;
            setDragging(playerId);
            event.dataTransfer.effectAllowed = 'move';
            // Some browsers refuse to start a drag with nothing attached.
            event.dataTransfer.setData('text/plain', playerId);
          },
          onDragEnd: () => {
            dragged.current = null;
            setDragging(null);
            setOver(null);
          },
          className: dragging === playerId ? 'opacity-40' : 'cursor-grab',
        }
      : {};

  /**
   * Add somebody to a unit, or take them out of one.
   *
   * Read from the ref and shown at once, because putting a person in two units
   * is two clicks in a row: waiting for the first to come back from the server
   * before the second is read would make the second overwrite the first.
   */
  const toggleUnit = async (playerId: string, unitId: string) => {
    const before = latest.current;
    const held = before.find((d) => d.side === side && d.playerId === playerId)?.unitIds ?? [];
    const next = held.includes(unitId) ? held.filter((id) => id !== unitId) : [...held, unitId];

    const after = before.map((d) =>
      d.side === side && d.playerId === playerId ? { ...d, unitIds: next } : d,
    );
    setError(null);
    // Into the ref as well as the state: React has not re-rendered by the time
    // the next click arrives, and the second unit must build on the first.
    latest.current = after;
    setDeployments(after);

    try {
      await api(`/war/deployments/${side}/${playerId}/units`, {
        method: 'PUT',
        body: JSON.stringify({ units: next }),
      });
    } catch (err) {
      latest.current = before;
      setDeployments(before);
      setError(err instanceof Error ? err.message : 'No se pudo asignar la unidad');
    }
  };

  const useBuild = async (playerId: string, build: string | null) => {
    setError(null);
    try {
      await api(`/war/deployments/${side}/${playerId}/build`, {
        method: 'PUT',
        body: JSON.stringify({ build }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar la build');
    }
  };

  const setLockFor = async (value: boolean) => {
    setError(null);
    try {
      await api(`/war/lock/${side}`, { method: 'PUT', body: JSON.stringify({ locked: value }) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo bloquear la formación');
    }
  };

  const begin = async (name: string, matchType: WarMatchType) => {
    await api('/war/wars', { method: 'POST', body: JSON.stringify({ name, matchType }) });
    setStarting(false);
    setError(null);
    await load();
  };

  const finish = async (outcome: WarOutcome) => {
    if (!war) return;
    await api(`/war/wars/${war.id}/end`, { method: 'POST', body: JSON.stringify({ outcome }) });
    setFinishing(false);
    setError(null);
    await load();
  };

  const clear = async () => {
    if (!window.confirm(`¿Vaciar todo el despliegue de ${WAR_SIDE_LABELS[side]}?`)) return;
    await api(`/war/deployments/${side}`, { method: 'DELETE' }).catch(() => undefined);
    await load();
  };

  return (
    <div className="space-y-4">
      {/* Above the two boards, because both halves fight to the same clock. */}
      {war && <WarTimers startedAt={war.startedAt} offset={offset} mayBeWarned={canEdit} />}

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
              value={inForce[side] ?? ''}
              disabled={!arranging}
              onChange={(e) => choose(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500 disabled:text-slate-500"
            >
              <option value="">Sin estrategia de referencia</option>
              {strategies.filter((s) => s.side === side).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => setHistory(true)}
              title="Guerras libradas, resultados y aportes"
              className="text-sm text-slate-400 hover:text-amber-500 border border-slate-800 hover:border-amber-700 rounded px-3 py-2 transition-all flex items-center gap-2"
            >
              <i className="fa-solid fa-scroll"></i>
              Historial
            </button>
            <button
              onClick={() => setPlanning(true)}
              title="Crear y editar estrategias"
              className="text-sm text-slate-400 hover:text-amber-500 border border-slate-800 hover:border-amber-700 rounded px-3 py-2 transition-all flex items-center gap-2"
            >
              <i className="fa-solid fa-chess"></i>
              Estrategias
            </button>
            {/* The whole war, not this board: filling one side is what leaves
                the other short, and that has to be visible from either. */}
            <span
              className={`text-sm ${full ? 'text-amber-400 font-bold' : 'text-slate-500'}`}
              title={`${here.length} en ${WAR_SIDE_LABELS[side]}, ${deployments.length - here.length} en ${
                WAR_SIDE_LABELS[side === 'attack' ? 'defense' : 'attack']
              }`}
            >
              {full && <i className="fa-solid fa-triangle-exclamation mr-1.5"></i>}
              {deployments.length} / {WAR_CAPACITY} desplegados
              <span className="text-slate-600"> ({here.length} aquí)</span>
            </span>
            {arranging && here.length > 0 && (
              <button onClick={clear} className="text-xs text-slate-500 hover:text-red-400 px-2 py-2 transition-all">
                Vaciar
              </button>
            )}
          </div>
        </div>

        {/* Settling a side says "this is who goes". Both settled is what makes
            starting a war possible, since half a line-up is not a line-up. */}
        {canEdit && (
          <div className="mt-3 pt-3 border-t border-slate-800 flex items-center gap-3 flex-wrap">
            <button
              onClick={() => setLockFor(!shut)}
              disabled={Boolean(war)}
              title={
                war
                  ? 'Hay una guerra en curso'
                  : shut
                    ? 'Volver a abrir esta formación para cambiarla'
                    : 'Dar por cerrada esta formación'
              }
              className={`text-sm font-bold px-4 py-2 rounded border transition-all flex items-center gap-2 disabled:opacity-40 ${
                shut
                  ? 'border-amber-500 text-amber-400 bg-amber-500/10'
                  : 'border-slate-800 text-slate-400 hover:text-amber-500 hover:border-amber-700'
              }`}
            >
              <i className={`fa-solid ${shut ? 'fa-lock' : 'fa-lock-open'}`}></i>
              {shut ? `${WAR_SIDE_LABELS[side]} bloqueado` : `Bloquear ${WAR_SIDE_LABELS[side]}`}
            </button>

            <span className="text-[11px] text-slate-500">
              {(['attack', 'defense'] as WarSide[]).map((s) => (
                <span key={s} className={locked[s] ? 'text-amber-500/80' : ''}>
                  <i className={`fa-solid ${locked[s] ? 'fa-lock' : 'fa-lock-open'} mr-1`}></i>
                  {WAR_SIDE_LABELS[s]}
                  {s === 'attack' ? ' · ' : ''}
                </span>
              ))}
            </span>

            <div className="flex-1" />

            {war ? (
              <>
                <span className="text-sm text-amber-400 font-bold flex items-center gap-2">
                  <i className="fa-solid fa-fire"></i>
                  {war.name}
                  <span className="text-[10px] font-normal uppercase tracking-wider text-amber-500/70 border border-amber-800/60 rounded px-1.5 py-0.5">
                    {WAR_MATCH_TYPE_LABELS[war.matchType]}
                  </span>
                  en curso
                </span>
                <button
                  onClick={() => setFinishing(true)}
                  className="text-sm font-bold px-4 py-2 rounded border border-slate-700 text-slate-300 hover:text-white transition-all"
                >
                  Finalizar guerra
                </button>
              </>
            ) : (
              <button
                onClick={() => setStarting(true)}
                disabled={!locked.attack || !locked.defense}
                title={
                  locked.attack && locked.defense
                    ? 'Congela quién está desplegado y dónde'
                    : 'Bloquea las dos formaciones primero'
                }
                className="bg-red-700 hover:bg-red-600 disabled:bg-slate-800 disabled:text-slate-600 text-white text-sm font-bold py-2 px-5 rounded transition-all flex items-center gap-2"
              >
                <i className="fa-solid fa-flag"></i>
                Iniciar guerra
              </button>
            )}
          </div>
        )}

        {error && (
          <div className="mt-3 text-sm rounded-lg px-4 py-2 flex items-center gap-3 border bg-red-950/60 border-red-900 text-red-200">
            <i className="fa-solid fa-triangle-exclamation"></i>
            {error}
          </div>
        )}
      </div>

      {/* Units cut across the lanes, so they are counted over the whole side
          rather than inside any one of them. */}
      {strategy && strategy.units.length > 0 && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
            <h3 className="cinzel font-bold text-lg text-slate-300">Unidades tácticas</h3>
            <span className="text-[11px] text-slate-500">
              {here.filter((d) => !(d.unitIds?.length)).length} de {here.length} desplegados sin unidad
            </span>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {strategy.units.map((unit) => {
              const members = here
                .filter((d) => d.unitIds?.includes(unit.id))
                .map((d) => byId.get(d.playerId))
                .filter(Boolean) as Player[];

              const counts = { tank: 0, healer: 0, dps: 0 };
              for (const m of members) for (const r of rolesOf(m)) counts[ROLE_KEYS[r]]++;
              const wanted = unit.tank + unit.healer + unit.dps;

              return (
                <section
                  key={unit.id}
                  className="rounded-lg border p-3"
                  style={{ borderColor: `${unit.color}66`, background: `${unit.color}0f` }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <i className={`fa-solid ${unit.icon}`} style={{ color: unit.color }}></i>
                    <h4 className="font-bold text-sm text-slate-100 truncate flex-1">{unit.name}</h4>
                    <span
                      className={`text-xs tabular-nums ${
                        wanted && members.length < wanted ? 'text-amber-400 font-bold' : 'text-slate-500'
                      }`}
                    >
                      {members.length}
                      {wanted ? `/${wanted}` : ''}
                    </span>
                  </div>

                  <div className="flex gap-2 mb-2 text-[10px] uppercase tracking-wider">
                    {(['tank', 'healer', 'dps'] as const).map((key) => {
                      const want = unit[key];
                      const short = want > 0 && counts[key] < want;
                      return (
                        <span key={key} className={short ? 'text-amber-400 font-bold' : 'text-slate-500'}>
                          {key === 'tank' ? 'Tanques' : key === 'healer' ? 'Sanadores' : 'DPS'}{' '}
                          {counts[key]}
                          {want ? `/${want}` : ''}
                        </span>
                      );
                    })}
                  </div>

                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {members.length
                      ? members.map((m) => m.name).join(', ')
                      : <span className="text-slate-600 italic">Sin nadie asignado</span>}
                  </p>
                </section>
              );
            })}
          </div>
        </div>
      )}

      <div className={`grid gap-4 ${shut ? 'lg:grid-cols-3' : 'lg:grid-cols-4'}`}>
        {WAR_LANES.map((lane) => {
          const members = inLane(lane.id);
          const target = strategy?.composition?.[lane.id];
          const counts = { tank: 0, healer: 0, dps: 0 };
          for (const m of members) for (const r of rolesOf(m)) counts[ROLE_KEYS[r]]++;

          const welcome = over === lane.id && accepts(lane.id, dragging);
          const refuses = over === lane.id && !accepts(lane.id, dragging);

          return (
            <section
              key={lane.id}
              onDragOver={(event) => {
                // Without this the browser never fires a drop at all.
                if (dragged.current) event.preventDefault();
              }}
              onDragEnter={() => dragged.current && setOver(lane.id)}
              onDragLeave={(event) => {
                // Ignore crossings between the lane's own children.
                if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                  setOver((current) => (current === lane.id ? null : current));
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                drop(lane.id);
              }}
              className={`rounded-xl border p-4 transition-all ${
                welcome ? 'ring-2 ring-offset-2 ring-offset-slate-950' : ''
              } ${refuses ? 'opacity-60' : ''}`}
              style={{
                borderColor: welcome ? lane.colour : `${lane.colour}66`,
                background: `${lane.colour}${welcome ? '26' : '0f'}`,
                ...(welcome ? ({ '--tw-ring-color': lane.colour } as React.CSSProperties) : null),
              }}
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
                {members.map((p) => {
                  const held = unitsOf.get(p.id) ?? [];
                  const first = strategy?.units.find((u) => held.includes(u.id));
                  const build = buildOf(p);
                  const mine = owned.get(p.id) ?? [];
                  const { className: gripClass, ...gripProps } = grip(p.id);
                  return (
                    <div
                      key={p.id}
                      {...gripProps}
                      className={`border border-slate-800 rounded p-2 transition-opacity ${gripClass ?? ''}`}
                      style={{
                        ...wash(build, weaponSets),
                        ...(first ? { borderColor: `${first.color}66` } : null),
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm text-slate-100 truncate">{p.name}</p>
                          <p className="text-[10px] text-slate-500 flex items-center gap-1.5">
                            {rolesOf(p).map((r) => (
                              <span key={r} className={ROLE_TEXT[r]} title={ROLE_NAMES[r]}>
                                {ROLE_ICONS[r]}
                              </span>
                            ))}
                            <span className="truncate">{build?.name ?? ROLE_NAMES[p.role]}</span>
                          </p>
                        </div>
                        {arranging && (
                          <div className="flex items-center gap-1 shrink-0">
                            {/* The other two lanes, for touch screens and for
                                anyone who would rather click than drag. */}
                            {WAR_LANES.filter((other) => other.id !== lane.id).map((other) => (
                              <button
                                key={other.id}
                                onClick={() => move(p.id, other.id)}
                                disabled={inLane(other.id).length >= LANE_CAPACITY}
                                title={`Mover a ${other.label}`}
                                className="w-4 h-4 rounded-sm border text-[9px] font-bold leading-none flex items-center justify-center transition-all disabled:opacity-25"
                                style={{ borderColor: `${other.colour}80`, color: other.colour }}
                              >
                                {other.label.replace('Línea ', '').charAt(0)}
                              </button>
                            ))}
                            <button
                              onClick={() => move(p.id, null)}
                              title="Quitar de la línea"
                              className="text-slate-600 hover:text-red-400 transition-all ml-0.5"
                            >
                              <i className="fa-solid fa-xmark"></i>
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Which build they should bring. Only worth asking of
                          somebody who has more than one to choose between. */}
                      {arranging && mine.length > 1 && (
                        <select
                          value={buildIdOf.get(p.id) ?? ''}
                          onChange={(e) => useBuild(p.id, e.target.value || null)}
                          title="Build que debe usar en esta guerra"
                          className="mt-1.5 w-full bg-slate-950/80 border border-slate-800 rounded p-1 text-[11px] outline-none focus:ring-1 focus:ring-amber-500"
                        >
                          <option value="">
                            Build principal{mine.find((b) => b.isPrimary)?.name ? ` — ${mine.find((b) => b.isPrimary)!.name}` : ''}
                          </option>
                          {mine.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name || 'Sin nombre'}
                            </option>
                          ))}
                        </select>
                      )}

                      {/* The units are a separate question from the lane, and
                          only worth asking once a strategy names some. Chips
                          rather than a list: somebody can hold several jobs, and
                          arranging thirty people should not mean opening thirty
                          menus. */}
                      {strategy && strategy.units.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {strategy.units
                            .filter((u) => arranging || held.includes(u.id))
                            .map((u) => {
                              const on = held.includes(u.id);
                              return (
                                <button
                                  key={u.id}
                                  disabled={!arranging}
                                  onClick={() => toggleUnit(p.id, u.id)}
                                  title={on ? `Quitar de ${u.name}` : `Añadir a ${u.name}`}
                                  className={`text-[10px] px-1.5 py-0.5 rounded border flex items-center gap-1 max-w-full transition-all ${
                                    on ? '' : 'border-slate-800 text-slate-600 hover:text-slate-300'
                                  }`}
                                  style={
                                    on
                                      ? { borderColor: u.color, color: u.color, backgroundColor: `${u.color}1f` }
                                      : undefined
                                  }
                                >
                                  <i className={`fa-solid ${u.icon} text-[9px]`}></i>
                                  <span className="truncate">{u.name}</span>
                                </button>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  );
                })}
                {!members.length && (
                  <p className="text-xs text-slate-600 italic py-3 text-center">Sin nadie asignado</p>
                )}
              </div>
            </section>
          );
        })}

        {/* Nobody left to field once the side is settled, so the bench goes
            away rather than sitting there offering what cannot be done. */}
        {!shut && (
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
              // Somebody already fighting the other half cannot be dragged in.
              const { className: gripClass, ...gripProps } = busy ? {} : grip(p.id);
              return (
              <div
                key={p.id}
                {...gripProps}
                className={`border border-slate-800 rounded p-2 transition-opacity ${
                  busy ? 'opacity-45' : (gripClass ?? '')
                }`}
                style={wash(buildOf(p), weaponSets)}
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
                <p className="text-[10px] text-slate-500 mb-1.5 flex items-center gap-1.5">
                  {rolesOf(p).map((r) => (
                    <span key={r} className={ROLE_TEXT[r]} title={ROLE_NAMES[r]}>
                      {ROLE_ICONS[r]}
                    </span>
                  ))}
                  <span className="truncate">{buildOf(p)?.name ?? ROLE_NAMES[p.role]}</span>
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
                          disabled={full || inLane(lane.id).length >= LANE_CAPACITY}
                          title={
                            full
                              ? `La guerra ya tiene ${WAR_CAPACITY} desplegados entre ambos bandos`
                              : `Enviar a ${lane.label}`
                          }
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
        )}
      </div>

      {history && (
        <WarHistory
          canEdit={canEdit}
          builds={builds}
          weaponSets={weaponSets}
          onClose={() => setHistory(false)}
          onChanged={() => void load()}
        />
      )}

      {starting && <StartWarModal onClose={() => setStarting(false)} onStart={begin} />}

      {finishing && war && (
        <FinishWarModal
          warName={war.name}
          onClose={() => setFinishing(false)}
          onFinish={finish}
        />
      )}

      {planning && (
        <StrategyPlanner
          side={side}
          canEdit={canEdit}
          onClose={() => setPlanning(false)}
          onSaved={() => void load()}
        />
      )}
    </div>
  );
};

export default WarBoard;
