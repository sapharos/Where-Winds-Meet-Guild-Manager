import React, { useId, useState } from 'react';

/**
 * Una sección que llega cerrada y dice qué guarda dentro.
 *
 * "Mi perfil" es la pantalla que se abre sola, y montaba cinco bloques
 * completos uno detrás de otro: la ficha, las builds, las estadísticas, el
 * equipo entero y el historial de guerras. En un teléfono eso es un scroll muy
 * largo para un producto que se usa en visitas de menos de dos minutos, y las
 * dos últimas secciones son las que menos se miran y las que más ocupan.
 *
 * Plegar no es esconder, y en eso se juega todo: el titular sigue diciendo qué
 * hay dentro, y el resumen da la cifra que la mayoría de las veces era lo único
 * que se venía a mirar. Quien quiera el detalle lo abre; quien no, ya lo ha
 * leído sin desplazarse.
 *
 * Se usa `<details>` en vez de estado propio porque el navegador ya sabe hacer
 * esto: es plegable con el teclado, lo anuncia un lector de pantalla, y el
 * buscador del navegador encuentra texto dentro de una sección cerrada.
 */

interface Props {
  titulo: string;
  /** La cifra o la frase que evita tener que abrir. */
  resumen?: React.ReactNode;
  icono?: string;
  /** Abierta de entrada. Para las secciones que sí son el motivo de la visita. */
  abiertaPorDefecto?: boolean;
  children: React.ReactNode;
}

const Seccion: React.FC<Props> = ({
  titulo,
  resumen,
  icono,
  abiertaPorDefecto = false,
  children,
}) => {
  const id = useId();
  // Sólo para saber si ya se abrió una vez: el contenido no se monta hasta
  // entonces, que es la mitad del motivo de plegarla. GearSheet pide cinco
  // cosas al servidor nada más montarse.
  const [abierta, setAbierta] = useState(abiertaPorDefecto);

  return (
    <details
      open={abiertaPorDefecto}
      onToggle={(event) => setAbierta((event.currentTarget as HTMLDetailsElement).open)}
      className="group bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden"
    >
      <summary
        aria-controls={id}
        className="list-none cursor-pointer min-h-tap flex items-center gap-3 px-4 sm:px-6 py-3"
      >
        {icono && <i className={`fa-solid ${icono} text-slate-500 shrink-0`}></i>}
        <span className="min-w-0 flex-1">
          <span className="cinzel block text-xl font-bold text-amber-500 truncate">{titulo}</span>
          {resumen && <span className="block text-meta text-slate-500 truncate">{resumen}</span>}
        </span>
        <i
          className="fa-solid fa-chevron-down text-slate-500 shrink-0 transition-transform duration-micro ease-glaze group-open:rotate-180"
          aria-hidden
        ></i>
      </summary>

      <div id={id} className="px-4 sm:px-6 pb-5 pt-1 border-t border-slate-800">
        {abierta && children}
      </div>
    </details>
  );
};

export default Seccion;
