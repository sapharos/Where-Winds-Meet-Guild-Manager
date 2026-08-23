import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/authService';
import {
  Deployment,
  DiscordSoundboardSound,
  DiscordVoiceChannel,
  LANE_CAPACITY,
  Player,
  PlayerBuild,
  Role,
  SavedLineup,
  TacticalUnit,
  VOICE_SLOT_LABELS,
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
  GuildEvent,
  EventResponse,
} from '../types';
import { ROLE_ICONS } from '../constants';
import { ROLE_NAMES, ArmasDeBuild, buildColour } from './PlayerCard';
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
  /** Puede mandar a la gente a los canales de voz (permiso war.voice). */
  canVoice: boolean;
  /** Las grabaciones de guerra, que viven dentro del acta. Ver docs/VODS.md. */
  canUploadVod: boolean;
  canApproveVod: boolean;
  canPinVod: boolean;
  /** La ficha de quien mira, para saber cuál de las grabaciones es la suya. */
  miPlayerId: string | null;
}

/**
 * La ficha de una persona en el tablero: superficie del tema, y ya está.
 *
 * Era un lavado de los colores de sus armas -- `${from}40` a `${to}40` sobre
 * `--n-900` -- y tenía dos problemas. El de fondo: el color lo elige el usuario
 * y compuesto al 25% no garantiza contraste con el texto de encima en ningún
 * tema, y en claro no se ve nada (DIRECCION_VISUAL.md §2). Y el de forma: era el
 * único sitio donde la ficha decía con qué armas juega esa persona, así que
 * quien no distingue los colores no tenía el dato en ninguna parte.
 *
 * Ahora es la misma pauta que el roster: fondo sólido, el color del arma
 * principal en la barra de la izquierda, y las armas escritas con su chip en la
 * tercera fila. La ficha va sobre una línea que tiene su propio tinte, y una
 * superficie opaca es además lo único que la deja verse igual en las tres.
 */
const FICHA =
  'relative overflow-hidden bg-slate-900 border border-slate-800 rounded p-2 pl-3 transition-opacity';

/**
 * Where the line-up is arranged: two sides, three lanes, ten to a lane.
 *
 * Attack and defence are kept apart because the same member is rarely wanted in
 * both, and a strategy is only ever advice -- it says what a lane should look
 * like, and the board says what it does, but nothing is stopped from differing.
 * A leader short of people needs to see the gap, not be blocked by it.
 */
/**
 * Lo que alguien contestó a la encuesta, en un icono.
 *
 * Tres estados y no dos: quien dijo que no y quien no ha dicho nada no son lo
 * mismo, y confundirlos es desplegar a alguien que ya avisó de que no estaría.
 * El título lo dice escrito -- el icono y el color no pueden ser lo único.
 */
const MarcaConvocatoria: React.FC<{ respuesta?: EventResponse }> = ({ respuesta }) => {
  if (!respuesta) {
    return (
      <i
        className="fa-regular fa-circle text-slate-600 text-[10px] shrink-0"
        title="No ha contestado la encuesta"
      ></i>
    );
  }
  if (respuesta.answer === 'yes') {
    return (
      <i
        className="fa-solid fa-circle-check text-emerald-400 text-[10px] shrink-0"
        title="Confirmado"
      ></i>
    );
  }
  if (respuesta.answer === 'maybe') {
    return (
      <i className="fa-solid fa-circle-question text-staple text-[10px] shrink-0" title="Tal vez" />
    );
  }
  return (
    <i className="fa-solid fa-circle-xmark text-red-400 text-[10px] shrink-0" title="Dijo que no puede" />
  );
};

const WarBoard: React.FC<Props> = ({
  players,
  builds,
  weaponSets,
  canEdit,
  canVoice,
  canUploadVod,
  canApproveVod,
  canPinVod,
  miPlayerId,
}) => {
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
  /** En qué hueco de qué línea caería lo que se está arrastrando. */
  const [insercion, setInsercion] = useState<{ lane: WarLane; index: number } | null>(null);
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
  /**
   * La guerra que viene y lo que contestó cada uno en su encuesta.
   *
   * Armar la formación era a ciegas: el tablero sabe quién puede jugar, no
   * quién dijo que iba a estar. Sin agenda programada esto es null y todo se
   * comporta como antes -- la encuesta ayuda cuando existe, no hace falta para
   * desplegar.
   */
  const [convocatoria, setConvocatoria] = useState<GuildEvent | null>(null);
  const [soloConfirmados, setSoloConfirmados] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [history, setHistory] = useState(false);
  // Quién tiene el menú de acciones abierto, en el tablero o en el banquillo.
  const [abierto, setAbierto] = useState<string | null>(null);
  // El buscador de relevos, sólo mientras se pelea. Aparte del buscador del
  // banquillo porque ese vive detrás de la hoja y no se ve desde aquí.
  const [buscaRelevo, setBuscaRelevo] = useState('');
  const [relevando, setRelevando] = useState(false);
  // Formaciones guardadas: la hoja, el nombre en curso y el resultado del
  // último aplicar. El aviso es aparte del error porque no es un fallo: "3 no
  // volvieron y te digo por qué" es información, no una excusa.
  const [formaciones, setFormaciones] = useState<SavedLineup[]>([]);
  const [formacionesAbiertas, setFormacionesAbiertas] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  // La voz: qué canal tiene cada ranura (decide si el botón existe y qué
  // ofrece el cuerno) y si hay un reparto en marcha (van de uno en uno).
  const [vozCanales, setVozCanales] = useState<Record<string, string>>({});
  const [moviendo, setMoviendo] = useState(false);
  const vozLista = Object.keys(vozCanales).length > 0;
  // Si el bot está configurado. Aparte del mapa de ranuras porque las unidades
  // tácticas traen su canal puesto: se las puede reunir aunque nadie haya
  // rellenado todavía las ranuras de las líneas.
  const [vozBot, setVozBot] = useState(false);
  // Los canales del servidor, sólo para poder nombrar el de cada unidad. El
  // canal se elige en Estrategias, al escribir el plan; aquí se lee.
  const [canalesVoz, setCanalesVoz] = useState<DiscordVoiceChannel[]>([]);
  /** El nombre del canal, o su marca genérica si el bot ya no lo ve. */
  const nombreDeCanal = (id: string) =>
    canalesVoz.find((c) => c.id === id)?.name ?? 'Canal de voz propio';
  // El cuerno manual: la hoja, el panel de sonidos, y la selección en curso.
  const [cuernoAbierto, setCuernoAbierto] = useState(false);
  const [sonidos, setSonidos] = useState<DiscordSoundboardSound[] | null>(null);
  const [sonidoElegido, setSonidoElegido] = useState('');
  const [ranurasCuerno, setRanurasCuerno] = useState<Set<string>>(new Set());
  const [tocando, setTocando] = useState(false);
  // Qué avisos tienen sonido configurado, para ofrecer su disparo manual.
  const [cuernoConfig, setCuernoConfig] = useState<{ jungle: string | null; boss: string | null }>({
    jungle: null,
    boss: null,
  });

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
    setConvocatoria(await api<GuildEvent | null>('/events/next-war').catch(() => null));
    if (canVoice || canEdit) {
      const voz = await api<{ bot: boolean; channels: Record<string, string> }>(
        '/war/voice-channels',
      ).catch(() => null);
      setVozBot(Boolean(voz?.bot));
      if (canVoice) setVozCanales(voz?.bot ? voz.channels : {});
      // La lista entera, sólo para poner nombre al canal de cada unidad: un
      // «Reunir» que no dice adónde lleva es un botón que hay que probar.
      if (canVoice && voz?.bot) {
        setCanalesVoz(await api<DiscordVoiceChannel[]>('/war/voice/channels').catch(() => []));
      }
    }
    if (canVoice) {
      setCuernoConfig(
        await api<{ jungle: string | null; boss: string | null }>('/war/horn').catch(() => ({
          jungle: null,
          boss: null,
        })),
      );
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
  // Con la guerra en marcha el tablero no se rearma, pero sí se declara quién
  // se salió y quién entró en su lugar. Es lo único que se escribe entonces.
  const enGuerra = canEdit && Boolean(war);
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
  /** Qué contestó alguien a la encuesta de la guerra que viene. */
  const respuestaDe = (playerId: string) =>
    convocatoria?.responses?.find((r) => r.playerId === playerId);

  const bench = active
    .filter((p) => !placed.has(p.id))
    .filter((p) => !needle || p.name.toLowerCase().includes(needle))
    .filter((p) => !roleFilter || rolesOf(p).includes(roleFilter))
    .filter((p) =>
      !markFilter || (markFilter === 'none' ? !p.warSide : p.warSide === markFilter),
    )
    .filter((p) => !soloConfirmados || respuestaDe(p.id)?.answer === 'yes')
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
   * Reordenar dentro de una línea.
   *
   * El orden de una línea es la formación: quién entra primero y quién cubre.
   * Se guardaba desde siempre en `position`, pero sólo lo escribía el reparto
   * poniendo a cada uno al final, así que la única manera de cambiarlo era
   * sacar a alguien y volver a meterlo -- y eso lo dejaba otra vez el último.
   *
   * Como `move`: se pinta antes de pedirlo y se deshace si el servidor dice que
   * no. Y se manda la línea entera, que es lo que quien arrastra ya tiene
   * delante; deducirla de un solo movimiento sería reconstruirla dos veces.
   */
  const reordenar = async (lane: WarLane, playerId: string, hasta: number) => {
    const before = latest.current;
    const enLinea = before.filter((d) => d.side === side && d.lane === lane);
    const desde = enLinea.findIndex((d) => d.playerId === playerId);
    if (desde < 0) return;

    const orden = enLinea.map((d) => d.playerId);
    orden.splice(desde, 1);
    // El índice viene contado sobre la lista con el arrastrado dentro, así que
    // al haberlo sacado todo lo que estaba debajo sube un puesto.
    orden.splice(hasta > desde ? hasta - 1 : hasta, 0, playerId);
    if (orden.join() === enLinea.map((d) => d.playerId).join()) return;

    // Se reconstruye respetando el sitio del resto del tablero: las otras
    // líneas y el otro bando no se tocan.
    const reordenada = orden.map((id) => enLinea.find((d) => d.playerId === id) as Deployment);
    const after = [
      ...before.filter((d) => !(d.side === side && d.lane === lane)),
      ...reordenada,
    ];

    setError(null);
    latest.current = after;
    setDeployments(after);

    try {
      await api(`/war/deployments/${side}/${lane}/order`, {
        method: 'PUT',
        body: JSON.stringify({ order: orden }),
      });
    } catch (err) {
      latest.current = before;
      setDeployments(before);
      setError(err instanceof Error ? err.message : 'No se pudo reordenar');
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
            setInsercion(null);
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

  /**
   * Un cambio con la guerra ya empezada.
   *
   * A diferencia de `move`, esto no se pinta antes de tiempo: mover una ficha
   * mientras se arma la formación es reversible de un toque, pero un cambio
   * queda escrito en el acta de la guerra, y enseñarlo hecho antes de saber si
   * se hizo es lo que después no cuadra con el pantallazo final. Media segundo
   * de espera a cambio de que lo que se ve sea lo que quedó registrado.
   *
   * Con `entra` en null es una baja sin relevo: se salió y nadie lo cubrió.
   */
  const sustituir = async (sale: string, entra: string | null) => {
    if (!war) return;
    setError(null);
    setRelevando(true);
    try {
      await api(`/war/wars/${war.id}/substitute`, {
        method: 'POST',
        body: JSON.stringify({ out: sale, in: entra }),
      });
      setAbierto(null);
      setBuscaRelevo('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo hacer el cambio');
    } finally {
      setRelevando(false);
    }
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

  /**
   * Manda a los desplegados a sus canales de voz, según el modo.
   *
   * El resultado se cuenta entero en el aviso: quién se movió y quién no con
   * su porqué. El servidor no puede saber de antemano quién está conectado a
   * voz (Discord no lo cuenta por REST), así que el recuento de después es
   * toda la verdad disponible.
   */
  const moverVoz = async (mode: 'general' | 'sides' | 'lanes' | 'leaders') => {
    setMoviendo(true);
    setError(null);
    try {
      const out = await api<{
        total: number;
        moved: number;
        skipped: { name: string; reason: string }[];
      }>('/war/voice/move', { method: 'POST', body: JSON.stringify({ mode, side }) });
      // El bando por delante: el botón sólo tocó este tablero, y el aviso
      // debe decirlo para que nadie crea que la otra mitad también se movió.
      const bando = WAR_SIDE_LABELS[side];
      setAviso(
        out.total === 0
          ? `No hay nadie desplegado en ${bando} que mover.`
          : out.skipped.length
            ? `${bando}: ${out.moved} de ${out.total} movidos a voz. Quedaron ${out.skipped.length}: ${out.skipped
                .map((s) => `${s.name} (${s.reason})`)
                .join(', ')}.`
            : `${bando}: los ${out.moved} desplegados están en su canal.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo mover a nadie');
    } finally {
      setMoviendo(false);
    }
  };

  /**
   * Llama a una unidad a su canal, o la devuelve a las líneas de las que salió.
   *
   * Una unidad no es una línea: sus diez personas pueden venir de las tres, y
   * por eso la vuelta va por el despliegue de cada uno y no por un botón
   * inverso del mismo canal. El aviso nombra la unidad porque hay varias y los
   * dos botones se pulsan seguidos.
   */
  const moverUnidad = async (unit: TacticalUnit, mode: 'gather' | 'return') => {
    setMoviendo(true);
    setError(null);
    try {
      const out = await api<{
        total: number;
        moved: number;
        skipped: { name: string; reason: string }[];
        unit: string;
      }>('/war/voice/unit', { method: 'POST', body: JSON.stringify({ side, unitId: unit.id, mode }) });
      const hecho = mode === 'gather' ? 'reunidos en su canal' : 'devueltos a su línea';
      setAviso(
        out.total === 0
          ? `No hay nadie asignado a «${out.unit}».`
          : out.skipped.length
            ? `«${out.unit}»: ${out.moved} de ${out.total} ${hecho}. Quedaron ${
                out.skipped.length
              }: ${out.skipped.map((s) => `${s.name} (${s.reason})`).join(', ')}.`
            : `«${out.unit}»: los ${out.moved} están ${hecho}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo mover a la unidad');
    } finally {
      setMoviendo(false);
    }
  };

  /** Abre la hoja del cuerno, trayendo el panel de sonidos la primera vez. */
  const abrirCuerno = async () => {
    setCuernoAbierto(true);
    // Preselecciona las líneas configuradas: el caso normal es avisar al frente.
    setRanurasCuerno(
      new Set(
        VOICE_SLOT_LABELS.filter((l) => l.slot.includes(':') && vozCanales[l.slot]).map(
          (l) => l.slot,
        ),
      ),
    );
    if (sonidos === null) {
      setSonidos(await api<DiscordSoundboardSound[]>('/discord/soundboard').catch(() => []));
    }
  };

  /** El recuento de un barrido, con las ranuras por su nombre. */
  const resumenBarrido = (out: {
    played: number;
    results: { channelId: string; ok: boolean; reason?: string }[];
  }) => {
    const nombreDe = (channelId: string) =>
      VOICE_SLOT_LABELS.find((l) => vozCanales[l.slot] === channelId)?.label ?? 'un canal';
    const fallos = out.results.filter((r) => !r.ok);
    return fallos.length
      ? `El sonido llegó a ${out.played} de ${out.results.length} canales. Falló en ${fallos
          .map((f) => `${nombreDe(f.channelId)} (${f.reason ?? 'sin motivo'})`)
          .join(', ')}.`
      : `El sonido recorrió los ${out.played} canales.`;
  };

  /** El barrido: entra a cada canal elegido, suena, y cuenta el resultado. */
  const tocarCuerno = async () => {
    setTocando(true);
    setError(null);
    try {
      const out = await api<{
        played: number;
        results: { channelId: string; ok: boolean; reason?: string }[];
      }>('/war/horn/play', {
        method: 'POST',
        body: JSON.stringify({ soundId: sonidoElegido, slots: [...ranurasCuerno] }),
      });
      setAviso(resumenBarrido(out));
      setCuernoAbierto(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo tocar el cuerno');
    } finally {
      setTocando(false);
    }
  };

  /** El aviso ya configurado de un evento, disparado a mano con un clic. */
  const avisarAhora = async (event: 'jungle' | 'boss') => {
    setTocando(true);
    setError(null);
    try {
      const out = await api<{
        played: number;
        results: { channelId: string; ok: boolean; reason?: string }[];
      }>('/war/horn/warn', { method: 'POST', body: JSON.stringify({ event }) });
      setAviso(
        `Aviso de ${event === 'jungle' ? 'jungla' : 'boss'} lanzado. ${resumenBarrido(out)}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo lanzar el aviso');
    } finally {
      setTocando(false);
    }
  };

  /** Nombrar o destituir al que habla por la línea. El marcador es del bando visible. */
  const toggleLider = async (playerId: string, actual: boolean) => {
    setError(null);
    try {
      await api(`/war/deployments/${side}/${playerId}/leader`, {
        method: 'PUT',
        body: JSON.stringify({ leader: !actual }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el liderazgo');
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
      {war && <WarTimers startedAt={war.startedAt} offset={offset} canCall={canEdit} />}

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
            {/* Sólo existen cuando pueden cumplir: con permiso, bot y canales
                configurados. Un botón de voz que no mueve a nadie es ruido.
                Van en dos menús a conciencia: mover gente es del bando que se
                está mirando, y el cuerno es de la guerra entera -- mezclados,
                el primer uso real acabó moviendo a la defensa desde la
                pantalla de ataque. */}
            {canVoice && vozLista && (
              <details className="relative">
                <summary
                  className="list-none text-sm text-slate-400 hover:text-amber-500 border border-slate-800 hover:border-amber-700 rounded px-3 py-2 transition-all flex items-center gap-2 cursor-pointer"
                  title={`Mover a los desplegados de ${WAR_SIDE_LABELS[side]} entre los canales de voz`}
                >
                  <i className={`fa-solid ${moviendo ? 'fa-circle-notch fa-spin' : 'fa-headset'}`}></i>
                  Voz
                </summary>
                <div className="absolute right-0 mt-2 w-64 bg-slate-900 border border-slate-800 rounded-lg shadow-2xl p-2 z-50 space-y-1">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 px-3 pt-1">
                    Sólo {WAR_SIDE_LABELS[side]}
                  </p>
                  {(
                    [
                      { mode: 'general', icon: 'fa-users', label: 'Reunir en el canal general' },
                      { mode: 'sides', icon: 'fa-people-arrows', label: 'Llevar al canal del bando' },
                      { mode: 'lanes', icon: 'fa-diagram-project', label: 'Repartir a las líneas' },
                      { mode: 'leaders', icon: 'fa-crown', label: 'Reunir líderes en su canal' },
                    ] as const
                  ).map(({ mode, icon, label }) => (
                    <button
                      key={mode}
                      disabled={moviendo}
                      onClick={(e) => {
                        e.currentTarget.closest('details')?.removeAttribute('open');
                        void moverVoz(mode);
                      }}
                      className="w-full min-h-tap text-left text-sm text-slate-300 hover:text-amber-500 hover:bg-slate-950 disabled:text-slate-600 disabled:cursor-not-allowed rounded px-3 py-2 transition-all flex items-center gap-3"
                    >
                      <i className={`fa-solid ${icon} w-4 text-center`}></i>
                      {label}
                    </button>
                  ))}
                  <p className="text-[10px] text-slate-600 px-3 pt-1 leading-relaxed">
                    Mueve a los desplegados de {WAR_SIDE_LABELS[side]} que ya están en un canal de
                    voz y tienen su Discord vinculado; el resultado dice quién quedó fuera y por
                    qué. El otro bando se maneja desde su propia pestaña.
                  </p>
                </div>
              </details>
            )}
            {canVoice && vozLista && (
              <details className="relative">
                <summary
                  className="list-none text-sm text-slate-400 hover:text-amber-500 border border-slate-800 hover:border-amber-700 rounded px-3 py-2 transition-all flex items-center gap-2 cursor-pointer"
                  title="Sonidos del panel en los canales de voz"
                >
                  <i className={`fa-solid ${tocando ? 'fa-circle-notch fa-spin' : 'fa-bullhorn'}`}></i>
                  Cuerno
                </summary>
                <div className="absolute right-0 mt-2 w-64 bg-slate-900 border border-slate-800 rounded-lg shadow-2xl p-2 z-50 space-y-1">
                  <button
                    disabled={moviendo || tocando}
                    onClick={(e) => {
                      e.currentTarget.closest('details')?.removeAttribute('open');
                      void abrirCuerno();
                    }}
                    className="w-full min-h-tap text-left text-sm text-slate-300 hover:text-amber-500 hover:bg-slate-950 disabled:text-slate-600 disabled:cursor-not-allowed rounded px-3 py-2 transition-all flex items-center gap-3"
                  >
                    <i className="fa-solid fa-bullhorn w-4 text-center"></i>
                    Tocar un sonido…
                  </button>
                  {/* Sólo la jungla: es lo único que el reloj canta solo, y
                      esto es adelantarlo cuando el campo no espera al
                      calendario. El boss tiene su propio botón arriba, en los
                      relojes, porque además de sonar avisa a las pantallas. */}
                  {(
                    [{ event: 'jungle', icon: 'fa-leaf', label: 'Avisar jungla ahora' }] as const
                  )
                    .filter(({ event }) => cuernoConfig[event])
                    .map(({ event, icon, label }) => (
                      <button
                        key={event}
                        disabled={moviendo || tocando}
                        onClick={(e) => {
                          e.currentTarget.closest('details')?.removeAttribute('open');
                          void avisarAhora(event);
                        }}
                        className="w-full min-h-tap text-left text-sm text-slate-300 hover:text-amber-500 hover:bg-slate-950 disabled:text-slate-600 disabled:cursor-not-allowed rounded px-3 py-2 transition-all flex items-center gap-3"
                      >
                        <i className={`fa-solid ${icon} w-4 text-center`}></i>
                        {label}
                      </button>
                    ))}
                  <p className="text-[10px] text-slate-600 px-3 pt-1 leading-relaxed">
                    Suena en los canales elegidos en Administración, sin importar qué bando se esté
                    mirando.
                  </p>
                </div>
              </details>
            )}
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

                  {/*
                    La voz de la unidad, al pie de su propia tarjeta.

                    Reunir y devolver son dos botones y no uno que alterna: en
                    mitad de una guerra nadie se acuerda de en qué estado dejó
                    cada unidad, y un botón que cambia de significado solo se
                    pulsa al revés. Devolver no necesita que la unidad tenga
                    canal -- cada uno vuelve a la línea en la que está
                    desplegado --, así que se ofrece aunque no lo tenga: si se
                    reunió a mano, el camino de vuelta sigue estando.
                  */}
                  {canVoice && vozBot && (
                    <div className="mt-3 pt-2 border-t border-slate-800/70 space-y-2">
                      {/* Sólo de lectura: el canal se elige al escribir el plan,
                          en Estrategias, porque es parte de lo que la unidad es
                          y no todas necesitan uno. Aquí se dice cuál es, para
                          que «Reunir» no sea un botón que no dice adónde. */}
                      {unit.voiceChannelId && (
                        <p className="text-[10px] text-slate-500 truncate">
                          <i className="fa-solid fa-headset mr-1.5"></i>
                          {nombreDeCanal(unit.voiceChannelId)}
                        </p>
                      )}

                      <div className="flex gap-1.5">
                          <button
                            disabled={moviendo || !unit.voiceChannelId || !members.length}
                            onClick={() => void moverUnidad(unit, 'gather')}
                            title={
                              !unit.voiceChannelId
                                ? 'Esta unidad no tiene canal de voz asignado'
                                : !members.length
                                  ? 'No hay nadie asignado a esta unidad'
                                  : `Llevar a los ${members.length} de la unidad a su canal`
                            }
                            className="flex-1 min-h-tap text-[11px] rounded border border-slate-700 text-slate-300 hover:text-amber-500 hover:border-amber-700 disabled:text-slate-600 disabled:border-slate-800 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-1.5 px-2"
                          >
                            <i className="fa-solid fa-users-rays"></i>
                            Reunir
                          </button>
                          <button
                            disabled={moviendo || !members.length}
                            onClick={() => void moverUnidad(unit, 'return')}
                            title={
                              members.length
                                ? 'Devolver a cada uno al canal de la línea en la que está desplegado'
                                : 'No hay nadie asignado a esta unidad'
                            }
                            className="flex-1 min-h-tap text-[11px] rounded border border-slate-700 text-slate-300 hover:text-amber-500 hover:border-amber-700 disabled:text-slate-600 disabled:border-slate-800 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-1.5 px-2"
                          >
                            <i className="fa-solid fa-arrow-rotate-left"></i>
                            Devolver
                          </button>
                      </div>
                    </div>
                  )}
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
                  // Y la marca del hueco, que si no se queda dibujada en una
                  // línea de la que el puntero ya salió.
                  setInsercion((current) => (current?.lane === lane.id ? null : current));
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
                {members.map((p, at) => {
                  const held = unitsOf.get(p.id) ?? [];
                  const first = strategy?.units.find((u) => held.includes(u.id));
                  const build = buildOf(p);
                  const { className: gripClass, ...gripProps } = grip(p.id);
                  /**
                   * Dónde caería el que se arrastra si se soltara aquí.
                   *
                   * Por la mitad de la ficha: en la de arriba va delante, en la
                   * de abajo detrás. Sin eso no habría forma de dejar a alguien
                   * el último, porque el último sitio no tiene ficha debajo que
                   * apuntar.
                   */
                  const dondeCae = (event: React.DragEvent) => {
                    const caja = event.currentTarget.getBoundingClientRect();
                    return event.clientY < caja.top + caja.height / 2 ? at : at + 1;
                  };
                  /**
                   * Si lo que se arrastra ya está en esta línea, esto es
                   * reordenar; si viene de fuera, es la línea quien lo recibe.
                   *
                   * Se mira el ref y no el estado: `dragging` se escribe con
                   * `setState` y no está listo hasta el siguiente pintado, así
                   * que el primer `dragover` -- el que decide si la marca
                   * aparece o no -- llegaría con el valor de antes.
                   */
                  const reordenando = () =>
                    Boolean(dragged.current) && members.some((m) => m.id === dragged.current);
                  return (
                    <div
                      key={p.id}
                      {...gripProps}
                      onDragOver={
                        arranging
                          ? (event) => {
                              if (!reordenando()) return; // que lo coja la línea
                              // Se para aquí para que la línea no se quede con
                              // el soltar y lo trate como «mover a esta línea»,
                              // que es lo que hacía perder el sitio.
                              event.preventDefault();
                              event.stopPropagation();
                              setInsercion({ lane: lane.id, index: dondeCae(event) });
                            }
                          : undefined
                      }
                      onDrop={
                        arranging
                          ? (event) => {
                              if (!reordenando()) return;
                              event.preventDefault();
                              event.stopPropagation();
                              const quien = dragged.current;
                              const hasta = dondeCae(event);
                              dragged.current = null;
                              setDragging(null);
                              setOver(null);
                              setInsercion(null);
                              if (quien) void reordenar(lane.id, quien, hasta);
                            }
                          : undefined
                      }
                      className={`${FICHA} ${gripClass ?? ''} ${
                        insercion?.lane === lane.id && insercion.index === at
                          ? 'shadow-[0_-3px_0_0_rgb(var(--a-400))]'
                          : insercion?.lane === lane.id &&
                              insercion.index === at + 1 &&
                              at === members.length - 1
                            ? 'shadow-[0_3px_0_0_rgb(var(--a-400))]'
                            : ''
                      }`}
                      // El color de la unidad, ya sólido y no al 40%: es un
                      // borde de 1 px, y el chip de abajo la nombra igualmente.
                      style={first ? { borderColor: first.color } : undefined}
                    >
                      {/* La barra del arma principal. Recortada por la ficha:
                          mide 4 px y el radio es de 6, así que suelta asomaría
                          por fuera de la esquina redondeada. */}
                      <span
                        aria-hidden
                        className="absolute left-0 top-0 bottom-0 w-1"
                        style={{ backgroundColor: buildColour(build, weaponSets).from }}
                      />

                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm text-slate-100 truncate">
                            {here.find((d) => d.playerId === p.id)?.isLaneLeader && (
                              <i
                                className="fa-solid fa-crown text-amber-400 text-[10px] mr-1.5"
                                title="Líder de línea"
                              ></i>
                            )}
                            {p.name}
                          </p>
                          {/* text-meta y no 10px: el nombre de la build es dato
                              único, y el escalón micro está reservado a
                              etiquetas redundantes (DIRECCION_VISUAL.md §3). */}
                          <p className="text-meta text-slate-500 flex items-center gap-1.5">
                            {rolesOf(p).map((r) => (
                              <span key={r} className={ROLE_TEXT[r]} title={ROLE_NAMES[r]}>
                                {ROLE_ICONS[r]}
                              </span>
                            ))}
                            <span className="truncate">{build?.name ?? ROLE_NAMES[p.role]}</span>
                          </p>
                        </div>
                        {(arranging || enGuerra) && (
                          // Eran dos botones de 16x16 y una equis sin caja, que
                          // el propio código llamaba "para pantallas táctiles".
                          // Ahora es un menú de 44 que abre las mismas acciones
                          // escritas, más las dos que estaban enterradas en la
                          // tarjeta: la build de esta guerra y las unidades.
                          //
                          // Con la guerra en marcha sigue abriendo, aunque la
                          // formación esté bloqueada: lo que ofrece entonces no
                          // es rearmar el tablero sino declarar un cambio, que
                          // es justo lo que hay que poder hacer sin desbloquear.
                          <button
                            onClick={() => {
                              // Un fallo anterior, de otra acción, se vería
                              // dentro de esta hoja como si fuera suyo.
                              setError(null);
                              setAbierto(p.id);
                            }}
                            aria-label={enGuerra ? `Cambiar a ${p.name}` : `Acciones de ${p.name}`}
                            aria-haspopup="dialog"
                            className={`shrink-0 -mr-1 min-h-tap min-w-tap flex items-center justify-center rounded-md transition-colors duration-micro ${
                              enGuerra
                                ? 'text-amber-500/70 hover:text-amber-400'
                                : 'text-slate-400 hover:text-amber-500'
                            }`}
                          >
                            <i
                              className={`fa-solid ${enGuerra ? 'fa-right-left' : 'fa-ellipsis-vertical'}`}
                            ></i>
                          </button>
                        )}
                      </div>

                      {/* La build y las unidades se editan desde el menú: en la
                          tarjeta eran un desplegable de 11 px y unos chips de
                          17 px de alto, dentro de una lista de diez. */}

                      {/* Con qué juega, escrito. Era lo que decía el lavado de
                          color del fondo, y sólo el color. */}
                      <ArmasDeBuild
                        build={build}
                        weaponSets={weaponSets}
                        limite={2}
                        vacio="Sin build"
                        className="mt-1 min-h-[18px]"
                      />

                      {/* Las unidades que lleva, ya sólo como lectura: pulsarlas
                          era un objetivo de 17 px de alto. Se cambian desde el
                          menú, donde caben con su nombre entero.

                          La fila se dibuja para todos cuando hay unidades en
                          juego, no sólo para quien lleva alguna: así las fichas
                          de una línea miden lo mismo, y "sin unidad" es
                          exactamente lo que cuenta la cabecera de arriba. */}
                      {strategy && strategy.units.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1 min-h-[20px]">
                          {held.length > 0 ? (
                            strategy.units
                              .filter((u) => held.includes(u.id))
                              .map((u) => (
                                <span
                                  key={u.id}
                                  // Chip neutro con el icono en color, y no
                                  // texto del color del usuario sobre un tinte
                                  // suyo al 12%: eso no tenía contraste
                                  // garantizado, y el icono ya distingue la
                                  // unidad tanto como el color.
                                  //
                                  // h-5 y no py-0.5: el relleno lo dejaba en 23
                                  // px y "Sin unidad" mide 20, así que la ficha
                                  // de quien llevaba unidad salía tres píxeles
                                  // más alta que la de al lado.
                                  className="h-5 text-[11px] leading-none px-1.5 rounded border border-slate-800 bg-slate-950 text-slate-300 flex items-center gap-1 max-w-full"
                                >
                                  <i
                                    className={`fa-solid ${u.icon} text-[10px] shrink-0`}
                                    style={{ color: u.color }}
                                  ></i>
                                  <span className="truncate">{u.name}</span>
                                </span>
                              ))
                          ) : (
                            <span className="text-[11px] text-slate-600 italic leading-5">
                              Sin unidad
                            </span>
                          )}
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

          {/* Lo que dijo el gremio para esta guerra, encima de la lista de la
              que se saca a la gente. Sin nada programado no aparece nada. */}
          {convocatoria && (
            <button
              onClick={() => setSoloConfirmados(!soloConfirmados)}
              aria-pressed={soloConfirmados}
              className={`w-full mb-3 min-h-tap px-3 rounded-md border text-left transition-colors duration-micro ${
                soloConfirmados ? 'border-emerald-700 bg-emerald-950/40' : 'border-slate-800 bg-slate-950'
              }`}
            >
              <span className="block text-[11px] uppercase tracking-wider text-slate-500 truncate">
                {convocatoria.title}
              </span>
              <span className="block text-meta text-slate-300">
                <span className="text-emerald-400 font-bold tabular-nums">
                  {(convocatoria.responses ?? []).filter((r) => r.answer === 'yes').length}
                </span>{' '}
                confirmados ·{' '}
                <span className="tabular-nums">
                  {(convocatoria.responses ?? []).filter((r) => r.answer === 'maybe').length}
                </span>{' '}
                tal vez ·{' '}
                <span className="tabular-nums">
                  {active.length - (convocatoria.responses ?? []).length}
                </span>{' '}
                sin contestar
              </span>
              <span className="block text-[11px] text-slate-500">
                {soloConfirmados ? 'Enseñando sólo a los que confirmaron' : 'Tocar para ver sólo a los que confirmaron'}
              </span>
            </button>
          )}

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
              const build = buildOf(p);
              // Somebody already fighting the other half cannot be dragged in.
              const { className: gripClass, ...gripProps } = busy ? {} : grip(p.id);
              return (
              <div
                key={p.id}
                {...gripProps}
                className={`${FICHA} ${busy ? 'opacity-45' : (gripClass ?? '')}`}
              >
                <span
                  aria-hidden
                  className="absolute left-0 top-0 bottom-0 w-1"
                  style={{ backgroundColor: buildColour(build, weaponSets).from }}
                />

                <div className="flex items-center gap-1.5 min-w-0">
                  {/* Lo que dijo en la encuesta, delante de todo: es lo primero
                      que hay que saber de alguien a quien se va a desplegar, y
                      va con icono y con título escrito porque el color no puede
                      ser lo único que lo diga. */}
                  {convocatoria && <MarcaConvocatoria respuesta={respuestaDe(p.id)} />}
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
                <p className="text-meta text-slate-500 flex items-center gap-1.5">
                  {rolesOf(p).map((r) => (
                    <span key={r} className={ROLE_TEXT[r]} title={ROLE_NAMES[r]}>
                      {ROLE_ICONS[r]}
                    </span>
                  ))}
                  <span className="truncate">{build?.name ?? ROLE_NAMES[p.role]}</span>
                </p>

                <ArmasDeBuild
                  build={build}
                  weaponSets={weaponSets}
                  limite={2}
                  className="mt-1 min-h-[18px]"
                />

                {/* El pie, de un solo alto: la nota de "ya desplegado" medía un
                    renglón y los botones 44, así que el banquillo salía con
                    dientes según quién estuviera libre. */}
                {(busy || canEdit) && (
                  <div className={`mt-1.5 flex items-center gap-1 ${canEdit ? 'min-h-tap' : ''}`}>
                    {busy ? (
                      <p className="text-meta text-slate-500 italic">
                        Ya desplegado en {WAR_SIDE_LABELS[busy]}
                      </p>
                    ) : (
                      // Medían 55x17 px. El nombre de la línea se queda -- es lo
                      // que dice a dónde va -- pero el botón pasa a 44 de alto,
                      // que es lo que hace que se acierte.
                      WAR_LANES.map((lane) => (
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
                      ))
                    )}
                  </div>
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

        /*
          Con la guerra en marcha la hoja es otra cosa.

          No ofrece mover de línea ni cambiar la build: la formación está
          bloqueada y esas dos son decisiones de antes. Ofrece lo único que
          pasa mientras se pelea -- alguien se cayó -- y lo ofrece en un toque,
          con el banquillo ya desplegado en lugar de detrás de un submenú. Son
          dos toques desde la ficha, que es lo que hay tiempo de hacer con la
          guerra corriendo.
        */
        if (enGuerra) {
          const busca = buscaRelevo.trim().toLowerCase();
          const relevos = active
            .filter((c) => c.id !== p.id && !placed.has(c.id) && !elsewhere.has(c.id))
            .filter((c) => !busca || c.name.toLowerCase().includes(busca))
            .sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name));

          return (
            <Sheet
              title={`Cambiar a ${p.name}`}
              subtitle={
                suya
                  ? `${WAR_LANES.find((l) => l.id === suya.lane)?.label} · ${WAR_SIDE_LABELS[side]} · quien entre hereda su sitio`
                  : `${WAR_SIDE_LABELS[side]} · quien entre hereda su sitio`
              }
              size="sm"
              onClose={() => {
                setAbierto(null);
                setBuscaRelevo('');
              }}
            >
              {/* El aviso vive aquí y no sólo en la barra de arriba: con la
                  hoja abierta, un fallo detrás de ella no lo lee nadie. */}
              {error && (
                <div className="mb-2 text-sm rounded-lg px-4 py-2 flex items-center gap-3 border bg-red-950/60 border-red-900 text-red-200">
                  <i className="fa-solid fa-triangle-exclamation"></i>
                  {error}
                </div>
              )}

              <input
                type="search"
                value={buscaRelevo}
                onChange={(e) => setBuscaRelevo(e.target.value)}
                placeholder="Buscar quién entra…"
                autoComplete="off"
                enterKeyHint="search"
                className="w-full min-h-tap bg-slate-950 border border-slate-800 rounded px-3 text-sm outline-none focus:ring-1 focus:ring-amber-500 mb-2"
              />

              <div className="flex flex-col gap-1 max-h-[45vh] overflow-y-auto">
                {relevos.map((c) => {
                  const build = buildOf(c);
                  return (
                    <button
                      key={c.id}
                      disabled={relevando}
                      onClick={() => void sustituir(p.id, c.id)}
                      className="min-h-tap flex items-center gap-3 px-3 -mx-1 rounded-md text-left text-slate-200 hover:bg-slate-800/60 disabled:opacity-40 transition-colors duration-micro"
                    >
                      <i className="fa-solid fa-arrow-right-to-bracket w-5 text-center text-emerald-500"></i>
                      <span className="flex-1 min-w-0">
                        <span className="block truncate">{c.name}</span>
                        <span className="block text-meta text-slate-500 truncate">
                          {rolesOf(c)
                            .map((r) => ROLE_NAMES[r])
                            .join(' · ')}
                          {build?.name ? ` — ${build.name}` : ''}
                        </span>
                      </span>
                    </button>
                  );
                })}
                {!relevos.length && (
                  <p className="text-xs text-slate-600 italic py-3 text-center">
                    {busca ? 'Nadie coincide' : 'No queda nadie en el banquillo'}
                  </p>
                )}
              </div>

              {/* Una baja sin relevo también hay que poder decirla: se
                  quedaron veintinueve y eso es parte de lo que pasó. */}
              <div className="mt-4 pt-3 border-t border-slate-800">
                <button
                  disabled={relevando}
                  onClick={() => void sustituir(p.id, null)}
                  className="w-full min-h-tap flex items-center gap-3 px-3 -mx-1 rounded-md text-left text-red-400 hover:bg-red-500/10 disabled:opacity-40 transition-colors duration-micro"
                >
                  <i className="fa-solid fa-person-walking-arrow-right w-5 text-center"></i>
                  Se salió y nadie lo cubre
                </button>
              </div>
            </Sheet>
          );
        }

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

            {suya && (
              <div className="mt-4 pt-3 border-t border-slate-800">
                {/* El liderazgo vive aquí y no en la tarjeta: es una decisión
                    de mando, no un ajuste frecuente, y la corona en la tarjeta
                    ya dice quién lo tiene. */}
                <button
                  onClick={() => {
                    void toggleLider(p.id, Boolean(suya.isLaneLeader));
                    setAbierto(null);
                  }}
                  className="w-full min-h-tap flex items-center gap-3 px-3 -mx-1 rounded-md text-left text-slate-200 hover:bg-slate-800/60 transition-colors duration-micro"
                >
                  <i
                    className={`fa-solid fa-crown w-5 text-center ${
                      suya.isLaneLeader ? 'text-slate-500' : 'text-amber-400'
                    }`}
                  ></i>
                  {suya.isLaneLeader ? 'Quitar el liderazgo de línea' : 'Nombrar líder de la línea'}
                </button>
              </div>
            )}

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

      {cuernoAbierto && (
        <Sheet
          title="Cuerno de guerra"
          subtitle="Un sonido del panel del servidor, canal por canal. El bot entra, suena y salta al siguiente: no es simultáneo, tarda un par de segundos por canal."
          size="sm"
          onClose={() => setCuernoAbierto(false)}
        >
          {sonidos === null ? (
            <p className="text-sm text-slate-500 py-4 text-center">
              <i className="fa-solid fa-circle-notch fa-spin mr-2"></i>
              Leyendo el panel de sonidos…
            </p>
          ) : sonidos.length === 0 ? (
            <p className="text-sm text-slate-400">
              El panel de sonidos del servidor está vacío o el bot no puede leerlo. Los sonidos se
              suben desde Discord: Ajustes del servidor → Panel de sonidos.
            </p>
          ) : (
            <>
              <label className="block mb-4">
                <span className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1">
                  Sonido
                </span>
                <select
                  value={sonidoElegido}
                  onChange={(e) => setSonidoElegido(e.target.value)}
                  className="w-full min-h-tap bg-slate-950 border border-slate-800 rounded px-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
                >
                  <option value="">— elige un sonido —</option>
                  {sonidos.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.emoji ? `${s.emoji} ` : ''}
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>

              <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">
                En qué canales
              </p>
              <div className="flex flex-col">
                {VOICE_SLOT_LABELS.filter((l) => vozCanales[l.slot]).map(({ slot, label }) => (
                  <label
                    key={slot}
                    className="min-h-tap flex items-center gap-3 px-3 -mx-1 rounded-md cursor-pointer text-sm text-slate-200 hover:bg-slate-800/60 transition-colors duration-micro"
                  >
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-amber-600"
                      checked={ranurasCuerno.has(slot)}
                      onChange={() =>
                        setRanurasCuerno((prev) => {
                          const next = new Set(prev);
                          if (next.has(slot)) next.delete(slot);
                          else next.add(slot);
                          return next;
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>

              <button
                onClick={() => void tocarCuerno()}
                disabled={tocando || !sonidoElegido || ranurasCuerno.size === 0}
                className="mt-4 w-full bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded transition-all flex items-center justify-center gap-2"
              >
                <i className={`fa-solid ${tocando ? 'fa-circle-notch fa-spin' : 'fa-bullhorn'}`}></i>
                {tocando ? 'Recorriendo canales…' : `Hacerlo sonar en ${ranurasCuerno.size} canales`}
              </button>
            </>
          )}
        </Sheet>
      )}

      {history && (
        <WarHistory
          canEdit={canEdit}
          weaponSets={weaponSets}
          players={players}
          canUploadVod={canUploadVod}
          canApproveVod={canApproveVod}
          canPinVod={canPinVod}
          miPlayerId={miPlayerId}
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
