import React, { useEffect, useRef, useState } from 'react';
import { authService } from '../services/authService';
import { DiscordMember } from '../types';

interface Props {
  /** Qué hacer con el miembro elegido; el buscador se limpia solo. */
  onPick: (member: DiscordMember) => void;
  autoFocus?: boolean;
}

/**
 * Buscar a alguien en el servidor de Discord del gremio, escribiendo.
 *
 * La lista enseña el apodo del servidor y el nombre de usuario global juntos, a
 * propósito: el apodo es como se reconoce a la persona en el gremio, pero es
 * cambiable y se presta a confusión; el nombre de usuario es el estable. Quien
 * vincula está sustituyendo la prueba de propiedad por su criterio, así que
 * debe ver ambos antes de decidir.
 */
const BuscadorDiscord: React.FC<Props> = ({ onPick, autoFocus }) => {
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState<DiscordMember[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // La respuesta vieja de una letra anterior no debe pisar a la nueva.
  const turno = useRef(0);

  useEffect(() => {
    const q = texto.trim();
    setError(null);
    if (q.length < 2) {
      setResultados([]);
      setBuscando(false);
      return;
    }
    setBuscando(true);
    const mio = ++turno.current;
    // Un cuarto de segundo de reposo: buscar en cada tecla es pedirle a
    // Discord seis búsquedas para encontrar a "Kaelen".
    const timer = window.setTimeout(() => {
      authService
        .searchDiscordMembers(q)
        .then((lista) => {
          if (turno.current !== mio) return;
          setResultados(lista);
          setBuscando(false);
        })
        .catch((err) => {
          if (turno.current !== mio) return;
          setError(err instanceof Error ? err.message : 'No se pudo buscar');
          setResultados([]);
          setBuscando(false);
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [texto]);

  return (
    <div>
      <div className="relative">
        <i className="fa-brands fa-discord absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8ea1ff] pointer-events-none"></i>
        <input
          type="text"
          autoFocus={autoFocus}
          placeholder="Busca por nombre o apodo…"
          className="w-full bg-slate-950 border border-slate-800 rounded p-2 pl-8 text-sm outline-none focus:ring-1 focus:ring-amber-500"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
        {buscando && (
          <i className="fa-solid fa-circle-notch fa-spin absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500"></i>
        )}
      </div>

      {error && (
        <p className="mt-2 text-xs text-red-300">
          <i className="fa-solid fa-triangle-exclamation mr-1.5"></i>
          {error}
        </p>
      )}

      {!error && texto.trim().length >= 2 && !buscando && resultados.length === 0 && (
        <p className="mt-2 text-xs text-slate-500">
          Nadie en el servidor de Discord empieza así. La búsqueda es por el
          principio del nombre, no por el medio.
        </p>
      )}

      {resultados.length > 0 && (
        <ul className="mt-2 border border-slate-800 rounded-lg divide-y divide-slate-800 overflow-hidden">
          {resultados.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => {
                  setTexto('');
                  setResultados([]);
                  onPick(m);
                }}
                className="w-full min-h-tap flex items-center justify-between gap-3 px-3 py-2 text-left bg-slate-950 hover:bg-slate-900 transition-all"
              >
                <span className="min-w-0">
                  <span className="block text-sm text-slate-100 truncate">
                    {m.nick ?? m.globalName ?? m.username}
                  </span>
                  <span className="block text-xs text-slate-500 truncate">@{m.username}</span>
                </span>
                <span className="shrink-0 text-xs text-amber-500">
                  Elegir
                  <i className="fa-solid fa-chevron-right ml-1.5"></i>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default BuscadorDiscord;
