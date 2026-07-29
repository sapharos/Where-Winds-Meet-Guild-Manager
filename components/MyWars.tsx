import React, { useEffect, useState } from 'react';
import { api } from '../services/authService';
import {
  WAR_MATCH_TYPE_LABELS,
  WAR_OUTCOME_LABELS,
  WAR_SIDE_LABELS,
  WarMatchType,
  WarOutcome,
  WarSide,
} from '../types';
import { FIGURES } from './WarHistory';
import { Impact, WEIGHTS, impactOf } from '../services/impact';

interface Participation {
  playerId: string;
  name: string;
  side: WarSide;
  stats: Record<string, number | undefined>;
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

/** Colour by how far up the war somebody finished, not by a fixed threshold. */
const shade = (score: number) =>
  score >= 85 ? '#fbbf24' : score >= 60 ? '#a3e635' : score >= 35 ? '#60a5fa' : '#94a3b8';

interface Props {
  playerId: string;
}

/**
 * A member's own record of the wars they fought.
 *
 * Their figures next to everyone else's, because a number on its own says
 * nothing: what tells you how the night went is where it sat among the rest.
 */
const MyWars: React.FC<Props> = ({ playerId }) => {
  const [wars, setWars] = useState<War[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // A failed request used to be shown as an empty record, which reads as "you
  // fought nothing" -- a statement about the member rather than about the
  // server. It hid a broken query here for a while.
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    api<War[]>(`/players/${playerId}/wars`)
      .then((rows) => {
        setWars(rows);
        setOpen(rows[0]?.id ?? null);
      })
      .catch((err) => setFailed(err instanceof Error ? err.message : 'No se pudo cargar'));
  }, [playerId]);

  if (!wars && !failed) return null;

  return (
    <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-6">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-4">
        <h2 className="cinzel text-xl font-bold text-amber-500">Mis guerras</h2>
        <span className="text-[11px] text-slate-500">
          El impacto compara cada aporte con el mejor de esa misma guerra
        </span>
      </div>

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
          const ranked = impactOf(war.participants);
          const mine = ranked.find((r) => r.playerId === playerId);
          const place = ranked.findIndex((r) => r.playerId === playerId) + 1;
          const showing = open === war.id;

          return (
            <div key={war.id} className="border border-slate-800 rounded-lg overflow-hidden">
              <button
                onClick={() => setOpen(showing ? null : war.id)}
                className="w-full flex items-center gap-4 p-3 hover:bg-slate-800/40 transition-all text-left"
              >
                <div
                  className="w-14 h-14 rounded-lg border flex flex-col items-center justify-center shrink-0"
                  style={{
                    borderColor: `${shade(mine?.score ?? 0)}80`,
                    background: `${shade(mine?.score ?? 0)}15`,
                  }}
                >
                  <span
                    className="text-xl font-bold tabular-nums leading-none"
                    style={{ color: shade(mine?.score ?? 0) }}
                  >
                    {mine?.score ?? 0}
                  </span>
                  <span className="text-[8px] uppercase tracking-wider text-slate-500">impacto</span>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-slate-100 truncate">{war.name}</p>
                    <span className="text-[9px] uppercase tracking-wider text-slate-500 border border-slate-700 rounded px-1 py-0.5 shrink-0">
                      {WAR_MATCH_TYPE_LABELS[war.matchType]}
                    </span>
                    {war.outcome && (
                      <span
                        className={`text-[9px] uppercase tracking-wider font-bold rounded px-1 py-0.5 border shrink-0 ${
                          war.outcome === 'win'
                            ? 'border-emerald-700 text-emerald-400 bg-emerald-500/10'
                            : 'border-red-800 text-red-400 bg-red-500/10'
                        }`}
                      >
                        {WAR_OUTCOME_LABELS[war.outcome]}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {when(war.startedAt)} · {place}.º de {ranked.length}
                  </p>
                </div>

                <i
                  className={`fa-solid ${showing ? 'fa-chevron-up' : 'fa-chevron-down'} text-slate-600 text-xs`}
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
                                backgroundColor: shade(mine.score),
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
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-slate-500 text-left">
            <th className="py-1 pr-3">#</th>
            <th className="py-1 pr-3">Miembro</th>
            <th className="py-1 pr-3 text-right">Impacto</th>
            {FIGURES.map((f) => (
              <th key={f.key} className="py-1 pr-3 text-right">
                {f.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ranked.map((entry, at) => {
            const row = rows.get(entry.playerId);
            const self = entry.playerId === playerId;
            return (
              <tr
                key={entry.playerId}
                className={`border-t border-slate-800/70 ${self ? 'bg-amber-500/10' : ''}`}
              >
                <td className="py-1 pr-3 text-slate-600 tabular-nums">{at + 1}</td>
                <td className={`py-1 pr-3 truncate ${self ? 'text-amber-400 font-bold' : 'text-slate-200'}`}>
                  {entry.name}
                  {row && (
                    <span className="text-[10px] text-slate-600 ml-2">{WAR_SIDE_LABELS[row.side]}</span>
                  )}
                </td>
                <td
                  className="py-1 pr-3 text-right font-bold tabular-nums"
                  style={{ color: shade(entry.score) }}
                >
                  {entry.score}
                </td>
                {FIGURES.map((f) => (
                  <td key={f.key} className="py-1 pr-3 text-right tabular-nums text-slate-400">
                    {row?.stats?.[f.key]?.toLocaleString('es') ?? '—'}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default MyWars;
