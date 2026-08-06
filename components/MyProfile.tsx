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
} from '../types';
import { ROLE_NAMES, buildColours } from './PlayerCard';
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

  useEffect(() => {
    api<ScanRecord[]>(`/players/${player.id}/scans`).then(setScans).catch(() => setScans([]));
    api<PlayerBuild[]>(`/players/${player.id}/builds`).then(setBuilds).catch(() => setBuilds([]));
  }, [player.id]);

  const latest = scans[scans.length - 1];
  const previous = scans[scans.length - 2];
  const primary = builds.find((b) => b.isPrimary) ?? builds[0];
  const { from, to } = buildColours(primary, weaponSets);

  return (
    <div className="space-y-5">
      <section
        className="relative border rounded-xl p-6 overflow-hidden"
        style={{ background: `linear-gradient(90deg, ${from}40 0%, ${to}40 100%)`, borderColor: `${from}80` }}
      >
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
            <div className="border-t border-slate-100/10 pt-4">
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
              const colours = buildColours(build, weaponSets);
              return (
                <div
                  key={build.id}
                  className="rounded-lg border border-slate-800 p-3"
                  style={{
                    background: `linear-gradient(90deg, ${colours.from}26 0%, ${colours.to}26 100%)`,
                  }}
                >
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

                  <div className="flex gap-1.5 flex-wrap">
                    {build.weapons.map((weapon) => {
                      const set = weaponSets.find((s) => s.weapons.includes(weapon));
                      return (
                        <span
                          key={weapon}
                          className="text-[10px] px-1.5 py-0.5 rounded border flex items-center gap-1"
                          style={
                            set
                              ? { borderColor: set.color, color: set.color, backgroundColor: `${set.color}1a` }
                              : { borderColor: '#475569', color: '#94a3b8' }
                          }
                        >
                          {set && <SetBadge set={set} size={12} />}
                          {weapon}
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
