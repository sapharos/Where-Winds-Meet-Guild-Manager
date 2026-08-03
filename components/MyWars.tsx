import React, { useEffect, useState } from 'react';
import { api } from '../services/authService';
import {
  WAR_MATCH_TYPE_LABELS,
  WAR_OUTCOME_LABELS,
  WAR_SIDE_LABELS,
  WarMatchType,
  WarOutcome,
  WarSide,
  WeaponSet,
} from '../types';
import { FIGURES } from './WarHistory';
import { Impact, WEIGHTS, expectationOf, impactOf, impactShade } from '../services/impact';

interface Participation {
  playerId: string;
  name: string;
  side: WarSide;
  stats: Record<string, number | undefined>;
  /** What they fought with, resolved on the server from the build the war froze. */
  weapons: string[];
}

interface War {
  id: string;
  name: string;
  startedAt: string;
  endedAt: string | null;
  matchType: WarMatchType;
  outcome: WarOutcome | null;
  participants: Participation[];
}

const when = (iso: string) =>
  new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });

interface Props {
  playerId: string;
  /** Needed to score, not to draw: a set can be given an allowance per axis. */
  weaponSets: WeaponSet[];
}

/**
 * A member's own record of the wars they fought.
 *
 * Their figures next to everyone else's, because a number on its own says
 * nothing: what tells you how the night went is where it sat among the rest.
 */
const MyWars: React.FC<Props> = ({ playerId, weaponSets }) => {
  const [wars, setWars] = useState<War[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // A failed request used to be shown as an empty record, which reads as "you
  // fought nothing" -- a statement about the member rather than about the
  // server. It hid a broken query here for a while.
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    // Ninguna abierta de entrada. La primera se abría sola y desplegaba treinta
    // participantes debajo, así que la lista de guerras -- que es lo que se
    // viene a ver -- empezaba ya empujada fuera de la pantalla.
    api<War[]>(`/players/${playerId}/wars`)
      .then(setWars)
      .catch((err) => setFailed(err instanceof Error ? err.message : 'No se pudo cargar'));
  }, [playerId]);

  if (!wars && !failed) return null;

  return (
    // Sin título propio: lo pone la sección plegable que lo envuelve, y
    // repetido salían dos "Mis guerras" seguidos.
    <section>
      <p className="text-[11px] text-slate-500 mb-4">
        El impacto compara cada aporte con el mejor de esa misma guerra
      </p>

      {failed && (
        <div className="text-sm rounded-lg px-4 py-2 flex items-center gap-3 border bg-red-950/60 border-red-900 text-red-200">
          <i className="fa-solid fa-triangle-exclamation"></i>
          No se pudo cargar tu historial: {failed}
        </div>
      )}

      {wars?.length === 0 && (
        <p className="text-sm text-slate-500">Todavía no has participado en ninguna guerra.</p>
      )}

      <div className="space-y-3">
        {(wars ?? []).map((war) => {
          const ranked = impactOf(
            war.participants.map((p) => ({ ...p, expects: expectationOf(p.weapons, weaponSets) })),
          );
          const mine = ranked.find((r) => r.playerId === playerId);
          const place = ranked.findIndex((r) => r.playerId === playerId) + 1;
          const showing = open === war.id;

          return (
            <div key={war.id} className="border border-slate-800 rounded-lg overflow-hidden">
              <button
                onClick={() => setOpen(showing ? null : war.id)}
                aria-expanded={showing}
                className="w-full flex items-start gap-3 p-3 hover:bg-slate-800/40 transition-all text-left"
              >
                <div
                  className="w-14 h-14 rounded-lg border flex flex-col items-center justify-center shrink-0"
                  style={{
                    borderColor: `${impactShade(mine?.score ?? 0)}80`,
                    background: `${impactShade(mine?.score ?? 0)}15`,
                  }}
                >
                  <span
                    className="text-xl font-bold tabular-nums leading-none"
                    style={{ color: impactShade(mine?.score ?? 0) }}
                  >
                    {mine?.score ?? 0}
                  </span>
                  <span className="text-[8px] uppercase tracking-wider text-slate-500">impacto</span>
                </div>

                {/*
                  El nombre en su propia línea, las etiquetas debajo.

                  Compartiendo línea, las dos insignias se quedaban su ancho
                  entero -- son `shrink-0` -- y lo que se recortaba era el
                  nombre de la guerra, hasta dejarlo en "A...". La insignia es
                  el dato secundario; el nombre es el que se busca.
                */}
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-slate-100 break-words">{war.name}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {when(war.startedAt)} · {place}.º de {ranked.length}
                  </p>
                  <div className="flex flex-wrap items-center gap-1 mt-1.5">
                    <span className="text-[11px] uppercase tracking-wider text-slate-500 border border-slate-700 rounded px-1.5 py-0.5">
                      {WAR_MATCH_TYPE_LABELS[war.matchType]}
                    </span>
                    {war.outcome && (
                      <span
                        className={`text-[11px] uppercase tracking-wider font-bold rounded px-1.5 py-0.5 border ${
                          war.outcome === 'win'
                            ? 'border-emerald-700 text-emerald-400 bg-emerald-500/10'
                            : 'border-red-800 text-red-400 bg-red-500/10'
                        }`}
                      >
                        {WAR_OUTCOME_LABELS[war.outcome]}
                      </span>
                    )}
                  </div>
                </div>

                <i
                  className={`fa-solid fa-chevron-down text-slate-600 text-xs mt-1.5 shrink-0 transition-transform duration-micro ${
                    showing ? 'rotate-180' : ''
                  }`}
                  aria-hidden
                ></i>
              </button>

              {showing && (
                <div className="border-t border-slate-800 p-3 space-y-3">
                  {mine && (
                    <div className="flex gap-3 flex-wrap">
                      {WEIGHTS.filter((axis) => axis.weight > 0).map((axis) => (
                        <div key={axis.key} className="flex-1 min-w-[110px]">
                          <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                            <span>{axis.label}</span>
                            <span className="tabular-nums">
                              {Math.round((mine.parts[axis.key] ?? 0) * 100)}%
                            </span>
                          </div>
                          <div className="h-1.5 rounded bg-slate-800 overflow-hidden">
                            <div
                              className="h-full rounded"
                              style={{
                                width: `${Math.min(100, (mine.parts[axis.key] ?? 0) * 100)}%`,
                                backgroundColor: impactShade(mine.score),
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <Table war={war} ranked={ranked} playerId={playerId} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};

const Table: React.FC<{ war: War; ranked: Impact[]; playerId: string }> = ({
  war,
  ranked,
  playerId,
}) => {
  const rows = new Map<string, Participation>(war.participants.map((p) => [p.playerId, p]));

  /** Por qué se ordena y qué cifra se enseña. El impacto es el de entrada. */
  const [por, setPor] = useState<string>('impact');
  /** Quién tiene el desglose abierto. Uno a la vez: la lista es de treinta. */
  const [abierto, setAbierto] = useState<string | null>(null);

  const etiqueta = por === 'impact' ? 'Impacto' : (FIGURES.find((f) => f.key === por)?.label ?? '');

  const valor = (entry: Impact): number | null =>
    por === 'impact' ? entry.score : (rows.get(entry.playerId)?.stats?.[por] ?? null);

  /**
   * La lista ordenada por lo que se haya elegido.
   *
   * `ranked` llega ordenado por impacto y se deja intacto -- el puesto que se
   * enseña es el del impacto, que es el que significa algo y el que aparece en
   * "10.º de 30" arriba. Cambiar la cifra reordena la lista, no renumera el
   * ranking: alguien puede ser el primero en daño y el séptimo de la guerra, y
   * las dos cosas son ciertas a la vez.
   */
  const puesto = new Map(ranked.map((e, at) => [e.playerId, at + 1]));
  const ordenados = [...ranked].sort((a, b) => {
    const x = valor(a);
    const y = valor(b);
    // Quien no tiene esa cifra anotada va al final, no al principio: un hueco
    // no es un cero.
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return y - x;
  });

  const selector = (
    <label className="flex items-center gap-2 text-meta text-slate-500 mb-2">
      Ordenar por
      <select
        value={por}
        onChange={(e) => setPor(e.target.value)}
        className="flex-1 sm:flex-none bg-slate-950 border border-slate-800 rounded px-2 text-sm text-slate-200 outline-none focus:ring-1 focus:ring-amber-500"
      >
        <option value="impact">Impacto</option>
        {FIGURES.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      {/*
        En el móvil, una fila por persona: puesto, nombre y la cifra elegida.

        Antes enseñaba sólo el impacto y no había forma de llegar al resto: once
        columnas no caben en 343 px, así que el desglose de los demás quedaba
        únicamente en la tabla del escritorio. Ahora se elige qué cifra mirar,
        la lista se reordena por ella, y tocar a alguien abre las ocho suyas.
        Los datos son los mismos que ya venían en la respuesta; lo que faltaba
        era la manera de pedirlos.
      */}
      <div className="md:hidden">
        {selector}
        <ol className="flex flex-col gap-1">
          {ordenados.map((entry) => {
            const row = rows.get(entry.playerId);
            const self = entry.playerId === playerId;
            const mostrando = abierto === entry.playerId;
            const cifra = valor(entry);
            return (
              <li key={entry.playerId}>
                <button
                  onClick={() => setAbierto(mostrando ? null : entry.playerId)}
                  aria-expanded={mostrando}
                  className={`w-full min-h-tap flex items-center gap-3 rounded px-2 text-left transition-colors duration-micro ${
                    self ? 'bg-amber-500/10 ring-1 ring-amber-500/40' : 'hover:bg-slate-800/40'
                  }`}
                >
                  <span className="w-6 shrink-0 text-right text-slate-600 tabular-nums text-meta">
                    {puesto.get(entry.playerId)}
                  </span>
                  <span
                    className={`flex-1 min-w-0 truncate ${self ? 'text-amber-400 font-bold' : 'text-slate-200'}`}
                  >
                    {entry.name}
                  </span>
                  {row && (
                    <span className="text-[11px] text-slate-600 shrink-0">
                      {WAR_SIDE_LABELS[row.side]}
                    </span>
                  )}
                  <span
                    className="text-right font-bold tabular-nums shrink-0"
                    style={por === 'impact' ? { color: impactShade(entry.score) } : undefined}
                  >
                    {cifra === null ? '—' : cifra.toLocaleString('es')}
                  </span>
                  <i
                    className={`fa-solid fa-chevron-down text-slate-600 text-xs shrink-0 transition-transform duration-micro ${
                      mostrando ? 'rotate-180' : ''
                    }`}
                    aria-hidden
                  ></i>
                </button>

                {mostrando && (
                  // Una columna hasta 400 px y dos a partir de ahí: en dos,
                  // "Daño de asedio" caía en tres renglones y el bloque se
                  // volvía un dentado. Es un detalle que se abre a propósito,
                  // así que se lee entero antes que apretado.
                  <div className="mx-2 mb-1 mt-1 rounded border border-slate-800 bg-slate-950/50 p-2 grid grid-cols-1 xs:grid-cols-2 gap-x-4 gap-y-1">
                    {/* col-span-full y no col-span-2: en la rejilla de una sola
                        columna, pedir dos crea una segunda columna implícita
                        -- de ancho automático, así que ni siquiera pareja -- y
                        el bloque volvía a partirse justo donde no debía. */}
                    <div className="flex items-baseline justify-between gap-2 col-span-full pb-1 border-b border-slate-800">
                      <span className="text-[11px] uppercase tracking-wider text-slate-500">
                        Impacto
                      </span>
                      <span
                        className="text-sm font-bold tabular-nums"
                        style={{ color: impactShade(entry.score) }}
                      >
                        {entry.score}
                      </span>
                    </div>
                    {FIGURES.map((f) => (
                      <div key={f.key} className="flex items-baseline justify-between gap-2">
                        {/* Sin `truncate`: "Daño recibido" y "Daño de asedio"
                            se quedaban en "Daño recibi..." y "Daño ...", que
                            son la misma palabra dos veces. Envuelven. */}
                        <span
                          className={`text-[11px] uppercase tracking-wider leading-tight ${
                            f.key === por ? 'text-amber-500 font-bold' : 'text-slate-500'
                          }`}
                        >
                          {f.label}
                        </span>
                        <span className="text-sm tabular-nums text-slate-200 shrink-0">
                          {row?.stats?.[f.key]?.toLocaleString('es') ?? '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="hidden md:block">
        {selector}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-slate-500 text-left">
                <th className="py-1 pr-3">#</th>
                <th className="py-1 pr-3">Miembro</th>
                {/* La columna por la que se ordena se marca, para que la lista
                    no parezca desordenada cuando no se ordena por impacto. */}
                <th className={`py-1 pr-3 text-right ${por === 'impact' ? 'text-amber-500' : ''}`}>
                  Impacto
                </th>
                {FIGURES.map((f) => (
                  <th
                    key={f.key}
                    className={`py-1 pr-3 text-right ${f.key === por ? 'text-amber-500' : ''}`}
                  >
                    {f.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ordenados.map((entry) => {
                const row = rows.get(entry.playerId);
                const self = entry.playerId === playerId;
                return (
                  <tr
                    key={entry.playerId}
                    className={`border-t border-slate-800/70 ${self ? 'bg-amber-500/10' : ''}`}
                  >
                    <td className="py-1 pr-3 text-slate-600 tabular-nums">
                      {puesto.get(entry.playerId)}
                    </td>
                    <td className={`py-1 pr-3 truncate ${self ? 'text-amber-400 font-bold' : 'text-slate-200'}`}>
                      {entry.name}
                      {row && (
                        <span className="text-[10px] text-slate-600 ml-2">{WAR_SIDE_LABELS[row.side]}</span>
                      )}
                    </td>
                    <td
                      className="py-1 pr-3 text-right font-bold tabular-nums"
                      style={{ color: impactShade(entry.score) }}
                    >
                      {entry.score}
                    </td>
                    {FIGURES.map((f) => (
                      <td
                        key={f.key}
                        className={`py-1 pr-3 text-right tabular-nums ${
                          f.key === por ? 'text-slate-100 font-semibold' : 'text-slate-400'
                        }`}
                      >
                        {row?.stats?.[f.key]?.toLocaleString('es') ?? '—'}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
};

export default MyWars;
