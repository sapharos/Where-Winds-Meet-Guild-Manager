
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Peer } from 'peerjs';
import { Player, GuildWarSession, Lane, TacticalGroup, MembershipStatus, GuildRank, PeerRole, SyncPacket } from './types';
import { storageService } from './services/storageService';
import { DEFAULT_GROUPS } from './constants';
import MemberManager from './components/MemberManager';
import WarPlanner from './components/WarPlanner';
import CollaborationPanel from './components/CollaborationPanel';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'roster' | 'war-room'>('roster');
  const [players, setPlayers] = useState<Player[]>([]);
  const [sessions, setSessions] = useState<GuildWarSession[]>([]);
  const [ranks, setRanks] = useState<GuildRank[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Collaboration State
  const [peerRole, setPeerRole] = useState<PeerRole>('STANDALONE');
  const [myPeerId, setMyPeerId] = useState<string | null>(null);
  const peerRef = useRef<any>(null);
  const connectionsRef = useRef<any[]>([]);
  const [connectedPeers, setConnectedPeers] = useState(0);

  const loadAllData = useCallback(() => {
    const loadedPlayers = storageService.getPlayers();
    const loadedSessions = storageService.getSessions();
    const loadedRanks = storageService.getRanks();
    
    setPlayers(loadedPlayers);
    setSessions(loadedSessions);
    
    if (loadedRanks.length === 0) {
      const defaultRanks: GuildRank[] = [
        { id: 'rank-leader', name: 'Guild Leader', color: '#fbbf24' },
        { id: 'rank-manager', name: 'Guild Manager', color: '#60a5fa' },
      ];
      setRanks(defaultRanks);
      storageService.saveRanks(defaultRanks);
    } else {
      setRanks(loadedRanks);
    }
    
    if (loadedSessions.length > 0) {
      setActiveSessionId(loadedSessions[0].id);
    } else {
      const newSession: GuildWarSession = {
        id: 'initial-session',
        name: 'Operation: Wind Guard',
        date: new Date().toISOString(),
        assignments: [],
        groups: [...DEFAULT_GROUPS]
      };
      setSessions([newSession]);
      setActiveSessionId(newSession.id);
      storageService.saveSessions([newSession]);
    }
  }, []);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // PeerJS logic
  const broadcastState = useCallback((p: Player[], s: GuildWarSession[], r: GuildRank[]) => {
    if (peerRole !== 'HOST' || connectionsRef.current.length === 0) return;
    const packet: SyncPacket = {
      players: p,
      sessions: s,
      ranks: r,
      timestamp: Date.now()
    };
    connectionsRef.current.forEach(conn => {
      if (conn.open) conn.send(packet);
    });
  }, [peerRole]);

  // Sync state whenever it changes IF we are the HOST
  useEffect(() => {
    if (peerRole === 'HOST') {
      broadcastState(players, sessions, ranks);
    }
  }, [players, sessions, ranks, peerRole, broadcastState]);

  const handleHost = () => {
    const peer = new Peer();
    peerRef.current = peer;

    peer.on('open', (id) => {
      setMyPeerId(id);
      setPeerRole('HOST');
    });

    peer.on('connection', (conn) => {
      connectionsRef.current.push(conn);
      setConnectedPeers(prev => prev + 1);
      
      conn.on('open', () => {
        // Send initial state to new connection
        const packet: SyncPacket = {
          players,
          sessions,
          ranks,
          timestamp: Date.now()
        };
        conn.send(packet);
      });

      conn.on('close', () => {
        connectionsRef.current = connectionsRef.current.filter(c => c.peer !== conn.peer);
        setConnectedPeers(prev => Math.max(0, prev - 1));
      });
    });

    peer.on('error', (err) => {
      console.error('Peer error:', err);
      alert('Collaboration error: ' + err.type);
    });
  };

  const handleJoin = (hostId: string) => {
    const peer = new Peer();
    peerRef.current = peer;

    peer.on('open', () => {
      const conn = peer.connect(hostId);
      
      conn.on('open', () => {
        setPeerRole('CLIENT');
      });

      conn.on('data', (data: any) => {
        const packet = data as SyncPacket;
        if (packet.players && packet.sessions && packet.ranks) {
          setPlayers(packet.players);
          setSessions(packet.sessions);
          setRanks(packet.ranks);
          if (packet.sessions.length > 0) {
            setActiveSessionId(packet.sessions[0].id);
          }
        }
      });

      conn.on('close', () => {
        alert('Commander has disconnected.');
        handleDisconnect();
      });
    });

    peer.on('error', (err) => {
      alert('Failed to link command: ' + err.type);
      handleDisconnect();
    });
  };

  const handleDisconnect = () => {
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    connectionsRef.current = [];
    setConnectedPeers(0);
    setMyPeerId(null);
    setPeerRole('STANDALONE');
    loadAllData(); // Revert to local state
  };

  const handleAddPlayer = (p: Player) => {
    if (peerRole === 'CLIENT') return;
    const updated = [...players, p];
    setPlayers(updated);
    storageService.savePlayers(updated);
  };

  const handleUpdatePlayer = (p: Player) => {
    if (peerRole === 'CLIENT') return;
    const updated = players.map(prev => prev.id === p.id ? p : prev);
    setPlayers(updated);
    storageService.savePlayers(updated);
  };

  const handleDeletePlayer = (id: string) => {
    if (peerRole === 'CLIENT') return;
    const updated = players.filter(p => p.id !== id);
    setPlayers(updated);
    storageService.savePlayers(updated);
    
    const updatedSessions = sessions.map(s => ({
      ...s,
      assignments: s.assignments.filter(a => a.playerId !== id)
    }));
    setSessions(updatedSessions);
    storageService.saveSessions(updatedSessions);
  };

  const handleAddRank = (r: GuildRank) => {
    if (peerRole === 'CLIENT') return;
    const updated = [...ranks, r];
    setRanks(updated);
    storageService.saveRanks(updated);
  };

  const handleDeleteRank = (id: string) => {
    if (peerRole === 'CLIENT') return;
    const updated = ranks.filter(r => r.id !== id);
    setRanks(updated);
    storageService.saveRanks(updated);
    
    const updatedPlayers = players.map(p => p.rankId === id ? { ...p, rankId: undefined } : p);
    setPlayers(updatedPlayers);
    storageService.savePlayers(updatedPlayers);
  };

  const handleExport = () => storageService.exportAllData();
  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (peerRole === 'CLIENT') return;
    const file = e.target.files?.[0];
    if (file) {
      const success = await storageService.importAllData(file);
      if (success) {
        loadAllData();
        alert("Guild data successfully imported!");
      }
    }
    if (e.target) e.target.value = '';
  };

  const activeSession = sessions.find(s => s.id === activeSessionId);

  const handleUpdateSession = (updatedSession: GuildWarSession) => {
    if (peerRole === 'CLIENT') return;
    const updated = sessions.map(s => s.id === updatedSession.id ? updatedSession : s);
    setSessions(updated);
    storageService.saveSessions(updated);
  };

  return (
    <div className="min-h-screen bg-[#0a0b0c] text-slate-200">
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 bg-gradient-to-br from-amber-600 to-amber-900 rounded-lg flex items-center justify-center shadow-lg border border-amber-500/30 ${peerRole === 'HOST' ? 'pulse-gold' : ''}`}>
              <i className="fa-solid fa-wind text-2xl text-white"></i>
            </div>
            <div>
              <h1 className="cinzel text-2xl font-bold tracking-widest text-white leading-none">WHERE WINDS MEET</h1>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-[10px] uppercase tracking-[0.2em] text-amber-500 font-bold">Strategic Command</p>
                {peerRole === 'HOST' && <span className="bg-amber-600 text-[8px] px-1.5 py-0.5 rounded text-white font-bold animate-pulse">EDITOR</span>}
                {peerRole === 'CLIENT' && <span className="bg-blue-600 text-[8px] px-1.5 py-0.5 rounded text-white font-bold">VIEWER</span>}
              </div>
            </div>
          </div>

          <nav className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button 
              onClick={() => setActiveTab('roster')}
              className={`px-6 py-2 rounded-md text-sm font-semibold transition-all flex items-center gap-2 ${activeTab === 'roster' ? 'bg-amber-700 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <i className="fa-solid fa-users"></i>
              Guild Roster
            </button>
            <button 
              onClick={() => setActiveTab('war-room')}
              className={`px-6 py-2 rounded-md text-sm font-semibold transition-all flex items-center gap-2 ${activeTab === 'war-room' ? 'bg-amber-700 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <i className="fa-solid fa-chess-knight"></i>
              War Room
            </button>
          </nav>

          <div className="flex items-center gap-4">
             <CollaborationPanel 
                peerId={myPeerId} 
                role={peerRole} 
                onHost={handleHost} 
                onJoin={handleJoin} 
                onDisconnect={handleDisconnect}
                connectedCount={connectedPeers}
             />
             
             <div className="h-8 w-px bg-slate-800 hidden xl:block"></div>
             
             <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
                <button 
                  onClick={handleExport}
                  className="p-2 text-slate-400 hover:text-amber-500 hover:bg-slate-900 rounded transition-all"
                  title="Export Guild Data"
                >
                  <i className="fa-solid fa-download"></i>
                </button>
                <button 
                  onClick={handleImportClick}
                  disabled={peerRole === 'CLIENT'}
                  className={`p-2 rounded transition-all ${peerRole === 'CLIENT' ? 'text-slate-700 cursor-not-allowed' : 'text-slate-400 hover:text-amber-500 hover:bg-slate-900'}`}
                  title="Import Guild Data"
                >
                  <i className="fa-solid fa-upload"></i>
                </button>
                <input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={handleFileImport} />
             </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto p-6">
        {activeTab === 'roster' ? (
          <MemberManager 
            players={players} 
            ranks={ranks}
            isViewer={peerRole === 'CLIENT'}
            onAdd={handleAddPlayer} 
            onUpdate={handleUpdatePlayer} 
            onDelete={handleDeletePlayer}
            onAddRank={handleAddRank}
            onDeleteRank={handleDeleteRank}
          />
        ) : (
          activeSession ? (
            <WarPlanner 
              players={players} 
              isViewer={peerRole === 'CLIENT'}
              activeSession={{...activeSession, ranks} as any}
              onUpdateSession={handleUpdateSession}
            />
          ) : (
            <div className="flex items-center justify-center h-96">
               <p className="text-slate-500">Initializing tactical interface...</p>
            </div>
          )
        )}
      </main>

      {activeTab === 'war-room' && (
        <footer className="fixed bottom-0 left-0 right-0 bg-slate-950/90 backdrop-blur-md border-t border-slate-800 p-3 flex justify-center z-50">
           <div className="flex items-center gap-8 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              <span className="flex items-center gap-2">
                 <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
                 Defensive Grade: <span className="text-white">OPTIMIZED</span>
              </span>
              <span className="flex items-center gap-2">
                 <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                 Siegemastery: <span className="text-white">BALANCED</span>
              </span>
              <span className="flex items-center gap-2">
                 <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                 Sustain Matrix: <span className="text-white">STABLE</span>
              </span>
           </div>
        </footer>
      )}
    </div>
  );
};

export default App;
