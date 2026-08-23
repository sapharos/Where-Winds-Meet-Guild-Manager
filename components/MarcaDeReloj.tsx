import React, { useState } from 'react';
import { Fase, PARTIDA_S, PREPARACION_S, offsetDesde } from '../services/relojGuerra';

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

const MarcaDeReloj: React.FC<Props> = ({ posicionS, onAplicar, compacto }) => {
  // Por defecto partida: es la fase larga --30 de los 35 minutos-- así que
  // acierta seis de cada siete veces.
  const [fase, setFase] = useState<Fase>('partida');
  const [marca, setMarca] = useState('');

  const valida = /^\d{1,2}\s*:\s*\d{2}$/.test(marca);

  const aplicar = () => {
    const m = marca.match(/^(\d{1,2})\s*:\s*(\d{2})$/);
    if (!m) return;
    const restante = Number(m[1]) * 60 + Number(m[2]);
    // La preparación no pasa de 5:00 ni la partida de 30:00. Un valor mayor es
    // una errata, y aceptarlo dejaría el vídeo alineado en un sitio imposible.
    if (restante > (fase === 'preparacion' ? PREPARACION_S : PARTIDA_S)) return;
    onAplicar(offsetDesde({ restante, fase, posicionS }));
    setMarca('');
  };

  const mmss = `${Math.floor(posicionS / 60)}:${String(Math.floor(posicionS % 60)).padStart(2, '0')}`;

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
        <button
          type="button"
          disabled={!valida}
          onClick={aplicar}
          className="px-3 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs"
        >
          Aplicar en {mmss}
        </button>
      </div>
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
