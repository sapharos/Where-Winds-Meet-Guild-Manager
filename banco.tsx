/**
 * Banco de pruebas: la aplicación entera contra un gremio inventado.
 *
 * El servidor falso se instala antes de importar App, y no es un detalle de
 * estilo: los componentes piden datos en cuanto se montan, así que si `fetch`
 * se sustituye después, las primeras peticiones ya han salido por la red de
 * verdad. Por eso el import de App es dinámico y va debajo.
 *
 * Sólo lo carga banco.html, que no está en la entrada del build: `vite build`
 * toma index.html y nada más, de modo que esto no llega a producción por
 * construcción y no por acuerdo.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/app.css';
import { instalarServidorFalso } from './fixtures/server';

// Igual que en index.tsx: el catálogo de iconos, después de la primera pintura.
void import('./styles/iconos.catalogo.generated.css');

instalarServidorFalso();

const root = document.getElementById('root');
if (!root) throw new Error('Falta #root');

// Una cinta arriba para que nadie confunda esto con el gremio de verdad.
const aviso = document.createElement('div');
aviso.textContent = 'BANCO DE PRUEBAS · datos inventados';
// Arriba a la derecha y no abajo: abajo se sentaba justo encima de la barra de
// navegación del teléfono, que es una de las cosas que hay que poder probar.
aviso.style.cssText =
  'position:fixed;right:0;top:0;z-index:9999;pointer-events:none;' +
  'font:700 9px/1.6 ui-sans-serif,system-ui;letter-spacing:.12em;' +
  'text-transform:uppercase;color:rgb(var(--w-500));background:rgb(var(--n-900));' +
  'border:1px solid rgb(var(--n-800));border-radius:0 0 0 6px;padding:2px 8px';
document.body.appendChild(aviso);

void import('./App').then(({ default: App }) => {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
