/**
 * Un servidor de mentira, delante de `fetch`.
 *
 * La alternativa era montar cada componente a mano con props inventadas, y eso
 * mide otra cosa: mide la maqueta que yo escribo, no la aplicación. Poniéndose
 * delante de `fetch` no hay que tocar ni un componente -- arranca `App` entera,
 * con su navegación, sus permisos, sus estados de carga y sus modales, y lo que
 * se ve en pantalla es el producto.
 *
 * Las escrituras cambian el almacén en memoria en vez de devolver "ok" a secas.
 * Un banco donde marcar titular no marca nada sirve para una captura y para
 * nada más; con esto se puede desplegar gente, mover líneas y bloquear una
 * formación, que es lo que hay que poder probar de la Fase 4 en adelante.
 *
 * Sólo lo carga banco.html, que no entra en el build de producción.
 */

import {
  Deployment,
  DiscordMember,
  GuildRank,
  ManagedUser,
  Player,
  PlayerBuild,
  WarCall,
  WarSide,
  WarStrategy,
  WeaponSet,
} from '../types';
import * as fake from './guild';

interface LineupGuardado {
  id: string;
  side: WarSide;
  name: string;
  members: { playerId: string; lane: string; unitIds: string[]; buildId: string | null }[];
  createdAt: string;
}

interface Store {
  players: Player[];
  ranks: GuildRank[];
  builds: PlayerBuild[];
  weaponSets: WeaponSet[];
  deployments: Deployment[];
  strategies: WarStrategy[];
  lineups: LineupGuardado[];
  active: Record<WarSide, string | null>;
  locked: Record<WarSide, boolean>;
  current: ReturnType<typeof fake.board>['current'] | null;
  usuarios: ManagedUser[];
  vods: VodFalso[];
}

/**
 * Las grabaciones inventadas. Ver docs/VODS.md.
 *
 * Los estados están puestos a mano y no al azar: la lista tiene que enseñar a
 * la vez lo que ya se ve, lo que espera revisión, lo que se está preparando y
 * lo que caducó, porque los cuatro se pintan distinto y los cuatro conviven en
 * un acta de verdad.
 */
interface VodFalso {
  id: string;
  warId: string;
  playerId: string;
  estado: string;
  duracionMs: number | null;
  offsetMs: number | null;
  offsetConfianza: string | null;
  fijado: boolean;
  expiraEn: string | null;
  subidoEn: string;
  calidades: { calidad: string; playlist: string }[];
}

/**
 * El servidor de Discord inventado, para probar el vinculador del panel.
 *
 * Los apodos coinciden con nombres del roster falso a propósito: enlazar es
 * reconocer a la misma persona en las dos listas, y eso es lo que hay que
 * poder ensayar. El penúltimo no se parece a nadie, porque también hay que ver
 * qué pasa al elegir a quien no corresponde.
 */
/** Los canales de voz inventados, con nombres como los pondría un gremio. */
const CANALES_VOZ = [
  { id: '200000000000000001', name: 'Guerra · General' },
  { id: '200000000000000002', name: 'Guerra · Ataque' },
  { id: '200000000000000003', name: 'Guerra · Defensa' },
  { id: '200000000000000004', name: 'Ataque · Izquierda' },
  { id: '200000000000000005', name: 'Ataque · Centro' },
  { id: '200000000000000006', name: 'Ataque · Derecha' },
  { id: '200000000000000007', name: 'Defensa · Izquierda' },
  { id: '200000000000000008', name: 'Defensa · Centro' },
  { id: '200000000000000009', name: 'Defensa · Derecha' },
  { id: '200000000000000010', name: 'Taberna' },
  { id: '200000000000000011', name: 'Líderes' },
];

// Preconfigurado, para que la Sala de Guerra enseñe el botón de voz sin pasar
// antes por Administración. Quitar entradas aquí es cómo se prueba el estado
// "canal sin configurar".
let mapaVoz: Record<string, string> = {
  general: '200000000000000001',
  leaders: '200000000000000011',
  attack: '200000000000000002',
  defense: '200000000000000003',
  'attack:left': '200000000000000004',
  'attack:center': '200000000000000005',
  'attack:right': '200000000000000006',
  'defense:left': '200000000000000007',
  'defense:center': '200000000000000008',
  'defense:right': '200000000000000009',
};

/** El panel de sonidos inventado y el cuerno configurado a medias. */
const SONIDOS = [
  { id: '300000000000000001', name: 'Cuerno de guerra', emoji: '📯' },
  { id: '300000000000000002', name: 'Tambor de asalto', emoji: '🥁' },
  { id: '300000000000000003', name: 'Campana del boss', emoji: '🔔' },
];
let cuerno: { jungle: string | null; boss: string | null; slots: string[] } = {
  jungle: '300000000000000001',
  boss: null,
  slots: [],
};

/**
 * El grito del boss, como lo guarda el servidor: uno vivo a la vez y veinte
 * segundos de vida.
 *
 * Va en `localStorage` y no en una variable, que es la única forma de que el
 * banco enseñe la mitad que importa: cantar el boss en una pestaña y verlo
 * llegar a la otra. Cada pestaña carga su propio servidor de mentira, así que
 * una variable de módulo sería una persona hablando sola.
 */
const GRITO = 'zz-banco-grito';

const leerGrito = (): WarCall | null => {
  try {
    const crudo = localStorage.getItem(GRITO);
    if (!crudo) return null;
    const call = JSON.parse(crudo) as WarCall;
    if (Date.now() - Date.parse(call.at) > 20_000) {
      localStorage.removeItem(GRITO);
      return null;
    }
    return call;
  } catch {
    return null;
  }
};

const MIEMBROS_DISCORD: DiscordMember[] = [
  { id: '100000000000000001', username: 'meilin_zz', globalName: 'Mei Lin', nick: 'Mei Lin' },
  { id: '100000000000000002', username: 'weichen88', globalName: 'Wei Chen', nick: 'Wei · Vanguardia' },
  { id: '100000000000000003', username: 'jinwei.zhao', globalName: 'Jinwei', nick: 'Jinwei Zhao' },
  { id: '100000000000000004', username: 'ruolan', globalName: null, nick: null },
  { id: '100000000000000005', username: 'baihu_tiger', globalName: 'Bai Hu', nick: '白虎' },
  { id: '100000000000000006', username: 'forastero', globalName: 'Un Forastero', nick: null },
];

/**
 * Los roles del servidor de Discord, de mentira.
 *
 * En el orden en que Discord los pinta -- de más arriba a más abajo -- porque
 * es el orden en que se guardan y se leen. Uno sin color, que los hay.
 */
const ROLES_DISCORD = [
  { id: '200000000000000001', name: 'Mando', color: '#eab308' },
  { id: '200000000000000002', name: 'Guerra A', color: '#ef4444' },
  { id: '200000000000000003', name: 'Guerra B', color: '#3b82f6' },
  { id: '200000000000000004', name: 'Veterano', color: '#22c55e' },
  { id: '200000000000000005', name: 'Recluta', color: null },
];

/**
 * Los roles que lleva puestos quien mira el banco.
 *
 * Está en «Mando» y en «Guerra A», y no en «Guerra B»: así hay una convocatoria
 * a la que puede contestar y otra a la que no, que son los dos estados que hay
 * que poder mirar.
 */
const MIS_ROLES_DISCORD = ['200000000000000001', '200000000000000002'];

/** A qué roles atiende el bot. Vacío, a todos: el estado de fábrica. */
let rolesDelBot: string[] = [];

const vencimiento = (dias: number) => new Date(Date.now() + dias * 86400000).toISOString();

const store: Store = {
  players: structuredClone(fake.players),
  ranks: structuredClone(fake.ranks),
  builds: structuredClone(fake.builds),
  weaponSets: structuredClone(fake.weaponSets),
  deployments: structuredClone(fake.deployments),
  // Copiadas y no compartidas: asignarle un canal de voz a una unidad guarda
  // la estrategia entera, y el banco tiene que quedarse con el cambio.
  strategies: structuredClone(fake.strategies),
  // Una guardada de fábrica: la foto del ataque inicial, para que la hoja de
  // formaciones tenga algo que enseñar y que aplicar.
  lineups: [
    {
      id: 'lu-1',
      side: 'attack',
      name: 'Titulares de liga',
      members: fake.deployments
        .filter((d) => d.side === 'attack')
        .map((d) => ({
          playerId: d.playerId,
          lane: d.lane,
          unitIds: d.unitIds ?? [],
          buildId: d.buildId ?? null,
        })),
      createdAt: new Date(Date.now() - 4 * 86400000).toISOString(),
    },
  ],
  active: { attack: 'st-1', defense: 'st-2' },
  locked: { attack: false, defense: false },
  current: null,
  // Una guerra del historial con las cuatro situaciones a la vez.
  vods: [
    {
      id: 'vod-1', warId: fake.warRows[0].id, playerId: 'p-3',
      estado: 'aprobado', duracionMs: 2_116_000, offsetMs: -281_000,
      offsetConfianza: 'ocr', fijado: false, expiraEn: vencimiento(62),
      subidoEn: vencimiento(-28),
      calidades: [
        { calidad: 'origen', playlist: 'vod-1/origen.m3u8' },
        { calidad: '360p', playlist: 'vod-1/360p.m3u8' },
      ],
    },
    {
      // Fijada: la que alguien decidió que no se pierda.
      id: 'vod-2', warId: fake.warRows[0].id, playerId: 'p-1',
      estado: 'aprobado', duracionMs: 1_980_000, offsetMs: 1_201_000,
      offsetConfianza: 'manual', fijado: true, expiraEn: null,
      subidoEn: vencimiento(-28),
      calidades: [{ calidad: 'origen', playlist: 'vod-2/origen.m3u8' }],
    },
    {
      // Esperando revisión: es lo que ve un oficial al entrar.
      id: 'vod-3', warId: fake.warRows[0].id, playerId: 'p-7',
      estado: 'listo', duracionMs: 2_100_000, offsetMs: null,
      offsetConfianza: null, fijado: false, expiraEn: vencimiento(89),
      subidoEn: vencimiento(-1),
      calidades: [{ calidad: 'origen', playlist: 'vod-3/origen.m3u8' }],
    },
    {
      // A medio preparar: la lista se refresca sola mientras esto exista.
      id: 'vod-4', warId: fake.warRows[0].id, playerId: 'p-4',
      estado: 'procesando', duracionMs: null, offsetMs: null,
      offsetConfianza: null, fijado: false, expiraEn: vencimiento(90),
      subidoEn: new Date().toISOString(), calidades: [],
    },
    {
      // Caducada: la fila sigue, los bytes no. Sin botón de ver.
      id: 'vod-5', warId: fake.warRows[1]?.id ?? fake.warRows[0].id, playerId: 'p-2',
      estado: 'caducado', duracionMs: 2_040_000, offsetMs: -120_000,
      offsetConfianza: 'nombre', fijado: false, expiraEn: vencimiento(-4),
      subidoEn: vencimiento(-94), calidades: [],
    },
  ],
  usuarios: [
    { ...fake.session.user, disabled: false, createdAt: new Date().toISOString() },
    // Una ya enlazada, para ver la columna con el enlace puesto y poder quitarlo.
    {
      id: 'u-2',
      username: 'weichen88',
      role: 'member',
      playerId: 'p-2',
      disabled: false,
      createdAt: new Date().toISOString(),
      discordId: '100000000000000002',
      discordUsername: 'weichen88',
    },
  ],
};

/**
 * Lo que se le añade a una guerra ya cerrada, encima de lo que trae el gremio
 * inventado: capturas subidas, cambios que nadie apuntó, y cifras corregidas.
 *
 * Sin esto el historial era de sólo lectura en el banco -- `warDetail` se
 * recalcula de los datos de fábrica en cada petición --, y justo la pantalla
 * que se apoya en subir una imagen y leerla no se podía probar entera.
 */
const anexos: Record<
  string,
  {
    images: { id: string; image: string; caption: string | null }[];
    extras: { playerId: string; side: string; lane: string | null; joinedAt: string }[];
    left: Record<string, string>;
    stats: Record<string, Record<string, number>>;
  }
> = {};

const anexoDe = (warId: string) =>
  (anexos[warId] ??= { images: [], extras: [], left: {}, stats: {} });

/** El detalle de fábrica con encima lo que se haya hecho en esta sesión. */
const detalleConAnexos = (warId: string) => {
  const base = fake.warDetail(warId) as Record<string, unknown> | null;
  if (!base) return null;
  const anexo = anexoDe(warId);
  const participants = [
    ...(base.participants as Record<string, unknown>[]),
    ...anexo.extras.map((e) => ({
      ...e,
      name: store.players.find((p) => p.id === e.playerId)?.name ?? e.playerId,
      leftAt: null,
      stats: {},
      weapons: [],
    })),
  ].map((p) => ({
    ...p,
    leftAt: anexo.left[p.playerId as string] ?? (p.leftAt ?? null),
    stats: anexo.stats[p.playerId as string] ?? p.stats ?? {},
  }));
  return { ...base, images: [...(base.images as unknown[]), ...anexo.images], participants };
};

const json = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Un retardo pequeño y constante: sin él nunca se ve un esqueleto de carga. */
const LATENCIA = Number(new URLSearchParams(location.search).get('lat') ?? 180);
const espera = () => new Promise((done) => setTimeout(done, LATENCIA));

// La URL entera va aparte del match: el patrón casa contra el pathname y hay
// rutas (la búsqueda de Discord) que necesitan leer la query string.
type Ruta = (m: RegExpMatchArray, req: Request, body: any, url: URL) => unknown;

/**
 * La agenda inventada.
 *
 * Vive en memoria y con las mismas reglas que el servidor de verdad -- la
 * respuesta es del miembro y machaca la anterior -- porque lo que hay que poder
 * ensayar aquí es justo eso: contestar, cambiar de idea, y ver el recuento
 * moverse. Tres eventos: una guerra con encuesta abierta, otra sin abrir y una
 * quedada, que son los tres estados que se ven distintos en pantalla.
 */
interface RespuestaFalsa {
  playerId: string;
  name: string;
  role: string;
  answer: string;
  note: string | null;
  answeredBy: string | null;
  source: string;
  updatedAt: string;
}

const enDias = (dias: number, hora = 19, minuto = 30) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  d.setHours(hora, minuto, 0, 0);
  return d.toISOString();
};

const eventos: Record<string, unknown>[] = [
  {
    id: 'ev-sabado',
    kind: 'war',
    title: 'Guerra del sábado',
    startsAt: enDias(2),
    minutes: 150,
    notes: 'Nos conectamos a las 7:15 para repartir líneas.',
    allowedRoles: [],
    reminderMode: 'channel',
    reminderEveryDays: null,
    reminderTime: null,
    opensAt: enDias(-3),
    closesAt: enDias(2, 12, 0),
    cancelledAt: null,
    createdBy: 'u-1',
  },
  {
    id: 'ev-domingo',
    kind: 'war',
    title: 'Guerra del domingo',
    startsAt: enDias(3),
    minutes: 150,
    notes: null,
    allowedRoles: ['200000000000000001', '200000000000000002'],
    // Por privado y cada día: el otro camino, para poder mirarlo en el banco.
    reminderMode: 'dm',
    reminderEveryDays: 1,
    reminderTime: '19:00',
    opensAt: enDias(-3),
    closesAt: enDias(2, 12, 0),
    cancelledAt: null,
    createdBy: 'u-1',
  },
  {
    id: 'ev-pve',
    kind: 'pve',
    title: 'Reino del Héroe',
    startsAt: enDias(4, 21, 0),
    minutes: 90,
    notes: null,
    allowedRoles: ['200000000000000003', '200000000000000005'],
    reminderMode: 'none',
    reminderEveryDays: null,
    reminderTime: null,
    opensAt: null,
    closesAt: null,
    cancelledAt: null,
    createdBy: 'u-1',
  },
];

const respuestas: Record<string, RespuestaFalsa[]> = {
  'ev-sabado': [],
  'ev-domingo': [],
  'ev-pve': [],
};

// Unos cuantos ya contestados, para que el recuento no salga en cero y se vea
// cómo queda una lista con gente dentro.
{
  const inicial: [string, string][] = [
    ['An Ning', 'yes'],
    ['Bai Hu', 'yes'],
    ['Bao Zhu', 'yes'],
    ['Cang Ming', 'maybe'],
    ['Chen Xi', 'no'],
    ['Edve', 'yes'],
  ];
  for (const [nombre, answer] of inicial) {
    const p = fake.players.find((x) => x.name === nombre);
    if (!p) continue;
    respuestas['ev-sabado'].push({
      playerId: p.id,
      name: p.name,
      role: p.role,
      answer,
      note: null,
      answeredBy: null,
      source: 'web',
      updatedAt: new Date().toISOString(),
    });
  }
}

/** Dónde publica la agenda. Empieza sin elegir, como un gremio recién montado. */
let canalAgenda: string | null = null;
/** Y el canal propio de cada tipo, para poder mirar las dos configuraciones. */
let canalPorTipo: Record<string, string | null> = {};

/** Las dos series que siembra el servidor de verdad al arrancar. */
const seriesFalsas: Record<string, unknown>[] = [
  {
    id: 'serie-guerra-domingo', kind: 'war', title: 'Guerra del domingo', weekday: 0,
    timeLocal: '19:30', timezone: 'America/Bogota', minutes: 150, notes: null, allowedRoles: [],
    reminderMode: 'channel', reminderEveryDays: null, reminderTime: null,
    opensDaysBefore: 6, opensTime: '00:00', closesDaysBefore: 1, closesTime: '12:00',
    autoPublish: true, active: true,
  },
  {
    id: 'serie-guerra-sabado', kind: 'war', title: 'Guerra del sábado', weekday: 6,
    timeLocal: '19:30', timezone: 'America/Bogota', minutes: 150, notes: null, allowedRoles: [],
    reminderMode: 'dm', reminderEveryDays: 2, reminderTime: '19:00',
    opensDaysBefore: 5, opensTime: '00:00', closesDaysBefore: 0, closesTime: '12:00',
    autoPublish: true, active: true,
  },
];

const cuenta = (id: string, answer: string) =>
  (respuestas[id] ?? []).filter((r) => r.answer === answer).length;

const conRecuento = (e: Record<string, unknown>) => ({
  ...e,
  yes: cuenta(e.id as string, 'yes'),
  maybe: cuenta(e.id as string, 'maybe'),
  no: cuenta(e.id as string, 'no'),
});

const conRespuestas = (id: string) => {
  const e = eventos.find((x) => x.id === id);
  if (!e) return null;
  const abierta = (e.allowedRoles ?? []) as string[];
  return {
    ...e,
    responses: respuestas[id] ?? [],
    mayAnswer: !abierta.length || abierta.some((r) => MIS_ROLES_DISCORD.includes(r)),
    discordLinked: true,
  };
};

const anotar = (id: string, playerId: string, body: Record<string, unknown>, porOtro: string | null) => {
  const p = fake.players.find((x) => x.id === playerId);
  if (!p) return conRespuestas(id);
  // Como el servidor: quien anota por otro queda fuera de la regla, porque
  // apuntar lo que alguien dijo por voz no es votar en su lugar.
  const evento = eventos.find((x) => x.id === id);
  const abierta = (evento?.allowedRoles ?? []) as string[];
  if (!porOtro && abierta.length && !abierta.some((r) => MIS_ROLES_DISCORD.includes(r))) {
    return { error: 'esta convocatoria no está abierta a tus roles de Discord' };
  }
  // En una guerra no hay «tal vez». Como el servidor, por si alguien llega por
  // otro camino que no sean los botones.
  if (evento?.kind === 'war' && body?.answer === 'maybe') {
    return { error: 'esa respuesta no vale en este evento' };
  }
  const lista = (respuestas[id] ??= []);
  const fila: RespuestaFalsa = {
    playerId,
    name: p.name,
    role: p.role,
    answer: String(body?.answer ?? 'yes'),
    note: null,
    answeredBy: porOtro,
    source: porOtro ? 'web' : 'web',
    updatedAt: new Date().toISOString(),
  };
  const at = lista.findIndex((r) => r.playerId === playerId);
  if (at >= 0) lista[at] = fila;
  else lista.push(fila);
  lista.sort((a, b) => a.name.localeCompare(b.name));
  return conRespuestas(id);
};

const GET: [RegExp, Ruta][] = [
  [/^\/auth\/me$/, () => fake.session],
  [/^\/events$/, (_m, _req, _body, url) => {
    const desde = url?.searchParams.get('from');
    const hasta = url?.searchParams.get('to');
    const dentro = (e: Record<string, unknown>) =>
      !desde || !hasta || (String(e.startsAt) >= desde && String(e.startsAt) < hasta);
    return eventos.filter(dentro).map(conRecuento);
  }],
  [/^\/events\/config\/channel$/, () => ({
    bot: true,
    channel: canalAgenda,
    byKind: canalPorTipo,
    channels: [
      { id: '300000000000000001', name: 'anuncios' },
      { id: '300000000000000002', name: 'guerras' },
      { id: '300000000000000003', name: 'general' },
    ],
  })],
  [/^\/events\/series$/, () => seriesFalsas],
  // Lo que viene con mi respuesta, para la sección del perfil.
  [/^\/events\/mine$/, () => {
    const yo = fake.session.user.playerId;
    return eventos
      .filter((e) => !e.cancelledAt || (respuestas[e.id as string] ?? []).some((r) => r.playerId === yo && r.answer === 'yes'))
      .map((e) => {
        const mia = (respuestas[e.id as string] ?? []).find((r) => r.playerId === yo);
        return { ...e, mine: mia ? { answer: mia.answer } : null };
      });
  }],
  // La guerra que viene, para que el banquillo enseñe quién confirmó.
  [/^\/events\/next-war$/, () => {
    const e = eventos.find((x) => x.kind === 'war' && !x.cancelledAt);
    return e ? { ...e, responses: respuestas[e.id as string] ?? [] } : null;
  }],
  [/^\/events\/([^/]+)$/, (m) => conRespuestas(m[1])],
  [/^\/auth\/config$/, () => ({ discord: false })],
  [/^\/state$/, () => ({ players: store.players, sessions: [], ranks: store.ranks })],
  [/^\/builds$/, () => store.builds],
  [/^\/weapon-sets$/, () => store.weaponSets],
  [/^\/war\/deployments$/, () => store.deployments],
  [/^\/war\/strategies$/, () => store.strategies],
  [
    /^\/war\/board$/,
    () => ({
      active: store.active,
      locked: store.locked,
      current: store.current,
      now: new Date().toISOString(),
    }),
  ],
  [/^\/war\/lineups$/, () => store.lineups],
  // Dónde suele jugar cada uno: aquí es sencillamente donde está desplegado,
  // que basta para que el importador llegue con las líneas ya puestas.
  [
    /^\/war\/usual-lanes$/,
    () => store.deployments.map((d) => ({ playerId: d.playerId, side: d.side, lane: d.lane, games: 3 })),
  ],
  [/^\/war\/wars$/, () => fake.warRows],
  [/^\/war\/wars\/([^/]+)$/, (m) => detalleConAnexos(m[1])],
  [/^\/war\/wars\/([^/]+)\/vods$/, (m) => store.vods.filter((v) => v.warId === m[1])],
  [/^\/players\/([^/]+)\/scans$/, (m) => fake.scansOf(m[1])],
  [/^\/players\/([^/]+)\/builds$/, (m) => store.builds.filter((b) => b.playerId === m[1])],
  [/^\/players\/([^/]+)\/wars$/, (m) => fake.warsOf(m[1])],
  // El equipo se deja vacío a conciencia: el estado vacío de GearSheet es lo
  // que se ve al abrir la aplicación por primera vez, y hay que poder mirarlo.
  [/^\/players\/([^/]+)\/gear-sets$/, () => []],
  [/^\/players\/([^/]+)\/gear$/, () => []],
  [/^\/gear\/ceilings$/, () => []],
  [/^\/gear\/labels$/, () => []],
  [/^\/registrations$/, () => []],
  [/^\/users$/, () => store.usuarios],
  [/^\/discord\/status$/, () => ({ bot: true })],
  [/^\/discord\/voice-channels$/, () => CANALES_VOZ],
  [/^\/events\/config\/roles$/, () => ({ bot: true, roles: ROLES_DISCORD })],
  // La puerta del bot. Arranca sin restricción, que es como viene de fábrica:
  // el estado que hay que poder ver antes de marcar nada.
  [/^\/discord\/bot-roles$/, () => ({ bot: true, roles: ROLES_DISCORD, allowed: rolesDelBot })],
  [/^\/discord\/soundboard$/, () => SONIDOS],
  [/^\/war\/voice-channels$/, () => ({ bot: true, channels: mapaVoz })],
  // La misma lista que ve Administración: la Sala de Guerra la necesita para
  // poder colgarle un canal a una unidad táctica.
  [/^\/war\/voice\/channels$/, () => CANALES_VOZ],
  [/^\/war\/horn$/, () => cuerno],
  // El grito vivo, con su caducidad: sin ella el banco repetiría el mismo
  // aviso cada tres segundos hasta recargar la página.
  [/^\/war\/call$/, () => leerGrito()],
  [/^\/discord\/members$/, (_m, _req, _body, url) => {
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    if (!q) return [];
    // Como el de verdad: por el principio del nombre, no por el medio.
    const empieza = (s: string | null) => s !== null && s.toLowerCase().startsWith(q);
    return MIEMBROS_DISCORD.filter(
      (m) => empieza(m.username) || empieza(m.globalName) || empieza(m.nick),
    ).slice(0, 10);
  }],
  [
    /^\/permissions$/,
    () => ({
      roles: ['admin', 'leader', 'subleader', 'officer', 'member'],
      permissions: fake.session.permissions,
      matrix: { leader: fake.session.permissions, member: ['roster.view', 'war.view'] },
    }),
  ],
];

const ESCRITURAS: [string, RegExp, Ruta][] = [
  ['PUT', /^\/events\/([^/]+)\/response$/, (m, _req, body) =>
    anotar(m[1], fake.session.user.playerId ?? '', body ?? {}, null)],
  ['PUT', /^\/events\/([^/]+)\/responses\/([^/]+)$/, (m, _req, body) =>
    anotar(m[1], m[2], body ?? {}, fake.session.user.id)],
  // Reordenar una línea. Se aplica de verdad sobre el almacén, para que el
  // banco distinga «se ve movido» de «quedó movido»: la pantalla lo pinta antes
  // de pedirlo, así que sin esto pareceria funcionar aunque no guardara nada.
  ['PUT', /^\/war\/deployments\/([^/]+)\/([^/]+)\/order$/, (m, _req, body) => {
    const [, side, lane] = m;
    const orden: string[] = Array.isArray(body?.order) ? body.order : [];
    const suyos = store.deployments.filter((d) => d.side === side && d.lane === lane);
    const resto = store.deployments.filter((d) => !(d.side === side && d.lane === lane));
    const puestos = orden
      .map((id) => suyos.find((d) => d.playerId === id))
      .filter(Boolean) as typeof suyos;
    const faltan = suyos.filter((d) => !orden.includes(d.playerId));
    store.deployments = [...resto, ...puestos, ...faltan];
    return { order: [...puestos, ...faltan].map((d) => d.playerId) };
  }],
  // Bloquear y desbloquear un bando. Sin esto el banquillo no se podía ensayar:
  // el gremio inventado llega con los dos frentes cerrados, que es como se ve
  // una guerra ya en curso, y el banquillo sólo existe mientras se arma.
  ['PUT', /^\/war\/lock\/([^/]+)$/, (m, _req, body) => {
    store.locked = { ...store.locked, [m[1] as WarSide]: body?.locked !== false };
    return { locked: store.locked };
  }],
  ['PUT', /^\/events\/series\/?([^/]*)$/, (m, _req, body) => {
    const id = m[1] || `serie-${Date.now()}`;
    const at = seriesFalsas.findIndex((s) => s.id === id);
    const fila = { ...(at >= 0 ? seriesFalsas[at] : seriesFalsas[0]), ...body, id };
    if (at >= 0) seriesFalsas[at] = fila;
    else seriesFalsas.push(fila);
    return fila;
  }],
  ['DELETE', /^\/events\/series\/([^/]+)$/, (m) => {
    const at = seriesFalsas.findIndex((s) => s.id === m[1]);
    if (at >= 0) seriesFalsas.splice(at, 1);
    return { ok: true };
  }],
  ['PUT', /^\/events\/config\/channel$/, (_m, _req, body) => {
    // Con `kind` se toca el de ese tipo; sin él, el general.
    if (body?.kind) canalPorTipo = { ...canalPorTipo, [String(body.kind)]: body?.channel ?? null };
    else canalAgenda = body?.channel ?? null;
    return { channel: canalAgenda, byKind: canalPorTipo };
  }],
  ['POST', /^\/events\/([^/]+)\/publish$/, (m) => {
    const e = eventos.find((x) => x.id === m[1]);
    // El del tipo, con el general de reserva: igual que el servidor.
    const canal = canalPorTipo[String(e?.kind)] || canalAgenda;
    if (!canal) return { error: 'falta elegir el canal de la agenda en Administración' };
    if (e) {
      e.discordChannelId = canal;
      e.discordMessageId = `${Date.now()}`;
      e.discordUrl = `https://discord.com/channels/700000000000000000/${canal}/${e.discordMessageId}`;
    }
    return conRespuestas(m[1]);
  }],
  ['POST', /^\/events\/([^/]+)\/reset$/, (m) => {
    const cuantas = (respuestas[m[1]] ?? []).length;
    respuestas[m[1]] = [];
    return { ...conRespuestas(m[1]), borradas: cuantas };
  }],
  ['POST', /^\/events\/([^/]+)\/cancel$/, (m, _req, body) => {
    const e = eventos.find((x) => x.id === m[1]);
    if (e) e.cancelledAt = body?.cancelled === false ? null : new Date().toISOString();
    return conRespuestas(m[1]);
  }],
  ['POST', /^\/events$/, (_m, _req, body) => {
    const id = `ev-${Date.now()}`;
    eventos.push({ ...body, id, cancelledAt: null, createdBy: fake.session.user.id });
    respuestas[id] = [];
    return conRespuestas(id);
  }],
  ['PUT', /^\/events\/([^/]+)$/, (m, _req, body) => {
    const at = eventos.findIndex((x) => x.id === m[1]);
    if (at >= 0) eventos[at] = { ...eventos[at], ...body, id: m[1] };
    return conRespuestas(m[1]);
  }],
  ['DELETE', /^\/events\/([^/]+)$/, (m) => {
    // Como el servidor: con respuestas puestas hace falta el permiso de
    // reiniciar, que es el mismo que se pide para tirarlas sin borrar el evento.
    const puestas = (respuestas[m[1]] ?? []).length;
    if (puestas && !fake.session.permissions.includes('events.reset')) {
      return {
        error: `este evento ya tiene ${puestas} respuestas; borrarlo pide el permiso de reiniciar encuestas`,
      };
    }
    const at = eventos.findIndex((x) => x.id === m[1]);
    if (at >= 0) eventos.splice(at, 1);
    delete respuestas[m[1]];
    return { ok: true };
  }],
  ['PUT', /^\/discord\/bot-roles$/, (_m, _req, body) => {
    // Como el de verdad: se queda con los ids que parecen de Discord y sin
    // repetidos, así que el banco enseña lo que se guardó y no lo que se envió.
    rolesDelBot = [
      ...new Set(
        (Array.isArray(body?.allowed) ? body.allowed : []).filter((r: unknown) =>
          /^\d{5,25}$/.test(String(r)),
        ),
      ),
    ] as string[];
    return { allowed: rolesDelBot };
  }],
  ['PUT', /^\/war\/voice-channels$/, (_m, _req, body) => {
    mapaVoz = body?.channels ?? {};
    return { channels: mapaVoz };
  }],
  ['PUT', /^\/war\/horn$/, (_m, _req, body) => {
    cuerno = {
      jungle: body?.jungle ?? null,
      boss: body?.boss ?? null,
      slots: Array.isArray(body?.slots) ? body.slots : [],
    };
    return cuerno;
  }],
  // El barrido de mentira: suena en todos menos en uno, para que la interfaz
  // tenga que pintar también el fallo con su motivo.
  ['POST', /^\/war\/horn\/play$/, (_m, _req, body) => {
    const slots: string[] = Array.isArray(body?.slots) ? body.slots : [];
    const ids = [...new Set(slots.map((s) => mapaVoz[s]).filter(Boolean))];
    const results = ids.map((channelId, at) =>
      at === ids.length - 1 && ids.length > 2
        ? { channelId, ok: false, reason: 'no se pudo entrar (¿permiso de Conectar?)' }
        : { channelId, ok: true },
    );
    return { played: results.filter((r) => r.ok).length, results };
  }],
  // El disparo manual del aviso configurado: como el de verdad, exige sonido
  // elegido y recorre todos los canales configurados sin repetir.
  ['POST', /^\/war\/horn\/warn$/, (_m, _req, body) => {
    const event = body?.event as 'jungle' | 'boss';
    if (!cuerno[event]) {
      return { error: 'ese aviso no tiene sonido configurado (Administración → Cuerno automático)' };
    }
    const ranuras = cuerno.slots.length
      ? cuerno.slots.filter((s) => mapaVoz[s])
      : Object.keys(mapaVoz);
    const ids = [...new Set(ranuras.map((s) => mapaVoz[s]))];
    const results = ids.map((channelId) => ({ channelId, ok: true }));
    return { played: results.length, results };
  }],
  // El grito del boss. Como el de verdad: se guarda, y el cuerno (que aquí no
  // existe) iría por detrás sin hacerlo esperar.
  ['POST', /^\/war\/call$/, (_m, _req, body) => {
    const call: WarCall = {
      id: `grito-${Date.now()}`,
      type: 'boss',
      spot: body?.spot === 'lower' ? 'lower' : 'upper',
      by: fake.session.user.username ?? null,
      at: new Date().toISOString(),
    };
    try {
      localStorage.setItem(GRITO, JSON.stringify(call));
    } catch {
      // Sin almacén el grito sigue valiendo para la pestaña que lo canta.
    }
    return { call, horn: cuerno.boss ? 'sweeping' : 'off' };
  }],
  // El reparto de mentira: mueve a los que tienen "Discord" (los vinculados en
  // usuarios) y deja fuera al resto con su motivo, que es la parte de la
  // respuesta que la interfaz tiene que saber pintar.
  ['PUT', /^\/war\/deployments\/([^/]+)\/([^/]+)\/leader$/, (m, _req, body) => {
    store.deployments = store.deployments.map((d) =>
      d.side === m[1] && d.playerId === m[2] ? { ...d, isLaneLeader: Boolean(body?.leader) } : d,
    );
    return { leader: Boolean(body?.leader) };
  }],
  ['PUT', /^\/war\/strategies$/, (_m, _req, body) => {
    const strategy = body?.strategy as WarStrategy | undefined;
    if (!strategy) return { error: 'falta la estrategia' };
    const at = store.strategies.findIndex((s) => s.id === strategy.id);
    if (at >= 0) store.strategies[at] = strategy;
    else store.strategies.push({ ...strategy, id: strategy.id || `st-${Date.now()}` });
    return { id: strategy.id, units: strategy.units };
  }],
  // Reunir una unidad y devolverla. Como el de verdad: sólo se mueve a los
  // vinculados, y la vuelta va por la línea de cada uno, así que una ranura
  // sin canal en `mapaVoz` deja fuera a los de esa línea con su motivo.
  ['POST', /^\/war\/voice\/unit$/, (_m, _req, body) => {
    const unit = store.strategies
      .flatMap((s) => (s.side === body?.side ? s.units : []))
      .find((u) => u.id === body?.unitId);
    if (!unit) return { error: 'esa unidad no está en el plan en vigor' };
    if (body?.mode === 'gather' && !unit.voiceChannelId) {
      return { error: 'esa unidad no tiene canal de voz asignado' };
    }
    const conDiscord = new Set(
      store.usuarios.filter((u) => u.discordId && u.playerId).map((u) => u.playerId),
    );
    const nombres = new Map(store.players.map((p) => [p.id, p.name]));
    const suyos = store.deployments.filter(
      (d) => d.side === body?.side && d.unitIds?.includes(unit.id),
    );
    let moved = 0;
    const skipped: { name: string; reason: string }[] = [];
    for (const d of suyos) {
      const name = nombres.get(d.playerId) ?? d.playerId;
      const destino = body?.mode === 'gather' ? unit.voiceChannelId : mapaVoz[`${d.side}:${d.lane}`];
      if (!destino) skipped.push({ name, reason: 'canal sin configurar' });
      else if (!conDiscord.has(d.playerId)) skipped.push({ name, reason: 'sin Discord vinculado' });
      else moved++;
    }
    return { total: suyos.length, moved, skipped, unit: unit.name };
  }],
  ['POST', /^\/war\/voice\/move$/, (_m, _req, body) => {
    const conDiscord = new Set(
      store.usuarios.filter((u) => u.discordId && u.playerId).map((u) => u.playerId),
    );
    const nombres = new Map(store.players.map((p) => [p.id, p.name]));
    // Como el de verdad: sólo el bando que se está mirando.
    const delBando = store.deployments.filter((d) => d.side === body?.side);
    const objetivo = body?.mode === 'leaders' ? delBando.filter((d) => d.isLaneLeader) : delBando;
    let moved = 0;
    const skipped: { name: string; reason: string }[] = [];
    for (const d of objetivo) {
      const name = nombres.get(d.playerId) ?? d.playerId;
      if (!conDiscord.has(d.playerId)) skipped.push({ name, reason: 'sin Discord vinculado' });
      else if (moved % 5 === 4) skipped.push({ name, reason: 'no está en voz' });
      else moved++;
    }
    return { total: objetivo.length, moved, skipped };
  }],
  // El escaneo, lo justo para ensayar la pantalla de revisión: empareja por
  // nombre exacto contra el roster y confirma reactivando a quien estaba de
  // baja, como hace el servidor de verdad.
  ['POST', /^\/scans\/preview$/, (_m, _req, body) => {
    const entries = ((body?.entries ?? []) as { nameAsRead?: string; fields?: unknown; uid?: string }[]).map(
      (e) => {
        const p = store.players.find(
          (pl) => pl.name.toLowerCase() === String(e.nameAsRead ?? '').toLowerCase(),
        );
        return {
          nameAsRead: e.nameAsRead ?? '',
          fields: e.fields ?? {},
          uid: e.uid ?? null,
          match: p ? 'exact' : 'none',
          playerId: p?.id ?? null,
          playerName: p?.name ?? null,
          renamed: false,
          suggestions: [],
        };
      },
    );
    return { entries };
  }],
  ['POST', /^\/scans\/commit$/, (_m, _req, body) => {
    const reactivated: { id: string; name: string }[] = [];
    for (const e of (body?.entries ?? []) as { playerId?: string }[]) {
      const p = e.playerId ? store.players.find((pl) => pl.id === e.playerId) : undefined;
      if (p && p.isActive === false) {
        reactivated.push({ id: p.id, name: p.name });
        store.players = store.players.map((pl) =>
          pl.id === p.id ? { ...pl, isActive: true } : pl,
        );
      }
    }
    return {
      stored: (body?.entries ?? []).length,
      created: [],
      reactivated,
      scannedAt: new Date().toISOString(),
    };
  }],
  ['PATCH', /^\/users\/([^/]+)\/player$/, (m, _req, body) => {
    store.usuarios = store.usuarios.map((u) =>
      u.id === m[1] ? { ...u, playerId: body?.playerId ?? null } : u,
    );
    return { ok: true };
  }],
  ['PATCH', /^\/users\/([^/]+)\/discord$/, (m, _req, body) => {
    store.usuarios = store.usuarios.map((u) =>
      u.id === m[1]
        ? {
            ...u,
            discordId: body?.discordId ?? null,
            discordUsername: body?.discordId ? (body?.discordUsername ?? null) : null,
          }
        : u,
    );
    return { ok: true };
  }],
  ['POST', /^\/users\/discord$/, (_m, _req, body) => {
    const username = String(body?.discordUsername ?? '');
    const nuevo: ManagedUser = {
      id: `u-${store.usuarios.length + 1}`,
      username,
      role: 'member',
      playerId: body?.playerId ?? null,
      disabled: false,
      createdAt: new Date().toISOString(),
      discordId: String(body?.discordId ?? ''),
      discordUsername: username,
    };
    store.usuarios = [...store.usuarios, nuevo];
    return nuevo;
  }],
  ['PATCH', /^\/players\/([^/]+)\/flags$/, (m, _req, body) => {
    store.players = store.players.map((p) => (p.id === m[1] ? { ...p, ...body } : p));
    return { ok: true };
  }],
  ['PUT', /^\/players$/, (_m, _req, body) => {
    store.players = body as Player[];
    return { ok: true };
  }],
  ['PUT', /^\/ranks$/, (_m, _req, body) => {
    store.ranks = body as GuildRank[];
    return { ok: true };
  }],
  ['PUT', /^\/war\/deployments\/([^/]+)\/([^/]+)$/, (m, _req, body) => {
    const [, side, playerId] = m;
    store.deployments = store.deployments.filter(
      (d) => !(d.side === side && d.playerId === playerId),
    );
    if (body?.lane) {
      store.deployments.push({
        side: side as WarSide,
        lane: body.lane,
        playerId,
        unitIds: [],
        buildId: null,
      });
    }
    return { ok: true };
  }],
  ['PUT', /^\/war\/deployments\/([^/]+)\/([^/]+)\/units$/, (m, _req, body) => {
    store.deployments = store.deployments.map((d) =>
      d.side === m[1] && d.playerId === m[2] ? { ...d, unitIds: body.units } : d,
    );
    return { ok: true };
  }],
  ['PUT', /^\/war\/deployments\/([^/]+)\/([^/]+)\/build$/, (m, _req, body) => {
    store.deployments = store.deployments.map((d) =>
      d.side === m[1] && d.playerId === m[2] ? { ...d, buildId: body.build } : d,
    );
    return { ok: true };
  }],
  ['DELETE', /^\/war\/deployments\/([^/]+)$/, (m) => {
    store.deployments = store.deployments.filter((d) => d.side !== m[1]);
    return { ok: true };
  }],
  ['POST', /^\/war\/lineups$/, (_m, _req, body) => {
    const side = body?.side as WarSide;
    const members = store.deployments
      .filter((d) => d.side === side)
      .map((d) => ({
        playerId: d.playerId,
        lane: d.lane,
        unitIds: d.unitIds ?? [],
        buildId: d.buildId ?? null,
      }));
    const id = `lu-${store.lineups.length + 1}`;
    store.lineups.push({
      id,
      side,
      name: String(body?.name ?? '').trim() || 'Sin nombre',
      members,
      createdAt: new Date().toISOString(),
    });
    return { id, members: members.length };
  }],
  // El mismo trato honesto que el servidor de verdad: reemplaza el bando y
  // devuelve a quién no pudo readmitir y por qué.
  ['POST', /^\/war\/lineups\/([^/]+)\/apply$/, (m) => {
    const lineup = store.lineups.find((l) => l.id === m[1]);
    if (!lineup) return { error: 'esa formacion no existe' };
    const other: WarSide = lineup.side === 'attack' ? 'defense' : 'attack';
    const enfrente = new Set(
      store.deployments.filter((d) => d.side === other).map((d) => d.playerId),
    );
    const vivos = new Map(store.players.map((p) => [p.id, p]));

    store.deployments = store.deployments.filter((d) => d.side !== lineup.side);
    const omitted: { playerId: string; name: string; reason: string }[] = [];
    let applied = 0;
    for (const member of lineup.members) {
      const who = vivos.get(member.playerId);
      if (!who || who.isActive === false) {
        omitted.push({
          playerId: member.playerId,
          name: who?.name ?? member.playerId,
          reason: 'ya no está en el gremio',
        });
        continue;
      }
      if (enfrente.has(member.playerId)) {
        omitted.push({
          playerId: member.playerId,
          name: who.name,
          reason: `ya desplegado en ${other === 'attack' ? 'Ataque' : 'Defensa'}`,
        });
        continue;
      }
      store.deployments.push({
        side: lineup.side,
        lane: member.lane as Deployment['lane'],
        playerId: member.playerId,
        unitIds: member.unitIds,
        buildId: member.buildId,
      });
      applied++;
    }
    return { side: lineup.side, applied, omitted };
  }],
  ['DELETE', /^\/war\/lineups\/([^/]+)$/, (m) => {
    store.lineups = store.lineups.filter((l) => l.id !== m[1]);
    return { ok: true };
  }],
  ['PUT', /^\/war\/active\/([^/]+)$/, (m, _req, body) => {
    store.active = { ...store.active, [m[1]]: body.strategy };
    return { ok: true };
  }],
  ['PUT', /^\/war\/lock\/([^/]+)$/, (m, _req, body) => {
    store.locked = { ...store.locked, [m[1]]: body.locked };
    return { ok: true };
  }],
  ['POST', /^\/war\/wars$/, (_m, _req, body) => {
    store.current = {
      id: 'w-nueva',
      name: body.name,
      startedAt: new Date().toISOString(),
      matchType: body.matchType,
    };
    return { ok: true };
  }],
  ['POST', /^\/war\/wars\/([^/]+)\/end$/, () => {
    store.current = null;
    return { ok: true };
  }],
  // El cambio. Con la guerra en marcha mueve el tablero: quien sale lo deja y
  // quien entra ocupa su sitio con su línea. Sobre un acta ya cerrada no hay
  // tablero que tocar, así que sólo se anota en el anexo de esa guerra.
  ['POST', /^\/war\/wars\/([^/]+)\/substitute$/, (m, _req, body) => {
    const enCurso = store.current?.id === m[1];
    const sale = enCurso ? store.deployments.find((d) => d.playerId === body.out) : undefined;

    if (enCurso && sale) {
      store.deployments = [
        ...store.deployments.filter((d) => d.playerId !== body.out),
        ...(body.in ? [{ ...sale, playerId: body.in as string }] : []),
      ];
      return { out: body.out, in: body.in ?? null, side: sale.side, lane: sale.lane };
    }

    const anexo = anexoDe(m[1]);
    const acta = (fake.warDetail(m[1])?.participants ?? []) as Record<string, unknown>[];
    const relevado = acta.find((p) => p.playerId === body.out);
    const side = (relevado?.side as string) ?? body.side ?? 'attack';
    const lane = (relevado?.lane as string | null) ?? null;
    if (body.out) anexo.left[body.out as string] = new Date().toISOString();
    if (body.in) {
      anexo.extras.push({
        playerId: body.in as string,
        side,
        lane,
        joinedAt: new Date().toISOString(),
      });
    }
    return { out: body.out ?? null, in: body.in ?? null, side, lane };
  }],
  ['POST', /^\/vods\/([^/]+)\/resolve$/, (m, _req, body) => {
    const vod = store.vods.find((v) => v.id === m[1]);
    if (!vod) return { error: 'no existe' };
    vod.estado = body.aprobado ? 'aprobado' : 'rechazado';
    // Rechazar borra los bytes, así que también aquí: si el banco dejara el
    // botón de ver, estaría enseñando algo que en el servidor ya no existe.
    if (!body.aprobado) vod.calidades = [];
    return { id: vod.id, estado: vod.estado };
  }],
  ['POST', /^\/vods\/([^/]+)\/pin$/, (m, _req, body) => {
    const vod = store.vods.find((v) => v.id === m[1]);
    if (!vod) return { error: 'no existe' };
    vod.fijado = Boolean(body.fijado);
    vod.expiraEn = vod.fijado ? null : vencimiento(90);
    return { id: vod.id, fijado: vod.fijado };
  }],
  ['PUT', /^\/vods\/([^/]+)\/sync$/, (m, _req, body) => {
    const vod = store.vods.find((v) => v.id === m[1]);
    if (!vod) return { error: 'no existe' };
    vod.offsetMs = Number(body.offsetMs);
    vod.offsetConfianza = 'manual';
    return { id: vod.id, offsetMs: vod.offsetMs, offsetConfianza: vod.offsetConfianza };
  }],
  ['POST', /^\/war\/wars\/([^/]+)\/images$/, (m, _req, body) => {
    const anexo = anexoDe(m[1]);
    const id = `img-${anexo.images.length + 1}`;
    anexo.images.push({ id, image: body.image as string, caption: (body.caption as string) ?? null });
    return { id };
  }],
  ['PATCH', /^\/war\/wars\/([^/]+)\/participants\/([^/]+)$/, (m, _req, body) => {
    const anexo = anexoDe(m[1]);
    anexo.stats[m[2]] = { ...(anexo.stats[m[2]] ?? {}), ...((body.stats as Record<string, number>) ?? {}) };
    return { stats: anexo.stats[m[2]] };
  }],
  // Cargar una guerra pasada. Devuelve un identificador porque la pantalla se
  // va derecha a ella; lo demás no se guarda, que para eso está el aviso.
  ['POST', /^\/war\/wars\/import$/, (_m, _req, body) => {
    console.warn(`[banco] guerra cargada sin efecto: ${body?.participants?.length ?? 0} filas`);
    return { id: 'w-1', participants: body?.participants?.length ?? 0 };
  }],
];

/**
 * Arranca el gremio con una guerra ya empezada.
 *
 * La Sala de Guerra en reposo y la Sala de Guerra con los relojes corriendo son
 * dos pantallas distintas, y la segunda es la que importa. `?enpaz` devuelve la
 * primera, para poder mirar también el estado sin guerra.
 */
if (!new URLSearchParams(location.search).has('enpaz')) {
  const arranque = fake.board();
  store.current = arranque.current;
  store.locked = arranque.locked;
}


/**
 * tus de mentira, para que la subida se pueda ver funcionando en el banco.
 *
 * Hace falta tocar dos cosas y no una: la creación de la subida va por `fetch`,
 * pero los trozos van por XHR --que es lo que da progreso-- y ese no pasa por
 * el `fetch` falso. Sin esto, la barra se quedaría a cero contra un servidor
 * que no existe, que es justo lo que no se quiere poder demostrar.
 *
 * La velocidad simulada es fija y generosa: aquí se viene a mirar la barra, el
 * tiempo restante y el botón de detener, no a esperar diez minutos.
 */
const MBPS_FALSOS = 60 * 1024 * 1024;
const subidas = new Map<string, { recibido: number; total: number; meta: Record<string, string> }>();

const leerMetadatos = (cabecera: string | null): Record<string, string> => {
  const salida: Record<string, string> = {};
  for (const par of (cabecera ?? '').split(',')) {
    const [clave, valor] = par.trim().split(' ');
    if (clave && valor) salida[clave] = decodeURIComponent(escape(atob(valor)));
  }
  return salida;
};

function instalarTusFalso(real: typeof window.fetch): void {
  const fetchAnterior = window.fetch;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes('/vods-upload/')) return fetchAnterior(input as RequestInfo, init);

    const metodo = (init?.method ?? 'GET').toUpperCase();
    const cabeceras = new Headers(init?.headers);
    await espera();

    if (metodo === 'POST') {
      const id = `vod-${Math.random().toString(36).slice(2, 8)}`;
      subidas.set(id, {
        recibido: 0,
        total: Number(cabeceras.get('Upload-Length') ?? 0),
        meta: leerMetadatos(cabeceras.get('Upload-Metadata')),
      });
      return new Response(null, { status: 201, headers: { Location: `/vods-upload/${id}` } });
    }

    if (metodo === 'HEAD') {
      const id = url.split('/').filter(Boolean).pop()!;
      const subida = subidas.get(id);
      if (!subida) return new Response(null, { status: 404 });
      return new Response(null, { status: 200, headers: { 'Upload-Offset': String(subida.recibido) } });
    }

    return new Response(null, { status: 405 });
  };

  // El XHR sólo se sustituye para los PATCH de tus; todo lo demás pasa de largo
  // al de verdad, que es lo que hay que hacer cuando se secuestra algo global.
  const XHRReal = window.XMLHttpRequest;
  class XHRFalso extends XHRReal {
    private destino = '';
    private metodo = '';
    private desde = 0;
    private falso = false;

    open(metodo: string, url: string | URL, ...resto: unknown[]): void {
      this.metodo = metodo.toUpperCase();
      this.destino = String(url);
      this.falso = this.metodo === 'PATCH' && this.destino.includes('/vods-upload/');
      if (!this.falso) super.open(metodo, url as string, ...(resto as []));
    }

    setRequestHeader(nombre: string, valor: string): void {
      if (!this.falso) return super.setRequestHeader(nombre, valor);
      if (nombre === 'Upload-Offset') this.desde = Number(valor);
    }

    send(cuerpo?: Document | XMLHttpRequestBodyInit | null): void {
      if (!this.falso) return super.send(cuerpo as XMLHttpRequestBodyInit);

      const id = this.destino.split('/').filter(Boolean).pop()!;
      const subida = subidas.get(id);
      const tamaño = (cuerpo as Blob)?.size ?? 0;
      const pasos = 10;
      let paso = 0;

      const reloj = setInterval(() => {
        paso++;
        const enviado = Math.round((tamaño * paso) / pasos);
        this.upload.dispatchEvent(
          Object.assign(new ProgressEvent('progress'), { loaded: enviado, total: tamaño }),
        );
        if (paso < pasos) return;

        clearInterval(reloj);
        if (subida) subida.recibido = this.desde + tamaño;

        Object.defineProperty(this, 'status', { value: 204, configurable: true });
        Object.defineProperty(this, 'readyState', { value: 4, configurable: true });
        this.getResponseHeader = (n: string) =>
          n.toLowerCase() === 'upload-offset' ? String(this.desde + tamaño) : null;

        // Terminada del todo: aparece en la lista como recién subida, que es lo
        // que hace el servidor de verdad al cerrar el gancho post-finish.
        if (subida && subida.recibido >= subida.total) {
          store.vods.push({
            id, warId: subida.meta.warId ?? fake.warRows[0].id,
            playerId: fake.session.user.playerId, estado: 'procesando',
            duracionMs: null, offsetMs: null, offsetConfianza: null,
            fijado: false, expiraEn: vencimiento(90),
            subidoEn: new Date().toISOString(), calidades: [],
          });
        }
        this.dispatchEvent(new ProgressEvent('load'));
      }, (tamaño / MBPS_FALSOS) * 1000 / pasos);

      this.addEventListener('abort', () => clearInterval(reloj), { once: true });
    }

    abort(): void {
      if (this.falso) {
        this.dispatchEvent(new ProgressEvent('abort'));
        return;
      }
      super.abort();
    }
  }
  window.XMLHttpRequest = XHRFalso as unknown as typeof XMLHttpRequest;
  void real;
}

export function instalarServidorFalso(): void {
  const real = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes('/api/')) return real(input as RequestInfo, init);

    const entera = new URL(url, location.origin);
    const path = entera.pathname.replace(/^\/api/, '');
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(init.body as string) : undefined;

    await espera();

    if (method === 'GET') {
      for (const [pattern, handler] of GET) {
        const found = path.match(pattern);
        if (found) {
          const out = handler(found, input as Request, body, entera);
          return out === null ? json({ error: 'no existe' }, 404) : json(out);
        }
      }
    } else {
      for (const [verb, pattern, handler] of ESCRITURAS) {
        if (verb !== method) continue;
        const found = path.match(pattern);
        if (found) return json(handler(found, input as Request, body, entera));
      }
      // Cualquier otra escritura se acepta sin guardar nada. Es mentira, y por
      // eso lo dice en la consola: una pantalla que parece guardar y no guarda
      // es peor que una que falla.
      console.warn(`[banco] ${method} ${path} aceptado sin efecto`);
      return json({ ok: true });
    }

    console.warn(`[banco] sin ruta para GET ${path}`);
    return json({ error: `sin ruta para ${path}` }, 404);
  };

  instalarTusFalso(real);
}
