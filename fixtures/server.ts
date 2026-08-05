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

const GET: [RegExp, Ruta][] = [
  [/^\/auth\/me$/, () => fake.session],
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
