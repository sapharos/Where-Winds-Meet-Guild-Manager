import React from 'react';

/**
 * 锔钉: la grapa de reparación de porcelana. El elemento firma del producto
 * (docs/DIRECCION_VISUAL.md §5) y significa una sola cosa: "esto está sujeto
 * aquí". La dibuja la navegación bajo la pestaña activa y la lleva el titular
 * fijado a la alineación.
 *
 * Hereda `currentColor` a propósito: quien la usa la pone en `text-staple`,
 * que es el único color en el que la grapa existe.
 */
const Grapa: React.FC<{ width?: number; className?: string }> = ({ width = 22, className = '' }) => (
  <svg
    aria-hidden
    width={width}
    height={(width * 7) / 34}
    viewBox="0 0 34 7"
    className={className}
    fill="currentColor"
  >
    <rect x="4" y="2" width="26" height="2.6" rx="1.3" />
    <circle cx="4" cy="3.3" r="3.2" />
    <circle cx="30" cy="3.3" r="3.2" />
  </svg>
);

export default Grapa;
