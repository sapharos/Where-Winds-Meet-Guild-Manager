/**
 * Cuánto ocupa el teclado del teléfono, para que no tape lo que se escribe.
 *
 * El navegador no reduce la página cuando sale el teclado: la deja igual y le
 * pone el teclado encima. Así que un campo que estaba en la mitad de abajo
 * queda debajo del teclado, y quien escribe no ve lo que escribe -- que en un
 * formulario de miembro o en la celda de una cifra es exactamente el momento
 * en que hace falta verlo.
 *
 * `visualViewport` es lo único que sabe la altura real que queda. Lo que mide
 * se publica como `--teclado` en el documento, y de ahí lo leen las hojas (para
 * encoger) y la barra de navegación (para apartarse). Un solo sitio que mide y
 * muchos que reaccionan, en vez de que cada pantalla se lo invente.
 *
 * En escritorio no hace nada: sin `visualViewport` o sin teclado, la variable
 * vale 0 y ninguna regla que dependa de ella cambia nada.
 */

/** Por debajo de esto no es un teclado, es la barra de direcciones. */
const MINIMO = 120;

/** Margen entre el campo enfocado y el borde superior del teclado. */
const AIRE = 16;

let instalado = false;

function medir(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  // Lo que la ventana tiene y el área visible no: el teclado, y en iOS también
  // el desplazamiento que el propio navegador aplica al enfocar.
  const oculto = window.innerHeight - vv.height - vv.offsetTop;
  return oculto > MINIMO ? Math.round(oculto) : 0;
}

function publicar(alto: number) {
  document.documentElement.style.setProperty('--teclado', `${alto}px`);
  // Un atributo además de la medida, para las reglas que sólo necesitan saber
  // si está o no está y no quieren hacer aritmética con la variable.
  if (alto > 0) document.documentElement.dataset.teclado = 'abierto';
  else delete document.documentElement.dataset.teclado;
}

/**
 * Sube el campo enfocado por encima del teclado, si se ha quedado debajo.
 *
 * No usa `scrollIntoView` a secas: eso centra el campo, que en un formulario
 * largo salta media pantalla y hace perder de vista la etiqueta y el error.
 * Aquí sólo se mueve lo justo, y sólo cuando de verdad está tapado.
 */
function asomar(alto: number) {
  const activo = document.activeElement as HTMLElement | null;
  if (!activo || alto === 0) return;
  if (!activo.matches('input, select, textarea, [contenteditable="true"]')) return;

  const caja = activo.getBoundingClientRect();
  const techo = window.innerHeight - alto - AIRE;
  if (caja.bottom <= techo) return;

  const falta = caja.bottom - techo;
  // El contenedor con scroll más cercano, que dentro de una hoja no es la
  // página: mover la página no haría nada porque la hoja está fija.
  let padre: HTMLElement | null = activo.parentElement;
  while (padre) {
    const estilo = getComputedStyle(padre);
    if (/(auto|scroll)/.test(estilo.overflowY) && padre.scrollHeight > padre.clientHeight) break;
    padre = padre.parentElement;
  }
  if (padre) padre.scrollBy({ top: falta, behavior: 'smooth' });
  else window.scrollBy({ top: falta, behavior: 'smooth' });
}

export function instalarTeclado(): () => void {
  if (instalado) return () => undefined;
  instalado = true;

  const vv = window.visualViewport;
  publicar(0);
  if (!vv) return () => undefined;

  let pendiente = 0;
  const actualizar = () => {
    const alto = medir();
    publicar(alto);
    // El campo se busca un instante después: al enfocar, el teclado todavía se
    // está abriendo y la medida de ese momento es la de antes.
    window.clearTimeout(pendiente);
    pendiente = window.setTimeout(() => asomar(medir()), 120);
  };

  vv.addEventListener('resize', actualizar);
  vv.addEventListener('scroll', actualizar);
  document.addEventListener('focusin', actualizar);

  return () => {
    vv.removeEventListener('resize', actualizar);
    vv.removeEventListener('scroll', actualizar);
    document.removeEventListener('focusin', actualizar);
    window.clearTimeout(pendiente);
    publicar(0);
    instalado = false;
  };
}
