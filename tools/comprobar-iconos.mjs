/**
 * Comprueba que todos los iconos del marcado están en las hojas generadas.
 *
 *   node tools/comprobar-iconos.mjs
 *
 * Por qué existe. Las hojas de `generar-iconos.mjs` se generan a mano y se
 * suben al repositorio, así que añadir un `<i className="fa-solid fa-calendar-day">`
 * y no volver a generarlas no rompe nada: compila, arranca, y el icono
 * sencillamente no está. No hay error en consola ni hueco evidente -- una
 * máscara sin imagen es un espacio en blanco del tamaño de una letra.
 *
 * Así se colaron quince: toda la iconografía de la agenda estuvo semanas
 * invisible y sólo se notó cuando la pestaña «Agenda» apareció sin dibujo al
 * lado de cuatro que sí lo tenían.
 *
 * Va en `npm run build` porque el momento de enterarse es antes de desplegar, y
 * porque el arreglo es una orden: `npm run iconos`.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

const FUENTES = ['.tsx', '.ts', '.html'];
const IGNORAR = new Set(['node_modules', 'dist', '.git', 'tools']);

function archivos(dir) {
  const salida = [];
  for (const nombre of readdirSync(dir)) {
    if (IGNORAR.has(nombre)) continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...archivos(ruta));
    else if (FUENTES.includes(extname(nombre))) salida.push(ruta);
  }
  return salida;
}

/**
 * Los pares (familia, nombre) que pide el marcado.
 *
 * Se buscan en los dos órdenes porque las dos formas se leen igual de bien y
 * en el proyecto están las dos: `fa-solid fa-wind` y `fa-wind fa-solid`.
 */
function usados() {
  const pares = new Map();
  const dinamicos = [];

  for (const ruta of archivos(raiz)) {
    const texto = readFileSync(ruta, 'utf8');
    const relativa = ruta.slice(raiz.length + 1);

    for (const re of [
      /fa-(solid|regular|brands)\s+fa-([a-z0-9-]+)/g,
      /fa-([a-z0-9-]+)\s+fa-(solid|regular|brands)/g,
    ]) {
      const alReves = re.source.startsWith('fa-(solid');
      for (const m of texto.matchAll(re)) {
        const familia = alReves ? m[1] : m[2];
        const nombre = alReves ? m[2] : m[1];
        // `fa-chevron-${arriba ? 'up' : 'down'}` deja un nombre cortado. No se
        // puede comprobar desde aquí, pero callarlo tampoco vale.
        if (nombre.endsWith('-')) dinamicos.push(`${relativa}: fa-${nombre}…`);
        else pares.set(`${familia}/${nombre}`, relativa);
      }
    }
  }
  return { pares, dinamicos: [...new Set(dinamicos)] };
}

const hojas = ['iconos.generated.css', 'iconos.catalogo.generated.css']
  .map((n) => readFileSync(join(raiz, 'styles', n), 'utf8'))
  .join('');

const { pares, dinamicos } = usados();
const faltan = [...pares].filter(([clave]) => {
  const [familia, nombre] = clave.split('/');
  return !hojas.includes(`.fa-${familia}.fa-${nombre}{`);
});

if (dinamicos.length) {
  console.log(`iconos: ${dinamicos.length} con el nombre compuesto en tiempo de ejecución, sin comprobar`);
  for (const d of dinamicos) console.log(`  ${d}`);
}

if (!faltan.length) {
  console.log(`iconos: ${pares.size} comprobados, todos dibujables`);
  process.exit(0);
}

console.error(`\niconos: ${faltan.length} usados en el marcado y ausentes de las hojas:\n`);
for (const [clave, donde] of faltan) {
  const [familia, nombre] = clave.split('/');
  console.error(`  fa-${familia} fa-${nombre}   (${donde})`);
}
console.error(`
Saldrían como un hueco en blanco, sin error en consola.

  npm run iconos

Si alguno es de una familia que no es la sólida, hay que añadirlo antes a
REGULARES o BRANDS en tools/generar-iconos.mjs: la lectura del fuente no
distingue familias que se eligen en tiempo de ejecución.
`);
process.exit(1);
