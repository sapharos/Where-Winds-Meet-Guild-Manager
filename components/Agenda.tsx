import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../services/authService';
import {
  EVENT_ANSWER_LABELS,
  EVENT_KINDS,
  EVENT_KIND_ICONS,
  EVENT_KIND_LABELS,
  EventAnswer,
  EventKind,
  GuildEvent,
  Player,
  ROLE_LABELS,
  USER_ROLES,
  UserRole,
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
  /** Su rango. Decide si una convocatoria acotada le deja contestar. */
  myRole?: UserRole;
  canManage: boolean;
}

/**
 * Si a este rango se le pide que conteste.
 *
 * Sin lista, el gremio entero: no restringir es lo normal y es lo que había
 * antes de que esto existiera, así que las convocatorias ya guardadas siguen
 * abiertas a todos sin tocarlas. Gemelo de `puedeContestar` en server/events.js
 * -- aquí decide qué botones se enseñan, allí decide qué se guarda.
 */
const puedeContestar = (event: GuildEvent, rol?: UserRole) =>
  !event.allowedRoles?.length || (rol ? event.allowedRoles.includes(rol) : false);

// De más mando a menos, como el servidor los guarda: ordenar también aquí es
// lo que hace que la frase del formulario no cambie al guardar.
const listaDeRangos = (roles: UserRole[]) =>
  [...roles]
    .sort((a, b) => USER_ROLES.indexOf(a) - USER_ROLES.indexOf(b))
    .map((r) => ROLE_LABELS[r] ?? r)
    .join(', ');

const Agenda: React.FC<Props> = ({ players, myPlayerId, myRole, canManage }) => {
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
                    <TarjetaEvento key={event.id} event={event} onAbrir={() => abrir(event.id)} canManage={canManage} />
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
              <TarjetaEvento event={event} onAbrir={() => abrir(event.id)} canManage={canManage} />
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
            myRole={myRole}
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
}> = ({ event, onAbrir, canManage = false }) => (
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
          {event.allowedRoles?.length ? ` · sólo ${listaDeRangos(event.allowedRoles)}` : ''}
        </p>
      </div>
    </div>

    <div className="flex items-center gap-2 mt-2 pl-11 flex-wrap">
      {ORDEN.map((answer) => (
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
  myRole?: UserRole;
  onContestar: (answer: EventAnswer) => void;
  onContestarPor: (playerId: string, answer: EventAnswer) => void;
  onEditar: () => void;
  onCancelar: () => void;
  onPublicar: () => void;
}> = ({
  event,
  players,
  myPlayerId,
  canManage,
  miRespuesta,
  myRole,
  onContestar,
  onContestarPor,
  onEditar,
  onCancelar,
  onPublicar,
}) => {
  const invitado = puedeContestar(event, myRole);

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
        <p className="text-meta text-slate-500">
          <i className="fa-solid fa-user-shield mr-1.5"></i>
          Abierta a {listaDeRangos(event.allowedRoles)}.
        </p>
      )}

      {myPlayerId && !event.cancelledAt && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Tu respuesta</p>
          {invitado ? (
            <div className="flex gap-2 flex-wrap">
              {ORDEN.map((answer) => (
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
            // es que la pregunta no es para este rango.
            <p className="text-meta text-slate-500">
              Esta convocatoria no está abierta a tu rango. Puedes verla, pero no votar.
            </p>
          )}
        </div>
      )}

      {ORDEN.map((answer) => {
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
                  {ORDEN.map((answer) => (
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
            title={
              event.discordMessageId
                ? 'Manda un mensaje nuevo al canal actual y retira el anterior. Las respuestas no se tocan.'
                : undefined
            }
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
        </div>
      )}
    </div>
  );
};

/* ---------------------------------------------------------- quién contesta */

/**
 * A qué rangos se les pregunta.
 *
 * Ninguno marcado es «a todo el gremio», que es lo que quiere casi siempre y
 * por eso es lo que sale de fábrica. Marcarlos todos es lo mismo dicho de otra
 * forma, y el servidor lo guarda igual -- así una lista no se queda restringida
 * a cinco rangos que mañana podrían ser seis.
 */
const RangosQuePueden: React.FC<{
  roles: UserRole[];
  onCambiar: (roles: UserRole[]) => void;
}> = ({ roles, onCambiar }) => (
  <div>
    <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">
      Quién puede votar
    </label>
    <div className="flex flex-wrap gap-2">
      {USER_ROLES.map((role) => {
        const marcado = roles.includes(role);
        return (
          <button
            key={role}
            type="button"
            aria-pressed={marcado}
            onClick={() =>
              onCambiar(marcado ? roles.filter((r) => r !== role) : [...roles, role])
            }
            className={`min-h-tap px-3 rounded-md border text-sm font-bold transition-colors duration-micro ${
              marcado
                ? 'bg-amber-600 border-amber-500 text-white'
                : 'bg-slate-950 border-slate-700 text-slate-300'
            }`}
          >
            <i className={`fa-solid ${marcado ? 'fa-check' : 'fa-minus'} mr-2 text-[10px]`}></i>
            {ROLE_LABELS[role] ?? role}
          </button>
        );
      })}
    </div>
    <p className="text-meta text-slate-500 mt-1">
      {roles.length === 0 || roles.length === USER_ROLES.length
        ? 'Sin marcar nada, la encuesta es para todo el gremio.'
        : `Sólo contestan ${listaDeRangos(roles)}. Los demás la ven, pero no votan.`}
    </p>
  </div>
);

/* -------------------------------------------------------------- formulario */

const FormularioEvento: React.FC<{
  borrador: Partial<GuildEvent>;
  onGuardar: (borrador: Partial<GuildEvent>) => void;
  onCerrar: () => void;
}> = ({ borrador, onGuardar, onCerrar }) => {
  const [datos, setDatos] = useState({
    id: borrador.id,
    kind: (borrador.kind ?? 'war') as EventKind,
    title: borrador.title ?? '',
    startsAt: paraCampo(borrador.startsAt),
    minutes: borrador.minutes ?? 150,
    notes: borrador.notes ?? '',
    allowedRoles: borrador.allowedRoles ?? [],
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

        <RangosQuePueden
          roles={datos.allowedRoles}
          onCambiar={(allowedRoles) => setDatos({ ...datos, allowedRoles })}
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
