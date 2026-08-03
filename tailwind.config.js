/**
 * La piel del producto, en un único sitio.
 *
 * La idea que sostiene este archivo: los nombres de color que ya usan los
 * componentes no cambian. `bg-slate-900` sigue escribiéndose `bg-slate-900` en
 * los 24 archivos donde está; lo que cambia es a qué apunta. Cada peldaño de
 * cada rampa se resuelve contra una variable CSS que el tema decide, así que la
 * dirección visual entera se propaga sin editar un solo componente -- que es
 * justo lo que pide la fase, y lo que evita 1.470 ediciones de riesgo.
 *
 * Las rampas no son decorativas, son semánticas. Se leyó cómo las usa el código
 * y se les dio ese significado:
 *
 *   slate   la neutral: superficies, bordes y tinta. Se invierte entre temas.
 *   amber   el acento. Era oro; ahora es 天青, el azul del cielo tras la lluvia.
 *   red     lo destructivo, en 铁红 -- el rojo de óxido del horno, no bermellón.
 *   emerald victoria y confirmación, en el verde del propio vidriado.
 *   sky     el bando defensivo y el rol de tanque. Azul frío, aparte del acento.
 *
 * Los valores van como canales RGB sueltos y no como `#rrggbb` a propósito: el
 * código usa modificadores de opacidad por todas partes (`bg-slate-900/60`,
 * `bg-amber-500/10`, `bg-black/70`) y `rgb(var(--x) / <alpha-value>)` es la
 * única forma de que sigan funcionando. Escribir `var(--x)` a secas los rompe
 * todos en silencio.
 */

/** Un peldaño que se resuelve contra la variable del tema vigente. */
const step = (token) => `rgb(var(${token}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './index.tsx', './App.tsx', './components/**/*.{ts,tsx}', './services/**/*.{ts,tsx}'],
  // El tema no se elige por preferencia del sistema a secas: hay un ajuste de
  // tres estados y lo que manda es el atributo que escribe el script de arranque.
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        slate: {
          50: step('--n-50'),
          100: step('--n-100'),
          200: step('--n-200'),
          300: step('--n-300'),
          400: step('--n-400'),
          500: step('--n-500'),
          600: step('--n-600'),
          700: step('--n-700'),
          800: step('--n-800'),
          900: step('--n-900'),
          950: step('--n-950'),
        },
        amber: {
          100: step('--a-100'),
          200: step('--a-200'),
          300: step('--a-300'),
          400: step('--a-400'),
          500: step('--a-500'),
          600: step('--a-600'),
          700: step('--a-700'),
          800: step('--a-800'),
          900: step('--a-900'),
          950: step('--a-950'),
        },
        red: {
          200: step('--d-200'),
          300: step('--d-300'),
          400: step('--d-400'),
          500: step('--d-500'),
          600: step('--d-600'),
          700: step('--d-700'),
          800: step('--d-800'),
          900: step('--d-900'),
          950: step('--d-950'),
        },
        // El código usa las dos indistintamente para lo mismo.
        emerald: {
          200: step('--s-200'),
          300: step('--s-300'),
          400: step('--s-400'),
          500: step('--s-500'),
          600: step('--s-600'),
          700: step('--s-700'),
          800: step('--s-800'),
          900: step('--s-900'),
          950: step('--s-950'),
        },
        green: {
          300: step('--s-300'),
          400: step('--s-400'),
          500: step('--s-500'),
          600: step('--s-600'),
          700: step('--s-700'),
          800: step('--s-800'),
          900: step('--s-900'),
        },
        sky: {
          300: step('--i-300'),
          400: step('--i-400'),
          500: step('--i-500'),
          600: step('--i-600'),
          700: step('--i-700'),
          800: step('--i-800'),
          900: step('--i-900'),
        },
        blue: {
          300: step('--i-300'),
          400: step('--i-400'),
          500: step('--i-500'),
          600: step('--i-600'),
          700: step('--i-700'),
          800: step('--i-800'),
          900: step('--i-900'),
        },
        // 锔钉: el latón de la grapa. Es el elemento firma y el color de aviso,
        // y comparten familia a propósito -- "faltan dos tanques" y "eres
        // titular" dicen lo mismo: aquí hay algo sujeto a ti.
        staple: {
          DEFAULT: step('--w-500'),
          soft: step('--w-300'),
          strong: step('--w-700'),
        },
      },
      // La escala de docs/DIRECCION_VISUAL.md. Sólo los escalones que el
      // sistema no tenía ya con el mismo valor.
      fontSize: {
        'figure-xl': ['40px', { lineHeight: '40px', letterSpacing: '-0.02em' }],
        'figure-lg': ['28px', { lineHeight: '30px', letterSpacing: '-0.01em' }],
        meta: ['13px', { lineHeight: '18px' }],
      },
      keyframes: {
        // La hoja entra desde el borde por el que se apoya. Sólo transform y
        // opacity: nada que obligue al navegador a recalcular la maqueta.
        hoja: {
          from: { transform: 'translateY(12%)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        hoja: 'hoja var(--dur-sheet) var(--ease-glaze)',
      },
      fontFamily: {
        // Newsreader sustituye a Cinzel: una capital romana de la columna
        // Trajana no tiene nada que ver con este mundo. Ésta lee como entintada.
        display: ['Newsreader', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '6px',
        md: '10px',
        lg: '16px',
        xl: '16px',
        vessel: '22px',
      },
      boxShadow: {
        // Dos sombras en todo el sistema. Una pieza de cerámica no proyecta
        // sombra dramática; la jerarquía la llevan la superficie y la grieta.
        1: 'var(--shadow-1)',
        2: 'var(--shadow-2)',
      },
      // `min-h-screen` está escrito en cuatro sitios y significa 100vh, que la
      // barra de Safari desmiente. Se redefine aquí en vez de editarlos: el
      // nombre de la clase no importa, lo que mide sí.
      minHeight: { screen: '100dvh', tap: '44px' },
      height: { screen: '100dvh' },
      minWidth: { tap: '44px' },
      spacing: {
        tap: '44px',
        'safe-b': 'env(safe-area-inset-bottom, 0px)',
        'safe-t': 'env(safe-area-inset-top, 0px)',
      },
      transitionDuration: {
        tap: 'var(--dur-tap)',
        micro: 'var(--dur-micro)',
        sheet: 'var(--dur-sheet)',
        route: 'var(--dur-route)',
      },
      transitionTimingFunction: {
        glaze: 'var(--ease-glaze)',
        lift: 'var(--ease-lift)',
        staple: 'var(--ease-staple)',
      },
    },
  },
  plugins: [],
};
