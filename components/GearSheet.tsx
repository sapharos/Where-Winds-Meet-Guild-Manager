import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../services/authService';
import {
  GEAR_SLOTS,
  GEAR_SLOT_LABELS,
  GearCeiling,
  GearLine,
  GearPiece,
  GearSet,
  GearSlot,
  PlayerBuild,
} from '../types';
import { Reading, candidates, daysUntil, entryFor, labelFor, read, show, stateOf } from '../services/gear';
import { CatalogEntry, Option, SPECS, Spec, optionsFor, specById } from '../services/gearCatalog';
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
  /**
   * The catalogue's English name for the attribute, or empty for a blank line.
   *
   * This used to be free text and is the reason for the whole change: whatever
   * the reader made of a blurry frame went straight into the field, was saved,
   * and then joined everybody's suggestions -- where it matched the next
   * identical misreading perfectly. A key from a closed list cannot do that.
   */
  key: string;
  value: string;
  unit: GearLine['unit'];
  committed: boolean;
  tuning?: 'normal' | 'arena';
  /**
   * How full the game drew this line's bar, and in which colour.
   *
   * Carried through the form rather than shown as a field, because nobody can
   * eyeball a bar as a percentage. The ceilings are learned from value / fill,
   * so dropping it here would quietly disable the point of reading the picture.
   */
  fill?: number | null;
  hue?: 'gold' | 'violet';
  /** Read from a screenshot, and the bar disagreed with the printed figure. */
  suspect?: number | null;
  /**
   * The reader had to pick between two attributes that looked alike.
   *
   * It still landed on a real one -- there is nowhere else to land -- but not
   * cleanly enough that anybody should save it without looking.
   */
  unsure?: boolean;
}

const blankDraft = (position: number): Draft => ({
  position,
  key: '',
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
      // A line saved before the catalogue existed under a name nobody could
      // map comes back with nothing selected, so the member picks the real
      // attribute rather than the piece carrying a name forever.
      key: entryFor(line.stat)?.key ?? '',
      value: line.value === null ? '' : String(line.value),
      unit: line.unit,
      committed: line.committed,
      fill: line.fill,
      hue: line.hue,
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
 * The sets a member has built, and the one decision each piece still allows.
 *
 * Gear hangs off a set rather than off the member, because a member does not
 * have "their helm" -- they have the set they take to guild war and the set
 * they farm in, and the same piece is a keeper in one and a wasted slot in the
 * other. A set names the build it is for and which of the nine paths it is
 * aiming at, and that second answer is what makes every attribute field a
 * closed dropdown instead of a text box: without it, all forty-six attributes
 * are equally plausible on every line and a screenshot's reading has nothing to
 * be checked against.
 *
 * The advice stays deliberately thin. Nothing here models damage. It says how
 * far a roll sits from what that attribute can reach, which the game itself
 * reports, and which of them the path wants, which the analyzer publishes.
 */
const GearSheet: React.FC<Props> = ({ playerId, canEdit }) => {
  const [sets, setSets] = useState<GearSet[] | null>(null);
  const [pieces, setPieces] = useState<GearPiece[]>([]);
  const [builds, setBuilds] = useState<PlayerBuild[]>([]);
  const [ceilings, setCeilings] = useState<GearCeiling[]>([]);
  const [overrides, setOverrides] = useState<{ key: string; label: string }[]>([]);
  const [openSet, setOpenSet] = useState<string | null>(null);
  const [editingSet, setEditingSet] = useState<GearSet | 'new' | null>(null);
  const [chosen, setChosen] = useState<GearSlot | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [gotSets, got, myBuilds, learned, labels] = await Promise.all([
      api<GearSet[]>(`/players/${playerId}/gear-sets`).catch(() => []),
      api<GearPiece[]>(`/players/${playerId}/gear`).catch(() => []),
      api<PlayerBuild[]>(`/players/${playerId}/builds`).catch(() => []),
      api<GearCeiling[]>('/gear/ceilings').catch(() => []),
      api<{ key: string; label: string }[]>('/gear/labels').catch(() => []),
    ]);
    setSets(gotSets);
    setPieces(got);
    setBuilds(myBuilds);
    setCeilings(learned);
    setOverrides(labels);
    setOpenSet((prev) =>
      prev && gotSets.some((s) => s.id === prev)
        ? prev
        : (gotSets.find((s) => s.isPrimary) ?? gotSets[0])?.id ?? null,
    );
  };

  useEffect(() => {
    void load();
  }, [playerId]);

  /** The corrected Spanish names, which the matcher needs as well as the eye. */
  const corrections = useMemo(
    () => new Map(overrides.map((o) => [o.key, o.label])),
    [overrides],
  );

  const set = useMemo(() => (sets ?? []).find((s) => s.id === openSet), [sets, openSet]);
  const spec = specById(set?.spec);

  const bySlot = useMemo(
    () => new Map<GearSlot, GearPiece>(pieces.filter((p) => p.setId === openSet).map((p) => [p.slot, p])),
    [pieces, openSet],
  );

  if (!sets) return null;
  const piece = chosen ? bySlot.get(chosen) : undefined;

  const savePiece = async (slot: GearSlot, body: unknown) => {
    if (!openSet) return;
    setBusy(true);
    setMessage(null);
    try {
      await api(`/players/${playerId}/gear-sets/${openSet}/${slot}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      await load();
      setMessage({ text: 'Pieza guardada.', ok: true });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'No se pudo guardar', ok: false });
    } finally {
      setBusy(false);
    }
  };

  const removePiece = async (slot: GearSlot) => {
    if (!openSet || !window.confirm('¿Borrar lo registrado de esta pieza?')) return;
    await api(`/players/${playerId}/gear-sets/${openSet}/${slot}`, { method: 'DELETE' }).catch(
      () => undefined,
    );
    setChosen(null);
    await load();
  };

  const saveSet = async (draft: Partial<GearSet>) => {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await api<{ id: string }>(`/players/${playerId}/gear-sets`, {
        method: 'PUT',
        body: JSON.stringify(draft),
      });
      setOpenSet(saved.id);
      setEditingSet(null);
      await load();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'No se pudo guardar', ok: false });
    } finally {
      setBusy(false);
    }
  };

  const removeSet = async (id: string) => {
    if (!window.confirm('¿Borrar este set entero, con sus piezas?')) return;
    await api(`/players/${playerId}/gear-sets/${id}`, { method: 'DELETE' }).catch(() => undefined);
    setChosen(null);
    setEditingSet(null);
    setOpenSet(null);
    await load();
  };

  return (
    <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-6">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <h2 className="cinzel text-xl font-bold text-amber-500">Mis sets</h2>
        <span className="text-[11px] text-slate-500">
          {ceilings.length
            ? `${ceilings.length} atributos con techo conocido, aprendidos del gremio`
            : 'Todavía sin techos: los aprende de lo que se vaya registrando'}
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Un set son ocho piezas montadas para un camino concreto. Elige el camino al crearlo: es lo que
        decide qué atributos te ofrece cada línea y contra qué se comparan tus capturas.
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

      <div className="flex items-center gap-2 flex-wrap mb-4">
        {sets.map((s) => (
          <button
            key={s.id}
            onClick={() => {
              setOpenSet(s.id);
              setChosen(null);
              setEditingSet(null);
            }}
            className={`text-left px-3 py-1.5 rounded-lg border transition-all ${
              openSet === s.id
                ? 'border-amber-600 bg-amber-500/10'
                : 'border-slate-800 bg-slate-950 hover:border-slate-600'
            }`}
          >
            <span className="text-xs font-bold text-slate-200 block">{s.name}</span>
            <span className={`text-[10px] ${s.spec ? 'text-slate-500' : 'text-amber-500'}`}>
              {specById(s.spec)?.name ?? 'sin camino'}
            </span>
          </button>
        ))}
        {canEdit && (
          <button
            onClick={() => setEditingSet('new')}
            className="text-xs px-3 py-2 rounded-lg border border-dashed border-slate-700 text-slate-400 hover:border-amber-700 hover:text-amber-500 transition-all"
          >
            <i className="fa-solid fa-plus mr-1.5"></i>
            Nuevo set
          </button>
        )}
      </div>

      {editingSet && canEdit && (
        <SetEditor
          set={editingSet === 'new' ? null : editingSet}
          builds={builds}
          busy={busy}
          onSave={saveSet}
          onCancel={() => setEditingSet(null)}
        />
      )}

      {!sets.length && !editingSet && (
        <p className="text-sm text-slate-500">
          Todavía no tienes ningún set. Crea uno, dile para qué build es y qué camino sigues, y a
          partir de ahí cada línea te ofrece solo los atributos que existen en ese camino.
        </p>
      )}

      {set && !editingSet && (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <p className="text-xs text-slate-400">
              <i className="fa-solid fa-route text-amber-600 mr-1.5"></i>
              {spec ? spec.name : 'Sin camino elegido'}
              {set.buildId && builds.find((b) => b.id === set.buildId) && (
                <span className="text-slate-600"> · {builds.find((b) => b.id === set.buildId)!.name}</span>
              )}
            </p>
            {canEdit && (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setEditingSet(set)}
                  className="text-xs text-slate-500 hover:text-amber-500 transition-all"
                >
                  <i className="fa-solid fa-pen mr-1"></i>Editar set
                </button>
                <button
                  onClick={() => removeSet(set.id)}
                  className="text-xs text-slate-500 hover:text-red-400 transition-all"
                >
                  <i className="fa-solid fa-trash-can mr-1"></i>Borrar set
                </button>
              </div>
            )}
          </div>

          {!spec && (
            <p className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-800/50 rounded px-3 py-2 mb-3">
              <i className="fa-solid fa-circle-info mr-1.5"></i>
              Este set no tiene camino. Sin él no se puede saber qué atributos ofrece cada línea ni
              leer capturas: edítalo y elige uno de los nueve.
            </p>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            {GEAR_SLOTS.map((slot) => (
              <SlotCard
                key={slot}
                slot={slot}
                piece={bySlot.get(slot)}
                active={chosen === slot}
                onPick={() => setChosen(chosen === slot ? null : slot)}
              />
            ))}
          </div>

          {chosen && (
            <PieceEditor
              key={`${set.id}-${chosen}`}
              slot={chosen}
              piece={piece}
              spec={spec}
              ceilings={ceilings}
              corrections={corrections}
              canEdit={canEdit}
              busy={busy}
              onSave={(body) => savePiece(chosen, body)}
              onRemove={() => removePiece(chosen)}
              onClose={() => setChosen(null)}
            />
          )}
        </>
      )}

      {canEdit && <Translations corrections={corrections} onDone={() => void load()} />}
    </section>
  );
};

/**
 * Naming a set, pointing it at a build, and choosing its path.
 *
 * The path is the field that matters and it is the one that cannot be changed
 * carelessly afterwards: it decides which attributes every line of every piece
 * may hold, so switching it on a set full of recorded pieces leaves lines
 * holding attributes the new path does not offer. Allowed anyway -- people do
 * respec -- but said out loud.
 */
const SetEditor: React.FC<{
  set: GearSet | null;
  builds: PlayerBuild[];
  busy: boolean;
  onSave: (draft: Partial<GearSet>) => void;
  onCancel: () => void;
}> = ({ set, builds, busy, onSave, onCancel }) => {
  const [name, setName] = useState(set?.name ?? '');
  const [buildId, setBuildId] = useState(set?.buildId ?? '');
  const [spec, setSpec] = useState(set?.spec ?? '');

  const chosen = specById(spec);

  return (
    <div className="border border-amber-800/50 bg-amber-500/5 rounded-lg p-4 space-y-3 mb-4">
      <h3 className="text-sm font-bold text-slate-200">
        {set ? 'Editar set' : 'Nuevo set'}
      </h3>

      <div className="grid sm:grid-cols-3 gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del set (p. ej. Guerra de gremio)"
          autoComplete="off"
          className="bg-slate-900 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
        />
        <select
          value={buildId}
          onChange={(e) => setBuildId(e.target.value)}
          className="bg-slate-900 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
        >
          <option value="">Sin build asignada</option>
          {builds.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
              {b.isPrimary ? ' (principal)' : ''}
            </option>
          ))}
        </select>
        <select
          value={spec}
          onChange={(e) => setSpec(e.target.value)}
          className="bg-slate-900 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
        >
          <option value="">Elige un camino…</option>
          {SPECS.map((s) => (
            <option key={s.id} value={s.id} disabled={s.pending}>
              {s.name}
              {s.pending ? ' — opciones pendientes' : ''}
            </option>
          ))}
        </select>
      </div>

      {!builds.length && (
        <p className="text-[11px] text-slate-500">
          No tienes builds registradas todavía. Puedes crear el set igualmente y asignarle una build
          más adelante desde aquí mismo.
        </p>
      )}

      {chosen && (
        <p className="text-[11px] text-slate-500">
          {chosen.recommendedStats.length
            ? `${chosen.recommendedStats.length} atributos recomendados en las líneas 1 a 5, y ${chosen.armorAttunements.length} sintonizaciones propias en la línea 6 de las piezas de armadura.`
            : 'Este camino todavía no tiene sus listas cargadas.'}
        </p>
      )}

      {set && spec && spec !== set.spec && (
        <p className="text-[11px] text-amber-300">
          <i className="fa-solid fa-triangle-exclamation mr-1.5"></i>
          Cambias el camino de un set ya montado: las líneas que guardaste con atributos que el nuevo
          camino no ofrece se quedarán sin seleccionar hasta que las vuelvas a elegir.
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={() => onSave({ ...(set ?? {}), name, buildId: buildId || null, spec })}
          disabled={busy || !name.trim()}
          className="bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-sm font-bold py-2 px-4 rounded transition-all"
        >
          <i className={`fa-solid ${busy ? 'fa-circle-notch fa-spin' : 'fa-floppy-disk'} mr-2`}></i>
          {set ? 'Guardar cambios' : 'Crear set'}
        </button>
        <button onClick={onCancel} className="text-xs text-slate-500 hover:text-amber-500 transition-all">
          Cancelar
        </button>
      </div>
    </div>
  );
};

/**
 * The Spanish names, and a way to correct the ones that are wrong.
 *
 * Fifteen of the attribute names here were read off real screenshots. The other
 * fifty-odd are translations of the English list the analyzer publishes, made
 * by me, and the game is not consistent enough with itself for a pattern drawn
 * from fifteen to get fifty right. Rather than pretend otherwise, they are
 * marked and they are editable.
 *
 * A correction reaches the screenshot matcher, not just the label. Fixing only
 * what is drawn would leave a name that goes on failing to match forever, which
 * is the more annoying half of being wrong.
 */
const Translations: React.FC<{
  corrections: ReadonlyMap<string, string>;
  onDone: () => void;
}> = ({ corrections, onDone }) => {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return CATALOGUE;
    return CATALOGUE.filter(
      (e) => e.es.toLowerCase().includes(needle) || e.key.toLowerCase().includes(needle),
    );
  }, [filter]);

  const apply = async (key: string, label: string) => {
    setBusy(key);
    try {
      await api(`/gear/labels/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify({ label }),
      });
      onDone();
    } catch {
      /* the list simply stays as it was */
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-4">
      <button
        onClick={() => setOpen(!open)}
        className="text-[11px] text-slate-500 hover:text-amber-500 transition-all flex items-center gap-2"
      >
        <i className={`fa-solid ${open ? 'fa-chevron-down' : 'fa-chevron-right'}`}></i>
        Nombres en español de los atributos
        {corrections.size > 0 && <span className="text-slate-600">· {corrections.size} corregidos</span>}
      </button>

      {open && (
        <div className="border border-slate-800 rounded p-3 mt-2 space-y-2">
          <p className="text-[11px] text-slate-500">
            Los marcados <span className="text-emerald-400">✓</span> se leyeron de capturas reales. El
            resto son traducciones del listado en inglés y puede que el juego los llame de otra
            forma: corrígelos aquí y se arregla en todas las piezas del gremio, y también en la
            lectura de capturas.
          </p>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Buscar atributo…"
            type="search"
            aria-label="Buscar atributo"
            enterKeyHint="search"
            autoComplete="off"
            className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 text-xs outline-none focus:ring-1 focus:ring-amber-500"
          />
          <div className="max-h-80 overflow-y-auto space-y-1.5 pr-1">
            {shown.map((entry) => {
              const current = corrections.get(entry.key) ?? entry.es;
              const value = draft[entry.key] ?? current;
              return (
                <div key={entry.key} className="flex items-center gap-2">
                  <span
                    className="text-[10px] text-slate-600 w-44 shrink-0 truncate font-mono"
                    title={entry.key}
                  >
                    {entry.key}
                  </span>
                  <span className="w-3 text-center shrink-0">
                    {entry.confirmed && !corrections.has(entry.key) ? (
                      <i className="fa-solid fa-check text-[9px] text-emerald-500" title="Leído de una captura real"></i>
                    ) : corrections.has(entry.key) ? (
                      <i className="fa-solid fa-pen text-[9px] text-amber-500" title="Corregido por el gremio"></i>
                    ) : null}
                  </span>
                  <input
                    value={value}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [entry.key]: e.target.value }))}
                    autoComplete="off"
                    className="flex-1 bg-slate-900 border border-slate-800 rounded p-1.5 text-xs outline-none focus:ring-1 focus:ring-amber-500"
                  />
                  <button
                    onClick={() => apply(entry.key, value)}
                    disabled={busy === entry.key || value === current}
                    className="text-xs text-amber-500 hover:text-amber-400 disabled:text-slate-700 transition-all"
                  >
                    Guardar
                  </button>
                  {corrections.has(entry.key) && (
                    <button
                      onClick={() => apply(entry.key, '')}
                      disabled={busy === entry.key}
                      className="text-xs text-slate-500 hover:text-red-400 transition-all"
                      title="Volver al nombre por defecto"
                    >
                      <i className="fa-solid fa-rotate-left"></i>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Every entry that exists anywhere, in one flat list for the corrections panel.
 *
 * Gathered by walking every path's pools rather than importing the three arrays
 * directly, so a name added to any of them shows up here to be corrected
 * without anybody remembering to add it in two places.
 */
const CATALOGUE: CatalogEntry[] = (() => {
  const seen = new Map<string, CatalogEntry>();
  for (const spec of SPECS) {
    for (const position of [1, 6]) {
      for (const slot of ['leftWeapon', 'helm'] as GearSlot[]) {
        for (const { entry } of optionsFor(spec, slot, position)) seen.set(entry.key, entry);
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.key.localeCompare(b.key));
})();

const STATE_LOOK: Record<string, { text: string; cls: string }> = {
  frozen: { text: 'reenviada', cls: 'border-slate-700 text-slate-400' },
  committed: { text: 'comprometida', cls: 'border-amber-700/60 text-amber-400' },
  open: { text: 'sin elegir', cls: 'border-emerald-700 text-emerald-400' },
  unknown: { text: 'sin líneas', cls: 'border-slate-800 text-slate-600' },
};

const SlotCard: React.FC<{
  slot: GearSlot;
  piece?: GearPiece;
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

/** One line's dropdown: everything the path allows, the good ones first. */
const StatSelect: React.FC<{
  options: Option[];
  value: string;
  corrections: ReadonlyMap<string, string>;
  onChange: (key: string) => void;
  unsure?: boolean;
}> = ({ options, value, corrections, onChange, unsure }) => {
  const good = options.filter((o) => o.recommended);
  const rest = options.filter((o) => !o.recommended);
  const name = (o: Option) => corrections.get(o.entry.key) ?? o.entry.es;
  // A line saved under a name the path does not offer -- an old free-text one,
  // or one left behind by a respec. Shown as an option of its own so the field
  // is not silently blank and so it does not vanish on the next save.
  const stray = value && !options.some((o) => o.entry.key === value) ? value : null;

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`flex-1 min-w-[220px] bg-slate-900 border rounded p-1.5 text-xs outline-none focus:ring-1 focus:ring-amber-500 ${
        unsure ? 'border-amber-600 text-amber-200' : 'border-slate-800'
      }`}
    >
      <option value="">— sin atributo —</option>
      {stray && <option value={stray}>{stray} (fuera de este camino)</option>}
      {good.length > 0 && (
        <optgroup label="Recomendados para este camino">
          {good.map((o) => (
            <option key={o.entry.key} value={o.entry.key}>
              {name(o)}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label={good.length ? 'Los demás' : 'Disponibles'}>
        {rest.map((o) => (
          <option key={o.entry.key} value={o.entry.key}>
            {name(o)}
          </option>
        ))}
      </optgroup>
    </select>
  );
};

/**
 * One piece: what it has, and what can still be done to it.
 *
 * The bar the game draws is not asked for. Nobody can eyeball a bar as a
 * percentage, and it is not needed by hand: with the ceiling known, the value
 * gives the share on its own. The bar is what the screenshot reader
 * contributes, and it is what rescues a line the game clipped.
 */
const PieceEditor: React.FC<{
  slot: GearSlot;
  piece?: GearPiece;
  spec: Spec | undefined;
  ceilings: GearCeiling[];
  corrections: ReadonlyMap<string, string>;
  canEdit: boolean;
  busy: boolean;
  onSave: (body: unknown) => void;
  onRemove: () => void;
  onClose: () => void;
}> = ({ slot, piece, spec, ceilings, corrections, canEdit, busy, onSave, onRemove, onClose }) => {
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
   * should pass under a human eye before it becomes somebody's gear. What it
   * can no longer do is invent an attribute -- every name it produces is one of
   * the path's own, and the ones it was not sure about are marked.
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
      const got = await readPiece(img, setReading, { ceilings, spec, slot, overrides: corrections });
      if (!got.lines.length) throw new Error('No encontré líneas de atributo. ¿Es la pantalla de Afinación?');

      if (got.name) setName(got.name);
      if (got.level) setLevel(String(got.level));
      if (got.days !== null) setDays(String(got.days));
      if (got.relayed) setRelayed(true);

      const next: Draft[] = [1, 2, 3, 4, 5, 6].map(blankDraft);
      for (const line of got.lines) {
        next[line.position - 1] = {
          position: line.position,
          key: line.key ?? '',
          value: line.value === null ? '' : String(line.value),
          unit: line.unit,
          committed: line.committed,
          fill: line.fill,
          hue: line.hue,
          suspect: line.suspect,
          unsure: !line.sure,
          ...(line.position === 6 ? { tuning: line.tuning ?? 'normal' } : {}),
        };
      }
      setRows(next);

      const clipped = got.lines.filter((l) => l.truncated).length;
      const odd = got.lines.filter((l) => l.suspect !== null).length;
      const shaky = got.lines.filter((l) => !l.sure).length;
      setNote(
        [
          `Leídas ${got.lines.length} líneas.`,
          got.relayed ? 'La pieza es reenviada: sus líneas están congeladas.' : '',
          clipped ? `${clipped} venía recortada por el juego: su valor sale de la barra.` : '',
          odd ? `${odd} no cuadra con su barra, están marcadas.` : '',
          shaky
            ? `${shaky} se parecía a más de un atributo del camino: elegí el más cercano y lo dejé marcado.`
            : '',
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
    if (!canEdit || !spec) return;
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
  }, [canEdit, spec, ceilings, corrections]);

  const put = (at: number, patch: Partial<Draft>) =>
    setRows((prev) => prev.map((r, i) => (i === at ? { ...r, ...patch } : r)));

  const optionOf = (row: Draft, key: string): CatalogEntry | undefined =>
    key ? optionsFor(spec, slot, row.position).find((o) => o.entry.key === key)?.entry : undefined;

  /**
   * Choosing an attribute takes its unit with it, where the catalogue knows one.
   *
   * The unit belongs to the attribute and not to the roll: Tasa Crítica is a
   * percentage however it was typed, and leaving that to be set by hand is one
   * more field to get wrong on every line of every piece.
   */
  const pick = (at: number, key: string) => {
    const entry = optionOf(rows[at], key);
    put(at, { key, unsure: false, ...(entry?.unit ? { unit: entry.unit } : {}) });
  };

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
        .filter((r) => r.key)
        .map((r) => ({
          position: r.position,
          key: r.key,
          label: corrections.get(r.key) ?? optionOf(r, r.key)?.es ?? r.key,
          value: r.value.trim() === '' ? null : Number(r.value.replace(',', '.')),
          unit: r.unit,
          committed: r.committed,
          fill: r.fill ?? null,
          hue: r.hue,
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

      {piece && <Advice piece={piece} ceilings={ceilings} corrections={corrections} />}

      {canEdit && (
        <>
          <div className="flex items-center gap-3 flex-wrap border border-dashed border-slate-800 rounded p-2.5">
            <label
              className={`text-xs py-1.5 px-3 rounded transition-all ${
                spec
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer'
                  : 'bg-slate-900 text-slate-600 cursor-not-allowed'
              }`}
            >
              <i className="fa-solid fa-image mr-1.5"></i>
              Leer captura
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={!spec}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void scan(file);
                  e.target.value = '';
                }}
              />
            </label>
            <span className="text-[11px] text-slate-500">
              {!spec ? (
                'Elige el camino del set para poder leer capturas: sin él no hay lista contra la que comprobar lo leído.'
              ) : reading ? (
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
              autoComplete="off"
              className="sm:col-span-2 bg-slate-900 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
            />
            {/* inputMode numérico: son cifras, y sin él sale el teclado
                alfabético y hay que cambiarlo a mano en cada pieza. */}
            <input
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              placeholder="Nivel"
              aria-label="Nivel de la pieza"
              inputMode="numeric"
              autoComplete="off"
              className="min-h-tap bg-slate-900 border border-slate-800 rounded px-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
            />
            <input
              value={days}
              onChange={(e) => setDays(e.target.value)}
              placeholder="Días para sintonizar"
              aria-label="Días para sintonizar"
              inputMode="numeric"
              autoComplete="off"
              title="Los días que muestra el juego abajo a la derecha"
              className="min-h-tap bg-slate-900 border border-slate-800 rounded px-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
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
                <StatSelect
                  options={optionsFor(spec, slot, row.position)}
                  value={row.key}
                  corrections={corrections}
                  unsure={row.unsure}
                  onChange={(key) => pick(at, key)}
                />
                <input
                  value={row.value}
                  onChange={(e) =>
                    put(at, {
                      value: e.target.value,
                      suspect: null,
                      // Typing over the figure the bar measured makes the two
                      // disagree, and the bar is the one that is now wrong.
                      fill: null,
                    })
                  }
                  placeholder="valor"
                  title={row.suspect != null ? `La barra dice ${row.suspect}. Doble clic para aceptarlo.` : undefined}
                  onDoubleClick={() =>
                    row.suspect != null && put(at, { value: String(row.suspect), suspect: null })
                  }
                  className={`w-20 bg-slate-900 border rounded p-1.5 text-xs text-right tabular-nums outline-none focus:ring-1 focus:ring-amber-500 ${
                    row.suspect != null ? 'border-amber-600 text-amber-300' : 'border-slate-800'
                  }`}
                />
                {optionOf(row, row.key)?.unit ? (
                  // The catalogue settles this attribute's unit, so it is shown
                  // rather than asked: a per-piece answer would have half the
                  // guild's readings of one attribute disagreeing about it.
                  <span className="w-14 text-[10px] text-slate-600 text-center">
                    {row.unit === 'percent' ? '%' : 'plano'}
                  </span>
                ) : (
                  <select
                    value={row.unit}
                    onChange={(e) => put(at, { unit: e.target.value as GearLine['unit'] })}
                    className="w-14 bg-slate-900 border border-slate-800 rounded p-1.5 text-xs outline-none"
                  >
                    <option value="flat">plano</option>
                    <option value="percent">%</option>
                  </select>
                )}
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
const Advice: React.FC<{
  piece: GearPiece;
  ceilings: GearCeiling[];
  corrections: ReadonlyMap<string, string>;
}> = ({ piece, ceilings, corrections }) => {
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
        <Committed reading={read(done, piece.level, ceilings)} days={days} corrections={corrections} />
      ) : (
        <Open readings={candidates(piece, ceilings)} days={days} corrections={corrections} />
      )}
      {sixth.length > 0 && (
        <div className="border border-slate-800 rounded p-3">
          <p className="text-[11px] text-slate-500 mb-1.5">
            Línea 6 — sin límite de sintonizaciones, siempre conviene empujarla
          </p>
          {sixth.map((r) => (
            <Row key={`${r.line.stat}-${r.line.tuning}`} reading={r} corrections={corrections} />
          ))}
        </div>
      )}
    </div>
  );
};

const Committed: React.FC<{
  reading: Reading;
  days: number | null;
  corrections: ReadonlyMap<string, string>;
}> = ({ reading, days, corrections }) => (
  <div className="border border-amber-800/50 bg-amber-500/5 rounded p-3">
    <p className="text-[11px] text-amber-400 mb-1.5">
      <i className="fa-solid fa-anchor mr-1.5"></i>
      Comprometida en esta línea. Las otras tres están cerradas para siempre.
      {days !== null &&
        (days === 0 ? ' Puedes volver a tirarla ya.' : ` Puedes volver a tirarla en ${days} días.`)}
    </p>
    <Row reading={reading} corrections={corrections} />
  </div>
);

const Open: React.FC<{
  readings: Reading[];
  days: number | null;
  corrections: ReadonlyMap<string, string>;
}> = ({ readings, days, corrections }) => {
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
            te conviene cada atributo: para eso está lo que el camino recomienda.
          </p>
          {readings.map((r) => (
            <Row key={r.line.position} reading={r} corrections={corrections} />
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

const Row: React.FC<{ reading: Reading; corrections: ReadonlyMap<string, string> }> = ({
  reading,
  corrections,
}) => {
  const { line, ceiling, value, share, margin } = reading;
  return (
    <div className="flex items-center gap-2 py-0.5 text-xs">
      <span className="flex-1 truncate text-slate-300">
        {labelFor(line, corrections)}
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
              // The game's own two colours where it told us which one, so the
              // row reads like the screen it came from.
              backgroundColor: line.hue === 'violet' ? '#a78bfa' : '#d6c396',
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
