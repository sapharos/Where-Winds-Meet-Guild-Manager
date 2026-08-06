import React, { useState } from 'react';
import { AuthUser, ManagedUser, Player, ROLE_LABELS, UserRole } from '../types';
import Sheet from './Sheet';

/**
 * Una cuenta, en un teléfono.
 *
 * La pantalla de Cuentas era una tabla de 820 px dentro de un contenedor que se
 * desplaza de lado: en un móvil había que arrastrar hasta el final de la fila
 * para llegar a tres botones de icono sin etiqueta, y el desplegable de «a qué
 * miembro pertenece» medía 160 px. Es exactamente lo que el resto del producto
 * ya resolvió una vez -- la tarjeta de miembro tenía seis iconos de 20x24 -- así
 * que se resuelve igual: la ficha dice quién es y en qué estado está, y todo lo
 * que se hace con ella vive en una hoja, con su nombre escrito y 44 px de alto.
 *
 * La tabla se queda para escritorio, donde comparar diez cuentas de un vistazo
 * es justo lo que se viene a hacer y una fila cabe entera.
 */

interface Props {
  user: ManagedUser;
  currentUser: AuthUser;
  players: Player[];
  /** Todas, para no ofrecer un miembro que ya tiene cuenta. */
  users: ManagedUser[];
  roles: UserRole[];
  /** Quién tiene ya un rol único, si alguien lo tiene. */
  holderOf: (role: UserRole) => ManagedUser | undefined;
  botDiscord: boolean;
  onRole: (role: UserRole) => void;
  onPlayer: (playerId: string) => void;
  onLink: () => void;
  onUnlink: () => void;
  onPassword: () => void;
  onToggle: () => void;
  onRemove: () => void;
}

const CuentaFicha: React.FC<Props> = ({
  user,
  currentUser,
  players,
  users,
  roles,
  holderOf,
  botDiscord,
  onRole,
  onPlayer,
  onLink,
  onUnlink,
  onPassword,
  onToggle,
  onRemove,
}) => {
  const [menu, setMenu] = useState(false);
  const suyo = players.find((p) => p.id === user.playerId);
  const esYo = user.id === currentUser.id;

  const campo =
    'w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500';

  /** Los miembros que puede tener esta cuenta: el suyo y los que están libres. */
  const libres = players
    .filter((p) => p.id === user.playerId || !users.some((u) => u.playerId === p.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <div
        className={`p-3 rounded-lg border bg-slate-900 ${
          user.disabled ? 'border-slate-800 opacity-60' : 'border-slate-800'
        }`}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 grow">
            <div className="flex items-center gap-2 min-w-0">
              <h4 className="font-bold text-slate-100 truncate">{user.username}</h4>
              {esYo && (
                <span className="text-[11px] leading-none px-1.5 py-[3px] rounded bg-amber-700 text-white uppercase font-bold tracking-tighter shrink-0">
                  tú
                </span>
              )}
              {user.disabled && (
                <span className="text-[11px] leading-none px-1.5 py-[3px] rounded border border-slate-600 text-slate-400 uppercase font-bold tracking-tighter shrink-0">
                  desactivada
                </span>
              )}
            </div>
            {/* Una línea que se corta, no una pila de chips: rol, a quién
                pertenece y su Discord, que es todo lo que hay que saber sin
                abrir nada. */}
            <p className="text-meta text-slate-400 truncate">
              {ROLE_LABELS[user.role] ?? user.role}
              {' · '}
              {suyo ? suyo.name : <span className="text-slate-600">sin miembro</span>}
              {user.discordId && (
                <span className="text-[#8ea1ff]">
                  {' · '}
                  <i className="fa-brands fa-discord mr-1"></i>
                  {user.discordUsername ?? user.discordId}
                </span>
              )}
            </p>
          </div>

          <button
            onClick={() => setMenu(true)}
            aria-label={`Acciones de ${user.username}`}
            aria-haspopup="dialog"
            className="shrink-0 -mr-1 min-h-tap min-w-tap flex items-center justify-center rounded-md text-slate-400 hover:text-amber-500 transition-colors duration-micro"
          >
            <i className="fa-solid fa-ellipsis-vertical"></i>
          </button>
        </div>
      </div>

      {menu && (
        <Sheet
          title={user.username}
          subtitle={`${ROLE_LABELS[user.role] ?? user.role}${suyo ? ` · ${suyo.name}` : ''}`}
          size="sm"
          onClose={() => setMenu(false)}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                Rol
              </label>
              <select
                className={campo}
                value={user.role}
                onChange={(e) => onRole(e.target.value as UserRole)}
              >
                {roles.map((role) => {
                  const held = holderOf(role);
                  return (
                    <option key={role} value={role} disabled={Boolean(held) && held?.id !== user.id}>
                      {ROLE_LABELS[role] ?? role}
                      {held && held.id !== user.id ? ` — lo tiene ${held.username}` : ''}
                    </option>
                  );
                })}
              </select>
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                Miembro del roster
              </label>
              <select className={campo} value={user.playerId ?? ''} onChange={(e) => onPlayer(e.target.value)}>
                <option value="">— nadie —</option>
                {libres.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <p className="text-meta text-slate-500 mt-1">
                Es lo que le deja editar sus propias builds y ver su perfil.
              </p>
            </div>

            <div className="flex flex-col gap-1 pt-2 border-t border-slate-800">
              {user.discordId ? (
                <button
                  onClick={() => {
                    onUnlink();
                    setMenu(false);
                  }}
                  className="min-h-tap flex items-center gap-3 px-3 -mx-1 rounded-md text-left text-slate-200 hover:bg-slate-800/60 transition-colors duration-micro"
                >
                  <i className="fa-solid fa-link-slash text-slate-400 w-5 text-center"></i>
                  Quitar el enlace con Discord
                </button>
              ) : botDiscord ? (
                <button
                  onClick={() => {
                    onLink();
                    setMenu(false);
                  }}
                  className="min-h-tap flex items-center gap-3 px-3 -mx-1 rounded-md text-left text-slate-200 hover:bg-slate-800/60 transition-colors duration-micro"
                >
                  <i className="fa-solid fa-link text-slate-400 w-5 text-center"></i>
                  Enlazar con Discord
                </button>
              ) : null}

              <button
                onClick={() => {
                  onPassword();
                  setMenu(false);
                }}
                className="min-h-tap flex items-center gap-3 px-3 -mx-1 rounded-md text-left text-slate-200 hover:bg-slate-800/60 transition-colors duration-micro"
              >
                <i className="fa-solid fa-key text-slate-400 w-5 text-center"></i>
                Cambiar la contraseña
              </button>

              <button
                onClick={() => {
                  onToggle();
                  setMenu(false);
                }}
                className="min-h-tap flex items-center gap-3 px-3 -mx-1 rounded-md text-left text-slate-200 hover:bg-slate-800/60 transition-colors duration-micro"
              >
                <i
                  className={`fa-solid ${user.disabled ? 'fa-user-check' : 'fa-user-slash'} text-slate-400 w-5 text-center`}
                ></i>
                {user.disabled ? 'Activar la cuenta' : 'Desactivar la cuenta'}
              </button>
            </div>

            {/* Apartada, como en la tarjeta de miembro: borrar una cuenta no
                puede estar pegado a cambiarle el rol. */}
            <div className="mt-4 pt-3 border-t border-slate-800">
              <button
                disabled={esYo}
                onClick={() => {
                  onRemove();
                  setMenu(false);
                }}
                title={esYo ? 'No puedes eliminar tu propia cuenta' : undefined}
                className="w-full min-h-tap flex items-center gap-3 px-3 -mx-1 rounded-md text-left text-red-400 hover:bg-red-500/10 disabled:text-slate-700 disabled:hover:bg-transparent transition-colors duration-micro"
              >
                <i className="fa-solid fa-trash w-5 text-center"></i>
                Eliminar la cuenta
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </>
  );
};

export default CuentaFicha;
