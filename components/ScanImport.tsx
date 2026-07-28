import React, { useRef, useState } from 'react';
import { api } from '../services/authService';
import { Player, ScanDocument, ScanPreviewEntry } from '../types';

interface Props {
  players: Player[];
  onImported: () => void;
}

// What the operator decided for one scanned name, before anything is written.
type Decision =
  | { kind: 'link'; playerId: string }
  | { kind: 'create'; name: string }
  | { kind: 'skip' };

const ScanImport: React.FC<Props> = ({ players, onImported }) => {
  const [preview, setPreview] = useState<ScanPreviewEntry[] | null>(null);
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const report = (text: string, ok = true) => setMessage({ text, ok });

  const load = async (file: File) => {
    setBusy(true);
    try {
      const document: ScanDocument = JSON.parse(await file.text());
      if (!Array.isArray(document.entries)) throw new Error('Ese archivo no parece un roster.json');

      const { entries } = await api<{ entries: ScanPreviewEntry[] }>('/scans/preview', {
        method: 'POST',
        body: JSON.stringify({ entries: document.entries }),
      });

      // Anything already known is pre-decided; only the rest needs attention.
      const initial: Record<string, Decision> = {};
      for (const entry of entries) {
        initial[entry.nameAsRead] = entry.playerId
          ? { kind: 'link', playerId: entry.playerId }
          : { kind: 'create', name: entry.nameAsRead };
      }

      setPreview(entries);
      setDecisions(initial);
      setScannedAt(document.scannedAt ?? null);
      setMessage(null);
    } catch (err) {
      report(err instanceof Error ? err.message : 'No se pudo leer el archivo', false);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const entries = preview
        .map((entry) => {
          const decision = decisions[entry.nameAsRead];
          if (!decision || decision.kind === 'skip') return null;
          return {
            nameAsRead: entry.nameAsRead,
            fields: entry.fields,
            ...(entry.uid ? { uid: entry.uid } : {}),
            ...(decision.kind === 'link'
              ? { playerId: decision.playerId }
              : { createAs: decision.name.trim() }),
          };
        })
        .filter(Boolean);

      if (!entries.length) {
        report('No hay ninguna fila que guardar.', false);
        return;
      }

      const result = await api<{ stored: number; created: { name: string }[] }>('/scans/commit', {
        method: 'POST',
        body: JSON.stringify({ scannedAt, entries }),
      });

      report(
        `Guardado: ${result.stored} miembros` +
          (result.created.length ? `, ${result.created.length} nuevos en el roster.` : '.'),
      );
      setPreview(null);
      setDecisions({});
      onImported();
    } catch (err) {
      report(err instanceof Error ? err.message : 'No se pudo guardar', false);
    } finally {
      setBusy(false);
    }
  };

  const pending = preview?.filter((e) => !e.playerId).length ?? 0;

  return (
    <div className="space-y-6">
      {message && (
        <div
          className={`text-sm rounded-lg px-4 py-2 flex items-center gap-3 border ${
            message.ok
              ? 'bg-emerald-950/60 border-emerald-900 text-emerald-200'
              : 'bg-red-950/60 border-red-900 text-red-200'
          }`}
        >
          <i className={`fa-solid ${message.ok ? 'fa-circle-check' : 'fa-triangle-exclamation'}`}></i>
          {message.text}
        </div>
      )}

      {!preview && (
        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-6">
          <h2 className="cinzel text-2xl font-bold text-amber-500 mb-2">Importar escaneo</h2>
          <p className="text-sm text-slate-400 mb-1">
            Arrastra aquí el <code className="text-amber-500">roster.json</code> que deja{' '}
            <code className="text-amber-500">parse.py</code>, o pulsa para buscarlo.
          </p>
          <p className="text-xs text-slate-600 mb-5">
            Nada se guarda hasta que revises el emparejamiento en la pantalla siguiente.
          </p>

          <button
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) void load(file);
            }}
            disabled={busy}
            className="w-full border-2 border-dashed border-slate-700 hover:border-amber-600 rounded-xl py-12 text-slate-500 hover:text-amber-500 transition-all flex flex-col items-center gap-3"
          >
            <i className={`fa-solid ${busy ? 'fa-circle-notch fa-spin' : 'fa-file-arrow-up'} text-3xl`}></i>
            {busy ? 'Leyendo...' : 'Soltar roster.json'}
          </button>
          <input
            type="file"
            ref={fileRef}
            className="hidden"
            accept=".json,application/json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void load(file);
              e.target.value = '';
            }}
          />
        </section>
      )}

      {preview && (
        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-6">
          <div className="flex items-center justify-between gap-4 flex-wrap mb-1">
            <h2 className="cinzel text-2xl font-bold text-amber-500">
              Revisar {preview.length} miembros
            </h2>
            <div className="flex gap-2">
              <button
                onClick={() => { setPreview(null); setMessage(null); }}
                className="text-slate-400 hover:text-slate-200 text-sm py-2 px-4 rounded transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={commit}
                disabled={busy}
                className="bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 text-white text-sm font-bold py-2 px-4 rounded transition-all flex items-center gap-2"
              >
                <i className="fa-solid fa-floppy-disk"></i>
                Guardar escaneo
              </button>
            </div>
          </div>
          <p className="text-xs text-slate-500 mb-5">
            {scannedAt && <>Capturado el {new Date(scannedAt).toLocaleString()}. </>}
            {pending === 0
              ? 'Todos reconocidos por escaneos anteriores.'
              : `${pending} sin reconocer: elige a quién corresponden o créalos.`}
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left text-slate-400">
                  <th className="p-2 border-b border-slate-800 font-semibold">Leído</th>
                  <th className="p-2 border-b border-slate-800 font-semibold">UID</th>
                  <th className="p-2 border-b border-slate-800 font-semibold">Corresponde a</th>
                  <th className="p-2 border-b border-slate-800 font-semibold text-right">Actividad</th>
                  <th className="p-2 border-b border-slate-800 font-semibold text-right">Campos</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((entry) => {
                  const decision = decisions[entry.nameAsRead];
                  const filled = Object.values(entry.fields).filter((v) => v !== null && v !== undefined).length;
                  const selectValue =
                    decision?.kind === 'link' ? decision.playerId : decision?.kind === 'skip' ? '__skip' : '__new';

                  return (
                    <tr key={entry.nameAsRead} className="hover:bg-slate-800/30">
                      <td className="p-2 border-b border-slate-800/60">
                        <span className="text-slate-200 font-mono">{entry.nameAsRead}</span>
                        {entry.match === 'uid' && (
                          <span className="ml-2 text-[9px] uppercase tracking-wider bg-sky-700 text-white px-1.5 py-0.5 rounded">
                            por UID
                          </span>
                        )}
                        {entry.match === 'alias' && (
                          <span className="ml-2 text-[9px] uppercase tracking-wider bg-emerald-800 text-white px-1.5 py-0.5 rounded">
                            conocido
                          </span>
                        )}
                        {entry.renamed && (
                          <div className="text-[10px] text-amber-500 mt-0.5">
                            <i className="fa-solid fa-arrow-right-arrow-left mr-1"></i>
                            se renombró: antes {entry.playerName}
                          </div>
                        )}
                      </td>
                      <td className="p-2 border-b border-slate-800/60 font-mono text-xs text-slate-500">
                        {entry.uid ?? <span className="text-slate-700">—</span>}
                      </td>
                      <td className="p-2 border-b border-slate-800/60">
                        <select
                          className="bg-slate-950 border border-slate-800 rounded p-1 text-xs w-full max-w-xs outline-none focus:ring-1 focus:ring-amber-500"
                          value={selectValue}
                          onChange={(e) => {
                            const v = e.target.value;
                            setDecisions((prev) => ({
                              ...prev,
                              [entry.nameAsRead]:
                                v === '__new'
                                  ? { kind: 'create', name: entry.nameAsRead }
                                  : v === '__skip'
                                    ? { kind: 'skip' }
                                    : { kind: 'link', playerId: v },
                            }));
                          }}
                        >
                          <option value="__new">+ Crear como miembro nuevo</option>
                          <option value="__skip">Omitir esta fila</option>
                          {[...players]
                            .sort((a, b) => {
                              const sa = entry.suggestions.find((s) => s.playerId === a.id)?.score ?? 0;
                              const sb = entry.suggestions.find((s) => s.playerId === b.id)?.score ?? 0;
                              return sb - sa || a.name.localeCompare(b.name);
                            })
                            .map((p) => {
                              const hint = entry.suggestions.find((s) => s.playerId === p.id);
                              return (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                  {hint ? `  (${Math.round(hint.score * 100)}% parecido)` : ''}
                                </option>
                              );
                            })}
                        </select>
                        {decision?.kind === 'create' && (
                          <input
                            type="text"
                            value={decision.name}
                            placeholder="Nombre con su ortografía correcta"
                            title="Escríbelo tal cual aparece en el juego; solo hace falta una vez"
                            className="mt-1 bg-slate-950 border border-slate-800 rounded p-1 text-xs w-full max-w-xs outline-none focus:ring-1 focus:ring-amber-500"
                            onChange={(e) =>
                              setDecisions((prev) => ({
                                ...prev,
                                [entry.nameAsRead]: { kind: 'create', name: e.target.value },
                              }))
                            }
                          />
                        )}
                      </td>
                      <td className="p-2 border-b border-slate-800/60 text-right text-slate-300">
                        {entry.fields.week_activity ?? '—'}
                      </td>
                      <td className="p-2 border-b border-slate-800/60 text-right">
                        <span className={filled < 18 ? 'text-amber-500' : 'text-slate-500'}>{filled}/18</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};

export default ScanImport;
