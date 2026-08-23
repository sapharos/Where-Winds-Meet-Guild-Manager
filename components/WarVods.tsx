import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/authService';
import Sheet from './Sheet';
import PreparaVod from './PreparaVod';
import Reproductor, { Marca } from './Reproductor';
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
  /** Su cuenta, que es lo que firma las marcas. */
  miUserId: string | null;
  /** Editar la guerra deja borrar las marcas de cualquiera. */
  puedeEditar: boolean;
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

const WarVods: React.FC<Props> = ({
  warId, nombres, miPlayerId, miUserId, puedeEditar, puedeSubir, puedeAprobar, puedeFijar,
}) => {
  const [vods, setVods] = useState<Vod[] | null>(null);
  const [viendo, setViendo] = useState<Vod | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [progreso, setProgreso] = useState<ProgresoSubida | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; ok: boolean } | null>(null);
  const [preparando, setPreparando] = useState<File | null>(null);
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const archivo = useRef<HTMLInputElement>(null);
  const cancelar = useRef<AbortController | null>(null);

  const cargar = useCallback(async () => {
    setVods(await api<Vod[]>(`/war/wars/${warId}/vods`).catch(() => []));
  }, [warId]);

  // Las marcas cuelgan de la guerra, no de la grabación: se piden una vez y
  // sirven para cualquiera que se abra, que es lo que hace que quien mira el
  // VOD de uno vea también lo que apuntó el que jugaba en la otra línea.
  const cargarMarcas = useCallback(async () => {
    setMarcas(await api<Marca[]>(`/war/wars/${warId}/marcas`).catch(() => []));
  }, [warId]);

  useEffect(() => {
    void cargar();
    void cargarMarcas();
  }, [cargar, cargarMarcas]);

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

  /**
   * Elegir el fichero ya no sube: abre la preparación. Ahí se marca el recorte
   * y se lee el cronómetro, las dos cosas sobre el fichero local y sin gastar
   * ni un byte de red. Ver docs/VODS.md §4.
   */
  const elegido = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fichero = e.target.files?.[0];
    e.target.value = '';
    if (fichero) {
      setAviso(null);
      setPreparando(fichero);
    }
  };

  const enviar = async (
    fichero: File,
    extra: {
      recorteIniMs: number | null;
      recorteFinMs: number | null;
      offsetMs: number | null;
      confianza: string | null;
    },
  ) => {
    setPreparando(null);
    setSubiendo(true);
    setProgreso({ enviados: 0, total: fichero.size, bytesPorSegundo: null });
    cancelar.current = new AbortController();

    try {
      await subir({
        fichero,
        // Los metadatos de tus son cadenas siempre; lo que no se sepa no se
        // manda, para que el servidor distinga «no consta» de «cero».
        metadatos: {
          warId,
          filename: fichero.name,
          ...(extra.recorteIniMs !== null ? { recorteIniMs: String(extra.recorteIniMs) } : {}),
          ...(extra.recorteFinMs !== null ? { recorteFinMs: String(extra.recorteFinMs) } : {}),
          ...(extra.offsetMs !== null ? { offsetMs: String(extra.offsetMs) } : {}),
          ...(extra.confianza ? { offsetConfianza: extra.confianza } : {}),
        },
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

  const marcar = async (tMs: number, texto: string, hito: boolean, vodId: string) => {
    await api(`/war/wars/${warId}/marcas`, {
      method: 'POST',
      body: JSON.stringify({ tMs, texto, hito, vodId }),
    });
    await cargarMarcas();
  };

  const borrarMarca = async (id: string) => {
    await api(`/marcas/${id}`, { method: 'DELETE' });
    await cargarMarcas();
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

      {preparando && (
        <PreparaVod
          fichero={preparando}
          onCancelar={() => setPreparando(null)}
          onListo={(datos) => void enviar(preparando, datos)}
        />
      )}

      {viendo && (
        <Sheet
          title={nombres[viendo.playerId] ?? viendo.playerId}
          subtitle="Grabación de esta guerra"
          size="xl"
          onClose={() => setViendo(null)}
        >
          <Reproductor
            // La mejor calidad que haya: el original si está, y si no la de
            // 360p, que llega antes.
            src={(() => {
              const c =
                viendo.calidades.find((x) => x.calidad === 'origen') ?? viendo.calidades[0];
              return c ? `/api/vods/${viendo.id}/hls/${c.playlist.split(/[\\/]/).pop()}` : null;
            })()}
            offsetMs={viendo.offsetMs}
            marcas={marcas}
            onMarcar={(tMs, texto, hito) => void marcar(tMs, texto, hito, viendo.id)}
            onBorrarMarca={(id) => void borrarMarca(id)}
            // La suya, cualquiera; la de otro, sólo quien edita la guerra. El
            // servidor lo vuelve a comprobar: esto sólo decide si se ve el
            // botón.
            puedeBorrar={(m) => m.autorId === miUserId || puedeEditar}
          />
        </Sheet>
      )}
    </section>
  );
};

export default WarVods;
