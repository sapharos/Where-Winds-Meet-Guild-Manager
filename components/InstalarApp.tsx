import React, { useSyncExternalStore } from 'react';
import {
  esSafariEnIOS,
  estaInstalada,
  puedeSolicitar,
  solicitarInstalacion,
  suscribir,
} from '../services/instalacion';

/**
 * La oferta de llevarse la aplicación al teléfono.
 *
 * Tres estados y sólo uno visible a la vez. Con la oferta de Chrome guardada,
 * un botón que lanza el diálogo nativo. En Safari de iOS, donde no hay diálogo
 * que lanzar, la nota con el gesto manual. En todo lo demás -- ya instalada,
 * navegador sin soporte, escritorio sin interés -- nada: un botón que no puede
 * cumplir lo que ofrece es peor que ningún botón.
 */
const InstalarApp: React.FC = () => {
  const hayOferta = useSyncExternalStore(suscribir, puedeSolicitar, () => false);

  if (estaInstalada()) return null;

  if (hayOferta) {
    return (
      <button
        onClick={() => void solicitarInstalacion()}
        className="w-full text-xs py-2 px-3 rounded border border-slate-800 text-slate-400 hover:text-amber-500 transition-all flex items-center justify-center gap-2"
      >
        <i className="fa-solid fa-mobile-screen-button"></i>
        Instalar en este aparato
      </button>
    );
  }

  if (esSafariEnIOS()) {
    return (
      <p className="text-[10px] text-slate-600 text-center leading-relaxed">
        <i className="fa-solid fa-mobile-screen-button mr-1"></i>
        Para instalarla: <i className="fa-solid fa-arrow-up-from-bracket mx-0.5"></i>
        Compartir → «Añadir a pantalla de inicio».
      </p>
    );
  }

  return null;
};

export default InstalarApp;
