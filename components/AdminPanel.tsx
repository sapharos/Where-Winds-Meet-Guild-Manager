import React, { useEffect, useState } from 'react';
import { authService, api } from '../services/authService';
import WeaponSets from './WeaponSets';
import TablaAncha from './TablaAncha';
import ScanImport from './ScanImport';
import BuscadorDiscord from './BuscadorDiscord';
import { Filas } from './Esqueleto';
import {
  AuthUser,
  DiscordMember,
  DiscordVoiceChannel,
  ManagedUser,
  PERMISSION_LABELS,
  PermissionCatalog,
  Player,
  UserRole,
  ROLE_LABELS,
  VoiceChannelMap,
  WAR_LANES,
} from '../types';

/**
 * Las ranuras de voz de la guerra, en el orden en que se leen: la reunión,
 * los dos bandos, y las tres líneas de cada uno. Los ids calcan los del
 * servidor (VOICE_SLOTS): cambiarlos aquí sin cambiarlos allí es guardar en
 * ranuras que nadie leerá.
 */
const RANURAS_VOZ: { slot: string; label: string }[] = [
  { slot: 'general', label: 'Reunión general' },
  { slot: 'attack', label: 'Bando · Ataque' },
  { slot: 'defense', label: 'Bando · Defensa' },
  ...WAR_LANES.map((l) => ({ slot: `attack:${l.id}`, label: `Ataque · ${l.label}` })),
  ...WAR_LANES.map((l) => ({ slot: `defense:${l.id}`, label: `Defensa · ${l.label}` })),
];

// Mirrors the server's LOCKED table so the boxes it will refuse to clear are
// shown as fixed rather than silently springing back after a save.
const LOCKED: Record<string, string[]> = {
  admin: ['users.manage', 'permissions.manage'],
};
const isLocked = (role: string, permission: string) => (LOCKED[role] ?? []).includes(permission);

interface Props {
  currentUser: AuthUser;
  canManageUsers: boolean;
  canManagePermissions: boolean;
  canManageBuilds: boolean;
  /** Importar un barrido del roster es una tarea administrativa, y vive aquí. */
  canScan: boolean;
  players: Player[];
  onScanImported: () => void;
  /** The impact score reads the sets, so a change here has to reach the rest. */
  onWeaponSetsChanged: () => void;
}

/** A pending Discord claim, waiting for somebody to approve or reject it. */
interface Registration {
  id: string;
  discordUsername: string;
  claimedUid: string;
  playerName: string | null;
}

const AdminPanel: React.FC<Props> = ({
  currentUser,
  canManageUsers,
  canManagePermissions,
  canManageBuilds,
  canScan,
  players,
  onScanImported,
  onWeaponSetsChanged,
}) => {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [catalog, setCatalog] = useState<PermissionCatalog | null>(null);
  const [matrix, setMatrix] = useState<Record<string, string[]>>({});
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('member');
  const [requests, setRequests] = useState<Registration[]>([]);
  /** Si el servidor tiene el bot configurado; sin él no se ofrece vincular. */
  const [botDiscord, setBotDiscord] = useState(false);
  /** La cuenta a la que se está eligiendo Discord, o null con el buscador cerrado. */
  const [enlazando, setEnlazando] = useState<ManagedUser | null>(null);
  /** El jugador elegido para crearle cuenta desde Discord. */
  const [jugadorNuevo, setJugadorNuevo] = useState('');
  /** Los canales de voz del servidor de Discord, o null mientras no se sabe. */
  const [canalesVoz, setCanalesVoz] = useState<DiscordVoiceChannel[] | null>(null);
  const [mapaVoz, setMapaVoz] = useState<VoiceChannelMap>({});
  const [vozSucia, setVozSucia] = useState(false);
  /**
   * Qué rol se está mirando en el teléfono, donde la matriz va de uno en uno.
   *
   * Arranca en oficial y no en el primero de la lista: el primero es
   * administrador, cuyos permisos están casi todos fijos, así que abrir ahí
   * enseña una pantalla en la que no se puede tocar casi nada. Oficial es el
   * rol que de verdad se ajusta.
   */
  const [rolElegido, setRolElegido] = useState<string | null>(null);

  const report = (text: string, ok = true) => setMessage({ text, ok });

  // Leader and subleader are held by one person at a time; showing who has one
  // saves discovering it from a refusal after the fact.
  const holderOf = (role: UserRole) =>
    ['leader', 'subleader'].includes(role) ? users.find((u) => u.role === role) : undefined;

  const load = async () => {
    try {
      const cat = await authService.getPermissions();
      setCatalog(cat);
      setMatrix(cat.matrix);
      setDirty(false);
      if (canManageUsers) {
        setUsers(await authService.listUsers());
        setRequests(await api<Registration[]>('/registrations').catch(() => []));
        const bot = await authService.discordBotStatus().then((s) => s.bot).catch(() => false);
        setBotDiscord(bot);
        if (bot) {
          setCanalesVoz(await api<DiscordVoiceChannel[]>('/discord/voice-channels').catch(() => []));
          setMapaVoz(
            await api<{ channels: VoiceChannelMap }>('/war/voice-channels')
              .then((v) => v.channels)
              .catch(() => ({})),
          );
        }
      }
    } catch (err) {
      report(err instanceof Error ? err.message : 'No se pudo cargar la configuración', false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageUsers]);

  const toggle = (role: string, permission: string) => {
    if (!canManagePermissions || isLocked(role, permission)) return;
    setMatrix((prev) => {
      const held = prev[role] ?? [];
      return {
        ...prev,
        [role]: held.includes(permission) ? held.filter((p) => p !== permission) : [...held, permission],
      };
    });
    setDirty(true);
  };

  const savePermissions = async () => {
    try {
      const { matrix: saved } = await authService.savePermissions(matrix);
      setMatrix(saved);
      setDirty(false);
      report('Permisos guardados.');
    } catch (err) {
      report(err instanceof Error ? err.message : 'No se pudieron guardar los permisos', false);
    }
  };

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await authService.createUser(newUsername.trim(), newPassword, newRole);
      setNewUsername('');
      setNewPassword('');
      setNewRole('member');
      setUsers(await authService.listUsers());
      report('Usuario creado.');
    } catch (err) {
      report(err instanceof Error ? err.message : 'No se pudo crear la cuenta', false);
    }
  };

  const patchUser = async (id: string, changes: { role?: UserRole; disabled?: boolean }) => {
    try {
      await authService.updateUser(id, changes);
      setUsers(await authService.listUsers());
      report('Usuario actualizado.');
    } catch (err) {
      report(err instanceof Error ? err.message : 'No se pudo actualizar la cuenta', false);
    }
  };

  const decideRequest = async (id: string, approve: boolean, role: UserRole = 'member') => {
    try {
      await api(`/registrations/${id}/${approve ? 'approve' : 'reject'}`, {
        method: 'POST',
        body: JSON.stringify(approve ? { role } : {}),
      });
      report(approve ? 'Acceso concedido.' : 'Solicitud rechazada.');
      await load();
    } catch (err) {
      report(err instanceof Error ? err.message : 'No se pudo procesar', false);
    }
  };

  const resetPassword = async (user: ManagedUser) => {
    const password = window.prompt(`Nueva contraseña para ${user.username} (mínimo 8 caracteres):`);
    if (!password) return;
    try {
      await authService.updateUser(user.id, { password });
      report(`Contraseña de ${user.username} actualizada.`);
    } catch (err) {
      report(err instanceof Error ? err.message : 'No se pudo cambiar la contraseña', false);
    }
  };

  const removeUser = async (user: ManagedUser) => {
    if (!window.confirm(`¿Eliminar la cuenta "${user.username}"? Esto no borra a su personaje del roster.`)) return;
    try {
      await authService.deleteUser(user.id);
      setUsers(await authService.listUsers());
      report('Usuario eliminado.');
    } catch (err) {
      report(err instanceof Error ? err.message : 'No se pudo eliminar la cuenta', false);
    }
  };

  const asignarJugador = async (user: ManagedUser, playerId: string) => {
    try {
      await api(`/users/${user.id}/player`, {
        method: 'PATCH',
        body: JSON.stringify({ playerId: playerId || null }),
      });
      setUsers(await authService.listUsers());
      report(
        playerId
          ? `${user.username} asignado a ${players.find((p) => p.id === playerId)?.name ?? 'ese miembro'}.`
          : `${user.username} ya no está asignado a ningún miembro.`,
      );
    } catch (err) {
      report(err instanceof Error ? err.message : 'No se pudo asignar', false);
    }
  };

  const guardarVoz = async () => {
    try {
      const { channels } = await api<{ channels: VoiceChannelMap }>('/war/voice-channels', {
        method: 'PUT',
        body: JSON.stringify({ channels: mapaVoz }),
      });
      setMapaVoz(channels);
      setVozSucia(false);
      report('Canales de voz guardados.');
    } catch (err) {
      report(err instanceof Error ? err.message : 'No se pudieron guardar los canales', false);
    }
  };

  const vincularDiscord = async (user: ManagedUser, member: DiscordMember) => {
    try {
      await authService.linkDiscord(user.id, member);
      setEnlazando(null);
      setUsers(await authService.listUsers());
      report(`Discord de ${user.username} enlazado a @${member.username}.`);
    } catch (err) {
      report(err instanceof Error ? err.message : 'No se pudo enlazar', false);
    }
  };

  const desvincularDiscord = async (user: ManagedUser) => {
    // Una cuenta creada desde Discord no tiene contraseña: quitarle el enlace
    // es cerrarle la puerta del todo, y eso se dice antes, no se descubre.
    if (
      !window.confirm(
        `¿Quitar el Discord de "${user.username}"? Si la cuenta no tiene contraseña, no podrá entrar hasta que se enlace de nuevo.`,
      )
    )
      return;
    try {
      await authService.linkDiscord(user.id, null);
      setUsers(await authService.listUsers());
      report('Enlace de Discord retirado.');
    } catch (err) {
      report(err instanceof Error ? err.message : 'No se pudo desenlazar', false);
    }
  };

  const crearDesdeDiscord = async (member: DiscordMember) => {
    const jugador = players.find((p) => p.id === jugadorNuevo);
    try {
      await authService.createDiscordUser(jugadorNuevo, member);
      setJugadorNuevo('');
      setUsers(await authService.listUsers());
      report(`Cuenta creada para ${jugador?.name ?? 'el miembro'}: entrará con el Discord @${member.username}.`);
    } catch (err) {
      report(err instanceof Error ? err.message : 'No se pudo crear la cuenta', false);
    }
  };

  /**
   * El escaneo, fuera del bloque que depende del catálogo de permisos.
   *
   * Quien sólo tiene `roster.edit` llega aquí para importar un barrido y no
   * puede leer la matriz de permisos, así que su petición falla y `catalog` se
   * queda en null. Si esto estuviera detrás de esa comprobación, esa persona
   * vería una rueda girando para siempre en lugar de la única sección a la que
   * ha venido.
   */
  const escaneo = canScan && (
    <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 sm:p-6">
      <h2 className="cinzel text-2xl font-bold text-amber-500 mb-1">Escaneo del roster</h2>
      <p className="text-sm text-slate-500 mb-4">
        Importar un barrido del gremio y decidir a quién corresponde cada línea leída.
      </p>
      <ScanImport players={players} onImported={onScanImported} />
    </section>
  );

  if (!catalog) {
    return (
      <div className="space-y-6">
        {escaneo}
        {message ? (
          <p className="text-sm rounded-lg px-4 py-3 border bg-red-950/60 border-red-900 text-red-200">
            <i className="fa-solid fa-triangle-exclamation mr-2"></i>
            {message.text}
          </p>
        ) : (
          /*
            El hueco tiene la forma de lo que va a llegar, no la de una losa.
            Era un rectángulo gris de 256 px sin nada alrededor, debajo de una
            sección ya dibujada por completo: leído sin contexto no parece que
            algo esté cargando, parece que algo está tapando la pantalla. Con su
            título y sus filas se entiende de un vistazo qué falta y cuánto.
          */
          <section
            className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 sm:p-6"
            role="status"
            aria-label="Cargando los permisos por rol"
          >
            <h2 className="cinzel text-2xl font-bold text-amber-500 mb-1">Permisos por rol</h2>
            <p className="text-sm text-slate-500 mb-5">Cargando la configuración…</p>
            <Filas cuantas={6} />
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {escaneo}

      {message && (
        <div
          className={`text-sm rounded-lg px-4 py-2 flex items-center gap-3 border ${
            message.ok
              ? 'bg-emerald-950/60 border-emerald-900 text-emerald-200'
              : 'bg-red-950/60 border-red-900 text-red-200'
          }`}
        >
          <i className={`fa-solid ${message.ok ? 'fa-circle-check' : 'fa-triangle-exclamation'}`}></i>
          {message.text}
        </div>
      )}

      <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-1 gap-4 flex-wrap">
          <h2 className="cinzel text-2xl font-bold text-amber-500">Permisos por rol</h2>
          {canManagePermissions && (
            <button
              onClick={savePermissions}
              disabled={!dirty}
              className="bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white text-sm font-bold py-2 px-4 rounded transition-all flex items-center gap-2"
            >
              <i className="fa-solid fa-floppy-disk"></i>
              Guardar cambios
            </button>
          )}
        </div>
        <p className="text-xs text-slate-500 mb-5">
          {canManagePermissions
            ? 'Marca lo que puede hacer cada rol. Las casillas fijas no pueden quitarse: sin ellas nadie podría volver a entrar aquí.'
            : 'Solo lectura. Se necesita el permiso "Editar permisos" para cambiar esta tabla.'}
        </p>

        {/*
          En el teléfono, un rol cada vez.

          La matriz son diez permisos por cinco roles. En 293 px de ancho útil
          la columna de nombres se llevaba 230, así que asomaba media columna de
          casillas y llegar a "Miembro" costaba 347 px de arrastre lateral. Y al
          bajar por las diez filas la cabecera se iba de la pantalla, de modo
          que se marcaban casillas sin saber de qué rol eran. Una columna fija
          arregla el nombre de la fila y empeora todo lo demás.

          Un rol cada vez es además el trabajo real -- "¿qué puede hacer un
          oficial?" -- y es lo que dice el título de la sección. Comparar roles
          entre sí, que es para lo que sirve una matriz, sigue estando a partir
          de md, donde cabe.
        */}
        {/* Se resuelve aquí y no en el estado inicial porque el catálogo llega
            del servidor: cuando se monta el componente todavía no hay roles. */}
        {(() => {
          const rolVisible =
            rolElegido && catalog.roles.includes(rolElegido as UserRole)
              ? rolElegido
              : (catalog.roles.find((r) => r === 'officer') ?? catalog.roles[0]);
          const setRolVisible = setRolElegido;
          return (
        <div className="md:hidden">
          <label className="block mb-3">
            <span className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1">
              Rol
            </span>
            <select
              value={rolVisible}
              onChange={(e) => setRolVisible(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded px-2 text-sm text-slate-100 outline-none focus:ring-1 focus:ring-amber-500"
            >
              {catalog.roles.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role] ?? role} — {(matrix[role] ?? []).length} de{' '}
                  {catalog.permissions.length}
                </option>
              ))}
            </select>
          </label>

          <ul className="flex flex-col divide-y divide-slate-800 border-y border-slate-800">
            {catalog.permissions.map((permission) => {
              const locked = isLocked(rolVisible, permission);
              const puesto = (matrix[rolVisible] ?? []).includes(permission);
              return (
                <li key={permission}>
                  <label
                    className={`min-h-tap flex items-center gap-3 py-2 ${
                      canManagePermissions && !locked ? 'cursor-pointer' : 'cursor-default'
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm ${puesto ? 'text-slate-100' : 'text-slate-400'}`}>
                        {PERMISSION_LABELS[permission] ?? permission}
                      </span>
                      <span className="block text-[11px] text-slate-600 font-mono">{permission}</span>
                    </span>
                    {/* El "fijo" se dice, no se deja adivinar por una casilla
                        que no responde: el servidor la va a rechazar igual y
                        sin explicación el rechazo parece un fallo. */}
                    {locked && (
                      <span className="shrink-0 text-[11px] uppercase tracking-wider text-slate-500 border border-slate-700 rounded px-1.5 py-0.5">
                        fijo
                      </span>
                    )}
                    <input
                      type="checkbox"
                      className="shrink-0 w-5 h-5 accent-amber-600 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                      checked={puesto}
                      disabled={!canManagePermissions || locked}
                      aria-label={`${PERMISSION_LABELS[permission] ?? permission} para ${
                        ROLE_LABELS[rolVisible] ?? rolVisible
                      }`}
                      onChange={() => toggle(rolVisible, permission)}
                    />
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
          );
        })()}

        <TablaAncha aviso="Desliza para ver todos los roles" className="hidden md:block">
          <table className="w-full text-sm border-collapse min-w-[640px]">
            <thead>
              <tr>
                <th className="text-left font-semibold text-slate-400 p-2 border-b border-slate-800 sticky left-0 bg-slate-900">
                  Permiso
                </th>
                {catalog.roles.map((role) => (
                  <th
                    key={role}
                    className="p-2 border-b border-slate-800 text-center text-[11px] uppercase tracking-wider text-amber-500/90 font-bold"
                  >
                    {ROLE_LABELS[role] ?? role}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {catalog.permissions.map((permission) => (
                <tr key={permission} className="hover:bg-slate-800/30">
                  <td className="p-2 border-b border-slate-800/60 text-slate-300 sticky left-0 bg-slate-900">
                    {PERMISSION_LABELS[permission] ?? permission}
                    <span className="block text-[11px] text-slate-600 font-mono">{permission}</span>
                  </td>
                  {catalog.roles.map((role) => {
                    const locked = isLocked(role, permission);
                    return (
                      <td key={role} className="p-2 border-b border-slate-800/60 text-center">
                        {/* La casilla mide 16 px, que no se acierta con el
                            dedo. La etiqueta que la envuelve mide 44 y es
                            igual de pulsable, así que el objetivo crece sin
                            que el control cambie de aspecto. */}
                        <label
                          className="min-h-tap min-w-tap mx-auto flex items-center justify-center cursor-pointer"
                          title={locked ? 'Fijo: no puede quitarse' : undefined}
                        >
                          <input
                            type="checkbox"
                            className="w-4 h-4 accent-amber-600 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                            checked={(matrix[role] ?? []).includes(permission)}
                            disabled={!canManagePermissions || locked}
                            aria-label={`${PERMISSION_LABELS[permission] ?? permission} para ${ROLE_LABELS[role] ?? role}`}
                            onChange={() => toggle(role, permission)}
                          />
                        </label>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </TablaAncha>
      </section>

      {canManageUsers && requests.length > 0 && (
        <section className="bg-slate-900/60 border border-amber-800/60 rounded-xl p-6">
          <h2 className="cinzel text-2xl font-bold text-amber-500 mb-1">
            Solicitudes de acceso
            <span className="ml-3 text-sm font-normal text-slate-500">{requests.length} pendientes</span>
          </h2>
          <p className="text-xs text-slate-500 mb-5">
            Alguien entró con Discord y dice ser este miembro. El UID está a la vista de todo el gremio dentro
            del juego, así que comprueba que la persona de Discord y el personaje son quienes dicen ser.
          </p>

          <div className="space-y-2">
            {requests.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 flex-wrap bg-slate-950 border border-slate-800 rounded-lg p-3"
              >
                <div className="text-sm">
                  <span className="text-[#8ea1ff] font-semibold">
                    <i className="fa-brands fa-discord mr-1.5"></i>
                    {r.discordUsername}
                  </span>
                  <span className="text-slate-600 mx-2">reclama ser</span>
                  <span className="text-slate-100 font-semibold">{r.playerName ?? '(miembro desconocido)'}</span>
                  <span className="text-slate-600 font-mono text-xs ml-2">UID {r.claimedUid}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => decideRequest(r.id, false)}
                    className="text-slate-400 hover:text-red-400 text-xs py-1.5 px-3 rounded border border-slate-800 transition-all"
                  >
                    Rechazar
                  </button>
                  <button
                    onClick={() => decideRequest(r.id, true)}
                    className="bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold py-1.5 px-3 rounded transition-all"
                  >
                    Aprobar como miembro
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <WeaponSets canEdit={canManageBuilds} onSaved={onWeaponSetsChanged} />

      {canManageUsers && (
        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-6">
          <h2 className="cinzel text-2xl font-bold text-amber-500 mb-5">Cuentas</h2>

          <form onSubmit={createUser} className="grid md:grid-cols-4 gap-3 mb-6">
            <input
              type="text"
              required
              placeholder="Usuario"
              className="bg-slate-950 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
            />
            <input
              type="password"
              required
              minLength={8}
              placeholder="Contraseña (mín. 8)"
              autoComplete="new-password"
              className="bg-slate-950 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <select
              className="bg-slate-950 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as UserRole)}
            >
              {catalog.roles.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role] ?? role}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold py-2 px-4 rounded transition-all flex items-center justify-center gap-2"
            >
              <i className="fa-solid fa-user-plus"></i>
              Crear cuenta
            </button>
          </form>

          {botDiscord && (
            <div className="mb-6 bg-slate-950/60 border border-slate-800 rounded-lg p-4">
              <p className="text-sm text-slate-300 mb-1">
                <i className="fa-brands fa-discord mr-2 text-[#8ea1ff]"></i>
                Crear cuenta desde Discord
              </p>
              <p className="text-xs text-slate-500 mb-3">
                Elige a quién del roster y búscalo en el servidor de Discord. La cuenta sale sin
                contraseña y entra solo con su Discord, como las aprobadas por solicitud. Aquí no
                hay prueba de que esa cuenta sea suya: la prueba eres tú.
              </p>
              <div className="grid md:grid-cols-2 gap-3">
                <select
                  className="bg-slate-950 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
                  value={jugadorNuevo}
                  onChange={(e) => setJugadorNuevo(e.target.value)}
                >
                  <option value="">— Miembro del roster sin cuenta —</option>
                  {players
                    .filter((p) => !users.some((u) => u.playerId === p.id))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
                {/* El buscador aparece al elegir jugador: buscar primero y
                    elegir después invita a enlazar al revés. */}
                {jugadorNuevo && <BuscadorDiscord onPick={(m) => void crearDesdeDiscord(m)} />}
              </div>
            </div>
          )}

          {enlazando && (
            <div className="mb-4 bg-slate-950 border border-amber-800/60 rounded-lg p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <p className="text-sm text-slate-300">
                  Enlazar Discord a{' '}
                  <span className="font-semibold text-slate-100">{enlazando.username}</span>
                </p>
                <button
                  onClick={() => setEnlazando(null)}
                  className="text-slate-500 hover:text-slate-300 p-1"
                  aria-label="Cerrar el buscador"
                >
                  <i className="fa-solid fa-xmark"></i>
                </button>
              </div>
              <BuscadorDiscord autoFocus onPick={(m) => void vincularDiscord(enlazando, m)} />
            </div>
          )}

          <TablaAncha aviso="Desliza para ver miembro, rol, Discord, estado y acciones">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="text-left text-slate-400">
                  <th className="p-2 border-b border-slate-800 font-semibold sticky left-0 bg-slate-900">
                    Usuario
                  </th>
                  <th className="p-2 border-b border-slate-800 font-semibold">Miembro</th>
                  <th className="p-2 border-b border-slate-800 font-semibold">Rol</th>
                  <th className="p-2 border-b border-slate-800 font-semibold">Discord</th>
                  <th className="p-2 border-b border-slate-800 font-semibold">Estado</th>
                  <th className="p-2 border-b border-slate-800 font-semibold text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-800/30">
                    <td className="p-2 border-b border-slate-800/60 text-slate-200 sticky left-0 bg-slate-900">
                      {user.username}
                      {user.id === currentUser.id && (
                        <span className="ml-2 text-[11px] uppercase tracking-wider bg-amber-700 text-white px-1.5 py-0.5 rounded">
                          tú
                        </span>
                      )}
                    </td>
                    <td className="p-2 border-b border-slate-800/60">
                      {/* A quién del roster pertenece la cuenta. Editable aquí
                          mismo: el endpoint existía desde el principio y la
                          asignación es lo que deja a un miembro editar sus
                          propias builds, así que verla sin poder corregirla
                          era quedarse a medias. */}
                      <select
                        className="max-w-[160px] bg-slate-950 border border-slate-800 rounded p-1 text-xs outline-none focus:ring-1 focus:ring-amber-500"
                        value={user.playerId ?? ''}
                        onChange={(e) => asignarJugador(user, e.target.value)}
                      >
                        <option value="">— nadie —</option>
                        {players
                          .filter((p) => p.id === user.playerId || !users.some((u) => u.playerId === p.id))
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="p-2 border-b border-slate-800/60">
                      <select
                        className="bg-slate-950 border border-slate-800 rounded p-1 text-xs outline-none focus:ring-1 focus:ring-amber-500"
                        value={user.role}
                        onChange={(e) => patchUser(user.id, { role: e.target.value as UserRole })}
                      >
                        {catalog.roles.map((role) => {
                          const held = holderOf(role);
                          return (
                            <option
                              key={role}
                              value={role}
                              disabled={Boolean(held) && held?.id !== user.id}
                            >
                              {ROLE_LABELS[role] ?? role}
                              {held && held.id !== user.id ? ` — lo tiene ${held.username}` : ''}
                            </option>
                          );
                        })}
                      </select>
                    </td>
                    <td className="p-2 border-b border-slate-800/60 whitespace-nowrap">
                      {user.discordId ? (
                        <span className="text-xs text-[#8ea1ff]">
                          <i className="fa-brands fa-discord mr-1.5"></i>
                          {user.discordUsername ?? user.discordId}
                          <button
                            onClick={() => desvincularDiscord(user)}
                            title="Quitar el enlace con Discord"
                            className="ml-1.5 p-1 text-slate-500 hover:text-red-400 transition-all"
                          >
                            <i className="fa-solid fa-link-slash"></i>
                          </button>
                        </span>
                      ) : botDiscord ? (
                        <button
                          onClick={() => setEnlazando(user)}
                          className="text-xs py-1 px-2 rounded border border-slate-800 text-slate-400 hover:text-amber-500 transition-all"
                        >
                          <i className="fa-solid fa-link mr-1.5"></i>
                          Enlazar
                        </button>
                      ) : (
                        <span
                          className="text-xs text-slate-600"
                          title="Sin enlazar. Para enlazar desde aquí hace falta el bot de Discord configurado."
                        >
                          —
                        </span>
                      )}
                    </td>
                    <td className="p-2 border-b border-slate-800/60">
                      <span className={user.disabled ? 'text-slate-500' : 'text-emerald-400'}>
                        {user.disabled ? 'Desactivada' : 'Activa'}
                      </span>
                    </td>
                    <td className="p-2 border-b border-slate-800/60 text-right whitespace-nowrap">
                      <button
                        onClick={() => resetPassword(user)}
                        title="Cambiar contraseña"
                        className="p-2 text-slate-400 hover:text-amber-500 transition-all"
                      >
                        <i className="fa-solid fa-key"></i>
                      </button>
                      <button
                        onClick={() => patchUser(user.id, { disabled: !user.disabled })}
                        title={user.disabled ? 'Activar' : 'Desactivar'}
                        className="p-2 text-slate-400 hover:text-amber-500 transition-all"
                      >
                        <i className={`fa-solid ${user.disabled ? 'fa-user-check' : 'fa-user-slash'}`}></i>
                      </button>
                      <button
                        onClick={() => removeUser(user)}
                        disabled={user.id === currentUser.id}
                        title={user.id === currentUser.id ? 'No puedes eliminar tu propia cuenta' : 'Eliminar'}
                        className="p-2 text-slate-400 hover:text-red-500 disabled:text-slate-700 disabled:cursor-not-allowed transition-all"
                      >
                        <i className="fa-solid fa-trash"></i>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TablaAncha>
        </section>
      )}

      {canManageUsers && botDiscord && (
        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-1 gap-4 flex-wrap">
            <h2 className="cinzel text-2xl font-bold text-amber-500">Canales de voz de guerra</h2>
            <button
              onClick={guardarVoz}
              disabled={!vozSucia}
              className="bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white text-sm font-bold py-2 px-4 rounded transition-all flex items-center gap-2"
            >
              <i className="fa-solid fa-floppy-disk"></i>
              Guardar canales
            </button>
          </div>
          <p className="text-xs text-slate-500 mb-5">
            A qué canal lleva cada botón de la Sala de Guerra. Los canales se crean en Discord; aquí
            solo se elige cuál es cuál. El bot necesita el permiso «Mover miembros» en todos ellos, y
            solo puede mover a quien ya esté conectado a algún canal de voz del servidor.
          </p>

          {canalesVoz !== null && canalesVoz.length === 0 ? (
            <p className="text-sm text-slate-400 bg-slate-950 border border-slate-800 rounded-lg p-3">
              <i className="fa-solid fa-triangle-exclamation mr-2 text-amber-500"></i>
              El bot no ve ningún canal de voz. Crea los canales en el servidor de Discord y
              comprueba que el bot puede verlos.
            </p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {RANURAS_VOZ.map(({ slot, label }) => (
                <label key={slot} className="block">
                  <span className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1">
                    {label}
                  </span>
                  <select
                    className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
                    value={mapaVoz[slot] ?? ''}
                    onChange={(e) => {
                      const value = e.target.value;
                      setMapaVoz((prev) => {
                        const next = { ...prev };
                        if (value) next[slot] = value;
                        else delete next[slot];
                        return next;
                      });
                      setVozSucia(true);
                    }}
                  >
                    <option value="">— sin canal —</option>
                    {(canalesVoz ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        🔊 {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};

export default AdminPanel;
