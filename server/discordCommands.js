/**
 * Los comandos de barra del bot, contestados por la propia API.
 *
 * Discord ofrece dos formas de escuchar: una conexión permanente (Gateway) o
 * un «Interactions Endpoint URL» al que manda una petición HTTPS cada vez que
 * alguien escribe un comando. Aquí se usa la segunda, que es la que encaja con
 * lo que ya hay: el servidor de Express está publicado y despierto, y así no
 * aparece un proceso más que mantener vivo, reconectar y vigilar. El cliente
 * de Gateway de `discordGateway.js` sigue existiendo para lo único que no se
 * puede hacer por REST -- plantar al bot en un canal de voz para el cuerno --
 * y vive lo que dura un barrido.
 *
 * A cambio, Discord exige demostrar que la petición es suya: cada una llega
 * firmada con Ed25519 y hay que verificarla contra la clave pública de la
 * aplicación (DISCORD_PUBLIC_KEY, en la pestaña «General Information» del
 * portal). Una petición que no verifica se contesta con 401 y nada más -- eso
 * es también lo que Discord comprueba al guardar la URL por primera vez.
 *
 * Los comandos se registran solos al arrancar, contra el servidor del gremio y
 * no globalmente: los de servidor entran al momento, y los globales tardan
 * hasta una hora en propagarse. Registrar es idempotente -- se manda la lista
 * entera y Discord la sustituye -- así que un despliegue nuevo pone al día lo
 * que haya cambiado sin que nadie corra ningún script a mano.
 */

import { createPublicKey, verify } from 'node:crypto';
import { pool, GUILD_ID } from './db.js';
import { SCAN_FIELDS } from './scans.js';
import { listBuilds, saveBuilds, MAX_WEAPONS } from './builds.js';
import { listWeaponSets } from './weapons.js';
import { permissionsFor } from './auth.js';
import { LANE_INFO, LANE_CAPACITY, WAR_CAPACITY, SIDES, getBoard, listStrategies } from './war.js';
import {
  getEvent,
  myEvents,
  respond,
  respuestasDe,
  puedeContestar,
  getAgendaChannel,
  setDiscordMessage,
} from './events.js';
import {
  botEnabled,
  postMessage,
  editMessage,
  deleteMessage,
  listGuildRoles,
  memberRoles,
  sendDirectMessage,
} from './discordBot.js';
import {
  asegurarEventos,
  pendientesDePublicar,
  pendientesDeAviso,
  marcarAvisado,
  sinContestar,
  AVISO_HORAS,
} from './agenda.js';

const API = 'https://discord.com/api/v10';

/**
 * La envoltura DER de una clave Ed25519.
 *
 * Discord publica la clave en crudo, 32 bytes en hexadecimal, y node sólo sabe
 * importar claves envueltas en SPKI. Estos doce bytes son esa envoltura y son
 * siempre los mismos para Ed25519 (el OID 1.3.101.112 y las longitudes que lo
 * acompañan), así que anteponerlos es toda la conversión que hace falta y
 * evita traer una dependencia entera para esto.
 */
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');

// Arriba del todo porque la lista de comandos, que se construye al cargar el
// módulo, saca de aquí los nombres de las opciones. Declarado más abajo, leerlo
// desde COMMANDS reventaría el import entero.
const WAR_SIDES = { attack: 'Ataque', defense: 'Defensa' };

/**
 * El color de cada frente.
 *
 * No son dos colores elegidos aquí: son `--d-700` y `--i-700` de tokens.css,
 * los mismos peldaños con los que la tarjeta del roster pinta las insignias de
 * ATAQUE y DEFENSA. Que un bando se vea igual en la web y en Discord no es
 * decoración; es lo que hace que sean el mismo bando.
 *
 * Van en el tema claro de la rampa y no en el oscuro porque un embed tiene un
 * color y no dos: Discord no sabe con qué tema lo está leyendo cada uno.
 */
const COLOR_BANDO = { attack: 0x74251a, defense: 0x2a3a72 };

/** Tipos de interacción y de respuesta que se usan aquí. */
const PING = 1;
const APPLICATION_COMMAND = 2;
/** Alguien ha pulsado un botón de un mensaje nuestro. */
const MESSAGE_COMPONENT = 3;
/** Discord pregunta mientras alguien escribe, para ofrecerle la lista. */
const AUTOCOMPLETE = 4;
const PONG = 1;
const MESSAGE = 4;
/** Reescribe el mensaje donde está, en vez de mandar otro debajo. */
const UPDATE_MESSAGE = 7;
const CHOICES = 8;
/** Sólo la ve quien escribió el comando. */
const EPHEMERAL = 64;

export const commandsEnabled = () =>
  Boolean(process.env.DISCORD_PUBLIC_KEY && process.env.DISCORD_CLIENT_ID);

/* ------------------------------------------------------------------ firma */

let cachedKey = null;

function publicKey() {
  if (!cachedKey) {
    cachedKey = createPublicKey({
      key: Buffer.concat([SPKI_ED25519, Buffer.from(process.env.DISCORD_PUBLIC_KEY, 'hex')]),
      format: 'der',
      type: 'spki',
    });
  }
  return cachedKey;
}

/**
 * ¿La firmó Discord?
 *
 * Se firma la marca de tiempo seguida del cuerpo **sin tocar**: cualquier
 * reserialización del JSON -- otro orden de claves, otro espaciado -- cambia
 * los bytes y tira la firma. Por eso `index.js` guarda el buffer original.
 */
export function verifyInteraction(req) {
  const signature = req.get('X-Signature-Ed25519');
  const timestamp = req.get('X-Signature-Timestamp');
  if (!signature || !timestamp || !req.rawBody) return false;

  try {
    return verify(
      null,
      Buffer.concat([Buffer.from(timestamp), req.rawBody]),
      publicKey(),
      Buffer.from(signature, 'hex'),
    );
  } catch {
    // Una firma que ni siquiera es hexadecimal es una firma que no vale.
    return false;
  }
}

/* -------------------------------------------------------------- registro */

/**
 * Visibles para todos; quién es del gremio lo decide la web.
 *
 * Ser del gremio es tener cuenta enlazada, y eso no es ningún rol de Discord:
 * no hay rol que conceder que signifique lo mismo, y mantener uno a mano en
 * paralelo al roster es tener dos listas que se contradicen el día que alguien
 * entra. `vetado()` ya mira lo que de verdad importa -- cuenta enlazada y ficha
 * de alta -- antes de tocar ningún dato, así que la puerta está puesta donde se
 * puede mantener sola.
 *
 * Esto estuvo en «0» (nadie, hasta que un líder conceda el rol en Ajustes del
 * servidor → Integraciones) durante un día. Cumplía su objetivo -- que los
 * cientos de personas del servidor que no son del gremio no vieran comandos que
 * no les iban a contestar -- pero a cambio se los quitó al gremio entero, que
 * es a quien están hechos: quien no era administrador de Discord dejó de verlos
 * de un despliegue para otro. El precio correcto es el contrario: que quien no
 * es del gremio los vea y reciba una negativa que además le explica cómo
 * enlazarse, en vez de que quien sí lo es tenga que esperar a que un líder se
 * acuerde de un panel de Discord.
 *
 * `null` y no omitir el campo: el registro es un PUT que reemplaza la
 * definición entera, y decirlo explícitamente es lo que borra un «0» anterior.
 */
const LOS_VE_TODO_EL_MUNDO = null;

/** Lo que el gremio ve al escribir «/» en Discord. */
const COMMANDS = [
  {
    name: 'perfil',
    default_member_permissions: LOS_VE_TODO_EL_MUNDO,
    description: 'Estadísticas del último escaneo del gremio',
    options: [
      // Dos formas de nombrar a otro, porque ninguna sola llega a todo el
      // roster: por mención sólo aparece quien tenga cuenta vinculada, y por
      // nombre aparece cualquiera aunque nunca haya entrado en la web.
      {
        type: 6, // usuario de Discord
        name: 'miembro',
        description: 'De quién, si tiene su Discord vinculado',
        required: false,
      },
      {
        type: 3, // texto
        name: 'nombre',
        description: 'De quién, buscándolo en el roster por su nombre',
        required: false,
        autocomplete: true,
      },
      {
        type: 5, // booleano
        name: 'publico',
        description: 'Enseñarlas en el canal en vez de sólo a ti',
        required: false,
      },
    ],
  },
  {
    name: 'guerra',
    default_member_permissions: LOS_VE_TODO_EL_MUNDO,
    description: 'Quién está asignado a cada línea, en ataque y en defensa',
    options: [
      // Las dos como lista cerrada y no como texto: se elige de un desplegable,
      // no hay nada que escribir mal, y los valores que viajan son los ids
      // guardados aunque lo que se lea sea el color.
      {
        type: 3,
        name: 'bando',
        description: 'Sólo un bando',
        required: false,
        choices: SIDES.map((side) => ({ name: WAR_SIDES[side], value: side })),
      },
      {
        type: 3,
        name: 'linea',
        description: 'Sólo una línea',
        required: false,
        choices: LANE_INFO.map((l) => ({ name: l.label, value: l.id })),
      },
      {
        type: 5,
        name: 'publico',
        description: 'Enseñarlo en el canal en vez de sólo a ti',
        required: false,
      },
    ],
  },
  {
    name: 'agenda',
    default_member_permissions: LOS_VE_TODO_EL_MUNDO,
    description: 'Lo que viene y qué has contestado',
  },
  {
    name: 'build',
    default_member_permissions: LOS_VE_TODO_EL_MUNDO,
    description: 'Tu build principal: mírala y cámbiala',
    options: [
      {
        type: 5, // booleano
        name: 'publico',
        description: 'Enseñarla en el canal en vez de sólo a ti (sin poder cambiarla)',
        required: false,
      },
    ],
  },
];

/**
 * Pone la lista de comandos al día en el servidor del gremio.
 *
 * No lanza: que Discord esté caído o el token mal puesto no puede impedir que
 * la API arranque -- el resto del producto no depende de esto. Se avisa por el
 * log, que es donde se mira cuando un comando no aparece.
 */
export async function registerCommands() {
  // El bot puesto y la clave no es la única forma de equivocarse, pero es la
  // que no se ve: Discord contesta «no se ha podido verificar la URL» sin
  // decir por qué, y desde fuera un 503 y un servidor caído se parecen. Si
  // hay bot, decirlo aquí ahorra la media hora de buscarlo en el portal.
  if (process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_GUILD_ID && !process.env.DISCORD_PUBLIC_KEY) {
    console.warn(
      'Discord: falta DISCORD_PUBLIC_KEY, así que no hay comandos de barra. ' +
        'Está en la página «General Information» de la aplicación; sin ella, ' +
        '/api/discord/interactions responde 503 y el portal rechaza la URL.',
    );
  }
  if (!commandsEnabled() || !process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_GUILD_ID) return;

  try {
    const res = await fetch(
      `${API}/applications/${process.env.DISCORD_CLIENT_ID}/guilds/${process.env.DISCORD_GUILD_ID}/commands`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(COMMANDS),
      },
    );
    if (!res.ok) {
      const cuerpo = await res.json().catch(() => null);
      console.error(
        `Discord rechazó el registro de comandos (${res.status})`,
        cuerpo?.message ?? '',
        // 403 aquí suele ser el bot invitado sin el scope applications.commands.
        res.status === 403 ? '-- reinvita al bot con scope=bot%20applications.commands' : '',
      );
      return;
    }
    console.log(`Comandos de Discord registrados: ${COMMANDS.map((c) => `/${c.name}`).join(', ')}`);
  } catch (err) {
    console.error('No se pudieron registrar los comandos de Discord:', err.message);
  }
}

/* --------------------------------------------------------- a quién contesta */

/**
 * Los roles de Discord a los que el bot atiende. Vacío, a todo el mundo.
 *
 * Se guardan los ids y no los nombres: renombrar el rol en Discord no rompe
 * nada, que es la mitad de «si el rol cambia a futuro». La otra mitad es que
 * esto se elige en Administración y no aquí, así que rehacer los roles del
 * servidor se arregla volviendo a escogerlo, sin desplegar.
 *
 * Es una lista y no un rol solo por lo mismo que en los eventos: durante un
 * cambio de rol conviven el viejo y el nuevo unos días, y con un único hueco
 * habría que elegir a quién dejar fuera mientras tanto.
 */
const ROLES_KEY = `discord_bot_roles:${GUILD_ID}`;

export async function getBotRoles() {
  const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = $1`, [ROLES_KEY]);
  if (!rows.length) return [];
  try {
    const leido = JSON.parse(rows[0].value);
    return Array.isArray(leido) ? leido : [];
  } catch {
    return [];
  }
}

export async function setBotRoles(roles) {
  // Los ids de Discord son números largos. Con exigir eso se cae la basura sin
  // atarse a un tamaño que Discord puede cambiar -- igual que en los eventos.
  const limpios = [
    ...new Set((Array.isArray(roles) ? roles : []).filter((r) => /^\d{5,25}$/.test(String(r)))),
  ];
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [ROLES_KEY, JSON.stringify(limpios)],
  );
  return limpios;
}

/**
 * La negativa por rol, o null si puede pasar.
 *
 * Va en `handleInteraction` y no en `vetado()` a propósito: los roles vienen
 * dentro de la propia interacción, así que esto no cuesta ninguna consulta por
 * persona y corta antes que nada -- comandos, botones y autocompletado con la
 * misma regla, en vez de seis sitios que hay que acordarse de tocar a la vez.
 *
 * La regla la pone `puedeContestar()`, la misma de los eventos, porque es la
 * misma pregunta: si los roles que llevas puestos cumplen una restricción. Dos
 * copias de esto serían dos que acaban diciendo cosas distintas.
 *
 * En un privado no hay `member` y por tanto no hay roles que leer. Con
 * restricción puesta eso es un no: no se puede afirmar que tenga el rol, que es
 * justo lo que se está preguntando. Los comandos son del servidor del gremio,
 * así que en la práctica siempre traen `member`.
 */
async function sinElRol(body) {
  const exigidos = await getBotRoles();
  if (puedeContestar(exigidos, body?.member?.roles ?? null)) return null;

  // Nombrar el rol que falta: «no tienes permiso» obliga a preguntar cuál, y
  // quien contesta es el mismo líder al que se le pide. Si Discord no da la
  // lista se dice lo genérico, que sigue siendo cierto.
  const nombres = await listGuildRoles()
    .then((todos) => todos.filter((r) => exigidos.includes(r.id)).map((r) => r.name))
    .catch(() => []);
  return aviso(
    nombres.length
      ? `El bot es para el gremio: te falta el rol ${nombres.map((n) => `**${n}**`).join(' o ')} en este servidor. Pídeselo a un líder.`
      : 'El bot es para el gremio, y tu cuenta de Discord no tiene el rol que hace falta. Pídeselo a un líder.',
  );
}

/* ------------------------------------------------------------- presentación */

const miles = new Intl.NumberFormat('es');

/** El latón de la grapa, que es el color de marca del producto. */
const LATON = 0xd3a155;

const ROLE_NAMES = { Tank: 'Tanque', Healer: 'Sanador', DPS: 'DPS' };

/**
 * Las etiquetas de las cifras, copiadas de SCAN_FIELD_CATALOG en types.ts.
 *
 * Está duplicado y no me gusta, pero el catálogo vive en TypeScript y este
 * servidor es JavaScript sin compilar: importarlo obligaría a meter un paso de
 * build en la API entera para once cadenas. Si se renombra un campo allí, se
 * renombra aquí -- igual que el calendario de la guerra en `horn.js`.
 *
 * `level` y `week_activity` no están: van arriba, en la cabecera, y repetirlos
 * en la parrilla sería decir dos veces lo mismo.
 */
const ETIQUETAS = {
  days_joined: 'Días en el gremio',
  treasure_tokens_week: 'Tokens de la semana',
  treasure_tokens_total: 'Tokens totales',
  weekly_clears: 'Clears de la semana',
  last_week_clears: 'Clears semana previa',
  highest_floor: 'Piso más alto',
  league_participations: 'Partidas de liga',
  ranked_participations: 'Partidas ranked',
  duel_participations: 'Duelos',
  martial_mastery: 'Maestría marcial',
  exploration_mastery: 'Maestría exploración',
  profession_mastery: 'Maestría profesión',
};

const numero = (valor) =>
  typeof valor === 'number' ? valor : valor === null || valor === undefined ? null : Number(valor) || null;

/**
 * Una cifra y lo que ha cambiado desde el escaneo anterior.
 *
 * El signo va con flecha y no sólo con color: un embed no deja colorear una
 * palabra suelta, y aunque dejara, el color no puede ser lo único que diga si
 * algo sube o baja -- es la misma regla que sigue el roster.
 */
function conCambio(ahora, antes) {
  const cifra = `**${miles.format(ahora)}**`;
  if (antes === null || antes === ahora) return cifra;
  const delta = ahora - antes;
  return `${cifra}  ${delta > 0 ? '▲' : '▼'} ${delta > 0 ? '+' : ''}${miles.format(delta)}`;
}

/** `#8a5a16` como el entero que pide Discord. Sin color válido, el latón. */
function comoEntero(hex) {
  const limpio = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ''));
  return limpio ? parseInt(limpio[1], 16) : LATON;
}

/**
 * El perfil de un miembro como embed.
 *
 * Función pura y exportada a propósito: es la parte que hay que poder mirar y
 * corregir sin un Discord delante ni una base de datos detrás.
 */
export function perfilEmbed({ player, scans, builds, weaponSets, avatarUrl, guildName, ajeno = false }) {
  const ultimo = scans[0] ?? null;
  const previo = scans[1] ?? null;
  const principal = builds.find((b) => b.isPrimary) ?? builds[0] ?? null;
  const conjunto = principal?.weapons?.length
    ? weaponSets.find((s) => s.weapons.includes(principal.weapons[0]))
    : null;

  // La identidad, en el orden en que la lee la tarjeta del roster.
  const identidad = [ROLE_NAMES[player.role] ?? player.role, player.sect, `Nivel ${player.level}`]
    .filter(Boolean)
    .join(' · ');

  // Las marcas. La grapa se dibuja tal cual la dibuja la dirección visual:
  // dos cabezas y un puente.
  const marcas = [];
  if (player.isStarter) marcas.push('●━━●  **Titular**');
  if (player.warSide) marcas.push(`**${WAR_SIDES[player.warSide] ?? player.warSide}**`);
  if (player.isActive === false) marcas.push('*fuera del gremio*');

  const descripcion = [identidad, marcas.join('   ·   ')].filter(Boolean).join('\n');

  const fields = [];

  // La actividad semanal, a fila completa y la primera: es la cifra a la que
  // viene un miembro, y por eso también es la que abre Mi perfil en la web.
  if (ultimo && numero(ultimo.week_activity) !== null) {
    fields.push({
      name: 'Actividad semanal',
      value: conCambio(numero(ultimo.week_activity), previo ? numero(previo.week_activity) : null),
      inline: false,
    });
  }

  if (principal) {
    const armas = principal.weapons?.length ? principal.weapons.join(' · ') : 'sin armas anotadas';
    fields.push({ name: 'Build principal', value: `${principal.name}\n${armas}`, inline: false });
  }

  // El resto de cifras, de tres en tres, que es como Discord reparte los
  // campos en línea. Sólo las que el escaneo trajo: un hueco vacío no dice
  // nada y desalinea la parrilla.
  if (ultimo) {
    for (const [key, label] of Object.entries(ETIQUETAS)) {
      const ahora = numero(ultimo[key]);
      if (ahora === null) continue;
      fields.push({
        name: label,
        value: conCambio(ahora, previo ? numero(previo[key]) : null),
        inline: true,
      });
    }
  }

  const embed = {
    author: { name: guildName ?? 'Zona Zero' },
    title: player.name,
    description: descripcion,
    // La barra lateral toma el color del arma principal, igual que la barra
    // izquierda de la tarjeta del roster. Sin build, el latón de la grapa.
    color: conjunto ? comoEntero(conjunto.color) : LATON,
    fields,
  };

  if (avatarUrl) embed.thumbnail = { url: avatarUrl };

  if (ultimo) {
    embed.footer = {
      text: previo
        ? 'Del último escaneo del gremio · el cambio es respecto al anterior'
        : 'Del último escaneo del gremio',
    };
    embed.timestamp = new Date(ultimo.scannedAt).toISOString();
  } else {
    embed.footer = {
      text: ajeno
        ? 'Todavía no aparece en ningún escaneo del gremio'
        : 'Todavía no apareces en ningún escaneo del gremio',
    };
  }

  return embed;
}

/**
 * Los tres papeles, como los ofrece el desplegable.
 *
 * «Healer» y no «Sanador» por la misma razón que en el tablero de guerra: es
 * como los llama el gremio hablando, y esto es Discord. La web sigue diciendo
 * Sanador, que es su idioma.
 */
const PAPELES = [
  { value: 'Tank', label: 'Tanque', description: 'Aguantas y abres hueco' },
  { value: 'Healer', label: 'Healer', description: 'Sostienes a los demás' },
  { value: 'DPS', label: 'DPS', description: 'Haces el daño' },
];

/**
 * Cómo se escribe un papel en este comando.
 *
 * Sale de `PAPELES` y no de una segunda tabla a propósito: el desplegable y el
 * texto de debajo tienen que decir lo mismo, y dos listas paralelas es
 * exactamente la forma de que un día dejen de decirlo.
 */
const NOMBRE_PAPEL = Object.fromEntries(PAPELES.map((p) => [p.value, p.label]));

/** Lo que Discord acepta en un desplegable, y lo que hay que decir si sobra. */
const MAX_OPCIONES = 25;

/**
 * Las armas que se pueden elegir, sacadas del catálogo de conjuntos.
 *
 * Una por opción y no un conjunto entero: una build guarda armas sueltas, no un
 * conjunto -- el conjunto se deduce después, buscando cuál contiene la primera
 * --, así que ofrecer pares impediría la mezcla que el modelo sí permite. El
 * nombre del conjunto va de descripción, que es lo que agrupa la lista a la
 * vista sin que Discord tenga forma de agruparla de verdad.
 *
 * Si el gremio llega a tener más armas de las que caben, las que ya lleva
 * puestas entran siempre: sin eso, elegir se convertiría en perderlas.
 */
function opcionesDeArmas(weaponSets, puestas = []) {
  const vistas = new Set();
  const todas = [];
  for (const conjunto of weaponSets) {
    for (const arma of conjunto.weapons ?? []) {
      // Un arma en dos conjuntos sería dos opciones con el mismo valor, y eso
      // Discord lo rechaza entero. Se queda con el primero que la nombró.
      if (vistas.has(arma)) continue;
      vistas.add(arma);
      todas.push({
        label: recortar(arma, 100),
        value: arma,
        description: recortar(conjunto.name, 100),
        default: puestas.includes(arma),
      });
    }
  }

  if (todas.length <= MAX_OPCIONES) return { opciones: todas, recortado: 0 };

  const suyas = todas.filter((o) => o.default);
  const resto = todas.filter((o) => !o.default).slice(0, MAX_OPCIONES - suyas.length);
  return { opciones: [...suyas, ...resto], recortado: todas.length - suyas.length - resto.length };
}

/**
 * Tu build principal, y lo que puedes cambiarle desde aquí.
 *
 * Pura y sin Discord delante por la misma razón que `perfilEmbed`: es la parte
 * que hay que poder mirar y corregir sin levantar nada.
 *
 * `editable` decide si se pintan los desplegables. Va en falso cuando la ficha
 * se enseña en el canal: un desplegable en un mensaje público lo puede tocar
 * cualquiera que pase, y aunque cada quien sólo se edita lo suyo -- el dueño de
 * la interacción es quien pulsa, no quien escribió el comando -- eso es una
 * confusión que no hace falta tener. En público se lee y ya.
 */
export function buildVista({ player, builds, weaponSets, editable = true, guildName = null }) {
  const principal = builds.find((b) => b.isPrimary) ?? builds[0] ?? null;
  const conjunto = principal?.weapons?.length
    ? weaponSets.find((s) => s.weapons.includes(principal.weapons[0]))
    : null;

  if (!principal) {
    return {
      embeds: [
        {
          author: { name: guildName ?? 'Zona Zero' },
          title: player.name,
          description:
            'No tienes ninguna build anotada, así que la Sala de Guerra no sabe con qué juegas.\n\n' +
            'La primera se crea en la web, en **Mi perfil**: hace falta una vez, con sus armas y sus notas. ' +
            'A partir de ahí este comando basta para cambiar de principal.',
          color: LATON,
        },
      ],
      components: [],
    };
  }

  const armas = principal.weapons?.length ? principal.weapons.join(' · ') : '*sin armas anotadas*';
  const papeles = principal.roles?.length
    ? principal.roles.map((r) => NOMBRE_PAPEL[r] ?? r).join(' · ')
    : '*sin papel anotado*';

  const fields = [
    { name: 'Armas', value: armas, inline: true },
    { name: 'Papel', value: papeles, inline: true },
  ];
  if (conjunto) fields.push({ name: 'Conjunto', value: conjunto.name, inline: false });
  if (principal.notes) fields.push({ name: 'Notas', value: literal(principal.notes), inline: false });

  const otras = builds.filter((b) => b !== principal);
  if (otras.length) {
    fields.push({
      name: `Tus otras builds (${otras.length})`,
      value: otras.map((b) => literal(b.name)).join(' · '),
      inline: false,
    });
  }

  const embeds = [
    {
      author: { name: guildName ?? 'Zona Zero' },
      title: player.name,
      description: `**${literal(principal.name)}**`,
      // El color del arma, igual que en la ficha y que en la tarjeta del roster.
      color: conjunto ? comoEntero(conjunto.color) : LATON,
      fields,
      // Lo que está en juego, dicho donde se lee: el papel de la principal es
      // el que la Sala de Guerra cuenta para equilibrar líneas, así que
      // tenerlo mal no es un detalle cosmético.
      footer: {
        text: editable
          ? 'El papel de tu build principal es lo que la Sala de Guerra usa para equilibrar las líneas'
          : 'Armas y notas se cambian en la web, en Mi perfil',
      },
    },
  ];

  if (!editable) return { embeds, components: [] };

  const components = [];

  // Cambiar de principal sólo tiene sentido si hay entre qué elegir.
  if (builds.length > 1) {
    const opciones = builds.slice(0, MAX_OPCIONES).map((b) => ({
      label: recortar(b.name, 100),
      value: b.id,
      description: b.weapons?.length ? recortar(b.weapons.join(' · '), 100) : undefined,
      default: b === principal,
    }));
    components.push({
      type: 1,
      components: [
        {
          type: 3,
          custom_id: 'build:principal',
          placeholder: 'Cuál es tu build principal',
          options: opciones,
        },
      ],
    });
    // Nada de recortes callados: si a alguien no le cabe una build en la lista,
    // que lo sepa en vez de creer que la perdió.
    if (builds.length > MAX_OPCIONES) {
      embeds[0].fields.push({
        name: 'Aviso',
        value: `Sólo caben ${MAX_OPCIONES} en la lista; las demás se cambian en la web.`,
        inline: false,
      });
    }
  }

  const { opciones, recortado } = opcionesDeArmas(weaponSets, principal.weapons ?? []);
  if (opciones.length) {
    components.push({
      type: 1,
      components: [
        {
          type: 3,
          custom_id: 'build:armas',
          placeholder: `Con qué juegas (hasta ${MAX_WEAPONS})`,
          min_values: 1,
          max_values: Math.min(MAX_WEAPONS, opciones.length),
          options: opciones,
        },
      ],
    });
    if (recortado) {
      embeds[0].fields.push({
        name: 'Aviso',
        value: `El catálogo tiene ${recortado} arma(s) más de las que caben en la lista; ésas se ponen en la web.`,
        inline: false,
      });
    }
  }

  components.push({
    type: 1,
    components: [
      {
        type: 3,
        custom_id: 'build:papel',
        placeholder: 'Qué papel haces con ella',
        min_values: 1,
        max_values: PAPELES.length,
        options: PAPELES.map((p) => ({
          ...p,
          default: (principal.roles ?? []).includes(p.value),
        })),
      },
    ],
  });

  // Con una sola build no hay selector de principal, y sin decirlo parece que
  // el comando no sabe hacer más. Se dice dónde se crean las otras.
  if (builds.length === 1) {
    embeds[0].footer = {
      text: `${embeds[0].footer.text} · Para tener más de una build, créalas en la web`,
    };
  }

  return { embeds, components };
}

/** Discord corta las etiquetas por su cuenta; mejor cortarlas diciéndolo. */
const recortar = (texto, largo) => {
  const limpio = String(texto ?? '');
  return limpio.length > largo ? `${limpio.slice(0, largo - 1)}…` : limpio;
};

/**
 * Los roles como se agrupan dentro de una línea.
 *
 * En este orden y no en otro: es el de la formación -- quién aguanta, quién
 * cura, quién pega -- y es el mismo que usan el planificador y el tablero.
 */
const GRUPOS = [
  { role: 'Tank', label: 'Tanques' },
  // «Healers» y no «Sanadores»: es como los llama el gremio. La web sigue
  // diciendo Sanador, que es su idioma; esto es el idioma de Discord.
  { role: 'Healer', label: 'Healers' },
  { role: 'DPS', label: 'DPS' },
];

/**
 * Un nombre de jugador no es marcado.
 *
 * Alguien que se llame `**Xx**` o `Wei_Chen` convertiría media lista en
 * cursiva o en negrita; escapar los cuatro caracteres que Discord interpreta
 * deja el nombre como está escrito en el roster.
 */
const literal = (texto) => String(texto).replace(/([*_`~|\\])/g, '\\$1');

/**
 * Cómo se nombra a un desplegado: su nombre del juego y su Discord.
 *
 * El Discord va como mención de verdad -- `<@id>` -- y no como el texto del
 * usuario que hay guardado, por dos razones: Discord la pinta con el nombre
 * que esa persona tenga hoy, así que no envejece, y se puede pulsar para
 * escribirle. No avisa a nadie: una mención dentro de un embed nunca notifica,
 * y además la respuesta prohíbe menciones.
 *
 * A quien no tiene Discord vinculado se le pone sólo el nombre, y esa ausencia
 * es información: son los que no van a leer nada de lo que se escriba aquí.
 */
/**
 * Los nueve cuadros de color que tiene Discord, con el color que pinta cada
 * uno. Es todo el color que se puede meter en un renglón de texto: un embed
 * tiñe su barra lateral y nada más, así que una unidad táctica que en la web
 * es naranja aquí es el cuadro naranja.
 */
const CUADROS = [
  { emoji: '🟥', rgb: [237, 66, 69] },
  { emoji: '🟧', rgb: [244, 144, 12] },
  { emoji: '🟨', rgb: [253, 203, 88] },
  { emoji: '🟩', rgb: [120, 177, 89] },
  { emoji: '🟦', rgb: [85, 172, 238] },
  { emoji: '🟪', rgb: [170, 142, 214] },
  { emoji: '🟫', rgb: [153, 108, 78] },
  { emoji: '⬛', rgb: [49, 55, 61] },
  { emoji: '⬜', rgb: [230, 231, 232] },
];

/** El cuadro que más se parece a un color del usuario. */
function cuadroDe(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex ?? ''));
  if (!m) return CUADROS[1].emoji; // el naranja, que es el color por defecto
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  let mejor = CUADROS[0];
  let cerca = Infinity;
  for (const c of CUADROS) {
    const d = (c.rgb[0] - r) ** 2 + (c.rgb[1] - g) ** 2 + (c.rgb[2] - b) ** 2;
    if (d < cerca) {
      cerca = d;
      mejor = c;
    }
  }
  return mejor.emoji;
}

/**
 * Cómo se nombra a un desplegado: su nombre, su Discord y sus unidades.
 *
 * Las unidades van como cuadros de color y no con su nombre escrito: alguien
 * puede estar en dos a la vez -- el mismo sanador en la escolta y en los
 * campamentos -- y diez nombres con dos unidades cada uno no es una lista, es
 * un párrafo. Los cuadros se explican debajo, en la leyenda de la tarjeta, así
 * que el color nunca es lo único que dice de qué unidad se trata.
 */
const nombra = (d, unidades) => {
  const suyas = (d.unitIds ?? [])
    .map((id) => unidades?.get(id))
    .filter(Boolean)
    .map((u) => cuadroDe(u.color))
    .join('');
  return `${d.isLaneLeader ? '👑 ' : ''}${literal(d.name)}${
    d.discordId ? ` <@${d.discordId}>` : ''
  }${suyas ? ` ${suyas}` : ''}`;
};

/** Los desplegados de una línea y un bando, agrupados por lo que hacen. */
function porRoles(gente, unidades) {
  if (!gente.length) return '*nadie asignado*';

  return GRUPOS.map(({ role, label }) => {
    const suyos = gente.filter((d) => d.role === role);
    // La línea del rol se escribe aunque esté vacía: que a la Amarilla no le
    // quede ningún tanque es justo lo que hay que ver de un vistazo, y un
    // renglón que falta no se ve.
    const nombres = suyos.length ? suyos.map((d) => nombra(d, unidades)).join(' · ') : '—';
    return `**${label}** ${nombres}`;
  }).join('\n');
}

/**
 * Qué unidades aparecen en esta línea, para poder leer los cuadros.
 *
 * Sólo las que están puestas a alguien de aquí: la leyenda entera de la
 * estrategia en cada una de las seis tarjetas sería repetir seis veces lo que
 * hace falta una.
 */
function leyenda(gente, unidades) {
  if (!unidades?.size) return null;
  const vistas = new Map();
  for (const d of gente) {
    for (const id of d.unitIds ?? []) {
      const u = unidades.get(id);
      if (u && !vistas.has(id)) vistas.set(id, u);
    }
  }
  if (!vistas.size) return null;
  return [...vistas.values()].map((u) => `${cuadroDe(u.color)} ${literal(u.name)}`).join('   ');
}

/**
 * El tablero de guerra: una tarjeta por línea, con su color.
 *
 * Una tarjeta por bando y línea, y los bandos sin mezclarse: primero las tres
 * de ataque, después las tres de defensa. Antes cada línea traía los dos
 * dentro y para leer la defensa entera había que ir saltando de tarjeta en
 * tarjeta leyendo sólo la mitad de abajo de cada una.
 *
 * La barra lateral sigue siendo el color de la línea, que es su nombre; quién
 * es de quién lo dice el título. Y debajo, si en esa línea hay unidades
 * tácticas puestas, la leyenda de los cuadros que llevan sus miembros.
 *
 * Función pura y exportada, como `perfilEmbed`, para poder mirarla sin un
 * Discord delante.
 */
export function tableroDeGuerra({
  despliegues,
  guerra,
  locked = {},
  bando = null,
  linea = null,
  // Las unidades tácticas del plan en vigor de cada bando: { attack: [...] }.
  unidades = {},
  ahora = Date.now(),
}) {
  const porBando = Object.fromEntries(
    SIDES.map((side) => [side, new Map((unidades[side] ?? []).map((u) => [u.id, u]))]),
  );

  // Lo que se enseña. Filtrar no cambia nada de lo que hay debajo: es la misma
  // lista mirada por una rendija.
  const bandos = bando ? SIDES.filter((s) => s === bando) : SIDES;
  const lineas = linea ? LANE_INFO.filter((l) => l.id === linea) : LANE_INFO;

  const cuantos = (side) => despliegues.filter((d) => d.side === side).length;

  const cabecera = guerra
    ? // La hora en el reloj de quien lo lee, no en el del servidor: el gremio
      // no está todo en el mismo huso.
      `⚔ **${literal(guerra.name)}** · empezó <t:${Math.floor(
        new Date(guerra.startedAt).getTime() / 1000,
      )}:R>`
    : 'Sin guerra en curso. Así está el tablero:';

  // Cuándo se miró esto. Discord lo cuenta solo en el cliente -- «hace unos
  // segundos», «hace 4 minutos» -- así que un tablero viejo se delata sin que
  // nadie tenga que refrescarlo para descubrirlo.
  const actualizado = `actualizado <t:${Math.floor(ahora / 1000)}:R>`;

  // Bando por fuera y línea por dentro, con un rótulo abriendo cada bando.
  //
  // Seis tarjetas seguidas se leían como una sola columna: la última de ataque
  // y la primera de defensa se tocaban, y el corte entre los dos frentes --
  // que es la división más importante que hay aquí -- no se veía. El rótulo es
  // una tarjeta sin cuerpo, en el color de su bando y no en el de ninguna
  // línea, para que se lea como lo que es: el encabezado de un bloque y no una
  // línea más.
  //
  // Y por eso las tarjetas de línea ya no repiten el bando en su título: lo
  // acaba de decir el rótulo de encima, dos veces sería ruido.
  const embeds = bandos.flatMap((side) => [
    {
      title: `${side === 'attack' ? '⚔' : '🛡'}  ${WAR_SIDES[side].toUpperCase()}  ·  ${cuantos(
        side,
      )}/${WAR_CAPACITY}${locked[side] ? '  🔒 cerrado' : ''}`,
      color: COLOR_BANDO[side],
    },
    ...lineas.map((l) => {
      const gente = despliegues.filter((d) => d.lane === l.id && d.side === side);
      const suyas = leyenda(gente, porBando[side]);
      return {
        title: `${l.label} — ${gente.length}/${LANE_CAPACITY}`,
        color: l.colour,
        description: porRoles(gente, porBando[side]),
        ...(suyas ? { fields: [{ name: 'Unidades tácticas', value: suyas, inline: false }] } : {}),
      };
    }),
  ]);

  return {
    content: `${cabecera}\n${actualizado}`,
    embeds,
    // El botón se lleva puesto el filtro con el que se pintó, así que
    // actualizar devuelve lo mismo que se estaba mirando y no el tablero
    // entero. Es el único sitio donde ese filtro sobrevive: el mensaje no
    // recuerda con qué opciones se escribió el comando.
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 2,
            label: 'Actualizar',
            emoji: { name: '🔄' },
            custom_id: `guerra:${bando ?? ''}:${linea ?? ''}`,
          },
        ],
      },
    ],
  };
}

/* ------------------------------------------------------------------ agenda */

const EVENTO_TIPOS = {
  war: { label: 'Guerra de gremio', emoji: '⚔' },
  practice: { label: 'Guerra de práctica', emoji: '🎯' },
  pve: { label: 'Evento PvE', emoji: '🐉' },
  casual: { label: 'Actividad del gremio', emoji: '🍵' },
};

const RESPUESTAS = [
  { answer: 'yes', label: 'Voy', emoji: '✅' },
  { answer: 'maybe', label: 'Tal vez', emoji: '❔' },
  { answer: 'no', label: 'No puedo', emoji: '✖' },
];

const RESPUESTA = (answer) => RESPUESTAS.find((r) => r.answer === answer);

/** Los botones que se ofrecen: en una guerra, dos. */
const ofrecidas = (evento) => respuestasDe(evento.kind).map(RESPUESTA);

/**
 * Las listas que se enseñan: las que se ofrecen, más cualquiera que alguien
 * haya contestado.
 *
 * Una guerra de antes del cambio tiene sus «tal vez» guardados, y dejar de
 * pintar la lista los borraría de la vista sin borrarlos de ningún sitio: el
 * recuento no cuadraría y a esa gente habría que ir a buscarla sin saber que
 * falta. Se enseña lo que hay, se ofrece lo que se pregunta.
 */
const mostradas = (evento) => {
  const dadas = new Set((evento.responses ?? []).map((r) => r.answer));
  return RESPUESTAS.filter(
    (r) => respuestasDe(evento.kind).includes(r.answer) || dadas.has(r.answer),
  );
};

/**
 * El marcador de una fila de /agenda.
 *
 * El «tal vez» se calla en las guerras, que ya no lo preguntan, salvo que
 * alguien lo tenga contestado de antes: un cero permanente en una columna que
 * no existe se lee como si nadie dudara.
 */
const recuento = (e) => {
  const partes = [`✅ ${e.yes}`];
  if (respuestasDe(e.kind).includes('maybe') || e.maybe > 0) partes.push(`❔ ${e.maybe}`);
  partes.push(`✖ ${e.no}`);
  return partes.join(' · ');
};

const marca = (iso, formato) => `<t:${Math.floor(new Date(iso).getTime() / 1000)}:${formato}>`;

/**
 * Un evento como mensaje de Discord: lo que se lee y lo que se pulsa.
 *
 * La hora va como marca de Discord y no escrita, y eso resuelve solo lo que en
 * la web costó una tarjeta de aviso: cada uno la ve en su reloj, sin que la
 * aplicación tenga que saber dónde vive nadie ni escribir «hora de Colombia».
 *
 * Función pura, como las otras dos: se puede mirar sin un Discord delante.
 */
export function eventoMensaje(evento) {
  const tipo = EVENTO_TIPOS[evento.kind] ?? EVENTO_TIPOS.casual;
  const cerrada =
    Boolean(evento.cancelledAt) ||
    Boolean(evento.closesAt && new Date() > new Date(evento.closesAt));

  const cabecera = [
    `${marca(evento.startsAt, 'F')}  ·  ${marca(evento.startsAt, 'R')}`,
    // `<@&id>` lo pinta Discord con el nombre y el color de ahora, así que un
    // rol renombrado no deja atrás una encuesta que dice otra cosa. No avisa a
    // nadie: el mensaje va con allowed_mentions vacío.
    evento.allowedRoles?.length
      ? `Abierta a: ${evento.allowedRoles.map((r) => `<@&${r}>`).join(' ')}`
      : null,
    evento.notes ? literal(evento.notes) : null,
    evento.cancelledAt
      ? '**Cancelado.**'
      : evento.closesAt
        ? `Se puede contestar hasta ${marca(evento.closesAt, 'f')}.`
        : null,
  ].filter(Boolean);

  const de = (answer) => (evento.responses ?? []).filter((r) => r.answer === answer);

  const fields = mostradas(evento).map(({ answer, label, emoji }) => {
    const suyos = de(answer);
    return {
      name: `${emoji} ${label} · ${suyos.length}`,
      value: suyos.length
        ? suyos.map((r) => literal(r.name)).join(' · ').slice(0, 1024)
        : '—',
      inline: false,
    };
  });

  const embed = {
    author: { name: tipo.label },
    title: `${tipo.emoji}  ${literal(evento.title)}`,
    description: cabecera.join('\n'),
    color: evento.cancelledAt ? 0x74251a : LATON,
    fields,
    footer: { text: 'Contesta aquí o en la web; es la misma lista.' },
  };

  // Cerrada o cancelada, el mensaje se queda sin nada que pulsar: enseñar un
  // botón que va a contestar «ya está cerrada» es ofrecer algo que no existe.
  if (cerrada) return { embeds: [embed], components: [] };

  // Dos botones en las guerras y tres en lo demás. Los ofrecidos, no los
  // enseñados: un mensaje viejo puede estar pintando una lista de «tal vez»
  // que ya no se puede contestar, y eso es correcto -- enseña lo que hay.
  const components = [
    {
      type: 1,
      components: ofrecidas(evento).map(({ answer, label, emoji }) => ({
        type: 2,
        style: answer === 'yes' ? 3 : answer === 'no' ? 4 : 2,
        label,
        emoji: { name: emoji },
        custom_id: `evento:${evento.id}:${answer}`,
      })),
    },
  ];

  return { embeds: [embed], components };
}

/**
 * Lo que se manda a Discord.
 *
 * Una convocatoria acotada avisa a los roles a los que va, y sólo a ellos: la
 * mención va en el `content` porque dentro de un embed no notifica a nadie, y
 * `allowed_mentions.roles` es la lista blanca -- lo que no esté ahí se pinta
 * pero no suena, así que un `@` escrito en el título de un evento no puede
 * convertirse en un aviso a todo el servidor.
 *
 * Sin acotar no avisa a nadie, como hasta ahora. Convocar al gremio entero es
 * lo normal y hacerlo sonar en el teléfono de cincuenta personas cada lunes es
 * exactamente el ruido que se quería quitar; para eso está el recordatorio, que
 * llega cuando queda poco y sólo a quien no ha contestado.
 *
 * Editar un mensaje no notifica aunque lleve menciones, así que refrescar el
 * recuento no vuelve a sonar. Volver a publicar sí, y está bien que sí: es un
 * mensaje nuevo que alguien mandó a propósito.
 */
const cuerpoDe = (evento) => {
  const roles = evento.allowedRoles ?? [];
  return {
    ...eventoMensaje(evento),
    ...(roles.length ? { content: roles.map((r) => `<@&${r}>`).join(' ') } : {}),
    allowed_mentions: { parse: [], roles: roles.slice(0, 100) },
  };
};

/**
 * Publica la encuesta de un evento, o la vuelve a publicar.
 *
 * Volver a publicar no toca ni una respuesta: los votos nunca estuvieron en
 * Discord, están en la base de datos contra el miembro, y el mensaje es sólo
 * cómo se ven. Por eso se puede rehacer tantas veces como haga falta -- alguien
 * borró el mensaje, se cambió el canal, el canal desapareció -- y el recuento
 * sale igual que estaba.
 *
 * Se publica primero y se retira el anterior después, en ese orden y no al
 * revés: si Discord rechaza el mensaje nuevo, el viejo sigue en pie. Y se
 * retira porque si no, un cambio de canal deja dos encuestas del mismo evento,
 * y la de antes no se va a actualizar nunca más.
 *
 * Devuelve null si no hay dónde publicar; lanza si Discord rechaza el envío,
 * que es lo que hay que contarle a quien pulsó el botón.
 */
export async function publicarEvento(id) {
  if (!botEnabled()) return null;

  // El evento primero: el canal depende de su tipo, que es lo que permite que
  // las guerras vayan a #guerras y el PvE a #pve.
  const evento = await getEvent(id);
  const canal = await getAgendaChannel(evento.kind);
  if (!canal) return null;
  const mensaje = await postMessage(canal, cuerpoDe(evento));
  await setDiscordMessage(id, mensaje.channelId, mensaje.id);

  if (evento.discordChannelId && evento.discordMessageId) {
    // Sin esperar y sin que importe si se pudo: el mensaje nuevo ya está, y
    // dejar el viejo es peor que no poder borrarlo.
    void deleteMessage(evento.discordChannelId, evento.discordMessageId);
  }
  return mensaje;
}

/**
 * Retira la encuesta de un evento que deja de existir.
 *
 * Borrar el evento y dejar su mensaje en el canal deja una encuesta huérfana:
 * sigue teniendo botones, y quien los pulse recibe «no existe ese evento». Se
 * llama antes de borrar, porque después ya no hay de dónde sacar dónde estaba.
 *
 * No lanza ni espera veredicto: el evento se va igual, y un mensaje que no se
 * pudo quitar es un resto, no un fallo del borrado.
 */
export async function retirarEvento(evento) {
  if (!botEnabled() || !evento?.discordChannelId || !evento?.discordMessageId) return;
  await deleteMessage(evento.discordChannelId, evento.discordMessageId).catch(() => null);
}

/**
 * Pone al día el mensaje ya publicado.
 *
 * Se llama después de cada respuesta venga de donde venga, y por eso no lanza:
 * que Discord esté caído no puede tumbar el guardado de una respuesta que la
 * base de datos ya aceptó. Lo peor que pasa es que el mensaje quede viejo, y
 * eso se arregla volviendo a publicar.
 */
export async function refrescarEvento(id) {
  if (!botEnabled()) return;
  try {
    const evento = await getEvent(id);
    if (!evento.discordChannelId || !evento.discordMessageId) return;
    const salida = await editMessage(
      evento.discordChannelId,
      evento.discordMessageId,
      cuerpoDe(evento),
    );
    // Borrado desde Discord: se olvida dónde estaba, para que publicar otra vez
    // no intente escribir sobre un mensaje que ya no existe.
    if (salida.gone) await setDiscordMessage(id, null, null);
  } catch (err) {
    console.error(`No se pudo refrescar el evento ${id} en Discord:`, err.message);
  }
}

/**
 * Cuánto se espera antes de volver a dibujar una encuesta que sigue recibiendo
 * votos. Bastante para que una convocatoria de guerra entera quepa en unas
 * pocas ediciones, poco para que en un canal tranquilo el recuento parezca
 * instantáneo.
 */
const VENTANA_REPINTADO = 3000;

/** Los eventos que se están repintando ahora mismo, y si les han llovido votos. */
const repintando = new Map();

const espera = (ms) => new Promise((listo) => setTimeout(listo, ms));

/**
 * Vuelve a dibujar la encuesta, agrupando la avalancha.
 *
 * Cada voto reescribía el mensaje entero. Con veinte personas eso pasa
 * desapercibido; con cien pulsando «voy» en el minuto siguiente a la
 * convocatoria son cien ediciones del mismo mensaje, y trae dos problemas que no
 * se ven hasta que el gremio crece. Discord limita las ediciones y la cola se
 * arrastra. Y peor: cada voto leía el recuento justo después del suyo, así que
 * **la última edición que aterrizaba era la que mandaba, no la más reciente** --
 * la encuesta podía quedarse enseñando 97 con 100 votos ya guardados.
 *
 * Se dibuja al primer voto y no al último a propósito: en un canal tranquilo,
 * que es lo normal, quien pulsa ve su voto en el acto. Lo que llegue mientras
 * tanto se junta en un solo repintado al cerrar la ventana, y ese lee el total
 * de verdad, así que el número final siempre es el bueno.
 *
 * No espera ni lanza: el voto ya está guardado y es lo que importa. Dibujarlo es
 * cosmética, y la cosmética no tumba una respuesta que la base de datos aceptó.
 */
export function repintarEvento(id) {
  const abierto = repintando.get(id);
  if (abierto) {
    // Ya hay un ciclo dibujando lo de este evento; que cuente uno más.
    abierto.pendiente = true;
    return;
  }
  repintando.set(id, { pendiente: false });
  void (async () => {
    try {
      for (;;) {
        await refrescarEvento(id);
        await espera(VENTANA_REPINTADO);
        // Sin `await` entre mirar y borrar: nada puede colarse en medio, así
        // que un voto o entra en esta vuelta o abre un ciclo nuevo. Nunca se
        // pierde entre las dos cosas.
        if (!repintando.get(id)?.pendiente) break;
        repintando.set(id, { pendiente: false });
      }
    } finally {
      repintando.delete(id);
    }
  })();
}

/**
 * El recordatorio a quien no ha contestado.
 *
 * Es el mensaje del bot que menciona a personas una por una. La encuesta avisa
 * a los roles y esto avisa a los nombres, y por eso este es el que hay que
 * apuntar bien: una lista de nombres sin notificación no la lee justo quien
 * tenía que leerla, y una notificación a quien no podía contestar es la clase
 * de ruido que hace que se dejen de leer todas.
 *
 * De ahí el filtro: si la convocatoria está acotada, no se persigue a quien no
 * lleva ninguno de sus roles. Ni siquiera para nombrarlo -- no ha contestado
 * porque no puede, y decirle a quien organiza que le pregunte por voz sería
 * mandarle a pedir algo que el propio sitio no acepta.
 *
 * Los roles se preguntan de uno en uno y sólo cuando hay lista. Es una ráfaga
 * de peticiones a Discord, pero pasa una vez por evento y no una vez por voto,
 * y `memberRoles` guarda un minuto lo que va leyendo.
 *
 * Devuelve a cuántos avisó, o null si no había a quién.
 */
export async function avisarPendientes(id) {
  if (!botEnabled()) return null;
  const evento = await getEvent(id);
  if (!evento.discordChannelId) return null;

  let faltan = await sinContestar(id);
  if (!faltan.length) return null;

  if (evento.allowedRoles?.length) {
    const invitados = [];
    for (const p of faltan) {
      if (!p.discordId) continue;
      if (puedeContestar(evento.allowedRoles, await memberRoles(p.discordId))) invitados.push(p);
    }
    faltan = invitados;
    if (!faltan.length) return null;
  }

  const conDiscord = faltan.filter((p) => p.discordId);
  const sinDiscord = faltan.filter((p) => !p.discordId);

  // Por privado: uno a uno, y con los botones puestos, que es la diferencia
  // entre avisar y dejar contestar. Quien lo reciba puede resolverlo ahí mismo
  // sin ir a buscar el canal.
  if (evento.reminderMode === 'dm') {
    let llegaron = 0;
    for (const p of conDiscord) {
      const ok = await sendDirectMessage(p.discordId, {
        content: cuandoCierra(evento),
        ...eventoMensaje(evento),
        allowed_mentions: { parse: [] },
      });
      if (ok) llegaron++;
    }
    await marcarAvisado(id);
    // Quien no tiene Discord no cuenta: por privado no se le puede escribir, y
    // decir que se avisó a alguien a quien no se avisó es peor que no avisar.
    return llegaron;
  }

  const lineas = [
    cuandoCierra(evento),
    conDiscord.length ? conDiscord.map((p) => `<@${p.discordId}>`).join(' ') : null,
    // A quien no tiene Discord vinculado se le nombra igual, para que quien
    // organiza sepa a quién le toca preguntar por voz.
    sinDiscord.length
      ? `Sin Discord vinculado: ${sinDiscord.map((p) => literal(p.name)).join(' · ')}`
      : null,
  ].filter(Boolean);

  await postMessage(evento.discordChannelId, {
    content: lineas.join('\n'),
    allowed_mentions: { users: conDiscord.map((p) => p.discordId).slice(0, 100) },
  });
  await marcarAvisado(id);
  return faltan.length;
}

/**
 * La primera línea de un recordatorio: qué es y cuánto queda.
 *
 * Sin fecha de cierre se dice cuándo empieza. Es el caso de un recordatorio
 * repetido, que existe justamente para las encuestas que siguen abiertas hasta
 * el final: decir «se cierra en null» sería peor que no decir nada.
 */
const cuandoCierra = (evento) =>
  evento.closesAt
    ? `⏳  **${literal(evento.title)}** — la encuesta se cierra ${marca(evento.closesAt, 'R')}.`
    : `⏳  **${literal(evento.title)}** — es ${marca(evento.startsAt, 'R')} y no has contestado.`;

/**
 * El reloj de la agenda.
 *
 * Tres cosas, en orden: crear lo que falta de las series, publicar lo que ya
 * toca, y recordar lo que está a punto de cerrarse. Cada una es idempotente por
 * su cuenta -- un índice único, una columna de mensaje, una de aviso -- así que
 * pasar de más no hace daño y perderse un turno tampoco: al siguiente se pone
 * al día.
 *
 * Cada cinco minutos y no cada cinco segundos como el cuerno: aquí lo que se
 * mide son días, y una encuesta que sale cinco minutos tarde un lunes no la
 * nota nadie.
 */
async function tickAgenda() {
  await asegurarEventos();
  if (!botEnabled()) return;

  for (const id of await pendientesDePublicar()) {
    await publicarEvento(id);
  }
  for (const id of await pendientesDeAviso()) {
    await avisarPendientes(id).catch((err) =>
      console.error(`[agenda] no se pudo avisar del evento ${id}:`, err.message),
    );
    // Aunque avisar falle se marca, para no repetir el intento cada cinco
    // minutos hasta que cierre: un canal lleno de recordatorios rotos es peor
    // que un recordatorio perdido.
    await marcarAvisado(id);
  }
}

export function startAgendaScheduler() {
  const correr = () =>
    tickAgenda().catch((err) => console.error('[agenda] tick falló:', err.message));
  void correr();
  setInterval(correr, 5 * 60 * 1000);
}

/**
 * Contestar desde un botón o desde el desplegable.
 *
 * El mismo camino que la web: se resuelve quién es por su Discord vinculado, se
 * escribe en la misma fila, y el mensaje se reescribe con el recuento nuevo. La
 * ventana de la encuesta la sigue comprobando el modelo, no esto.
 */
async function botonEvento(interaction) {
  const [, eventId, respuestaDelBoton] = String(interaction.data?.custom_id ?? '').split(':');
  const usuario = interaction.member?.user ?? interaction.user;

  const quien = usuario?.id ? await cuentaDe(usuario.id) : null;
  const negativa = vetado(quien);
  if (negativa) return negativa;

  if (!quien.playerId) {
    return aviso('Tu cuenta todavía no está unida a una ficha del roster. Avisa a un líder.');
  }

  // La respuesta viene en el id del botón. Los mensajes publicados antes de
  // quitar las partidas traían un desplegable con valores «yes:3»: se acepta
  // igual, quedándose con lo de delante, para que una encuesta ya publicada
  // siga contestándose en vez de romperse.
  const elegido = interaction.data?.values?.[0] ?? respuestaDelBoton ?? '';
  const [answer] = String(elegido).split(':');

  try {
    // En un canal los roles vienen en la propia interacción, ya puestos por
    // Discord. En un privado no hay `member`, así que hay que ir a buscarlos --
    // y va como función para que sólo se pregunte si la convocatoria acota algo.
    await respond(eventId, quien.playerId, { answer }, {
      source: 'discord',
      misRoles: interaction.member?.roles ?? (() => memberRoles(usuario.id)),
    });
  } catch (err) {
    return aviso(err.message);
  }

  // El voto ya está escrito; el mensaje lo redibuja el ciclo agrupado, que sabe
  // esperar a los que vienen detrás. Aquí no se devuelve nada que reescribir
  // porque el acuse de un componente ya cierra la interacción por sí solo: quien
  // pulsó no ve ningún «cargando» colgado.
  repintarEvento(eventId);
  return SILENCIO;
}

/**
 * `/agenda` -- lo que viene y qué contestaste.
 *
 * Existe porque el mensaje de la encuesta se entierra: en un canal con
 * conversación, el del lunes no se encuentra el viernes. Esto lo trae de vuelta
 * sin buscarlo, y en privado, que es donde uno mira sus cosas.
 */
async function comandoAgenda(interaction) {
  const usuario = interaction.member?.user ?? interaction.user;
  const quien = usuario?.id ? await cuentaDe(usuario.id) : null;
  const negativa = vetado(quien);
  if (negativa) return negativa;

  // Una consulta y no una por evento: diez eventos eran veintiuna idas y
  // vueltas a la base de datos para leer diez respuestas propias, y esto tiene
  // tres segundos antes de que Discord dé el comando por perdido.
  //
  // Sólo lo publicado: aquí se lee lo que el gremio ya ha visto en su canal. Lo
  // que está escrito pero sin convocar se queda en la web, donde la ficha dice
  // que no se ha publicado y quien la mira es quien la está preparando.
  const eventos = quien.playerId
    ? await myEvents(quien.playerId, { conCancelados: true, soloPublicados: true })
    : [];
  if (!eventos.length) return aviso('No hay nada convocado por delante.');

  const embed = {
    author: { name: process.env.GUILD_NAME || 'Zona Zero' },
    title: '🗓  Lo que viene',
    color: LATON,
    fields: eventos.slice(0, 10).map((e) => {
      const tipo = EVENTO_TIPOS[e.kind] ?? EVENTO_TIPOS.casual;
      const tuya = e.mine
        ? `**${RESPUESTA(e.mine.answer)?.label ?? e.mine.answer}**`
        : '*sin contestar*';
      // El enlace a la encuesta, cuando está publicada: es lo que convierte
      // esta lista en un sitio desde el que se puede contestar, y no sólo
      // enterarse. El mensaje del lunes no se encuentra el viernes.
      const donde = e.discordUrl ? `  ·  [ir a la encuesta](${e.discordUrl})` : '';
      return {
        name: `${tipo.emoji}  ${literal(e.title)}${e.cancelledAt ? '  ·  CANCELADO' : ''}`,
        value: `${marca(e.startsAt, 'F')}\n${recuento(e)}  —  tú: ${tuya}${donde}`,
        inline: false,
      };
    }),
    footer: { text: 'Contesta en la encuesta del canal o en la web; es la misma lista.' },
  };

  return { type: MESSAGE, data: { embeds: [embed], flags: EPHEMERAL } };
}

/* ---------------------------------------------------------------- comandos */

/** Un aviso corto, siempre sólo para quien escribió el comando. */
const aviso = (texto) => ({ type: MESSAGE, data: { content: texto, flags: EPHEMERAL } });

/**
 * «Acusado, y no hay nada que reescribir.»
 *
 * Un componente se acusa con «voy a reescribir este mensaje», y Discord da eso
 * por cerrado aunque nunca llegue la reescritura: quien pulsó no se queda con un
 * «cargando» eterno. Es lo que permite que un voto conteste al instante y el
 * dibujo vaya por su cuenta, agrupado con los demás.
 */
const SILENCIO = { silencio: true };

/** La foto de Discord de quien pregunta, para la esquina del embed. */
function avatarDe(usuario) {
  if (!usuario?.id || !usuario.avatar) return null;
  const ext = usuario.avatar.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${usuario.id}/${usuario.avatar}.${ext}?size=128`;
}

/** Las columnas de la ficha que pinta el embed, siempre las mismas. */
const FICHA = `p.id AS "playerId", p.name, p.role, p.level, p.sect,
               p.is_starter AS "isStarter", p.war_side AS "warSide",
               COALESCE(p.is_active, true) AS "isActive"`;

/**
 * La cuenta del gremio de un Discord, con su ficha si tiene una unida.
 *
 * `u.role` sale como «cuentaRol» y no como «role» a propósito, y es el mismo
 * cuidado que se toma en `war.js` con los nombres: una cuenta tiene un rol
 * -- oficial, miembro -- y una ficha tiene otro -- tanque, sanador --, se
 * llaman igual, y el driver se queda con la última que llegue. Escritos los
 * dos como `role`, el permiso se acaba consultando contra «Healer».
 */
async function cuentaDe(discordId) {
  const { rows } = await pool.query(
    `SELECT u.role AS "cuentaRol", ${FICHA}
       FROM users u
       LEFT JOIN players p ON p.guild_id = u.guild_id AND p.id = u.player_id
      WHERE u.guild_id = $1 AND u.discord_id = $2 AND u.disabled = false`,
    [GUILD_ID, discordId],
  );
  return rows[0] ?? null;
}

/**
 * La negativa que le toca a quien pregunta, o null si puede seguir.
 *
 * Son las dos formas de no ser del gremio, y hacen falta las dos: no tener
 * cuenta, y tenerla sobre una ficha dada de baja. Lo segundo no lo miraba
 * nadie -- quien se iba del gremio conservaba el bot hasta que a alguien se le
 * ocurría deshabilitarle la cuenta a mano, que es un paso que no se da.
 *
 * Se comprueba la ficha y no la cuenta a propósito: dar de baja a alguien en el
 * roster es el gesto que ya se hace cuando alguien se va, y colgar de él el
 * acceso al bot evita inventar un segundo interruptor que se olvidaría de
 * pulsar. Una cuenta sin ficha -- un administrador que no juega -- no se toca:
 * nunca estuvo en el roster, así que no hay baja que leer.
 *
 * Esto vale sólo para **quien pregunta**. Mirar la ficha de un ex-miembro sigue
 * pudiéndose: irse del gremio te quita la voz, no te borra del historial.
 */
function vetado(quien) {
  if (!quien) {
    return aviso(
      'Tu Discord no está vinculado a ninguna cuenta del gremio. Entra en la web con el botón de Discord y pide tu registro; un líder lo aprueba.',
    );
  }
  if (quien.playerId && !quien.isActive) {
    return aviso(
      'Tu ficha del roster está dada de baja, así que el bot ya no atiende tus comandos. Si es un error, avisa a un líder.',
    );
  }
  return null;
}

/**
 * La ficha de alguien nombrado por el buscador.
 *
 * El autocompletado manda el id, pero nadie obliga a elegir de la lista: se
 * puede escribir un nombre a mano y enviar. Por eso se prueban las dos cosas,
 * y el nombre se compara sin distinguir mayúsculas.
 */
async function fichaPorTexto(texto) {
  const { rows } = await pool.query(
    `SELECT ${FICHA} FROM players p
      WHERE p.guild_id = $1 AND (p.id = $2 OR lower(p.name) = lower($2))
      LIMIT 1`,
    [GUILD_ID, texto],
  );
  return rows[0] ?? null;
}

/** Lo que hace falta para pintar a alguien, en una sola espera. */
function datosDe(playerId) {
  return Promise.all([
    pool
      .query(
        `SELECT scanned_at AS "scannedAt", ${SCAN_FIELDS.join(', ')}
           FROM player_scans WHERE guild_id = $1 AND player_id = $2
          ORDER BY scanned_at DESC LIMIT 2`,
        [GUILD_ID, playerId],
      )
      .then((r) => r.rows),
    listBuilds(playerId),
    listWeaponSets(),
  ]);
}

const opcion = (interaction, nombre) =>
  interaction.data?.options?.find((o) => o.name === nombre)?.value;

/**
 * `/perfil` -- las estadísticas de quien lo escribe, o las de otro.
 *
 * Quién pregunta se resuelve siempre por el Discord con el que ya está
 * vinculada su cuenta; no hay otra forma de entrar. Mirar la ficha de otro es
 * lo mismo que abrir el roster en la web, así que pide el mismo permiso que la
 * web -- `roster.view` -- y no uno nuevo: un permiso que sólo existe en
 * Discord sería una regla más que mantener y otra que se puede contradecir.
 * La propia ficha no lo pide, igual que en la web nadie necesita permiso para
 * verse a sí mismo.
 */
async function comandoPerfil(interaction) {
  const usuario = interaction.member?.user ?? interaction.user;
  if (!usuario?.id) return aviso('No he podido saber quién eres. Inténtalo otra vez.');

  const quienPregunta = await cuentaDe(usuario.id);
  const negativa = vetado(quienPregunta);
  if (negativa) return negativa;

  const mencionado = opcion(interaction, 'miembro');
  const escrito = opcion(interaction, 'nombre');
  if (mencionado && escrito) {
    return aviso('Elige una de las dos: o `miembro`, o `nombre`.');
  }

  // A quién se pide, y de paso su foto de Discord cuando la interacción la
  // trae -- que es sólo en el caso de la mención.
  let ficha = quienPregunta;
  let avatar = avatarDe(usuario);

  if (mencionado) {
    const suya = await cuentaDe(mencionado);
    if (!suya?.playerId) {
      return aviso(
        'Ese miembro no tiene su Discord vinculado a una ficha del roster. Búscalo por nombre con la opción `nombre`.',
      );
    }
    ficha = suya;
    avatar = avatarDe(interaction.data?.resolved?.users?.[mencionado]);
  } else if (escrito) {
    const suya = await fichaPorTexto(String(escrito));
    if (!suya) return aviso(`No encuentro a nadie llamado «${escrito}» en el roster.`);
    ficha = suya;
    avatar = null;
  }

  const esOtro = ficha.playerId !== quienPregunta.playerId;
  if (esOtro) {
    const permisos = await permissionsFor(quienPregunta.cuentaRol);
    if (!permisos.includes('roster.view')) {
      return aviso('Tu cuenta no tiene permiso para ver el roster, así que sólo puedes mirar la tuya.');
    }
  } else if (!ficha.playerId || !ficha.name) {
    return aviso('Tu cuenta todavía no está unida a una ficha del roster. Avisa a un líder.');
  }

  const [scans, builds, weaponSets] = await datosDe(ficha.playerId);

  return {
    type: MESSAGE,
    data: {
      embeds: [
        perfilEmbed({
          player: ficha,
          scans,
          builds,
          weaponSets,
          avatarUrl: avatar,
          guildName: process.env.GUILD_NAME || 'Zona Zero',
          ajeno: esOtro,
        }),
      ],
      ...(opcion(interaction, 'publico') === true ? {} : { flags: EPHEMERAL }),
    },
  };
}

/**
 * `/build` -- la tuya, y sólo la tuya.
 *
 * No lleva opción para mirar la de otro a propósito, aunque `/perfil` sí la
 * tenga: esto no es una consulta sino un sitio donde se cambia algo, y mezclar
 * las dos cosas obliga a decidir en cada pulsación de quién era el desplegable.
 * Lo que lleva otro se sigue viendo en su ficha.
 *
 * Nadie necesita permiso para esto. Es la misma regla que en la web -- quien
 * está unido a su ficha puede escribir sus builds sin que le eleven nada --, y
 * tenerla escrita dos veces sería tener una que se contradice.
 */
async function comandoBuild(interaction) {
  const usuario = interaction.member?.user ?? interaction.user;
  if (!usuario?.id) return aviso('No he podido saber quién eres. Inténtalo otra vez.');

  const quien = await cuentaDe(usuario.id);
  const negativa = vetado(quien);
  if (negativa) return negativa;
  if (!quien.playerId) {
    return aviso('Tu cuenta todavía no está unida a una ficha del roster. Avisa a un líder.');
  }

  const publico = opcion(interaction, 'publico') === true;
  const [builds, weaponSets] = await Promise.all([listBuilds(quien.playerId), listWeaponSets()]);

  return {
    type: MESSAGE,
    data: {
      ...buildVista({
        player: quien,
        builds,
        weaponSets,
        editable: !publico,
        guildName: process.env.GUILD_NAME,
      }),
      // El nombre de una build lo escribe su dueño, así que un «@everyone» ahí
      // dentro avisaría al servidor entero desde un comando de consulta.
      allowed_mentions: { parse: [] },
      ...(publico ? {} : { flags: EPHEMERAL }),
    },
  };
}

/**
 * Los desplegables de `/build`.
 *
 * Quien manda es quien pulsa, no quien escribió el comando, y por eso se vuelve
 * a resolver la cuenta aquí en vez de fiarse del mensaje: cada quien se cambia
 * lo suyo, pulse donde pulse.
 *
 * Se guarda la lista entera y no el cambio suelto porque `saveBuilds` es lo que
 * mantiene la regla de que hay exactamente una principal -- escribirlo por
 * partes dejaría un instante con dos, o con ninguna -- y es además lo que
 * arrastra el papel de la principal a la ficha del roster, que es de donde la
 * Sala de Guerra saca el equilibrio de las líneas.
 */
async function menuBuild(interaction) {
  const usuario = interaction.member?.user ?? interaction.user;
  const quien = usuario?.id ? await cuentaDe(usuario.id) : null;
  const negativa = vetado(quien);
  if (negativa) return negativa;
  if (!quien.playerId) {
    return aviso('Tu cuenta todavía no está unida a una ficha del roster. Avisa a un líder.');
  }

  const builds = await listBuilds(quien.playerId);
  if (!builds.length) {
    return aviso('No tienes ninguna build que cambiar. La primera se crea en la web, en Mi perfil.');
  }

  const [, qué] = String(interaction.data?.custom_id ?? '').split(':');
  const elegido = interaction.data?.values ?? [];
  let siguientes;

  if (qué === 'principal') {
    // Pudo borrarse desde la web con el mensaje abierto. Se dice y no se
    // guarda nada: mejor que elegir otra por su cuenta.
    if (!builds.some((b) => b.id === elegido[0])) {
      return aviso('Esa build ya no existe. Vuelve a escribir `/build` para ver las que tienes.');
    }
    siguientes = builds.map((b) => ({ ...b, isPrimary: b.id === elegido[0] }));
  } else if (qué === 'papel') {
    const papeles = elegido.filter((v) => PAPELES.some((p) => p.value === v));
    if (!papeles.length) return aviso('Elige al menos un papel.');
    const principal = builds.find((b) => b.isPrimary) ?? builds[0];
    siguientes = builds.map((b) => (b === principal ? { ...b, roles: papeles } : b));
  } else if (qué === 'armas') {
    // Contra el catálogo y no contra lo que llegue: el valor lo manda el
    // cliente, y un arma inventada quedaría guardada como si existiera.
    const catalogo = new Set((await listWeaponSets()).flatMap((c) => c.weapons ?? []));
    const armas = elegido.filter((a) => catalogo.has(a)).slice(0, MAX_WEAPONS);
    if (!armas.length) {
      return aviso('No reconozco esas armas. Vuelve a escribir `/build` para ver la lista al día.');
    }
    const principal = builds.find((b) => b.isPrimary) ?? builds[0];
    siguientes = builds.map((b) => (b === principal ? { ...b, weapons: armas } : b));
  } else {
    return aviso('Ese desplegable es de una versión anterior del bot. Vuelve a escribir `/build`.');
  }

  await saveBuilds(quien.playerId, siguientes);

  // Se relee en vez de dibujar lo que se acaba de mandar: `saveBuilds` decide
  // cuál queda de principal si la lista no lo dejaba claro, y el mensaje tiene
  // que enseñar lo que quedó guardado, no lo que se pidió.
  const [frescas, weaponSets] = await Promise.all([listBuilds(quien.playerId), listWeaponSets()]);

  return {
    type: UPDATE_MESSAGE,
    data: {
      ...buildVista({
        player: quien,
        builds: frescas,
        weaponSets,
        guildName: process.env.GUILD_NAME,
      }),
      allowed_mentions: { parse: [] },
    },
  };
}

/**
 * El tablero, contestado igual lo pida un comando o el botón de actualizar.
 *
 * `tipo` es lo único que cambia entre los dos: un comando manda un mensaje
 * nuevo y el botón reescribe el que ya está. Todo lo demás -- quién puede
 * verlo, qué se consulta, cómo se pinta -- es el mismo camino, que es la razón
 * de que esto sea una función y no dos parecidas.
 *
 * Pide `war.view`, el permiso que abre la Sala de Guerra en la web, por la
 * misma razón que `/perfil` pide `roster.view`: la regla ya existe y tener dos
 * es tener una que se contradice.
 */
async function respuestaGuerra({ usuario, bando, linea, publico, tipo }) {
  if (!usuario?.id) return aviso('No he podido saber quién eres. Inténtalo otra vez.');

  const quienPregunta = await cuentaDe(usuario.id);
  const negativa = vetado(quienPregunta);
  if (negativa) return negativa;

  const permisos = await permissionsFor(quienPregunta.cuentaRol);
  if (!permisos.includes('war.view')) {
    return aviso('Tu cuenta no tiene permiso para ver la Sala de Guerra.');
  }

  const [tablero, despliegues, estrategias] = await Promise.all([
    getBoard(),
    pool
      .query(
        // Un miembro dado de baja que siga en el tablero se enseña igual: es
        // un hueco que hay que ver, no una fila que esconder.
        //
        // El Discord llega por subconsulta y no por JOIN a propósito: nada
        // impide que dos cuentas apunten a la misma ficha -- no hay índice
        // único que lo prohíba -- y un JOIN pondría a esa persona dos veces en
        // su línea. Una subconsulta escalar devuelve uno o ninguno, nunca dos.
        `SELECT d.side, d.lane, d.unit_ids AS "unitIds",
                d.is_lane_leader AS "isLaneLeader", p.name, p.role,
                (SELECT u.discord_id FROM users u
                  WHERE u.guild_id = d.guild_id AND u.player_id = d.player_id
                    AND u.disabled = false AND u.discord_id IS NOT NULL
                  ORDER BY u.created_at LIMIT 1) AS "discordId"
           FROM war_deployments d
           JOIN players p ON p.guild_id = d.guild_id AND p.id = d.player_id
          WHERE d.guild_id = $1
          ORDER BY d.side, d.lane, d.position`,
        [GUILD_ID],
      )
      .then((r) => r.rows),
    listStrategies(),
  ]);

  // Las unidades viven dentro de una estrategia, y cada bando tiene la suya en
  // vigor. Sin plan activo no hay unidades que enseñar, que es distinto de que
  // no haya nadie asignado a ninguna.
  const unidades = Object.fromEntries(
    SIDES.map((side) => [
      side,
      estrategias.find((s) => s.id === tablero.active?.[side])?.units ?? [],
    ]),
  );

  const { content, embeds, components } = tableroDeGuerra({
    despliegues,
    guerra: tablero.current,
    locked: tablero.locked,
    bando,
    linea,
    unidades,
  });

  return {
    type: tipo,
    data: {
      content,
      embeds,
      components,
      // El nombre de la guerra lo escribe una persona, y sin esto un «@everyone»
      // ahí dentro avisaría al servidor entero desde un comando de consulta.
      // Y las menciones de los desplegados tampoco avisan a nadie.
      allowed_mentions: { parse: [] },
      // Al reescribir un mensaje no se toca su visibilidad: ya nació público o
      // privado, y mandar el flag otra vez sólo puede contradecirlo.
      ...(tipo === UPDATE_MESSAGE || publico ? {} : { flags: EPHEMERAL }),
    },
  };
}

/** `/guerra [bando] [linea]` -- el tablero, entero o por la rendija que se pida. */
function comandoGuerra(interaction) {
  return respuestaGuerra({
    usuario: interaction.member?.user ?? interaction.user,
    bando: opcion(interaction, 'bando') ?? null,
    linea: opcion(interaction, 'linea') ?? null,
    publico: opcion(interaction, 'publico') === true,
    tipo: MESSAGE,
  });
}

/**
 * El botón de actualizar.
 *
 * Vuelve a preguntar por el tablero y reescribe el mensaje donde está. El
 * permiso se comprueba otra vez y no se da por hecho: un mensaje público lo
 * puede pulsar cualquiera del servidor, incluido quien no tenga cuenta.
 */
function botonGuerra(interaction) {
  const [, bando, linea] = String(interaction.data?.custom_id ?? '').split(':');
  return respuestaGuerra({
    usuario: interaction.member?.user ?? interaction.user,
    // Un filtro que ya no existe -- porque se renombró una línea o se tocó el
    // botón de un mensaje viejo -- se deja caer en vez de no enseñar nada.
    bando: SIDES.includes(bando) ? bando : null,
    linea: LANE_INFO.some((l) => l.id === linea) ? linea : null,
    tipo: UPDATE_MESSAGE,
  });
}

/**
 * La lista que Discord ofrece mientras se escribe en `nombre`.
 *
 * Devuelve el id como valor y el nombre como etiqueta, así que elegir de la
 * lista no depende de escribir el nombre igual que está guardado. Y pide el
 * mismo permiso que enseñar la ficha: si no, el buscador sería una forma de
 * leer el roster entero sin tenerlo.
 */
async function autocompletarNombre(interaction) {
  const vacio = { type: CHOICES, data: { choices: [] } };
  const usuario = interaction.member?.user ?? interaction.user;
  if (!usuario?.id) return vacio;

  const escrito = String(
    interaction.data?.options?.find((o) => o.focused)?.value ?? '',
  ).trim();

  // Una consulta y no tres, y aquí importa más que en ningún otro sitio: el
  // autocompletado se dispara **por cada tecla** que se escribe, no una vez por
  // comando. Eran tres idas y vueltas por letra -- quién pregunta, qué permisos
  // tiene su rol, y la búsqueda -- así que escribir un nombre entre dos
  // personas ocupaba el pool y lo que llegaba después esperaba más de los tres
  // segundos que Discord concede. Y esto es lo único que no se puede diferir:
  // las opciones tienen que estar dentro de ese plazo o no hay lista.
  //
  // El permiso se comprueba contra `role_permissions` en vez de con
  // `permissionsFor`. Vale sólo porque `roster.view` no está entre los permisos
  // fijos de `LOCKED` -- que son los que esa función añade por su cuenta -- así
  // que para éste las dos cosas dicen lo mismo. No generaliza a otro permiso.
  const { rows } = await pool.query(
    // Los que están en el gremio primero: a quien se fue se le busca a
    // propósito, y hasta entonces sólo estorba en la lista.
    `SELECT p.id, p.name, p.level, COALESCE(p.is_active, true) AS "isActive"
       FROM players p
      WHERE p.guild_id = $1 AND ($2 = '' OR p.name ILIKE '%' || $2 || '%')
        AND EXISTS (
          SELECT 1 FROM users u
            JOIN role_permissions rp
              ON rp.guild_id = u.guild_id AND rp.role = u.role
           WHERE u.guild_id = p.guild_id AND u.discord_id = $3
             AND u.disabled = false AND rp.permission = 'roster.view'
             -- La misma baja que mira vetado(), escrita aquí en SQL porque esto
             -- no puede permitirse la segunda consulta. Una cuenta sin ficha no
             -- la incumple: no hay baja que leer donde no hay roster.
             AND NOT EXISTS (
               SELECT 1 FROM players yo
                WHERE yo.guild_id = u.guild_id AND yo.id = u.player_id
                  AND COALESCE(yo.is_active, true) = false))
      ORDER BY COALESCE(p.is_active, true) DESC, p.name
      LIMIT 25`,
    [GUILD_ID, escrito, usuario.id],
  );

  return {
    type: CHOICES,
    data: {
      choices: rows.map((p) => ({
        name: `${p.name} · Nv.${p.level}${p.isActive ? '' : ' · fuera del gremio'}`.slice(0, 100),
        value: p.id,
      })),
    },
  };
}

/** Acuse de recibo: «pensando…» para un comando, «ya lo reescribo» para un botón. */
const DEFERRED_MESSAGE = 5;
const DEFERRED_UPDATE = 6;

/**
 * Acusa recibo ya, y contesta cuando haya algo que contestar.
 *
 * Discord da **tres segundos** para acusar recibo de una interacción, y quince
 * minutos para el contenido si se acusa con un «pensando…». Contestar del tirón
 * ataba cada comando a que la base de datos respondiera dentro de esos tres
 * segundos, y con varias personas a la vez -- o con el autocompletado ocupando
 * el pool -- eso deja de cumplirse y Discord enseña un error en vez de nada.
 *
 * Diferir rompe esa dependencia entera: el plazo se cumple siempre, porque
 * acusar recibo no toca la base de datos. Lo que tarde en llegar el contenido
 * se ve como unos puntos suspensivos, que es lo que debe pasar cuando algo
 * tarda.
 *
 * Un botón se acusa con `DEFERRED_UPDATE` -- «voy a reescribir este mensaje» --
 * y por eso el trabajo puede decir que lo suyo no era reescribirlo sino avisar
 * a quien pulsó: reescribir la encuesta pública con «no tienes permiso» lo
 * pondría delante de todo el gremio.
 */
function diferir(body, trabajo) {
  const esComponente = body?.type === MESSAGE_COMPONENT;
  // Un comando que pidió respuesta pública se acusa en público; el resto, en
  // privado. La visibilidad se fija aquí y ya no se puede cambiar después.
  const publico =
    body?.data?.options?.find((o) => o.name === 'publico')?.value === true;

  return {
    diferido: {
      ack: esComponente
        ? { type: DEFERRED_UPDATE }
        : { type: DEFERRED_MESSAGE, data: publico ? {} : { flags: EPHEMERAL } },
      /**
       * Devuelve qué hacer con lo que salga: reescribir la respuesta, o
       * mandarle un recado aparte a quien pulsó.
       */
      async trabajo() {
        const salida = await trabajo();
        // Nada que reescribir: el acuse ya cerró la interacción y el mensaje lo
        // dibuja otro. Se devuelve vacío, y quien lo recibe no llama a Discord.
        if (salida?.silencio) return {};
        // `aviso()` fabrica un mensaje efímero. Sobre un botón eso no puede
        // sustituir al mensaje, así que va como recado aparte.
        const esAviso = salida?.type === MESSAGE && salida?.data?.flags === EPHEMERAL;
        if (esComponente && esAviso) return { recado: salida.data };
        return { contenido: salida?.data ?? {} };
      },
    },
  };
}

/**
 * Contesta a lo que mande Discord.
 *
 * Tiene tres segundos para responder o el cliente escribe «la aplicación no
 * respondió», así que aquí no va nada que pueda tardar: dos consultas por
 * índice y a formatear. El día que haga falta algo lento, la salida es
 * responder tipo 5 (pensando...) y editar el mensaje después.
 */
/**
 * Cómo se llama en el log lo que acaba de llegar.
 *
 * Vive aquí y no en `index.js` porque los números de tipo son del protocolo de
 * Discord, y este es el módulo que los conoce. Sale corto a propósito: el log de
 * una interacción tiene que caber en una línea que se lea de un vistazo.
 */
export function nombreDeInteraccion(body) {
  switch (body?.type) {
    case PING:
      return 'ping';
    case APPLICATION_COMMAND:
      return `/${body.data?.name ?? '?'}`;
    case MESSAGE_COMPONENT:
      return `botón ${body.data?.custom_id ?? '?'}`;
    case AUTOCOMPLETE:
      return `autocompletar /${body.data?.name ?? '?'}`;
    default:
      return `tipo ${body?.type ?? '?'}`;
  }
}

/** Quién la mandó: en un canal viene en `member`, en un privado suelto. */
export const quienManda = (body) =>
  body?.member?.user?.id ?? body?.user?.id ?? 'anónimo';

export async function handleInteraction(body) {
  if (body?.type === PING) return { type: PONG };

  // La puerta del gremio, antes que nada. Los comandos se los ve todo el
  // servidor -- así nadie tiene que mantener una lista de a quién enseñárselos
  // en paralelo al roster --, y quien no es del gremio se entera aquí, con una
  // negativa que además le dice qué le falta.
  const negativa = await sinElRol(body);
  if (negativa) {
    // El autocompletado no admite un mensaje: Discord espera opciones o nada.
    // Una lista vacía es lo que ya recibe quien no tiene a nadie que buscar.
    return body?.type === AUTOCOMPLETE ? { type: CHOICES, data: { choices: [] } } : negativa;
  }

  if (body?.type === AUTOCOMPLETE) {
    // Lo único que no se puede diferir: Discord quiere las opciones dentro de
    // los tres segundos o no hay lista que enseñar. Por eso es una sola
    // consulta y por eso no pasa por aquí abajo.
    return body.data?.name === 'perfil'
      ? autocompletarNombre(body)
      : { type: CHOICES, data: { choices: [] } };
  }

  if (body?.type === MESSAGE_COMPONENT) {
    // Botones y desplegables llegan igual; los distingue el id que llevan.
    const id = String(body.data?.custom_id ?? '');
    if (id.startsWith('guerra:')) return diferir(body, () => botonGuerra(body));
    if (id.startsWith('evento:')) return diferir(body, () => botonEvento(body));
    if (id.startsWith('build:')) return diferir(body, () => menuBuild(body));
    return aviso('Ese botón es de una versión anterior del bot. Vuelve a escribir el comando.');
  }

  if (body?.type !== APPLICATION_COMMAND) return null;

  switch (body.data?.name) {
    case 'perfil':
      return diferir(body, () => comandoPerfil(body));
    case 'guerra':
      return diferir(body, () => comandoGuerra(body));
    case 'agenda':
      return diferir(body, () => comandoAgenda(body));
    case 'build':
      return diferir(body, () => comandoBuild(body));
    default:
      return aviso('Ese comando ya no existe. Prueba con `/perfil`, `/guerra`, `/agenda` o `/build`.');
  }
}
