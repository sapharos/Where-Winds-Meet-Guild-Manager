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
  cuentaPartidas,
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

const fechaLarga = (iso: string) =>
  new Date(iso).toLocaleString('es', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });

const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Para el `datetime-local`, que quiere hora local sin zona ni segundos. */
function paraCampo(iso?: string | null) {
  const d = iso ? new Date(iso) : new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

const ORDEN: EventAnswer[] = ['yes', 'maybe', 'no'];

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
}

const Agenda: React.FC<Props> = ({ players, myPlayerId, canManage }) => {
  const [events, setEvents] = useState<GuildEvent[] | null>(null);
  const [past, setPast] = useState(false);
  const [abierto, setAbierto] = useState<GuildEvent | null>(null);
  const [editando, setEditando] = useState<Partial<GuildEvent> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setEvents(await api<GuildEvent[]>(`/events${past ? '?past=true' : ''}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la agenda');
      setEvents([]);
    }
  }, [past]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /** Refresca la lista y, si hay una hoja abierta, también lo que enseña. */
  const tras = async (actualizado?: GuildEvent) => {
    if (actualizado) setAbierto(actualizado);
    await cargar();
  };

  const contestar = async (event: GuildEvent, answer: EventAnswer, rounds?: number) => {
    setError(null);
    try {
      const actualizado = await api<GuildEvent>(`/events/${event.id}/response`, {
        method: 'PUT',
        body: JSON.stringify({ answer, rounds }),
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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="cinzel text-2xl font-bold text-amber-500">Agenda</h2>
          <p className="text-meta text-slate-500">
            Lo que viene y quién ha dicho que va. Las horas van en la tuya.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setPast(!past)}
            className={`min-h-tap px-4 rounded-md border transition-colors duration-micro ${
              past ? 'border-amber-700 text-amber-500' : 'border-slate-700 text-slate-300'
            }`}
          >
            <i className="fa-solid fa-clock-rotate-left mr-2"></i>
            {past ? 'Ocultar lo pasado' : 'Ver lo pasado'}
          </button>
          {canManage && (
            <button
              onClick={() =>
                setEditando({ kind: 'war', title: '', minutes: 150, rounds: 5 })
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

      {events === null ? (
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
              <button
                onClick={async () => setAbierto(await api<GuildEvent>(`/events/${event.id}`))}
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
                      <h3
                        className={`font-bold text-slate-100 truncate ${
                          event.cancelledAt ? 'line-through' : ''
                        }`}
                      >
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
                      {cuentaPartidas(event.kind) && event.rounds
                        ? ` · ${event.rounds} partidas`
                        : ''}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-2 pl-11">
                  {ORDEN.map((answer) => (
                    <span
                      key={answer}
                      className={`text-[11px] leading-none px-1.5 py-[3px] rounded border uppercase font-bold tracking-tighter ${TONO_APAGADO[answer]}`}
                    >
                      {EVENT_ANSWER_LABELS[answer]} {event[answer] ?? 0}
                    </span>
                  ))}
                </div>
              </button>
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
            misPartidas={miRespuesta(abierto)?.rounds ?? undefined}
            onContestar={(answer, rounds) => contestar(abierto, answer, rounds)}
            onContestarPor={async (playerId, answer, rounds) => {
              const actualizado = await api<GuildEvent>(
                `/events/${abierto.id}/responses/${playerId}`,
                { method: 'PUT', body: JSON.stringify({ answer, rounds }) },
              );
              await tras(actualizado);
            }}
            onEditar={() => setEditando(abierto)}
            onCancelar={() => cancelar(abierto)}
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

/* ------------------------------------------------------------------ detalle */

const DetalleEvento: React.FC<{
  event: GuildEvent;
  players: Player[];
  myPlayerId?: string | null;
  canManage: boolean;
  miRespuesta?: EventAnswer;
  misPartidas?: number;
  onContestar: (answer: EventAnswer, rounds?: number) => void;
  onContestarPor: (playerId: string, answer: EventAnswer, rounds?: number) => void;
  onEditar: () => void;
  onCancelar: () => void;
}> = ({
  event,
  players,
  myPlayerId,
  canManage,
  miRespuesta,
  misPartidas,
  onContestar,
  onContestarPor,
  onEditar,
  onCancelar,
}) => {
  const cuenta = cuentaPartidas(event.kind) && (event.rounds ?? 0) > 1;
  const [partidas, setPartidas] = useState(misPartidas ?? event.rounds ?? 1);

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

      {myPlayerId && !event.cancelledAt && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Tu respuesta</p>
          <div className="flex gap-2 flex-wrap">
            {ORDEN.map((answer) => (
              <button
                key={answer}
                disabled={cerrada}
                onClick={() => onContestar(answer, answer === 'yes' && cuenta ? partidas : undefined)}
                className={`min-h-tap px-4 rounded-md border font-bold transition-colors duration-micro disabled:opacity-40 ${
                  miRespuesta === answer ? TONO[answer] : `bg-slate-950 ${TONO_APAGADO[answer]}`
                }`}
              >
                {EVENT_ANSWER_LABELS[answer]}
              </button>
            ))}
          </div>

          {cuenta && (
            <div className="mt-3">
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                Si vas, ¿a cuántas partidas llegas?
              </label>
              <div className="flex gap-2 flex-wrap">
                {Array.from({ length: event.rounds ?? 1 }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    disabled={cerrada}
                    onClick={() => {
                      setPartidas(n);
                      if (miRespuesta === 'yes') onContestar('yes', n);
                    }}
                    className={`min-h-tap min-w-tap px-3 rounded-md border font-bold tabular-nums transition-colors duration-micro disabled:opacity-40 ${
                      partidas === n
                        ? 'bg-amber-600 border-amber-500 text-white'
                        : 'bg-slate-950 border-slate-700 text-slate-300'
                    }`}
                  >
                    {n === event.rounds ? `${n} (todas)` : n}
                  </button>
                ))}
              </div>
            </div>
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
                    {answer === 'yes' && r.rounds ? (
                      <span className="text-slate-400 tabular-nums"> · {r.rounds}</span>
                    ) : null}
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
                      onClick={() => onContestarPor(p.id, answer, answer === 'yes' ? event.rounds ?? undefined : undefined)}
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
    rounds: borrador.rounds ?? 5,
    notes: borrador.notes ?? '',
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

        {cuentaPartidas(datos.kind) && (
          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">
              Partidas esa noche
            </label>
            <input
              type="number"
              inputMode="numeric"
              className={campo}
              value={datos.rounds}
              onChange={(e) => setDatos({ ...datos, rounds: Number(e.target.value) || 1 })}
            />
            <p className="text-meta text-slate-500 mt-1">
              Es lo que se pregunta: a cuántas de ellas llega cada uno.
            </p>
          </div>
        )}

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
