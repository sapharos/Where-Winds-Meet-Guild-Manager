
import { AuthUser, ManagedUser, PermissionCatalog, UserRole } from '../types';

const API = '/api';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

  if (!res.ok) {
    // The API reports why in a JSON body; fall back to the status when it did not.
    const detail = await res.json().catch(() => null);
    throw new ApiError(detail?.error ?? `Request failed (${res.status})`, res.status);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export interface Session {
  user: AuthUser;
  permissions: string[];
}

export const authService = {
  me: () => api<Session>('/auth/me'),

  login: (username: string, password: string) =>
    api<Session>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),

  logout: () => api<{ ok: true }>('/auth/logout', { method: 'POST' }),

  changePassword: (currentPassword: string, newPassword: string) =>
    api<{ ok: true }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  listUsers: () => api<ManagedUser[]>('/users'),

  createUser: (username: string, password: string, role: UserRole) =>
    api<ManagedUser>('/users', { method: 'POST', body: JSON.stringify({ username, password, role }) }),

  updateUser: (id: string, changes: { role?: UserRole; password?: string; disabled?: boolean }) =>
    api<{ ok: true }>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(changes) }),

  deleteUser: (id: string) => api<{ ok: true }>(`/users/${id}`, { method: 'DELETE' }),

  getPermissions: () => api<PermissionCatalog>('/permissions'),

  savePermissions: (matrix: Record<string, string[]>) =>
    api<{ matrix: Record<string, string[]> }>('/permissions', {
      method: 'PUT',
      body: JSON.stringify({ matrix }),
    }),
};
