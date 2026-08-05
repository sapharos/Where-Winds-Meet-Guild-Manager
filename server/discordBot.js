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
