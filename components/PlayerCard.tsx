
import React, { useState } from 'react';
import { Player, PlayerBuild, Role, MembershipStatus, GuildRank, WeaponSet, WarSide, WAR_SIDE_LABELS } from '../types';
import { ROLE_COLORS, ROLE_ICONS, PLATFORM_ICONS, STATUS_COLORS } from '../constants';
import Sheet from './Sheet';

export const ROLE_NAMES: Record<Role, string> = {
  [Role.TANK]: 'Tanque',
  [Role.HEALER]: 'Sanador',
  [Role.DPS]: 'DPS',
};

// A member with no build reads as unpainted rather than as some arbitrary
// colour: the roster should show at a glance who has not been described yet.
const UNSET = '#475569';

/**
 * The colours of a build's first two weapons, from the sets they belong to.
 *
 * Also reports when a build names weapons that no set contains any more, which
 * happens after the catalogue is renamed: the build keeps working but loses its
 * colours, and silently showing grey would look like nobody had a build.
 */
export function buildColours(
  build: PlayerBuild | undefined,
  sets: WeaponSet[],
): { from: string; to: string; orphaned: boolean } {
  const colourOf = (weapon?: string) =>
    weapon ? sets.find((s) => s.weapons.includes(weapon))?.color : undefined;

  const first = colourOf(build?.weapons[0]);
  const second = colourOf(build?.weapons[1]);
  return {
    from: first ?? UNSET,
    to: second ?? first ?? UNSET,
    orphaned: Boolean(build?.weapons.length) && !first && !second,
  };
}

interface PlayerCardProps {
  player: Player;
  build?: PlayerBuild;
  weaponSets?: WeaponSet[];
  onEdit?: (p: Player) => void;
  onShowHistory?: (p: Player) => void;
  onShowBuilds?: (p: Player) => void;
  onToggleStarter?: (p: Player) => void;
  onCycleSide?: (p: Player) => void;
  onToggleActive?: (p: Player) => void;
  className?: string;
  compact?: boolean;
  ranks?: GuildRank[];
}

const PlayerCard: React.FC<PlayerCardProps> = ({
  player,
  build,
  weaponSets = [],
  onEdit,
  onShowHistory,
  onShowBuilds,
  onToggleStarter,
  onCycleSide,
  onToggleActive,
  className = '',
  compact = false,
  ranks = [],
}) => {
  const rank = ranks.find((r) => r.id === player.rankId);
  const { from, to, orphaned } = buildColours(build, weaponSets);
  const gone = player.isActive === false;
  const [menu, setMenu] = useState(false);

  /**
   * Las acciones de la tarjeta, como datos.
   *
   * Eran seis botones de icono de 20x24 px separados 8, sin una sola etiqueta:
   * lo que hacía cada uno vivía en un `title`, que en un teléfono no existe. Y
   * el primero de los seis daba de baja a alguien, pegado al que marca titular,
   * que es el que más se pulsa.
   *
   * Ahora son una lista con su nombre escrito, cada una de 44 px de alto, con
   * la destructiva apartada al pie. Marcar titular pasa de un toque sobre un
   * objetivo que se falla a dos sobre uno que no.
   */
  const acciones = [
    onToggleStarter && !gone && {
      id: 'titular',
      icono: player.isStarter ? 'fa-star' : 'fa-star',
      familia: player.isStarter ? 'fa-solid' : 'fa-regular',
      // Titular es "te han fijado a la alineación", que es lo que significa la
      // grapa: va en su latón y no en el acento.
      tono: player.isStarter ? 'text-staple' : 'text-slate-400',
      texto: player.isStarter ? 'Quitar de titulares' : 'Marcar como titular',
      hacer: () => onToggleStarter(player),
    },
    onCycleSide && !gone && {
      id: 'bando',
      icono: player.warSide === 'defense' ? 'fa-shield' : 'fa-khanda',
      familia: 'fa-solid',
      tono:
        player.warSide === 'attack'
          ? 'text-red-400'
          : player.warSide === 'defense'
            ? 'text-sky-400'
            : 'text-slate-400',
      texto: player.warSide
        ? `${WAR_SIDE_LABELS[player.warSide as WarSide]} — cambiar`
        : 'Sin bando — poner en Ataque',
      hacer: () => onCycleSide(player),
    },
    onShowBuilds && {
      id: 'builds',
      icono: 'fa-hand-fist',
      familia: 'fa-solid',
      tono: 'text-slate-400',
      texto: 'Builds y armas',
      hacer: () => onShowBuilds(player),
    },
    onShowHistory && {
      id: 'historial',
      icono: 'fa-chart-line',
      familia: 'fa-solid',
      tono: 'text-slate-400',
      texto: 'Ver evolución',
      hacer: () => onShowHistory(player),
    },
    onEdit && {
      id: 'editar',
      icono: 'fa-pen-to-square',
      familia: 'fa-solid',
      tono: 'text-slate-400',
      texto: 'Editar miembro',
      hacer: () => onEdit(player),
    },
  ].filter(Boolean) as {
    id: string;
    icono: string;
    familia: string;
    tono: string;
    texto: string;
    hacer: () => void;
  }[];

  return (
    <div
      // min-w-0 en la raíz porque la tarjeta es hija de un grid, y un hijo de
      // grid no baja de su contenido mínimo salvo que se le diga. Sin esto, a
      // 320 px la tarjeta medía 467 y empujaba la página entera fuera de la
      // pantalla: el desborde no lo causaba el grid, lo causaba esto.
      className={`relative min-w-0 p-3 rounded-lg border transition-all ${
        gone
          ? 'border-slate-800 opacity-50 grayscale'
          : player.isStarter
            ? 'border-staple shadow-[0_0_0_1px_rgb(var(--w-500)/0.35)]'
            : 'border-slate-800'
      } ${className}`}
      style={{
        // Each colour holds its own third before the blend starts. A plain
        // 0%-to-100% ramp reaches the second weapon's colour only at the last
        // column of pixels, so a card read as its first weapon and little else.
        // Over an opaque base so it looks the same wherever the card sits. The
        // base is the theme's raised surface rather than a fixed near-black:
        // pinned to one colour, every card stayed dark when the light theme
        // arrived and the wash lost the contrast it is drawn for.
        background: `linear-gradient(90deg, ${from}66 0%, ${from}66 22%, ${to}66 78%, ${to}66 100%), rgb(var(--n-900))`,
      }}
    >
      {/* Solid edges as well as the wash: a tint alone is easy to miss against
          a dark card. Left is the primary weapon, right the secondary, so the
          card reads left to right -- and the right edge only appears when there
          is a second colour to report. */}
      <span
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg"
        style={{ backgroundColor: from }}
      />
      {to !== from && (
        <span
          aria-hidden
          className="absolute right-0 top-0 bottom-0 w-1 rounded-r-lg"
          style={{ backgroundColor: to }}
        />
      )}

      <div className="flex justify-between items-start pl-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-8 h-8 rounded flex items-center justify-center border shrink-0 ${ROLE_COLORS[player.role]}`}>
            {ROLE_ICONS[player.role]}
          </div>
          <div className="min-w-0">
            {/* min-w-0 en la fila y no un tope fijo en el nombre: con
                `max-w-[140px]` el nombre se recortaba siempre a 140 px aunque
                sobrara sitio, y aun así la fila no encogía por debajo de su
                contenido, así que a 320 px la tarjeta empujaba la página entera
                fuera de la pantalla. Ahora el nombre ocupa lo que hay. */}
            <div className="flex items-center gap-2 min-w-0">
              <h4 className="font-bold text-slate-100 leading-tight truncate">{player.name}</h4>
              {player.martialMastery !== undefined && (
                <span
                  className="text-[11px] text-amber-400/90 tabular-nums shrink-0"
                  title="Maestría marcial, del último escaneo"
                >
                  ({player.martialMastery.toLocaleString('es')})
                </span>
              )}
              {player.platform && (
                <span className="text-slate-500 text-[10px]" title={player.platform}>
                  {PLATFORM_ICONS[player.platform]}
                </span>
              )}
            </div>

            {!compact ? (
              <div className="flex flex-wrap items-center gap-2 mt-0.5">
                <p className="text-[10px] text-slate-400">
                  {player.sect} · Nv.{player.level}
                </p>
                <span
                  className={`text-[11px] px-1.5 py-0.5 rounded border uppercase font-bold tracking-tighter ${
                    STATUS_COLORS[player.status || MembershipStatus.FULL_MEMBER]
                  }`}
                >
                  {player.status === MembershipStatus.APPRENTICE ? 'Aprendiz' : 'Miembro'}
                </span>
                {rank && (
                  <span
                    className="text-[11px] px-1.5 py-0.5 rounded border uppercase font-bold tracking-tighter"
                    style={{ borderColor: rank.color, color: rank.color, backgroundColor: `${rank.color}15` }}
                  >
                    {rank.name}
                  </span>
                )}
                {build && (
                  <span className="text-[11px] text-slate-400 truncate max-w-[140px]" title={build.weapons.join(' · ')}>
                    {build.name}
                  </span>
                )}
                {gone && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded border border-slate-600 text-slate-400 uppercase font-bold tracking-tighter">
                    fuera del gremio
                  </span>
                )}
                {player.warSide && (
                  <span
                    className={`text-[11px] px-1.5 py-0.5 rounded border uppercase font-bold tracking-tighter ${
                      player.warSide === 'attack'
                        ? 'border-red-600 text-red-300 bg-red-600/15'
                        : 'border-sky-600 text-sky-300 bg-sky-600/15'
                    }`}
                  >
                    {WAR_SIDE_LABELS[player.warSide as WarSide]}
                  </span>
                )}
                {orphaned && (
                  <span
                    className="text-[11px] text-amber-500"
                    title={`Estas armas ya no existen en ningún conjunto: ${build?.weapons.join(', ')}`}
                  >
                    <i className="fa-solid fa-triangle-exclamation mr-1"></i>
                    armas sin conjunto
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <span
                  className={`text-[11px] uppercase font-bold tracking-tighter ${
                    player.status === MembershipStatus.APPRENTICE ? 'text-slate-500' : 'text-amber-600'
                  }`}
                >
                  {player.status === MembershipStatus.APPRENTICE ? 'Aprz' : 'Miem'}
                </span>
                {rank && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: rank.color }} title={rank.name} />}
              </div>
            )}
          </div>
        </div>

        {(acciones.length > 0 || onToggleActive) && (
          <button
            onClick={() => setMenu(true)}
            aria-label={`Acciones de ${player.name}`}
            aria-haspopup="dialog"
            className="shrink-0 -mr-1 -mt-1 min-h-tap min-w-tap flex items-center justify-center rounded-md text-slate-400 hover:text-amber-500 transition-colors duration-micro"
          >
            <i className="fa-solid fa-ellipsis-vertical"></i>
          </button>
        )}
      </div>

      {menu && (
        <Sheet
          title={player.name}
          subtitle={`${ROLE_NAMES[player.role]} · ${player.sect} · Nv.${player.level}`}
          size="sm"
          onClose={() => setMenu(false)}
        >
          <div className="flex flex-col gap-1">
            {acciones.map((accion) => (
              <button
                key={accion.id}
                onClick={() => {
                  accion.hacer();
                  setMenu(false);
                }}
                className="min-h-tap flex items-center gap-3 px-3 -mx-1 rounded-md text-left text-slate-200 hover:bg-slate-800/60 transition-colors duration-micro"
              >
                <i className={`${accion.familia} ${accion.icono} ${accion.tono} w-5 text-center`}></i>
                {accion.texto}
              </button>
            ))}
          </div>

          {onToggleActive && (
            // Apartada, no escondida. Estaba a 8 px de la acción más frecuente
            // de la tarjeta, que es la peor vecindad posible para algo que
            // saca a alguien del gremio.
            <div className="mt-4 pt-3 border-t border-slate-800">
              <button
                onClick={() => {
                  onToggleActive(player);
                  setMenu(false);
                }}
                className={`w-full min-h-tap flex items-center gap-3 px-3 -mx-1 rounded-md text-left transition-colors duration-micro ${
                  gone
                    ? 'text-emerald-400 hover:bg-emerald-500/10'
                    : 'text-red-400 hover:bg-red-500/10'
                }`}
              >
                <i className={`fa-solid ${gone ? 'fa-user-check' : 'fa-user-slash'} w-5 text-center`}></i>
                {gone ? 'Readmitir en el gremio' : 'Marcar como fuera del gremio'}
              </button>
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
};

export default PlayerCard;
