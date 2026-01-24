
import React, { useState } from 'react';
import { Player, Role, Platform, MembershipStatus, GuildRank, SECTS } from '../types';
import PlayerCard from './PlayerCard';

interface MemberManagerProps {
  players: Player[];
  ranks: GuildRank[];
  isViewer?: boolean;
  onAdd: (p: Player) => void;
  onUpdate: (p: Player) => void;
  onDelete: (id: string) => void;
  onAddRank: (r: GuildRank) => void;
  onDeleteRank: (id: string) => void;
}

const MemberManager: React.FC<MemberManagerProps> = ({ 
  players, 
  ranks, 
  isViewer = false,
  onAdd, 
  onUpdate, 
  onDelete, 
  onAddRank, 
  onDeleteRank 
}) => {
  const [isEditing, setIsEditing] = useState<Player | null>(null);
  const [showRankEditor, setShowRankEditor] = useState(false);
  const [newRankName, setNewRankName] = useState('');
  const [newRankColor, setNewRankColor] = useState('#f59e0b');
  
  const [formData, setFormData] = useState<Omit<Player, 'id'>>({
    name: '',
    role: Role.DPS,
    level: 50,
    sect: 'Sectless',
    platform: undefined,
    status: MembershipStatus.APPRENTICE,
    rankId: undefined,
    notes: ''
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isViewer) return;
    if (isEditing) {
      onUpdate({ ...formData, id: isEditing.id });
      setIsEditing(null);
    } else {
      onAdd({ ...formData, id: Date.now().toString() });
    }
    setFormData({ 
      name: '', 
      role: Role.DPS, 
      level: 50, 
      sect: 'Sectless', 
      platform: undefined, 
      status: MembershipStatus.APPRENTICE, 
      rankId: undefined,
      notes: '' 
    });
  };

  const handleEdit = (p: Player) => {
    if (isViewer) return;
    setIsEditing(p);
    setFormData({ 
      name: p.name, 
      role: p.role, 
      level: p.level, 
      sect: p.sect || 'Sectless', 
      platform: p.platform, 
      status: p.status || MembershipStatus.FULL_MEMBER, 
      rankId: p.rankId,
      notes: p.notes 
    });
  };

  const handleAddRankSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isViewer || !newRankName.trim()) return;
    onAddRank({
      id: `rank-${Date.now()}`,
      name: newRankName,
      color: newRankColor
    });
    setNewRankName('');
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 h-full">
      <div className="lg:col-span-1 space-y-6">
        <div className={`bg-slate-900 border border-slate-800 p-6 rounded-xl shadow-2xl relative ${isViewer ? 'opacity-50' : ''}`}>
          {isViewer && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/40 backdrop-blur-[1px] rounded-xl">
               <div className="bg-slate-900 border border-slate-700 px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Read Only Mode
               </div>
            </div>
          )}
          <h2 className="cinzel text-2xl font-bold mb-6 text-amber-500 border-b border-amber-900/50 pb-2">
            {isEditing ? 'Edit Member' : 'Enroll New Member'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">Name</label>
              <input 
                type="text" 
                required
                disabled={isViewer}
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 focus:ring-1 focus:ring-amber-500 outline-none transition-all text-sm"
                value={formData.name}
                onChange={e => setFormData({...formData, name: e.target.value})}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">Primary Role</label>
                <select 
                  disabled={isViewer}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 outline-none text-sm"
                  value={formData.role}
                  onChange={e => setFormData({...formData, role: e.target.value as Role})}
                >
                  <option value={Role.TANK}>Tank</option>
                  <option value={Role.HEALER}>Healer</option>
                  <option value={Role.DPS}>DPS</option>
                </select>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">Level</label>
                <input 
                  type="number" 
                  disabled={isViewer}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 outline-none text-sm"
                  value={formData.level}
                  onChange={e => setFormData({...formData, level: parseInt(e.target.value)})}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">Guild Rank (Optional)</label>
              <div className="flex gap-2">
                <select 
                  disabled={isViewer}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded p-2 outline-none text-sm"
                  value={formData.rankId || ''}
                  onChange={e => setFormData({...formData, rankId: e.target.value || undefined})}
                >
                  <option value="">No Special Rank</option>
                  {ranks.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
                <button 
                  type="button"
                  onClick={() => setShowRankEditor(!showRankEditor)}
                  className={`p-2 rounded border transition-colors ${showRankEditor ? 'bg-amber-600 border-amber-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-500'}`}
                >
                  <i className="fa-solid fa-gear"></i>
                </button>
              </div>
            </div>

            {showRankEditor && (
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg animate-in fade-in slide-in-from-top-2">
                <p className="text-[10px] text-slate-500 uppercase font-bold mb-2">Manage Guild Ranks</p>
                <div className="space-y-2 max-h-40 overflow-y-auto mb-3 custom-scrollbar pr-1">
                  {ranks.map(r => (
                    <div key={r.id} className="flex items-center justify-between text-xs bg-slate-900 p-1.5 rounded border border-slate-800">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: r.color }} />
                        <span>{r.name}</span>
                      </div>
                      {!isViewer && (
                        <button onClick={() => onDeleteRank(r.id)} className="text-slate-600 hover:text-red-500">
                          <i className="fa-solid fa-xmark"></i>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {!isViewer && (
                  <div className="flex gap-1">
                    <input 
                      type="text" 
                      placeholder="Rank name..." 
                      className="flex-1 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs outline-none focus:border-amber-600"
                      value={newRankName}
                      onChange={e => setNewRankName(e.target.value)}
                    />
                    <input 
                      type="color" 
                      className="w-8 h-8 p-0 bg-transparent border-none cursor-pointer"
                      value={newRankColor}
                      onChange={e => setNewRankColor(e.target.value)}
                    />
                    <button onClick={handleAddRankSubmit} className="bg-amber-700 hover:bg-amber-600 px-2 rounded text-white text-xs">
                      Add
                    </button>
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">Membership Status</label>
              <div className="flex gap-2">
                <button 
                  type="button"
                  disabled={isViewer}
                  onClick={() => setFormData({...formData, status: MembershipStatus.APPRENTICE})}
                  className={`flex-1 py-2 rounded border transition-all text-xs font-bold ${formData.status === MembershipStatus.APPRENTICE ? 'bg-slate-800 border-slate-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-500'}`}
                >
                  Apprentice
                </button>
                <button 
                  type="button"
                  disabled={isViewer}
                  onClick={() => setFormData({...formData, status: MembershipStatus.FULL_MEMBER})}
                  className={`flex-1 py-2 rounded border transition-all text-xs font-bold ${formData.status === MembershipStatus.FULL_MEMBER ? 'bg-amber-900/30 border-amber-600 text-amber-500' : 'bg-slate-950 border-slate-800 text-slate-500'}`}
                >
                  Full Member
                </button>
              </div>
            </div>
            {!isViewer && (
              <button type="submit" className="w-full bg-amber-600 hover:bg-amber-500 text-white font-bold py-2 px-4 rounded transition-all shadow-lg shadow-amber-900/20">
                {isEditing ? 'Update Roster' : 'Register Member'}
              </button>
            )}
          </form>
        </div>
      </div>

      <div className="lg:col-span-2 space-y-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="cinzel text-2xl font-bold text-slate-200">Guild Roster ({players.length})</h2>
          <div className="flex items-center gap-2">
             <i className="fa-solid fa-magnifying-glass text-slate-600"></i>
             <input type="text" placeholder="Search members..." className="bg-slate-900 border border-slate-800 rounded text-sm px-3 py-1 outline-none focus:border-amber-900"/>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 overflow-y-auto max-h-[calc(100vh-250px)] pr-2 custom-scrollbar">
          {players.length === 0 ? (
            <div className="col-span-2 py-12 text-center text-slate-600 border-2 border-dashed border-slate-800 rounded-xl">
              <i className="fa-solid fa-users-slash text-4xl mb-3"></i>
              <p>No members enrolled.</p>
            </div>
          ) : (
            players.map(p => (
              <PlayerCard 
                key={p.id} 
                player={p} 
                onEdit={isViewer ? undefined : handleEdit} 
                onDelete={isViewer ? undefined : onDelete} 
                ranks={ranks} 
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default MemberManager;
