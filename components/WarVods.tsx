import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/authService';
import Sheet from './Sheet';
import PreparaVod from './PreparaVod';
import Reproductor, { Marca } from './Reproductor';
import Multistream, { VodEnMosaico } from './Multistream';
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
  /**
   * Cómo va la preparación. Ver docs/VODS.md §8.
   *
   * `estado` dice *que* está preparando y nada más, y eso no bastaba: un remux
   * con `-c copy` tarda segundos y un recodificado de HEVC tarda una hora, y en
   * pantalla se veían igual -- igual que se veía un trabajo que ya no existía
   * porque la API se había reiniciado con la cola en memoria.
   */
  procesoFase: 'cola' | 'origen' | '360p' | null;
  /** De 0 a 100. Null si ffprobe no supo decir la duración. */
  procesoPct: number | null;
  procesoError: string | null;
  /** Segundos desde que empezó a prepararse. Lo cuenta el servidor. */
  procesoSegundos: number | null;
  /** Hay algo en marcha y hace rato que no da señales. Lo decide el servidor. */
  procesoParado: boolean;
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
  /**
   * Quitar una grabación del acta, con sus bytes y su fila.
   *
   * `puedeBorrarVod` y no `puedeBorrar` porque en este mismo archivo ya hay un
   * `puedeBorrar` que decide quién borra una MARCA, y son cosas distintas.
   *
   * Permiso propio (`war.vod.delete`) y no el de aprobar: rechazar es una
   * decisión sobre algo que está a revisión, y esto quita del registro algo que
   * ya existía. Por defecto sólo administración y liderazgo.
   */
  puedeBorrarVod: boolean;
  /**
   * Quiénes pelearon esta guerra, para poder subir la grabación de otro.
   *
   * Sólo los de ESTA guerra y no el gremio entero, porque el servidor exige
   * figurar en `war_participants` de ella: ofrecer a los demás sería ofrecer
   * un 403 con el nombre de un compañero puesto.
   */
  participantes: { id: string; nombre: string }[];
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

/** Cuánto lleva, redondeado a lo que de verdad se mira. */
const desdeHace = (segundos: number) => {
  if (segundos < 60) return `${segundos} s`;
  const min = Math.round(segundos / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
};

/**
 * Lo que se dice del avance, en una línea.
 *
 * Se prefiere la fase al estado porque el estado miente por omisión en los dos
 * extremos: «Subiendo» cuando los bytes están enteros y sólo falta el turno, y
 * «Esperando revisión» cuando el vídeo ya se ve pero la máquina sigue media
 * hora haciendo la copia de los mosaicos.
 */
const avanceDe = (vod: Vod): { texto: string | null; clase: string; barra: boolean } | null => {
  // Cifra de verdad o nada: un campo que no viniera se colaba en la resta y
  // salía «lleva NaN h NaN min» en pantalla.
  const pct = typeof vod.procesoPct === 'number' ? vod.procesoPct : null;

  if (vod.procesoFase === 'cola') {
    return { texto: 'En cola', clase: 'text-slate-400', barra: false };
  }
  // La etiqueta del estado ya dice «Preparando»; aquí sólo se le pone cifra.
  if (vod.estado === 'procesando') {
    return { texto: pct === null ? null : `${pct}%`, clase: 'text-amber-400', barra: pct !== null };
  }
  // La de 360p va después de que el vídeo ya se pueda ver, así que es una nota
  // al margen y no el titular: quien mira ya puede darle al play.
  if (vod.procesoFase === '360p') {
    return {
      texto: pct === null ? 'generando 360p' : `generando 360p ${pct}%`,
      clase: 'text-slate-500',
      barra: false,
    };
  }
  return null;
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
  puedeBorrarVod, participantes,
}) => {
  const [vods, setVods] = useState<Vod[] | null>(null);
  const [viendo, setViendo] = useState<Vod | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [progreso, setProgreso] = useState<ProgresoSubida | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; ok: boolean } | null>(null);
  const [preparando, setPreparando] = useState<File | null>(null);
  /**
   * De quién es la grabación que se va a subir. Vacío significa «mía».
   *
   * Existe porque en la práctica media plantilla manda su vídeo por Discord a
   * un oficial en vez de entrar aquí, y hasta ahora ese oficial sólo podía
   * subirla a su propio nombre -- con lo que el acta decía que la había grabado
   * él, y el puntaje de quien de verdad jugaba se quedaba sin su vídeo.
   *
   * El servidor ya lo permitía desde el principio: `autorizarSubida` acepta un
   * `playerId` distinto del propio si quien sube tiene `war.vod.approve`. Lo
   * que faltaba era mandarlo.
   */
  const [deQuien, setDeQuien] = useState<string>('');
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [mosaico, setMosaico] = useState(false);
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
    // También mientras hay una fase en marcha: la copia de 360p corre cuando el
    // estado ya es «listo», así que mirando sólo el estado la barra de esa fase
    // se quedaría congelada en el número con el que se cargó la página.
    const enMarcha = vods?.some(
      (v) => v.estado === 'procesando' || v.estado === 'subiendo' || v.procesoFase !== null,
    );
    if (!enMarcha) return;
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
          // Sólo cuando es de otro. Mandar el propio `playerId` siempre sería
          // decir lo mismo con más palabras, y el servidor ya sabe de quién es
          // la sesión.
          ...(deQuien ? { playerId: deQuien } : {}),
          ...(extra.recorteIniMs !== null ? { recorteIniMs: String(extra.recorteIniMs) } : {}),
          ...(extra.recorteFinMs !== null ? { recorteFinMs: String(extra.recorteFinMs) } : {}),
          ...(extra.offsetMs !== null ? { offsetMs: String(extra.offsetMs) } : {}),
          ...(extra.confianza ? { offsetConfianza: extra.confianza } : {}),
        },
        alProgresar: setProgreso,
        señal: cancelar.current.signal,
      });
      // Se dice a nombre de quién quedó. Subir la de otro es justo donde un
      // desplegable que se quedó puesto de la vez anterior hace daño, y esta
      // línea es la única oportunidad de verlo antes de que se publique.
      setAviso({
        texto: deQuien
          ? `Subida a nombre de ${nombres[deQuien] ?? 'ese miembro'}. Queda publicarla.`
          : 'Subida. Queda esperar a que un oficial la publique.',
        ok: true,
      });
      // Vuelve a «yo»: dejarlo puesto haría que la siguiente subida se le
      // colgara al mismo sin que nadie lo pidiera.
      setDeQuien('');
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

  /**
   * Volver a ponerla en la cola.
   *
   * El fichero de origen no se borra hasta que la preparación termina del todo,
   * así que reintentar no le cuesta a nadie volver a subir 2 GB: casi siempre
   * lo único que hacía falta era que alguien volviera a arrancar el trabajo.
   */
  const reintentar = async (vod: Vod) => {
    setAviso(null);
    try {
      await api(`/vods/${vod.id}/retry`, { method: 'POST' });
      setAviso({ texto: 'De vuelta a la cola. Se prepara en cuanto le toque el turno.', ok: true });
    } catch (err) {
      setAviso({ texto: err instanceof Error ? err.message : 'No se pudo reintentar', ok: false });
    }
    await cargar();
  };

  /**
   * Quitarla del acta.
   *
   * Se avisa de lo que de verdad pasa y no con un «¿seguro?»: que no se puede
   * deshacer, y que a diferencia de una rechazada o una caducada no va a quedar
   * constancia de que existió. Con el nombre de quien la subió dentro, porque
   * en una lista de seis filas es fácil pulsar en la de al lado.
   *
   * Las marcas se quedan. Están en tiempo de guerra y valen para cualquier
   * grabación de esa noche, así que quien anotó «cae la puerta del medio» no
   * pierde su nota porque se borre el vídeo desde el que la escribió.
   */
  const borrar = async (vod: Vod) => {
    const quien = nombres[vod.playerId] ?? vod.playerId;
    const aviso =
      `Se va a borrar del acta la grabación de ${quien}, con el vídeo entero.\n\n` +
      'No se puede deshacer y no queda constancia de que existió, a diferencia de ' +
      'una rechazada o una caducada. Las marcas de la guerra se conservan.\n\n' +
      '¿Borrarla?';
    if (!confirm(aviso)) return;

    setAviso(null);
    try {
      await api(`/vods/${vod.id}`, { method: 'DELETE' });
      // Si estaba abierta en el reproductor, se cierra: se acaba de quedar sin
      // vídeo detrás y el reproductor sólo sabría enseñar un error.
      setViendo((v) => (v?.id === vod.id ? null : v));
      setAviso({ texto: `Grabación de ${quien} borrada del acta.`, ok: true });
    } catch (err) {
      setAviso({ texto: err instanceof Error ? err.message : 'No se pudo borrar', ok: false });
    }
    await cargar();
    await cargarMarcas();
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

  const sincronizar = async (id: string, offsetMs: number) => {
    await api(`/vods/${id}/sync`, {
      method: 'PUT',
      body: JSON.stringify({ offsetMs, confianza: 'manual' }),
    });
    await cargar();
    // La abierta también, o el reproductor seguiría diciendo que no lo está.
    setViendo((v) => (v && v.id === id ? { ...v, offsetMs, offsetConfianza: 'manual' } : v));
  };

  const urlDe = (vod: Vod, calidad: string) => {
    const c = vod.calidades.find((x) => x.calidad === calidad);
    return c ? `/api/vods/${vod.id}/hls/${c.playlist.split(/[\/]/).pop()}` : null;
  };

  /**
   * Las que pueden ir al mosaico: publicadas, con vídeo y **sincronizadas**.
   * Sin `offsetMs` no hay forma de saber dónde encaja una grabación respecto a
   * las demás, así que meterla sería alinearla al azar.
   */
  const paraMosaico: VodEnMosaico[] = (vods ?? [])
    .filter((v) => v.estado === 'aprobado' && v.offsetMs !== null && v.duracionMs && v.calidades.length)
    .slice(0, 4)
    .map((v) => ({
      id: v.id,
      playerId: v.playerId,
      nombre: nombres[v.playerId] ?? v.playerId,
      offsetMs: v.offsetMs!,
      duracionMs: v.duracionMs!,
      fuentes: v.calidades
        .map((c) => ({ calidad: c.calidad, url: urlDe(v, c.calidad)! }))
        .filter((f) => f.url),
    }));

  const sinSincronizar = (vods ?? []).filter(
    (v) => v.estado === 'aprobado' && v.offsetMs === null && v.calidades.length,
  ).length;

  const aprobadas = (vods ?? []).filter((v) => v.estado === 'aprobado' && v.calidades.length).length;

  const pendientes = vods?.filter((v) => v.estado === 'listo').length ?? 0;

  /**
   * A quién se le puede atribuir una grabación, aparte de a uno mismo.
   *
   * Los de esta guerra y nadie más: el servidor exige figurar en
   * `war_participants` de ella, así que ofrecer al resto del gremio sería
   * ofrecer un 403 con el nombre de un compañero puesto. Ordenados por nombre
   * porque el orden en que se desplegaron no ayuda a encontrar a nadie.
   */
  const otros = participantes
    .filter((p) => p.id !== miPlayerId)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

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

        {paraMosaico.length >= 2 && (
          <button
            type="button"
            onClick={() => setMosaico(true)}
            title={
              sinSincronizar
                ? `${sinSincronizar} grabación(es) más quedan fuera por no estar sincronizadas`
                : undefined
            }
            className="px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-2"
          >
            <i className="fa-solid fa-table-cells-large" aria-hidden="true" />
            Ver {paraMosaico.length} a la vez
          </button>
        )}

        {puedeSubir && !subiendo && (
          <>
            {/*
              De quién es. Sólo para quien puede aprobar, que es a quien el
              servidor se lo consiente, y sólo si queda alguien a quien
              atribuírsela: en una guerra de uno el desplegable sobra.

              Va antes del botón y no dentro de la preparación a propósito. Es
              lo primero que hay que decidir -- cambia a nombre de quién queda
              el acta -- y puesto después, entre el recorte y el cronómetro, se
              queda en un ajuste más de los que se pasan de largo.
            */}
            {puedeAprobar && otros.length > 0 && (
              <label className="flex items-center gap-2 text-[11px] text-slate-500">
                Subir como
                <select
                  value={deQuien}
                  onChange={(e) => setDeQuien(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded px-2 min-h-tap text-sm text-slate-200 outline-none focus:ring-1 focus:ring-amber-500"
                >
                  <option value="">yo</option>
                  {otros.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              onClick={() => archivo.current?.click()}
              className="px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-2"
            >
              <i className="fa-solid fa-upload" aria-hidden="true" />
              {deQuien ? `Subir la de ${nombres[deQuien] ?? 'ese miembro'}` : 'Subir la mía'}
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

      {/*
        Por qué no hay mosaico, cuando no lo hay.
        
        Antes el botón simplemente no aparecía y nada lo explicaba: con dos
        grabaciones publicadas pero una sin sincronizar, la funcionalidad
        estaba ahí y era invisible, sin manera de averiguar qué faltaba. Un
        renglón cuesta nada y convierte un callejón sin salida en una tarea.
      */}
      {vods !== null && paraMosaico.length < 2 && aprobadas >= 1 && (
        <p className="mb-3 text-[11px] text-slate-500">
          {sinSincronizar > 0 ? (
            <>
              Para verlas a la vez hacen falta dos grabaciones sincronizadas y hay{' '}
              {sinSincronizar} sin sincronizar. Ábrela con «Ver» y dile en qué momento de la
              guerra empieza.
            </>
          ) : (
            <>Con una segunda grabación publicada de esta guerra podréis verlas a la vez, cuadradas.</>
          )}
        </p>
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
            const avance = avanceDe(vod);
            // Reintentar la suya, quien la subió; la de otro, quien aprueba --
            // el servidor manda igual, esto sólo evita enseñar un botón que va
            // a contestar 403.
            const puedeReintentar =
              (mia || puedeAprobar) && (vod.estado === 'error' || vod.procesoParado);
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
                    {/* El titular sigue siendo el estado; el avance va al lado,
                        porque «Preparando» sin más era justo lo que no decía
                        nada.

                        Salvo en la cola, donde el estado es lo que estorba: la
                        fila sólo existe a partir del gancho `post-finish`, así
                        que «Subiendo» ahí significa que los bytes están enteros
                        y falta el turno. Dicho junto a «En cola» eran dos
                        etiquetas contradictorias sobre lo mismo. */}
                    {vod.procesoFase !== 'cola' && (
                      <span className={etiqueta.clase}>{etiqueta.texto}</span>
                    )}
                    {avance?.texto && (
                      <span className={`${avance.clase} tabular-nums`}>{avance.texto}</span>
                    )}
                    {/* Sólo mientras hay algo en marcha: «lleva 40 min» sobre una
                        grabación terminada hace un mes no dice nada. */}
                    {avance && typeof vod.procesoSegundos === 'number' && (
                      <span className="tabular-nums">lleva {desdeHace(vod.procesoSegundos)}</span>
                    )}
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

                  {avance?.barra && vod.procesoPct !== null && (
                    <div
                      className="mt-1.5 h-1 rounded bg-slate-800 overflow-hidden"
                      role="progressbar"
                      aria-valuenow={vod.procesoPct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label="Preparación de la grabación"
                    >
                      <div
                        className="h-full rounded bg-amber-500 transition-all duration-slow"
                        style={{ width: `${vod.procesoPct}%` }}
                      />
                    </div>
                  )}

                  {/*
                    Que no dé señales no es lo mismo que haber fallado, y por eso
                    se dice de otra manera. ffmpeg informa de su avance cada
                    segundo; si lleva dos minutos callado es que ya no hay nadie
                    trabajando -- casi siempre, un redespliegue que se llevó la
                    cola por delante. Se puede arreglar desde aquí.
                  */}
                  {vod.procesoParado && vod.estado !== 'error' && (
                    <p className="mt-1 text-[11px] text-amber-400 flex items-start gap-1.5">
                      <i className="fa-solid fa-triangle-exclamation mt-0.5 shrink-0" aria-hidden="true" />
                      <span>
                        Sin señal desde hace rato. Lo más probable es que la preparación se
                        interrumpiera{mia || puedeAprobar ? '; puedes reintentarla' : ''}.
                      </span>
                    </p>
                  )}

                  {/* El motivo, entero. Es lo único que convierte «falló» en algo
                      que alguien pueda hacer.

                      También cuando el estado NO es «error»: la copia de 360p
                      puede fallar sola sin tumbar una grabación que se ve
                      perfectamente, y eso hay que poder saberlo -- es la que
                      decide si puede entrar en un mosaico. En ámbar y no en
                      rojo, porque no está rota: le falta algo. */}
                  {vod.procesoError && (
                    <p
                      className={`mt-1 text-[11px] break-words ${
                        vod.estado === 'error' ? 'text-red-300' : 'text-amber-400/90'
                      }`}
                    >
                      {vod.procesoError}
                    </p>
                  )}
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

                  {puedeReintentar && (
                    <button
                      type="button"
                      onClick={() => void reintentar(vod)}
                      className="px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-2"
                    >
                      <i className="fa-solid fa-arrow-rotate-left" aria-hidden="true" />
                      Reintentar
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

                  {/*
                    En cualquier estado, que es el sentido de esto: rechazar
                    sólo aparece mientras está a revisión, así que una ya
                    publicada -- o una que quedó inservible después de
                    prepararse -- no había forma de quitarla.

                    Al final de la fila y sin color de alarma: es destructivo,
                    pero pintarlo de rojo junto a «Publicar» sólo aumenta las
                    probabilidades de darle al que no era. Lo que protege es el
                    aviso, que dice lo que pasa.
                  */}
                  {puedeBorrarVod && (
                    <button
                      type="button"
                      onClick={() => void borrar(vod)}
                      title="Borrar esta grabación del acta"
                      aria-label={`Borrar la grabación de ${nombres[vod.playerId] ?? vod.playerId}`}
                      className="min-w-tap rounded-lg bg-slate-800 text-slate-400 hover:bg-red-900/60 hover:text-red-300 text-xs flex items-center justify-center transition-colors duration-micro"
                    >
                      <i className="fa-solid fa-trash" aria-hidden="true" />
                    </button>
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

      {mosaico && (
        <Multistream vods={paraMosaico} marcas={marcas} onClose={() => setMosaico(false)} />
      )}

      {viendo && (
        <Sheet
          title={nombres[viendo.playerId] ?? viendo.playerId}
          subtitle="Grabación de esta guerra"
          size="video"
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
            // Sin `void`: el reproductor necesita esperar la respuesta para
            // poder decir si se guardó, y un fallo tiene que llegarle en vez de
            // morir en un rechazo sin dueño.
            onSincronizar={puedeEditar ? (ms) => sincronizar(viendo.id, ms) : undefined}
          />
        </Sheet>
      )}
    </section>
  );
};

export default WarVods;
