/**
 * Contrastes WCAG de la paleta propuesta en docs/DIRECCION_VISUAL.md.
 *
 * Existe para que las cifras del documento se puedan volver a comprobar en vez
 * de creerse: `node docs/tools/contraste.js`. Si en la Fase 3 se retoca un
 * token, se retoca aquí y se vuelve a correr, porque un valor que ya no pasa AA
 * es más peligroso que uno que nunca lo prometió.
 *
 * Umbrales: 4,5 para texto (WCAG 1.4.3 AA) y 3 para bordes de control (1.4.11).
 */

const luminance = (hex) => {
  const value = parseInt(hex.slice(1), 16);
  const channel = (raw) => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel((value >> 16) & 255) +
    0.7152 * channel((value >> 8) & 255) +
    0.0722 * channel(value & 255)
  );
};

const ratio = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const THEMES = {
  claro: {
    surface: '#E9EDEA',
    'surface-raised': '#F5F7F4',
    // Sirve de fondo de página y de pozo de campo a la vez: el código usa
    // `bg-slate-950` para los dos, y separarlos costaría cuarenta ediciones.
    'surface-sunken': '#E1E7E3',
    'text-primary': '#17211F',
    'text-muted': '#57655F',
    border: '#C6CFC9',
    'border-strong': '#75837C',
    accent: '#1F6B84',
    success: '#2F6B4F',
    warning: '#8A5A16',
    danger: '#9B3324',
    // Lo que se escribe encima de un relleno de acento o de peligro.
    on: '#FFFFFF',
  },
  oscuro: {
    surface: '#0F1614',
    'surface-raised': '#16201D',
    'surface-sunken': '#0A0F0E',
    'text-primary': '#E4EAE6',
    'text-muted': '#93A29C',
    border: '#2A3733',
    'border-strong': '#5F7069',
    accent: '#64B6CE',
    success: '#6FBF93',
    warning: '#D3A155',
    danger: '#E4796A',
    on: '#0F1614',
  },
};

const SURFACES = ['surface', 'surface-raised', 'surface-sunken'];
const INK = ['text-primary', 'text-muted', 'accent', 'success', 'warning', 'danger'];

let failures = 0;

const check = (label, value, floor) => {
  const passes = value >= floor;
  if (!passes) failures++;
  console.log(
    `  ${label.padEnd(38)} ${value.toFixed(2).padStart(6)}  ${passes ? 'OK   ' : 'FALLA'} (min ${floor})`,
  );
};

for (const [name, theme] of Object.entries(THEMES)) {
  console.log(`\n=== TEMA ${name.toUpperCase()} ===`);

  console.log('\n Texto sobre superficie (min 4,5):');
  for (const bg of SURFACES) {
    for (const fg of INK) check(`${fg} / ${bg}`, ratio(theme[fg], theme[bg]), 4.5);
  }

  // El borde de reposo es decoración y no tiene umbral; el de un control sí,
  // porque es lo único que dice dónde empieza el campo.
  console.log('\n Bordes de control (min 3, WCAG 1.4.11):');
  for (const bg of SURFACES) {
    check(`border-strong / ${bg}`, ratio(theme['border-strong'], theme[bg]), 3);
  }
  console.log(
    `  ${'border / surface (decorativo)'.padEnd(38)} ${ratio(theme.border, theme.surface)
      .toFixed(2)
      .padStart(6)}  --`,
  );

  console.log('\n Texto sobre relleno (min 4,5):');
  for (const fill of ['accent', 'success', 'warning', 'danger']) {
    check(`on / ${fill}`, ratio(theme.on, theme[fill]), 4.5);
  }
}

console.log(
  failures === 0 ? '\nTodos los pares pasan.\n' : `\n${failures} par(es) por debajo del umbral.\n`,
);
process.exit(failures === 0 ? 0 : 1);
