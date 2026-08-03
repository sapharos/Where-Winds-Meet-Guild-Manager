import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * La superficie que se abre por encima de todo lo demás.
 *
 * Existe porque el mismo bloque estaba copiado literalmente en nueve sitios --
 * `fixed inset-0 ... items-start justify-center p-6 overflow-y-auto` con una
 * caja dentro -- y con él, nueve veces los mismos fallos: 48 de los 375 píxeles
 * del teléfono gastados en márgenes exteriores, la cabecera desapareciendo al
 * primer desplazamiento, el scroll de la página moviéndose por debajo al llegar
 * al final, ningún cierre con Escape, ningún foco atrapado y ningún gesto.
 *
 * En un teléfono es una hoja anclada abajo, que es donde llega el pulgar; a
 * partir de `sm` vuelve a ser un diálogo centrado, porque en un escritorio una
 * hoja pegada al borde inferior no significa nada. Es la misma pieza en los dos
 * sitios: lo que cambia es de dónde entra y contra qué borde se apoya.
 */

interface Props {
  title: string;
  subtitle?: React.ReactNode;
  /** Ancho máximo en escritorio. En móvil siempre ocupa todo. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Va pegado al pie, fuera del área que hace scroll. */
  footer?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}

const ANCHOS: Record<NonNullable<Props['size']>, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-3xl',
  xl: 'sm:max-w-5xl',
};

/** Lo que puede recibir el foco dentro de la hoja. */
const FOCO =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** A partir de aquí el gesto se lee como "cerrar" y no como "he dudado". */
const UMBRAL = 96;

const Sheet: React.FC<Props> = ({ title, subtitle, size = 'md', footer, onClose, children }) => {
  const caja = useRef<HTMLDivElement>(null);
  const devolverFoco = useRef<HTMLElement | null>(null);
  // Cuánto se ha arrastrado hacia abajo. Sólo `transform`, nunca `top`.
  const [arrastre, setArrastre] = useState(0);
  const inicio = useRef<number | null>(null);

  const cerrar = useCallback(() => onClose(), [onClose]);

  /**
   * Bloquea el scroll de detrás mientras la hoja está abierta.
   *
   * Sin esto, al llegar al final de la hoja el gesto seguía desplazando la
   * página de debajo, y al cerrar aparecías en otro sitio del roster. Se guarda
   * la posición y se restaura, porque `position: fixed` sobre el body la
   * pierde.
   */
  useEffect(() => {
    const y = window.scrollY;
    const previo = document.body.style.cssText;
    document.body.style.cssText += `position:fixed;top:${-y}px;left:0;right:0;width:100%;`;
    return () => {
      document.body.style.cssText = previo;
      window.scrollTo(0, y);
    };
  }, []);

  /** Escape cierra, y el tabulador no se escapa de la hoja. */
  useEffect(() => {
    devolverFoco.current = document.activeElement as HTMLElement;
    const dentro = caja.current?.querySelectorAll<HTMLElement>(FOCO);
    dentro?.[0]?.focus();

    const alPulsar = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        cerrar();
        return;
      }
      if (event.key !== 'Tab' || !caja.current) return;
      const focables = [...caja.current.querySelectorAll<HTMLElement>(FOCO)].filter(
        (e) => e.offsetParent !== null,
      );
      if (!focables.length) return;
      const primero = focables[0];
      const ultimo = focables[focables.length - 1];
      if (event.shiftKey && document.activeElement === primero) {
        event.preventDefault();
        ultimo.focus();
      } else if (!event.shiftKey && document.activeElement === ultimo) {
        event.preventDefault();
        primero.focus();
      }
    };

    window.addEventListener('keydown', alPulsar, true);
    return () => {
      window.removeEventListener('keydown', alPulsar, true);
      // Devolver el foco a donde estaba: quien abrió esto con el teclado tiene
      // que volver al botón que pulsó, no al principio del documento.
      devolverFoco.current?.focus?.();
    };
  }, [cerrar]);

  /**
   * Arrastrar hacia abajo para cerrar, sólo desde el asa y la cabecera.
   *
   * Desde el cuerpo no, y no es un olvido: el cuerpo hace scroll, y un gesto que
   * significa dos cosas a la vez acaba haciendo la que no querías.
   */
  const agarrar = (event: React.PointerEvent) => {
    if (window.matchMedia('(min-width: 640px)').matches) return;
    inicio.current = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const mover = (event: React.PointerEvent) => {
    if (inicio.current === null) return;
    setArrastre(Math.max(0, event.clientY - inicio.current));
  };

  const soltar = () => {
    if (inicio.current === null) return;
    inicio.current = null;
    if (arrastre > UMBRAL) cerrar();
    else setArrastre(0);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-6"
      style={{
        backgroundColor: `rgb(var(--scrim) / var(--scrim-alpha))`,
        // La hoja se apoya sobre el teclado, no debajo de él.
        paddingBottom: 'var(--teclado)',
      }}
      onPointerDown={(event) => {
        // Sólo el velo cierra, no lo que hay dentro de la hoja.
        if (event.target === event.currentTarget) cerrar();
      }}
    >
      <div
        ref={caja}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`
          w-full ${ANCHOS[size]}
          flex flex-col
          bg-slate-900 border border-slate-800
          rounded-t-vessel sm:rounded-lg
          shadow-2
          animate-hoja
        `}
        style={{
          // La hoja se queda con lo que el teclado no ocupa. Sin esto la hoja
          // seguía midiendo el 92% de la pantalla y el teclado se le ponía
          // encima, tapando justo el campo que se acababa de tocar.
          maxHeight: 'calc(92dvh - var(--teclado))',
          ...(arrastre ? { transform: `translateY(${arrastre}px)`, transition: 'none' } : null),
        }}
      >
        {/* El asa: la señal de que esto se puede arrastrar, y el sitio por donde
            se agarra. Sólo en móvil, que es donde el gesto existe. */}
        <div
          className="sm:hidden pt-2 pb-1 shrink-0 cursor-grab touch-none"
          onPointerDown={agarrar}
          onPointerMove={mover}
          onPointerUp={soltar}
          onPointerCancel={soltar}
        >
          <div className="mx-auto h-1 w-10 rounded-full bg-slate-700" aria-hidden />
        </div>

        {/* Pegada, no desplazable: en el historial de guerras la cabecera se iba
            de la pantalla al primer scroll y sólo volvía subiendo del todo. */}
        <div
          className="shrink-0 flex items-start justify-between gap-3 px-4 sm:px-6 pt-2 pb-3 border-b border-slate-800"
          onPointerDown={agarrar}
          onPointerMove={mover}
          onPointerUp={soltar}
          onPointerCancel={soltar}
        >
          <div className="min-w-0">
            <h2 className="cinzel text-xl font-bold text-amber-500 truncate">{title}</h2>
            {subtitle && <p className="text-meta text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={cerrar}
            aria-label="Cerrar"
            className="shrink-0 min-h-tap min-w-tap -mr-2 flex items-center justify-center rounded-md text-slate-400 hover:text-amber-500 transition-colors duration-micro"
          >
            <i className="fa-solid fa-xmark text-xl"></i>
          </button>
        </div>

        <div className="overflow-y-auto overscroll-contain px-4 sm:px-6 pt-4 pb-5 grow">{children}</div>

        {footer && (
          <div className="shrink-0 border-t border-slate-800 px-4 sm:px-6 py-3 pb-safe-b sm:pb-3">
            {footer}
          </div>
        )}

        {/* Sin pie, el área de gestos del teléfono se come el último elemento. */}
        {!footer && <div className="shrink-0 h-safe-b sm:hidden" aria-hidden />}
      </div>
    </div>
  );
};

export default Sheet;
