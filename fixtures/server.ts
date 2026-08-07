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
  WarSide,
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
  lineups: LineupGuardado[];
  active: Record<WarSide, string | null>;
  locked: Record<WarSide, boolean>;
  current: ReturnType<typeof fake.board>['current'] | null;
  usuarios: ManagedUser[];
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

const MIEMBROS_DISCORD: DiscordMember[] = [
  { id: '100000000000000001', username: 'meilin_zz', globalName: 'Mei Lin', nick: 'Mei Lin' },
  { id: '100000000000000002', username: 'weichen88', globalName: 'Wei Chen', nick: 'Wei · Vanguardia' },
  { id: '100000000000000003', username: 'jinwei.zhao', globalName: 'Jinwei', nick: 'Jinwei Zhao' },
  { id: '100000000000000004', username: 'ruolan', globalName: null, nick: null },
  { id: '100000000000000005', username: 'baihu_tiger', globalName: 'Bai Hu', nick: '白虎' },
  { id: '100000000000000006', username: 'forastero', globalName: 'Un Forastero', nick: null },
];

const store: Store = {
  players: structuredClone(fake.players),
  ranks: structuredClone(fake.ranks),
  builds: structuredClone(fake.builds),
  weaponSets: structuredClone(fake.weaponSets),
  deployments: structuredClone(fake.deployments),
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
    allowedRoles: ['admin', 'leader', 'subleader', 'officer'],
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
    allowedRoles: ['officer', 'member'],
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

/** Las dos series que siembra el servidor de verdad al arrancar. */
const seriesFalsas: Record<string, unknown>[] = [
  {
    id: 'serie-guerra-domingo', kind: 'war', title: 'Guerra del domingo', weekday: 0,
    timeLocal: '19:30', timezone: 'America/Bogota', minutes: 150, notes: null, allowedRoles: [],
    opensDaysBefore: 6, opensTime: '00:00', closesDaysBefore: 1, closesTime: '12:00',
    autoPublish: true, active: true,
  },
  {
    id: 'serie-guerra-sabado', kind: 'war', title: 'Guerra del sábado', weekday: 6,
    timeLocal: '19:30', timezone: 'America/Bogota', minutes: 150, notes: null, allowedRoles: [],
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
  return e ? { ...e, responses: respuestas[id] ?? [] } : null;
};

const anotar = (id: string, playerId: string, body: Record<string, unknown>, porOtro: string | null) => {
  const p = fake.players.find((x) => x.id === playerId);
  if (!p) return conRespuestas(id);
  // Como el servidor: quien anota por otro queda fuera de la regla, porque
  // apuntar lo que alguien dijo por voz no es votar en su lugar.
  const evento = eventos.find((x) => x.id === id);
  const abierta = (evento?.allowedRoles ?? []) as string[];
  if (!porOtro && abierta.length && !abierta.includes(fake.session.user.role)) {
    return { error: 'esta convocatoria no está abierta a tu rango' };
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
  [/^\/war\/strategies$/, () => fake.strategies],
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
  [/^\/war\/wars$/, () => fake.warRows],
  [/^\/war\/wars\/([^/]+)$/, (m) => fake.warDetail(m[1])],
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
  [/^\/discord\/soundboard$/, () => SONIDOS],
  [/^\/war\/voice-channels$/, () => ({ bot: true, channels: mapaVoz })],
  [/^\/war\/horn$/, () => cuerno],
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
    canalAgenda = body?.channel ?? null;
    return { channel: canalAgenda };
  }],
  ['POST', /^\/events\/([^/]+)\/publish$/, (m) => {
    if (!canalAgenda) return { error: 'falta elegir el canal de la agenda en Administración' };
    const e = eventos.find((x) => x.id === m[1]);
    if (e) {
      e.discordChannelId = canalAgenda;
      e.discordMessageId = `${Date.now()}`;
      e.discordUrl = `https://discord.com/channels/700000000000000000/${canalAgenda}/${e.discordMessageId}`;
    }
    return conRespuestas(m[1]);
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
    const at = eventos.findIndex((x) => x.id === m[1]);
    if (at >= 0) eventos.splice(at, 1);
    return { ok: true };
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
  // El reparto de mentira: mueve a los que tienen "Discord" (los vinculados en
  // usuarios) y deja fuera al resto con su motivo, que es la parte de la
  // respuesta que la interfaz tiene que saber pintar.
  ['PUT', /^\/war\/deployments\/([^/]+)\/([^/]+)\/leader$/, (m, _req, body) => {
    store.deployments = store.deployments.map((d) =>
      d.side === m[1] && d.playerId === m[2] ? { ...d, isLaneLeader: Boolean(body?.leader) } : d,
    );
    return { leader: Boolean(body?.leader) };
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
}
