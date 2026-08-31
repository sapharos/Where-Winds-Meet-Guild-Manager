import React, { useState } from 'react';
import { WAR_PHASE_LABELS, WAR_PHASE_MINUTES, WarPhase } from '../types';
import Sheet from './Sheet';

const PHASES: WarPhase[] = ['preparacion', 'partida'];

const ICONS: Record<WarPhase, string> = {
  preparacion: 'fa-hourglass-half',
  partida: 'fa-khanda',
};

/** «4», «4:30» o «0:47» → segundos, o null si no es una cifra de reloj. */
const aSegundos = (texto: string): number | null => {
  const m = texto.trim().match(/^(\d{1,2})(?::([0-5]?\d))?$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2] ?? 0);
};

interface Props {
  onClose: () => void;
  onStart: (phase: WarPhase, remainingSeconds: number) => Promise<void>;
}

/**
 * Iniciar ya no crea nada: arranca los relojes, y ya está.
 *
 * Antes pedía nombre y tipo de partida y escribía la guerra en el historial,
 * lo que obligaba a decidir papeleo justo cuando hay que estar jugando -- y a
 * bloquear las dos formaciones antes. Ahora pide lo único que hace falta para
 * que los relojes digan la verdad: en qué fase se está y qué marca la cuenta
 * atrás del juego. Lo normal es iniciarlo desde la preparación, con calma; el
 * acta, con su nombre y su resultado, se decide al finalizar.
 */
const StartWarModal: React.FC<Props> = ({ onClose, onStart }) => {
  const [phase, setPhase] = useState<WarPhase>('preparacion');
  const [reloj, setReloj] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tope = WAR_PHASE_MINUTES[phase];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const restante = aSegundos(reloj);
    if (restante === null) {
      setError('Escribe lo que marca la cuenta atrás, como «4:30».');
      return;
    }
    if (restante > tope * 60) {
      setError(`La cuenta atrás de ${WAR_PHASE_LABELS[phase].toLowerCase()} va de 0:00 a ${tope}:00.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onStart(phase, restante);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar la guerra');
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Iniciar guerra"
      subtitle="Arranca los relojes de jungla y boss para todas las pantallas y para el cuerno del bot. El acta se decide al finalizar: registrarla o descartarla."
      size="sm"
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1.5">
              ¿En qué fase estás?
            </label>
            <div className="grid grid-cols-2 gap-2">
              {PHASES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    setPhase(p);
                    setError(null);
                  }}
                  className={`min-h-tap flex flex-col items-center justify-center gap-1.5 rounded-lg border py-3 text-xs font-bold transition-all ${
                    phase === p
                      ? 'border-amber-500 text-amber-400 bg-amber-500/10'
                      : 'border-slate-800 text-slate-400 hover:border-slate-600'
                  }`}
                >
                  <i className={`fa-solid ${ICONS[p]} text-base`}></i>
                  {WAR_PHASE_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1.5">
              ¿Qué marca la cuenta atrás del juego?
            </label>
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              value={reloj}
              onChange={(e) => setReloj(e.target.value)}
              placeholder={phase === 'preparacion' ? 'p. ej. 4:30' : 'p. ej. 27:10'}
              autoComplete="off"
              className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm tabular-nums outline-none focus:ring-1 focus:ring-amber-500"
            />
            <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
              El número que el juego enseña ahora mismo, de {tope}:00 hacia abajo. Con eso los
              relojes de todos cuentan lo mismo que el de tu pantalla.
            </p>
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
            className="w-full min-h-tap bg-red-700 hover:bg-red-600 disabled:bg-slate-800 disabled:text-slate-600 text-white text-sm font-bold px-5 rounded transition-all flex items-center justify-center gap-2"
          >
            <i className={`fa-solid ${busy ? 'fa-circle-notch fa-spin' : 'fa-flag'}`}></i>
            Arrancar los relojes
          </button>
        </div>
      </form>
    </Sheet>
  );
};

export default StartWarModal;
