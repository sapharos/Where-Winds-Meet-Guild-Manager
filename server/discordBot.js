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

async function botFetch(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
  });
  if (!res.ok) {
    // 403/404 aquí es casi siempre el bot sin invitar al servidor todavía, y
    // decirlo ahorra media hora de mirar el token.
    const hint =
      res.status === 403 || res.status === 404
        ? 'Discord rechazó la petición: comprueba que el bot está invitado al servidor y que DISCORD_GUILD_ID es el correcto'
        : `Discord respondió ${res.status}`;
    throw Object.assign(new Error(hint), { status: 502 });
  }
  return res.json();
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
