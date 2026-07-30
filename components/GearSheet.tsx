import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../services/authService';
import { GEAR_SLOTS, GEAR_SLOT_LABELS, GearCeiling, GearLine, GearPiece, GearSlot } from '../types';
import { KNOWN_STATS, Reading, candidates, daysUntil, read, show, stateOf } from '../services/gear';
import { readPiece } from '../services/gearReader';

const SLOT_ICONS: Record<GearSlot, string> = {
  leftWeapon: 'fa-khanda',
  rightWeapon: 'fa-khanda',
  disc: 'fa-record-vinyl',
  pendant: 'fa-gem',
  helm: 'fa-hat-cowboy',
  armor: 'fa-shirt',
  greaves: 'fa-shoe-prints',
  bracer: 'fa-mitten',
};

/** A line as it is being edited, before anything is sent. */
interface Draft {
  position: number;
  label: string;
  value: string;
  unit: GearLine['unit'];
  committed: boolean;
  tuning?: 'normal' | 'arena';
  /** Read from a screenshot, and the bar disagreed with the printed figure. */
  suspect?: number | null;
}

const blankDraft = (position: number): Draft => ({
  position,
  label: '',
  value: '',
  unit: 'flat',
  committed: false,
  ...(position === 6 ? { tuning: 'normal' as const } : {}),
});

/** Six rows always, plus the arena line when the piece carries one. */
function draftsFrom(piece: GearPiece | undefined): Draft[] {
  const rows: Draft[] = [1, 2, 3, 4, 5, 6].map(blankDraft);
  for (const line of piece?.lines ?? []) {
    const at = line.position === 6 && line.tuning === 'arena' ? -1 : line.position - 1;
    const draft: Draft = {
      position: line.position,
      label: line.label ?? line.stat,
      value: line.value === null ? '' : String(line.value),
      unit: line.unit,
      committed: line.committed,
      ...(line.position === 6 ? { tuning: line.tuning ?? 'normal' } : {}),
    };
    if (at === -1) rows.push(draft);
    else rows[at] = draft;
  }
  return rows;
}

interface Props {
  playerId: string;
  canEdit: boolean;
}

/**
 * What a member is wearing, and the one decision each piece still allows.
 *
 * The advice is deliberately thin: nothing here models damage or claims one
 * attribute is worth more than another. All it says is how far a roll sits
 * from what that attribute can reach, which the game itself reports and the
 * guild works out between them.
 */
const GearSheet: React.FC<Props> = ({ playerId, canEdit }) => {
  const [pieces, setPieces] = useState<GearPiece[] | null>(null);
  const [ceilings, setCeilings] = useState<GearCeiling[]>([]);
  const [chosen, setChosen] = useState<GearSlot | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [got, learned] = await Promise.all([
      api<GearPiece[]>(`/players/${playerId}/gear`).catch(() => []),
      api<GearCeiling[]>('/gear/ceilings').catch(() => []),
    ]);
    setPieces(got);
    setCeilings(learned);
  };

  useEffect(() => {
    void load();
  }, [playerId]);

  const bySlot = useMemo(
    () => new Map<GearSlot, GearPiece>((pieces ?? []).map((p) => [p.slot, p])),
    [pieces],
  );

  if (!pieces) return null;
  const piece = chosen ? bySlot.get(chosen) : undefined;

  const save = async (slot: GearSlot, body: unknown) => {
    setBusy(true);
    setMessage(null);
    try {
      await api(`/players/${playerId}/gear/${slot}`, { method: 'PUT', body: JSON.stringify(body) });
      await load();
      setMessage({ text: 'Pieza guardada.', ok: true });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'No se pudo guardar', ok: false });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (slot: GearSlot) => {
    if (!window.confirm('¿Borrar lo registrado de esta pieza?')) return;
    await api(`/players/${playerId}/gear/${slot}`, { method: 'DELETE' }).catch(() => undefined);
    setChosen(null);
    await load();
  };

  return (
    <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-6">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <h2 className="cinzel text-xl font-bold text-amber-500">Mi equipo</h2>
        <span className="text-[11px] text-slate-500">
          {ceilings.length
            ? `${ceilings.length} atributos con techo conocido, aprendidos del gremio`
            : 'Todavía sin techos: los aprende de lo que se vaya registrando'}
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Registra una pieza cuando te caiga algo nuevo, no hace falta hacerlas todas de golpe. Con el
        techo de un atributo conocido, el sistema dice cuánto margen te queda en cada línea.
      </p>

      {message && (
        <div
          className={`text-sm rounded-lg px-4 py-2 mb-4 flex items-center gap-3 border ${
            message.ok
              ? 'bg-emerald-950/60 border-emerald-900 text-emerald-200'
              : 'bg-red-950/60 border-red-900 text-red-200'
          }`}
        >
          <i className={`fa-solid ${message.ok ? 'fa-circle-check' : 'fa-triangle-exclamation'}`}></i>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {GEAR_SLOTS.map((slot) => (
          <SlotCard
            key={slot}
            slot={slot}
            piece={bySlot.get(slot)}
            ceilings={ceilings}
            active={chosen === slot}
            onPick={() => setChosen(chosen === slot ? null : slot)}
          />
        ))}
      </div>

      {chosen && (
        <PieceEditor
          key={chosen}
          slot={chosen}
          piece={piece}
          ceilings={ceilings}
          canEdit={canEdit}
          busy={busy}
          onSave={(body) => save(chosen, body)}
          onRemove={() => remove(chosen)}
          onClose={() => setChosen(null)}
        />
      )}
    </section>
  );
};

const STATE_LOOK: Record<string, { text: string; cls: string }> = {
  frozen: { text: 'reenviada', cls: 'border-slate-700 text-slate-400' },
  committed: { text: 'comprometida', cls: 'border-amber-700/60 text-amber-400' },
  open: { text: 'sin elegir', cls: 'border-emerald-700 text-emerald-400' },
  unknown: { text: 'sin líneas', cls: 'border-slate-800 text-slate-600' },
};

const SlotCard: React.FC<{
  slot: GearSlot;
  piece?: GearPiece;
  ceilings: GearCeiling[];
  active: boolean;
  onPick: () => void;
}> = ({ slot, piece, active, onPick }) => {
  const state = piece ? stateOf(piece) : null;
  const days = piece ? daysUntil(piece.tuneReadyAt) : null;

  return (
    <button
      onClick={onPick}
      className={`text-left p-2.5 rounded-lg border transition-all ${
        active
          ? 'border-amber-600 bg-amber-500/10'
          : piece
            ? 'border-slate-800 bg-slate-950 hover:border-slate-600'
            : 'border-dashed border-slate-800 hover:border-amber-700'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <i className={`fa-solid ${SLOT_ICONS[slot]} text-xs ${piece ? 'text-amber-500' : 'text-slate-700'}`}></i>
        <span className="text-[10px] uppercase tracking-wider text-slate-500 truncate">
          {GEAR_SLOT_LABELS[slot]}
        </span>
      </div>
      {piece ? (
        <>
          <p className="text-xs text-slate-200 truncate">{piece.name ?? 'Sin nombre'}</p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {piece.level && <span className="text-[10px] text-slate-500">nv {piece.level}</span>}
            {state && (
              <span className={`text-[9px] uppercase tracking-wider border rounded px-1 ${STATE_LOOK[state].cls}`}>
                {STATE_LOOK[state].text}
              </span>
            )}
            {days !== null && state !== 'frozen' && (
              <span className="text-[10px] text-slate-500">
                {days === 0 ? 'lista' : `${days} d`}
              </span>
            )}
          </div>
        </>
      ) : (
        <p className="text-xs text-slate-600">Sin registrar</p>
      )}
    </button>
  );
};

/**
 * One piece: what it has, and what can still be done to it.
 *
 * The bar the game draws is not asked for. Nobody can eyeball a bar as a
 * percentage, and it is not needed by hand: with the ceiling known, the value
 * gives the share on its own. The bar is what the screenshot reader will
 * contribute later, and it is what rescues a line the game clipped.
 */
const PieceEditor: React.FC<{
  slot: GearSlot;
  piece?: GearPiece;
  ceilings: GearCeiling[];
  canEdit: boolean;
  busy: boolean;
  onSave: (body: unknown) => void;
  onRemove: () => void;
  onClose: () => void;
}> = ({ slot, piece, ceilings, canEdit, busy, onSave, onRemove, onClose }) => {
  const [name, setName] = useState(piece?.name ?? '');
  const [level, setLevel] = useState(piece?.level ? String(piece.level) : '91');
  const [relayed, setRelayed] = useState(piece?.relayed ?? false);
  const [days, setDays] = useState(() => {
    const d = daysUntil(piece?.tuneReadyAt ?? null);
    return d === null ? '' : String(d);
  });
  const [rows, setRows] = useState<Draft[]>(() => draftsFrom(piece));
  const [reading, setReading] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /**
   * Fill the form from a screenshot of the Afinación screen.
   *
   * It fills the form rather than saving, because the form is the review: the
   * engine confuses this font's 1 with a 7 often enough that anything it reads
   * should pass under a human eye before it becomes somebody's gear.
   */
  const scan = async (blob: Blob) => {
    setNote(null);
    setReading('Preparando...');
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('No se pudo abrir la imagen'));
        i.src = URL.createObjectURL(blob);
      });
      const got = await readPiece(img, setReading, ceilings);
      if (!got.lines.length) throw new Error('No encontré líneas de atributo. ¿Es la pantalla de Afinación?');

      if (got.name) setName(got.name);
      if (got.level) setLevel(String(got.level));
      if (got.days !== null) setDays(String(got.days));

      const next: Draft[] = [1, 2, 3, 4, 5, 6].map(blankDraft);
      for (const line of got.lines) {
        next[line.position - 1] = {
          position: line.position,
          label: line.label,
          value: line.value === null ? '' : String(line.value),
          unit: line.unit,
          committed: line.committed,
          suspect: line.suspect,
          ...(line.position === 6 ? { tuning: line.tuning ?? 'normal' } : {}),
        };
      }
      setRows(next);

      const clipped = got.lines.filter((l) => l.truncated).length;
      const odd = got.lines.filter((l) => l.suspect !== null).length;
      setNote(
        [
          `Leídas ${got.lines.length} líneas.`,
          clipped ? `${clipped} venía recortada por el juego: su valor sale de la barra.` : '',
          odd ? `${odd} no cuadra con su barra, están marcadas.` : '',
          'Revisa antes de guardar.',
        ]
          .filter(Boolean)
          .join(' '),
      );
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'No se pudo leer la captura');
    } finally {
      setReading(null);
    }
  };

  // Pegar es como llega una captura de verdad: se toma con el teclado y se
  // suelta aquí, sin que ningún fichero toque el disco.
  useEffect(() => {
    if (!canEdit) return;
    const onPaste = (event: ClipboardEvent) => {
      for (const item of event.clipboardData?.items ?? []) {
        if (!item.type.startsWith('image/')) continue;
        const blob = item.getAsFile();
        if (blob) {
          event.preventDefault();
          void scan(blob);
        }
        return;
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [canEdit, ceilings]);

  const put = (at: number, patch: Partial<Draft>) =>
    setRows((prev) => prev.map((r, i) => (i === at ? { ...r, ...patch } : r)));

  // Only one of lines 2..5 can ever be the committed one, so choosing is
  // choosing -- picking a second silently clears the first, exactly as the
  // game's own radio group does.
  const commit = (at: number) =>
    setRows((prev) =>
      prev.map((r, i) => ({
        ...r,
        committed: r.position >= 2 && r.position <= 5 ? i === at : false,
      })),
    );

  const submit = () => {
    const lvl = Number(level);
    onSave({
      name: name.trim() || null,
      level: Number.isFinite(lvl) ? lvl : null,
      relayed,
      tuneReadyAt:
        days.trim() === '' ? null : new Date(Date.now() + Number(days) * 86400000).toISOString(),
      capturedAt: new Date().toISOString(),
      lines: rows
        .filter((r) => r.label.trim())
        .map((r) => ({
          position: r.position,
          label: r.label.trim(),
          value: r.value.trim() === '' ? null : Number(r.value.replace(',', '.')),
          unit: r.unit,
          committed: r.committed,
          truncated: r.value.trim() === '',
          ...(r.position === 6 ? { tuning: r.tuning ?? 'normal', active: r.tuning !== 'arena' } : {}),
        })),
    });
  };

  return (
    <div className="border border-slate-800 rounded-lg p-4 space-y-4 bg-slate-950/60">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-bold text-slate-200">
          <i className={`fa-solid ${SLOT_ICONS[slot]} text-amber-500 mr-2`}></i>
          {GEAR_SLOT_LABELS[slot]}
        </h3>
        <div className="flex items-center gap-2">
          {piece && canEdit && (
            <button onClick={onRemove} className="text-xs text-slate-500 hover:text-red-400 transition-all">
              <i className="fa-solid fa-trash-can mr-1"></i>Borrar
            </button>
          )}
          <button onClick={onClose} className="text-xs text-slate-500 hover:text-amber-500 transition-all">
            Cerrar
          </button>
        </div>
      </div>

      {piece && <Advice piece={piece} ceilings={ceilings} />}

      {canEdit && (
        <>
          <div className="flex items-center gap-3 flex-wrap border border-dashed border-slate-800 rounded p-2.5">
            <label className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 py-1.5 px-3 rounded cursor-pointer transition-all">
              <i className="fa-solid fa-image mr-1.5"></i>
              Leer captura
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void scan(file);
                  e.target.value = '';
                }}
              />
            </label>
            <span className="text-[11px] text-slate-500">
              {reading ? (
                <>
                  <i className="fa-solid fa-circle-notch fa-spin mr-1.5"></i>
                  {reading}
                </>
              ) : (
                'O pega la captura aquí con Ctrl+V. Rellena el formulario; nada se guarda hasta que lo revises.'
              )}
            </span>
          </div>

          {note && (
            <p className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-800/50 rounded px-3 py-2">
              <i className="fa-solid fa-circle-info mr-1.5"></i>
              {note}
            </p>
          )}

          <div className="grid sm:grid-cols-4 gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre de la pieza"
              className="sm:col-span-2 bg-slate-900 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
            />
            <input
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              placeholder="Nivel"
              className="bg-slate-900 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
            />
            <input
              value={days}
              onChange={(e) => setDays(e.target.value)}
              placeholder="Días para sintonizar"
              title="Los días que muestra el juego abajo a la derecha"
              className="bg-slate-900 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={relayed}
              onChange={(e) => setRelayed(e.target.checked)}
              className="accent-amber-600"
            />
            Pieza reenviada de un set anterior — todas sus líneas quedan congeladas
          </label>

          <datalist id="gear-stats">
            {KNOWN_STATS.map((s) => (
              <option key={s.name} value={s.name} />
            ))}
          </datalist>

          <div className="space-y-1.5">
            {rows.map((row, at) => (
              <div key={at} className="flex items-center gap-1.5 flex-wrap">
                <span
                  className={`w-6 h-6 shrink-0 rounded flex items-center justify-center text-[10px] font-bold ${
                    row.position === 1
                      ? 'bg-purple-500/15 text-purple-300'
                      : row.position === 6
                        ? 'bg-slate-800 text-slate-400'
                        : 'bg-slate-800 text-slate-300'
                  }`}
                  title={
                    row.position === 1
                      ? 'Fija, nunca cambia'
                      : row.position === 6
                        ? 'Sin límite de sintonizaciones'
                        : 'Candidata: solo una de las cuatro podrá cambiarse'
                  }
                >
                  {row.position}
                </span>
                <input
                  list="gear-stats"
                  value={row.label}
                  onChange={(e) => put(at, { label: e.target.value })}
                  placeholder="Atributo"
                  className="flex-1 min-w-[150px] bg-slate-900 border border-slate-800 rounded p-1.5 text-xs outline-none focus:ring-1 focus:ring-amber-500"
                />
                <input
                  value={row.value}
                  onChange={(e) => put(at, { value: e.target.value, suspect: null })}
                  placeholder="valor"
                  title={row.suspect != null ? `La barra dice ${row.suspect}. Clic para aceptarlo.` : undefined}
                  onDoubleClick={() =>
                    row.suspect != null && put(at, { value: String(row.suspect), suspect: null })
                  }
                  className={`w-20 bg-slate-900 border rounded p-1.5 text-xs text-right tabular-nums outline-none focus:ring-1 focus:ring-amber-500 ${
                    row.suspect != null ? 'border-amber-600 text-amber-300' : 'border-slate-800'
                  }`}
                />
                <select
                  value={row.unit}
                  onChange={(e) => put(at, { unit: e.target.value as GearLine['unit'] })}
                  className="bg-slate-900 border border-slate-800 rounded p-1.5 text-xs outline-none"
                >
                  <option value="flat">plano</option>
                  <option value="percent">%</option>
                </select>
                {row.position === 6 ? (
                  <select
                    value={row.tuning ?? 'normal'}
                    onChange={(e) => put(at, { tuning: e.target.value as 'normal' | 'arena' })}
                    className="bg-slate-900 border border-slate-800 rounded p-1.5 text-xs outline-none"
                  >
                    <option value="normal">normal</option>
                    <option value="arena">arena</option>
                  </select>
                ) : row.position === 1 ? (
                  <span className="text-[10px] text-slate-600 w-24">fija</span>
                ) : (
                  <label className="flex items-center gap-1 text-[10px] text-slate-500 w-24">
                    <input
                      type="radio"
                      name="committed"
                      checked={row.committed}
                      onChange={() => commit(at)}
                      className="accent-amber-600"
                    />
                    ya rolleada
                  </label>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={submit}
              disabled={busy}
              className="bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-sm font-bold py-2 px-4 rounded transition-all flex items-center gap-2"
            >
              <i className={`fa-solid ${busy ? 'fa-circle-notch fa-spin' : 'fa-floppy-disk'}`}></i>
              Guardar pieza
            </button>
            <button
              onClick={() => setRows((prev) => [...prev, blankDraft(6)])}
              className="text-xs text-slate-500 hover:text-amber-500 transition-all"
            >
              <i className="fa-solid fa-plus mr-1"></i>
              Segunda línea 6 (arena)
            </button>
            <span className="text-[11px] text-slate-600">
              Deja el valor vacío si el juego te recorta la línea: se recupera del techo.
            </span>
          </div>
        </>
      )}
    </div>
  );
};

/** What there is to say about this piece, which depends entirely on its state. */
const Advice: React.FC<{ piece: GearPiece; ceilings: GearCeiling[] }> = ({ piece, ceilings }) => {
  const state = stateOf(piece);
  const days = daysUntil(piece.tuneReadyAt);
  const sixth = piece.lines.filter((l) => l.position === 6).map((l) => read(l, piece.level, ceilings));

  if (state === 'frozen') {
    return (
      <p className="text-xs text-slate-500 border border-slate-800 rounded p-3">
        <i className="fa-solid fa-lock mr-2"></i>
        Pieza reenviada: todas sus líneas están congeladas. Lo único que cabe decidir es si vale la
        pena sustituirla.
      </p>
    );
  }

  const done = piece.lines.find((l) => l.committed);

  return (
    <div className="space-y-2">
      {done ? (
        <Committed reading={read(done, piece.level, ceilings)} days={days} />
      ) : (
        <Open readings={candidates(piece, ceilings)} days={days} />
      )}
      {sixth.length > 0 && (
        <div className="border border-slate-800 rounded p-3">
          <p className="text-[11px] text-slate-500 mb-1.5">
            Línea 6 — sin límite de sintonizaciones, siempre conviene empujarla
          </p>
          {sixth.map((r) => (
            <Row key={`${r.line.stat}-${r.line.tuning}`} reading={r} />
          ))}
        </div>
      )}
    </div>
  );
};

const Committed: React.FC<{ reading: Reading; days: number | null }> = ({ reading, days }) => (
  <div className="border border-amber-800/50 bg-amber-500/5 rounded p-3">
    <p className="text-[11px] text-amber-400 mb-1.5">
      <i className="fa-solid fa-anchor mr-1.5"></i>
      Comprometida en esta línea. Las otras tres están cerradas para siempre.
      {days !== null &&
        (days === 0 ? ' Puedes volver a tirarla ya.' : ` Puedes volver a tirarla en ${days} días.`)}
    </p>
    <Row reading={reading} />
  </div>
);

const Open: React.FC<{ readings: Reading[]; days: number | null }> = ({ readings, days }) => {
  const usable = readings.filter((r) => r.margin !== null);
  return (
    <div className="border border-emerald-800/50 bg-emerald-500/5 rounded p-3">
      <p className="text-[11px] text-emerald-300 mb-1.5">
        <i className="fa-solid fa-triangle-exclamation mr-1.5"></i>
        Ninguna línea elegida todavía. En cuanto toques una, las otras tres se cierran para siempre.
        {days !== null && days > 0 && ` Faltan ${days} días para poder tirar.`}
      </p>
      {usable.length ? (
        <>
          <p className="text-[10px] text-slate-500 mb-1">
            Ordenadas por lo lejos que están de su propio tope. Mide sitio para mejorar, no cuánto
            te conviene cada atributo: eso lo sabes tú.
          </p>
          {readings.map((r) => (
            <Row key={r.line.position} reading={r} />
          ))}
        </>
      ) : (
        <p className="text-[11px] text-slate-500">
          Todavía no se conoce el techo de estos atributos, así que no hay nada honesto que
          recomendar. Se sabrá en cuanto alguien del gremio registre una pieza que los lleve.
        </p>
      )}
    </div>
  );
};

const Row: React.FC<{ reading: Reading }> = ({ reading }) => {
  const { line, ceiling, value, share, margin } = reading;
  return (
    <div className="flex items-center gap-2 py-0.5 text-xs">
      <span className="flex-1 truncate text-slate-300">
        {line.label ?? line.stat}
        {line.truncated && (
          <span className="text-[9px] text-amber-600 ml-1.5" title="El juego recortó esta línea; el valor sale de la barra">
            recuperada
          </span>
        )}
      </span>
      <span className="tabular-nums text-slate-200 w-16 text-right">{show(value, line.unit)}</span>
      <span className="text-slate-600 w-20 text-right tabular-nums">
        {ceiling === null ? 'techo ?' : `de ${show(ceiling, line.unit)}`}
      </span>
      <span className="w-20 h-1.5 rounded bg-slate-800 overflow-hidden shrink-0">
        {share !== null && (
          <span
            className="block h-full rounded"
            style={{
              width: `${Math.round(share * 100)}%`,
              backgroundColor: share >= 0.9 ? '#fbbf24' : share >= 0.7 ? '#a3e635' : '#60a5fa',
            }}
          />
        )}
      </span>
      <span className="w-24 text-right tabular-nums text-slate-500">
        {margin === null || share === null
          ? '—'
          : share >= 0.995
            ? 'al tope'
            : `+${show(margin, line.unit)} (${Math.round((1 - share) * 100)}%)`}
      </span>
    </div>
  );
};

export default GearSheet;
