import React, { useEffect, useState } from 'react';
import { authService } from '../services/authService';
import { AuthUser, ManagedUser, PERMISSION_LABELS, PermissionCatalog, UserRole, ROLE_LABELS } from '../types';

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
}

const AdminPanel: React.FC<Props> = ({ currentUser, canManageUsers, canManagePermissions }) => {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [catalog, setCatalog] = useState<PermissionCatalog | null>(null);
  const [matrix, setMatrix] = useState<Record<string, string[]>>({});
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('member');

  const report = (text: string, ok = true) => setMessage({ text, ok });

  const load = async () => {
    try {
      const cat = await authService.getPermissions();
      setCatalog(cat);
      setMatrix(cat.matrix);
      setDirty(false);
      if (canManageUsers) setUsers(await authService.listUsers());
    } catch (err) {
      report(err instanceof Error ? err.message : 'Could not load settings', false);
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
      report(err instanceof Error ? err.message : 'Could not save permissions', false);
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
      report(err instanceof Error ? err.message : 'Could not create user', false);
    }
  };

  const patchUser = async (id: string, changes: { role?: UserRole; disabled?: boolean }) => {
    try {
      await authService.updateUser(id, changes);
      setUsers(await authService.listUsers());
      report('Usuario actualizado.');
    } catch (err) {
      report(err instanceof Error ? err.message : 'Could not update user', false);
    }
  };

  const resetPassword = async (user: ManagedUser) => {
    const password = window.prompt(`Nueva contraseña para ${user.username} (mínimo 8 caracteres):`);
    if (!password) return;
    try {
      await authService.updateUser(user.id, { password });
      report(`Contraseña de ${user.username} actualizada.`);
    } catch (err) {
      report(err instanceof Error ? err.message : 'Could not reset password', false);
    }
  };

  const removeUser = async (user: ManagedUser) => {
    if (!window.confirm(`¿Eliminar la cuenta "${user.username}"? Esto no borra a su personaje del roster.`)) return;
    try {
      await authService.deleteUser(user.id);
      setUsers(await authService.listUsers());
      report('Usuario eliminado.');
    } catch (err) {
      report(err instanceof Error ? err.message : 'Could not delete user', false);
    }
  };

  if (!catalog) {
    return (
      <div className="flex items-center justify-center h-96 text-slate-500 gap-3">
        <i className="fa-solid fa-circle-notch fa-spin"></i>
        Cargando configuración...
      </div>
    );
  }

  return (
    <div className="space-y-6">
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

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse min-w-[640px]">
            <thead>
              <tr>
                <th className="text-left font-semibold text-slate-400 p-2 border-b border-slate-800">Permiso</th>
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
                  <td className="p-2 border-b border-slate-800/60 text-slate-300">
                    {PERMISSION_LABELS[permission] ?? permission}
                    <span className="block text-[10px] text-slate-600 font-mono">{permission}</span>
                  </td>
                  {catalog.roles.map((role) => {
                    const locked = isLocked(role, permission);
                    return (
                      <td key={role} className="p-2 border-b border-slate-800/60 text-center">
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-amber-600 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                          checked={(matrix[role] ?? []).includes(permission)}
                          disabled={!canManagePermissions || locked}
                          title={locked ? 'Fijo: no puede quitarse' : undefined}
                          onChange={() => toggle(role, permission)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

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

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-slate-400">
                  <th className="p-2 border-b border-slate-800 font-semibold">Usuario</th>
                  <th className="p-2 border-b border-slate-800 font-semibold">Rol</th>
                  <th className="p-2 border-b border-slate-800 font-semibold">Estado</th>
                  <th className="p-2 border-b border-slate-800 font-semibold text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-800/30">
                    <td className="p-2 border-b border-slate-800/60 text-slate-200">
                      {user.username}
                      {user.id === currentUser.id && (
                        <span className="ml-2 text-[9px] uppercase tracking-wider bg-amber-700 text-white px-1.5 py-0.5 rounded">
                          tú
                        </span>
                      )}
                    </td>
                    <td className="p-2 border-b border-slate-800/60">
                      <select
                        className="bg-slate-950 border border-slate-800 rounded p-1 text-xs outline-none focus:ring-1 focus:ring-amber-500"
                        value={user.role}
                        onChange={(e) => patchUser(user.id, { role: e.target.value as UserRole })}
                      >
                        {catalog.roles.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role] ?? role}
                          </option>
                        ))}
                      </select>
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
          </div>
        </section>
      )}
    </div>
  );
};

export default AdminPanel;
