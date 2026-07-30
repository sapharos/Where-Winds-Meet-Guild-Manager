/**
 * The closed list of attributes, as the server needs to know it.
 *
 * Mirrors services/gearCatalog.ts, the same way SLOTS here mirrors GEAR_SLOTS
 * in types.ts. Only the keys: the Spanish names are a display concern and the
 * recommendations are advice, neither of which the server has any business
 * enforcing. What it does enforce is that a saved line names an attribute that
 * actually exists -- because a closed list that only the form respects is not a
 * closed list, it is a suggestion, and the whole failure this replaces was a
 * bad name reaching the database.
 *
 * When a path's pools change in the client catalogue, they change here too.
 * Keeping the two in step by hand is the price of the server package being
 * separate from the app's; the lists are short and change once a patch.
 */

/** The forty-six available on lines one to five, on every slot and every spec. */
export const STATS = [
  'Affinity %',
  'Agility',
  'Airborne Light ATK DMG %',
  'All Martial Arts Boost %',
  'Area Debuff Mystic Skill DMG %',
  'Area DMG Mystic Skill DMG %',
  'Area Mystic Skill DMG %',
  'Art of Dual Blades Boost',
  'Art of Fan Boost',
  'Art of Heng Blade Boost',
  'Art of Mo Blade Boost',
  'Art of Rope Dart Boost',
  'Art of Spear Boost',
  'Art of Sword Boost',
  'Art of Umbrella Boost',
  'Body',
  'Crit %',
  'Dash DMG %',
  'Defense',
  'Dual Weapon Skill DMG %',
  'Execution DMG %',
  'Fan Healing Boost %',
  'Heavy ATK DMG %',
  'Jump Strike DMG %',
  'Light ATK DMG %',
  'Max Bamboocut',
  'Max Bellstrike',
  'Max HP',
  'Max Phys',
  'Max Silkbind',
  'Max Stonesplit',
  'Min Bamboocut',
  'Min Bellstrike',
  'Min Phys',
  'Min Silkbind',
  'Min Stonesplit',
  'Momentum',
  'Phys Def',
  'Player Unit DMG %',
  'Power',
  'Precision %',
  'ST Burst Mystic DMG %',
  'ST Control Mystic DMG %',
  'ST Mystic Skill DMG %',
  'Umbrella Healing Boost %',
  'vs Boss Units %',
];

/** Line six on a weapon, disc or pendant. The same three for every path. */
export const WEAPON_ATTUNEMENTS = [
  'Formless Penetration',
  'Physical Penetration',
  'Physical Resistance',
];

const SILKBIND_DELUGE_ARMOR = [
  'Panacea Fan Healing Skill Boost',
  'Panacea Fan Martial Art Skill Healing Boost',
  'Panacea Fan Special Skill Healing Boost',
  'Soulshade Umbrella Martial Art Skill Healing Boost',
  'Soulshade Umbrella Special Skill Healing Boost',
];

/** Line six on a helm, armour, greaves or bracer: tied to the path's weapons. */
export const ARMOR_ATTUNEMENTS = {
  'silkbind-jade': [
    'Fan Light Charged Skill DMG Boost',
    'Fan Q DMG',
    'Fan Special/Pursuit DMG Boost',
    'Umb Charged Skill DMG Boost',
    'Umb Martial Art (Q) DMG',
    'Umb Special Skill DMG Boost (Drone)',
  ],
  'bellstrike-umbra': [
    'Bleed Skill DMG Boost',
    'Heavenquaker Spear Charged Skill DMG Boost',
    'Heavenquaker Spear Martial Art Skill DMG Boost',
    'Heavenquaker Spear Special Skill DMG Boost',
    'Strategic Sword Charged Skill DMG Boost',
    'Strategic Sword Martial Art Skill DMG Boost',
    'Strategic Sword Special Skill DMG Boost',
  ],
  'bellstrike-splendor': [
    'Nameless Spear Charged Skill DMG Boost',
    'Nameless Spear Martial Art Skill DMG Boost',
    'Nameless Spear Special Skill DMG Boost',
    'Nameless Sword Charged Skill DMG Boost',
    'Nameless Sword Martial Art Skill DMG Boost',
    'Nameless Sword Special Skill DMG Boost',
  ],
  'bamboocut-dust': [
    'Everspring Umbrella Martial Art (Q) DMG Boost',
    'Unfettered Rope Dart Charged Skill DMG Boost',
    'Unfettered Rope Dart Martial Art (Q) DMG Boost',
    'Unfettered Rope Dart Special Skill DMG Boost',
  ],
  // The ninth path, whose pools have not been extracted yet. An empty list is
  // the honest state and it behaves correctly: lines one to five still work,
  // and line six refuses rather than accepting anything at all.
  'bamboocut-kite': [],
  'silkbind-deluge-healing': SILKBIND_DELUGE_ARMOR,
  'silkbind-deluge-dps': SILKBIND_DELUGE_ARMOR,
  'stonesplit-might': [
    'Mo Blade Charged Skill DMG Boost',
    'Mo Blade Special Skill DMG Boost',
    'Stormbreaker Spear Charged Skill DMG Boost',
    'Stormbreaker Spear Martial Art Skill DMG Boost',
    'Stormbreaker Spear Special Skill DMG Boost',
  ],
  'stonesplit-strength': [
    'Phalanxbane Blade Charged Skill DMG Boost',
    'Phalanxbane Blade Martial Art Skill DMG Boost',
    'Snowparting Blade Charged Skill DMG Boost',
    'Snowparting Blade Martial Art Skill DMG Boost',
    'Snowparting Blade Varied Combo DMG Boost',
  ],
};

export const SPEC_IDS = Object.keys(ARMOR_ATTUNEMENTS);

/**
 * The Spanish names read off real screenshots, and what they are.
 *
 * Only used once, to carry pieces recorded before the catalogue existed onto
 * the English keys everything now agrees on. These fifteen are the ones the old
 * KNOWN_STATS had seen for certain; anything else that was typed in was free
 * text and cannot be mapped without guessing, so it is left alone and shows up
 * as uncatalogued for its owner to re-pick.
 */
export const LEGACY_SPANISH = {
  Impulso: 'Momentum',
  'Ataque de campana máximo': 'Max Bellstrike',
  'Ataque Físico Máximo': 'Max Phys',
  'Ataque Físico Mínimo': 'Min Phys',
  'Ataque Máx de Atadura de Seda': 'Max Silkbind',
  'Ataque Mínimo de Atadura de Seda': 'Min Silkbind',
  'Tasa Crítica': 'Crit %',
  'Vida Máxima': 'Max HP',
  Poder: 'Power',
  Agilidad: 'Agility',
  'Resistencia Física': 'Physical Resistance',
  'Penetración Sin Forma': 'Formless Penetration',
  'Penetración Física': 'Physical Penetration',
  'Aumento de Daño en Habilidad Mística de Control': 'ST Control Mystic DMG %',
  'Impulso de Curación de Habilidad de Arte Marcial de Abanico Panacea':
    'Panacea Fan Martial Art Skill Healing Boost',
};

/** Which of the two line-six pools a slot draws from. */
export const attunementGroup = (slot) =>
  slot === 'leftWeapon' || slot === 'rightWeapon' || slot === 'disc' || slot === 'pendant'
    ? 'weapon'
    : 'armor';

/** Every English name a line of this piece on this path may name. */
export function allowed(spec, slot, position) {
  if (position !== 6) return STATS;
  return attunementGroup(slot) === 'weapon'
    ? WEAPON_ATTUNEMENTS
    : ARMOR_ATTUNEMENTS[spec] ?? [];
}
