import React, { useState } from 'react';
import {
  Fase,
  PARTIDA_S,
  PREPARACION_S,
  enPalabras,
  offsetDesde,
} from '../services/relojGuerra';

/**
 * «Pausa donde se lea el cronómetro y dime qué marca».
 *
 * Vive aparte porque hacen falta dos veces y tienen que decir exactamente lo
 * mismo: al subir (por si el OCR falla o se equivoca) y después, para arreglar
 * la sincronía de lo que ya está subido. Dos copias acabarían divergiendo en la
 * validación o en el aviso de la fase, y ese aviso es lo único que impide un
 * error de media hora.
 */

interface Props {
  /** Dónde está el vídeo ahora mismo, en segundos. */
  posicionS: number;
  onAplicar: (offsetMs: number) => void;
  compacto?: boolean;
}

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const MarcaDeReloj: React.FC<Props> = ({ posicionS, onAplicar, compacto }) => {
  // Por defecto partida: es la fase larga --30 de los 35 minutos-- así que
  // acierta seis de cada siete veces.
  const [fase, setFase] = useState<Fase>('partida');
  const [marca, setMarca] = useState('');

  /**
   * Lo que da lo escrito: el número que se guardaría, o por qué no se puede.
   *
   * Se resuelve aquí arriba y no dentro del botón porque hacen falta las dos
   * cosas a la vez -- decidir si el botón vale y enseñar el resultado antes de
   * pulsarlo. Antes esto vivía dentro de `aplicar()`, y un tope pasado hacía
   * que el botón se pudiera pulsar y no hiciera nada, sin decir por qué.
   */
  const lectura = (() => {
    const m = marca.trim().match(/^(\d{1,2})\s*:\s*(\d{2})$/);
    if (!m) return null;
    const segundos = Number(m[2]);
    if (segundos > 59) return { error: 'Los segundos no pasan de 59.' };
    const restante = Number(m[1]) * 60 + segundos;
    // La preparación no pasa de 5:00 ni la partida de 30:00. Un valor mayor es
    // una errata, y aceptarlo dejaría el vídeo alineado en un sitio imposible.
    const tope = fase === 'preparacion' ? PREPARACION_S : PARTIDA_S;
    if (restante > tope) {
      return {
        error: `La ${fase === 'preparacion' ? 'preparación' : 'partida'} no pasa de ${mmss(tope)}.`,
      };
    }
    return { offsetMs: offsetDesde({ restante, fase, posicionS }) };
  })();

  const listo = lectura && 'offsetMs' in lectura;

  const aplicar = () => {
    if (!lectura || !('offsetMs' in lectura)) return;
    onAplicar(lectura.offsetMs);
    setMarca('');
  };

  return (
    <div>
      {!compacto && (
        <p className="text-[11px] text-slate-500 mb-2">
          Pausa donde se lea bien el cronómetro del juego y escribe lo que marca.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg overflow-hidden border border-slate-700">
          {(['preparacion', 'partida'] as Fase[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFase(f)}
              className={`px-3 text-xs ${
                fase === f ? 'bg-slate-700 text-slate-100' : 'bg-slate-900 text-slate-400'
              }`}
            >
              {f === 'preparacion' ? 'Preparación' : 'Partida'}
            </button>
          ))}
        </div>
        <input
          value={marca}
          onChange={(e) => setMarca(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && aplicar()}
          placeholder="4:21"
          inputMode="numeric"
          aria-label="Lo que marca el cronómetro"
          className="w-24 px-3 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-sm text-center"
        />
        {/*
          El botón dice sólo «Aplicar». Decía «Aplicar en 0:00» -- la posición
          del vídeo -- y puesto al lado de una casilla donde acabas de escribir
          0:47 se leía como si fuera a guardar el 0:00. La posición sigue
          haciendo falta para entender la cuenta, así que baja al renglón de
          abajo, donde tiene sujeto y verbo y no se puede confundir con un dato
          que se esté editando.
        */}
        <button
          type="button"
          disabled={!listo}
          onClick={aplicar}
          className="px-3 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs"
        >
          Aplicar
        </button>
      </div>

      {/*
        Qué va a salir de esto, antes de pulsar. Es lo único que convierte esta
        casilla en algo comprobable: dos cifras crudas -- dónde está el vídeo y
        qué marca el reloj -- no dicen nada por sí solas, y la que de verdad se
        guarda no es ninguna de las dos sino la resta de ambas.
      */}
      {lectura && 'offsetMs' in lectura && (
        <p className="mt-2 text-[11px] text-slate-400">
          Con el vídeo en <span className="tabular-nums">{mmss(posicionS)}</span>, esta grabación{' '}
          <span className="text-slate-200">{enPalabras(lectura.offsetMs)}</span>.
        </p>
      )}
      {lectura && 'error' in lectura && (
        <p className="mt-2 text-[11px] text-amber-400">{lectura.error}</p>
      )}

      {/*
        La preparación cuenta 5:00→0:00 y la partida 30:00→0:00, así que la misma
        cifra aparece dos veces en una guerra separada por media hora. Elegir mal
        el interruptor es el peor error posible aquí, y por eso se dice cómo
        distinguirlo en vez de confiar en que se acuerden.
      */}
      <p className="mt-2 text-[11px] text-slate-500">
        Por encima de 5:00 es siempre partida. Por debajo, mira el rótulo bajo el reloj.
      </p>
    </div>
  );
};

export default MarcaDeReloj;
