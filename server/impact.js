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
 *
 * ---
 *
 * Por qué esto vive en `server/` siendo la web quien más lo usa: el contexto de
 * construcción de la imagen de la API es `./server` y nada más (docker-compose),
 * así que un módulo fuera de este directorio sencillamente no existe dentro del
 * contenedor. La web se construye desde la raíz del repositorio y sí alcanza
 * aquí, de modo que el único sitio donde los dos lados pueden compartir código
 * es éste. `services/impact.ts` es la envoltura con los tipos, y no una segunda
 * copia: el gremio tiene un puntaje, no uno por pantalla.
 *
 * En JavaScript llano por la misma razón de siempre -- esta API se ejecuta sin
 * compilar --, con los tipos en JSDoc para que TypeScript siga entendiendo lo
 * que sale de aquí.
 */

/**
 * @typedef {'attack' | 'defense'} WarSide
 *
 * @typedef {Object} Contribution
 * @property {string} playerId
 * @property {string} name
 * @property {WarSide} side
 * @property {Record<string, number | undefined>} stats
 * @property {Record<string, number>} [expects] What the weapons this member
 *   carried are expected to reach on each axis, as a fraction of the war's
 *   best. Absent, or 1, means no allowance.
 *
 * @typedef {Object} Impact
 * @property {string} playerId
 * @property {string} name
 * @property {number} score Nought to a hundred, where a hundred is the best of
 *   that war.
 * @property {Record<string, number>} parts Each axis bent by CURVE and measured
 *   against whatever the weapons carried were asked for. This is what the score
 *   is built from -- an internal, not a figure to put on screen: it is neither
 *   reproducible from the results table nor a percentage of anything a reader
 *   can point at.
 * @property {Record<string, number>} share Each axis as a plain share of the
 *   best in that war, 0 to 1. Divide your row by the top row and you get this.
 * @property {Record<string, number>} pool Each axis as a share of everything
 *   the war produced on it, 0 to 1. These add up to 1 across the whole war.
 */

/**
 * The allowance for a set of weapons, from the sets the guild has configured.
 *
 * Averaged across the sets someone is carrying rather than taking the most
 * generous of them, because a pair that mixes a single-target weapon with an
 * AoE one really is expected to land somewhere between the two.
 *
 * Nothing here is hard-coded to a weapon name. New weapons arrive with the
 * game, get dropped into a set in the settings, and are scored the same day.
 *
 * @param {string[] | undefined} weapons
 * @param {{ weapons: string[], impact?: Record<string, number> | null }[]} sets
 * @returns {Record<string, number>}
 */
export function expectationOf(weapons, sets) {
  const carried = sets.filter((set) => weapons?.some((w) => set.weapons.includes(w)));
  if (!carried.length) return {};

  /** @type {Record<string, number>} */
  const out = {};
  for (const { key, weight } of WEIGHTS) {
    if (weight <= 0) continue;
    // A set that says nothing about an axis is saying it expects the full
    // measure on it, so it must count as 1 in the average rather than drop out.
    const mean = carried.reduce((n, set) => n + (set.impact?.[key] ?? 1), 0) / carried.length;
    if (mean !== 1) out[key] = mean;
  }
  return out;
}

/**
 * What each axis is worth once normalised.
 *
 * Damage and healing carry the same weight on purpose: they are the two ways of
 * deciding a fight and neither is worth more than the other.
 *
 * Kills and assists are counted SEPARATELY, which they were not at first. Added
 * together they made one axis that was really the assist axis: across a thirty
 * player war the assist counts ran 38 to 123 while the kills ran 1 to 30, so
 * the sum moved with the assists and a duellist's thirty kills changed it by
 * almost nothing. Anything that kills one target at a time -- Vinculación de
 * Seda, Cortebambú, and the hybrids built on them -- produces exactly that
 * shape: few big kills, ordinary damage. Given its own axis, killing is worth
 * something again.
 *
 * Damage taken is 0.7 rather than the 0.4 it started at. Holding the front is
 * the one job whose whole return was being measured on the narrowest axis on
 * the board: the best damage dealer in that same war outscored the median by
 * 0.74, and the best tank outscored theirs by 0.17. Tanking cost the damage
 * axis outright and paid back a quarter of it.
 *
 * @type {{ key: string, label: string, weight: number }[]}
 */
export const WEIGHTS = [
  { key: 'damage', label: 'Daño', weight: 1 },
  { key: 'healing', label: 'Curación', weight: 1 },
  { key: 'kills', label: 'Kills', weight: 0.8 },
  { key: 'taken', label: 'Daño recibido', weight: 0.7 },
  { key: 'siege', label: 'Daño de asedio', weight: 0.6 },
  { key: 'assists', label: 'Asistencias', weight: 0.35 },
  { key: 'coin', label: 'Monedas', weight: 0.2 },
  { key: 'deaths', label: 'Muertes', weight: -0.3 },
];

/**
 * The axes a weapon set may be given an allowance on.
 *
 * Not all of them: monedas is about taking objectives rather than about what
 * you carry, and muertes is a penalty, where an allowance would amount to
 * paying people for dying. Mirrored by TUNABLE in server/weapons.js, which is
 * what actually enforces it.
 */
export const TUNABLE_AXES = WEIGHTS.filter((axis) => axis.weight > 0 && axis.key !== 'coin');

/**
 * How hard a lead on one axis is allowed to shout.
 *
 * Measuring every axis as a straight share of the best sounds even-handed and
 * is not, because the axes are not equally spread out. In a real war the damage
 * ran 16x from bottom to top while the damage taken ran 3.6x, so the same
 * "share of the best" was a cheap 58% for a middling tank and a brutal 26% for
 * a middling damage dealer. The widest axis quietly decided the board.
 *
 * Bending the share (x^0.7) lifts the low end of a wide axis much further than
 * it lifts the middle of a narrow one, which puts the axes back on comparable
 * footing without pretending magnitude does not exist -- a healer who healed
 * 21M still beats one who healed 11M, which a pure ranking would have flattened.
 *
 * It also, on purpose, pays hybrids better: two jobs at half measure now come
 * to 1.28 where one job done fully comes to 1.00.
 */
const CURVE = 0.7;

/**
 * How much of the death penalty being the wall excuses.
 *
 * Dying at the front while soaking the war's damage is the job working; dying
 * repeatedly having soaked nothing is being caught out. Whoever took the most
 * damage has half the penalty waived, on a sliding scale.
 */
const DEATH_RELIEF = 0.5;

/**
 * The axes, derived from what the results screen reports.
 *
 * Siege damage is zeroed for defence on purpose: breaking down gates is an
 * attack-side objective, and defence has no way to produce this figure at all.
 * Forcing it to zero here (rather than trusting the stat to happen to be zero)
 * also keeps a mis-tagged deployment from leaking siege credit into a side
 * that structurally cannot earn it.
 *
 * @param {Record<string, number | undefined>} stats
 * @param {WarSide} side
 * @returns {Record<string, number>}
 */
function axes(stats, side) {
  /** @param {string} key */
  const value = (key) => Math.max(0, stats[key] ?? 0);
  return {
    damage: value('damage'),
    healing: value('healing'),
    kills: value('kills'),
    assists: value('assists'),
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
 *
 * @param {number} score
 * @returns {string}
 */
export const impactShade = (score) =>
  score >= 85 ? '#fbbf24' : score >= 60 ? '#a3e635' : score >= 35 ? '#60a5fa' : '#94a3b8';

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
 *
 * @param {Contribution[]} rows
 * @returns {Impact[]}
 */
export function impactOf(rows) {
  if (!rows.length) return [];

  const measured = rows.map((row) => ({ row, axis: axes(row.stats, row.side) }));

  /** @type {Record<string, number>} */
  const best = {};
  /**
   * Everything the war produced on each axis.
   *
   * Only ever shown, never scored: a share of the guild's total falls as the
   * guild grows, so scoring on it would mean a full raid punishing everyone in
   * it. What it answers is the other question -- not «how close was I to the
   * best» but «how much of the night went through me» -- and the two together
   * are what make a bar mean something.
   */
  /** @type {Record<string, number>} */
  const pooled = {};
  for (const { key } of WEIGHTS) {
    best[key] = Math.max(...measured.map(({ axis }) => axis[key]), 0);
    pooled[key] = measured.reduce((n, { axis }) => n + axis[key], 0);
  }

  const raw = measured.map(({ row, axis }) => {
    /** @type {Record<string, number>} */
    const parts = {};
    /** @type {Record<string, number>} */
    const share = {};
    /** @type {Record<string, number>} */
    const pool = {};
    for (const { key, weight } of WEIGHTS) {
      // The two figures a reader can check, kept deliberately clear of the
      // scoring maths below. Neither is bent and neither knows about the
      // weapon allowance, which is what makes them reproducible: divide your
      // row by the top row and you get `share`; divide it by the column and
      // you get `pool`.
      share[key] = best[key] > 0 ? axis[key] / best[key] : 0;
      pool[key] = pooled[key] > 0 ? axis[key] / pooled[key] : 0;

      // What the weapons carried are asked for, which is the whole of the
      // war's best unless the guild has said otherwise. Capped, because
      // beating your own allowance cannot be worth more than being the best
      // in the war outright.
      const target = best[key] * (weight > 0 ? (row.expects?.[key] ?? 1) : 1);
      // Nobody reached it, so nobody is measured against it.
      const reached = target > 0 ? Math.min(1, axis[key] / target) : 0;
      // Only what you earn is bent. A penalty that got easier the larger it
      // grew would be no penalty at all.
      parts[key] = weight > 0 ? Math.pow(reached, CURVE) : reached;
    }

    // Shares are all settled before anything is added up, because the death
    // penalty reads the damage-taken share and must not depend on the order
    // the axes happen to be listed in.
    let total = 0;
    for (const { key, weight } of WEIGHTS) {
      total +=
        key === 'deaths'
          ? weight * parts.deaths * (1 - DEATH_RELIEF * parts.taken)
          : weight * parts[key];
    }
    return { row, parts, share, pool, total };
  });

  /** @type {Record<WarSide, number>} */
  const topOf = {
    attack: Math.max(...raw.filter((r) => r.row.side === 'attack').map((r) => r.total), 0),
    defense: Math.max(...raw.filter((r) => r.row.side === 'defense').map((r) => r.total), 0),
  };

  return raw
    .map(({ row, parts, share, pool, total }) => {
      const top = topOf[row.side];
      return {
        playerId: row.playerId,
        name: row.name,
        score: top > 0 ? Math.round((total / top) * 100) : 0,
        parts,
        share,
        pool,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/* ------------------------------------------------------- a lo largo del tiempo */

/**
 * ¿Hay alguna cifra anotada aquí?
 *
 * Una guerra se crea al empezarla y las cifras se pegan al terminar, si alguien
 * las pega. Entre una cosa y otra la guerra existe con todo el mundo a cero, y
 * un cero de esos no significa «no hizo nada»: significa «nadie lo apuntó». La
 * diferencia da igual para una guerra suelta -- se ve en pantalla que está
 * vacía -- y lo es todo para una media, donde un registro que nadie rellenó
 * arrastraría a la baja a quien peleó esa noche.
 *
 * @param {Record<string, number | undefined> | null | undefined} stats
 */
export const anotada = (stats) =>
  Boolean(stats) && WEIGHTS.some(({ key }) => Number(stats?.[key]) > 0);

/**
 * @typedef {Object} Participacion
 * @property {string} playerId
 * @property {string} name
 * @property {WarSide} side
 * @property {Record<string, number | undefined>} stats
 * @property {string[]} [weapons]
 * @property {boolean} [activo] Si sigue de alta en el roster.
 *
 * @typedef {Object} GuerraConGente
 * @property {string} id
 * @property {string} name
 * @property {string} startedAt
 * @property {string | null} [outcome]
 * @property {string} [matchType]
 * @property {Participacion[]} participants
 *
 * @typedef {Object} GuerraPuntuada
 * @property {GuerraConGente} war
 * @property {Impact[]} ranked Ordenados de más a menos impacto.
 */

/**
 * Puntúa cada guerra por separado y descarta las que nadie rellenó.
 *
 * Por separado y no todas juntas porque un puntaje sólo significa algo dentro
 * de su propia noche: cien es «lo mejor de esa guerra», no una marca absoluta
 * que se pueda comparar entre fechas sin más. Lo que sí se puede promediar
 * después es esa posición relativa, que es justamente lo que mide.
 *
 * @param {GuerraConGente[]} wars
 * @param {{ weapons: string[], impact?: Record<string, number> | null }[]} weaponSets
 * @returns {GuerraPuntuada[]}
 */
export function puntuarGuerras(wars, weaponSets) {
  return wars
    .filter((war) => war.participants.some((p) => anotada(p.stats)))
    .map((war) => ({
      war,
      ranked: impactOf(
        war.participants.map((p) => ({
          playerId: p.playerId,
          name: p.name,
          side: p.side,
          stats: p.stats ?? {},
          expects: expectationOf(p.weapons, weaponSets),
        })),
      ),
    }));
}

/**
 * @typedef {Object} Noche
 * @property {GuerraConGente} war
 * @property {number} score
 * @property {number} puesto Su puesto en esa guerra.
 * @property {number} de Cuánta gente peleó.
 * @property {Record<string, number>} parts
 */

/**
 * Las guerras de una persona, de la más reciente a la más antigua.
 *
 * El puesto se cuenta sobre todos los que pelearon esa noche, incluidos los que
 * después se fueron del gremio: fue tercero entre veintinueve, y que cinco de
 * esos veintinueve ya no estén no le convierte en tercero entre veinticuatro.
 * Un resultado no se recalcula.
 *
 * @param {GuerraPuntuada[]} puntuadas
 * @param {string} playerId
 * @returns {Noche[]}
 */
export function nochesDe(puntuadas, playerId) {
  const noches = [];
  for (const { war, ranked } of puntuadas) {
    const at = ranked.findIndex((r) => r.playerId === playerId);
    if (at < 0) continue;
    const fila = war.participants.find((p) => p.playerId === playerId);
    if (!anotada(fila?.stats)) continue;
    noches.push({ war, score: ranked[at].score, puesto: at + 1, de: ranked.length, parts: ranked[at].parts });
  }
  return noches;
}

/**
 * Cuántas guerras hay que haber peleado para salir en la tabla.
 *
 * Sin un mínimo, la tabla la encabeza quien fue a una sola guerra y tuvo una
 * buena noche, que es lo contrario de lo que se quiere leer en un ranking
 * «general». Tres es poco exigente a propósito -- se trata de descartar la
 * casualidad, no de premiar la veteranía --, y se rebaja solo cuando el gremio
 * todavía no tiene tres guerras con cifras: exigir un mínimo imposible dejaría
 * la tabla vacía justo cuando se acaba de estrenar.
 */
export const MINIMO_PARA_RANKING = 3;

/**
 * @typedef {Object} Trayectoria
 * @property {string} playerId
 * @property {string} name
 * @property {boolean} activo
 * @property {number} media Impacto medio sobre las guerras con cifras.
 * @property {number} guerras Participaciones que contaron.
 * @property {number} mejor La mejor noche.
 * @property {number} victorias
 * @property {number} derrotas
 * @property {Record<string, number>} partes Media por eje del valor curvado con
 *   el que se puntúa, de 0 a 1. Interno: no se enseña.
 * @property {Record<string, number>} partesMejor Media por eje de la cuota
 *   cruda contra el mejor de cada guerra, de 0 a 1.
 * @property {Record<string, number>} partesGrupo Media por eje de la cuota
 *   sobre el total que produjo cada guerra, de 0 a 1.
 * @property {number | null} puesto Puesto en el gremio; null si no llega al mínimo.
 */

/**
 * Lo que ha hecho cada quien a lo largo de todas las guerras, ordenado.
 *
 * La media y no la suma: quien lleva año y medio en el gremio ha acumulado más
 * de todo, y una tabla por acumulado mide antigüedad. Lo que se pregunta aquí
 * es cuánto pesa alguien cuando está, y para eso la media es la respuesta -- con
 * el número de guerras al lado, que es lo que impide que una media alta sobre
 * dos noches se lea como lo mismo que una media alta sobre treinta.
 *
 * Del ranking salen quienes ya no están en el gremio. Sus puntajes se calculan
 * igual y se conservan -- borrarlos cambiaría el resultado de las guerras que
 * pelearon, que es un hecho --, pero compararse con quien se fue hace ocho meses
 * no contesta a «cómo voy respecto al gremio».
 *
 * @param {GuerraPuntuada[]} puntuadas
 * @returns {{ tabla: Trayectoria[], guerras: number, minimo: number }}
 */
export function trayectorias(puntuadas) {
  /** @type {Map<string, Trayectoria & { suma: number, sumaPartes: Record<string, number>, sumaMejor: Record<string, number>, sumaGrupo: Record<string, number> }>} */
  const gente = new Map();

  for (const { war, ranked } of puntuadas) {
    const porId = new Map(war.participants.map((p) => [p.playerId, p]));
    for (const entrada of ranked) {
      const fila = porId.get(entrada.playerId);
      // Quien no tiene ninguna cifra en una guerra que sí las tiene es un hueco
      // de transcripción -- la pantalla de resultados no lista a nadie en
      // blanco --, y contarlo como un cero convertiría un renglón que se saltó
      // quien leyó el pantallazo en un castigo permanente.
      if (!anotada(fila?.stats)) continue;

      let quien = gente.get(entrada.playerId);
      if (!quien) {
        quien = {
          playerId: entrada.playerId,
          name: entrada.name,
          activo: fila?.activo ?? true,
          media: 0,
          guerras: 0,
          mejor: 0,
          victorias: 0,
          derrotas: 0,
          partes: {},
          partesMejor: {},
          partesGrupo: {},
          puesto: null,
          suma: 0,
          sumaPartes: {},
          sumaMejor: {},
          sumaGrupo: {},
        };
        gente.set(entrada.playerId, quien);
      }

      quien.guerras += 1;
      quien.suma += entrada.score;
      quien.mejor = Math.max(quien.mejor, entrada.score);
      if (war.outcome === 'win') quien.victorias += 1;
      if (war.outcome === 'loss') quien.derrotas += 1;
      for (const { key } of WEIGHTS) {
        quien.sumaPartes[key] = (quien.sumaPartes[key] ?? 0) + (entrada.parts[key] ?? 0);
        quien.sumaMejor[key] = (quien.sumaMejor[key] ?? 0) + (entrada.share?.[key] ?? 0);
        quien.sumaGrupo[key] = (quien.sumaGrupo[key] ?? 0) + (entrada.pool?.[key] ?? 0);
      }
    }
  }

  const minimo = Math.min(MINIMO_PARA_RANKING, puntuadas.length || 1);

  const tabla = [...gente.values()]
    .map(({ suma, sumaPartes, sumaMejor, sumaGrupo, ...quien }) => {
      /** @type {Record<string, number>} */
      const partes = {};
      /** @type {Record<string, number>} */
      const partesMejor = {};
      /** @type {Record<string, number>} */
      const partesGrupo = {};
      for (const { key } of WEIGHTS) {
        partes[key] = (sumaPartes[key] ?? 0) / quien.guerras;
        partesMejor[key] = (sumaMejor[key] ?? 0) / quien.guerras;
        // La media de las cuotas y no la cuota de las sumas, a propósito: quien
        // fue a diez guerras no debe salir con diez veces la cuota de quien fue
        // a una. Lo que se promedia es «cuánto de aquella noche fui yo».
        partesGrupo[key] = (sumaGrupo[key] ?? 0) / quien.guerras;
      }
      // Redondeada a un decimal y no a un entero: con treinta personas y una
      // escala de cien, los empates a entero son constantes y un empate en una
      // tabla ordenada se lee como un error de cálculo.
      return {
        ...quien,
        partes,
        partesMejor,
        partesGrupo,
        media: Math.round((suma / quien.guerras) * 10) / 10,
      };
    })
    .sort((a, b) => b.media - a.media || b.guerras - a.guerras || a.name.localeCompare(b.name, 'es'));

  let puesto = 0;
  for (const quien of tabla) {
    if (quien.activo && quien.guerras >= minimo) quien.puesto = ++puesto;
  }

  return { tabla, guerras: puntuadas.length, minimo };
}
