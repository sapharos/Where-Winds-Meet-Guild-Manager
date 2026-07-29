
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Peer } from 'peerjs';
import { Player, GuildWarSession, Lane, TacticalGroup, MembershipStatus, GuildRank, PeerRole, SyncPacket, ROLE_LABELS, PlayerBuild, WeaponSet } from './types';
import { storageService } from './services/storageService';
import { authService, api, ApiError, Session } from './services/authService';
import { DEFAULT_GROUPS } from './constants';
import MemberManager from './components/MemberManager';
import WarPlanner from './components/WarPlanner';
import CollaborationPanel from './components/CollaborationPanel';
import LoginScreen from './components/LoginScreen';
import AdminPanel from './components/AdminPanel';
import ScanImport from './components/ScanImport';
import MemberHistory from './components/MemberHistory';
import BuildEditor from './components/BuildEditor';

const App: React.FC = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [activeTab, setActiveTab] = useState<'roster' | 'war-room' | 'scan' | 'admin'>('roster');
  const [historyFor, setHistoryFor] = useState<Player | null>(null);
  const [buildsFor, setBuildsFor] = useState<Player | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [sessions, setSessions] = useState<GuildWarSession[]>([]);
  const [ranks, setRanks] = useState<GuildRank[]>([]);
  const [builds, setBuilds] = useState<PlayerBuild[]>([]);
  const [weaponSets, setWeaponSets] = useState<WeaponSet[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Collaboration State
  const [peerRole, setPeerRole] = useState<PeerRole>('STANDALONE');
  const [myPeerId, setMyPeerId] = useState<string | null>(null);
  const peerRef = useRef<any>(null);
  const connectionsRef = useRef<any[]>([]);
  const [connectedPeers, setConnectedPeers] = useState(0);

  const can = useCallback(
    (permission: string) => session?.permissions.includes(permission) ?? false,
    [session],
  );

  // Two independent reasons a section can be read-only: the role does not grant
  // the permission, or this browser is following someone else's broadcast.
  const rosterLocked = peerRole === 'CLIENT' || !can('roster.edit');
  const ranksLocked = peerRole === 'CLIENT' || !can('ranks.manage');
  const warLocked = peerRole === 'CLIENT' || !can('war.edit');

  // Surfaces a write failure instead of letting the UI show state the server
  // never accepted. An expired session drops back to the login screen rather
  // than reporting a save error the user cannot act on.
  const persist = useCallback((op: Promise<unknown>) => {
    op.then(() => setSaveError(null)).catch((err) => {
      if (err instanceof ApiError && err.status === 401) {
        setSession(null);
        return;
      }
      console.error('Save failed', err);
      setSaveError(
        err instanceof ApiError && err.status === 403
          ? 'Your role does not allow that change.'
          : 'Changes could not be saved. Check the connection to the server.',
      );
    });
  }, []);

  const loadAllData = useCallback(async () => {
    setIsLoading(true);
    try {
      const { players: loadedPlayers, sessions: loadedSessions, ranks: loadedRanks } =
        await storageService.getState();

      setPlayers(loadedPlayers);
      setSessions(loadedSessions);

      // Builds and their weapon sets paint the roster cards, so they load with
      // everything else. A failure here must not hide the roster itself.
      void Promise.all([
        api<PlayerBuild[]>('/builds').catch(() => []),
        api<WeaponSet[]>('/weapon-sets').catch(() => []),
      ]).then(([loadedBuilds, loadedSets]) => {
        setBuilds(loadedBuilds);
        setWeaponSets(loadedSets);
      });

      // The first visitor to an empty guild seeds the defaults, but only if
      // their role is allowed to write them -- a plain member signing in first
      // should not be met with a permission error.
      if (loadedRanks.length === 0) {
        const defaultRanks: GuildRank[] = [
          { id: 'rank-leader', name: 'Guild Leader', color: '#fbbf24' },
          { id: 'rank-manager', name: 'Guild Manager', color: '#60a5fa' },
        ];
        setRanks(defaultRanks);
        if (can('ranks.manage')) await storageService.saveRanks(defaultRanks);
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
        if (can('war.edit')) await storageService.saveSessions([newSession]);
      }
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSession(null);
        return;
      }
      console.error('Load failed', err);
      setLoadError('Could not reach the guild server. Data shown may be incomplete.');
    } finally {
      setIsLoading(false);
    }
  }, [can]);

  // Restores an existing session on load; the cookie is httpOnly, so only the
  // server can tell us whether one is still valid.
  useEffect(() => {
    authService
      .me()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    if (session) void loadAllData();
  }, [session, loadAllData]);

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
    void loadAllData(); // Revert to the server's copy
  };

  const handleAddPlayer = (p: Player) => {
    if (rosterLocked) return;
    const updated = [...players, p];
    setPlayers(updated);
    persist(storageService.savePlayers(updated));
  };

  const handleUpdatePlayer = (p: Player) => {
    if (rosterLocked) return;
    const updated = players.map(prev => prev.id === p.id ? p : prev);
    setPlayers(updated);
    persist(storageService.savePlayers(updated));
  };

  const handleDeletePlayer = (id: string) => {
    if (rosterLocked) return;
    const updated = players.filter(p => p.id !== id);
    setPlayers(updated);
    persist(storageService.savePlayers(updated));

    const updatedSessions = sessions.map(s => ({
      ...s,
      assignments: s.assignments.filter(a => a.playerId !== id)
    }));
    setSessions(updatedSessions);
    // Dropping a member also clears their deployments, which is a war-room
    // write and needs that permission separately.
    if (!warLocked) persist(storageService.saveSessions(updatedSessions));
  };

  const handleAddRank = (r: GuildRank) => {
    if (ranksLocked) return;
    const updated = [...ranks, r];
    setRanks(updated);
    persist(storageService.saveRanks(updated));
  };

  const handleDeleteRank = (id: string) => {
    if (ranksLocked) return;
    const updated = ranks.filter(r => r.id !== id);
    setRanks(updated);
    persist(storageService.saveRanks(updated));

    const updatedPlayers = players.map(p => p.rankId === id ? { ...p, rankId: undefined } : p);
    setPlayers(updatedPlayers);
    if (!rosterLocked) persist(storageService.savePlayers(updatedPlayers));
  };

  const handleExport = () => storageService.exportAllData();
  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (peerRole === 'CLIENT' || !can('data.import')) return;
    const file = e.target.files?.[0];
    if (file) {
      const success = await storageService.importAllData(file);
      if (success) {
        await loadAllData();
        alert("Guild data successfully imported!");
      } else {
        alert("That file could not be imported.");
      }
    }
    if (e.target) e.target.value = '';
  };

  const handleToggleStarter = (p: Player) => {
    if (rosterLocked) return;
    const next = !p.isStarter;
    setPlayers((prev) => prev.map((x) => (x.id === p.id ? { ...x, isStarter: next } : x)));
    persist(
      api(`/players/${p.id}/starter`, { method: 'PATCH', body: JSON.stringify({ isStarter: next }) }),
    );
  };

  const handleLogin = async (username: string, password: string) => {
    setSession(await authService.login(username, password));
  };

  const handleLogout = async () => {
    if (peerRef.current) handleDisconnect();
    await authService.logout().catch(() => undefined);
    setSession(null);
    setPlayers([]);
    setSessions([]);
    setRanks([]);
    setActiveTab('roster');
  };

  const handleChangePassword = async () => {
    const currentPassword = window.prompt('Contraseña actual:');
    if (!currentPassword) return;
    const newPassword = window.prompt('Nueva contraseña (mínimo 8 caracteres):');
    if (!newPassword) return;
    try {
      await authService.changePassword(currentPassword, newPassword);
      alert('Contraseña actualizada.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo cambiar la contraseña.');
    }
  };

  const activeSession = sessions.find(s => s.id === activeSessionId);
  const canSeeAdmin = can('users.manage') || can('permissions.manage') || can('builds.manage');

  const handleUpdateSession = (updatedSession: GuildWarSession) => {
    if (warLocked) return;
    const updated = sessions.map(s => s.id === updatedSession.id ? updatedSession : s);
    setSessions(updated);
    persist(storageService.saveSessions(updated));
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#0a0b0c] text-slate-500 flex items-center justify-center gap-3">
        <i className="fa-solid fa-circle-notch fa-spin"></i>
        Cargando...
      </div>
    );
  }

  if (!session) {
    return <LoginScreen onLogin={handleLogin} />;
  }

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
            {can('roster.edit') && (
              <button
                onClick={() => setActiveTab('scan')}
                className={`px-6 py-2 rounded-md text-sm font-semibold transition-all flex items-center gap-2 ${activeTab === 'scan' ? 'bg-amber-700 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
              >
                <i className="fa-solid fa-file-import"></i>
                Escaneo
              </button>
            )}
            {canSeeAdmin && (
              <button
                onClick={() => setActiveTab('admin')}
                className={`px-6 py-2 rounded-md text-sm font-semibold transition-all flex items-center gap-2 ${activeTab === 'admin' ? 'bg-amber-700 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
              >
                <i className="fa-solid fa-user-shield"></i>
                Administración
              </button>
            )}
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
                {can('data.export') && (
                  <button
                    onClick={handleExport}
                    className="p-2 text-slate-400 hover:text-amber-500 hover:bg-slate-900 rounded transition-all"
                    title="Export Guild Data"
                  >
                    <i className="fa-solid fa-download"></i>
                  </button>
                )}
                {can('data.import') && (
                  <button
                    onClick={handleImportClick}
                    disabled={peerRole === 'CLIENT'}
                    className={`p-2 rounded transition-all ${peerRole === 'CLIENT' ? 'text-slate-700 cursor-not-allowed' : 'text-slate-400 hover:text-amber-500 hover:bg-slate-900'}`}
                    title="Import Guild Data"
                  >
                    <i className="fa-solid fa-upload"></i>
                  </button>
                )}
                <input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={handleFileImport} />
             </div>

             <div className="h-8 w-px bg-slate-800 hidden xl:block"></div>

             <div className="flex items-center gap-3">
                <div className="text-right leading-tight hidden sm:block">
                   <div className="text-sm font-semibold text-white">{session.user.username}</div>
                   <div className="text-[10px] uppercase tracking-wider text-amber-500 font-bold">
                     {ROLE_LABELS[session.user.role] ?? session.user.role}
                   </div>
                </div>
                <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
                   <button
                     onClick={handleChangePassword}
                     className="p-2 text-slate-400 hover:text-amber-500 hover:bg-slate-900 rounded transition-all"
                     title="Cambiar contraseña"
                   >
                     <i className="fa-solid fa-key"></i>
                   </button>
                   <button
                     onClick={handleLogout}
                     className="p-2 text-slate-400 hover:text-amber-500 hover:bg-slate-900 rounded transition-all"
                     title="Cerrar sesión"
                   >
                     <i className="fa-solid fa-right-from-bracket"></i>
                   </button>
                </div>
             </div>
          </div>
        </div>
      </header>

      {(loadError || saveError) && (
        <div className="bg-red-950/80 border-b border-red-800 text-red-200 text-sm px-6 py-2 flex items-center gap-3">
          <i className="fa-solid fa-triangle-exclamation"></i>
          <span>{loadError || saveError}</span>
        </div>
      )}

      <main className="max-w-[1600px] mx-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-96 text-slate-500 gap-3">
            <i className="fa-solid fa-circle-notch fa-spin"></i>
            Loading guild data...
          </div>
        ) : activeTab === 'scan' ? (
          <ScanImport players={players} onImported={() => void loadAllData()} />
        ) : activeTab === 'admin' ? (
          <AdminPanel
            currentUser={session.user}
            canManageUsers={can('users.manage')}
            canManagePermissions={can('permissions.manage')}
            canManageBuilds={can('builds.manage')}
          />
        ) : activeTab === 'roster' ? (
          <MemberManager
            players={players}
            ranks={ranks}
            isViewer={rosterLocked}
            onAdd={handleAddPlayer}
            onUpdate={handleUpdatePlayer}
            onDelete={handleDeletePlayer}
            onAddRank={handleAddRank}
            onDeleteRank={handleDeleteRank}
            onShowHistory={setHistoryFor}
            onShowBuilds={setBuildsFor}
            onToggleStarter={handleToggleStarter}
            builds={builds}
            weaponSets={weaponSets}
            canManageRanks={!ranksLocked}
          />
        ) : (
          activeSession ? (
            <WarPlanner
              players={players}
              isViewer={warLocked}
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

      {historyFor && <MemberHistory player={historyFor} onClose={() => setHistoryFor(null)} />}

      {buildsFor && (
        <BuildEditor
          player={buildsFor}
          canEdit={peerRole !== 'CLIENT' && can('builds.manage')}
          onClose={() => setBuildsFor(null)}
          onSaved={() => void loadAllData()}
        />
      )}

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
