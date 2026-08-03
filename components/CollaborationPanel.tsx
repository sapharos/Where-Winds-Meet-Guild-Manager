
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
          <span className="text-xs font-mono font-bold text-slate-100 tracking-tighter">{peerId}</span>
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
          <span className="text-xs font-bold text-slate-100 tracking-widest">SOLO LECTURA</span>
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
      {/*
        Se envuelven en vez de encogerse.

        Este panel vive en dos sitios de anchos muy distintos: suelto en la
        cabecera del escritorio, y dentro del menú de 240 px en el teléfono.
        Ahí los dos botones sumaban 253 y se salían por el borde derecho; al
        repartirse el ancho quedaban en "TRANS..." y "CONEC...", que no es
        arreglarlo. Con `basis-32` cada uno pide 128 px, los dos no caben en
        216 y pasan a una fila cada uno, enteros. Donde sí caben, siguen juntos.
      */}
      {!showInput ? (
        <div className="flex flex-wrap gap-2 w-full">
          <button
            onClick={onHost}
            className="grow basis-32 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg text-[10px] uppercase font-bold tracking-widest text-slate-300 transition-all flex items-center justify-center gap-2"
          >
            <i className="fa-solid fa-satellite-dish text-amber-500 shrink-0"></i>
            Transmitir
          </button>
          <button
            onClick={() => setShowInput(true)}
            className="grow basis-32 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg text-[10px] uppercase font-bold tracking-widest text-slate-300 transition-all flex items-center justify-center gap-2"
          >
            <i className="fa-solid fa-link text-blue-400 shrink-0"></i>
            Conectarme
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1 w-full bg-slate-900 border border-slate-700 p-1 rounded-lg animate-in slide-in-from-right-4">
          <input
            type="text"
            placeholder="Código de mando..."
            aria-label="Código de mando"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="go"
            className="flex-1 min-w-0 bg-transparent text-sm p-1 outline-none tracking-tighter"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            autoFocus
          />
          <button
            onClick={() => {
              if (targetId.trim()) onJoin(targetId.trim());
            }}
            className="shrink-0 px-2 bg-amber-600 hover:bg-amber-500 text-white rounded text-[10px] font-bold"
          >
            Link
          </button>
          <button
            onClick={() => setShowInput(false)}
            aria-label="Cancelar"
            className="shrink-0 px-2 text-slate-500 hover:text-slate-100"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>
      )}
    </div>
  );
};

export default CollaborationPanel;
