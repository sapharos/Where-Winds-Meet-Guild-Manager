import React from 'react';

/**
 * El hueco que va a ocupar algo que todavía no ha llegado.
 *
 * Sustituye a la rueda que giraba en el centro de la pantalla. Una rueda dice
 * "espera" y nada más; un esqueleto dice además cuánto vas a esperar y qué va a
 * salir, y sobre todo reserva el sitio -- que es lo que evita que la página
 * pegue el salto cuando por fin llegan los datos.
 *
 * El pulso es de opacidad, así que no fuerza al navegador a recalcular nada, y
 * `prefers-reduced-motion` lo apaga desde tokens.css sin que haya que decir
 * nada aquí.
 */

const base = 'rounded bg-slate-800/70 animate-pulse';

/** Una línea de texto que aún no está. `w` en clases de Tailwind. */
export const Linea: React.FC<{ w?: string; alto?: string }> = ({ w = 'w-full', alto = 'h-4' }) => (
  <div className={`${base} ${w} ${alto}`} aria-hidden />
);

/** Un bloque rectangular: una tarjeta, una imagen, un panel. */
export const Bloque: React.FC<{ alto?: string; className?: string }> = ({
  alto = 'h-20',
  className = '',
}) => <div className={`${base} ${alto} ${className}`} aria-hidden />;

/**
 * Varias filas de lista.
 *
 * Con un tope bajo a propósito: pintar treinta huecos para treinta miembros no
 * informa de nada más que pintar seis, y en un teléfono de gama media son
 * treinta nodos animándose por nada.
 */
export const Filas: React.FC<{ cuantas?: number; alto?: string }> = ({
  cuantas = 5,
  alto = 'h-11',
}) => (
  <div className="flex flex-col gap-2" role="status" aria-label="Cargando">
    {Array.from({ length: Math.min(cuantas, 6) }, (_, at) => (
      <Bloque key={at} alto={alto} />
    ))}
  </div>
);

/** Tarjetas en rejilla, como las del roster. */
export const Tarjetas: React.FC<{ cuantas?: number }> = ({ cuantas = 4 }) => (
  <div
    className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3"
    role="status"
    aria-label="Cargando"
  >
    {Array.from({ length: Math.min(cuantas, 6) }, (_, at) => (
      <Bloque key={at} alto="h-[76px]" />
    ))}
  </div>
);

export default { Linea, Bloque, Filas, Tarjetas };
