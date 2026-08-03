
import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/app.css';
import App from './App';
import { instalarTeclado } from './services/teclado';

// Antes de montar: la medida del teclado la usa el CSS, y una hoja que se abra
// con el teclado ya puesto debe encoger desde la primera pintura.
instalarTeclado();

/**
 * Los iconos que un miembro puede elegir para un conjunto de armas o una unidad
 * táctica, después de la primera pintura.
 *
 * Son cinco sextos del peso de la iconografía y ninguno hace falta para leer
 * una pantalla: dibujan la insignia de un conjunto. Llegar un instante tarde a
 * eso no le cuesta nada a nadie; bloquear con ellos la primera pintura sobre
 * una conexión que se cae, sí.
 */
void import('./styles/iconos.catalogo.generated.css');

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
