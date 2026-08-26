import React, { useState } from 'react';
import Sheet from './Sheet';
import { VodEnMosaico } from './Multistream';
import { comoReloj } from '../services/relojGuerra';

/**
 * Quiénes entran al mosaico, antes de montarlo. Ver docs/VODS.md §5.
 *
 * Antes no se elegía: se cogían las cuatro primeras por orden de subida y a
 * correr. Con seis grabaciones de una guerra eso significa que las dos últimas
 * no existen, sin decirlo, y que quien quería comparar dos líneas concretas no
 * tenía forma de pedirlo -- que es justo para lo que sirve un mosaico.
 *
 * Se abre siempre, aunque sólo haya dos: es también donde se ve quién grabó esa
 * noche, y con dos es una pulsación de confirmación.
 */

/**
 * Cuántas caben.
 *
 * Una principal y cinco en la columna, que es lo que entra sin que la tira se
 * vuelva un pozo de scroll. El límite no es la pantalla sino la red: la
 * principal va a 1080p y las demás a 360p, así que seis son ~7 Mbps por
 * espectador. Cuatro 1080p a la vez serían treinta, y de ahí viene la regla.
 */
export const TOPE_MOSAICO = 6;

interface Props {
  /** Todas las que podrían entrar: publicadas, con vídeo y sincronizadas. */
  candidatas: VodEnMosaico[];
  onCancelar: () => void;
  onVer: (elegidas: VodEnMosaico[]) => void;
}

const ElegirMosaico: React.FC<Props> = ({ candidatas, onCancelar, onVer }) => {
  // Marcadas las primeras hasta el tope, que es lo que hacía antes por su
  // cuenta. La diferencia es que ahora se ve y se puede cambiar.
  const [marcadas, setMarcadas] = useState<Set<string>>(
    () => new Set(candidatas.slice(0, TOPE_MOSAICO).map((v) => v.id)),
  );

  const alterna = (id: string) =>
    setMarcadas((antes) => {
      const ahora = new Set(antes);
      if (ahora.has(id)) ahora.delete(id);
      else if (ahora.size < TOPE_MOSAICO) ahora.add(id);
      return ahora;
    });

  const elegidas = candidatas.filter((v) => marcadas.has(v.id));
  const lleno = marcadas.size >= TOPE_MOSAICO;

  return (
    <Sheet
      title="Ver a la vez"
      subtitle="Qué perspectivas quieres mirar cuadradas"
      size="md"
      onClose={onCancelar}
      footer={
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500 flex-1">
            {marcadas.size} de {candidatas.length}
            {lleno && candidatas.length > TOPE_MOSAICO && ` · el máximo son ${TOPE_MOSAICO}`}
          </span>
          <button
            type="button"
            onClick={onCancelar}
            className="px-3 min-h-tap rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={marcadas.size < 2}
            onClick={() => onVer(elegidas)}
            className="px-3 min-h-tap rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-xs font-medium"
          >
            Ver {marcadas.size} a la vez
          </button>
        </div>
      }
    >
      <p className="text-[11px] text-slate-500 mb-3">
        La primera que marques empieza como principal, a 1080p. Las demás van en la columna a
        360p, y se cambia pulsándolas.
      </p>

      <ul className="space-y-1">
        {candidatas.map((v) => {
          const puesta = marcadas.has(v.id);
          return (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => alterna(v.id)}
                aria-pressed={puesta}
                // Deshabilitar al llegar al tope y no dejar quitar sería una
                // trampa: lo que se bloquea es AÑADIR una más, nunca soltar una
                // de las que ya están.
                disabled={!puesta && lleno}
                className={`w-full min-h-tap flex items-center gap-3 rounded-lg px-3 text-left transition-colors duration-micro disabled:opacity-30 ${
                  puesta ? 'bg-amber-500/10 ring-1 ring-amber-500/50' : 'hover:bg-slate-800/60'
                }`}
              >
                <i
                  className={`fa-solid ${puesta ? 'fa-check' : 'fa-plus'} text-xs shrink-0 ${
                    puesta ? 'text-amber-400' : 'text-slate-600'
                  }`}
                  aria-hidden="true"
                />
                <span className={`flex-1 min-w-0 truncate text-sm ${puesta ? 'text-slate-100' : 'text-slate-300'}`}>
                  {v.nombre}
                </span>
                {/*
                  El TRAMO de guerra que cubre, de principio a fin, y no el
                  arranque con la duración al lado. Es la pregunta que se hace
                  aquí -- «¿estas dos vieron el mismo momento?» -- y dos extremos
                  la contestan de un vistazo, mientras que un arranque y una
                  duración obligan a sumarlos de cabeza para cada pareja.

                  Con `comoReloj`, que es el que sabe de signos: en negativo va
                  la preparación, y recortarlo a cero -- como hacía un formateador
                  propio -- pintaba «0:00» en tres grabaciones que empezaban en
                  tres sitios distintos.
                */}
                <span className="text-[11px] tabular-nums text-slate-500 shrink-0">
                  {comoReloj(v.offsetMs)} → {comoReloj(v.offsetMs + v.duracionMs)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {marcadas.size < 2 && (
        <p className="mt-3 text-[11px] text-amber-400">
          Hacen falta al menos dos: con una sola no hay nada que cuadrar, y para eso está «Ver».
        </p>
      )}
    </Sheet>
  );
};

export default ElegirMosaico;
