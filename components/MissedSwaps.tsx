import React, { useState } from 'react';
import { WAR_SIDE_LABELS, WarSide } from '../types';
import Sheet from './Sheet';

/** Quien pelea la guerra y el acta no menciona. */
export interface Extra {
  playerId: string;
  name: string;
}

/** Del acta, quien no salió en la captura: candidato a haberse ido. */
export interface Absent extends Extra {
  side: WarSide;
}

/** Lo que se decide aquí: quién entró, por quién, y de qué bando si por nadie. */
export interface Swap {
  in: string;
  out: string | null;
  side: WarSide;
}

interface Props {
  extras: Extra[];
  absent: Absent[];
  onClose: () => void;
  onConfirm: (swaps: Swap[]) => Promise<void>;
}

const SIDES: WarSide[] = ['attack', 'defense'];

/**
 * Los cambios que se hicieron en el juego y no se apuntaron aquí.
 *
 * Se descubren leyendo la captura de una guerra ya cerrada: hay una fila con
 * nombre y cifras de alguien que en el acta no está, porque entró a mitad y en
 * ese momento nadie tenía la aplicación delante. Sin esto su fila se descarta,
 * y con ella la única prueba de que peleó.
 *
 * Lo que hay que decidir es a quién relevó, y eso no se puede adivinar: de ello
 * dependen el bando y la línea que hereda, y el bando decide contra quién se le
 * puntúa. Sólo se propone solo el caso de uno por uno, que es el corriente
 * -- se olvidó un cambio, no cinco -- y donde no hay nada que elegir.
 *
 * «A nadie» existe porque a veces es la verdad: la captura viene incompleta y
 * el relevado sí sale en una página que no se subió. Entonces se pide el bando,
 * que es lo único que no puede quedarse sin decidir.
 */
const MissedSwaps: React.FC<Props> = ({ extras, absent, onClose, onConfirm }) => {
  const [choice, setChoice] = useState<Record<string, string>>(() =>
    extras.length === 1 && absent.length === 1 ? { [extras[0].playerId]: absent[0].playerId } : {},
  );
  const [sides, setSides] = useState<Record<string, WarSide>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nadie puede haber sido relevado dos veces: el que ya está elegido para uno
  // desaparece de la lista de los demás.
  const takenBy = (playerId: string) =>
    Object.entries(choice).find(([who, out]) => out === playerId && who !== playerId)?.[0];

  const confirm = async () => {
    setError(null);
    setBusy(true);
    try {
      await onConfirm(
        extras.map((e) => ({
          in: e.playerId,
          out: choice[e.playerId] || null,
          side:
            (choice[e.playerId] && absent.find((a) => a.playerId === choice[e.playerId])?.side) ||
            sides[e.playerId] ||
            'attack',
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron guardar los cambios');
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={extras.length === 1 ? 'Un cambio sin apuntar' : `${extras.length} cambios sin apuntar`}
      subtitle="Salen en la captura y no en el acta de la guerra, así que entraron a mitad. Di a quién relevó cada uno y quedan registrados con su sitio."
      size="md"
      onClose={onClose}
      footer={
        <div className="flex items-center gap-3">
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="min-h-tap text-sm text-slate-400 hover:text-slate-200 px-4 transition-all"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy}
            className="min-h-tap bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-sm font-bold px-6 rounded transition-all flex items-center gap-2"
          >
            <i className={`fa-solid ${busy ? 'fa-circle-notch fa-spin' : 'fa-right-left'}`}></i>
            Registrar y guardar las cifras
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && (
          <div className="text-sm rounded-lg px-4 py-2 flex items-center gap-3 border bg-red-950/60 border-red-900 text-red-200">
            <i className="fa-solid fa-triangle-exclamation"></i>
            {error}
          </div>
        )}

        {extras.map((e) => {
          const out = choice[e.playerId] ?? '';
          return (
            <article key={e.playerId} className="rounded-md border border-slate-800 bg-slate-950/40 p-3">
              <p className="text-sm text-slate-100 flex items-center gap-2">
                <i className="fa-solid fa-arrow-right-to-bracket text-emerald-500 text-xs"></i>
                {e.name}
              </p>

              <label className="block mt-2">
                <span className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1">
                  ¿A quién relevó?
                </span>
                <select
                  value={out}
                  onChange={(ev) =>
                    setChoice((prev) => ({ ...prev, [e.playerId]: ev.target.value }))
                  }
                  className="w-full min-h-tap bg-slate-950 border border-slate-800 rounded px-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
                >
                  <option value="">— a nadie, entró y ya —</option>
                  {absent
                    .filter((a) => !takenBy(a.playerId) || takenBy(a.playerId) === e.playerId)
                    .map((a) => (
                      <option key={a.playerId} value={a.playerId}>
                        {a.name} — {WAR_SIDE_LABELS[a.side]}
                      </option>
                    ))}
                </select>
              </label>

              {/* Sin relevado no hay puesto del que heredar el bando, y el
                  bando decide contra quién se le puntúa: no puede suponerse. */}
              {!out && (
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] uppercase tracking-wider text-slate-500">
                    ¿De qué bando peleó?
                  </span>
                  {SIDES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSides((prev) => ({ ...prev, [e.playerId]: s }))}
                      className={`min-h-tap px-3 text-sm font-bold rounded border transition-all ${
                        (sides[e.playerId] ?? 'attack') === s
                          ? 'border-amber-500 text-amber-400 bg-amber-500/10'
                          : 'border-slate-800 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      {WAR_SIDE_LABELS[s]}
                    </button>
                  ))}
                </div>
              )}

              {out && (
                <p className="mt-2 text-meta text-slate-500">
                  Hereda su bando y su línea. {absent.find((a) => a.playerId === out)?.name} se
                  queda en el acta con lo que hizo hasta que salió.
                </p>
              )}
            </article>
          );
        })}

        {absent.length === 0 && (
          <p className="text-[11px] text-slate-500">
            Todos los del acta salen en la captura, así que no hay a quién relevar: entraron sin
            que constara la salida de nadie.
          </p>
        )}
      </div>
    </Sheet>
  );
};

export default MissedSwaps;
