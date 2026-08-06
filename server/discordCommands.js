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
import { listBuilds } from './builds.js';
import { listWeaponSets } from './weapons.js';

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

/** Tipos de interacción y de respuesta que se usan aquí. */
const PING = 1;
const APPLICATION_COMMAND = 2;
const PONG = 1;
const MESSAGE = 4;
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

/** Lo que el gremio ve al escribir «/» en Discord. */
const COMMANDS = [
  {
    name: 'perfil',
    description: 'Tus estadísticas del último escaneo del gremio',
    options: [
      {
        type: 5, // booleano
        name: 'publico',
        description: 'Enseñarlas en el canal en vez de sólo a ti',
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

/* ------------------------------------------------------------- presentación */

const miles = new Intl.NumberFormat('es');

/** El latón de la grapa, que es el color de marca del producto. */
const LATON = 0xd3a155;

const ROLE_NAMES = { Tank: 'Tanque', Healer: 'Sanador', DPS: 'DPS' };
const WAR_SIDES = { attack: 'Ataque', defense: 'Defensa' };

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
export function perfilEmbed({ player, scans, builds, weaponSets, avatarUrl, guildName }) {
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
    embed.footer = { text: 'Todavía no apareces en ningún escaneo del gremio' };
  }

  return embed;
}

/* ---------------------------------------------------------------- comandos */

/** Un aviso corto, siempre sólo para quien escribió el comando. */
const aviso = (texto) => ({ type: MESSAGE, data: { content: texto, flags: EPHEMERAL } });

/** La foto de Discord de quien pregunta, para la esquina del embed. */
function avatarDe(usuario) {
  if (!usuario?.id || !usuario.avatar) return null;
  const ext = usuario.avatar.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${usuario.id}/${usuario.avatar}.${ext}?size=128`;
}

/**
 * `/perfil` -- las estadísticas de quien lo escribe.
 *
 * Quién es se resuelve por el Discord con el que ya está vinculada su cuenta;
 * no hay forma de pedir las de otro, ni falta: el roster de la web ya las
 * enseña a quien tiene permiso para verlas.
 */
async function comandoPerfil(interaction) {
  const usuario = interaction.member?.user ?? interaction.user;
  if (!usuario?.id) return aviso('No he podido saber quién eres. Inténtalo otra vez.');

  const { rows } = await pool.query(
    `SELECT u.player_id AS "playerId", p.name, p.role, p.level, p.sect,
            p.is_starter AS "isStarter", p.war_side AS "warSide",
            COALESCE(p.is_active, true) AS "isActive"
       FROM users u
       LEFT JOIN players p ON p.guild_id = u.guild_id AND p.id = u.player_id
      WHERE u.guild_id = $1 AND u.discord_id = $2 AND u.disabled = false`,
    [GUILD_ID, usuario.id],
  );

  const cuenta = rows[0];
  if (!cuenta) {
    return aviso(
      'Tu Discord no está vinculado a ninguna cuenta del gremio. Entra en la web con el botón de Discord y pide tu registro; un líder lo aprueba.',
    );
  }
  if (!cuenta.playerId || !cuenta.name) {
    return aviso('Tu cuenta todavía no está unida a una ficha del roster. Avisa a un líder.');
  }

  const [scans, builds, weaponSets] = await Promise.all([
    pool
      .query(
        `SELECT scanned_at AS "scannedAt", ${SCAN_FIELDS.join(', ')}
           FROM player_scans WHERE guild_id = $1 AND player_id = $2
          ORDER BY scanned_at DESC LIMIT 2`,
        [GUILD_ID, cuenta.playerId],
      )
      .then((r) => r.rows),
    listBuilds(cuenta.playerId),
    listWeaponSets(),
  ]);

  const publico = interaction.data?.options?.find((o) => o.name === 'publico')?.value === true;

  return {
    type: MESSAGE,
    data: {
      embeds: [
        perfilEmbed({
          player: cuenta,
          scans,
          builds,
          weaponSets,
          avatarUrl: avatarDe(usuario),
          guildName: process.env.GUILD_NAME || 'Zona Zero',
        }),
      ],
      ...(publico ? {} : { flags: EPHEMERAL }),
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
export async function handleInteraction(body) {
  if (body?.type === PING) return { type: PONG };
  if (body?.type !== APPLICATION_COMMAND) return null;

  switch (body.data?.name) {
    case 'perfil':
      return comandoPerfil(body);
    default:
      return aviso('Ese comando ya no existe. Prueba con `/perfil`.');
  }
}
