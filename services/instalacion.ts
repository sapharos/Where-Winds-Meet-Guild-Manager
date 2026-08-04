/**
 * Instalar la aplicación en el teléfono, cuando la plataforma lo permite.
 *
 * Chrome y sus derivados anuncian que la aplicación es instalable disparando
 * `beforeinstallprompt`, muchas veces antes de que React monte. Por eso la
 * escucha se instala desde index.tsx y no desde un efecto: un efecto llega
 * tarde y el evento ya pasó, con lo que el botón no saldría nunca.
 *
 * En iOS no existe el evento ni ninguna forma programática de instalar: lo
 * único que hay es el gesto manual de Safari (Compartir → Añadir a pantalla de
 * inicio). Ahí lo máximo honesto es explicárselo a quien mira desde un iPhone,
 * y eso es lo que hace el componente que consume este servicio.
 */

/** El evento que Chrome guarda para nosotros. No está en lib.dom todavía. */
interface EventoInstalacion extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let diferido: EventoInstalacion | null = null;
const oyentes = new Set<() => void>();

const avisar = () => oyentes.forEach((fn) => fn());

/**
 * Se llama una vez desde index.tsx, antes de montar React.
 *
 * `preventDefault` suprime la mini-barra que Chrome en Android pinta por su
 * cuenta; a cambio, la oferta queda guardada y la hace nuestro botón, que sí
 * está donde el usuario lo espera.
 */
export function capturarInstalacion(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    diferido = e as EventoInstalacion;
    avisar();
  });
  // Instalada desde nuestro botón o desde el menú del navegador, da igual:
  // la oferta ya no tiene sentido y el botón debe retirarse.
  window.addEventListener('appinstalled', () => {
    diferido = null;
    avisar();
  });
}

/** Si ya corre como aplicación instalada, ofrecer instalarla sería absurdo. */
export function estaInstalada(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // Safari en iOS no implementa display-mode hasta tarde; su señal es esta.
    (navigator as { standalone?: boolean }).standalone === true
  );
}

/**
 * Safari en un aparato iOS, que es el único sitio donde el gesto manual
 * existe. Chrome o Firefox en iOS no pueden instalar nada, así que enseñarles
 * la nota sería mandar a la gente a buscar un menú que no tienen.
 */
export function esSafariEnIOS(): boolean {
  const ua = navigator.userAgent;
  // El iPad moderno se anuncia como Macintosh; lo delata el tacto.
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  return ios && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

export function puedeSolicitar(): boolean {
  return diferido !== null;
}

/** Lanza el diálogo nativo. La oferta se consume al usarla, acepte o no. */
export async function solicitarInstalacion(): Promise<void> {
  const evento = diferido;
  if (!evento) return;
  diferido = null;
  avisar();
  await evento.prompt();
}

/** Para useSyncExternalStore: avisa cuando la oferta aparece o se consume. */
export function suscribir(fn: () => void): () => void {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}
