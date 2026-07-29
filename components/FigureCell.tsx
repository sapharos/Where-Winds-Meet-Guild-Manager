import React, { useRef, useState } from 'react';

interface Props {
  value: number | undefined;
  /** Null clears the figure. Not called when the value did not change. */
  onChange: (value: number | null) => void;
  /** Read from a run of digits that had to be repaired: worth checking. */
  flagged?: boolean;
  /** Nobody may edit here -- a member reading a war they did not run. */
  readOnly?: boolean;
}

/**
 * One figure in a results table: text until asked otherwise.
 *
 * A table of thirty rows and eight columns rendered as input boxes reads as a
 * form to be filled rather than a record to be read, and every figure sits one
 * stray keystroke from being changed. These are war results -- mostly looked
 * at, occasionally corrected -- so editing is deliberate: double-click, or tab
 * to the cell and press Enter.
 */
const FigureCell: React.FC<Props> = ({ value, onChange, flagged = false, readOnly = false }) => {
  const [editing, setEditing] = useState(false);
  // Enter and losing focus both end an edit, and an Enter that closes the box
  // makes it lose focus too. Without this the same value is committed twice.
  const settled = useRef(false);

  const open = () => {
    settled.current = false;
    setEditing(true);
  };

  const commit = (raw: string) => {
    if (settled.current) return;
    settled.current = true;
    setEditing(false);
    const text = raw.trim();
    // Typed the way the game shows them, with thousands separators.
    const next = text === '' ? null : Number(text.replace(/[.\s]/g, ''));
    if (next !== null && !Number.isFinite(next)) return;
    if (next === (value ?? null)) return;
    onChange(next);
  };

  if (editing) {
    return (
      <input
        type="text"
        inputMode="numeric"
        autoFocus
        defaultValue={value ?? ''}
        onFocus={(e) => e.target.select()}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          // Committed here rather than by blurring the box: a window that never
          // gave it focus has none to lose, and Enter would do nothing at all.
          if (e.key === 'Enter') commit(e.currentTarget.value);
          // Escape puts back what was there rather than saving a half-typed one.
          if (e.key === 'Escape') {
            settled.current = true;
            setEditing(false);
          }
        }}
        className="w-24 bg-slate-950 border border-amber-600 rounded px-2 py-0.5 text-right tabular-nums outline-none"
      />
    );
  }

  return (
    <span
      role={readOnly ? undefined : 'button'}
      tabIndex={readOnly ? undefined : 0}
      onDoubleClick={() => !readOnly && open()}
      onKeyDown={(e) => {
        if (!readOnly && e.key === 'Enter') open();
      }}
      title={
        flagged
          ? 'Esta cifra venía pegada a la de al lado: compruébala. Doble clic para corregir.'
          : readOnly
            ? undefined
            : 'Doble clic para corregir'
      }
      className={`inline-block px-2 py-0.5 rounded tabular-nums ${
        flagged ? 'text-amber-400 font-bold' : 'text-slate-300'
      } ${readOnly ? '' : 'cursor-text hover:bg-slate-800/60 focus:outline-none focus:ring-1 focus:ring-amber-600'}`}
    >
      {flagged && <i className="fa-solid fa-triangle-exclamation mr-1 text-[10px]"></i>}
      {value === undefined || value === null ? '—' : value.toLocaleString('es')}
    </span>
  );
};

export default FigureCell;
