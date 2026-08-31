/**
 * Convierte los iconos de Font Awesome que este proyecto usa en una hoja de
 * estilos propia, y saca su CDN del camino crítico.
 *
 *   node tools/generar-iconos.mjs
 *
 * Por qué existe. La aplicación pedía a cdnjs 302 KB medidos en cada visita:
 * 18,7 KB de hoja y tres ficheros de fuente de 150, 108 y 25 KB, para dibujar
 * un puñado de iconos. En un teléfono de gama media con conexión inestable eso
 * es un origen de terceros y cuatro peticiones antes de que se pinte nada.
 *
 * Por qué no se han dibujado a mano. Serían 261 iconos nuevos: mucho trabajo y,
 * peor, un cambio de aspecto -- y esto es un cambio de piel, no un rediseño de
 * la iconografía. Los trazados salen de los paquetes oficiales de Font Awesome,
 * así que el dibujo es exactamente el mismo que hoy.
 *
 * Por qué no se toca ninguna llamada. El marcado sigue siendo
 * `<i className="fa-solid fa-wind">` en unos doscientos sitios. Lo que cambia es
 * de dónde sale el dibujo: una máscara CSS en vez de un glifo de fuente. La
 * máscara se pinta con `background-color: currentColor`, así que los iconos
 * siguen heredando el color del texto como hacían.
 *
 * Los 261 van enteros y no sólo los ~45 que aparecen en el marcado: los otros
 * son el catálogo que un miembro puede elegir para un conjunto de armas o una
 * unidad táctica, se guardan en la base de datos y hay que poder dibujar
 * cualquiera. Quitarlos sería quitar funcionalidad.
 *
 * Los iconos de Font Awesome Free son CC BY 4.0; la atribución va en la cabecera
 * del archivo generado.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as solid from '@fortawesome/free-solid-svg-icons';
import * as regular from '@fortawesome/free-regular-svg-icons';
import * as brands from '@fortawesome/free-brands-svg-icons';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
/** Los que dibuja el armazón de la aplicación. Bloquean la primera pintura. */
const SALIDA = join(raiz, 'styles', 'iconos.generated.css');
/**
 * El catálogo que un miembro puede elegir para un conjunto o una unidad.
 *
 * Va aparte y se carga después. Son cinco sextos del peso y sirven para
 * dibujar la insignia de un conjunto de armas: llegar un instante tarde a eso
 * no le cuesta nada a nadie, y esperarlos antes de pintar la primera pantalla
 * sí, sobre una conexión que se cae.
 */
const SALIDA_CATALOGO = join(raiz, 'styles', 'iconos.catalogo.generated.css');

/**
 * Los que se piden en una familia que no es la sólida.
 *
 * Se listan a mano en vez de deducirse porque el marcado los elige en tiempo de
 * ejecución (`${activo ? 'fa-solid' : 'fa-regular'} fa-star`) y ninguna lectura
 * del fuente lo vería. Si algún día se añade otro, sale como cuadro vacío: es
 * el precio de no arrastrar las 163 variantes regulares que nadie usa.
 *
 * `comprobar.mjs` es lo que evita que ese cuadro vacío llegue a producción: pasa
 * el marcado entero contra las hojas generadas y canta lo que falte.
 */
const REGULARES = ['star', 'calendar', 'circle', 'clock'];
const MARCAS = ['discord', 'playstation', 'youtube'];

// fixtures/ queda fuera: es el banco de pruebas y no debe decidir qué pesa la
// aplicación. Los iconos que inventa salen del catálogo, que se carga igual.
const FUENTES = ['App.tsx', 'index.tsx', 'constants.tsx', 'components', 'services'];
const CATALOGO = join(raiz, 'components', 'iconCatalog.ts');

function ficheros(ruta) {
  const completa = join(raiz, ruta);
  if (!statSync(completa).isDirectory()) return [completa];
  return readdirSync(completa)
    .filter((f) => /\.(tsx?|jsx?)$/.test(f))
    .map((f) => join(completa, f));
}

/**
 * Todo lo que parezca un nombre de icono.
 *
 * `saltar` deja fuera un archivo concreto, que es como se distingue lo que
 * dibuja el armazón de lo que sólo está ofrecido en el catálogo.
 */
function nombresUsados(saltar) {
  const fuera = new Set([
    'solid', 'regular', 'brands', 'spin', 'fw', 'beat', 'fade', 'flip', 'pulse',
    'bounce', 'shake', 'spin-pulse', 'inverse', 'stack', 'border', 'li',
  ]);
  const encontrados = new Set();
  for (const ruta of FUENTES) {
    for (const fichero of ficheros(ruta)) {
      if (fichero === saltar) continue;
      const texto = readFileSync(fichero, 'utf8');
      for (const [, nombre] of texto.matchAll(/\bfa-([a-z0-9-]+)/g)) {
        // Se descartan los restos de una clase compuesta a trozos
        // (`fa-${familia}-algo` deja `fa-` colgando): no son nombres de icono
        // y buscarlos revienta el paso a camelCase.
        if (fuera.has(nombre) || /(^-|-$|--)/.test(nombre)) continue;
        encontrados.add(nombre);
      }
    }
  }
  return encontrados;
}

/** Sólo los del catálogo elegible, para poder apartarlos del arranque. */
function nombresDelCatalogo() {
  const texto = readFileSync(CATALOGO, 'utf8');
  const encontrados = new Set();
  for (const [, nombre] of texto.matchAll(/"fa-([a-z0-9-]+)"/g)) encontrados.add(nombre);
  return encontrados;
}

/** camelCase del nombre exportado: `arrow-up` -> `faArrowUp`. */
const exportado = (nombre) =>
  'fa' + nombre.split('-').map((p) => p[0].toUpperCase() + p.slice(1)).join('');

function buscar(paquete, nombre) {
  const dato = paquete[exportado(nombre)];
  if (!dato || !Array.isArray(dato.icon)) return null;
  const [ancho, alto, , , trazado] = dato.icon;
  // Los iconos con más de un trazado (duotono) no están en la versión libre;
  // si apareciera uno, mejor saberlo que dibujarlo a medias.
  if (typeof trazado !== 'string') return null;
  return { ancho, alto, trazado };
}

/**
 * El SVG como URI, codificando sólo lo que rompe una `url()` entre comillas
 * dobles. Se deja en texto plano en vez de en base64 a propósito: comprime
 * mucho mejor, y estos 261 dibujos comparten media sintaxis entre sí.
 */
function uri({ ancho, alto, trazado }) {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${ancho} ${alto}'>` +
    `<path d='${trazado}'/></svg>`;
  return svg
    .replace(/%/g, '%25')
    .replace(/"/g, '%22')
    .replace(/#/g, '%23')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/\n/g, '');
}

const usados = nombresUsados();
const usadoFueraDelCatalogo = nombresUsados(CATALOGO);
const delCatalogo = nombresDelCatalogo();
const reglas = [];
const reglasCatalogo = [];
const perdidos = [];

const emitir = (familia, clase, paquete, nombre, destino) => {
  const dato = buscar(paquete, nombre);
  if (!dato) {
    perdidos.push(`${familia} ${nombre}`);
    return;
  }
  // El ancho conserva la proporción del dibujo dentro de una caja de 1em de
  // alto. Sin esto los iconos anchos salen aplastados.
  const ancho = (dato.ancho / dato.alto).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  destino.push(`.${clase}.fa-${nombre}{--fa-i:url("data:image/svg+xml,${uri(dato)}");width:${ancho}em}`);
};

// Las marcas no existen en la familia sólida, así que se apartan antes de
// buscarlas ahí: si no, el aviso de "no encontrado" salta siempre y deja de
// significar nada el día que falte un icono de verdad.
const soloMarcas = new Set(MARCAS);
for (const nombre of [...usados].sort()) {
  if (soloMarcas.has(nombre)) continue;
  // Un icono que además está escrito en el marcado se queda en el arranque
  // aunque figure en el catálogo: si el armazón lo dibuja, hace falta ya.
  const soloCatalogo = delCatalogo.has(nombre) && !usadoFueraDelCatalogo.has(nombre);
  emitir('fa-solid', 'fa-solid', solid, nombre, soloCatalogo ? reglasCatalogo : reglas);
}
for (const nombre of REGULARES) emitir('fa-regular', 'fa-regular', regular, nombre, reglas);
for (const nombre of MARCAS) emitir('fa-brands', 'fa-brands', brands, nombre, reglas);

const cabecera = `/*
 * GENERADO POR tools/generar-iconos.mjs -- no editar a mano.
 * Vuelve a generarlo cuando se añada un icono nuevo al marcado o al catálogo.
 *
 * Iconos de Font Awesome Free 6.x, licencia CC BY 4.0.
 * https://fontawesome.com/license/free
 *
 * ${reglas.length} iconos del armazón, más ${reglasCatalogo.length} del catálogo
 * en iconos.catalogo.generated.css. Entre los dos sustituyen a la hoja y las
 * tres fuentes que se pedían a cdnjs, 302 KB medidos por visita.
 */

/* La caja del icono. El dibujo es una máscara y el color lo pone
   background-color, que es lo que mantiene el heredado de currentColor
   que tenía la fuente. */
.fa-solid,
.fa-regular,
.fa-brands {
  display: inline-block;
  height: 1em;
  vertical-align: -0.125em;
  background-color: currentColor;
  -webkit-mask-image: var(--fa-i);
  mask-image: var(--fa-i);
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
}

/* La rueda de carga. Respeta el ajuste del sistema: quien pide menos
   movimiento no debería recibir algo girando indefinidamente. */
@keyframes fa-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.fa-spin {
  animation: fa-spin 2s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .fa-spin { animation: none; }
}

/* Ancho fijo, para columnas de iconos alineadas. */
.fa-fw { width: 1.25em; }
`;

writeFileSync(SALIDA, `${cabecera}\n${reglas.join('\n')}\n`, 'utf8');

const cabeceraCatalogo = `/*
 * GENERADO POR tools/generar-iconos.mjs -- no editar a mano.
 *
 * Iconos de Font Awesome Free 6.x, licencia CC BY 4.0.
 * https://fontawesome.com/license/free
 *
 * Los ${reglasCatalogo.length} que un miembro puede elegir para un conjunto de armas o una
 * unidad táctica, y que el armazón no dibuja por su cuenta. Se cargan después
 * de la primera pintura desde index.tsx: son cinco sextos del peso de los
 * iconos y ninguno hace falta para leer la pantalla.
 *
 * Las reglas base (.fa-solid y compañía) están en iconos.generated.css.
 */`;

writeFileSync(SALIDA_CATALOGO, `${cabeceraCatalogo}\n\n${reglasCatalogo.join('\n')}\n`, 'utf8');

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(
  `armazón: ${reglas.length} iconos, ${kb(readFileSync(SALIDA).length)}\n` +
    `catálogo: ${reglasCatalogo.length} iconos, ${kb(readFileSync(SALIDA_CATALOGO).length)} (carga diferida)`,
);
if (perdidos.length) {
  console.warn(`\nNo encontrados en los paquetes (saldrán en blanco):\n  ${perdidos.join('\n  ')}`);
  process.exitCode = 1;
}
