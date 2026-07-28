import React, { useEffect, useState } from 'react';
import { api } from '../services/authService';
import { Player, ScanRecord } from '../types';

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

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-4xl my-8">
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <div>
            <h2 className="cinzel text-2xl font-bold text-amber-500">{player.name}</h2>
            <p className="text-xs text-slate-500 mt-1">
              {scans ? `${scans.length} escaneo${scans.length === 1 ? '' : 's'} registrado${scans.length === 1 ? '' : 's'}` : 'Cargando...'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-amber-500 transition-all">
            <i className="fa-solid fa-xmark text-xl"></i>
          </button>
        </div>

        <div className="p-6">
          {error && <p className="text-sm text-red-300">{error}</p>}

          {scans && scans.length === 0 && (
            <p className="text-sm text-slate-500">
              Todavía no hay escaneos de este miembro. Importa un <code className="text-amber-500">roster.json</code> para
              empezar a registrar su evolución.
            </p>
          )}

          {scans && scans.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="text-left text-slate-400">
                    <th className="p-2 border-b border-slate-800 font-semibold">Métrica</th>
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
                        <td className="p-2 border-b border-slate-800/60 text-slate-300">{label}</td>
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
          )}
        </div>
      </div>
    </div>
  );
};

export default MemberHistory;
