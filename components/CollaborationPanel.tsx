
import React, { useState } from 'react';
import { PeerRole } from '../types';

interface CollaborationPanelProps {
  peerId: string | null;
  role: PeerRole;
  onJoin: (id: string) => void;
  onHost: () => void;
  onDisconnect: () => void;
  connectedCount: number;
}

const CollaborationPanel: React.FC<CollaborationPanelProps> = ({
  peerId,
  role,
  onJoin,
  onHost,
  onDisconnect,
  connectedCount
}) => {
  const [targetId, setTargetId] = useState('');
  const [showInput, setShowInput] = useState(false);

  if (role === 'HOST') {
    return (
      <div className="flex items-center gap-3 bg-amber-900/20 border border-amber-600/30 px-3 py-1.5 rounded-lg animate-in fade-in zoom-in-95">
        <div className="flex flex-col">
          <span className="text-[9px] uppercase font-bold text-amber-500 tracking-widest leading-none">Código de mando</span>
          <span className="text-xs font-mono font-bold text-white tracking-tighter">{peerId}</span>
        </div>
        <div className="w-px h-6 bg-amber-600/30"></div>
        <div className="flex items-center gap-2">
           <span className="relative flex h-2 w-2">
             <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
             <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
           </span>
           <span className="text-[10px] uppercase font-bold text-slate-300">{connectedCount} conectados</span>
        </div>
        <button 
          onClick={onDisconnect}
          className="ml-2 p-1.5 rounded bg-slate-800 hover:bg-red-900/40 text-slate-400 hover:text-red-400 transition-all"
          title="Dejar de transmitir"
        >
          <i className="fa-solid fa-power-off text-xs"></i>
        </button>
      </div>
    );
  }

  if (role === 'CLIENT') {
    return (
      <div className="flex items-center gap-3 bg-blue-900/20 border border-blue-600/30 px-3 py-1.5 rounded-lg animate-in fade-in zoom-in-95">
        <div className="flex flex-col">
          <span className="text-[9px] uppercase font-bold text-blue-400 tracking-widest leading-none">Modo observador</span>
          <span className="text-xs font-bold text-white tracking-widest">SOLO LECTURA</span>
        </div>
        <div className="w-px h-6 bg-blue-600/30"></div>
        <button 
          onClick={onDisconnect}
          className="p-1.5 rounded bg-slate-800 hover:bg-red-900/40 text-slate-400 hover:text-red-400 transition-all"
          title="Salir de la sesión"
        >
          <i className="fa-solid fa-right-from-bracket text-xs"></i>
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {!showInput ? (
        <div className="flex gap-2">
          <button 
            onClick={onHost}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg text-[10px] uppercase font-bold tracking-widest text-slate-300 transition-all flex items-center gap-2"
          >
            <i className="fa-solid fa-satellite-dish text-amber-500"></i>
            Transmitir
          </button>
          <button 
            onClick={() => setShowInput(true)}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg text-[10px] uppercase font-bold tracking-widest text-slate-300 transition-all flex items-center gap-2"
          >
            <i className="fa-solid fa-link text-blue-400"></i>
            Conectarme
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1 bg-slate-900 border border-slate-700 p-1 rounded-lg animate-in slide-in-from-right-4">
          <input 
            type="text" 
            placeholder="Código de mando..." 
            className="bg-transparent text-xs p-1 outline-none w-32 tracking-tighter"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            autoFocus
          />
          <button 
            onClick={() => {
              if (targetId.trim()) onJoin(targetId.trim());
            }}
            className="px-2 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-[10px] font-bold"
          >
            Link
          </button>
          <button 
            onClick={() => setShowInput(false)}
            className="px-2 py-1 text-slate-500 hover:text-white"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>
      )}
    </div>
  );
};

export default CollaborationPanel;
