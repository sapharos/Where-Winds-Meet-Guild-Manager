import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/authService';
import {
  Deployment,
  LANE_CAPACITY,
  Player,
  PlayerBuild,
  Role,
  SavedLineup,
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
import Sheet from './Sheet';

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
    background: `linear-gradient(90deg, ${from}40 0%, ${from}40 22%, ${to}40 78%, ${to}40 100%), rgb(var(--n-900))`,
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
  // Quién tiene el menú de acciones abierto, en el tablero o en el banquillo.
  const [abierto, setAbierto] = useState<string | null>(null);
  // Formaciones guardadas: la hoja, el nombre en curso y el resultado del
  // último aplicar. El aviso es aparte del error porque no es un fallo: "3 no
  // volvieron y te digo por qué" es información, no una excusa.
  const [formaciones, setFormaciones] = useState<SavedLineup[]>([]);
  const [formacionesAbiertas, setFormacionesAbiertas] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);

  // What the board holds right now, for handlers that fire faster than a render.
  const latest = useRef<Deployment[]>([]);

  const load = async () => {
    const fresh = await api<Deployment[]>('/war/deployments').catch(() => []);
    latest.current = fresh;
    setDeployments(fresh);
    const plans = await api<WarStrategy[]>('/war/strategies').catch(() => []);
    // Strategies written before units existed come back without them.
    setStrategies(plans.map((s) => ({ ...s, units: s.units ?? [] })));
    setFormaciones(await api<SavedLineup[]>('/war/lineups').catch(() => []));
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

  /**
   * Colocar a alguien en una línea, o sacarlo del tablero.
   *
   * Se muestra antes de pedirlo y se deshace si el servidor dice que no. Es la
   * acción más repetida de esta pantalla -- treinta personas por guerra, y a
   * veces varias veces cada una -- y antes esperaba a la respuesta y encima
   * recargaba el tablero entero: despliegues, estrategias y estado, tres
   * peticiones más, para mover una tarjeta de sitio. Sobre una conexión
   * inestable eso son segundos por persona, y en ese hueco no hay forma de
   * saber si el toque llegó.
   *
   * El mismo trato que ya tenía `toggleUnit`, y por la misma razón: quien está
   * ordenando una guerra toca deprisa, y la segunda orden no puede esperar a
   * que vuelva la primera.
   */
  const move = async (playerId: string, lane: WarLane | null) => {
    const before = latest.current;
    const after = [
      ...before.filter((d) => !(d.side === side && d.playerId === playerId)),
      ...(lane ? [{ side, lane, playerId, unitIds: [], buildId: null } as Deployment] : []),
    ];

    setError(null);
    latest.current = after;
    setDeployments(after);

    try {
      await api(`/war/deployments/${side}/${playerId}`, {
        method: 'PUT',
        body: JSON.stringify({ lane }),
      });
    } catch (err) {
      latest.current = before;
      setDeployments(before);
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

  /** Igual que `move`: se pinta al momento y se revierte si falla. Cambia los
   *  colores de la tarjeta, así que esperar se nota más que en otras. */
  const useBuild = async (playerId: string, build: string | null) => {
    const before = latest.current;
    const after = before.map((d) =>
      d.side === side && d.playerId === playerId ? { ...d, buildId: build } : d,
    );

    setError(null);
    latest.current = after;
    setDeployments(after);

    try {
      await api(`/war/deployments/${side}/${playerId}/build`, {
        method: 'PUT',
        body: JSON.stringify({ build }),
      });
    } catch (err) {
      latest.current = before;
      setDeployments(before);
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

  /** Fotografía el tablero de este bando bajo el nombre escrito en la hoja. */
  const guardarFormacion = async () => {
    setError(null);
    try {
      await api('/war/lineups', {
        method: 'POST',
        body: JSON.stringify({ side, name: nombreNuevo }),
      });
      setNombreNuevo('');
      setAviso(`Formación guardada con los ${here.length} de ${WAR_SIDE_LABELS[side]}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la formación');
    }
  };

  /**
   * Vuelve a poner en el tablero una formación guardada.
   *
   * Reemplaza el bando entero, así que se pregunta antes cuando hay gente. El
   * servidor devuelve a quién no pudo readmitir y por qué -- bajas, gente ya
   * desplegada enfrente, cupos -- y eso se enseña, porque un aplicar que calla
   * a los que faltan se lee como que el guardado los perdió.
   */
  const aplicarFormacion = async (lineup: SavedLineup) => {
    if (
      here.length > 0 &&
      !window.confirm(
        `Aplicar «${lineup.name}» reemplaza a los ${here.length} desplegados de ${WAR_SIDE_LABELS[side]}. ¿Seguir?`,
      )
    )
      return;

    setError(null);
    try {
      const out = await api<{ applied: number; omitted: { name: string; reason: string }[] }>(
        `/war/lineups/${lineup.id}/apply`,
        { method: 'POST' },
      );
      setFormacionesAbiertas(false);
      setAviso(
        out.omitted.length
          ? `${out.applied} desplegados. No volvieron ${out.omitted.length}: ${out.omitted
              .map((o) => `${o.name} (${o.reason})`)
              .join(', ')}.`
          : `${out.applied} desplegados, la formación volvió entera.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo aplicar la formación');
    }
  };

  const borrarFormacion = async (lineup: SavedLineup) => {
    if (!window.confirm(`¿Borrar la formación guardada «${lineup.name}»?`)) return;
    setError(null);
    try {
      await api(`/war/lineups/${lineup.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar la formación');
    }
  };

  return (
    <div className="space-y-4">
      {/* Above the two boards, because both halves fight to the same clock. */}
      {war && <WarTimers startedAt={war.startedAt} offset={offset} mayBeWarned={canEdit} />}

      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {/* A 320 px los dos botones sumaban 288 y empujaban la página entera
              fuera de la pantalla. Con flex-1 y min-w-0 se reparten lo que hay
              y el texto se recorta antes que el layout. */}
          <div className="flex w-full sm:w-auto bg-slate-950 p-1 rounded-lg border border-slate-800">
            {(['attack', 'defense'] as WarSide[]).map((s) => (
              <button
                key={s}
                onClick={() => setSide(s)}
                className={`flex-1 sm:flex-none min-w-0 px-3 sm:px-5 py-2 rounded-md text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                  side === s
                    ? s === 'attack'
                      ? 'bg-red-700 text-white'
                      : 'bg-sky-700 text-white'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <i className={`fa-solid shrink-0 ${s === 'attack' ? 'fa-khanda' : 'fa-shield'}`}></i>
                <span className="truncate">
                  {/* "Despliegue" es el contexto de la sección, no el dato: en
                      un teléfono estrecho se cae antes que el bando. */}
                  <span className="hidden xs:inline">Despliegue </span>
                  {WAR_SIDE_LABELS[s]}
                </span>
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
              onClick={() => setFormacionesAbiertas(true)}
              title="Guardar la formación actual y volver a una guardada"
              className="text-sm text-slate-400 hover:text-amber-500 border border-slate-800 hover:border-amber-700 rounded px-3 py-2 transition-all flex items-center gap-2"
            >
              <i className="fa-solid fa-clipboard-list"></i>
              Formaciones
              {formaciones.filter((f) => f.side === side).length > 0 && (
                <span className="text-[11px] text-slate-500 tabular-nums">
                  {formaciones.filter((f) => f.side === side).length}
                </span>
              )}
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
                  className="text-sm font-bold px-4 py-2 rounded border border-slate-700 text-slate-300 hover:text-slate-100 transition-all"
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

        {/* En latón y no en rojo: no es un fallo, es el parte de lo que pasó. */}
        {aviso && (
          <div className="mt-3 text-sm rounded-lg px-4 py-2 flex items-start gap-3 border bg-amber-500/10 border-amber-800/60 text-amber-200">
            <i className="fa-solid fa-circle-info mt-0.5 shrink-0"></i>
            <span className="min-w-0">{aviso}</span>
            <button
              onClick={() => setAviso(null)}
              aria-label="Cerrar el aviso"
              className="tap-suelto ml-auto shrink-0 text-amber-400/70 hover:text-amber-200"
            >
              <i className="fa-solid fa-xmark"></i>
            </button>
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

      {/*
        El índice de las líneas, sólo en el teléfono.

        En un escritorio las tres líneas y el banquillo están uno al lado del
        otro y se ven de una vez. En un teléfono van en columna, y llegar al
        banquillo -- que es de donde se saca a la gente -- costaba 2.625 px de
        desplazamiento desde arriba: las dos mitades del trabajo, colocar y
        elegir a quién, quedaban a tres pantallas la una de la otra.

        No cambia nada de sitio ni de nombre: añade una fila que dice cómo va
        cada línea y salta a ella. La cuenta que lleva es la misma que se ve
        dentro, así que además se lee el estado del bando entero sin bajar.
      */}
      <nav
        aria-label="Ir a una línea"
        className="sm:hidden sticky top-[68px] z-30 -mx-4 px-4 py-2 bg-slate-950/90 backdrop-blur-md border-y border-slate-800"
      >
        <div className="flex gap-1.5">
          {WAR_LANES.map((lane) => {
            const cuantos = inLane(lane.id).length;
            return (
              <button
                key={lane.id}
                onClick={() =>
                  document.getElementById(`linea-${lane.id}`)?.scrollIntoView({ behavior: 'smooth' })
                }
                className="flex-1 min-w-0 min-h-tap rounded-md border flex flex-col items-center justify-center leading-tight"
                style={{ borderColor: `${lane.colour}66`, background: `${lane.colour}12` }}
              >
                <span className="text-[11px] truncate w-full px-1" style={{ color: lane.colour }}>
                  {lane.label.replace('Línea ', '')}
                </span>
                <span
                  className={`text-meta font-bold tabular-nums ${
                    cuantos >= LANE_CAPACITY ? 'text-amber-400' : 'text-slate-300'
                  }`}
                >
                  {cuantos}/{LANE_CAPACITY}
                </span>
              </button>
            );
          })}
          {!shut && (
            <button
              onClick={() => document.getElementById('banquillo')?.scrollIntoView({ behavior: 'smooth' })}
              className="flex-1 min-w-0 min-h-tap rounded-md border border-slate-700 bg-slate-900 flex flex-col items-center justify-center leading-tight"
            >
              <span className="text-[11px] text-slate-400 truncate w-full px-1">Disponibles</span>
              <span className="text-meta font-bold tabular-nums text-slate-300">{bench.length}</span>
            </button>
          )}
        </div>
      </nav>

      {/* grid-cols-1 explícito y no `grid` a secas: sin columnas declaradas la
          única pista se dimensiona por su contenido y puede pasarse del
          contenedor, que es lo que hacía que las líneas midieran 334 px dentro
          de 288. `grid-cols-1` es `minmax(0, 1fr)`, que sí tiene techo. */}
      <div className={`grid grid-cols-1 gap-4 ${shut ? 'lg:grid-cols-3' : 'lg:grid-cols-4'}`}>
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
              id={`linea-${lane.id}`}
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
              // min-w-0, como en la tarjeta de miembro: un hijo de grid no baja
              // de su contenido mínimo salvo que se le diga, y la fila de
              // "Tanques 3/2 Sanadores 1/1 DPS 2/4" lo fijaba en 300 px.
              //
              // scroll-mt: la cabecera va pegada arriba, y sin este margen el
              // salto desde el índice deja el título justo debajo de ella.
              className={`min-w-0 scroll-mt-32 rounded-xl border p-4 transition-all ${
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
              <div className="flex flex-wrap gap-x-2 gap-y-0.5 mb-3 text-[11px] uppercase tracking-wider">
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
                          // Eran dos botones de 16x16 y una equis sin caja, que
                          // el propio código llamaba "para pantallas táctiles".
                          // Ahora es un menú de 44 que abre las mismas acciones
                          // escritas, más las dos que estaban enterradas en la
                          // tarjeta: la build de esta guerra y las unidades.
                          <button
                            onClick={() => setAbierto(p.id)}
                            aria-label={`Acciones de ${p.name}`}
                            aria-haspopup="dialog"
                            className="shrink-0 -mr-1 min-h-tap min-w-tap flex items-center justify-center rounded-md text-slate-400 hover:text-amber-500 transition-colors duration-micro"
                          >
                            <i className="fa-solid fa-ellipsis-vertical"></i>
                          </button>
                        )}
                      </div>

                      {/* La build y las unidades se editan desde el menú: en la
                          tarjeta eran un desplegable de 11 px y unos chips de
                          17 px de alto, dentro de una lista de diez. */}

                      {/* Las unidades que lleva, ya sólo como lectura: pulsarlas
                          era un objetivo de 17 px de alto. Se cambian desde el
                          menú, donde caben con su nombre entero. */}
                      {strategy && strategy.units.length > 0 && held.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {strategy.units
                            .filter((u) => held.includes(u.id))
                            .map((u) => (
                              <span
                                key={u.id}
                                className="text-[11px] px-1.5 py-0.5 rounded border flex items-center gap-1 max-w-full"
                                style={{ borderColor: u.color, color: u.color, backgroundColor: `${u.color}1f` }}
                              >
                                <i className={`fa-solid ${u.icon} text-[10px]`}></i>
                                <span className="truncate">{u.name}</span>
                              </span>
                            ))}
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
        <section id="banquillo" className="scroll-mt-32 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="cinzel font-bold text-lg text-slate-300">Disponibles</h3>
            <span className="text-sm text-slate-500 tabular-nums">{bench.length}</span>
          </div>

          <div className="space-y-2 mb-3">
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
                    // Medían 55x17 px. El nombre de la línea se queda -- es lo
                    // que dice a dónde va -- pero el botón pasa a 44 de alto,
                    // que es lo que hace que se acierte.
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
                          className="flex-1 min-h-tap text-[11px] font-semibold rounded border transition-all disabled:opacity-30"
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

      {/*
        Todo lo que se puede hacer con alguien que ya está en una línea.

        Estaba repartido por la tarjeta en cuatro controles de entre 16 y 17 px
        -- dos letras para mover de línea, una equis para sacarlo, un
        desplegable de 11 px para la build y unos chips para las unidades --
        dentro de una lista de hasta diez tarjetas. Aquí caben con su nombre.
      */}
      {abierto && (() => {
        const p = byId.get(abierto);
        if (!p) return null;
        const suya = here.find((d) => d.playerId === p.id);
        const mine = owned.get(p.id) ?? [];
        const held = unitsOf.get(p.id) ?? [];

        return (
          <Sheet
            title={p.name}
            subtitle={
              suya
                ? `${WAR_LANES.find((l) => l.id === suya.lane)?.label} · ${WAR_SIDE_LABELS[side]}`
                : WAR_SIDE_LABELS[side]
            }
            size="sm"
            onClose={() => setAbierto(null)}
          >
            <div className="flex flex-col gap-1">
              {WAR_LANES.filter((other) => other.id !== suya?.lane).map((other) => {
                const llena = inLane(other.id).length >= LANE_CAPACITY;
                return (
                  <button
                    key={other.id}
                    disabled={llena}
                    onClick={() => {
                      void move(p.id, other.id);
                      setAbierto(null);
                    }}
                    className="min-h-tap flex items-center gap-3 px-3 -mx-1 rounded-md text-left text-slate-200 hover:bg-slate-800/60 disabled:opacity-40 transition-colors duration-micro"
                  >
                    <i className="fa-solid fa-arrow-right w-5 text-center" style={{ color: other.colour }}></i>
                    <span className="flex-1">Mover a {other.label}</span>
                    <span className="text-meta text-slate-500 tabular-nums">
                      {inLane(other.id).length}/{LANE_CAPACITY}
                    </span>
                  </button>
                );
              })}
            </div>

            {mine.length > 1 && (
              <div className="mt-4 pt-3 border-t border-slate-800">
                <label className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">
                  Build en esta guerra
                </label>
                <select
                  value={suya?.buildId ?? ''}
                  onChange={(e) => void useBuild(p.id, e.target.value || null)}
                  className="w-full min-h-tap bg-slate-950 border border-slate-800 rounded px-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
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
              </div>
            )}

            {strategy && strategy.units.length > 0 && (
              <div className="mt-4 pt-3 border-t border-slate-800">
                <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">
                  Unidades tácticas
                </p>
                <div className="flex flex-col gap-1">
                  {strategy.units.map((u) => {
                    const on = held.includes(u.id);
                    return (
                      <button
                        key={u.id}
                        onClick={() => void toggleUnit(p.id, u.id)}
                        className="min-h-tap flex items-center gap-3 px-3 -mx-1 rounded-md text-left text-slate-200 hover:bg-slate-800/60 transition-colors duration-micro"
                      >
                        <i className={`fa-solid ${u.icon} w-5 text-center`} style={{ color: u.color }}></i>
                        <span className="flex-1">{u.name}</span>
                        <i
                          className={`fa-solid ${on ? 'fa-check' : ''}`}
                          style={on ? { color: u.color } : undefined}
                          aria-label={on ? 'asignado' : undefined}
                        ></i>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-4 pt-3 border-t border-slate-800">
              <button
                onClick={() => {
                  void move(p.id, null);
                  setAbierto(null);
                }}
                className="w-full min-h-tap flex items-center gap-3 px-3 -mx-1 rounded-md text-left text-red-400 hover:bg-red-500/10 transition-colors duration-micro"
              >
                <i className="fa-solid fa-xmark w-5 text-center"></i>
                Quitar de la línea
              </button>
            </div>
          </Sheet>
        );
      })()}

      {history && (
        <WarHistory
          canEdit={canEdit}
          weaponSets={weaponSets}
          onClose={() => setHistory(false)}
          onChanged={() => void load()}
        />
      )}

      {formacionesAbiertas && (
        <Sheet
          title={`Formaciones de ${WAR_SIDE_LABELS[side]}`}
          subtitle="El tablero de este bando, fotografiado con nombre para volver a él."
          size="sm"
          onClose={() => setFormacionesAbiertas(false)}
        >
          {arranging && here.length > 0 && (
            <div className="mb-4 pb-4 border-b border-slate-800">
              <label className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1">
                Guardar la formación actual ({here.length} desplegados)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={nombreNuevo}
                  onChange={(e) => setNombreNuevo(e.target.value)}
                  placeholder={`p. ej. Titulares de liga (${WAR_SIDE_LABELS[side]})`}
                  enterKeyHint="done"
                  autoComplete="off"
                  className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded px-3 text-sm outline-none focus:ring-1 focus:ring-amber-500"
                />
                <button
                  onClick={() => void guardarFormacion()}
                  className="shrink-0 bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold px-4 rounded transition-all"
                >
                  <i className="fa-solid fa-floppy-disk mr-1.5"></i>
                  Guardar
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {formaciones
              .filter((f) => f.side === side)
              .map((f) => (
                <div key={f.id} className="rounded-md border border-slate-800 bg-slate-950/40 p-3">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 font-semibold text-slate-100 truncate">
                      {f.name}
                    </span>
                    <span className="shrink-0 text-meta text-slate-500 tabular-nums">
                      {f.members.length} miembros
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Guardada el{' '}
                    {new Date(f.createdAt).toLocaleDateString('es', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </p>
                  {arranging && (
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => void aplicarFormacion(f)}
                        className="flex-1 min-h-tap rounded border border-amber-700 text-amber-400 hover:bg-amber-500/10 text-sm font-semibold transition-all"
                      >
                        <i className="fa-solid fa-rotate-left mr-1.5"></i>
                        Aplicar
                      </button>
                      <button
                        onClick={() => void borrarFormacion(f)}
                        aria-label={`Borrar ${f.name}`}
                        className="shrink-0 min-h-tap min-w-tap rounded border border-slate-800 text-slate-500 hover:text-red-400 transition-all"
                      >
                        <i className="fa-solid fa-trash-can"></i>
                      </button>
                    </div>
                  )}
                </div>
              ))}

            {formaciones.filter((f) => f.side === side).length === 0 && (
              <p className="text-sm text-slate-500">
                {arranging
                  ? here.length > 0
                    ? 'Todavía no hay ninguna guardada para este bando. Ponle nombre arriba y guarda la actual.'
                    : 'Todavía no hay ninguna guardada. Despliega gente en el tablero y podrás guardar la formación.'
                  : 'Todavía no hay ninguna formación guardada para este bando.'}
              </p>
            )}
          </div>
        </Sheet>
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
