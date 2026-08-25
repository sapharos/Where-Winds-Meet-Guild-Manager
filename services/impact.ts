/**
 * El puntaje de impacto, para la web.
 *
 * El cálculo en sí no está aquí: vive en `server/impact.js` y esto es la
 * envoltura que le pone los tipos. La razón es de empaquetado y no de diseño --
 * la imagen de la API se construye con `./server` como contexto, así que un
 * módulo fuera de ese directorio no llega al contenedor, mientras que la web se
 * construye desde la raíz y sí alcanza `server/`. De los dos sitios posibles,
 * ése es el único que ven los dos lados.
 *
 * Importa que sea uno solo: el bot de Discord contesta `/impacto` con estas
 * mismas cifras, y dos copias de una fórmula de cien líneas acaban -- no puede
 * que acaben, acaban -- diciéndole a alguien un 74 en la web y un 71 en Discord.
 * Lo que se documenta en PUNTAJE-IMPACTO.md es este cálculo, y hay uno.
 */

import type { WarSide, WeaponSet } from '../types';
import {
  WEIGHTS as PESOS,
  expectationOf as esperado,
  impactOf as puntuar,
  impactShade as tono,
} from '../server/impact.js';

export interface Contribution {
  playerId: string;
  name: string;
  side: WarSide;
  stats: Record<string, number | undefined>;
  /**
   * What the weapons this member carried are expected to reach on each axis,
   * as a fraction of the war's best. Absent, or 1, means no allowance.
   */
  expects?: Record<string, number>;
}

export interface Impact {
  playerId: string;
  name: string;
  /** Nought to a hundred, where a hundred is the best of that war. */
  score: number;
  /**
   * Each axis bent by the curve and measured against what the weapons carried
   * were asked for -- the internal the score is built from, not a figure to
   * show. It reads well above the plain ratio (a 49 % share comes out 61 %),
   * so on screen it matched nothing anyone could divide out of the table.
   */
  parts: Record<string, number>;
  /** Each axis as a plain share of the best in that war, 0 to 1. */
  share: Record<string, number>;
  /** Each axis as a share of everything the war produced on it, 0 to 1. */
  pool: Record<string, number>;
}

/** Lo que vale cada eje una vez normalizado. Ver `server/impact.js`. */
export const WEIGHTS: { key: string; label: string; weight: number }[] = PESOS;

/**
 * Los ejes a los que se le puede poner una expectativa a un conjunto de armas.
 *
 * No todos: las monedas van de tomar objetivos y no de lo que se lleva encima,
 * y las muertes son un castigo, donde una expectativa sería pagar por morirse.
 */
export const TUNABLE_AXES = WEIGHTS.filter((axis) => axis.weight > 0 && axis.key !== 'coin');

/** Lo que se le pide a quien lleva estas armas, como fracción de lo mejor de la guerra. */
export const expectationOf = (
  weapons: string[] | undefined,
  sets: WeaponSet[],
): Record<string, number> => esperado(weapons, sets);

/** Puntúa a todo el mundo de una guerra, unos contra otros. */
export const impactOf = (rows: Contribution[]): Impact[] => puntuar(rows);

/** El color con el que se enseña un puntaje, en todas partes el mismo. */
export const impactShade = (score: number): string => tono(score);
