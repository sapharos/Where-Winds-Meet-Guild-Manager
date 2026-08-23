import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../services/authService';
import { Player, WAR_MATCH_TYPE_LABELS, WarMatchType, WarOutcome, WeaponSet } from '../types';
import WarHistory from './WarHistory';

/**
 * Las guerras: cómo va el gremio, y el historial entero.
 *
 * Existe como sección propia porque estaba enterrada. El historial vivía dentro
 * de la Sala de Guerra --tres pulsaciones-- y eso mezcla dos tareas que no se
 * hacen juntas: la Sala es para **organizar** la guerra del sábado, y esto es
 * para **repasar** las que ya pasaron. Quien viene a subir su grabación o a ver
 * cómo fue no está montando ninguna formación.
 *
 * Las cifras salen del listado que ya se pide, sin endpoint nuevo: son
 * recuentos sobre lo mismo que se enseña debajo, así que no pueden discrepar
 * con la lista ni quedarse rancias respecto a ella.
 */

interface WarRow {
  id: string;
  name: string;
  startedAt: string;
  endedAt: string | null;
  outcome: WarOutcome | null;
  matchType: WarMatchType;
  imported: boolean;
  participants: number;
  images: number;
}

interface Props {
  canEdit: boolean;
  weaponSets: WeaponSet[];
  players: Player[];
  canUploadVod: boolean;
  canApproveVod: boolean;
  canPinVod: boolean;
  miPlayerId: string | null;
  miUserId: string | null;
  onChanged: () => void;
}

interface Resumen {
  total: number;
  victorias: number;
  derrotas: number;
  /** Sin resultado anotado. No son empates: son guerras que nadie cerró. */
  sinAnotar: number;
  racha: { tipo: 'victorias' | 'derrotas'; cuantas: number } | null;
  ultimos30: number;
  porSemana: number;
  mediaEnCampo: number;
  porTipo: { tipo: WarMatchType; total: number; victorias: number }[];
}

/**
 * Todo de un solo recorrido sobre la lista.
 *
 * `sinAnotar` se cuenta y se enseña aparte en vez de meterse con las derrotas:
 * una guerra sin resultado es trabajo pendiente de alguien, no un mal
 * resultado, y sumarla al lado equivocado haría que el gremio se viera peor de
 * lo que es. Por lo mismo el porcentaje se calcula sobre las decididas.
 */
function resumir(wars: WarRow[]): Resumen {
  const victorias = wars.filter((w) => w.outcome === 'win').length;
  const derrotas = wars.filter((w) => w.outcome === 'loss').length;
  const sinAnotar = wars.filter((w) => !w.outcome).length;

  // De más reciente a más antigua, que es como llega la lista.
  const ordenadas = [...wars].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const decididas = ordenadas.filter((w) => w.outcome);
  let racha: Resumen['racha'] = null;
  if (decididas.length) {
    const cual = decididas[0].outcome;
    let cuantas = 0;
    for (const w of decididas) {
      if (w.outcome !== cual) break;
      cuantas++;
    }
    racha = { tipo: cual === 'win' ? 'victorias' : 'derrotas', cuantas };
  }

  const hace30 = Date.now() - 30 * 86400000;
  const ultimos30 = wars.filter((w) => Date.parse(w.startedAt) >= hace30).length;

  const conGente = wars.filter((w) => w.participants > 0);
  const mediaEnCampo = conGente.length
    ? Math.round(conGente.reduce((n, w) => n + w.participants, 0) / conGente.length)
    : 0;

  const tipos = new Map<WarMatchType, { total: number; victorias: number }>();
  for (const w of wars) {
    const t = tipos.get(w.matchType) ?? { total: 0, victorias: 0 };
    t.total++;
    if (w.outcome === 'win') t.victorias++;
    tipos.set(w.matchType, t);
  }

  return {
    total: wars.length,
    victorias,
    derrotas,
    sinAnotar,
    racha,
    ultimos30,
    porSemana: Math.round((ultimos30 / 30) * 7 * 10) / 10,
    mediaEnCampo,
    porTipo: [...tipos.entries()]
      .map(([tipo, v]) => ({ tipo, ...v }))
      .sort((a, b) => b.total - a.total),
  };
}

const Cifra: React.FC<{ valor: React.ReactNode; pie: string; tono?: string }> = ({
  valor, pie, tono = 'text-slate-200',
}) => (
  <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
    <p className={`text-xl font-semibold tabular-nums ${tono}`}>{valor}</p>
    <p className="text-[11px] text-slate-500">{pie}</p>
  </div>
);

const Guerras: React.FC<Props> = (props) => {
  const [wars, setWars] = useState<WarRow[] | null>(null);

  useEffect(() => {
    api<WarRow[]>('/war/wars').then(setWars).catch(() => setWars([]));
  }, []);

  const r = useMemo(() => (wars ? resumir(wars) : null), [wars]);
  const decididas = r ? r.victorias + r.derrotas : 0;
  const porcentaje = decididas ? Math.round((r!.victorias / decididas) * 100) : null;

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-lg font-bold text-slate-100">Guerras</h2>
        <p className="text-xs text-slate-500">
          Cómo va el gremio y qué pasó en cada guerra. Aquí se suben las grabaciones.
        </p>
      </header>

      {r && r.total > 0 && (
        <section aria-label="Resumen del gremio" className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Cifra
              valor={
                <>
                  <span className="text-emerald-400">{r.victorias}</span>
                  <span className="text-slate-600 mx-1">·</span>
                  <span className="text-red-400">{r.derrotas}</span>
                </>
              }
              pie={porcentaje === null ? 'sin guerras decididas' : `${porcentaje}% de victorias`}
            />
            <Cifra
              valor={r.racha ? r.racha.cuantas : '—'}
              tono={r.racha?.tipo === 'victorias' ? 'text-emerald-400' : 'text-red-400'}
              pie={r.racha ? `${r.racha.tipo} seguidas` : 'sin racha'}
            />
            <Cifra valor={r.porSemana} pie="guerras por semana" />
            <Cifra valor={r.mediaEnCampo} pie="en campo de media" />
          </div>

          {/* Por tipo de partida: una liga y un reto concertado no se comparan,
              y el gremio suele querer saber cómo va en la que le puntúa. */}
          {r.porTipo.length > 1 && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 space-y-2">
              {r.porTipo.map(({ tipo, total, victorias }) => (
                <div key={tipo} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-[11px] text-slate-400 truncate">
                    {WAR_MATCH_TYPE_LABELS[tipo] ?? tipo}
                  </span>
                  <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500"
                      style={{ width: `${total ? (victorias / total) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-[11px] tabular-nums text-slate-500 w-16 text-right">
                    {victorias}/{total}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/*
            Las guerras sin resultado se dicen aparte y no se suman a las
            derrotas: son trabajo pendiente de alguien, no un mal resultado.
            Y decirlo es lo que hace que se cierren.
          */}
          {r.sinAnotar > 0 && (
            <p className="text-[11px] text-amber-400">
              {r.sinAnotar} {r.sinAnotar === 1 ? 'guerra' : 'guerras'} sin resultado anotado
              {props.canEdit && ' — ábrela y anótalo para que cuente'}.
            </p>
          )}
        </section>
      )}

      {/* El historial de siempre, el mismo componente, sin hoja alrededor. */}
      <WarHistory {...props} comoPagina onClose={() => {}} />
    </div>
  );
};

export default Guerras;
