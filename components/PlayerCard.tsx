
import React from 'react';
import { Player, Role, MembershipStatus, GuildRank } from '../types';
import { ROLE_COLORS, ROLE_ICONS, PLATFORM_ICONS, STATUS_COLORS } from '../constants';

interface PlayerCardProps {
  player: Player;
  onEdit?: (p: Player) => void;
  onDelete?: (id: string) => void;
  onShowHistory?: (p: Player) => void;
  className?: string;
  compact?: boolean;
  ranks?: GuildRank[];
}

const PlayerCard: React.FC<PlayerCardProps> = ({ player, onEdit, onDelete, onShowHistory, className = '', compact = false, ranks = [] }) => {
  const rank = ranks.find(r => r.id === player.rankId);

  return (
    <div className={`p-3 rounded-lg border border-slate-800 bg-slate-900/50 hover:bg-slate-800/80 transition-all ${className}`}>
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded flex items-center justify-center border ${ROLE_COLORS[player.role]}`}>
            {ROLE_ICONS[player.role]}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="font-bold text-slate-100 leading-tight truncate max-w-[120px]">{player.name}</h4>
              {player.platform && (
                <span className="text-slate-500 text-[10px]" title={player.platform}>
                  {PLATFORM_ICONS[player.platform]}
                </span>
              )}
            </div>
            {!compact ? (
              <div className="flex flex-wrap items-center gap-2 mt-0.5">
                <p className="text-[10px] text-slate-400">{player.sect} • Lv.{player.level}</p>
                <span className={`text-[8px] px-1.5 py-0.5 rounded border uppercase font-bold tracking-tighter ${STATUS_COLORS[player.status || MembershipStatus.FULL_MEMBER]}`}>
                  {player.status === MembershipStatus.APPRENTICE ? 'Apprentice' : 'Member'}
                </span>
                {rank && (
                  <span 
                    className="text-[8px] px-1.5 py-0.5 rounded border uppercase font-bold tracking-tighter"
                    style={{ borderColor: rank.color, color: rank.color, backgroundColor: `${rank.color}15` }}
                  >
                    {rank.name}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <span className={`text-[8px] uppercase font-bold tracking-tighter ${player.status === MembershipStatus.APPRENTICE ? 'text-slate-500' : 'text-amber-600'}`}>
                  {player.status === MembershipStatus.APPRENTICE ? 'Appr' : 'Memb'}
                </span>
                {rank && (
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: rank.color }} title={rank.name} />
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {onShowHistory && (
            <button
              onClick={() => onShowHistory(player)}
              title="Ver evolucion"
              className="text-slate-400 hover:text-amber-500 transition-colors"
            >
              <i className="fa-solid fa-chart-line"></i>
            </button>
          )}
          {onEdit && (
            <button onClick={() => onEdit(player)} className="text-slate-400 hover:text-white transition-colors">
              <i className="fa-solid fa-pen-to-square"></i>
            </button>
          )}
          {onDelete && (
            <button onClick={() => onDelete(player.id)} className="text-slate-500 hover:text-red-400 transition-colors">
              <i className="fa-solid fa-trash-can"></i>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PlayerCard;
