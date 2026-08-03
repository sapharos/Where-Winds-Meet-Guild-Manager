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
aviso.style.cssText =
  'position:fixed;left:0;right:0;bottom:0;z-index:9999;pointer-events:none;' +
  'font:700 10px/1.6 ui-sans-serif,system-ui;letter-spacing:.14em;text-align:center;' +
  'text-transform:uppercase;color:rgb(var(--w-500));background:rgb(var(--n-900));' +
  'border-top:1px solid rgb(var(--n-800));padding:3px 0 calc(3px + env(safe-area-inset-bottom,0px))';
document.body.appendChild(aviso);

void import('./App').then(({ default: App }) => {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
