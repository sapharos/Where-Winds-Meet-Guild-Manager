/**
 * How much a member weighed on a war.
 *
 * The game ranks by kills, which says a healer did nothing. The problem with
 * fixing that by role is that a role is a label: somebody signed up as a tank
 * who spent the war healing gets judged for the wrong thing, and a hybrid who
 * did two jobs at once gets judged for one of them.
 *
 * So nothing here reads a role. Each figure the game reports is scored on its
 * own against the best in that same war, and the scores are ADDED. A healer who
 * topped healing scores the same on that axis as the top damage dealer does on
 * theirs, and neither is asked why the other column is empty. Somebody who did
 * both at half measure scores as much as either -- which is the point of
 * bringing a hybrid, and the reason not to average.
 */

import type { WarSide } from '../types';

export interface Contribution {
  playerId: string;
  name: string;
  side: WarSide;
  stats: Record<string, number | undefined>;
}

/**
 * What each axis is worth once normalised.
 *
 * Damage and healing carry the same weight on purpose: they are the two ways of
 * deciding a fight and neither is worth more than the other. Kills and assists
 * are counted together, because on this screen an assist is what a healer's
 * kill looks like. Deaths take a little away without ever deciding the ranking:
 * dying is often what tanking costs.
 */
export const WEIGHTS: { key: string; label: string; weight: number }[] = [
  { key: 'damage', label: 'Daño', weight: 1 },
  { key: 'healing', label: 'Curación', weight: 1 },
  { key: 'takedowns', label: 'Kills y asistencias', weight: 0.8 },
  { key: 'siege', label: 'Daño de asedio', weight: 0.6 },
  { key: 'taken', label: 'Daño recibido', weight: 0.4 },
  { key: 'coin', label: 'Monedas', weight: 0.2 },
  { key: 'deaths', label: 'Muertes', weight: -0.3 },
];

/**
 * The axes, derived from what the results screen reports.
 *
 * Siege damage is zeroed for defence on purpose: breaking down gates is an
 * attack-side objective, and defence has no way to produce this figure at all.
 * Forcing it to zero here (rather than trusting the stat to happen to be zero)
 * also keeps a mis-tagged deployment from leaking siege credit into a side
 * that structurally cannot earn it.
 */
function axes(stats: Record<string, number | undefined>, side: WarSide): Record<string, number> {
  const value = (key: string) => Math.max(0, stats[key] ?? 0);
  return {
    damage: value('damage'),
    healing: value('healing'),
    // An assist is what a healer's kill looks like, so they count as one thing.
    takedowns: value('kills') + value('assists'),
    siege: side === 'attack' ? value('siege') : 0,
    taken: value('taken'),
    coin: value('coin'),
    deaths: value('deaths'),
  };
}

/**
 * The colour a score is shown in, wherever it is shown.
 *
 * Banded rather than a gradient, so the same figure looks the same everywhere
 * and a glance down a column separates the night's best from the rest without
 * anyone reading the numbers.
 */
export const impactShade = (score: number): string =>
  score >= 85 ? '#fbbf24' : score >= 60 ? '#a3e635' : score >= 35 ? '#60a5fa' : '#94a3b8';

export interface Impact {
  playerId: string;
  name: string;
  /** Nought to a hundred, where a hundred is the best of that war. */
  score: number;
  /** Each axis as a share of the best in that war, for showing the working. */
  parts: Record<string, number>;
}

/**
 * Score everyone in one war against each other.
 *
 * Relative to the war rather than absolute, because a long war, a stubborn
 * enemy or a lopsided line-up move every figure at once. What survives that is
 * how much of the guild's effort went through one person, and that is the
 * question worth asking.
 *
 * The total-to-100 conversion is relative to one's own side, not the whole
 * war. Siege is the reason: it is only ever earned on attack, so a defender
 * measured against an attacker's siege-boosted total would have a ceiling
 * below 100 for a mechanic they were never able to touch, no matter how well
 * they played everything else. Comparing within a side removes that ceiling
 * without changing anything for the six axes both sides can actually contest.
 */
export function impactOf(rows: Contribution[]): Impact[] {
  if (!rows.length) return [];

  const measured = rows.map((row) => ({ row, axis: axes(row.stats, row.side) }));

  const best: Record<string, number> = {};
  for (const { key } of WEIGHTS) {
    best[key] = Math.max(...measured.map(({ axis }) => axis[key]), 0);
  }

  const raw = measured.map(({ row, axis }) => {
    const parts: Record<string, number> = {};
    let total = 0;
    for (const { key, weight } of WEIGHTS) {
      // Nobody reached it, so nobody is measured against it.
      const share = best[key] > 0 ? axis[key] / best[key] : 0;
      parts[key] = share;
      total += weight * share;
    }
    return { row, parts, total };
  });

  const topOf: Record<WarSide, number> = {
    attack: Math.max(...raw.filter((r) => r.row.side === 'attack').map((r) => r.total), 0),
    defense: Math.max(...raw.filter((r) => r.row.side === 'defense').map((r) => r.total), 0),
  };

  return raw
    .map(({ row, parts, total }) => {
      const top = topOf[row.side];
      return {
        playerId: row.playerId,
        name: row.name,
        score: top > 0 ? Math.round((total / top) * 100) : 0,
        parts,
      };
    })
    .sort((a, b) => b.score - a.score);
}
