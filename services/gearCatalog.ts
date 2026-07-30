import type { GearSlot } from '../types';

/**
 * Every attribute the game can put on a piece, as a closed list.
 *
 * This replaces the vocabulary that used to be gathered from whatever members
 * typed. That approach was honest about not knowing the list, but it had a
 * failure it could never recover from: a misreading saved once became part of
 * everybody's suggestions, and from then on every identical misreading matched
 * it perfectly. "llmpulso" -- the engine's reading of "[Girar]Impulso" -- is the
 * case that proved it. A closed list cannot do that. The reader's job stops
 * being "what does this say" and becomes "which of these does this say", which
 * is a question with a bounded, checkable answer.
 *
 * The names here are the English ones from wherewindsmath's Gear Analyzer,
 * because that is the only complete list anybody has published and it is what
 * the specs below are defined against. They are the key, never the display: the
 * guild plays in Spanish and reads Spanish screenshots, so `es` is what shows.
 *
 * Lines one to five draw from one pool of forty-six, shared by every slot and
 * every spec -- a spec only changes which of them are worth having. Line six is
 * different: a short pool that depends on the piece, penetration and resistance
 * on a weapon, disc or pendant, and skill boosts tied to the spec's own weapons
 * on a helm, armour, greaves or bracer.
 */
export interface CatalogEntry {
  /** The canonical English name. What gets stored, and what the specs list. */
  key: string;
  /** What the member sees, and what a Spanish screenshot is matched against. */
  es: string;
  /**
   * The Spanish came off a real screenshot rather than out of a translation.
   *
   * Worth marking, because the rest are mine. The game is not consistent with
   * itself -- it prints "Ataque de campana máximo" for one attribute and
   * "Ataque Máx de Atadura de Seda" for its twin -- so no pattern derived from
   * fifteen confirmed names will get the other fifty right. An unconfirmed name
   * still matches, still displays and still stores the same English key; it is
   * simply the one anybody should correct first when it looks wrong, which is
   * what the admin override in the gear sheet is for.
   */
  confirmed?: boolean;
  /**
   * Other spellings the same attribute turns up as, matched but never shown.
   *
   * Two sources: the game's own inconsistency, and the fact that a member may
   * be playing in English. The English key is always matchable without being
   * listed here.
   */
  alt?: string[];
  /**
   * The unit, where it is actually known.
   *
   * Left unset rather than guessed. The unit belongs to the attribute and not
   * to the roll -- Tasa Crítica is a percentage whether or not the "%" survived
   * the engine -- so claiming one wrongly makes every reading of that line
   * disagree with the screen it came from. Unset means "take what was read".
   */
  unit?: 'flat' | 'percent';
}

/**
 * The forty-six of lines one to five.
 *
 * Alphabetical by key, matching the order the dropdown on wherewindsmath uses,
 * so anybody comparing the two is reading the same list in the same order.
 */
export const STATS: CatalogEntry[] = [
  { key: 'Affinity %', es: 'Afinidad', unit: 'percent' },
  { key: 'Agility', es: 'Agilidad', unit: 'flat', confirmed: true },
  { key: 'Airborne Light ATK DMG %', es: 'Daño de Ataque Ligero Aéreo', unit: 'percent' },
  { key: 'All Martial Arts Boost %', es: 'Aumento de Todas las Artes Marciales', unit: 'percent' },
  {
    key: 'Area Debuff Mystic Skill DMG %',
    es: 'Aumento de Daño en Habilidad Mística de Debilitación en Área',
    unit: 'percent',
  },
  {
    key: 'Area DMG Mystic Skill DMG %',
    es: 'Aumento de Daño en Habilidad Mística de Daño en Área',
    unit: 'percent',
  },
  { key: 'Area Mystic Skill DMG %', es: 'Aumento de Daño en Habilidad Mística de Área', unit: 'percent' },
  { key: 'Art of Dual Blades Boost', es: 'Arte de Espadas Dobles', alt: ['Arte de Sables Dobles'] },
  { key: 'Art of Fan Boost', es: 'Arte del Abanico' },
  { key: 'Art of Heng Blade Boost', es: 'Arte del Sable Heng', alt: ['Arte de la Hoja Heng'] },
  { key: 'Art of Mo Blade Boost', es: 'Arte del Sable Mo', alt: ['Arte de la Hoja Mo'] },
  { key: 'Art of Rope Dart Boost', es: 'Arte del Dardo de Cuerda' },
  { key: 'Art of Spear Boost', es: 'Arte de la Lanza' },
  { key: 'Art of Sword Boost', es: 'Arte de la Espada' },
  { key: 'Art of Umbrella Boost', es: 'Arte de la Sombrilla', alt: ['Arte del Paraguas'] },
  { key: 'Body', es: 'Cuerpo', unit: 'flat' },
  { key: 'Crit %', es: 'Tasa Crítica', unit: 'percent', confirmed: true },
  { key: 'Dash DMG %', es: 'Daño de Embestida', unit: 'percent', alt: ['Daño de Carga'] },
  { key: 'Defense', es: 'Defensa', unit: 'flat' },
  { key: 'Dual Weapon Skill DMG %', es: 'Daño de Habilidad de Arma Dual', unit: 'percent' },
  { key: 'Execution DMG %', es: 'Daño de Ejecución', unit: 'percent' },
  { key: 'Fan Healing Boost %', es: 'Aumento de Curación de Abanico', unit: 'percent' },
  { key: 'Heavy ATK DMG %', es: 'Daño de Ataque Pesado', unit: 'percent' },
  { key: 'Jump Strike DMG %', es: 'Daño de Golpe en Salto', unit: 'percent' },
  { key: 'Light ATK DMG %', es: 'Daño de Ataque Ligero', unit: 'percent' },
  {
    key: 'Max Bamboocut',
    es: 'Ataque de Corte de Bambú Máximo',
    unit: 'flat',
    alt: ['Ataque Máx de Corte de Bambú'],
  },
  {
    key: 'Max Bellstrike',
    es: 'Ataque de Campana Máximo',
    unit: 'flat',
    confirmed: true,
    alt: ['Ataque Máx de Campana', 'Ataque de Toque de Campana Máximo'],
  },
  { key: 'Max HP', es: 'Vida Máxima', unit: 'flat', confirmed: true },
  { key: 'Max Phys', es: 'Ataque Físico Máximo', unit: 'flat', confirmed: true },
  {
    key: 'Max Silkbind',
    es: 'Ataque Máx de Atadura de Seda',
    unit: 'flat',
    confirmed: true,
    alt: ['Ataque de Atadura de Seda Máximo'],
  },
  {
    key: 'Max Stonesplit',
    es: 'Ataque de Hendidura de Piedra Máximo',
    unit: 'flat',
    alt: ['Ataque Máx de Hendidura de Piedra', 'Ataque de Rompepiedra Máximo'],
  },
  {
    key: 'Min Bamboocut',
    es: 'Ataque de Corte de Bambú Mínimo',
    unit: 'flat',
    alt: ['Ataque Mín de Corte de Bambú'],
  },
  {
    key: 'Min Bellstrike',
    es: 'Ataque de Campana Mínimo',
    unit: 'flat',
    alt: ['Ataque Mín de Campana', 'Ataque de Toque de Campana Mínimo'],
  },
  { key: 'Min Phys', es: 'Ataque Físico Mínimo', unit: 'flat', confirmed: true },
  {
    key: 'Min Silkbind',
    es: 'Ataque Mínimo de Atadura de Seda',
    unit: 'flat',
    confirmed: true,
    alt: ['Ataque Mín de Atadura de Seda'],
  },
  {
    key: 'Min Stonesplit',
    es: 'Ataque de Hendidura de Piedra Mínimo',
    unit: 'flat',
    alt: ['Ataque Mín de Hendidura de Piedra', 'Ataque de Rompepiedra Mínimo'],
  },
  { key: 'Momentum', es: 'Impulso', unit: 'flat', confirmed: true },
  { key: 'Phys Def', es: 'Defensa Física', unit: 'flat' },
  { key: 'Player Unit DMG %', es: 'Daño a Unidades de Jugador', unit: 'percent' },
  { key: 'Power', es: 'Poder', unit: 'flat', confirmed: true },
  { key: 'Precision %', es: 'Precisión', unit: 'percent' },
  {
    key: 'ST Burst Mystic DMG %',
    es: 'Aumento de Daño en Habilidad Mística de Ráfaga',
    unit: 'percent',
    alt: ['Aumento de Daño en Habilidad Mística de Estallido'],
  },
  {
    key: 'ST Control Mystic DMG %',
    es: 'Aumento de Daño en Habilidad Mística de Control',
    unit: 'percent',
    confirmed: true,
  },
  {
    key: 'ST Mystic Skill DMG %',
    es: 'Aumento de Daño en Habilidad Mística de Objetivo Único',
    unit: 'percent',
  },
  { key: 'Umbrella Healing Boost %', es: 'Aumento de Curación de Sombrilla', unit: 'percent' },
  { key: 'vs Boss Units %', es: 'Daño contra Jefes', unit: 'percent', alt: ['Daño contra Unidades Jefe'] },
];

/**
 * Line six on a weapon, disc or pendant: the same three for every spec.
 *
 * Only which two are worth having changes, and on one spec not even that.
 */
export const WEAPON_ATTUNEMENTS: CatalogEntry[] = [
  { key: 'Formless Penetration', es: 'Penetración Sin Forma', unit: 'flat', confirmed: true },
  // Never yet seen on a screenshot, so no unit is claimed for it -- the same
  // caution the old KNOWN_STATS applied to it.
  { key: 'Physical Penetration', es: 'Penetración Física', confirmed: true },
  { key: 'Physical Resistance', es: 'Resistencia Física', unit: 'percent', confirmed: true },
];

/**
 * Line six on armour: every skill boost across every spec, in one place.
 *
 * Flat rather than nested under each spec because the pools are disjoint --
 * no two specs share one of these -- so a spec need only name its own keys, and
 * every Spanish name still lives in exactly one place to be corrected.
 *
 * All of them are percentages. That is the one thing the confirmed name here
 * settles for the whole family: "Impulso de Curación de Habilidad de Arte
 * Marcial de Abanico Panacea" was read off a screenshot as a percentage, and
 * these are all the same kind of figure.
 */
export const ARMOR_ATTUNEMENTS: CatalogEntry[] = [
  // Silkbind Jade
  { key: 'Fan Light Charged Skill DMG Boost', es: 'Impulso de Daño de Habilidad Cargada Ligera de Abanico', unit: 'percent' },
  { key: 'Fan Q DMG', es: 'Daño de Q de Abanico', unit: 'percent' },
  { key: 'Fan Special/Pursuit DMG Boost', es: 'Impulso de Daño Especial/Persecución de Abanico', unit: 'percent' },
  { key: 'Umb Charged Skill DMG Boost', es: 'Impulso de Daño de Habilidad Cargada de Sombrilla', unit: 'percent' },
  { key: 'Umb Martial Art (Q) DMG', es: 'Daño de Arte Marcial (Q) de Sombrilla', unit: 'percent' },
  { key: 'Umb Special Skill DMG Boost (Drone)', es: 'Impulso de Daño de Habilidad Especial de Sombrilla (Dron)', unit: 'percent' },

  // Bellstrike Umbra
  { key: 'Bleed Skill DMG Boost', es: 'Impulso de Daño de Habilidad de Sangrado', unit: 'percent' },
  { key: 'Heavenquaker Spear Charged Skill DMG Boost', es: 'Impulso de Daño de Habilidad Cargada de Lanza Sacudecielos', unit: 'percent' },
  { key: 'Heavenquaker Spear Martial Art Skill DMG Boost', es: 'Impulso de Daño de Habilidad de Arte Marcial de Lanza Sacudecielos', unit: 'percent' },
  { key: 'Heavenquaker Spear Special Skill DMG Boost', es: 'Impulso de Daño de Habilidad Especial de Lanza Sacudecielos', unit: 'percent' },
  { key: 'Strategic Sword Charged Skill DMG Boost', es: 'Impulso de Daño de Habilidad Cargada de Espada Estratégica', unit: 'percent' },
  { key: 'Strategic Sword Martial Art Skill DMG Boost', es: 'Impulso de Daño de Habilidad de Arte Marcial de Espada Estratégica', unit: 'percent' },
  { key: 'Strategic Sword Special Skill DMG Boost', es: 'Impulso de Daño de Habilidad Especial de Espada Estratégica', unit: 'percent' },

  // Bellstrike Splendor
  { key: 'Nameless Spear Charged Skill DMG Boost', es: 'Impulso de Daño de Habilidad Cargada de Lanza Sin Nombre', unit: 'percent' },
  { key: 'Nameless Spear Martial Art Skill DMG Boost', es: 'Impulso de Daño de Habilidad de Arte Marcial de Lanza Sin Nombre', unit: 'percent' },
  { key: 'Nameless Spear Special Skill DMG Boost', es: 'Impulso de Daño de Habilidad Especial de Lanza Sin Nombre', unit: 'percent' },
  { key: 'Nameless Sword Charged Skill DMG Boost', es: 'Impulso de Daño de Habilidad Cargada de Espada Sin Nombre', unit: 'percent' },
  { key: 'Nameless Sword Martial Art Skill DMG Boost', es: 'Impulso de Daño de Habilidad de Arte Marcial de Espada Sin Nombre', unit: 'percent' },
  { key: 'Nameless Sword Special Skill DMG Boost', es: 'Impulso de Daño de Habilidad Especial de Espada Sin Nombre', unit: 'percent' },

  // Bamboocut Dust
  { key: 'Everspring Umbrella Martial Art (Q) DMG Boost', es: 'Impulso de Daño de Arte Marcial (Q) de Sombrilla Primavera Eterna', unit: 'percent' },
  { key: 'Unfettered Rope Dart Charged Skill DMG Boost', es: 'Impulso de Daño de Habilidad Cargada de Dardo de Cuerda Libre', unit: 'percent' },
  { key: 'Unfettered Rope Dart Martial Art (Q) DMG Boost', es: 'Impulso de Daño de Arte Marcial (Q) de Dardo de Cuerda Libre', unit: 'percent' },
  { key: 'Unfettered Rope Dart Special Skill DMG Boost', es: 'Impulso de Daño de Habilidad Especial de Dardo de Cuerda Libre', unit: 'percent' },

  // Silkbind Deluge, both halves
  { key: 'Panacea Fan Healing Skill Boost', es: 'Impulso de Habilidad de Curación de Abanico Panacea', unit: 'percent' },
  {
    key: 'Panacea Fan Martial Art Skill Healing Boost',
    es: 'Impulso de Curación de Habilidad de Arte Marcial de Abanico Panacea',
    unit: 'percent',
    confirmed: true,
  },
  { key: 'Panacea Fan Special Skill Healing Boost', es: 'Impulso de Curación de Habilidad Especial de Abanico Panacea', unit: 'percent' },
  { key: 'Soulshade Umbrella Martial Art Skill Healing Boost', es: 'Impulso de Curación de Habilidad de Arte Marcial de Sombrilla Sombra del Alma', unit: 'percent' },
  { key: 'Soulshade Umbrella Special Skill Healing Boost', es: 'Impulso de Curación de Habilidad Especial de Sombrilla Sombra del Alma', unit: 'percent' },

  // Stonesplit Might
  { key: 'Mo Blade Charged Skill DMG Boost', es: 'Impulso de Daño de Habilidad Cargada de Sable Mo', unit: 'percent' },
  { key: 'Mo Blade Special Skill DMG Boost', es: 'Impulso de Daño de Habilidad Especial de Sable Mo', unit: 'percent' },
  { key: 'Stormbreaker Spear Charged Skill DMG Boost', es: 'Impulso de Daño de Habilidad Cargada de Lanza Rompetormentas', unit: 'percent' },
  { key: 'Stormbreaker Spear Martial Art Skill DMG Boost', es: 'Impulso de Daño de Habilidad de Arte Marcial de Lanza Rompetormentas', unit: 'percent' },
  { key: 'Stormbreaker Spear Special Skill DMG Boost', es: 'Impulso de Daño de Habilidad Especial de Lanza Rompetormentas', unit: 'percent' },

  // Stonesplit Strength
  { key: 'Phalanxbane Blade Charged Skill DMG Boost', es: 'Impulso de Daño de Habilidad Cargada de Sable Rompefalanges', unit: 'percent' },
  { key: 'Phalanxbane Blade Martial Art Skill DMG Boost', es: 'Impulso de Daño de Habilidad de Arte Marcial de Sable Rompefalanges', unit: 'percent' },
  { key: 'Snowparting Blade Charged Skill DMG Boost', es: 'Impulso de Daño de Habilidad Cargada de Sable Parte Nieve', unit: 'percent' },
  { key: 'Snowparting Blade Martial Art Skill DMG Boost', es: 'Impulso de Daño de Habilidad de Arte Marcial de Sable Parte Nieve', unit: 'percent' },
  { key: 'Snowparting Blade Varied Combo DMG Boost', es: 'Impulso de Daño de Combo Variado de Sable Parte Nieve', unit: 'percent' },
];

/**
 * One of the nine ways to build a character, as the analyzer names them.
 *
 * A spec does not change what a piece *can* roll -- every one of the forty-six
 * is available on every piece of every spec. What it changes is which of them
 * are worth keeping, and which six skill boosts line six can draw from. So a
 * spec is stored as the recommendations and the armour pool, not as its own
 * copy of the list.
 */
export interface Spec {
  id: string;
  name: string;
  /** Keys from STATS worth having on this spec. The rest stay selectable. */
  recommendedStats: string[];
  /** Keys from WEAPON_ATTUNEMENTS worth having. The three are always offered. */
  recommendedWeaponAttunements: string[];
  /** Keys from ARMOR_ATTUNEMENTS this spec's weapons can roll. */
  armorAttunements: string[];
  /**
   * The pools for this path are not known yet, so nothing can be offered.
   *
   * Listed anyway rather than hidden, because a member looking for their own
   * path and not finding it will assume the feature is broken. Shown greyed out
   * with a note instead, which is the truth: it is coming, it is not here.
   */
  pending?: boolean;
}

const SILKBIND_DELUGE_STATS = [
  'Agility',
  'All Martial Arts Boost %',
  'Art of Fan Boost',
  'Art of Umbrella Boost',
  'Crit %',
  'Max Phys',
  'Max Silkbind',
  'Min Phys',
  'Min Silkbind',
  'Power',
  'Precision %',
  'ST Burst Mystic DMG %',
  'ST Control Mystic DMG %',
  'vs Boss Units %',
];

const SILKBIND_DELUGE_ARMOR = [
  'Panacea Fan Healing Skill Boost',
  'Panacea Fan Martial Art Skill Healing Boost',
  'Panacea Fan Special Skill Healing Boost',
  'Soulshade Umbrella Martial Art Skill Healing Boost',
  'Soulshade Umbrella Special Skill Healing Boost',
];

// Penetration on both, resistance never -- true of every path but one.
const PIERCING = ['Formless Penetration', 'Physical Penetration'];

const BELLSTRIKE_STATS = [
  'Affinity %',
  'All Martial Arts Boost %',
  'Art of Spear Boost',
  'Art of Sword Boost',
  'Crit %',
  'Max Bellstrike',
  'Max Phys',
  'Momentum',
  'Power',
  'Precision %',
  'ST Burst Mystic DMG %',
  'ST Control Mystic DMG %',
  'vs Boss Units %',
];

export const SPECS: Spec[] = [
  {
    id: 'silkbind-jade',
    name: 'Silkbind Jade',
    recommendedStats: SILKBIND_DELUGE_STATS,
    recommendedWeaponAttunements: PIERCING,
    armorAttunements: [
      'Fan Light Charged Skill DMG Boost',
      'Fan Q DMG',
      'Fan Special/Pursuit DMG Boost',
      'Umb Charged Skill DMG Boost',
      'Umb Martial Art (Q) DMG',
      'Umb Special Skill DMG Boost (Drone)',
    ],
  },
  {
    id: 'bellstrike-umbra',
    name: 'Bellstrike Umbra',
    recommendedStats: BELLSTRIKE_STATS,
    recommendedWeaponAttunements: PIERCING,
    armorAttunements: [
      'Bleed Skill DMG Boost',
      'Heavenquaker Spear Charged Skill DMG Boost',
      'Heavenquaker Spear Martial Art Skill DMG Boost',
      'Heavenquaker Spear Special Skill DMG Boost',
      'Strategic Sword Charged Skill DMG Boost',
      'Strategic Sword Martial Art Skill DMG Boost',
      'Strategic Sword Special Skill DMG Boost',
    ],
  },
  {
    id: 'bellstrike-splendor',
    name: 'Bellstrike Splendor',
    recommendedStats: BELLSTRIKE_STATS,
    recommendedWeaponAttunements: PIERCING,
    armorAttunements: [
      'Nameless Spear Charged Skill DMG Boost',
      'Nameless Spear Martial Art Skill DMG Boost',
      'Nameless Spear Special Skill DMG Boost',
      'Nameless Sword Charged Skill DMG Boost',
      'Nameless Sword Martial Art Skill DMG Boost',
      'Nameless Sword Special Skill DMG Boost',
    ],
  },
  {
    id: 'bamboocut-dust',
    name: 'Bamboocut Dust',
    recommendedStats: [
      'Agility',
      'All Martial Arts Boost %',
      'Crit %',
      'Max Bamboocut',
      'Max Phys',
      'Min Bamboocut',
      'Min Phys',
      'Power',
      'Precision %',
      'ST Burst Mystic DMG %',
      'ST Control Mystic DMG %',
      'vs Boss Units %',
    ],
    recommendedWeaponAttunements: PIERCING,
    armorAttunements: [
      'Everspring Umbrella Martial Art (Q) DMG Boost',
      'Unfettered Rope Dart Charged Skill DMG Boost',
      'Unfettered Rope Dart Martial Art (Q) DMG Boost',
      'Unfettered Rope Dart Special Skill DMG Boost',
    ],
  },
  {
    // The ninth path. Its pools have not been extracted yet, so it offers
    // nothing rather than borrowing Bamboocut Dust's and looking authoritative
    // about a list nobody checked.
    id: 'bamboocut-kite',
    name: 'Bamboocut - Kite',
    pending: true,
    recommendedStats: [],
    recommendedWeaponAttunements: [],
    armorAttunements: [],
  },
  {
    id: 'silkbind-deluge-healing',
    name: 'Silkbind Deluge - Healing',
    recommendedStats: SILKBIND_DELUGE_STATS,
    recommendedWeaponAttunements: PIERCING,
    armorAttunements: SILKBIND_DELUGE_ARMOR,
  },
  {
    // Identical to the healing half in every pool, which is the analyzer's own
    // answer: the two differ in how they are played, not in what they can roll.
    id: 'silkbind-deluge-dps',
    name: 'Silkbind Deluge - DPS',
    recommendedStats: SILKBIND_DELUGE_STATS,
    recommendedWeaponAttunements: PIERCING,
    armorAttunements: SILKBIND_DELUGE_ARMOR,
  },
  {
    id: 'stonesplit-might',
    name: 'Stonesplit Might',
    recommendedStats: [
      'Agility',
      'All Martial Arts Boost %',
      'Art of Fan Boost',
      'Art of Umbrella Boost',
      'Crit %',
      'Max Phys',
      'Max Silkbind',
      'Max Stonesplit',
      'Min Phys',
      'Min Silkbind',
      'Min Stonesplit',
      'Power',
      'Precision %',
      'ST Burst Mystic DMG %',
      'ST Control Mystic DMG %',
      'vs Boss Units %',
    ],
    recommendedWeaponAttunements: PIERCING,
    armorAttunements: [
      'Mo Blade Charged Skill DMG Boost',
      'Mo Blade Special Skill DMG Boost',
      'Stormbreaker Spear Charged Skill DMG Boost',
      'Stormbreaker Spear Martial Art Skill DMG Boost',
      'Stormbreaker Spear Special Skill DMG Boost',
    ],
  },
  {
    id: 'stonesplit-strength',
    name: 'Stonesplit Strength',
    // The only path that recommends four attributes rather than a dozen, and
    // the only one with nothing to say about line six on a weapon.
    recommendedStats: [
      'All Martial Arts Boost %',
      'ST Burst Mystic DMG %',
      'ST Control Mystic DMG %',
      'vs Boss Units %',
    ],
    recommendedWeaponAttunements: [],
    armorAttunements: [
      'Phalanxbane Blade Charged Skill DMG Boost',
      'Phalanxbane Blade Martial Art Skill DMG Boost',
      'Snowparting Blade Charged Skill DMG Boost',
      'Snowparting Blade Martial Art Skill DMG Boost',
      'Snowparting Blade Varied Combo DMG Boost',
    ],
  },
];

export const specById = (id: string | null | undefined): Spec | undefined =>
  SPECS.find((s) => s.id === id);

/**
 * Which of the two line-six pools a slot draws from.
 *
 * The split is by what the piece is, not by what it is for: the four things
 * held draw penetration and resistance, the four things worn draw skill boosts.
 */
export const attunementGroup = (slot: GearSlot): 'weapon' | 'armor' =>
  slot === 'leftWeapon' || slot === 'rightWeapon' || slot === 'disc' || slot === 'pendant'
    ? 'weapon'
    : 'armor';

/** Every entry that exists, whatever pool it belongs to, keyed by English name. */
export const BY_KEY: ReadonlyMap<string, CatalogEntry> = new Map(
  [...STATS, ...WEAPON_ATTUNEMENTS, ...ARMOR_ATTUNEMENTS].map((e) => [e.key, e]),
);

/** An option as the form offers it: an entry plus whether this spec wants it. */
export interface Option {
  entry: CatalogEntry;
  recommended: boolean;
}

const sortByEs = (a: Option, b: Option) => a.entry.es.localeCompare(b.entry.es, 'es');

/**
 * What line one to five may be, on this spec.
 *
 * All forty-six, always. A recommendation is advice and the game does not stop
 * anybody rolling something else, so hiding the rest would make it impossible
 * to record a piece that a member is actually wearing.
 */
export function statOptions(spec: Spec | undefined): Option[] {
  const wanted = new Set(spec?.recommendedStats ?? []);
  return STATS.map((entry) => ({ entry, recommended: wanted.has(entry.key) })).sort(sortByEs);
}

/** What line six may be, which depends on the piece as well as the spec. */
export function attunementOptions(spec: Spec | undefined, slot: GearSlot): Option[] {
  if (attunementGroup(slot) === 'weapon') {
    const wanted = new Set(spec?.recommendedWeaponAttunements ?? []);
    return WEAPON_ATTUNEMENTS.map((entry) => ({ entry, recommended: wanted.has(entry.key) })).sort(
      sortByEs,
    );
  }
  const keys = new Set(spec?.armorAttunements ?? []);
  return ARMOR_ATTUNEMENTS.filter((e) => keys.has(e.key))
    .map((entry) => ({ entry, recommended: false }))
    .sort(sortByEs);
}

/** Every option a given line of a given piece may hold. */
export const optionsFor = (spec: Spec | undefined, slot: GearSlot, position: number): Option[] =>
  position === 6 ? attunementOptions(spec, slot) : statOptions(spec);
