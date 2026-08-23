import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/authService';
import Sheet from './Sheet';
import { ProgresoSubida, enBytes, loQueFalta, subir } from '../services/subidaTus';

/**
 * Las grabaciones de una guerra, dentro de su acta. Ver docs/VODS.md.
 *
 * Tres papeles conviven en la misma lista y por eso no se separa en pestañas:
 * quien subió lo suyo quiere ver que llegó, quien aprueba quiere ver lo que
 * está esperando, y el resto sólo quiere darle al play. Partirlo obligaría a
 * los dos primeros a mirar en dos sitios.
 */

export interface VodCalidad {
  calidad: 'origen' | '360p';
  playlist: string;
}

export interface Vod {
  id: string;
  warId: string;
  playerId: string;
  estado: 'subiendo' | 'procesando' | 'listo' | 'aprobado' | 'rechazado' | 'error' | 'caducado';
  duracionMs: number | null;
  offsetMs: number | null;
  offsetConfianza: 'ocr' | 'nombre' | 'manual' | null;
  fijado: boolean;
  expiraEn: string | null;
  subidoEn: string;
  calidades: VodCalidad[];
}

interface Props {
  warId: string;
  /** Los del gremio, para poner nombre al `playerId`. */
  nombres: Record<string, string>;
  /** La ficha de quien mira, para saber cuáles son suyas. */
  miPlayerId: string | null;
  puedeSubir: boolean;
  puedeAprobar: boolean;
  puedeFijar: boolean;
}

const duracion = (ms: number | null) => {
  if (!ms) return null;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/** Cuánto le queda antes de que se borren sus bytes. */
const caducidad = (iso: string | null, fijado: boolean) => {
  if (fijado) return 'no caduca';
  if (!iso) return null;
  const dias = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  if (dias <= 0) return 'caduca hoy';
  return dias === 1 ? 'caduca mañana' : `caduca en ${dias} días`;
};

const ETIQUETA: Record<Vod['estado'], { texto: string; clase: string }> = {
  subiendo: { texto: 'Subiendo', clase: 'text-slate-400' },
  procesando: { texto: 'Preparando', clase: 'text-amber-400' },
  listo: { texto: 'Esperando revisión', clase: 'text-amber-400' },
  aprobado: { texto: 'Publicada', clase: 'text-emerald-400' },
  rechazado: { texto: 'Rechazada', clase: 'text-red-400' },
  error: { texto: 'Falló al preparar', clase: 'text-red-400' },
  caducado: { texto: 'Caducada', clase: 'text-slate-500' },
};

const WarVods: React.FC<Props> = ({ warId, nombres, miPlayerId, puedeSubir, puedeAprobar, puedeFijar }) => {
  const [vods, setVods] = useState<Vod[] | null>(null);
  const [viendo, setViendo] = useState<Vod | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [progreso, setProgreso] = useState<ProgresoSubida | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; ok: boolean } | null>(null);
  const archivo = useRef<HTMLInputElement>(null);
  const cancelar = useRef<AbortController | null>(null);

  const cargar = useCallback(async () => {
    setVods(await api<Vod[]>(`/war/wars/${warId}/vods`).catch(() => []));
  }, [warId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /**
   * Mientras algo se está preparando, preguntar cada pocos segundos. El remux
   * tarda segundos y la copia de 360p minutos, así que sin esto la lista se
   * queda en «Preparando» hasta que alguien recarga y parece que se colgó.
   */
  useEffect(() => {
    if (!vods?.some((v) => v.estado === 'procesando' || v.estado === 'subiendo')) return;
    const t = setInterval(() => void cargar(), 5000);
    return () => clearInterval(t);
  }, [vods, cargar]);

  const elegido = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fichero = e.target.files?.[0];
    e.target.value = '';
    if (!fichero) return;

    setAviso(null);
    setSubiendo(true);
    setProgreso({ enviados: 0, total: fichero.size, bytesPorSegundo: null });
    cancelar.current = new AbortController();

    try {
      await subir({
        fichero,
        metadatos: { warId, filename: fichero.name },
        alProgresar: setProgreso,
        señal: cancelar.current.signal,
      });
      setAviso({ texto: 'Subida. Queda esperar a que un oficial la publique.', ok: true });
      await cargar();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Cancelar no es fallar: lo enviado sigue guardado y volver a elegir el
        // mismo fichero continúa donde se dejó.
        setAviso({ texto: 'Subida detenida. Puedes retomarla eligiendo el mismo fichero.', ok: true });
      } else {
        setAviso({ texto: err instanceof Error ? err.message : 'No se pudo subir', ok: false });
      }
    } finally {
      setSubiendo(false);
      setProgreso(null);
      cancelar.current = null;
    }
  };

  const resolver = async (vod: Vod, aprobado: boolean) => {
    await api(`/vods/${vod.id}/resolve`, { method: 'POST', body: JSON.stringify({ aprobado }) });
    await cargar();
  };

  const fijar = async (vod: Vod) => {
    await api(`/vods/${vod.id}/pin`, { method: 'POST', body: JSON.stringify({ fijado: !vod.fijado }) });
    await cargar();
  };

  const pendientes = vods?.filter((v) => v.estado === 'listo').length ?? 0;

  return (
    <section className="mt-6">
      <header className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
          <i className="fa-solid fa-video text-slate-500" aria-hidden="true" />
          Grabaciones
          {puedeAprobar && pendientes > 0 && (
            <span className="text-[11px] font-medium text-amber-400">
              {pendientes} sin revisar
            </span>
          )}
        </h3>

        {puedeSubir && !subiendo && (
          <>
            <button
              type="button"
              onClick={() => archivo.current?.click()}
              className="px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-2"
            >
              <i className="fa-solid fa-upload" aria-hidden="true" />
              Subir la mía
            </button>
            <input
              ref={archivo}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={elegido}
            />
          </>
        )}
      </header>

      {subiendo && progreso && (
        <div className="mb-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <span className="text-xs text-slate-300">
              {enBytes(progreso.enviados)} de {enBytes(progreso.total)}
              {loQueFalta(progreso) && (
                <span className="text-slate-500"> · faltan {loQueFalta(progreso)}</span>
              )}
            </span>
            <button
              type="button"
              onClick={() => cancelar.current?.abort()}
              className="tap-suelto text-[11px] text-slate-400 hover:text-slate-200 underline"
            >
              Detener
            </button>
          </div>
          <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-amber-500 transition-[width] duration-300"
              style={{ width: `${Math.round((progreso.enviados / progreso.total) * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Puedes cerrar esto o irte: al volver a elegir el mismo fichero, continúa donde iba.
          </p>
        </div>
      )}

      {aviso && (
        <p className={`mb-3 text-xs ${aviso.ok ? 'text-emerald-400' : 'text-red-400'}`}>{aviso.texto}</p>
      )}

      {vods === null ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : vods.length === 0 ? (
        <p className="text-xs text-slate-500">
          Nadie ha subido su grabación de esta guerra
          {puedeSubir && ' — si la tienes, súbela'}.
        </p>
      ) : (
        <ul className="space-y-2">
          {vods.map((vod) => {
            const etiqueta = ETIQUETA[vod.estado];
            const mia = vod.playerId === miPlayerId;
            const reproducible = vod.calidades.length > 0 && vod.estado !== 'caducado';
            return (
              <li
                key={vod.id}
                className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 flex flex-wrap items-center gap-x-3 gap-y-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-200 truncate">
                    {nombres[vod.playerId] ?? vod.playerId}
                    {mia && <span className="text-slate-500 text-xs"> · la tuya</span>}
                  </p>
                  <p className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2">
                    <span className={etiqueta.clase}>{etiqueta.texto}</span>
                    {duracion(vod.duracionMs) && <span>{duracion(vod.duracionMs)}</span>}
                    {vod.fijado && (
                      <span className="text-sky-400">
                        <i className="fa-solid fa-thumbtack" aria-hidden="true" /> fijada
                      </span>
                    )}
                    {caducidad(vod.expiraEn, vod.fijado) && !vod.fijado && vod.estado === 'aprobado' && (
                      <span>{caducidad(vod.expiraEn, vod.fijado)}</span>
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {reproducible && (
                    <button
                      type="button"
                      onClick={() => setViendo(vod)}
                      className="px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-2"
                    >
                      <i className="fa-solid fa-play" aria-hidden="true" />
                      Ver
                    </button>
                  )}

                  {puedeAprobar && vod.estado === 'listo' && (
                    <>
                      <button
                        type="button"
                        onClick={() => void resolver(vod, true)}
                        className="px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium"
                      >
                        Publicar
                      </button>
                      {/* Rechazar borra los bytes en el acto, así que se avisa. */}
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm('Rechazarla borra el vídeo. ¿Seguro?')) void resolver(vod, false);
                        }}
                        className="px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium"
                      >
                        Rechazar
                      </button>
                    </>
                  )}

                  {puedeFijar && vod.estado === 'aprobado' && (
                    <button
                      type="button"
                      onClick={() => void fijar(vod)}
                      title={vod.fijado ? 'Dejar que caduque' : 'Guardarla para siempre'}
                      aria-label={vod.fijado ? 'Dejar que caduque' : 'Guardarla para siempre'}
                      className={`min-w-tap rounded-lg text-xs flex items-center justify-center ${
                        vod.fijado
                          ? 'bg-sky-900/60 text-sky-300 hover:bg-sky-900'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      <i className="fa-solid fa-thumbtack" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {viendo && (
        <Sheet
          title={nombres[viendo.playerId] ?? viendo.playerId}
          subtitle="Grabación de esta guerra"
          size="xl"
          onClose={() => setViendo(null)}
        >
          <Reproductor vod={viendo} />
        </Sheet>
      )}
    </section>
  );
};

/**
 * HLS sin librería: Safari lo reproduce de fábrica, y el resto necesita hls.js.
 *
 * Se carga desde CDN y sólo al abrir un vídeo, igual que se hace con
 * tesseract en `ResultsReader`: son 150 KB que no tienen por qué estar en el
 * paquete de todo el mundo cuando la mayoría de las visitas no abren ninguna
 * grabación.
 */
const HLSJS = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';

const Reproductor: React.FC<{ vod: Vod }> = ({ vod }) => {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  // La mejor que haya: el original si está, y si no la de 360p, que llega antes.
  const fuente =
    vod.calidades.find((c) => c.calidad === 'origen') ?? vod.calidades[0];
  const src = fuente ? `/api/vods/${vod.id}/hls/${fuente.playlist.split(/[\\/]/).pop()}` : null;

  useEffect(() => {
    const el = video.current;
    if (!el || !src) return;

    if (el.canPlayType('application/vnd.apple.mpegurl')) {
      el.src = src;
      return;
    }

    let hls: { destroy: () => void } | null = null;
    let vivo = true;

    const arrancar = async () => {
      const w = window as unknown as { Hls?: any };
      if (!w.Hls) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement('script');
          s.src = HLSJS;
          s.onload = () => resolve();
          s.onerror = () => reject(new Error('No se pudo cargar el reproductor.'));
          document.head.appendChild(s);
        });
      }
      if (!vivo || !w.Hls?.isSupported()) return;
      const instancia = new w.Hls();
      hls = instancia;
      instancia.loadSource(src);
      instancia.attachMedia(el);
    };

    arrancar().catch((e) => setError(e.message));
    return () => {
      vivo = false;
      hls?.destroy();
    };
  }, [src]);

  if (!src) return <p className="text-sm text-slate-400">Esta grabación ya no tiene vídeo.</p>;

  return (
    <div className="space-y-2">
      <video
        ref={video}
        controls
        playsInline
        className="w-full rounded-lg bg-black aspect-video"
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      {vod.offsetConfianza === null && (
        <p className="text-[11px] text-slate-500">
          Sincronía sin verificar: todavía no se sabe en qué momento de la guerra empieza.
        </p>
      )}
    </div>
  );
};

export default WarVods;
