import React, { useEffect, useState } from 'react';
import { ThemeChoice, apply, readChoice, store, watchSystem } from '../services/theme';

const OPTIONS: { id: ThemeChoice; icon: string; label: string }[] = [
  { id: 'light', icon: 'fa-sun', label: 'Claro' },
  { id: 'dark', icon: 'fa-moon', label: 'Oscuro' },
  { id: 'system', icon: 'fa-circle-half-stroke', label: 'El del teléfono' },
];

/**
 * Claro, oscuro, o lo que diga el teléfono.
 *
 * Tres botones y no un interruptor: con dos estados no hay forma de volver a
 * "que decida el sistema" una vez que lo has tocado, y eso es justo lo que
 * quiere quien lleva el móvil en automático de día y de noche.
 *
 * El valor inicial se lee de una vez y no en un efecto. Leerlo después
 * significaría dibujar el botón equivocado en la primera pintura y corregirlo
 * a continuación, que es el mismo parpadeo que el script de arranque de
 * index.html existe para evitar.
 */
const ThemeToggle: React.FC = () => {
  const [choice, setChoice] = useState<ThemeChoice>(() => readChoice());

  // Sólo quien eligió seguir al sistema tiene que enterarse de que cambió.
  // Para quien fijó un tema, que el teléfono anochezca no es asunto suyo.
  useEffect(() => {
    if (choice !== 'system') return;
    return watchSystem(() => apply('system'));
  }, [choice]);

  const pick = (next: ThemeChoice) => {
    setChoice(next);
    store(next);
    apply(next);
  };

  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className="flex bg-slate-950 p-1 rounded-lg border border-slate-800"
    >
      {OPTIONS.map((option) => (
        <button
          key={option.id}
          role="radio"
          aria-checked={choice === option.id}
          aria-label={option.label}
          title={option.label}
          onClick={() => pick(option.id)}
          className={`min-h-tap min-w-tap flex items-center justify-center rounded transition-colors duration-micro ease-glaze ${
            choice === option.id
              ? 'bg-slate-800 text-amber-500'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <i className={`fa-solid ${option.icon}`}></i>
        </button>
      ))}
    </div>
  );
};

export default ThemeToggle;
