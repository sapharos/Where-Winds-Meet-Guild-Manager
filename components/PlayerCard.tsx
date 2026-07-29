
import React from 'react';
import { Player, PlayerBuild, Role, MembershipStatus, GuildRank, WeaponSet } from '../types';
import { ROLE_COLORS, ROLE_ICONS, PLATFORM_ICONS, STATUS_COLORS } from '../constants';

export const ROLE_NAMES: Record<Role, string> = {
  [Role.TANK]: 'Tanque',
  [Role.HEALER]: 'Sanador',
  [Role.DPS]: 'DPS',
};

// A member with no build reads as unpainted rather than as some arbitrary
// colour: the roster should show at a glance who has not been described yet.
const UNSET = '#475569';

/** The colours of a build's first two weapons, from the sets they belong to. */
export function buildColours(build: PlayerBuild | undefined, sets: WeaponSet[]): [string, string] {
  const colourOf = (weapon?: string) =>
    weapon ? sets.find((s) => s.weapons.includes(weapon))?.color : undefined;

  const first = colourOf(build?.weapons[0]) ?? UNSET;
  const second = colourOf(build?.weapons[1]) ?? first;
  return [first, second];
}

interface PlayerCardProps {
  player: Player;
  build?: PlayerBuild;
  weaponSets?: WeaponSet[];
  onEdit?: (p: Player) => void;
  onDelete?: (id: string) => void;
  onShowHistory?: (p: Player) => void;
  onShowBuilds?: (p: Player) => void;
  onToggleStarter?: (p: Player) => void;
  className?: string;
  compact?: boolean;
  ranks?: GuildRank[];
}

const PlayerCard: React.FC<PlayerCardProps> = ({
  player,
  build,
  weaponSets = [],
  onEdit,
  onDelete,
  onShowHistory,
  onShowBuilds,
  onToggleStarter,
  className = '',
  compact = false,
  ranks = [],
}) => {
  const rank = ranks.find((r) => r.id === player.rankId);
  const [from, to] = buildColours(build, weaponSets);

  return (
    <div
      className={`relative p-3 rounded-lg border transition-all ${
        player.isStarter ? 'border-amber-400 shadow-[0_0_0_1px_rgba(251,191,36,0.35)]' : 'border-slate-800'
      } ${className}`}
      style={{ background: `linear-gradient(135deg, ${from}26 0%, ${to}26 100%)` }}
    >
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-8 h-8 rounded flex items-center justify-center border shrink-0 ${ROLE_COLORS[player.role]}`}>
            {ROLE_ICONS[player.role]}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="font-bold text-slate-100 leading-tight truncate max-w-[140px]">{player.name}</h4>
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
                  className={`text-[8px] px-1.5 py-0.5 rounded border uppercase font-bold tracking-tighter ${
                    STATUS_COLORS[player.status || MembershipStatus.FULL_MEMBER]
                  }`}
                >
                  {player.status === MembershipStatus.APPRENTICE ? 'Aprendiz' : 'Miembro'}
                </span>
                {rank && (
                  <span
                    className="text-[8px] px-1.5 py-0.5 rounded border uppercase font-bold tracking-tighter"
                    style={{ borderColor: rank.color, color: rank.color, backgroundColor: `${rank.color}15` }}
                  >
                    {rank.name}
                  </span>
                )}
                {build && (
                  <span className="text-[9px] text-slate-400 truncate max-w-[140px]" title={build.weapons.join(' · ')}>
                    {build.name}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <span
                  className={`text-[8px] uppercase font-bold tracking-tighter ${
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

        <div className="flex gap-2 shrink-0">
          {onToggleStarter && (
            <button
              onClick={() => onToggleStarter(player)}
              title={player.isStarter ? 'Quitar de titulares' : 'Marcar como titular'}
              className={`transition-colors ${
                player.isStarter ? 'text-amber-400 hover:text-amber-300' : 'text-slate-600 hover:text-amber-500'
              }`}
            >
              <i className={`${player.isStarter ? 'fa-solid' : 'fa-regular'} fa-star`}></i>
            </button>
          )}
          {onShowBuilds && (
            <button
              onClick={() => onShowBuilds(player)}
              title="Builds y armas"
              className="text-slate-400 hover:text-amber-500 transition-colors"
            >
              <i className="fa-solid fa-hand-fist"></i>
            </button>
          )}
          {onShowHistory && (
            <button
              onClick={() => onShowHistory(player)}
              title="Ver evolución"
              className="text-slate-400 hover:text-amber-500 transition-colors"
            >
              <i className="fa-solid fa-chart-line"></i>
            </button>
          )}
          {onEdit && (
            <button onClick={() => onEdit(player)} title="Editar" className="text-slate-400 hover:text-white transition-colors">
              <i className="fa-solid fa-pen-to-square"></i>
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(player.id)}
              title="Eliminar"
              className="text-slate-500 hover:text-red-400 transition-colors"
            >
              <i className="fa-solid fa-trash-can"></i>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PlayerCard;
