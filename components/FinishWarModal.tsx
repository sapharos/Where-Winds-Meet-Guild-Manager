import React, { useState } from 'react';
import { WAR_OUTCOME_LABELS, WarOutcome } from '../types';
import Sheet from './Sheet';

const LOOK: Record<WarOutcome, { icon: string; on: string; ring: string }> = {
  win: {
    icon: 'fa-trophy',
    on: 'border-emerald-500 text-emerald-400 bg-emerald-500/10',
    ring: 'focus:ring-emerald-500',
  },
  loss: {
    icon: 'fa-flag',
    on: 'border-red-500 text-red-400 bg-red-500/10',
    ring: 'focus:ring-red-500',
  },
};

interface Props {
  warName: string;
  onClose: () => void;
  onFinish: (outcome: WarOutcome) => Promise<void>;
}

/**
 * Asked when the war is closed by hand, because whoever closes it was there.
 *
 * Required rather than optional: an unmarked war is a row nobody will ever go
 * back and complete, and a history where half the results are missing cannot
 * answer the one question it exists to answer.
 */
const FinishWarModal: React.FC<Props> = ({ warName, onClose, onFinish }) => {
  const [outcome, setOutcome] = useState<WarOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!outcome) {
      setError('Marca si la guerra se ganó o se perdió.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onFinish(outcome);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo finalizar');
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Finalizar guerra"
      subtitle={`«${warName}» queda cerrada y se abren las dos formaciones.`}
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
            Finalizar
          </button>
        </div>
      </form>
    </Sheet>
  );
};

export default FinishWarModal;
