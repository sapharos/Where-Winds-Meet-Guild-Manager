import type { GearCeiling, GearLine, GearPiece } from '../types';

/**
 * The attributes seen on real pieces so far, as the game spells them.
 *
 * Only names read off actual screenshots are in here. The game has far more --
 * forty-six can appear on lines one to five alone -- but a guessed translation
 * is worse than a missing one: it would sit in the suggestion list looking
 * official and never match what anybody's screen actually says. The list grows
 * from what members type, which is the same reason weapon sets live in the
 * database rather than in a constant.
 */
export const KNOWN_STATS: { name: string; unit?: GearLine['unit'] }[] = [
  { name: 'Ataque Físico Máximo', unit: 'flat' },
  { name: 'Ataque Físico Mínimo', unit: 'flat' },
  { name: 'Ataque Máx de Atadura de Seda', unit: 'flat' },
  { name: 'Ataque Mínimo de Atadura de Seda', unit: 'flat' },
  { name: 'Tasa Crítica', unit: 'percent' },
  { name: 'Vida Máxima', unit: 'flat' },
  { name: 'Poder', unit: 'flat' },
  { name: 'Agilidad', unit: 'flat' },
  { name: 'Resistencia Física', unit: 'percent' },
  { name: 'Penetración Sin Forma', unit: 'flat' },
  // Never yet seen on a screenshot, so no unit is claimed for it.
  { name: 'Penetración Física' },
  { name: 'Aumento de Daño en Habilidad Mística de Control', unit: 'percent' },
  { name: 'Impulso de Curación de Habilidad de Arte Marcial de Abanico Panacea', unit: 'percent' },
];

/** The same folding the server does, so the client can look a ceiling up. */
export const statKey = (name: string): string =>
  name
    .replace(/^\s*\[[^\]]*\]\s*/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export interface Reading {
  line: GearLine;
  /** How high this attribute goes at this item level, once anyone has shown it. */
  ceiling: number | null;
  /** What it is worth, filled in from the bar when the game clipped the text. */
  value: number | null;
  /** How much of the ceiling it reached, 0 to 1. */
  share: number | null;
  /** What a perfect reroll would add. */
  margin: number | null;
}

/**
 * What one line is actually worth, given everything the guild has learned.
 *
 * Two ways round the same relationship. A line read from a screenshot has a
 * bar but may have lost its value to clipping, so the value comes back as
 * fill x ceiling. A line typed in by hand has a value but no bar, so the share
 * comes out as value / ceiling. Either way nothing is invented: if no ceiling
 * is known yet, the line simply has nothing to say.
 */
export function read(line: GearLine, level: number | null, ceilings: GearCeiling[]): Reading {
  const found = ceilings.find((c) => c.stat === line.stat && c.level === level);
  const ceiling = found?.ceiling ?? null;

  const value = line.value ?? (ceiling !== null && line.fill !== null ? ceiling * line.fill : null);
  const share =
    line.fill ?? (ceiling !== null && ceiling > 0 && value !== null ? Math.min(1, value / ceiling) : null);
  const margin = ceiling !== null && value !== null ? Math.max(0, ceiling - value) : null;

  return { line, ceiling, value, share, margin };
}

export type PieceState = 'frozen' | 'committed' | 'open' | 'unknown';

/**
 * Where a piece stands, which decides what there is to say about it.
 *
 * "open" is the one that matters. Four lines are still candidates and choosing
 * shuts the other three for good, so it is the only moment where a
 * recommendation changes anything -- everywhere else the decision is already
 * behind you.
 */
export function stateOf(piece: GearPiece): PieceState {
  if (piece.relayed) return 'frozen';
  if (!piece.lines.length) return 'unknown';
  if (piece.lines.some((l) => l.committed)) return 'committed';
  return 'open';
}

/**
 * The four candidates on an uncommitted piece, most room to improve first.
 *
 * Ranked by the share of its own ceiling a line has left, never by the size of
 * the margin. The figures are in different units and different orders of
 * magnitude -- 144 more Vida Máxima and 3 more Poder are not comparable
 * quantities, and sorting on the raw numbers puts whichever attribute happens
 * to be counted in thousands at the top of every piece in the game.
 *
 * This still only measures room, not worth. A line eleven percent off its
 * ceiling has more to gain than one four percent off, but whether that is the
 * line to spend your one reroll on depends on which attribute matters to the
 * way you play, and nothing here claims to know that.
 */
export function candidates(piece: GearPiece, ceilings: GearCeiling[]): Reading[] {
  const room = (r: Reading) => (r.share === null ? -1 : 1 - r.share);
  return piece.lines
    .filter((l) => l.position >= 2 && l.position <= 5)
    .map((l) => read(l, piece.level, ceilings))
    .sort((a, b) => room(b) - room(a));
}

/** Whole days until this piece may be tuned again; 0 when it is ready now. */
export function daysUntil(readyAt: string | null): number | null {
  if (!readyAt) return null;
  const ms = Date.parse(readyAt) - Date.now();
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 86400000)) : null;
}

/** A figure with its unit, for a screen where 7.1% and 2261 sit in one column. */
export const show = (value: number | null, unit: GearLine['unit']): string => {
  if (value === null) return '—';
  const n = unit === 'percent' ? value.toFixed(1) : Math.round(value).toLocaleString('es');
  return unit === 'percent' ? `${n}%` : n;
};
