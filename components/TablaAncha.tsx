import React from 'react';

/**
 * Una tabla que no cabe, y lo dice.
 *
 * Hay tres en el producto que no tiene sentido convertir en tarjetas: la matriz
 * de permisos, la lista de usuarios y la previsualización de un escaneo. Las
 * tres son rejillas de verdad -- lo que se lee es el cruce entre una fila y una
 * columna -- y partirlas en tarjetas destruiría justo eso.
 *
 * Lo que sí tenían mal era todo lo demás. `overflow-x-auto` a secas no avisa de
 * que hay más a la derecha: en un teléfono la tabla parece cortada, no
 * desplazable. Y al arrastrar se perdía la primera columna, que es la que dice
 * de qué es cada número.
 *
 * Así que la columna se fija con `sticky` en quien la use, y aquí va el aviso y
 * el desvanecido del borde derecho, que es lo que hace visible que la tabla
 * sigue. `overscroll-x-contain` evita que el tirón se lleve la página entera.
 */
const TablaAncha: React.FC<{
  aviso?: string;
  /** Para ocultarla donde una versión en tarjetas la sustituye. */
  className?: string;
  children: React.ReactNode;
}> = ({ aviso = 'Desliza para ver el resto', className = '', children }) => (
  <div className={`relative ${className}`}>
    <p className="md:hidden text-[11px] text-slate-500 mb-1.5 flex items-center gap-1.5">
      <i className="fa-solid fa-arrows-left-right"></i>
      {aviso}
    </p>
    <div className="overflow-x-auto overscroll-x-contain">{children}</div>
    {/* Sólo decorativo, y por eso no se lee ni se pulsa. */}
    <div
      aria-hidden
      className="md:hidden pointer-events-none absolute right-0 top-6 bottom-0 w-6 bg-gradient-to-l from-slate-900 to-transparent"
    />
  </div>
);

export default TablaAncha;
