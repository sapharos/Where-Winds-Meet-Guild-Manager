import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../services/authService';
import {
  EVENT_ANSWER_LABELS,
  EVENT_KINDS,
  EVENT_KIND_ICONS,
  EVENT_KIND_LABELS,
  EventAnswer,
  EventKind,
  DiscordRole,
  GuildEvent,
  Player,
  REMINDER_MODES,
  REMINDER_MODE_HINTS,
  REMINDER_MODE_LABELS,
  ReminderMode,
  respuestasDe,
} from '../types';
import Sheet from './Sheet';

/**
 * La agenda del gremio.
 *
 * Lo que se viene, quién dijo que va, y un sitio donde contestar sin que haga
 * falta Discord. La misma respuesta que escribe el bot: la fila es del miembro,
 * no del mensaje, así que contestar aquí es contestar allí.
 *
 * Se abre por lo que viene y no por lo que pasó, y lo pasado no se borra: sirve
 * para saber con quién se cuenta de verdad, que no siempre es quien dijo que sí.
 */

/**
 * Las fechas, en el huso de quien mira.
 *
 * `toLocaleString` ya lo hacía -- el instante se guarda absoluto y el navegador
 * lo compone con la zona del sistema -- pero no lo decía, y una hora sin zona no
 * se puede comprobar: quien esté en España ve las dos y media de la madrugada y
 * no tiene forma de saber si es su hora o si el sitio está equivocado. Con
 * `timeZoneName` cada fecha lleva de dónde es, y deja de haber nada que suponer.
 */
const fechaLarga = (iso: string) =>
  new Date(iso).toLocaleString('es', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleString('es', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

/** Cómo se llama el huso de quien mira, para decirlo donde se escribe una hora. */
const miHuso = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Para el `datetime-local`, que quiere hora local sin zona ni segundos. */
function paraCampo(iso?: string | null) {
  const d = iso ? new Date(iso) : new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

const ORDEN: EventAnswer[] = ['yes', 'maybe', 'no'];

/**
 * Las listas que se enseñan: las que se ofrecen, más cualquiera que alguien
 * haya contestado.
 *
 * Una guerra de antes del cambio tiene sus «tal vez» guardados, y dejar de
 * pintar la lista los borraría de la vista sin borrarlos de ningún sitio: el
 * recuento no cuadraría y a esa gente habría que ir a buscarla sin saber que
 * falta. Se enseña lo que hay, se ofrece lo que se pregunta.
 */
const mostradas = (event: GuildEvent): EventAnswer[] => {
  const ofrecidas = respuestasDe(event.kind);
  // En la lista sólo llegan los recuentos; en el detalle, las respuestas.
  const dadas = event.responses
    ? new Set(event.responses.map((r) => r.answer))
    : new Set(ORDEN.filter((a) => (event[a] ?? 0) > 0));
  return ORDEN.filter((a) => ofrecidas.includes(a) || dadas.has(a));
};

/** Los días de la semana empezando en lunes, que es como se lee un calendario. */
const CABECERA = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/** El lunes de la semana en la que cae un día. */
function lunesDe(fecha: Date) {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  // getDay da 0 el domingo; se quiere que el domingo cierre la semana.
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

const mismoDia = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const TONO: Record<EventAnswer, string> = {
  yes: 'bg-emerald-700 text-white',
  maybe: 'bg-staple text-white',
  no: 'bg-slate-800 text-slate-300',
};

const TONO_APAGADO: Record<EventAnswer, string> = {
  yes: 'border-emerald-700 text-emerald-400',
  maybe: 'border-staple text-staple',
  no: 'border-slate-700 text-slate-400',
};

interface Props {
  players: Player[];
  /** La ficha de quien está mirando, si tiene una. Sin ella no puede contestar. */
  myPlayerId?: string | null;
  canManage: boolean;
  /**
   * Si puede reiniciar una encuesta, que es permiso aparte de programar: no se
   * deshace, y de fábrica llega hasta sublíder.
   */
  canReset?: boolean;
}

/**
 * Los roles del servidor de Discord, para leerlos por su nombre.
 *
 * Un evento guarda ids, que es lo único que no envejece; el nombre y el color
 * se traen del servidor cada vez, así que un rol renombrado en Discord se lee
 * renombrado aquí sin tocar ninguna convocatoria.
 *
 * Un id que ya no está en la lista se enseña tal cual: es un rol borrado, y
 * decirlo con su número es más honesto que callarlo.
 */
const nombreDeRol = (id: string, roles: DiscordRole[]) =>
  roles.find((r) => r.id === id)?.name ?? `rol ${id}`;

const listaDeRoles = (ids: string[], roles: DiscordRole[]) =>
  ids.map((id) => nombreDeRol(id, roles)).join(', ');

const Agenda: React.FC<Props> = ({ players, myPlayerId, canManage, canReset = false }) => {
  // Los roles del servidor de Discord: quien programa los elige y todo el mundo
  // los lee, porque una convocatoria guarda ids y el nombre hay que ir a
  // buscarlo. Sin bot llega vacío y todo lo demás sigue igual.
  const [rolesDiscord, setRolesDiscord] = useState<DiscordRole[]>([]);
  const [events, setEvents] = useState<GuildEvent[] | null>(null);
  const [past, setPast] = useState(false);
  /** Lista de lo que viene, o el mes entero. */
  const [vista, setVista] = useState<'lista' | 'mes'>('lista');
  const [mes, setMes] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [diaElegido, setDiaElegido] = useState<Date | null>(null);
  const [abierto, setAbierto] = useState<GuildEvent | null>(null);
  const [editando, setEditando] = useState<Partial<GuildEvent> | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Lo último que se hizo y salió bien, para decirlo sin gastar un diálogo. */
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      // El calendario pide su mes -- y un poco más, porque la cuadrícula enseña
      // los días de los meses vecinos que completan la primera y la última
      // semana, y un evento en esos días también se ve.
      let ruta = `/events${past ? '?past=true' : ''}`;
      if (vista === 'mes') {
        const desde = lunesDe(new Date(mes.getFullYear(), mes.getMonth(), 1));
        const hasta = new Date(desde);
        hasta.setDate(desde.getDate() + 42);
        ruta = `/events?from=${desde.toISOString()}&to=${hasta.toISOString()}`;
      }
      setEvents(await api<GuildEvent[]>(ruta));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la agenda');
      setEvents([]);
    }
  }, [past, vista, mes]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    void api<{ roles: DiscordRole[] }>('/events/config/roles')
      .then((r) => setRolesDiscord(r.roles ?? []))
      // Sin bot no hay roles que ofrecer, y no es un error que enseñar: el
      // formulario lo dice en su sitio y todo lo demás sigue funcionando.
      .catch(() => setRolesDiscord([]));
  }, []);

  /** Refresca la lista y, si hay una hoja abierta, también lo que enseña. */
  const tras = async (actualizado?: GuildEvent) => {
    if (actualizado) setAbierto(actualizado);
    await cargar();
  };

  const contestar = async (event: GuildEvent, answer: EventAnswer) => {
    setError(null);
    try {
      const actualizado = await api<GuildEvent>(`/events/${event.id}/response`, {
        method: 'PUT',
        body: JSON.stringify({ answer }),
      });
      await tras(actualizado);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar tu respuesta');
    }
  };

  const guardar = async (borrador: Partial<GuildEvent>) => {
    setError(null);
    try {
      const guardado = await api<GuildEvent>(borrador.id ? `/events/${borrador.id}` : '/events', {
        method: borrador.id ? 'PUT' : 'POST',
        body: JSON.stringify(borrador),
      });
      setEditando(null);
      await tras(abierto ? guardado : undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el evento');
    }
  };

  const reiniciar = async (event: GuildEvent) => {
    setError(null);
    setAviso(null);
    try {
      const { borradas, ...actualizado } = await api<GuildEvent & { borradas: number }>(
        `/events/${event.id}/reset`,
        { method: 'POST' },
      );
      await tras(actualizado as GuildEvent);
      setAviso(
        borradas === 0
          ? 'La encuesta ya estaba vacía.'
          : `Encuesta reiniciada: se borraron ${borradas} ${borradas === 1 ? 'respuesta' : 'respuestas'}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo reiniciar la encuesta');
    }
  };

  const cancelar = async (event: GuildEvent) => {
    const actualizado = await api<GuildEvent>(`/events/${event.id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ cancelled: !event.cancelledAt }),
    }).catch(() => null);
    if (actualizado) await tras(actualizado);
  };

  const miRespuesta = (event: GuildEvent) =>
    event.responses?.find((r) => r.playerId === myPlayerId);

  /** Abrir un evento pide su detalle: la lista no trae las respuestas. */
  const abrir = async (id: string) => {
    try {
      setAbierto(await api<GuildEvent>(`/events/${id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir el evento');
    }
  };

  const delDiaElegido = diaElegido
    ? (events ?? []).filter((e) => mismoDia(new Date(e.startsAt), diaElegido))
    : [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="cinzel text-2xl font-bold text-amber-500">Agenda</h2>
          <p className="text-meta text-slate-500">
            Lo que viene y quién ha dicho que va. Las horas están en la tuya ({miHuso()}).
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {/* Dos formas de mirar lo mismo: la lista contesta «qué viene» y el
              mes contesta «cómo queda la semana del 20». */}
          <div className="flex rounded-md border border-slate-700 overflow-hidden">
            {(['lista', 'mes'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setVista(v)}
                aria-pressed={vista === v}
                className={`min-h-tap px-4 transition-colors duration-micro ${
                  vista === v ? 'bg-amber-700 text-white' : 'text-slate-300'
                }`}
              >
                <i className={`fa-solid ${v === 'lista' ? 'fa-list' : 'fa-calendar-days'} mr-2`}></i>
                {v === 'lista' ? 'Lista' : 'Mes'}
              </button>
            ))}
          </div>

          {vista === 'lista' && (
            <button
              onClick={() => setPast(!past)}
              className={`min-h-tap px-4 rounded-md border transition-colors duration-micro ${
                past ? 'border-amber-700 text-amber-500' : 'border-slate-700 text-slate-300'
              }`}
            >
              <i className="fa-solid fa-clock-rotate-left mr-2"></i>
              {past ? 'Ocultar lo pasado' : 'Ver lo pasado'}
            </button>
          )}
          {canManage && (
            <button
              onClick={() =>
                setEditando({ kind: 'war', title: '', minutes: 150, allowedRoles: [] })
              }
              className="min-h-tap px-4 rounded-md bg-amber-600 hover:bg-amber-500 text-white font-bold transition-colors duration-micro"
            >
              <i className="fa-solid fa-plus mr-2"></i>
              Programar
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-400 border border-red-900 bg-red-950/40 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {/* Cuántas respuestas se llevó por delante un reinicio. Se dice el número
          porque «hecho» no distingue haber tirado cincuenta de no haber tirado
          nada, y es justo lo que se quiere saber después de pulsar. */}
      {aviso && (
        <p className="text-sm text-emerald-400 border border-emerald-900 bg-emerald-950/40 rounded-md px-3 py-2">
          {aviso}
        </p>
      )}

      {vista === 'mes' ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))}
              aria-label="Mes anterior"
              className="min-h-tap min-w-tap rounded-md border border-slate-700 text-slate-300"
            >
              <i className="fa-solid fa-chevron-left"></i>
            </button>
            <div className="text-center min-w-0">
              {/* `first-letter` y no `capitalize`: en español el mes va en
                  minúscula y el segundo pone mayúscula a cada palabra, así que
                  salía «Agosto De 2026». */}
              <p className="cinzel text-xl font-bold text-slate-100 first-letter:uppercase truncate">
                {mes.toLocaleDateString('es', { month: 'long', year: 'numeric' })}
              </p>
              <button
                onClick={() => {
                  const d = new Date();
                  setMes(new Date(d.getFullYear(), d.getMonth(), 1));
                  setDiaElegido(d);
                }}
                className="text-meta text-amber-500 tap-suelto"
              >
                Ir a hoy
              </button>
            </div>
            <button
              onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))}
              aria-label="Mes siguiente"
              className="min-h-tap min-w-tap rounded-md border border-slate-700 text-slate-300"
            >
              <i className="fa-solid fa-chevron-right"></i>
            </button>
          </div>

          <Calendario
            mes={mes}
            events={events ?? []}
            elegido={diaElegido}
            onElegir={(d) => setDiaElegido(d)}
          />

          {diaElegido && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
                {diaElegido.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
              {delDiaElegido.length === 0 ? (
                <p className="text-meta text-slate-600">Nada ese día.</p>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {delDiaElegido.map((event) => (
                    <TarjetaEvento
                      key={event.id}
                      event={event}
                      onAbrir={() => abrir(event.id)}
                      canManage={canManage}
                      rolesDiscord={rolesDiscord}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : events === null ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : events.length === 0 ? (
        <div className="text-center py-12 px-4">
          <i className="fa-regular fa-calendar text-3xl text-slate-700"></i>
          <p className="text-sm text-slate-400 mt-3">
            No hay nada programado{past ? '' : ' por delante'}.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {events.map((event, at) => (
            <div key={event.id} className="entra" style={{ '--paso': Math.min(at, 6) } as React.CSSProperties}>
              <TarjetaEvento
                event={event}
                onAbrir={() => abrir(event.id)}
                canManage={canManage}
                rolesDiscord={rolesDiscord}
              />
            </div>
          ))}
        </div>
      )}

      {abierto && (
        <Sheet
          title={abierto.title}
          subtitle={`${EVENT_KIND_LABELS[abierto.kind]} · ${fechaLarga(abierto.startsAt)}`}
          size="lg"
          onClose={() => setAbierto(null)}
        >
          <DetalleEvento
            event={abierto}
            players={players}
            myPlayerId={myPlayerId}
            canManage={canManage}
            miRespuesta={miRespuesta(abierto)?.answer}
            rolesDiscord={rolesDiscord}
            onContestar={(answer) => contestar(abierto, answer)}
            onContestarPor={async (playerId, answer) => {
              const actualizado = await api<GuildEvent>(
                `/events/${abierto.id}/responses/${playerId}`,
                { method: 'PUT', body: JSON.stringify({ answer }) },
              );
              await tras(actualizado);
            }}
            onEditar={() => setEditando(abierto)}
            onCancelar={() => cancelar(abierto)}
            canReset={canReset}
            onReiniciar={() => reiniciar(abierto)}
            onPublicar={async () => {
              setError(null);
              try {
                await tras(
                  await api<GuildEvent>(`/events/${abierto.id}/publish`, { method: 'POST' }),
                );
              } catch (err) {
                setError(err instanceof Error ? err.message : 'No se pudo publicar');
              }
            }}
          />
        </Sheet>
      )}

      {editando && (
        <FormularioEvento
          borrador={editando}
          rolesDiscord={rolesDiscord}
          onGuardar={guardar}
          onCerrar={() => setEditando(null)}
        />
      )}
    </div>
  );
};

/**
 * Un evento en una tarjeta. La usan la lista y el día elegido del calendario,
 * y por eso vive suelta: las dos vistas tienen que decir lo mismo del mismo
 * evento, y dos copias del mismo bloque acaban diciendo cosas distintas.
 */
const TarjetaEvento: React.FC<{
  event: GuildEvent;
  onAbrir: () => void;
  /** Enseña «sin publicar», que sólo le sirve a quien puede publicarlo. */
  canManage?: boolean;
  rolesDiscord: DiscordRole[];
}> = ({ event, onAbrir, canManage = false, rolesDiscord }) => (
  <button
    onClick={onAbrir}
    className={`w-full text-left h-full p-3 rounded-lg border bg-slate-900 transition-colors duration-micro hover:border-slate-700 ${
      event.cancelledAt ? 'border-slate-800 opacity-60' : 'border-slate-800'
    }`}
  >
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded flex items-center justify-center shrink-0 bg-slate-800 text-slate-300">
        <i className={`fa-solid ${EVENT_KIND_ICONS[event.kind]}`}></i>
      </div>
      <div className="min-w-0 grow">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className={`font-bold text-slate-100 truncate ${event.cancelledAt ? 'line-through' : ''}`}>
            {event.title}
          </h3>
          {event.cancelledAt && (
            <span className="text-[11px] leading-none px-1.5 py-[3px] rounded border border-red-700 text-red-400 uppercase font-bold tracking-tighter shrink-0">
              cancelado
            </span>
          )}
        </div>
        <p className="text-meta text-slate-400 truncate">
          {EVENT_KIND_LABELS[event.kind]} · {fechaLarga(event.startsAt)}
          {event.allowedRoles?.length ? ` · sólo ${listaDeRoles(event.allowedRoles, rolesDiscord)}` : ''}
        </p>
      </div>
    </div>

    <div className="flex items-center gap-2 mt-2 pl-11 flex-wrap">
      {mostradas(event).map((answer) => (
        <span
          key={answer}
          className={`text-[11px] leading-none px-1.5 py-[3px] rounded border uppercase font-bold tracking-tighter ${TONO_APAGADO[answer]}`}
        >
          {EVENT_ANSWER_LABELS[answer]} {event[answer] ?? 0}
        </span>
      ))}

      {/* Si la encuesta ya salió al canal. Publicada lo ve todo el mundo --
          saber si el bot ya avisó es de todos--; «sin publicar» sólo quien
          puede publicarla, que para el resto sería una queja sin botón. */}
      {event.discordMessageId ? (
        <span className="text-[11px] leading-none px-1.5 py-[3px] rounded border border-indigo-700 text-indigo-300 uppercase font-bold tracking-tighter">
          <i className="fa-brands fa-discord mr-1"></i>
          publicada
        </span>
      ) : canManage && !event.cancelledAt ? (
        <span className="text-[11px] leading-none px-1.5 py-[3px] rounded border border-slate-700 text-slate-500 uppercase font-bold tracking-tighter">
          sin publicar
        </span>
      ) : null}
    </div>
  </button>
);

/**
 * El mes, en una cuadrícula.
 *
 * Una celda enseña lo que cabe: en un teléfono, un punto por evento -- siete
 * columnas en 375 px no dan para un título -- y a partir de `sm`, el nombre. Y
 * el día se elige, en vez de abrirse el evento al tocar el punto: un punto de
 * ocho píxeles no es un objetivo, y la fila de abajo tiene sitio para decir de
 * qué evento se trata antes de meterse en él.
 */
const Calendario: React.FC<{
  mes: Date;
  events: GuildEvent[];
  elegido: Date | null;
  onElegir: (dia: Date) => void;
}> = ({ mes, events, elegido, onElegir }) => {
  const primero = new Date(mes.getFullYear(), mes.getMonth(), 1);
  const desde = lunesDe(primero);
  const hoy = new Date();

  // Seis semanas siempre: con cinco, un mes que empieza en domingo se sale, y
  // con un número variable la cuadrícula cambia de alto al pasar de mes.
  const dias = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(desde);
    d.setDate(desde.getDate() + i);
    return d;
  });

  const delDia = (d: Date) => events.filter((e) => mismoDia(new Date(e.startsAt), d));

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
      <div className="grid grid-cols-7 border-b border-slate-800">
        {CABECERA.map((d, i) => (
          <div
            key={d}
            className={`text-center text-[11px] uppercase tracking-wider py-2 ${
              i >= 5 ? 'text-amber-600' : 'text-slate-500'
            }`}
          >
            {d}
          </div>
        ))}
      </div>

      {/* El alto va en las filas y no en cada celda: una celda es un `button`,
          y el suelo de 44 px que la base le pone a todo botón gana por
          especificidad a una clase de utilidad -- `min-h-[64px]` se escribía y
          no hacía nada. Puesto aquí, además, dice lo que se quiere decir: que
          todas las semanas midan lo mismo. */}
      <div className="grid grid-cols-7 auto-rows-[64px] sm:auto-rows-[100px]">
        {dias.map((d) => {
          const suyos = delDia(d);
          const deEsteMes = d.getMonth() === mes.getMonth();
          const esHoy = mismoDia(d, hoy);
          const esElegido = elegido && mismoDia(d, elegido);

          return (
            <button
              key={d.toISOString()}
              onClick={() => onElegir(d)}
              aria-current={esHoy ? 'date' : undefined}
              className={`overflow-hidden p-1.5 text-left border-b border-r border-slate-800 transition-colors duration-micro ${
                deEsteMes ? '' : 'opacity-35'
              } ${esElegido ? 'bg-slate-800' : 'hover:bg-slate-800/50'}`}
            >
              <span
                className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] tabular-nums ${
                  esHoy ? 'bg-amber-600 text-white font-bold' : 'text-slate-400'
                }`}
              >
                {d.getDate()}
              </span>

              {/* En pantalla pequeña, un punto por evento. */}
              <span className="sm:hidden flex flex-wrap gap-1 mt-1">
                {suyos.map((e) => (
                  <span
                    key={e.id}
                    aria-hidden
                    className={`w-1.5 h-1.5 rounded-full ${
                      e.cancelledAt ? 'bg-slate-600' : 'bg-amber-500'
                    }`}
                  />
                ))}
              </span>

              {/* Y a partir de sm, su nombre. */}
              <span className="hidden sm:block mt-1 space-y-0.5">
                {suyos.slice(0, 3).map((e) => (
                  <span
                    key={e.id}
                    className={`block text-[11px] leading-tight truncate rounded px-1 py-0.5 ${
                      e.cancelledAt
                        ? 'text-slate-500 line-through bg-slate-950'
                        : 'text-slate-200 bg-slate-800'
                    }`}
                  >
                    {e.title}
                  </span>
                ))}
                {suyos.length > 3 && (
                  <span className="block text-[10px] text-slate-500">+{suyos.length - 3} más</span>
                )}
              </span>

              {/* Lo que el punto no dice, para quien no ve el color. */}
              {suyos.length > 0 && (
                <span className="sr-only">
                  {suyos.length === 1 ? '1 evento' : `${suyos.length} eventos`}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ detalle */

const DetalleEvento: React.FC<{
  event: GuildEvent;
  players: Player[];
  myPlayerId?: string | null;
  canManage: boolean;
  miRespuesta?: EventAnswer;
  rolesDiscord: DiscordRole[];
  onContestar: (answer: EventAnswer) => void;
  onContestarPor: (playerId: string, answer: EventAnswer) => void;
  onEditar: () => void;
  onCancelar: () => void;
  onPublicar: () => void;
  canReset: boolean;
  onReiniciar: () => void;
}> = ({
  event,
  players,
  myPlayerId,
  canManage,
  miRespuesta,
  rolesDiscord,
  onContestar,
  onContestarPor,
  onEditar,
  onCancelar,
  onPublicar,
  canReset,
  onReiniciar,
}) => {
  // Lo decide el servidor, que es quien sabe qué roles lleva cada uno en
  // Discord. Sin campo -- un detalle traído antes de que esto existiera -- se
  // supone que sí, que es como se comportaba hasta ahora.
  const invitado = event.mayAnswer !== false;
  // Reiniciar no se deshace y borra el trabajo de treinta personas, así que
  // pide pulsar dos veces. El segundo botón dice lo que va a pasar y cuánto
  // cuesta -- no «¿seguro?», que no informa de nada.
  const [confirmando, setConfirmando] = useState(false);
  const contestadas = (event.responses ?? []).length;

  const porRespuesta = (answer: EventAnswer) =>
    (event.responses ?? []).filter((r) => r.answer === answer);

  // Quién no ha dicho nada. Es la lista que de verdad hace falta el viernes:
  // los que dijeron que no ya están contados, y a estos hay que ir a buscarlos.
  const sinContestar = players.filter(
    (p) => p.isActive !== false && !(event.responses ?? []).some((r) => r.playerId === p.id),
  );

  const cerrada = Boolean(event.closesAt && new Date() > new Date(event.closesAt));

  return (
    <div className="space-y-5">
      {event.notes && <p className="text-sm text-slate-300 whitespace-pre-line">{event.notes}</p>}

      {event.closesAt && (
        <p className="text-meta text-slate-500">
          <i className="fa-regular fa-clock mr-1.5"></i>
          {cerrada
            ? `Se cerró el ${fechaCorta(event.closesAt)}.`
            : `Se puede contestar hasta el ${fechaCorta(event.closesAt)}.`}
        </p>
      )}

      {/* Si la encuesta salió al canal, y por dónde. El enlace lleva al mensaje
          mismo, que es lo que hace falta cuando se quiere comprobar que está o
          mandárselo a alguien. */}
      <p className="text-meta text-slate-500">
        <i className="fa-brands fa-discord mr-1.5"></i>
        {event.discordMessageId ? (
          <>
            Publicada en Discord.{' '}
            {event.discordUrl && (
              <a
                href={event.discordUrl}
                target="_blank"
                rel="noreferrer"
                className="text-amber-500 underline tap-suelto"
              >
                Ver el mensaje
              </a>
            )}
          </>
        ) : (
          'Todavía no se ha publicado en Discord.'
        )}
      </p>

      {/* Publicada donde ya nadie mira. No se rompe nada -- los botones de ese
          mensaje siguen sabiendo de qué evento son -- pero conviene rehacerla. */}
      {event.discordStale && (
        <p className="text-meta text-amber-500 border border-amber-800 bg-amber-950/30 rounded-md px-3 py-2">
          <i className="fa-solid fa-triangle-exclamation mr-1.5"></i>
          Está publicada en un canal que ya no es el de la agenda. Vuelve a publicarla para llevarla
          al canal actual.
        </p>
      )}

      {/* A quién se le pregunta. Sólo se dice cuando hay a quién dejar fuera:
          lo normal es que no haya lista y entonces no hay nada que advertir. */}
      {event.allowedRoles?.length > 0 && (
        <p className="text-meta text-slate-500 flex items-center gap-1.5 flex-wrap">
          <i className="fa-brands fa-discord"></i>
          Abierta a
          {event.allowedRoles.map((id) => (
            <ChapaRol key={id} id={id} roles={rolesDiscord} />
          ))}
        </p>
      )}

      {/* Cómo se le va a recordar a quien no conteste. Sólo lo ve quien
          organiza: para el resto es una promesa de que le van a dar la lata, y
          quien la programa necesita poder comprobarla sin abrir el formulario. */}
      {canManage && (
        <p className="text-meta text-slate-500">
          <i
            className={`fa-solid ${
              event.reminderMode === 'dm'
                ? 'fa-envelope'
                : event.reminderMode === 'none'
                  ? 'fa-bell-slash'
                  : 'fa-hashtag'
            } mr-1.5`}
          ></i>
          {event.reminderMode === 'none'
            ? 'Sin recordatorios.'
            : `Se recuerda ${event.reminderMode === 'dm' ? 'por privado' : 'en el canal'} ${
                event.reminderEveryDays && event.reminderTime
                  ? `cada ${event.reminderEveryDays === 1 ? 'día' : `${event.reminderEveryDays} días`} a las ${event.reminderTime}`
                  : 'una vez, seis horas antes de que cierre'
              }.`}
        </p>
      )}

      {myPlayerId && !event.cancelledAt && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Tu respuesta</p>
          {invitado ? (
            <div className="flex gap-2 flex-wrap">
              {respuestasDe(event.kind).map((answer) => (
                <button
                  key={answer}
                  disabled={cerrada}
                  onClick={() => onContestar(answer)}
                  className={`min-h-tap px-4 rounded-md border font-bold transition-colors duration-micro disabled:opacity-40 ${
                    miRespuesta === answer ? TONO[answer] : `bg-slate-950 ${TONO_APAGADO[answer]}`
                  }`}
                >
                  {EVENT_ANSWER_LABELS[answer]}
                </button>
              ))}
            </div>
          ) : (
            // Los botones no se enseñan apagados: no es que no se pueda ahora,
            // es que la pregunta no es para estos roles. Los dos motivos se
            // arreglan de formas distintas, y por eso se dicen distintos.
            <p className="text-meta text-slate-500">
              {event.discordLinked === false
                ? 'No encuentro tu cuenta en el servidor de Discord, así que no puedo comprobar tus roles. Vincúlala desde tu perfil y vuelve a entrar.'
                : 'Esta convocatoria no está abierta a tus roles de Discord. Puedes verla, pero no votar.'}
            </p>
          )}
        </div>
      )}

      {mostradas(event).map((answer) => {
        const suyos = porRespuesta(answer);
        return (
          <div key={answer}>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
              {EVENT_ANSWER_LABELS[answer]} · {suyos.length}
            </p>
            {suyos.length === 0 ? (
              <p className="text-meta text-slate-600">Nadie.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {suyos.map((r) => (
                  <span
                    key={r.playerId}
                    className="text-meta text-slate-200 bg-slate-950 border border-slate-800 rounded-md px-2 py-1"
                    title={r.answeredBy ? 'Lo anotó un oficial' : undefined}
                  >
                    {r.name}
                    {r.answeredBy && <i className="fa-solid fa-pen text-[9px] text-slate-600 ml-1.5"></i>}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {canManage && sinContestar.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
            Sin contestar · {sinContestar.length}
          </p>
          <div className="space-y-1">
            {sinContestar.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-2 justify-between bg-slate-950 border border-slate-800 rounded-md px-2 py-1"
              >
                <span className="text-meta text-slate-300 truncate">{p.name}</span>
                <div className="flex gap-1 shrink-0">
                  {respuestasDe(event.kind).map((answer) => (
                    <button
                      key={answer}
                      onClick={() => onContestarPor(p.id, answer)}
                      className={`text-[11px] px-2 py-1 rounded border transition-colors duration-micro tap-suelto ${TONO_APAGADO[answer]}`}
                    >
                      {EVENT_ANSWER_LABELS[answer]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {canManage && (
        <div className="pt-3 border-t border-slate-800 flex gap-2 flex-wrap">
          {/* Publicar es un acto y no una consecuencia de guardar: un evento se
              crea, se corrige y se mira antes de convocar a nadie. */}
          <button
            onClick={onPublicar}
            disabled={Boolean(event.cancelledAt)}
            title={[
              event.discordMessageId
                ? 'Manda un mensaje nuevo al canal actual y retira el anterior. Las respuestas no se tocan.'
                : null,
              event.allowedRoles?.length
                ? 'Les suena a los roles convocados, y sólo a ellos.'
                : 'No avisa a nadie: la encuesta queda en el canal para quien lo mire.',
            ]
              .filter(Boolean)
              .join(' ')}
            className={`min-h-tap px-4 rounded-md border transition-colors duration-micro disabled:opacity-40 ${
              event.discordStale
                ? 'border-amber-600 text-amber-400'
                : 'border-indigo-700 text-indigo-300'
            }`}
          >
            <i className="fa-brands fa-discord mr-2"></i>
            {event.discordMessageId ? 'Volver a publicar' : 'Publicar en Discord'}
          </button>
          <button
            onClick={onEditar}
            className="min-h-tap px-4 rounded-md border border-slate-700 text-slate-200 transition-colors duration-micro"
          >
            <i className="fa-solid fa-pen-to-square mr-2"></i>
            Editar
          </button>
          <button
            onClick={onCancelar}
            className={`min-h-tap px-4 rounded-md border transition-colors duration-micro ${
              event.cancelledAt
                ? 'border-emerald-700 text-emerald-400'
                : 'border-red-800 text-red-400'
            }`}
          >
            <i className={`fa-solid ${event.cancelledAt ? 'fa-rotate-left' : 'fa-ban'} mr-2`}></i>
            {event.cancelledAt ? 'Reactivar' : 'Cancelar evento'}
          </button>

          {/* Empezar la encuesta de cero. Cuando lo que se preguntó cambia
              debajo de las respuestas -- otra hora, otros roles -- lo guardado
              deja de decir lo que parece que dice. */}
          {canReset && (
            <button
              onClick={() => {
                if (!confirmando) return setConfirmando(true);
                setConfirmando(false);
                onReiniciar();
              }}
              onBlur={() => setConfirmando(false)}
              title="Borra todo lo contestado y deja el evento en pie. No se deshace."
              className={`min-h-tap px-4 rounded-md border transition-colors duration-micro ${
                confirmando
                  ? 'border-red-600 bg-red-950 text-red-300 font-bold'
                  : 'border-slate-700 text-slate-300'
              }`}
            >
              <i className="fa-solid fa-arrow-rotate-left mr-2"></i>
              {confirmando
                ? contestadas === 0
                  ? 'Sí, reiniciar'
                  : `Sí, borrar ${contestadas} ${contestadas === 1 ? 'respuesta' : 'respuestas'}`
                : 'Reiniciar encuesta'}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/* ---------------------------------------------------------- quién contesta */

/**
 * Un rol de Discord como se lee: con su nombre y su color.
 *
 * Discord tiñe el nombre con el color del rol, no el fondo, y aquí se hace lo
 * mismo para que un rol se reconozca de un vistazo por lo mismo por lo que se
 * reconoce allí. Sin color -- que en Discord es gris -- se queda con el gris de
 * la interfaz.
 */
const ChapaRol: React.FC<{ id: string; roles: DiscordRole[] }> = ({ id, roles }) => {
  const rol = roles.find((r) => r.id === id);
  return (
    <span
      className="inline-flex items-center text-[11px] leading-none px-1.5 py-[3px] rounded border border-slate-700 bg-slate-950 font-bold"
      style={rol?.color ? { color: rol.color, borderColor: rol.color } : undefined}
    >
      @{rol?.name ?? id}
    </span>
  );
};

/**
 * A qué roles de Discord se les pregunta.
 *
 * Ninguno marcado es «a todo el gremio», que es lo que quiere casi siempre y
 * por eso es lo que sale de fábrica.
 *
 * No hay atajo de «marcarlos todos»: la lista de roles de un servidor cambia
 * sola -- alguien crea uno el martes -- y una convocatoria que los tuviera
 * todos escritos se quedaría cerrada al nuevo sin que nadie lo decidiera. Para
 * eso está el vacío.
 */
const RolesQuePueden: React.FC<{
  seleccionados: string[];
  roles: DiscordRole[];
  onCambiar: (roles: string[]) => void;
}> = ({ seleccionados, roles, onCambiar }) => (
  <div>
    <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">
      Quién puede votar
    </label>
    {roles.length === 0 ? (
      <p className="text-meta text-slate-500">
        No puedo leer los roles del servidor de Discord. Comprueba en Administración que el bot está
        configurado; mientras tanto la encuesta queda abierta a todo el gremio.
      </p>
    ) : (
      <>
        <div className="flex flex-wrap gap-2">
          {roles.map((rol) => {
            const marcado = seleccionados.includes(rol.id);
            return (
              <button
                key={rol.id}
                type="button"
                aria-pressed={marcado}
                onClick={() =>
                  onCambiar(
                    marcado
                      ? seleccionados.filter((r) => r !== rol.id)
                      // Se guardan en el orden del servidor y no en el de las
                      // pulsaciones: la lista se lee tal cual en la agenda.
                      : roles.filter((r) => r.id === rol.id || seleccionados.includes(r.id)).map((r) => r.id),
                  )
                }
                className={`min-h-tap px-3 rounded-md border text-sm font-bold transition-colors duration-micro ${
                  marcado ? 'bg-slate-800 border-slate-600' : 'bg-slate-950 border-slate-800'
                }`}
                style={
                  rol.color
                    ? { color: rol.color, borderColor: marcado ? rol.color : undefined }
                    : undefined
                }
              >
                <i className={`fa-solid ${marcado ? 'fa-check' : 'fa-minus'} mr-2 text-[10px]`}></i>
                @{rol.name}
              </button>
            );
          })}
        </div>
        <p className="text-meta text-slate-500 mt-1">
          {seleccionados.length === 0
            ? 'Sin marcar nada, la encuesta es para todo el gremio y al publicarla no se avisa a nadie.'
            : `Sólo contestan quienes tengan ${listaDeRoles(seleccionados, roles)} en Discord. Los demás la ven, pero no votan, y al publicarla les suena sólo a ellos.`}
        </p>
      </>
    )}
  </div>
);

/* ------------------------------------------------------------ el recordatorio */

/**
 * Cómo se le recuerda la encuesta a quien no ha contestado.
 *
 * Dos decisiones y no una: por dónde llega, y cada cuánto. La segunda es
 * opcional a propósito -- lo normal es un solo aviso poco antes de que cierre, y
 * repetir cada día tiene sentido en una encuesta que lleva la semana abierta.
 */
const ComoRecordar: React.FC<{
  modo: ReminderMode;
  cada: number | null;
  hora: string;
  onCambiar: (cambio: { reminderMode?: ReminderMode; reminderEveryDays?: number | null; reminderTime?: string }) => void;
}> = ({ modo, cada, hora, onCambiar }) => {
  const campo = 'w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500';
  // Los dos van juntos: el servidor descarta una cadencia sin hora, así que
  // encender la repetición propone una hora en vez de guardar algo a medias.
  const repite = Boolean(cada && hora);

  return (
    <div>
      <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">
        Cómo recordarlo
      </label>
      <div className="flex flex-wrap gap-2">
        {REMINDER_MODES.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={modo === m}
            onClick={() => onCambiar({ reminderMode: m })}
            className={`min-h-tap px-3 rounded-md border text-sm font-bold transition-colors duration-micro ${
              modo === m
                ? 'bg-amber-600 border-amber-500 text-white'
                : 'bg-slate-950 border-slate-700 text-slate-300'
            }`}
          >
            <i
              className={`fa-solid ${
                m === 'channel' ? 'fa-hashtag' : m === 'dm' ? 'fa-envelope' : 'fa-bell-slash'
              } mr-2 text-[10px]`}
            ></i>
            {REMINDER_MODE_LABELS[m]}
          </button>
        ))}
      </div>
      <p className="text-meta text-slate-500 mt-1">{REMINDER_MODE_HINTS[modo]}</p>

      {modo !== 'none' && (
        <div className="mt-3">
          <label className="flex items-center gap-2 min-h-tap cursor-pointer">
            <input
              type="checkbox"
              checked={repite}
              onChange={(e) =>
                onCambiar(
                  e.target.checked
                    ? { reminderEveryDays: cada ?? 1, reminderTime: hora || '19:00' }
                    : { reminderEveryDays: null, reminderTime: '' },
                )
              }
              className="w-4 h-4 accent-amber-600"
            />
            <span className="text-sm text-slate-300">Repetirlo cada tantos días</span>
          </label>

          {repite ? (
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">
                  Cada (días)
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={30}
                  className={campo}
                  value={cada ?? 1}
                  onChange={(e) =>
                    onCambiar({ reminderEveryDays: Math.min(30, Math.max(1, Number(e.target.value) || 1)) })
                  }
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">
                  A las
                </label>
                <input
                  type="time"
                  className={campo}
                  value={hora}
                  onChange={(e) => onCambiar({ reminderTime: e.target.value })}
                />
                {/* La hora es la del gremio y no la de quien programa: el
                    recordatorio sale del servidor, no de este navegador. */}
                <p className="text-meta text-slate-500 mt-1">Hora del gremio</p>
              </div>
            </div>
          ) : (
            <p className="text-meta text-slate-500 mt-1">
              Sin repetir, sale uno solo seis horas antes de que cierre la encuesta.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

/* -------------------------------------------------------------- formulario */

const FormularioEvento: React.FC<{
  borrador: Partial<GuildEvent>;
  rolesDiscord: DiscordRole[];
  onGuardar: (borrador: Partial<GuildEvent>) => void;
  onCerrar: () => void;
}> = ({ borrador, rolesDiscord, onGuardar, onCerrar }) => {
  const [datos, setDatos] = useState({
    id: borrador.id,
    kind: (borrador.kind ?? 'war') as EventKind,
    title: borrador.title ?? '',
    startsAt: paraCampo(borrador.startsAt),
    minutes: borrador.minutes ?? 150,
    notes: borrador.notes ?? '',
    allowedRoles: borrador.allowedRoles ?? [],
    reminderMode: (borrador.reminderMode ?? 'channel') as ReminderMode,
    reminderEveryDays: borrador.reminderEveryDays ?? null,
    reminderTime: borrador.reminderTime ?? '',
    opensAt: borrador.opensAt ? paraCampo(borrador.opensAt) : '',
    closesAt: borrador.closesAt ? paraCampo(borrador.closesAt) : '',
  });

  const campo = 'w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500';

  return (
    <Sheet
      title={borrador.id ? 'Editar evento' : 'Programar evento'}
      size="md"
      onClose={onCerrar}
      footer={
        <div className="flex gap-2 justify-end">
          <button onClick={onCerrar} className="min-h-tap px-4 rounded-md text-slate-300">
            Cancelar
          </button>
          <button
            onClick={() =>
              onGuardar({
                ...datos,
                // El campo da hora local; el servidor guarda el instante.
                startsAt: new Date(datos.startsAt).toISOString(),
                opensAt: datos.opensAt ? new Date(datos.opensAt).toISOString() : null,
                closesAt: datos.closesAt ? new Date(datos.closesAt).toISOString() : null,
              } as Partial<GuildEvent>)
            }
            className="min-h-tap px-4 rounded-md bg-amber-600 hover:bg-amber-500 text-white font-bold"
          >
            Guardar
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">Tipo</label>
          <select
            className={campo}
            value={datos.kind}
            onChange={(e) => setDatos({ ...datos, kind: e.target.value as EventKind })}
          >
            {EVENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {EVENT_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">Nombre</label>
          <input
            className={campo}
            value={datos.title}
            placeholder="Guerra del sábado"
            onChange={(e) => setDatos({ ...datos, title: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">Empieza</label>
            <input
              type="datetime-local"
              className={campo}
              value={datos.startsAt}
              onChange={(e) => setDatos({ ...datos, startsAt: e.target.value })}
            />
            {/* Quien programa escribe en su hora y a cada miembro se le enseña en
                la suya. Decirlo aquí es lo que evita el error de un oficial que
                está de viaje y cree estar escribiendo la hora del gremio. */}
            <p className="text-meta text-slate-500 mt-1">Tu hora ({miHuso()})</p>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">Dura (min)</label>
            <input
              type="number"
              inputMode="numeric"
              className={campo}
              value={datos.minutes}
              onChange={(e) => setDatos({ ...datos, minutes: Number(e.target.value) || 60 })}
            />
          </div>
        </div>

        <RolesQuePueden
          seleccionados={datos.allowedRoles}
          roles={rolesDiscord}
          onCambiar={(allowedRoles) => setDatos({ ...datos, allowedRoles })}
        />

        <ComoRecordar
          modo={datos.reminderMode}
          cada={datos.reminderEveryDays}
          hora={datos.reminderTime}
          onCambiar={(cambio) => setDatos({ ...datos, ...cambio })}
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">
              Se abre
            </label>
            <input
              type="datetime-local"
              className={campo}
              value={datos.opensAt}
              onChange={(e) => setDatos({ ...datos, opensAt: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">
              Se cierra
            </label>
            <input
              type="datetime-local"
              className={campo}
              value={datos.closesAt}
              onChange={(e) => setDatos({ ...datos, closesAt: e.target.value })}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">Notas</label>
          <textarea
            className={campo}
            rows={3}
            value={datos.notes}
            onChange={(e) => setDatos({ ...datos, notes: e.target.value })}
          />
        </div>
      </div>
    </Sheet>
  );
};

export default Agenda;
