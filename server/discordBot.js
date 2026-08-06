/**
 * El bot del gremio hablando con Discord por REST.
 *
 * No hay conexión permanente (Gateway) a propósito: todo lo que este módulo
 * necesita — hoy, buscar miembros del servidor de Discord para vincularlos al
 * roster — se resuelve con peticiones HTTPS sueltas firmadas con el token del
 * bot. Un WebSocket que hay que mantener vivo, reconectar y vigilar es un
 * proceso más que cuidar, y no compra nada hasta que haga falta escuchar
 * eventos en tiempo real.
 *
 * Se activa con dos variables: DISCORD_BOT_TOKEN (el token de bot de la misma
 * aplicación que ya firma el inicio de sesión) y DISCORD_GUILD_ID (el servidor
 * de Discord del gremio, que se copia con el modo desarrollador). Sin ellas
 * todo lo de aquí se apaga y el resto de la aplicación ni se entera, igual que
 * hace el inicio de sesión con sus propias claves.
 */

const API = 'https://discord.com/api/v10';

export const botEnabled = () =>
  Boolean(process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_GUILD_ID);

async function botFetch(path, init) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 429) {
    // Discord dice cuánto esperar; se le hace caso una vez y se reintenta.
    // Mover a un gremio entero de canal en canal roza estos límites a poco
    // que la guerra sea grande, y rendirse a la primera dejaría a media
    // formación en el canal equivocado.
    const cuerpo = await res.json().catch(() => null);
    const espera = Math.min(Number(cuerpo?.retry_after ?? 1), 10);
    await new Promise((done) => setTimeout(done, espera * 1000 + 100));
    return botFetch(path, init);
  }
  if (!res.ok) {
    const cuerpo = await res.json().catch(() => null);
    // 403/404 aquí es casi siempre el bot sin invitar al servidor todavía, y
    // decirlo ahorra media hora de mirar el token.
    const hint =
      res.status === 403 || res.status === 404
        ? 'Discord rechazó la petición: comprueba que el bot está invitado al servidor y que DISCORD_GUILD_ID es el correcto'
        : `Discord respondió ${res.status}`;
    throw Object.assign(new Error(cuerpo?.message ? `${hint} (${cuerpo.message})` : hint), {
      status: 502,
      discordCode: cuerpo?.code,
    });
  }
  return res.status === 204 ? null : res.json();
}

/**
 * Miembros del servidor de Discord cuyo nombre o apodo empieza por lo escrito.
 *
 * Este endpoint de Discord busca por prefijo y no exige el intent privilegiado
 * de miembros, así que funciona con el bot recién invitado y sin tocar ninguna
 * casilla especial del portal. Devuelve lo justo para que quien vincula
 * reconozca a la persona: el apodo con el que se la ve en el servidor y el
 * nombre de usuario global, que es el que no cambia de un servidor a otro.
 */
export async function searchGuildMembers(query, limit = 10) {
  const params = new URLSearchParams({ query, limit: String(limit) });
  const members = await botFetch(
    `/guilds/${process.env.DISCORD_GUILD_ID}/members/search?${params}`,
  );
  return members.map((m) => ({
    id: m.user.id,
    username: m.user.username,
    globalName: m.user.global_name ?? null,
    nick: m.nick ?? null,
  }));
}

/**
 * Los canales de voz del servidor, en el orden en que Discord los pinta.
 * Sirven para que la configuración de guerra sea elegir de una lista en vez
 * de andar copiando IDs con el modo desarrollador.
 */
export async function listVoiceChannels() {
  const channels = await botFetch(`/guilds/${process.env.DISCORD_GUILD_ID}/channels`);
  return channels
    .filter((c) => c.type === 2) // 2 = canal de voz; los de escenario no valen
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ id: c.id, name: c.name }));
}

/**
 * Los canales de texto donde se puede escribir, en el orden en que Discord los
 * pinta. Sirven para que elegir dónde se publican las encuestas sea escoger de
 * una lista y no copiar un id con el modo desarrollador puesto.
 *
 * Se cuelan los hilos y los anuncios (tipos 0 y 5) porque en los dos se puede
 * publicar; las categorías y los canales de voz, no.
 */
export async function listTextChannels() {
  const channels = await botFetch(`/guilds/${process.env.DISCORD_GUILD_ID}/channels`);
  return channels
    .filter((c) => c.type === 0 || c.type === 5)
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ id: c.id, name: c.name }));
}

/** Publica un mensaje y devuelve su id, que es lo que hay que guardar. */
export async function postMessage(channelId, payload) {
  const mensaje = await botFetch(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return { id: mensaje.id, channelId };
}

/**
 * Reescribe un mensaje ya publicado.
 *
 * Devuelve un veredicto en vez de lanzar cuando el mensaje ya no está: alguien
 * pudo borrarlo desde Discord, y eso no es un error del que avisar sino una
 * publicación que hay que rehacer. Quien llama decide si la rehace.
 */
export async function editMessage(channelId, messageId, payload) {
  try {
    await botFetch(`/channels/${channelId}/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    return { edited: true };
  } catch (err) {
    // 10008: Unknown Message. 10003: Unknown Channel.
    if (err.discordCode === 10008 || err.discordCode === 10003) return { edited: false, gone: true };
    throw err;
  }
}

/**
 * Los sonidos del panel del servidor, para elegir el cuerno de guerra.
 * El panel lo administra el gremio desde Discord; aquí sólo se lee.
 */
export async function listSoundboardSounds() {
  const { items } = await botFetch(`/guilds/${process.env.DISCORD_GUILD_ID}/soundboard-sounds`);
  return items
    .filter((s) => s.available !== false)
    .map((s) => ({ id: s.sound_id, name: s.name, emoji: s.emoji_name ?? null }));
}

/**
 * Dispara un sonido del panel en un canal de voz.
 *
 * Discord sólo lo acepta si el bot tiene un estado de voz en ese canal --
 * plantarlo es asunto del cliente de Gateway, no de esta llamada. El error de
 * "no estás en el canal" se devuelve como veredicto, igual que el reparto:
 * durante un barrido es un resultado más, no una excepción que lo aborta.
 */
export async function playSoundboardSound(channelId, soundId) {
  try {
    await botFetch(`/channels/${channelId}/send-soundboard-sound`, {
      method: 'POST',
      body: JSON.stringify({ sound_id: soundId }),
    });
    return { played: true };
  } catch (err) {
    if (err.discordCode === 50013) {
      return { played: false, reason: 'faltan permisos de voz o panel de sonidos' };
    }
    return { played: false, reason: err.message };
  }
}

/**
 * Mueve a un miembro a un canal de voz.
 *
 * Devuelve un veredicto en vez de lanzar, porque "no está en voz" no es un
 * fallo: es la respuesta normal de media formación cuando se pulsa el botón, y
 * el que reparte necesita el recuento entero, no la primera excepción.
 * Discord no ofrece manera de preguntar por REST quién está conectado, así que
 * intentarlo y contar es la única forma honesta de hacerlo.
 */
export async function moveToVoice(discordId, channelId) {
  try {
    await botFetch(`/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordId}`, {
      method: 'PATCH',
      body: JSON.stringify({ channel_id: channelId }),
    });
    return { moved: true };
  } catch (err) {
    // 40032: "Target user is not connected to voice."
    if (err.discordCode === 40032) return { moved: false, reason: 'no está en voz' };
    if (err.discordCode === 50013) {
      // Permiso que sí pedimos y puede faltar: dejar la pista completa.
      throw Object.assign(
        new Error('al bot le falta el permiso "Mover miembros" en ese canal de voz'),
        { status: 502 },
      );
    }
    throw err;
  }
}
