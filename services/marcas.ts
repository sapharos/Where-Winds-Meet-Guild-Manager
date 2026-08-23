/**
 * Colocar marcas en una barra de tiempo sin que se tapen.
 *
 * Aparte del componente porque es cálculo, no interfaz, y porque así se puede
 * probar: Node sabe quitar los tipos de un `.ts`, pero no de un `.tsx` con JSX
 * dentro.
 */

/**
 * Agrupa las marcas que caen demasiado juntas para distinguirse.
 *
 * Hace falta porque una guerra son 35 minutos y la barra unos 800 px: un
 * segundo mide un tercio de píxel, así que dos comentarios separados por medio
 * minuto se pintan encima. Antes sólo se veía el último y los demás quedaban
 * ocultos SIN AVISO -- desaparecidos, no apilados.
 *
 * Se agrupa en píxeles y no en segundos porque lo que estorba es el solape en
 * pantalla: la misma pareja de marcas se pisa en un teléfono y se distingue de
 * sobra en un monitor ancho.
 */
export function agrupar<T extends { segundo: number }>(
  marcas: T[],
  duracion: number,
  anchoPx: number,
  separacionPx = 14,
): { centro: number; miembros: T[] }[] {
  if (!duracion || !anchoPx) return marcas.map((m) => ({ centro: m.segundo, miembros: [m] }));
  const aPx = (s: number) => (s / duracion) * anchoPx;

  const grupos: { centro: number; miembros: T[] }[] = [];
  for (const m of [...marcas].sort((a, b) => a.segundo - b.segundo)) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && aPx(m.segundo) - aPx(ultimo.miembros[0].segundo) < separacionPx) {
      ultimo.miembros.push(m);
      // El grupo se ancla en la PRIMERA, no en la media: así el punto no se
      // mueve al añadir una marca al final del racimo, y saltar a él lleva al
      // principio de lo que pasó y no a la mitad.
      continue;
    }
    grupos.push({ centro: m.segundo, miembros: [m] });
  }
  return grupos;
}
