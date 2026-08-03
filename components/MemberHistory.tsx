import React, { useEffect, useState } from 'react';
import { api } from '../services/authService';
import { Player, ScanRecord } from '../types';
import Sheet from './Sheet';
import { Filas } from './Esqueleto';

// The columns worth watching over time. Totals that only ever climb are left
// out of the trend view; what matters is what can fall.
const TRACKED: { key: string; label: string }[] = [
  { key: 'week_activity', label: 'Actividad semanal' },
  { key: 'weekly_clears', label: 'Clears de la semana' },
  { key: 'last_week_clears', label: 'Clears semana previa' },
  { key: 'ranked_participations', label: 'Partidas ranked' },
  { key: 'league_participations', label: 'Partidas de liga' },
  { key: 'duel_participations', label: 'Duelos' },
  { key: 'treasure_tokens_week', label: 'Tokens de la semana' },
  { key: 'martial_mastery', label: 'Maestría marcial' },
  { key: 'exploration_mastery', label: 'Maestría exploración' },
  { key: 'profession_mastery', label: 'Maestría profesión' },
  { key: 'level', label: 'Nivel' },
  { key: 'days_joined', label: 'Días en el gremio' },
];

const numeric = (value: unknown): number | null =>
  typeof value === 'number' ? value : value === null || value === undefined ? null : Number(value) || null;

/** A bare sparkline: enough to see a shape without pulling in a chart library. */
const Spark: React.FC<{ values: (number | null)[] }> = ({ values }) => {
  const points = values.filter((v): v is number => v !== null);
  if (points.length < 2) return <span className="text-slate-700">—</span>;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const width = 88;
  const height = 20;

  const path = points
    .map((v, i) => `${(i / (points.length - 1)) * width},${height - ((v - min) / span) * height}`)
    .join(' ');

  const rising = points[points.length - 1] >= points[0];
  return (
    <svg width={width} height={height} className="inline-block align-middle">
      <polyline
        points={path}
        fill="none"
        strokeWidth="1.5"
        className={rising ? 'stroke-emerald-500' : 'stroke-red-500'}
      />
    </svg>
  );
};

const MemberHistory: React.FC<{ player: Player; onClose: () => void }> = ({ player, onClose }) => {
  const [scans, setScans] = useState<ScanRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ScanRecord[]>(`/players/${player.id}/scans`)
      .then(setScans)
      .catch((err) => setError(err instanceof Error ? err.message : 'No se pudo cargar el historial'));
  }, [player.id]);

  const fecha = (iso: string) => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short' });

  return (
    <Sheet
      title={player.name}
      subtitle={
        scans
          ? `${scans.length} escaneo${scans.length === 1 ? '' : 's'} registrado${scans.length === 1 ? '' : 's'}`
          : 'Cargando…'
      }
      size="lg"
      onClose={onClose}
    >
      {error && (
        <p className="text-sm rounded-lg px-4 py-3 border bg-red-950/60 border-red-900 text-red-200">
          <i className="fa-solid fa-triangle-exclamation mr-2"></i>
          {error}
        </p>
      )}

      {!scans && !error && <Filas cuantas={6} />}

      {scans && scans.length === 0 && (
        <p className="text-sm text-slate-500">
          Todavía no hay escaneos de este miembro. Importa un <code className="text-amber-500">roster.json</code> para
          empezar a registrar su evolución.
        </p>
      )}

      {scans && scans.length > 0 && (
        <>
          {/*
            Una tarjeta por métrica en el móvil, la tabla a partir de md.

            La tabla crecía una columna por cada escaneo y arrancaba ya en 640 px
            de ancho mínimo, dentro de una hoja que en un teléfono tiene 343:
            había que arrastrar de lado para leerla y, en cuanto lo hacías,
            perdías la columna de la izquierda y te quedaban cifras sin nombre.
            La tarjeta pone delante lo que se viene a mirar -- el último valor y
            cuánto ha cambiado -- y deja la serie completa detrás.
          */}
          <div className="flex flex-col gap-2 md:hidden">
            {TRACKED.map(({ key, label }) => {
              const series = scans.map((s) => numeric(s[key]));
              const seen = series.filter((v): v is number => v !== null);
              if (!seen.length) return null;
              const ultimo = seen[seen.length - 1];
              const change = seen.length > 1 ? ultimo - seen[seen.length - 2] : null;

              return (
                <details key={key} className="rounded-md border border-slate-800 bg-slate-950/40">
                  <summary className="list-none cursor-pointer min-h-tap flex items-center gap-3 px-3">
                    <span className="flex-1 min-w-0 text-slate-300 truncate">{label}</span>
                    <span className="text-lg font-bold text-slate-100 tabular-nums">
                      {ultimo.toLocaleString('es')}
                    </span>
                    <span
                      className={`w-14 text-right tabular-nums font-semibold text-meta ${
                        change === null
                          ? 'text-slate-700'
                          : change > 0
                            ? 'text-emerald-400'
                            : change < 0
                              ? 'text-red-400'
                              : 'text-slate-500'
                      }`}
                    >
                      {change === null ? '—' : change > 0 ? `+${change}` : change}
                    </span>
                    <Spark values={series} />
                  </summary>

                  <div className="border-t border-slate-800 px-3 py-2 flex flex-col gap-1">
                    {scans.map((s, i) => (
                      <div key={s.scannedAt} className="flex justify-between text-meta">
                        <span className="text-slate-500">{fecha(s.scannedAt)}</span>
                        <span className="text-slate-200 tabular-nums">
                          {series[i] === null ? (
                            <span className="text-slate-600">no capturado</span>
                          ) : (
                            series[i]!.toLocaleString('es')
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400">
                  <th className="p-2 border-b border-slate-800 font-semibold sticky left-0 bg-slate-900">
                    Métrica
                  </th>
                  {scans.map((s) => (
                    <th key={s.scannedAt} className="p-2 border-b border-slate-800 font-semibold text-right whitespace-nowrap">
                      {new Date(s.scannedAt).toLocaleDateString()}
                    </th>
                  ))}
                  <th className="p-2 border-b border-slate-800 font-semibold text-right">Cambio</th>
                  <th className="p-2 border-b border-slate-800 font-semibold text-center">Tendencia</th>
                </tr>
              </thead>
              <tbody>
                {TRACKED.map(({ key, label }) => {
                  const series = scans.map((s) => numeric(s[key]));
                  const seen = series.filter((v): v is number => v !== null);
                  if (!seen.length) return null;

                  const change = seen.length > 1 ? seen[seen.length - 1] - seen[seen.length - 2] : null;

                  return (
                    <tr key={key} className="hover:bg-slate-800/30">
                      {/* Fija: al desplazar de lado, el nombre de la fila es lo
                          único que hace legible el número que estás mirando. */}
                      <td className="p-2 border-b border-slate-800/60 text-slate-300 sticky left-0 bg-slate-900">
                        {label}
                      </td>
                      {series.map((v, i) => (
                        <td key={i} className="p-2 border-b border-slate-800/60 text-right text-slate-200 tabular-nums">
                          {v ?? <span className="text-slate-700" title="No capturado en este escaneo">—</span>}
                        </td>
                      ))}
                      <td
                        className={`p-2 border-b border-slate-800/60 text-right tabular-nums font-semibold ${
                          change === null ? 'text-slate-700' : change > 0 ? 'text-emerald-400' : change < 0 ? 'text-red-400' : 'text-slate-500'
                        }`}
                      >
                        {change === null ? '—' : change > 0 ? `+${change}` : change}
                      </td>
                      <td className="p-2 border-b border-slate-800/60 text-center">
                        <Spark values={series} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Sheet>
  );
};

export default MemberHistory;
