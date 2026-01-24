
import { Player, GuildWarSession, GuildRank } from '../types';

const PLAYERS_KEY = 'wmgs_players';
const SESSIONS_KEY = 'wmgs_sessions';
const RANKS_KEY = 'wmgs_ranks';

export const storageService = {
  getPlayers: (): Player[] => {
    const data = localStorage.getItem(PLAYERS_KEY);
    return data ? JSON.parse(data) : [];
  },
  savePlayers: (players: Player[]) => {
    localStorage.setItem(PLAYERS_KEY, JSON.stringify(players));
  },
  getSessions: (): GuildWarSession[] => {
    const data = localStorage.getItem(SESSIONS_KEY);
    return data ? JSON.parse(data) : [];
  },
  saveSessions: (sessions: GuildWarSession[]) => {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  },
  getRanks: (): GuildRank[] => {
    const data = localStorage.getItem(RANKS_KEY);
    return data ? JSON.parse(data) : [];
  },
  saveRanks: (ranks: GuildRank[]) => {
    localStorage.setItem(RANKS_KEY, JSON.stringify(ranks));
  },

  // Export all data to a single JSON object
  exportAllData: () => {
    const data = {
      players: storageService.getPlayers(),
      sessions: storageService.getSessions(),
      ranks: storageService.getRanks(),
      exportedAt: new Date().toISOString(),
      version: "1.0"
    };
    
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

  // Import all data from a JSON object
  importAllData: async (file: File): Promise<boolean> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          const data = JSON.parse(content);
          
          if (data.players && data.sessions && data.ranks) {
            storageService.savePlayers(data.players);
            storageService.saveSessions(data.sessions);
            storageService.saveRanks(data.ranks);
            resolve(true);
          } else {
            resolve(false);
          }
        } catch (err) {
          console.error("Failed to parse import file", err);
          resolve(false);
        }
      };
      reader.onerror = () => resolve(false);
      reader.readAsText(file);
    });
  }
};
