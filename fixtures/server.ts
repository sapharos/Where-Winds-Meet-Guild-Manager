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

import { Deployment, GuildRank, Player, PlayerBuild, WarSide, WeaponSet } from '../types';
import * as fake from './guild';

interface Store {
  players: Player[];
  ranks: GuildRank[];
  builds: PlayerBuild[];
  weaponSets: WeaponSet[];
  deployments: Deployment[];
  active: Record<WarSide, string | null>;
  locked: Record<WarSide, boolean>;
  current: ReturnType<typeof fake.board>['current'] | null;
}

const store: Store = {
  players: structuredClone(fake.players),
  ranks: structuredClone(fake.ranks),
  builds: structuredClone(fake.builds),
  weaponSets: structuredClone(fake.weaponSets),
  deployments: structuredClone(fake.deployments),
  active: { attack: 'st-1', defense: 'st-2' },
  locked: { attack: false, defense: false },
  current: null,
};

const json = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Un retardo pequeño y constante: sin él nunca se ve un esqueleto de carga. */
const LATENCIA = Number(new URLSearchParams(location.search).get('lat') ?? 180);
const espera = () => new Promise((done) => setTimeout(done, LATENCIA));

type Ruta = (m: RegExpMatchArray, req: Request, body: any) => unknown;

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
  [/^\/users$/, () => [{ ...fake.session.user, disabled: false, createdAt: new Date().toISOString() }]],
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

    const path = new URL(url, location.origin).pathname.replace(/^\/api/, '');
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(init.body as string) : undefined;

    await espera();

    if (method === 'GET') {
      for (const [pattern, handler] of GET) {
        const found = path.match(pattern);
        if (found) {
          const out = handler(found, input as Request, body);
          return out === null ? json({ error: 'no existe' }, 404) : json(out);
        }
      }
    } else {
      for (const [verb, pattern, handler] of ESCRITURAS) {
        if (verb !== method) continue;
        const found = path.match(pattern);
        if (found) return json(handler(found, input as Request, body));
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
