import type { GearCeiling, GearSlot } from '../types';
import { statKey } from './gear';
import { Option, Spec, optionsFor } from './gearCatalog';
import { snap } from './gearMatch';

/**
 * Reading a piece off the game's Afinación screen.
 *
 * The screen is a gift for this: six attribute lines at predictable places,
 * each with a bar underneath whose fill is that roll as a fraction of its own
 * maximum. The bars are measured in pixels rather than read as text, which is
 * both more reliable than OCR and the only way to recover a line whose name
 * ran long enough that the game clipped the value off the end of it.
 *
 * The engine is loaded from a CDN on demand rather than shipped: it is fifteen
 * megabytes that most visits never need.
 */
const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

export interface ReadLine {
  position: number;
  /**
   * The catalogue entry this line was snapped onto, by its English key.
   *
   * Null only when the row had no readable name at all. Anything with letters
   * in it resolves to one of the pool's entries, because the pool is closed and
   * "none of these" is not an available answer -- see `sure` for how much that
   * answer is worth.
   */
  key: string | null;
  /** The Spanish name of that entry, which is what the member sees. */
  label: string;
  /**
   * The reading landed on its entry cleanly and with daylight to the next one.
   *
   * False does not mean wrong, it means unchecked: the line still holds a real
   * attribute from the real pool, and the form marks it so somebody confirms
   * before it becomes their gear.
   */
  sure: boolean;
  value: number | null;
  unit: 'flat' | 'percent';
  fill: number | null;
  committed: boolean;
  truncated: boolean;
  tuning?: 'normal' | 'arena';
  /** Gold or violet, as drawn. Carried through, not interpreted. */
  hue?: 'gold' | 'violet';
  /** What the engine actually returned, for when the tidied name looks wrong. */
  raw: string;
  /**
   * The bar and the text disagree about this line, so one of them misread.
   *
   * They are independent measurements of the same roll, which is what makes
   * the check worth anything: the engine confuses this font's 1 with a 7, and
   * a "7.7" whose bar says 96% of a 7.39 ceiling is plainly a 7.1. Flagged
   * rather than corrected -- the suggestion is offered and the member decides.
   */
  suspect: number | null;
}

export interface ReadPiece {
  name: string | null;
  level: number | null;
  /**
   * Carried up from an older set, which freezes every line.
   *
   * The game says so itself: the level chip reads "Retransmisión · Nivel 66"
   * instead of plain "Nivel 91". Worth taking from the picture rather than
   * asking for, because it is the difference between a piece with advice worth
   * giving and one there is nothing to say about.
   */
  relayed: boolean;
  /** Days the screen says are left before this piece can be tuned again. */
  days: number | null;
  /** The account the screenshot was taken on, printed in its bottom corner. */
  uid: string | null;
  lines: ReadLine[];
}

async function engine(): Promise<{ createWorker: (lang: string) => Promise<any> }> {
  const loaded = (window as unknown as { Tesseract?: unknown }).Tesseract;
  if (loaded) return loaded as { createWorker: (lang: string) => Promise<any> };
  await new Promise<void>((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = TESSERACT;
    tag.onload = () => resolve();
    tag.onerror = () => reject(new Error('No se pudo descargar el lector'));
    document.head.appendChild(tag);
  });
  return (window as unknown as { Tesseract: { createWorker: (lang: string) => Promise<any> } }).Tesseract;
}

function frame(img: HTMLImageElement) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return { w: canvas.width, h: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
}

interface Bar {
  y: number;
  fill: number;
  hue: 'gold' | 'violet';
}

/**
 * The bars, found by their shape rather than at fixed heights.
 *
 * A row grows taller when its name wraps to two or three lines, so nothing sits
 * where it did on the last piece. What does not change is that a bar is a long
 * unbroken bright run starting at the same left edge, which no text ever is.
 *
 * The far end of the track is found by comparing the bar's row against the
 * background a few pixels above it. Against an absolute threshold the drifting
 * gradient behind the panel reads as track and every bar measures full.
 */
function bars(img: HTMLImageElement): Bar[] {
  const { w, h, data } = frame(img);
  const lum = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return (data[i] + data[i + 1] + data[i + 2]) / 3;
  };

  const left = Math.round(w * 0.1042);
  const shortest = Math.round(w * 0.09);
  const hits: number[] = [];
  for (let y = Math.round(h * 0.28); y < Math.round(h * 0.9); y++) {
    let run = 0;
    while (run < w * 0.3 && left + run < w && lum(left + run, y) > 120) run++;
    if (run > shortest) hits.push(y);
  }

  const bands: number[][] = [];
  for (const y of hits) {
    const last = bands[bands.length - 1];
    if (last && y - last[last.length - 1] <= 3) last.push(y);
    else bands.push([y]);
  }

  return bands.map((band) => {
    const y = band[Math.floor(band.length / 2)];
    let filled = left;
    while (filled < w && lum(filled, y) > 120) filled++;

    let track = filled;
    let gap = 0;
    for (let x = filled; x < w * 0.4; x++) {
      const above = (lum(x, y - 11) + lum(x, y - 13)) / 2;
      if (lum(x, y) - above > 7) {
        track = x;
        gap = 0;
      } else if (++gap > 10) break;
    }

    // Read and passed on, but never interpreted. On the Afinación screen only
    // the first bar was violet, which read as "the line that cannot be
    // rerolled"; on a relayed piece four of six are. So it is carried through
    // to be drawn the way the game draws it, and nothing is inferred from it.
    const mid = (y * w + Math.round(left + (filled - left) / 2)) * 4;
    return {
      y,
      fill: Math.min(1, (filled - left) / Math.max(1, track - left)),
      hue: data[mid + 2] > data[mid] + 12 ? 'violet' : 'gold',
    };
  });
}

/**
 * A slice of the screen, inverted and stretched before it is read.
 *
 * Light text on a dark panel is the worst case for an engine trained on print.
 * The contrast is stretched to whatever range the slice actually occupies
 * rather than to a fixed threshold, because the help box in the corner is grey
 * on grey and a fixed one erases it completely.
 */
function slice(
  img: HTMLImageElement,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  zoom = 3,
): HTMLCanvasElement {
  const w = Math.max(1, Math.round(x1 - x0));
  const h = Math.max(1, Math.round(y1 - y0));
  const canvas = document.createElement('canvas');
  canvas.width = w * zoom;
  canvas.height = h * zoom;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, x0, y0, w, h, 0, 0, canvas.width, canvas.height);

  const picture = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = picture.data;
  let low = 255;
  let high = 0;
  for (let i = 0; i < px.length; i += 4) {
    const grey = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    if (grey < low) low = grey;
    if (grey > high) high = grey;
  }
  const span = Math.max(1, high - low);
  for (let i = 0; i < px.length; i += 4) {
    const grey = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    px[i] = px[i + 1] = px[i + 2] = 255 - ((grey - low) / span) * 255;
    px[i + 3] = 255;
  }
  ctx.putImageData(picture, 0, 0);
  return canvas;
}

const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * One row's text, pulled apart into an attribute and what it rolled.
 *
 * Missing value means the game clipped the line rather than that the engine
 * failed: a name long enough to wrap three times pushes its own figure off the
 * end, and it is gone from the picture entirely. That is not a defeat -- the
 * bar is still there, and the value comes back from it once the attribute's
 * ceiling is known.
 */
function parseRow(
  raw: string,
  position: number,
  pool: Option[],
  overrides?: ReadonlyMap<string, string>,
): ReadLine | null {
  let text = tidy(raw).replace(/\s*\/\s*/g, ' ');
  if (!text) return null;

  // "[Girar]" is the game flagging the line already rerolled. It marks the
  // line and then comes off, so the attribute keys the same either way.
  const marker = /\[\s*[cg]\s*[il]\s*r\s*a\s*r\s*\]/i;
  const committed = marker.test(text);
  text = text.replace(marker, ' ');

  const figures = [...text.matchAll(/\+\s*([\d]+(?:[.,]\d+)?)\s*(%?)/g)];
  const last = figures[figures.length - 1];

  let value: number | null = null;
  let unit: 'flat' | 'percent' = 'flat';
  let name = text;
  if (last) {
    value = Number(last[1].replace(',', '.'));
    unit = last[2] === '%' ? 'percent' : 'flat';
    name = text.slice(0, last.index);
  }

  // Whatever the engine hallucinated in the panel's texture around the words.
  name = tidy(name)
    .replace(/[^\p{L}\p{N}\s().-]/gu, ' ')
    .replace(/(^|\s)[^\p{L}]{1,2}(?=\s|$)/gu, ' ');
  name = tidy(name);
  if (!name && value === null) return null;

  // Snap onto the pool this line is allowed to hold. Whatever the engine made
  // of the pixels, the answer is one of these or the line stays empty for the
  // member to pick -- it is never a new attribute nobody can match again.
  const hit = snap(name, pool, overrides);

  if (hit) {
    // The unit belongs to the attribute, not to the roll. Tasa Crítica is a
    // percentage whether or not the "%" survived the engine, and a per-piece
    // guess would have half the guild's readings disagreeing about it. Where
    // the catalogue does not claim one, what was read stands.
    if (hit.entry.unit) unit = hit.entry.unit;
  }

  return {
    position,
    key: hit?.entry.key ?? null,
    label: hit ? overrides?.get(hit.entry.key) ?? hit.entry.es : name,
    sure: hit?.sure ?? false,
    value,
    unit,
    fill: null,
    committed: position >= 2 && position <= 5 && committed,
    truncated: value === null,
    raw: tidy(raw),
    suspect: null,
  };
}

export interface ReadOptions {
  /** What the guild has learned about how high each attribute rolls. */
  ceilings?: GearCeiling[];
  /**
   * The path this set is built for, which decides both dropdown pools.
   *
   * Required rather than optional, and it is the reason the set has to be
   * created before a screenshot can be read into it: without a spec there is no
   * pool, and without a pool the reader is back to believing the engine.
   */
  spec: Spec | undefined;
  /** Which piece this is, which decides the line-six pool. */
  slot: GearSlot;
  /** Spanish names the guild has corrected, by English key. */
  overrides?: ReadonlyMap<string, string>;
}

/** Everything one screenshot of the Afinación screen has to say. */
export async function readPiece(
  img: HTMLImageElement,
  say: (step: string) => void = () => {},
  { ceilings = [], spec, slot, overrides }: ReadOptions,
): Promise<ReadPiece> {
  const statPool = optionsFor(spec, slot, 1);
  const sixthPool = optionsFor(spec, slot, 6);
  const found = bars(img);
  const { w, h } = frame(img);

  say('Descargando el lector...');
  const Tesseract = await engine();
  const worker = await Tesseract.createWorker('spa');

  try {
    const read = async (c: HTMLCanvasElement) => tidy((await worker.recognize(c)).data.text);

    say('Leyendo la cabecera...');
    const name = await read(slice(img, w * 0.06, h * 0.135, w * 0.6, h * 0.205));
    const levelText = await read(slice(img, w * 0.1, h * 0.23, w * 0.3, h * 0.28));
    const daysText = await read(slice(img, w * 0.62, h * 0.79, w * 0.94, h * 0.87));
    const idText = await read(slice(img, 0, h * 0.955, w * 0.14, h * 0.995));

    const lines: ReadLine[] = [];
    for (let i = 0; i < found.length && lines.length < 6; i++) {
      say(`Leyendo la línea ${i + 1}...`);
      const top = i === 0 ? h * 0.3 : found[i - 1].y + 6;
      const position = lines.length + 1;
      const row = parseRow(
        await read(slice(img, w * 0.1, top, w * 0.3, found[i].y - 3)),
        position,
        position === 6 ? sixthPool : statPool,
        overrides,
      );
      if (row) {
        row.fill = found[i].fill;
        row.hue = found[i].hue;
        lines.push(row);
      }
    }

    // A sixth line whose name runs to three lines pushes its own bar off the
    // bottom of the panel, so what is left below the last bar is that row --
    // read without a bar, which costs it only its fill.
    if (lines.length < 6 && found.length) {
      say('Leyendo la última línea...');
      const position = lines.length + 1;
      const tail = parseRow(
        await read(slice(img, w * 0.1, found[found.length - 1].y + 6, w * 0.3, h * 0.88)),
        position,
        position === 6 ? sixthPool : statPool,
        overrides,
      );
      if (tail && tail.label.length > 3) lines.push(tail);
    }

    // The sixth is the unlimited slot, and its two tunings are separate lists.
    // Only the switched-on one is ever on screen.
    const sixth = lines.find((l) => l.position === 6);
    if (sixth) sixth.tuning = 'normal';

    // The bar checks the text. Where a ceiling is known, fill x ceiling is a
    // second reading of the same figure, and the two only disagree when one of
    // them is wrong -- almost always the engine, on a digit.
    const guessLevel = levelText.match(/(\d{2,3})/);
    const itemLevel = guessLevel ? Number(guessLevel[1]) : null;
    for (const line of lines) {
      if (line.value === null || line.fill === null || !line.key) continue;
      const known = ceilings.find((c) => c.stat === statKey(line.key!) && c.level === itemLevel);
      if (!known) continue;
      // Rounded to the precision the game itself prints, because the bar is
      // only good to about a percent and offering "7.12" against a screen that
      // says "7.1" invites somebody to type in a figure the game never showed.
      const places = (String(line.value).split('.')[1] ?? '').length;
      const fromBar = Number((known.ceiling * line.fill).toFixed(places));
      // A percent of slack for the bar's own precision, and a floor so tiny
      // figures do not trip on rounding.
      const slack = Math.max(0.05, fromBar * 0.04);
      if (Math.abs(fromBar - line.value) > slack) line.suspect = fromBar;
    }

    const level = levelText.match(/(\d{2,3})/);
    const days = daysText.match(/cada\s*(\d+)\s*d[ií]a/i) ?? daysText.match(/(\d+)\s*d[ií]a/i);
    const uid = idText.match(/(\d{6,})/);

    return {
      name: tidy(name.replace(/^[^\p{L}]+/u, '')) || null,
      level: level ? Number(level[1]) : null,
      relayed: /retransmisi/i.test(levelText),
      days: days ? Number(days[1]) : null,
      uid: uid ? uid[1] : null,
      lines,
    };
  } finally {
    await worker.terminate();
  }
}
