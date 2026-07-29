import React, { useEffect, useState } from 'react';
import { FIGURES } from './WarHistory';

/**
 * Reading the results screen.
 *
 * The engine is loaded from a CDN on demand rather than shipped: it is fifteen
 * megabytes that most visits never need, and the alternative is making every
 * page load pay for a screen that is read once a week.
 */
const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

interface Word {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/** Accents and case are noise when matching against a roster we already know. */
const plain = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

function closeness(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  // Levenshtein, as a ratio of the longer string.
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
  return 1 - rows[b.length][a.length] / Math.max(a.length, b.length);
}

/**
 * Light text on a dark panel is the worst case for an OCR engine trained on
 * print, so the picture is inverted and stretched before it is read.
 */
function prepare(source: HTMLImageElement): HTMLCanvasElement {
  const scale = Math.min(2.5, Math.max(1, 2200 / source.naturalWidth));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.naturalWidth * scale);
  canvas.height = Math.round(source.naturalHeight * scale);

  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = frame.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const grey = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    // Inverted, then pushed towards black and white: the figures are bright on
    // a dark panel, and everything in between is the panel's own texture.
    const value = 255 - grey;
    const hard = value < 90 ? 0 : value > 165 ? 255 : value;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = hard;
    pixels[i + 3] = 255;
  }
  ctx.putImageData(frame, 0, 0);
  return canvas;
}

/** Every word the engine found, whatever shape this version returns them in. */
function words(data: unknown): Word[] {
  const box = data as {
    words?: Word[];
    blocks?: { paragraphs: { lines: { words: Word[] }[] }[] }[];
  };
  if (box.words?.length) return box.words;
  return (box.blocks ?? []).flatMap((block) =>
    (block.paragraphs ?? []).flatMap((para) => (para.lines ?? []).flatMap((line) => line.words ?? [])),
  );
}

/**
 * A figure, allowing for the two letters an engine reads digits as.
 *
 * A zero comes back as the letter o often enough that rejecting it threw away
 * every row that had one -- which, on a results screen, is most of them. The
 * substitution is only made where it cannot damage a name: a lone character, or
 * a token that already contains digits.
 */
function figure(raw: string): number | null {
  const token = raw.replace(/[.,\s]/g, '');
  if (!token) return null;
  const safe = token.length === 1 || /[0-9]/.test(token);
  const digits = safe ? token.replace(/[oO]/g, '0').replace(/[lI|]/g, '1') : token;
  return /^[0-9]{1,12}$/.test(digits) ? Number(digits) : null;
}

/**
 * No single column holds more than this. It is a ceiling, not a rule: where to
 * cut a run of digits is decided by where the next column starts, and this only
 * catches a cut that came out longer than any real figure could be.
 */
const MAX_DIGITS = 8;

/** A run of digits and where it sits, which is what says which column it is. */
interface Cell {
  digits: string;
  x0: number;
  x1: number;
  /** Rescued from a token that was not clean digits: worth a second look. */
  dirty: boolean;
}

/**
 * A run of digits, and whether it had to be rescued to become one.
 *
 * The engine sometimes frames a figure in brackets it invented -- poKer's
 * nought came back as "[4" -- and rejecting that threw away the whole row,
 * seven good figures with it. The brackets come off and the figure is marked
 * instead: one cell to check beats eight to type.
 */
function asDigits(raw: string): { digits: string; dirty: boolean } | null {
  const token = raw.replace(/[.,\s]/g, '');
  if (!token) return null;

  // Letters only stand in for digits where they cannot be part of a name.
  const safe = token.length === 1 || /[0-9]/.test(token);
  const mapped = safe ? token.replace(/[oO]/g, '0').replace(/[lI|]/g, '1') : token;
  if (/^[0-9]{1,18}$/.test(mapped)) return { digits: mapped, dirty: false };

  const stripped = mapped.replace(/[[\]()<>{}_]/g, '');
  if (safe && /^[0-9]{1,18}$/.test(stripped)) return { digits: stripped, dirty: true };
  return null;
}

/**
 * Where each column begins, taken from the rows that came out whole.
 *
 * Values are set flush left under their heading, so the left edge of a figure
 * is the steadiest thing about it -- widths change from row to row, centres
 * move with them, and left edges do not.
 */
function measure(rows: { cells: Cell[] }[]): number[] | null {
  const whole = rows.filter((row) => row.cells.length === FIGURES.length);
  if (whole.length < 2) return null;
  return FIGURES.map((_, at) => {
    const edges = whole.map((row) => row.cells[at].x0).sort((a, b) => a - b);
    return edges[Math.floor(edges.length / 2)];
  });
}

/**
 * Read a row against the columns, cutting a figure in two where it has run
 * into its neighbour.
 *
 * A wide number leaves no gap before the next column and comes back as one
 * long run of digits. Nothing in the digits says where to divide them -- only
 * where the next column starts does, so the cut is made at that point and the
 * digits fall either side of it.
 */
function place(cells: Cell[], columns: number[]): {
  slots: (number | null)[];
  split: Set<number>;
} {
  const slots: (number | null)[] = FIGURES.map(() => null);
  // Which figures had to be cut out of a run shared with their neighbour. Those
  // are the ones worth a second look: where two figures touch, the engine reads
  // the digits at the join wrongly as often as it reads them at all.
  const split = new Set<number>();
  /** Where the run currently holding each column began. */
  const taken = new Map<number, number>();

  for (const cell of cells) {
    const covered = columns
      .map((edge, at) => ({ at, edge }))
      .filter(({ edge }) => edge >= cell.x0 - 6 && edge < cell.x1);

    if (covered.length > 1) {
      const width = (cell.x1 - cell.x0) / cell.digits.length;
      let from = 0;
      covered.forEach(({ at }, index) => {
        const next = covered[index + 1];
        const upto = next
          ? Math.max(
              from + 1,
              Math.min(cell.digits.length - 1, from + MAX_DIGITS, Math.round((next.edge - cell.x0) / width)),
            )
          : cell.digits.length;
        const piece = cell.digits.slice(from, upto);
        if (piece && slots[at] === null) {
          slots[at] = Number(piece);
          split.add(at);
        }
        from = upto;
      });
      continue;
    }

    let best = 0;
    columns.forEach((edge, at) => {
      if (Math.abs(edge - cell.x0) < Math.abs(columns[best] - cell.x0)) best = at;
    });

    // The panel behind the table shows through, and the ghost of it reads as
    // stray digits. Where two runs claim a column the nearer one wins, rather
    // than whichever happened to come first: the real figure sits on the
    // column's edge and the ghost only drifts near it.
    const held = taken.get(best);
    if (held !== undefined && Math.abs(columns[best] - held) <= Math.abs(columns[best] - cell.x0)) {
      continue;
    }

    // Longer than any real figure and the next column empty: the two ran
    // together without the engine even leaving a gap to notice.
    if (cell.digits.length > MAX_DIGITS && best + 1 < FIGURES.length && slots[best + 1] === null) {
      const width = (cell.x1 - cell.x0) / cell.digits.length;
      const edge = columns[best + 1];
      const cut = Math.max(
        1,
        Math.min(
          MAX_DIGITS,
          cell.digits.length - 1,
          edge > cell.x0 ? Math.round((edge - cell.x0) / width) : MAX_DIGITS,
        ),
      );
      if (slots[best] === null) slots[best] = Number(cell.digits.slice(0, cut));
      slots[best + 1] = Number(cell.digits.slice(cut));
      split.add(best).add(best + 1);
      taken.set(best, cell.x0);
      continue;
    }

    slots[best] = Number(cell.digits);
    taken.set(best, cell.x0);
    if (cell.dirty) split.add(best);
  }

  return { slots, split };
}

export interface ReadRow {
  /** What the picture said the name was. */
  read: string;
  /** Who that turned out to be, if anyone. */
  playerId: string | null;
  confidence: number;
  figures: Record<string, number>;
  /** Figures recovered from a run shared with the next column: check these. */
  doubtful: string[];
  /** Read from the copy the screen pins under the table, not from the table. */
  pinned?: boolean;
}

interface Props {
  images: string[];
  participants: { playerId: string; name: string }[];
  onClose: () => void;
  onApply: (rows: ReadRow[]) => Promise<void>;
}

const ResultsReader: React.FC<Props> = ({ images, participants, onClose, onApply }) => {
  const [stage, setStage] = useState<'idle' | 'loading' | 'reading' | 'done' | 'failed'>('idle');
  const [progress, setProgress] = useState('');
  const [rows, setRows] = useState<ReadRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (stage === 'idle') void read();
  }, []);

  const engine = async () => {
    const loaded = (window as unknown as { Tesseract?: unknown }).Tesseract;
    if (loaded) return loaded as { createWorker: (lang: string) => Promise<any> };
    await new Promise<void>((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = TESSERACT;
      tag.onload = () => resolve();
      tag.onerror = () => reject(new Error('No se pudo descargar el lector'));
      document.head.appendChild(tag);
    });
    return (window as unknown as { Tesseract: { createWorker: (lang: string) => Promise<any> } })
      .Tesseract;
  };

  const read = async () => {
    setError(null);
    setStage('loading');
    setProgress('Descargando el lector...');

    let worker: any;
    try {
      const Tesseract = await engine();
      worker = await Tesseract.createWorker('eng');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el lector');
      setStage('failed');
      return;
    }

    const known = participants.map((p) => ({ ...p, plain: plain(p.name) }));
    const found = new Map<string, ReadRow>();
    // Every row from every image, kept whole until the columns are known.
    const harvest: { name: string; cells: Cell[]; pinned: boolean }[] = [];

    try {
      setStage('reading');
      for (const [index, source] of images.entries()) {
        setProgress(`Leyendo imagen ${index + 1} de ${images.length}...`);

        // Loaded the old way rather than with decode(): decode() never settles
        // for an image that was never put in the document, and this one exists
        // only to be drawn onto a canvas.
        const picture = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('No se pudo abrir la imagen'));
          img.src = source;
        });
        const { data } = await worker.recognize(prepare(picture));

        // Words come back scattered; the table is rebuilt from where they sit.
        const all = words(data).filter((w) => w.text.trim());
        const heights = all.map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
        const line = (heights[Math.floor(heights.length / 2)] || 20) * 0.9;

        // Grouped against the row's running centre rather than its first word:
        // an apostrophe or a tall glyph lifts a single box, and one odd word
        // should not decide where the whole row sits.
        const lines: { centre: number; words: Word[] }[] = [];
        for (const word of [...all].sort(
          (a, b) => (a.bbox.y0 + a.bbox.y1) / 2 - (b.bbox.y0 + b.bbox.y1) / 2,
        )) {
          const middle = (word.bbox.y0 + word.bbox.y1) / 2;
          const row = lines[lines.length - 1];
          if (row && Math.abs(row.centre - middle) < line) {
            row.words.push(word);
            row.centre = row.words.reduce((sum, w) => sum + (w.bbox.y0 + w.bbox.y1) / 2, 0) / row.words.length;
          } else {
            lines.push({ centre: middle, words: [word] });
          }
        }

        const fromHere: { name: string; cells: Cell[] }[] = [];

        for (const { words: row } of lines) {
          row.sort((a, b) => a.bbox.x0 - b.bbox.x0);

          const cells: Cell[] = [];
          const letters: string[] = [];
          for (const word of row) {
            const read = asDigits(word.text);
            if (read) {
              cells.push({ ...read, x0: word.bbox.x0, x1: word.bbox.x1 });
            } else {
              letters.push(word.text);
            }
          }
          // Two columns short would be a heading, a tab label or the frame rate
          // in the corner. One short is the overlap, and it can be repaired.
          if (cells.length < FIGURES.length - 1) continue;

          const name = letters.join(' ').trim();
          if (!name) continue;

          fromHere.push({ name, cells });
        }

        // The screen shows seven rows and pins the reader's own beneath them,
        // on a pale band that reads badly. Marked rather than dropped: the
        // pinned row is not always the last one that survives reading, and
        // dropping the last blindly threw away a real member instead. Marked,
        // it simply loses to any other sighting of the same person.
        fromHere.forEach((row, at) =>
          harvest.push({ ...row, pinned: fromHere.length > 1 && at === fromHere.length - 1 }),
        );
      }

      // Where the columns are is measured from the rows that came out whole,
      // and the rest are read against them. Two figures with no gap between
      // them arrive as one number, and only their position says where to cut.
      const columns = measure(harvest);

      for (const { name, cells, pinned } of harvest) {
        const read = columns
          ? place(cells, columns)
          : {
              slots: cells.map((c) => Number(c.digits)),
              split: new Set<number>(cells.flatMap((c, at) => (c.dirty ? [at] : []))),
            };
        const numbers = read.slots;
        if (numbers.length !== FIGURES.length || numbers.some((n) => n === null)) continue;

        // The portrait and its badges come back as a word or two of nonsense in
        // front of the name, which drags every score down and sinks the close
        // calls -- LuisGz read as "PR Ra 1S) LuisCz" and matched nobody. So
        // each word is tried on its own as well as the line as a whole.
        const target = plain(name);
        const attempts = [target, ...name.split(/\s+/).map(plain)].filter((t) => t.length >= 3);

        let best: { playerId: string; score: number } | null = null;
        for (const member of known) {
          let score = 0;
          for (const attempt of attempts) {
            score = Math.max(
              score,
              closeness(attempt, member.plain),
              // A name cut short by the avatar still identifies its owner.
              member.plain.startsWith(attempt) && attempt.length >= 4 ? 0.9 : 0,
            );
          }
          if (!best || score > best.score) best = { playerId: member.playerId, score };
        }

        const figures: Record<string, number> = {};
        FIGURES.forEach((column, at) => {
          figures[column.key] = numbers[at] as number;
        });

        const entry: ReadRow = {
          read: name,
          playerId: best && best.score >= 0.6 ? best.playerId : null,
          confidence: best?.score ?? 0,
          figures,
          doubtful: FIGURES.filter((_, at) => read.split.has(at)).map((column) => column.key),
        };

        // Pages overlap when scrolled and the reader's own row is pinned to
        // every one of them, so the same person turns up more than once. A
        // sighting in the table proper beats the pinned copy; between equals,
        // the one whose name was read most surely.
        const key = entry.playerId ?? `?${target}`;
        const seen = found.get(key);
        const better =
          !seen ||
          (seen.pinned && !pinned) ||
          (seen.pinned === pinned && entry.confidence > seen.confidence);
        if (better) found.set(key, { ...entry, pinned });
      }

      setRows([...found.values()]);
      setStage('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo leer');
      setStage('failed');
    } finally {
      await worker?.terminate?.();
    }
  };

  const matched = rows.filter((r) => r.playerId);

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-5xl my-8">
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <div>
            <h2 className="cinzel text-2xl font-bold text-amber-500">Leer resultados</h2>
            <p className="text-xs text-slate-500 mt-1">
              Lo leído se revisa antes de guardarse. Corrige lo que haga falta.
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-amber-500 transition-all">
            <i className="fa-solid fa-xmark text-xl"></i>
          </button>
        </div>

        <div className="p-6 space-y-4">
          {(stage === 'loading' || stage === 'reading') && (
            <p className="text-sm text-slate-400 flex items-center gap-3">
              <i className="fa-solid fa-circle-notch fa-spin"></i>
              {progress}
            </p>
          )}

          {error && (
            <div className="text-sm rounded-lg px-4 py-2 flex items-center gap-3 border bg-red-950/60 border-red-900 text-red-200">
              <i className="fa-solid fa-triangle-exclamation"></i>
              {error}
            </div>
          )}

          {stage === 'done' && (
            <>
              <p className="text-sm text-slate-400">
                {matched.length} de {rows.length} filas reconocidas.
                {rows.length > matched.length && ' Las que no coinciden con nadie se descartan.'}
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-slate-500 text-left">
                      <th className="py-1 pr-3">Leído</th>
                      <th className="py-1 pr-3">Miembro</th>
                      {FIGURES.map((f) => (
                        <th key={f.key} className="py-1 pr-3 text-right">
                          {f.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, at) => (
                      <tr key={`${row.read}-${at}`} className="border-t border-slate-800/70">
                        <td className="py-1 pr-3 text-slate-400 text-xs">{row.read}</td>
                        <td className="py-1 pr-3">
                          <select
                            value={row.playerId ?? ''}
                            onChange={(e) =>
                              setRows((prev) =>
                                prev.map((r, i) =>
                                  i === at ? { ...r, playerId: e.target.value || null } : r,
                                ),
                              )
                            }
                            className={`bg-slate-950 border rounded px-2 py-1 text-xs outline-none ${
                              row.playerId ? 'border-slate-800 text-slate-200' : 'border-amber-700 text-amber-500'
                            }`}
                          >
                            <option value="">— descartar —</option>
                            {participants.map((p) => (
                              <option key={p.playerId} value={p.playerId}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        {FIGURES.map((f) => {
                          const doubtful = row.doubtful.includes(f.key);
                          return (
                            <td
                              key={f.key}
                              title={doubtful ? 'Esta columna venía pegada a la siguiente: compruébala' : undefined}
                              className={`py-1 pr-3 text-right tabular-nums ${
                                doubtful ? 'text-amber-400 font-bold' : 'text-slate-300'
                              }`}
                            >
                              {doubtful && <i className="fa-solid fa-triangle-exclamation mr-1 text-[10px]"></i>}
                              {row.figures[f.key]?.toLocaleString('es') ?? '—'}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  onClick={onClose}
                  className="text-sm text-slate-400 hover:text-slate-200 px-4 py-2 transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => void onApply(matched)}
                  disabled={!matched.length}
                  className="bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 text-white text-sm font-bold py-2 px-6 rounded transition-all flex items-center gap-2"
                >
                  <i className="fa-solid fa-floppy-disk"></i>
                  Guardar {matched.length} filas
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResultsReader;
