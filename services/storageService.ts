
import { Player, GuildWarSession, GuildRank } from '../types';

// Same origin: nginx proxies /api to the API container.
const API = '/api';

export interface GuildState {
  players: Player[];
  sessions: GuildWarSession[];
  ranks: GuildRank[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path} failed with ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const storageService = {
  getState: (): Promise<GuildState> => request<GuildState>('/state'),

  savePlayers: (players: Player[]) =>
    request('/players', { method: 'PUT', body: JSON.stringify(players) }),

  saveSessions: (sessions: GuildWarSession[]) =>
    request('/sessions', { method: 'PUT', body: JSON.stringify(sessions) }),

  saveRanks: (ranks: GuildRank[]) =>
    request('/ranks', { method: 'PUT', body: JSON.stringify(ranks) }),

  exportAllData: async () => {
    const state = await storageService.getState();
    const data = { ...state, exportedAt: new Date().toISOString(), version: '2.0' };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `WindsMeet_GuildBackup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  // Accepts backups written by the old localStorage build as well as the
  // current one -- the shape of the three collections never changed.
  importAllData: async (file: File): Promise<boolean> => {
    try {
      const data = JSON.parse(await file.text());
      if (!data.players || !data.sessions || !data.ranks) return false;

      await storageService.savePlayers(data.players);
      await storageService.saveRanks(data.ranks);
      await storageService.saveSessions(data.sessions);
      return true;
    } catch (err) {
      console.error('Failed to import backup', err);
      return false;
    }
  },
};
