
import React, { useState, useMemo } from 'react';
import { Player, Role, Lane, TacticalGroup, WarAssignment, GuildWarSession, GuildRank, LANE_NAMES } from '../types';
import { LANE_DATA, MAX_WAR_PLAYERS, GROUP_ICONS, GROUP_COLORS, ROLE_ICONS, ROLE_COLORS } from '../constants';
import PlayerCard from './PlayerCard';

interface WarPlannerProps {
  players: Player[];
  activeSession: GuildWarSession & { ranks?: GuildRank[] };
  onUpdateSession: (session: GuildWarSession) => void;
  isViewer?: boolean;
}

const WarPlanner: React.FC<WarPlannerProps> = ({ players, activeSession, onUpdateSession, isViewer = false }) => {
  const [viewMode, setViewMode] = useState<'lanes' | 'tactical'>('lanes');
  const [selectedLane, setSelectedLane] = useState<Lane>(Lane.MID);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupIcon, setNewGroupIcon] = useState(GROUP_ICONS[0]);
  const [newGroupColor, setNewGroupColor] = useState(GROUP_COLORS[0]);

  const assignments = activeSession.assignments;
  const groups = activeSession.groups || [];
  const ranks = activeSession.ranks || [];
  
  const assignedPlayerIds = useMemo(() => new Set(assignments.map(a => a.playerId)), [assignments]);
  
  const unassignedPlayers = useMemo(() => 
    players.filter(p => !assignedPlayerIds.has(p.id)),
  [players, assignedPlayerIds]);

  const playersInLane = (lane: Lane) => 
    assignments.filter(a => a.lane === lane)
      .map(a => ({
        assignment: a,
        player: players.find(p => p.id === a.playerId)!
      }))
      .filter(item => item.player);

  const playersInGroup = (groupId: string) =>
    assignments.filter(a => a.groupId === groupId)
      .map(a => ({
        assignment: a,
        player: players.find(p => p.id === a.playerId)!
      }))
      .filter(item => item.player);

  const toggleGroupAssignment = (playerId: string, groupId: string) => {
    if (isViewer) return;
    const newAssignments = assignments.map(a => {
      if (a.playerId === playerId) {
        return { ...a, groupId: a.groupId === groupId ? null : groupId };
      }
      return a;
    });
    onUpdateSession({ ...activeSession, assignments: newAssignments });
  };

  const createGroup = () => {
    if (isViewer || !newGroupName.trim()) return;
    const newGroup: TacticalGroup = {
      id: `custom-${Date.now()}`,
      name: newGroupName,
      icon: newGroupIcon,
      color: newGroupColor
    };
    onUpdateSession({ ...activeSession, groups: [...groups, newGroup] });
    setNewGroupName('');
    setIsCreatingGroup(false);
  };

  const deleteGroup = (groupId: string) => {
    if (isViewer) return;
    const updatedGroups = groups.filter(g => g.id !== groupId);
    const updatedAssignments = assignments.map(a => 
      a.groupId === groupId ? { ...a, groupId: null } : a
    );
    onUpdateSession({ ...activeSession, groups: updatedGroups, assignments: updatedAssignments });
  };

  const assignPlayer = (playerId: string) => {
    if (isViewer || assignments.length >= MAX_WAR_PLAYERS) return;
    const newAssignment: WarAssignment = {
      playerId,
      lane: selectedLane,
      groupId: null
    };
    onUpdateSession({ ...activeSession, assignments: [...assignments, newAssignment] });
  };

  const removePlayer = (playerId: string) => {
    if (isViewer) return;
    onUpdateSession({ 
      ...activeSession, 
      assignments: assignments.filter(a => a.playerId !== playerId) 
    });
    if (selectedPlayerId === playerId) setSelectedPlayerId(null);
  };

  const movePlayer = (playerId: string, newLane: Lane) => {
    if (isViewer) return;
    onUpdateSession({
      ...activeSession,
      assignments: assignments.map(a => a.playerId === playerId ? { ...a, lane: newLane } : a)
    });
  };

  const getRoleCount = (role: Role) => 
    assignments.filter(a => players.find(p => p.id === a.playerId)?.role === role).length;

  const getGroupColorClasses = (color: string) => {
    const map: Record<string, { border: string, text: string, bg: string, ring: string }> = {
      amber: { border: 'border-amber-900/50', text: 'text-amber-500', bg: 'bg-amber-900/20', ring: 'ring-amber-500' },
      indigo: { border: 'border-indigo-900/50', text: 'text-indigo-400', bg: 'bg-indigo-900/20', ring: 'ring-indigo-500' },
      cyan: { border: 'border-cyan-900/50', text: 'text-cyan-400', bg: 'bg-cyan-900/20', ring: 'ring-cyan-500' },
      rose: { border: 'border-rose-900/50', text: 'text-rose-400', bg: 'bg-rose-900/20', ring: 'ring-rose-500' },
      emerald: { border: 'border-emerald-900/50', text: 'text-emerald-400', bg: 'bg-emerald-900/20', ring: 'ring-emerald-500' },
      violet: { border: 'border-violet-900/50', text: 'text-violet-400', bg: 'bg-violet-900/20', ring: 'ring-violet-500' },
      orange: { border: 'border-orange-900/50', text: 'text-orange-400', bg: 'bg-orange-900/20', ring: 'ring-orange-500' },
      sky: { border: 'border-sky-900/50', text: 'text-sky-400', bg: 'bg-sky-900/20', ring: 'ring-sky-500' },
    };
    return map[color] || map.amber;
  };

  const selectedAssignment = assignments.find(a => a.playerId === selectedPlayerId);
  const selectedPlayer = players.find(p => p.id === selectedPlayerId);

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-full relative">
      
      {/* SIDEBAR: Disponibles */}
      <div className={`w-full lg:w-80 flex flex-col gap-4 ${isViewer ? 'opacity-60 cursor-not-allowed grayscale-[0.5]' : ''}`}>
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-col h-[calc(100vh-180px)]">
          <div className="mb-4">
            <h3 className="cinzel text-lg font-bold text-amber-500 flex justify-between items-center">
              Disponibles
              <span className="text-xs bg-slate-800 text-slate-300 px-2 py-1 rounded font-sans">
                {unassignedPlayers.length}
              </span>
            </h3>
            <p className="text-[10px] text-slate-500 uppercase tracking-tighter mt-1 italic">
              {isViewer ? 'Solo lectura' : `Asignar a ${LANE_NAMES[selectedLane].replace('Línea ', '')}`}
            </p>
          </div>
          
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
            {unassignedPlayers.length === 0 ? (
              <div className="text-center py-12 text-slate-700">
                <i className="fa-solid fa-people-group text-3xl mb-3 opacity-20"></i>
                <p className="text-xs font-bold uppercase tracking-widest opacity-40">Todos asignados</p>
              </div>
            ) : (
              unassignedPlayers.map(p => (
                <div key={p.id} onClick={() => !isViewer && assignPlayer(p.id)} className={`${isViewer ? 'cursor-default' : 'cursor-pointer group'}`}>
                  <PlayerCard player={p} compact ranks={ranks} className={`${isViewer ? '' : 'group-hover:border-amber-600/50 group-hover:bg-slate-800/50 transition-all'}`} />
                </div>
              ))
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-slate-800 space-y-2">
            <div className="flex justify-between text-xs">
               <span className="text-slate-500 uppercase font-bold text-[10px]">Fuerza de guerra</span>
               <span className={assignments.length === 30 ? 'text-green-400 font-bold' : 'text-slate-200'}>
                  {assignments.length} / {MAX_WAR_PLAYERS}
               </span>
            </div>
            <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden border border-slate-900 shadow-inner">
               <div 
                className={`h-full transition-all duration-700 ease-out shadow-[0_0_8px_rgba(217,119,6,0.3)] ${assignments.length === 30 ? 'bg-green-500' : 'bg-amber-600'}`}
                style={{ width: `${(assignments.length / MAX_WAR_PLAYERS) * 100}%` }}
               />
            </div>
          </div>
        </div>
      </div>

      {/* MODAL: Strategic Orders */}
      {selectedPlayer && selectedAssignment && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setSelectedPlayerId(null)}>
          <div 
            className="w-full max-w-md bg-[#0f1115] border border-amber-500/30 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-amber-900/40 to-transparent p-5 border-b border-slate-800/50 flex justify-between items-center">
              <div>
                <h3 className="cinzel text-amber-500 font-bold text-lg uppercase tracking-[0.2em]">{isViewer ? 'Deployment Intel' : 'Strategic Orders'}</h3>
                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mt-1">Combatant: {selectedPlayer.name}</p>
              </div>
              <button onClick={() => setSelectedPlayerId(null)} className="w-10 h-10 rounded-full flex items-center justify-center text-slate-500 hover:text-white hover:bg-slate-800 transition-all">
                <i className="fa-solid fa-xmark text-lg"></i>
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-800">
                <PlayerCard player={selectedPlayer} compact ranks={ranks} className="border-none bg-transparent" />
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500 block mb-3 tracking-[0.2em] flex items-center gap-2">
                  <i className="fa-solid fa-crosshairs text-amber-500/50"></i>
                  Tactical Unit Assignment
                </label>
                <div className="grid grid-cols-1 gap-2 max-h-[180px] overflow-y-auto custom-scrollbar pr-1">
                  {groups.length === 0 ? (
                    <div className="text-[11px] text-slate-600 italic py-4 text-center border border-dashed border-slate-800 rounded-lg">
                      No specialty units commissioned
                    </div>
                  ) : (
                    groups.map(g => {
                      const isActive = selectedAssignment.groupId === g.id;
                      const gStyles = getGroupColorClasses(g.color);
                      return (
                        <button 
                          key={g.id}
                          disabled={isViewer}
                          onClick={() => toggleGroupAssignment(selectedPlayer.id, g.id)}
                          className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs transition-all border
                            ${isActive 
                              ? `${gStyles.bg} ${gStyles.text} ${gStyles.border} shadow-lg ring-1 ${gStyles.ring}` 
                              : `bg-slate-900 border-slate-800 text-slate-400 ${isViewer ? 'opacity-40' : 'hover:border-slate-600'}`}`}
                        >
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isActive ? 'bg-slate-950/40' : 'bg-slate-950'}`}>
                            <i className={`fa-solid ${g.icon}`}></i>
                          </div>
                          <span className="font-bold tracking-widest uppercase truncate">{g.name}</span>
                          {isActive && <i className="fa-solid fa-circle-check ml-auto text-base animate-in zoom-in-50"></i>}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500 block mb-3 tracking-[0.2em] flex items-center gap-2">
                  <i className="fa-solid fa-map-pin text-amber-500/50"></i>
                  Sector Redeployment
                </label>
                <div className="flex gap-2">
                  {LANE_DATA.map(l => (
                    <button 
                      key={l.id}
                      disabled={isViewer}
                      onClick={() => movePlayer(selectedPlayer.id, l.id)}
                      className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-xl text-[10px] font-bold uppercase transition-all border
                        ${selectedAssignment.lane === l.id 
                          ? 'bg-amber-600 border-amber-500 text-white shadow-lg' 
                          : `bg-slate-900 border-slate-800 text-slate-400 ${isViewer ? 'opacity-40' : 'hover:bg-slate-800'}`}`}
                    >
                      <span className="text-base">{l.icon}</span>
                      {LANE_NAMES[l.id].replace('Línea ', '')}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 flex gap-3">
                {!isViewer && (
                  <button 
                    onClick={() => removePlayer(selectedPlayer.id)}
                    className="flex-1 py-3 rounded-xl border border-red-900/30 text-red-500 hover:bg-red-950/50 transition-all text-xs uppercase font-bold tracking-widest"
                  >
                    <i className="fa-solid fa-user-minus mr-2"></i>
                    Withdraw
                  </button>
                )}
                <button 
                  onClick={() => setSelectedPlayerId(null)}
                  className={`flex-1 py-3 rounded-xl bg-slate-800 text-white hover:bg-slate-700 transition-all text-xs uppercase font-bold tracking-widest`}
                >
                  {isViewer ? 'Close Intelligence' : 'Confirm Orders'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col gap-4 overflow-y-auto pr-2 custom-scrollbar">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-slate-900/80 backdrop-blur-sm border border-slate-800 p-4 rounded-xl flex flex-col gap-1 border-l-4 border-l-blue-500 shadow-xl">
            <span className="text-blue-400 text-[10px] uppercase font-bold tracking-widest opacity-80">Tanques</span>
            <span className="text-2xl font-bold cinzel text-white">{getRoleCount(Role.TANK)}</span>
          </div>
          <div className="bg-slate-900/80 backdrop-blur-sm border border-slate-800 p-4 rounded-xl flex flex-col gap-1 border-l-4 border-l-red-500 shadow-xl">
            <span className="text-red-400 text-[10px] uppercase font-bold tracking-widest opacity-80">Ofensiva</span>
            <span className="text-2xl font-bold cinzel text-white">{getRoleCount(Role.DPS)}</span>
          </div>
          <div className="bg-slate-900/80 backdrop-blur-sm border border-slate-800 p-4 rounded-xl flex flex-col gap-1 border-l-4 border-l-green-500 shadow-xl">
            <span className="text-green-400 text-[10px] uppercase font-bold tracking-widest opacity-80">Soporte</span>
            <span className="text-2xl font-bold cinzel text-white">{getRoleCount(Role.HEALER)}</span>
          </div>
          <div className="bg-slate-900/80 backdrop-blur-sm border border-slate-800 p-4 rounded-xl flex flex-col gap-1 border-l-4 border-l-amber-500 shadow-xl">
            <span className="text-amber-500 text-[10px] uppercase font-bold tracking-widest opacity-80">Unidades especiales</span>
            <span className="text-2xl font-bold cinzel text-white">{groups.length}</span>
          </div>
        </div>

        {/* View Toggle */}
        <div className="flex bg-slate-900/50 p-1.5 rounded-2xl border border-slate-800 gap-2">
          <button 
            onClick={() => setViewMode('lanes')}
            className={`flex-1 py-4 rounded-xl font-bold text-xs uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-3
              ${viewMode === 'lanes' 
                ? 'bg-amber-600/10 border border-amber-500/30 text-amber-500 shadow-[0_0_20px_rgba(217,119,6,0.1)]' 
                : 'bg-transparent text-slate-500 border border-transparent hover:text-slate-300'}`}
          >
            <i className="fa-solid fa-map-marked-alt text-base"></i>
            Despliegue por líneas
          </button>
          <button 
            onClick={() => setViewMode('tactical')}
            className={`flex-1 py-4 rounded-xl font-bold text-xs uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-3
              ${viewMode === 'tactical' 
                ? 'bg-indigo-600/10 border border-indigo-500/30 text-indigo-400 shadow-[0_0_20px_rgba(79,70,229,0.1)]' 
                : 'bg-transparent text-slate-500 border border-transparent hover:text-slate-300'}`}
          >
            <i className="fa-solid fa-crosshairs text-base"></i>
            Unidades tácticas
          </button>
        </div>

        {viewMode === 'lanes' ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col h-full">
            <div className="flex border-b border-slate-800 bg-slate-950/50 p-2 gap-2">
              {LANE_DATA.map(lane => (
                <button 
                  key={lane.id}
                  onClick={() => setSelectedLane(lane.id)}
                  className={`flex-1 py-4 px-3 flex items-center justify-center gap-4 font-bold transition-all rounded-xl border
                    ${selectedLane === lane.id 
                      ? 'bg-[#1a1c22] text-amber-500 border-amber-600/30 shadow-lg' 
                      : 'bg-transparent text-slate-500 border-transparent hover:text-slate-300'}`}
                >
                  <span className="text-xl">{lane.icon}</span>
                  <span className="hidden md:inline text-[11px] uppercase tracking-[0.2em] font-bold">{LANE_NAMES[lane.id]}</span>
                  <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-sans ${selectedLane === lane.id ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-500'}`}>
                    {assignments.filter(a => a.lane === lane.id).length}
                  </span>
                </button>
              ))}
            </div>

            <div className="p-8 flex-1">
              <div className="flex items-center justify-between mb-10 border-b border-slate-800/30 pb-6">
                <div className="flex items-center gap-5">
                   <div className="w-14 h-14 rounded-2xl bg-amber-600/10 border border-amber-600/30 flex items-center justify-center text-amber-500 text-2xl shadow-inner">
                      {LANE_DATA.find(l => l.id === selectedLane)?.icon}
                   </div>
                   <div>
                     <h4 className="cinzel text-2xl text-slate-100 font-bold uppercase tracking-widest">{LANE_NAMES[selectedLane]}</h4>
                     <p className="text-[10px] text-slate-500 uppercase font-bold tracking-[0.2em] mt-1">Evaluación de fuerza del sector</p>
                   </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {playersInLane(selectedLane).length === 0 ? (
                  <div className="col-span-full flex flex-col items-center justify-center py-32 text-slate-800 border-2 border-dashed border-slate-800 rounded-3xl opacity-50">
                     <i className="fa-solid fa-ghost text-9xl mb-6 opacity-5"></i>
                     <p className="cinzel uppercase tracking-[0.4em] font-bold text-lg">Sector sin asignar</p>
                  </div>
                ) : (
                  playersInLane(selectedLane).map(({ assignment, player }) => {
                    const group = groups.find(g => g.id === assignment.groupId);
                    const groupStyles = group ? getGroupColorClasses(group.color) : null;
                    const isSelected = selectedPlayerId === player.id;
                    
                    return (
                      <div 
                        key={player.id} 
                        onClick={() => setSelectedPlayerId(player.id)}
                        className={`relative cursor-pointer rounded-2xl transition-all duration-300 group/card
                          ${isSelected ? 'scale-[1.03] z-10' : 'hover:scale-[1.02] hover:-translate-y-1'}`}
                      >
                        {isSelected && (
                          <div className="absolute inset-0 -m-1 rounded-[1.2rem] bg-amber-500/20 blur-md animate-pulse"></div>
                        )}

                        <PlayerCard 
                          player={player} 
                          compact 
                          ranks={ranks} 
                          className={`h-full border-2 transition-all ${isSelected ? 'bg-slate-800 border-amber-500/60 shadow-2xl' : 'border-slate-800 hover:border-slate-700 bg-slate-900/60'}`} 
                        />
                        
                        {group && (
                           <div className={`absolute -top-2 -right-2 w-9 h-9 rounded-xl border-2 border-slate-950 flex items-center justify-center text-sm shadow-[0_5px_15px_rgba(0,0,0,0.5)] z-20 transition-transform
                             ${groupStyles?.bg} ${groupStyles?.text}`}>
                              <i className={`fa-solid ${group.icon}`}></i>
                           </div>
                        )}

                        {!isSelected && !isViewer && (
                          <div className="absolute bottom-2 right-2 opacity-0 group-hover/card:opacity-100 transition-opacity bg-amber-600 text-white text-[8px] px-2 py-0.5 rounded-full font-bold uppercase tracking-widest shadow-lg">
                            Manage
                          </div>
                        )}
                        {isViewer && !isSelected && (
                          <div className="absolute bottom-2 right-2 opacity-0 group-hover/card:opacity-100 transition-opacity bg-blue-600 text-white text-[8px] px-2 py-0.5 rounded-full font-bold uppercase tracking-widest shadow-lg">
                            View Intel
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        ) : (
          /* TACTICAL VIEW */
          <div className="space-y-6 animate-in fade-in duration-500">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {groups.map(group => {
                const gStyles = getGroupColorClasses(group.color);
                const members = playersInGroup(group.id);
                return (
                  <div key={group.id} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl transition-all flex flex-col h-full group/tactical">
                    <div className={`border-b ${gStyles.border} ${gStyles.bg} p-5 flex justify-between items-center relative overflow-hidden`}>
                       <div className="absolute top-0 right-0 w-32 h-32 -mr-10 -mt-10 opacity-10 group-hover/tactical:scale-125 transition-transform">
                          <i className={`fa-solid ${group.icon} text-9xl`}></i>
                       </div>
                       <h4 className={`cinzel font-bold flex items-center gap-4 ${gStyles.text} relative z-10`}>
                          <div className={`w-12 h-12 rounded-xl flex items-center justify-center bg-slate-950/50 shadow-inner border border-white/5`}>
                             <i className={`fa-solid ${group.icon} text-xl`}></i>
                          </div>
                          <div>
                            <span className="tracking-[0.2em] uppercase text-sm font-bold block leading-none">{group.name}</span>
                            <span className="text-[9px] uppercase tracking-widest opacity-60 mt-1 block font-sans">Escuadra especial</span>
                          </div>
                       </h4>
                       <div className="flex items-center gap-4 relative z-10">
                          <span className="text-[10px] bg-slate-950/40 text-white/70 px-3 py-1 rounded-full uppercase font-bold tracking-widest border border-white/5">
                            {members.length} Combatants
                          </span>
                          {!isViewer && (
                            <button 
                              onClick={() => deleteGroup(group.id)}
                              className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-500 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                            >
                               <i className="fa-solid fa-trash-can text-lg"></i>
                            </button>
                          )}
                       </div>
                    </div>
                    <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 max-h-[450px] overflow-y-auto custom-scrollbar">
                       {members.length === 0 ? (
                         <div className="col-span-full py-16 text-center border-2 border-dashed border-slate-800/50 rounded-2xl">
                            <i className={`fa-solid ${group.icon} text-6xl mb-5 text-slate-800 opacity-10`}></i>
                            <p className="text-slate-600 text-[10px] uppercase font-bold tracking-[0.3em]">Sin miembros</p>
                         </div>
                       ) : (
                         members.map(({player, assignment}) => (
                           <div key={player.id} className="group/memb transition-all cursor-pointer" onClick={() => setSelectedPlayerId(player.id)}>
                              <PlayerCard player={player} compact ranks={ranks} className="group-hover/memb:border-amber-600/30 transition-all shadow-sm" />
                              <div className="flex items-center justify-between mt-2 px-1">
                                 <div className="flex items-center gap-2">
                                    <span className="text-[8px] text-slate-600 uppercase font-bold">Sector:</span>
                                    <span className="text-[8px] text-amber-500/70 font-bold uppercase tracking-wider">{assignment.lane}</span>
                                 </div>
                                 <div className="text-[8px] text-slate-700 uppercase font-bold opacity-0 group-hover/memb:opacity-100 transition-opacity">
                                    {isViewer ? 'View Intel' : 'Command Orders'}
                                 </div>
                              </div>
                           </div>
                         ))
                       )}
                    </div>
                  </div>
                );
              })}

              {!isCreatingGroup && !isViewer && (
                <button 
                  onClick={() => setIsCreatingGroup(true)}
                  className="bg-slate-900/30 border-2 border-dashed border-slate-800 rounded-2xl p-12 flex flex-col items-center justify-center gap-6 hover:border-amber-600/30 hover:bg-slate-900/60 transition-all group/new"
                >
                  <div className="w-20 h-20 rounded-3xl bg-slate-800/30 flex items-center justify-center group-hover/new:bg-amber-600/10 transition-all shadow-inner border border-slate-800">
                    <i className="fa-solid fa-scroll text-slate-700 group-hover/new:text-amber-500 text-4xl"></i>
                  </div>
                  <div className="text-center">
                    <span className="text-slate-500 font-bold block cinzel text-lg uppercase tracking-[0.3em]">Crear unidad especial</span>
                  </div>
                </button>
              )}
              {isCreatingGroup && !isViewer && (
                <div className="bg-[#121419] border border-amber-600/30 rounded-2xl p-8 shadow-2xl animate-in zoom-in-95 duration-300">
                   {/* Unit Creation Form UI remains similar but wrapped in check */}
                   <div className="flex justify-between items-center mb-8">
                      <h4 className="cinzel text-amber-500 font-bold text-xl flex items-center gap-4">
                         <i className="fa-solid fa-feather-pointed"></i> Unit Charter
                      </h4>
                      <button onClick={() => setIsCreatingGroup(false)} className="text-slate-600 hover:text-white transition-colors">
                        <i className="fa-solid fa-xmark"></i>
                      </button>
                   </div>
                   <div className="space-y-8">
                      <div>
                         <label className="text-[10px] uppercase font-bold tracking-[0.2em] text-slate-500 block mb-3">Nombre de la unidad</label>
                         <input 
                            type="text" 
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 outline-none focus:ring-1 focus:ring-amber-600/50 focus:border-amber-600 transition-all text-sm font-medium tracking-widest text-white shadow-inner"
                            placeholder="p. ej. Vanguardia Sombría"
                            value={newGroupName}
                            onChange={e => setNewGroupName(e.target.value)}
                         />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                         <div>
                            <label className="text-[10px] uppercase font-bold tracking-[0.2em] text-slate-500 block mb-4">Insignia</label>
                            <div className="grid grid-cols-4 gap-2">
                               {GROUP_ICONS.map(icon => (
                                 <button 
                                    key={icon}
                                    onClick={() => setNewGroupIcon(icon)}
                                    className={`aspect-square rounded-xl flex items-center justify-center transition-all border ${newGroupIcon === icon ? 'bg-amber-600 border-amber-400 text-white shadow-lg scale-110' : 'bg-slate-900 border-slate-800 text-slate-500'}`}
                                 >
                                    <i className={`fa-solid ${icon} text-base`}></i>
                                 </button>
                               ))}
                            </div>
                         </div>
                         <div>
                            <label className="text-[10px] uppercase font-bold tracking-[0.2em] text-slate-500 block mb-4">Color</label>
                            <div className="grid grid-cols-4 gap-3">
                               {GROUP_COLORS.map(color => {
                                 const colorMap: Record<string, string> = {
                                    amber: 'bg-amber-500', indigo: 'bg-indigo-500', cyan: 'bg-cyan-500', rose: 'bg-rose-500',
                                    emerald: 'bg-emerald-500', violet: 'bg-violet-500', orange: 'bg-orange-400', sky: 'bg-sky-400'
                                 };
                                 return (
                                    <button 
                                      key={color}
                                      onClick={() => setNewGroupColor(color)}
                                      className={`w-full aspect-square rounded-full border-2 transition-all ${newGroupColor === color ? 'border-white scale-125 shadow-2xl' : 'border-transparent shadow-lg'} ${colorMap[color]}`}
                                    />
                                 );
                               })}
                            </div>
                         </div>
                      </div>
                      <div className="flex gap-4 pt-4">
                         <button 
                            onClick={createGroup}
                            className="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-bold py-4 rounded-xl transition-all text-xs uppercase tracking-[0.3em] shadow-xl disabled:opacity-50"
                            disabled={!newGroupName.trim()}
                         >
                            Establish Mandate
                         </button>
                         <button 
                            onClick={() => setIsCreatingGroup(false)}
                            className="px-8 text-slate-500 hover:text-white transition-colors text-xs uppercase tracking-[0.2em] font-bold"
                         >
                            Cancel
                         </button>
                      </div>
                   </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WarPlanner;
