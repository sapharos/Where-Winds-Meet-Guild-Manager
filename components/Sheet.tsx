import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'video';
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
  // Para el vídeo. Un 16:9 dentro de 5xl deja media pantalla vacía en un
  // monitor ancho, y aquí lo que se mira es la imagen: cuanto más grande,
  // mejor se ve quién estaba dónde.
  video: 'sm:max-w-[min(96rem,95vw)]',
};

/** Lo que puede recibir el foco dentro de la hoja. */
const FOCO =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** A partir de aquí el gesto se lee como "cerrar" y no como "he dudado". */
const UMBRAL = 96;

const Sheet: React.FC<Props> = ({ title, subtitle, size = 'md', footer, onClose, children }) => {
  const caja = useRef<HTMLDivElement>(null);
  /**
   * Quién tenía el foco antes de abrir, para devolvérselo al cerrar.
   *
   * Se lee en el primer render y no en un efecto, porque un efecto llega
   * tarde: React aplica el `autoFocus` del contenido al montar, o sea antes,
   * así que lo que se guardaba era el campo de dentro de la hoja. Al cerrar se
   * intentaba devolver el foco a un elemento que se estaba desmontando, no
   * pasaba nada, y acababa en el `body` -- justo el «principio del documento»
   * que esto venía a evitar. En el primer render el foco todavía está en el
   * botón que abrió la hoja, que es lo que hay que recordar.
   */
  const devolverFoco = useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement),
  );
  /** A quién se le dio el foco al abrir. Ver el efecto de más abajo. */
  const objetivo = useRef<HTMLElement | null>(null);
  // Cuánto se ha arrastrado hacia abajo. Sólo `transform`, nunca `top`.
  const [arrastre, setArrastre] = useState(0);
  const inicio = useRef<number | null>(null);

  /**
   * Cerrar, con identidad fija de por vida.
   *
   * `onClose` casi siempre llega como una función escrita en el sitio
   * -- `onClose={() => setFormOpen(false)}` --, así que es nueva en cada render
   * del padre. Colgar de ella un `useCallback` hacía que `cerrar` cambiase
   * también, y con él las dependencias del efecto de abajo: el efecto se
   * limpiaba y se volvía a montar, y al montarse mueve el foco al primer
   * elemento de la hoja, que es la X de cerrar.
   *
   * En un formulario cuyo estado vive en el mismo componente que pinta la hoja
   * -- el alta de miembro, las formaciones -- eso pasaba con **cada tecla**:
   * escribías una letra, el padre se repintaba, y el foco se iba al botón de
   * cerrar. Sólo en ésos, porque son los que se repintan al teclear; los que
   * reciben un `onClose` estable nunca lo hicieron, que es lo que hacía que el
   * fallo pareciera cosa de dos formularios sueltos.
   *
   * La referencia se actualiza después de cada render, así que Escape y el
   * velo siguen llamando al `onClose` de ahora y no al del primer render.
   */
  const ultimoCierre = useRef(onClose);
  useEffect(() => {
    ultimoCierre.current = onClose;
  });
  const cerrar = useCallback(() => ultimoCierre.current(), []);

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
    /*
      Dónde va el cursor al abrir, decidido una sola vez.

      Varios formularios ponen `autoFocus` en su primer campo -- el alta de
      miembro, iniciar guerra, los conjuntos de armas --, y llevarse el foco a
      la X es contradecirles: se abría el formulario con el cursor en el botón
      de cerrar y había que ir a buscar el campo con el ratón. Así que si el
      contenido ya dijo dónde lo quiere, se respeta; y si no dijo nada, el
      primer elemento de la hoja.

      La decisión se guarda porque en `StrictMode` esto se monta, se desmonta y
      se vuelve a montar: la limpieza de en medio devuelve el foco al botón que
      abrió la hoja, así que en la segunda vuelta ya no habría rastro del
      `autoFocus` y se acabaría enfocando la X igual. Recordando el elemento se
      repite la misma decisión en las dos vueltas, y en producción -- una sola
      vuelta -- hace exactamente lo mismo.
    */
    if (!objetivo.current) {
      objetivo.current = caja.current?.contains(document.activeElement)
        ? (document.activeElement as HTMLElement)
        : caja.current?.querySelector<HTMLElement>(FOCO) ?? null;
    }
    objetivo.current?.focus();

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

  /**
   * La hoja se cuelga del `body`, no de donde se abrió.
   *
   * `fixed` no significa "respecto a la pantalla" si algún antepasado tiene un
   * `transform`, un `filter` o una animación que los rellene: ese antepasado
   * pasa a ser el bloque contenedor y además el contexto de apilamiento, así
   * que `inset-0` se queda en el tamaño de la caja de arriba y `z-60` sólo
   * compite dentro de ella. En el roster eso ponía la hoja dentro de la celda
   * del grid y por debajo de las tarjetas que vienen después.
   *
   * Un portal lo resuelve de una vez para las nueve hojas, y no cada vez que
   * alguien anime un contenedor. Los eventos de React siguen subiendo por el
   * árbol de componentes, así que quien la abrió sigue oyéndolos.
   */
  return createPortal(
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
    </div>,
    document.body,
  );
};

export default Sheet;
