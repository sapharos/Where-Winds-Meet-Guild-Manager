import React, { useState } from 'react';
import { WAR_MATCH_TYPE_LABELS, WarMatchType } from '../types';

const TYPES: WarMatchType[] = ['league', 'ranked', 'custom'];

const ICONS: Record<WarMatchType, string> = {
  league: 'fa-shield-halved',
  ranked: 'fa-ranking-star',
  custom: 'fa-handshake',
};

interface Props {
  onClose: () => void;
  onStart: (name: string, matchType: WarMatchType) => Promise<void>;
}

/**
 * What kind of match this was is worth more than a text field: it decides
 * whether this war belongs next to the guild's ranked history or stands on
 * its own as a one-off challenge. Asked here, at the one moment someone is
 * already looking at the board and knows the answer, rather than left to be
 * reconstructed later from a name nobody agreed on.
 */
const StartWarModal: React.FC<Props> = ({ onClose, onStart }) => {
  const [name, setName] = useState(`Guerra ${new Date().toLocaleDateString('es')}`);
  const [matchType, setMatchType] = useState<WarMatchType | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matchType) {
      setError('Elige qué tipo de partida fue.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onStart(name, matchType);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar la guerra');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto">
      <form
        onSubmit={submit}
        className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-md my-8"
      >
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <div>
            <h2 className="cinzel text-2xl font-bold text-amber-500">Iniciar guerra</h2>
            <p className="text-xs text-slate-500 mt-1">
              Congela quién está desplegado y dónde. No hay vuelta atrás sin finalizarla.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-amber-500 transition-all"
          >
            <i className="fa-solid fa-xmark text-xl"></i>
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1.5">
              Nombre
            </label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1.5">
              Tipo de partida
            </label>
            <div className="grid grid-cols-3 gap-2">
              {TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setMatchType(type)}
                  className={`flex flex-col items-center gap-1.5 rounded-lg border py-3 text-xs font-bold transition-all ${
                    matchType === type
                      ? 'border-amber-500 text-amber-400 bg-amber-500/10'
                      : 'border-slate-800 text-slate-400 hover:border-slate-600'
                  }`}
                >
                  <i className={`fa-solid ${ICONS[type]} text-base`}></i>
                  {WAR_MATCH_TYPE_LABELS[type]}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="text-sm rounded-lg px-4 py-2 flex items-center gap-3 border bg-red-950/60 border-red-900 text-red-200">
              <i className="fa-solid fa-triangle-exclamation"></i>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-red-700 hover:bg-red-600 disabled:bg-slate-800 disabled:text-slate-600 text-white text-sm font-bold py-2.5 px-5 rounded transition-all flex items-center justify-center gap-2"
          >
            <i className={`fa-solid ${busy ? 'fa-circle-notch fa-spin' : 'fa-flag'}`}></i>
            Iniciar guerra
          </button>
        </div>
      </form>
    </div>
  );
};

export default StartWarModal;
