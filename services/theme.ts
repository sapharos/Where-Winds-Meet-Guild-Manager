/**
 * Claro, oscuro, o lo que diga el teléfono.
 *
 * Tres estados y no dos, porque "system" no es un valor por defecto: es una
 * elección. Quien pone el móvil en oscuro al anochecer espera que esto lo siga,
 * y quien quiere esta aplicación siempre oscura no quiere depender de eso.
 *
 * Lo que se guarda es la preferencia ('system'), nunca lo resuelto ('dark'). Si
 * se guardase lo resuelto, elegir "system" una noche dejaría la aplicación
 * clavada en oscuro para siempre y el ajuste no volvería a hacer nada.
 *
 * El atributo lo escribe además un script en línea en index.html antes de que
 * React monte. No es duplicación por descuido: sin él la primera pintura sale
 * con el tema equivocado y se ve el fogonazo. Los dos leen la misma clave y
 * aplican la misma regla, y por eso la clave y el atributo están declarados
 * aquí como fuente única.
 */

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_KEY = 'zz-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

const isChoice = (value: unknown): value is ThemeChoice =>
  value === 'light' || value === 'dark' || value === 'system';

/** Lo que el usuario eligió la última vez, o dejarlo en manos del sistema. */
export function readChoice(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return isChoice(stored) ? stored : 'system';
  } catch {
    // Navegación privada o almacenamiento bloqueado: no es motivo para caerse.
    return 'system';
  }
}

export function systemTheme(): ResolvedTheme {
  return window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light';
}

export function resolve(choice: ThemeChoice): ResolvedTheme {
  return choice === 'system' ? systemTheme() : choice;
}

/**
 * Escribe el tema en el documento.
 *
 * `color-scheme` va junto al atributo porque es lo que hace que las barras de
 * scroll, los `<select>` nativos y el datepicker del sistema salgan del color
 * correcto. Sin él, un tema claro impecable se delata en cuanto alguien abre un
 * desplegable.
 */
export function apply(choice: ThemeChoice): ResolvedTheme {
  const resolved = resolve(choice);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  return resolved;
}

export function store(choice: ThemeChoice): void {
  try {
    window.localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Como arriba: el tema sigue aplicado en esta sesión aunque no se recuerde.
  }
}

/**
 * Avisa cuando el sistema cambia de tema, para quien eligió seguirlo.
 *
 * Devuelve la función de baja. Quien esté en 'light' o 'dark' fijos no debe
 * suscribirse: el sistema puede cambiar todo lo que quiera y no es asunto suyo.
 */
export function watchSystem(onChange: (theme: ResolvedTheme) => void): () => void {
  const media = window.matchMedia?.(DARK_QUERY);
  if (!media) return () => undefined;
  const handler = (event: MediaQueryListEvent) => onChange(event.matches ? 'dark' : 'light');
  media.addEventListener('change', handler);
  return () => media.removeEventListener('change', handler);
}
