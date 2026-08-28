import React, { useEffect, useState } from 'react';
import { api } from '../services/authService';
import {
  Player,
  PlayerBuild,
  Role,
  ScanRecord,
  SCAN_FIELD_CATALOG,
  WAR_SIDE_LABELS,
  WarSide,
  WeaponSet,
  GuildEvent,
  EVENT_ANSWER_LABELS,
  EVENT_KIND_ICONS,
  EVENT_KIND_LABELS,
} from '../types';
import { ROLE_NAMES, ArmasDeBuild, buildColour } from './PlayerCard';
import Grapa from './Grapa';
import { SetBadge } from './BuildEditor';
import MyWars from './MyWars';
import GearSheet from './GearSheet';
import Seccion from './Seccion';

const ROLE_STYLE: Record<Role, string> = {
  [Role.TANK]: 'border-blue-500 text-blue-300 bg-blue-500/15',
  [Role.HEALER]: 'border-green-500 text-green-300 bg-green-500/15',
  [Role.DPS]: 'border-red-500 text-red-300 bg-red-500/15',
};

const number = (value: unknown): number | null =>
  typeof value === 'number' ? value : value === null || value === undefined ? null : Number(value) || null;

interface Props {
  player: Player;
  weaponSets: WeaponSet[];
  onEditBuilds: () => void;
}

/**
 * What a member sees on signing in: their own numbers rather than the guild's.
 *
 * The roster answers "who is in the guild", which is a leader's question. A
 * member arrives asking how they are doing and what they are signed up to play,
 * so that is what opens.
 */
const MyProfile: React.FC<Props> = ({ player, weaponSets, onEditBuilds }) => {
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [builds, setBuilds] = useState<PlayerBuild[]>([]);
  /** Lo que viene, con lo que contesté a cada cosa. */
  const [agenda, setAgenda] = useState<GuildEvent[]>([]);

  useEffect(() => {
    api<ScanRecord[]>(`/players/${player.id}/scans`).then(setScans).catch(() => setScans([]));
    api<PlayerBuild[]>(`/players/${player.id}/builds`).then(setBuilds).catch(() => setBuilds([]));
    api<GuildEvent[]>('/events/mine').then(setAgenda).catch(() => setAgenda([]));
  }, [player.id]);

  // A lo que dije que iba, o que quizá. Lo que dije que no ya está decidido y
  // no hay nada que recordar; lo que no he contestado se cuenta aparte, que es
  // lo único que aquí queda pendiente de hacer.
  const apuntado = agenda.filter((e) => e.mine?.answer === 'yes' || e.mine?.answer === 'maybe');
  // Los avisos no se contestan, así que no pueden quedar «por contestar»:
  // contarlos sería reclamar una deuda que no existe.
  const sinContestar = agenda.filter((e) => e.poll !== false && !e.mine && !e.cancelledAt).length;

  const latest = scans[scans.length - 1];
  const previous = scans[scans.length - 2];
  const primary = builds.find((b) => b.isPrimary) ?? builds[0];
  const { from } = buildColour(primary, weaponSets);

  return (
    <div className="space-y-5">
      {/* Superficie del tema y una barra sólida, no una rampa de los colores de
          sus armas al 25%: el color lo elige el usuario, así que sobre él no se
          puede prometer contraste al nombre ni a la cifra de actividad, que es
          justamente lo que un miembro viene a leer. Las armas pasan a estar
          escritas debajo del nombre, que antes no lo estaban en ningún sitio. */}
      <section className="relative border border-slate-800 bg-slate-900 rounded-xl p-6 overflow-hidden">
        <span
          aria-hidden
          className="absolute left-0 top-0 bottom-0 w-1.5"
          style={{ backgroundColor: from }}
        />
        {/*
          Identidad arriba, cifra abajo, con una regla entre medias.

          Antes eran dos bloques al lado -- el nombre a la izquierda y la
          actividad alineada a la derecha -- que en un teléfono se envolvían y
          acababan con dos alineaciones distintas en la misma tarjeta, uno
          pegado a un borde y el otro al contrario. Puestos uno debajo del otro
          la tarjeta tiene un solo eje, y la cifra gana el sitio que merece:
          es lo que un miembro viene a mirar.
        */}
        <div className="flex flex-col gap-4">
          <div className="min-w-0">
            <h1 className="cinzel text-3xl font-bold text-slate-100 break-words">{player.name}</h1>
            <p className="text-sm text-slate-300 mt-1">
              {player.sect} · Nivel {player.level}
            </p>
            {primary && (
              <ArmasDeBuild
                build={primary}
                weaponSets={weaponSets}
                className="mt-2 flex-wrap gap-y-1"
              />
            )}
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              {player.isStarter && (
                // La grapa y no una estrella: es la marca de titular del
                // sistema (DIRECCION_VISUAL.md §5), la misma que lleva la
                // tarjeta del roster.
                <span className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded border border-staple text-staple uppercase font-bold tracking-wider">
                  <Grapa width={18} />
                  Titular
                </span>
              )}
              {player.warSide && (
                <span
                  className={`text-[11px] px-2 py-0.5 rounded border uppercase font-bold tracking-wider ${
                    player.warSide === 'attack'
                      ? 'border-red-500 text-red-300 bg-red-500/10'
                      : 'border-sky-500 text-sky-300 bg-sky-500/10'
                  }`}
                >
                  {WAR_SIDE_LABELS[player.warSide as WarSide]}
                </span>
              )}
              {player.gameUid && (
                <span className="text-[11px] text-slate-400 font-mono">UID {player.gameUid}</span>
              )}
            </div>
          </div>

          {latest && (
            <div className="border-t border-slate-800 pt-4">
              <p className="text-[11px] uppercase tracking-wider text-slate-400">
                Actividad semanal
              </p>
              <div className="flex items-baseline justify-between gap-3 mt-1">
                <p className="cinzel text-figure-xl font-bold text-slate-100 tabular-nums leading-none">
                  {latest.week_activity ?? '—'}
                </p>
                {previous &&
                  number(latest.week_activity) !== null &&
                  number(previous.week_activity) !== null && (
                    <p
                      className={`text-meta font-semibold text-right ${
                        number(latest.week_activity)! >= number(previous.week_activity)!
                          ? 'text-emerald-400'
                          : 'text-red-400'
                      }`}
                    >
                      {number(latest.week_activity)! - number(previous.week_activity)! >= 0 ? '+' : ''}
                      {number(latest.week_activity)! - number(previous.week_activity)!}
                      <span className="block text-slate-400 font-normal">
                        desde el escaneo anterior
                      </span>
                    </p>
                  )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/*
        A qué me he apuntado.

        Va aquí arriba, antes de las builds y las cifras, porque es lo único de
        esta pantalla que caduca: una build se mira cuando se quiere y un
        escaneo es de la semana pasada, pero «el sábado dije que iba» sirve
        hasta el sábado. Sin nada a lo que apuntarse, la sección no aparece.
      */}
      {(apuntado.length > 0 || sinContestar > 0) && (
        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-6">
          <h2 className="cinzel text-2xl font-bold text-amber-500 mb-1">Mis próximos eventos</h2>
          <p className="text-xs text-slate-500 mb-4">
            A lo que has dicho que vas. Las horas están en la tuya.
          </p>

          {apuntado.length === 0 ? (
            <p className="text-sm text-slate-500">No te has apuntado a nada todavía.</p>
          ) : (
            <div className="space-y-2">
              {apuntado.map((e) => (
                <div
                  key={e.id}
                  className={`flex items-start gap-3 bg-slate-950 border rounded-lg p-3 ${
                    e.cancelledAt ? 'border-red-900 opacity-70' : 'border-slate-800'
                  }`}
                >
                  <div className="w-8 h-8 rounded flex items-center justify-center shrink-0 bg-slate-800 text-slate-300">
                    <i className={`fa-solid ${EVENT_KIND_ICONS[e.kind]}`}></i>
                  </div>
                  <div className="min-w-0 grow">
                    <div className="flex items-center gap-2 min-w-0">
                      <h3
                        className={`font-bold text-slate-100 truncate ${
                          e.cancelledAt ? 'line-through' : ''
                        }`}
                      >
                        {e.title}
                      </h3>
                      {e.cancelledAt && (
                        <span className="text-[11px] leading-none px-1.5 py-[3px] rounded border border-red-700 text-red-400 uppercase font-bold tracking-tighter shrink-0">
                          cancelado
                        </span>
                      )}
                    </div>
                    <p className="text-meta text-slate-400 truncate">
                      {EVENT_KIND_LABELS[e.kind]} ·{' '}
                      {new Date(e.startsAt).toLocaleString('es', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZoneName: 'short',
                      })}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-[11px] leading-none px-1.5 py-[3px] rounded border uppercase font-bold tracking-tighter ${
                      e.mine?.answer === 'yes'
                        ? 'border-emerald-700 text-emerald-400'
                        : 'border-staple text-staple'
                    }`}
                  >
                    {EVENT_ANSWER_LABELS[e.mine?.answer ?? 'maybe']}
                  </span>
                </div>
              ))}
            </div>
          )}

          {sinContestar > 0 && (
            <p className="text-meta text-staple mt-3">
              <i className="fa-solid fa-circle-exclamation mr-1.5"></i>
              {sinContestar === 1
                ? 'Queda 1 evento por contestar en la Agenda.'
                : `Quedan ${sinContestar} eventos por contestar en la Agenda.`}
            </p>
          )}
        </section>
      )}

      <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
          <h2 className="cinzel text-2xl font-bold text-amber-500">Mis builds</h2>
          <button
            onClick={onEditBuilds}
            className="bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold py-2 px-4 rounded transition-all flex items-center gap-2"
          >
            <i className="fa-solid fa-hand-fist"></i>
            {builds.length ? 'Editar mis builds' : 'Crear mi primera build'}
          </button>
        </div>

        {builds.length === 0 ? (
          <p className="text-sm text-slate-500">
            Todavía no has registrado ninguna build. Añade las armas con las que juegas y los roles que
            cubres, para que se te tenga en cuenta al armar la guerra.
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {builds.map((build) => {
              const { from } = buildColour(build, weaponSets);
              return (
                <div
                  key={build.id}
                  className="relative overflow-hidden rounded-lg border border-slate-800 bg-slate-950 p-3 pl-4"
                >
                  <span
                    aria-hidden
                    className="absolute left-0 top-0 bottom-0 w-1"
                    style={{ backgroundColor: from }}
                  />
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-bold text-slate-100">{build.name}</h3>
                    {build.isPrimary && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded border border-amber-500 text-amber-400 uppercase font-bold tracking-wider">
                        principal
                      </span>
                    )}
                  </div>

                  <div className="flex gap-1.5 flex-wrap mb-2">
                    {build.roles.map((role) => (
                      <span
                        key={role}
                        className={`text-[10px] font-bold px-2 py-0.5 rounded border ${ROLE_STYLE[role]}`}
                      >
                        {ROLE_NAMES[role]}
                      </span>
                    ))}
                  </div>

                  {/* Chip neutro con la marca del conjunto en color, y no el
                      nombre del arma escrito del color del usuario sobre un
                      tinte suyo: eso es texto sin contraste garantizado en
                      ninguno de los dos temas. */}
                  <div className="flex gap-1.5 flex-wrap">
                    {build.weapons.map((weapon) => {
                      const set = weaponSets.find((s) => s.weapons.includes(weapon));
                      return (
                        <span
                          key={weapon}
                          title={set ? set.name : 'Ya no está en ningún conjunto'}
                          className={`text-[11px] px-1.5 py-0.5 rounded border flex items-center gap-1.5 ${
                            set
                              ? 'border-slate-800 bg-slate-900 text-slate-300'
                              : 'border-slate-700 text-slate-500'
                          }`}
                        >
                          {set ? (
                            <SetBadge set={set} size={12} />
                          ) : (
                            <i className="fa-solid fa-triangle-exclamation text-[9px]"></i>
                          )}
                          <span className={set ? '' : 'line-through'}>{weapon}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-6">
        <h2 className="cinzel text-2xl font-bold text-amber-500 mb-1">Mis estadísticas</h2>
        <p className="text-xs text-slate-500 mb-5">
          {latest
            ? `Del escaneo del ${new Date(latest.scannedAt).toLocaleDateString()}.` +
              (previous ? ' El cambio es respecto al anterior.' : '')
            : 'Todavía no apareces en ningún escaneo del gremio.'}
        </p>

        {latest && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {SCAN_FIELD_CATALOG.map((field) => {
              const now = number(latest[field.key]);
              if (now === null) return null;
              const before = previous ? number(previous[field.key]) : null;
              const change = before === null ? null : now - before;

              return (
                <div key={field.key} className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">{field.label}</p>
                  <p className="text-xl font-bold text-slate-100 tabular-nums">
                    {latest[field.key] as React.ReactNode}
                    {change !== null && change !== 0 && (
                      <span
                        className={`ml-2 text-xs font-semibold ${
                          change > 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {change > 0 ? '+' : ''}
                        {change}
                      </span>
                    )}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/*
        Las dos últimas llegan plegadas.

        Son las que más ocupan y las que menos se miran, y ésta es la pantalla
        que se abre sola en una visita de dos minutos. Plegadas siguen
        anunciando qué guardan; y como el contenido no se monta hasta que se
        abren, GearSheet deja de pedirle cinco cosas al servidor a todo el que
        entra a mirar su actividad semanal.

        El orden, los nombres y lo que hay dentro no cambian.
      */}
      <Seccion
        titulo="Mi equipo"
        icono="fa-shield-halved"
        resumen="Piezas, líneas y sintonización"
      >
        <GearSheet playerId={player.id} canEdit />
      </Seccion>

      <Seccion
        titulo="Mis guerras"
        icono="fa-chess-knight"
        resumen="Lo que has librado y tu impacto"
      >
        <MyWars playerId={player.id} weaponSets={weaponSets} />
      </Seccion>
    </div>
  );
};

export default MyProfile;
