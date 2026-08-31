import React, { useState } from 'react';
import {
  WAR_MATCH_TYPE_LABELS,
  WAR_OUTCOME_LABELS,
  WarMatchType,
  WarOutcome,
} from '../types';
import Sheet from './Sheet';

const LOOK: Record<WarOutcome, { icon: string; on: string }> = {
  win: { icon: 'fa-trophy', on: 'border-emerald-500 text-emerald-400 bg-emerald-500/10' },
  loss: { icon: 'fa-flag', on: 'border-red-500 text-red-400 bg-red-500/10' },
};

const TYPES: WarMatchType[] = ['league', 'ranked', 'custom'];

const TYPE_ICONS: Record<WarMatchType, string> = {
  league: 'fa-shield-halved',
  ranked: 'fa-ranking-star',
  custom: 'fa-handshake',
};

interface Props {
  /** Cuántos hay desplegados ahora, que son los que entrarían en el acta. */
  deployed: number;
  onClose: () => void;
  onRegister: (name: string, matchType: WarMatchType, outcome: WarOutcome) => Promise<void>;
  onDiscard: () => Promise<void>;
}

/**
 * Finalizar es donde se decide si la guerra existió.
 *
 * Iniciar sólo arrancó los relojes, así que todo el papeleo -- nombre, tipo y
 * resultado -- se pide aquí, que es cuando quien cierra ya lo sabe todo. El
 * acta se congela con los desplegados de este momento; los cambios de la
 * pelea, si los hubo, ya están hechos en el tablero.
 *
 * Descartar existe para lo demás: la guerra iniciada por probar, el reto que
 * no vale la pena en el historial. Antes eso quedaba escrito hasta que alguien
 * lo borraba a mano.
 */
const FinishWarModal: React.FC<Props> = ({ deployed, onClose, onRegister, onDiscard }) => {
  const [name, setName] = useState(`Guerra ${new Date().toLocaleDateString('es')}`);
  const [matchType, setMatchType] = useState<WarMatchType | null>(null);
  const [outcome, setOutcome] = useState<WarOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!outcome) {
      setError('Marca si la guerra se ganó o se perdió.');
      return;
    }
    if (!matchType) {
      setError('Elige qué tipo de partida fue.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onRegister(name, matchType, outcome);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar');
      setBusy(false);
    }
  };

  const descartar = async () => {
    if (!window.confirm('¿Parar los relojes sin dejar nada en el historial?')) return;
    setBusy(true);
    setError(null);
    try {
      await onDiscard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo descartar');
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Finalizar guerra"
      subtitle="Se paran los relojes y se abren las dos formaciones. Regístrala en el historial con los desplegados de ahora, o descártala sin dejar rastro."
      size="sm"
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1.5">
              ¿Cómo terminó?
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(['win', 'loss'] as WarOutcome[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setOutcome(option)}
                  className={`flex flex-col items-center gap-1.5 rounded-lg border py-4 text-sm font-bold transition-all ${
                    outcome === option
                      ? LOOK[option].on
                      : 'border-slate-800 text-slate-400 hover:border-slate-600'
                  }`}
                >
                  <i className={`fa-solid ${LOOK[option].icon} text-lg`}></i>
                  {WAR_OUTCOME_LABELS[option]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1.5">
              Nombre
            </label>
            <input
              type="text"
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
                  className={`min-h-tap flex flex-col items-center justify-center gap-1.5 rounded-lg border py-3 text-xs font-bold transition-all ${
                    matchType === type
                      ? 'border-amber-500 text-amber-400 bg-amber-500/10'
                      : 'border-slate-800 text-slate-400 hover:border-slate-600'
                  }`}
                >
                  <i className={`fa-solid ${TYPE_ICONS[type]} text-base`}></i>
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
            className="w-full min-h-tap bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-sm font-bold px-5 rounded transition-all flex items-center justify-center gap-2"
          >
            <i className={`fa-solid ${busy ? 'fa-circle-notch fa-spin' : 'fa-flag-checkered'}`}></i>
            Registrar en el historial ({deployed} desplegados)
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => void descartar()}
            className="w-full min-h-tap rounded border border-slate-800 text-slate-500 hover:text-red-400 hover:border-red-900 disabled:opacity-40 text-sm font-semibold px-5 transition-all flex items-center justify-center gap-2"
          >
            <i className="fa-solid fa-trash-can"></i>
            Descartar sin registrar
          </button>
        </div>
      </form>
    </Sheet>
  );
};

export default FinishWarModal;
