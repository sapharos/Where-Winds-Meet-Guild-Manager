import type { CatalogEntry, Option } from './gearCatalog';

/**
 * Snapping a reading onto the closed list, instead of believing it.
 *
 * This is the whole change in one function. The reader used to hand back
 * whatever the engine returned and the form saved it, so a bad frame put
 * "Ataque Fisico Maxlmo" in somebody's gear and, worse, into everybody's
 * suggestion list -- where it sat at distance nought from the next identical
 * misreading and captured it. There was no bottom to that.
 *
 * With a closed pool the question changes shape. The engine is no longer asked
 * what the line says; it is asked which of these forty-six it says, and there
 * is always an answer. A damaged reading lands on the right one because the
 * competition is between forty-six known strings rather than against the whole
 * of Spanish, and a reading damaged past recognition still lands on *a* real
 * attribute -- flagged, so the member looks at it, rather than silently
 * inventing a forty-seventh.
 */

/** How many single-character edits separate two names. */
export function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a || !b) return Math.max(a.length, b.length);
  const rows = Array.from({ length: b.length + 1 }, (_, i) => [i, ...Array(a.length).fill(0)]);
  for (let j = 1; j <= a.length; j++) rows[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (a[j - 1] === b[i - 1] ? 0 : 1),
      );
    }
  }
  return rows[b.length][a.length];
}

/**
 * Everything that is not a letter or a digit, thrown away before comparing.
 *
 * Accents included, deliberately. The engine loses them constantly on this
 * font, and "Maximo" against "Máximo" is not a disagreement about which
 * attribute this is.
 */
export const bare = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export interface Match {
  entry: CatalogEntry;
  /** Edits between the reading and the closest spelling of this entry. */
  gap: number;
  /** 1 for a clean reading, down towards 0 as the damage grows. */
  score: number;
  /**
   * Whether this is close enough to act on without anybody looking.
   *
   * Two conditions, and both matter. Close enough in absolute terms, and
   * clearly closer than the runner-up: "Ataque de Campana Máximo" and "Ataque
   * de Campana Mínimo" are two edits apart, so a reading sitting between them
   * is a coin toss however good its score looks on its own.
   */
  sure: boolean;
}

/**
 * How much damage a name of this length may carry and still be sure.
 *
 * Counted in edits rather than as a share, which was the mistake in the old
 * reader before it was fixed the first time: a share treats one misread letter
 * as trivial in a long name and fatal in a short one. Two edits always, plus
 * one per dozen characters, because the damage clusters at the ends where the
 * bracketed "[Girar]" marker and the first capital sit.
 */
const allowance = (length: number) => Math.max(2, Math.floor(length / 12));

/** Every spelling one entry answers to: Spanish, English, and any alternates. */
export const spellingsOf = (entry: CatalogEntry, override?: string): string[] =>
  [override || entry.es, entry.key, ...(entry.alt ?? [])].filter(Boolean);

/**
 * The closest option to what was read, or null when there is nothing to choose
 * from.
 *
 * Never returns "no match" for a non-empty pool. That is the point: the member
 * asked for fixed options, so a reading resolves to one of them or the line is
 * left for them to pick by hand -- it never becomes a forty-seventh attribute.
 * `sure` carries whether anybody should look at it.
 *
 * `overrides` are the Spanish names the guild has corrected, which win over the
 * ones shipped in the catalogue. Most of those translations are mine rather
 * than read off a screen, so the correction has to reach the matcher and not
 * just the label, or a fixed name would go on failing to match forever.
 */
export function snap(read: string, pool: Option[], overrides?: ReadonlyMap<string, string>): Match | null {
  const needle = bare(read);
  if (!needle || !pool.length) return null;

  let best: { entry: CatalogEntry; gap: number } | null = null;
  let second = Infinity;

  for (const { entry } of pool) {
    let gap = Infinity;
    for (const spelling of spellingsOf(entry, overrides?.get(entry.key))) {
      gap = Math.min(gap, distance(needle, bare(spelling)));
    }
    if (!best || gap < best.gap) {
      if (best) second = Math.min(second, best.gap);
      best = { entry, gap };
    } else if (gap < second) second = gap;
  }
  if (!best) return null;

  const reach = Math.max(needle.length, 1);
  return {
    entry: best.entry,
    gap: best.gap,
    score: Math.max(0, 1 - best.gap / reach),
    sure: best.gap <= allowance(needle.length) && best.gap < second,
  };
}
