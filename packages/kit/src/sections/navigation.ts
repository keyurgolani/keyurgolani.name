// The navigation model (stream A, global rule 7): a page's outline grouped
// into at most five destinations, so no composition has to put every
// section in its persistent chrome. A composition draws the name and the
// destinations as its chrome, and the index, every section, in its own
// pattern: a margin index, an orbital navigator, a catalogue, a tile field,
// a chapter scrubber, or a list behind a Menu. It reads the PageOutline
// alone, so it follows pageOutline()'s rendering rule and the composition's
// anchorOf(): every href lands on a section that renders. Pure: no markup,
// no clock, no network, no randomness.
//
// The five destinations are fixed and shared by every composition (design
// director's note 8): the same section sits in the same group whichever
// composition draws it, so a visitor switching looks keeps their place. A
// composition may relabel a destination for its metaphor, never rename or
// add one, and a writing works section is always Writing, a destination the
// chrome always keeps.
//
// K-1 makes the placement one canonical map (CANONICAL_DESTINATIONS), by
// what a section is (sectionClass(): its kind, and what its items are), so
// "where is Publications" has one answer in every composition. A
// composition departs from it only by declaring `overrides`, which its own
// test checks with checkDestinationOverrides(), and one with its own
// boards or sheets declares them through `grouping`, each standing for one
// of the five ids.

import type { OutlineSection, OutlineWork, PageOutline } from './outline';

/** Where a section belongs in the chrome: one of five fixed ids, the same in every composition. */
export type DestinationId = 'work' | 'writing' | 'record' | 'about' | 'contact';

/** Every destination's id, in the fixed order every chrome lists them (director's note 8). */
export const DESTINATIONS: readonly DestinationId[] = [
  'work',
  'writing',
  'record',
  'about',
  'contact',
];

/**
 * The order the model keeps destinations in when more have sections than
 * `primary` allows: Writing first, so it stays a findable destination in
 * every composition, then the rest as DESTINATIONS has them.
 */
const KEEP: readonly DestinationId[] = ['writing', 'work', 'record', 'about', 'contact'];

/**
 * Each destination's plain default label. The kit has no translations: like
 * every word the shared renderers add, these are English, and a destination
 * carries `lang: 'en'` in a portfolio that isn't, so the composition marks
 * it. `labels` replaces any of them with a composition's own words for its
 * metaphor, and `ownLabels` with the owner's.
 */
export const DESTINATION_LABELS: Readonly<Record<DestinationId, string>> = {
  work: 'Work',
  writing: 'Writing',
  record: 'Record',
  about: 'About',
  contact: 'Contact',
};

/** One persistent link: a group of sections, linked at the first of them. */
export interface Destination {
  readonly id: DestinationId;
  readonly label: string;
  /**
   * The label's language when it isn't the page's: `en` for the kit's
   * defaults and a composition's own words in a portfolio that isn't
   * English. None for the owner's own words, which are the page's language.
   */
  readonly lang?: string;
  /**
   * Where it lands, a section the page renders: the one titled as the
   * destination is labelled, when there's one, else the first.
   */
  readonly href: string;
  /** Its sections, in reading order, each with an href. */
  readonly sections: readonly OutlineSection[];
}

/** A composition's own word for a destination, in its own language, English by default. */
export interface DestinationLabel {
  readonly text: string;
  /** Its language, `en` by default, the language a composition's own words are in. */
  readonly lang?: string;
}

export interface NavigationModel<G extends string = DestinationId> {
  /** The person's name, linking home. */
  readonly name: { readonly label: string; readonly href: string };
  /**
   * At most `primary` destinations, none of them empty, always in the fixed
   * order Work, Writing, Record, About, Contact, so every composition lists
   * them alike. Writing is among them whenever the page has a writing works
   * section and `primary` is at least 1.
   */
  readonly primary: readonly Destination[];
  /**
   * Where each section with an href goes, by its content id: one of the
   * five ids, or null for the index alone. The canonical map's answer, unless
   * the composition's `overrides` declare another.
   */
  readonly placed: ReadonlyMap<string, DestinationId | null>;
  /**
   * The composition's own groups, its boards or sheets, in the order it
   * declares them, each holding its sections in reading order and landing on
   * one of the five ids; none empty. Without `grouping`, every destination
   * with sections, as its group, in the fixed order, however few `primary`
   * keeps.
   */
  readonly groups: readonly SectionGroup<G>[];
  /**
   * What the grouping hook refused, for the composition's author: each
   * section groupOf() put in a group standing for another destination, and
   * each destination with sections no group stands for. Empty without
   * `grouping`. The kit reads no environment, so it doesn't log them: show
   * them in development, and test them with checkGrouping().
   */
  readonly diagnostics: readonly string[];
  /** Every section with an href, in reading order, for the composition's own index. */
  readonly index: readonly OutlineSection[];
  /** Every work with its own page, as the outline lists them. */
  readonly works: readonly OutlineWork[];
}

/** One of a composition's own groups of sections: a board, a sheet, a band. */
export interface SectionGroup<G extends string = DestinationId> {
  readonly id: G;
  /** The fixed destination it stands for, so its chrome and its index agree with every composition's. */
  readonly destination: DestinationId;
  /** Its label: the group's own, else its destination's, with its language as Destination's is. */
  readonly label: string;
  readonly lang?: string;
  /** Its section titled as it's labelled, when there's one, else its first. */
  readonly href: string;
  readonly sections: readonly OutlineSection[];
}

/** What a composition's groupOf() knows about a section beside the section itself. */
export interface GroupContext {
  /** Where the map places it, with the composition's overrides: one of the five ids, or null. */
  readonly destination: DestinationId | null;
  readonly sectionClass: SectionClass;
  /** Its place among the sections with an href, from 0. */
  readonly position: number;
  /** Whether it's the first section of its kind on the page, such as the first works section. */
  readonly firstOfKind: boolean;
  /** Whether it's the first section of its class, such as the first all-metric evidence section. */
  readonly firstOfClass: boolean;
}

/**
 * The grouping hook (K-1): a composition with its own boards or sheets
 * declares them, each standing for one of the five fixed ids, and says
 * which sections go where. It's for display alone, and never moves a
 * section to another destination (lead A's ruling on N7): a board may
 * split one destination's sections, or hold them with sections the map
 * leaves to the index, but a section's destination, its chrome link and its
 * index group, stays the map's.
 * - A section groupOf() puts in a group standing for another destination
 *   is refused: it goes to its own destination's home group, and the
 *   model's `diagnostics` say so, for the composition's development view
 *   and its checkGrouping() test.
 * - A section groupOf() leaves (undefined) goes to its destination's home
 *   group: the group whose id is the destination's, else the only one that
 *   stands for it. So an Overview board or a cover sheet standing for About
 *   takes only what groupOf() gives it.
 * - A section whose destination no group stands for is in no group, with a
 *   diagnostic too: declare a group for every destination the page may
 *   have, such as a Writing board, which drops while it's empty.
 * - A section the map leaves to the index (the hero, an untitled lede,
 *   custom and extension sections) may go in any group, else `unplaced`,
 *   else none.
 * - groupOf() returns null to leave a section out of every group.
 * A mistake in the declaration throws: an id twice, a destination that's
 * none of the five, two or more groups for one destination with none of
 * them named after it, an `unplaced` or a groupOf() answer that's no group.
 */
export interface GroupingOptions<G extends string> {
  readonly groups: readonly {
    readonly id: G;
    readonly destination: DestinationId;
    /** The group's own word, such as `Overview`, English unless it says otherwise. */
    readonly label?: DestinationLabel;
  }[];
  readonly groupOf?: (section: OutlineSection, context: GroupContext) => G | null | undefined;
  readonly unplaced?: G;
}

export interface NavigationOptions<G extends string = DestinationId> {
  /** The most destinations the chrome shows: 5 by default, and 0 shows none. */
  readonly primary?: number;
  /**
   * The composition's declared departures from the canonical map, made by
   * defineNavigationOverrides() and checked in its tests with
   * checkDestinationOverrides(). Any other map throws. A writing works
   * section is always Writing, whatever they say.
   */
  readonly overrides?: DestinationOverrides;
  /** The composition's own boards or sheets, if it groups its sections itself. */
  readonly grouping?: GroupingOptions<G>;
  /**
   * A composition's own labels for its metaphor, such as `{ record: { text:
   * 'Craft' } }`. Each is English unless it says otherwise, so it's marked
   * `lang="en"` in a portfolio that isn't.
   */
  readonly labels?: Partial<Readonly<Record<DestinationId, DestinationLabel>>>;
  /** The owner's own words for a destination, in the portfolio's language. They win over `labels`. */
  readonly ownLabels?: Partial<Readonly<Record<DestinationId, string>>>;
}

/** Mediums whose works read as writing. */
const WRITTEN = new Set(['writing', 'research']);

/** Whether a section is a works section whose every shown work is `writing` or `research`. */
function isWriting(section: OutlineSection): boolean {
  const media = section.media ?? [];
  return (
    section.kind === 'works' && media.length > 0 && media.every(({ medium }) => WRITTEN.has(medium))
  );
}

/**
 * What a section is, for placing it, from its kind and what it shows,
 * never from its title or id (K-1):
 * - `works:writing` for a works section whose every shown work is
 *   `writing` or `research`, else `works`;
 * - `evidence:<type>` for an evidence section whose every shown entry is
 *   one type, such as `evidence:publication`, else `evidence`;
 * - `practice:<part>`, such as `practice:skills`;
 * - `lede:titled` for a lede with a title, else `lede`;
 * - `extension` for an extension's kind;
 * - otherwise the kind itself: `hero`, `github`, `chronology`, `focus`,
 *   `now`, `quote`, `fun-facts`, `contact`, `cta`, `custom`.
 */
export type SectionClass =
  | 'hero'
  | 'lede'
  | 'lede:titled'
  | 'works'
  | 'works:writing'
  | 'evidence'
  | `evidence:${EvidenceTypeName}`
  | 'github'
  | 'chronology'
  | `practice:${'thesis' | 'skills' | 'tools' | 'services'}`
  | 'focus'
  | 'now'
  | 'quote'
  | 'fun-facts'
  | 'contact'
  | 'cta'
  | 'custom'
  | 'extension';

/** An evidence entry's type, as the schema's EVIDENCE_TYPES lists them. */
type EvidenceTypeName =
  | 'metric'
  | 'testimonial'
  | 'publication'
  | 'talk'
  | 'award'
  | 'patent'
  | 'press'
  | 'exhibition'
  | 'client'
  | 'recording'
  | 'repository'
  | 'external-work';

/** The kinds an override may name for every class of that kind, such as `evidence` for all of them. */
type ClassKind = 'lede' | 'works' | 'evidence' | 'practice';

/** What a section is, for placing it: its SectionClass. */
export function sectionClass(section: OutlineSection): SectionClass {
  switch (section.kind) {
    case 'works':
      return isWriting(section) ? 'works:writing' : 'works';
    case 'evidence': {
      const types = section.types ?? [];
      return types.length === 1 ? (`evidence:${types[0]!.type}` as SectionClass) : 'evidence';
    }
    case 'practice':
      return `practice:${(section.part ?? 'thesis') as 'thesis'}`;
    case 'lede':
      return section.title !== undefined ? 'lede:titled' : 'lede';
    case 'hero':
    case 'github':
    case 'chronology':
    case 'focus':
    case 'now':
    case 'quote':
    case 'fun-facts':
    case 'contact':
    case 'cta':
    case 'custom':
      return section.kind;
    default:
      return 'extension';
  }
}

/**
 * The canonical map (K-1, design director's majority placements): where
 * every class of section goes in every composition, so "where is
 * Publications" has one answer across all of them. A class it doesn't list
 * takes its kind's entry.
 * - Work: works sections, Incident History among them.
 * - Writing: a works section that's all writing or research, Essays among
 *   them. Nothing moves one.
 * - Record: evidence of every type, Publications, Talks, Press and
 *   metrics included; GitHub; chronology.
 * - About: a titled lede; practice, Skills and Tools included; focus, now,
 *   quotes, and fun facts.
 * - Contact: contact and calls to action.
 * - The index alone (null): the hero, an untitled lede, custom sections,
 *   and an extension's.
 */
export const CANONICAL_DESTINATIONS: Readonly<
  Partial<Record<SectionClass | ClassKind, DestinationId | null>>
> = Object.freeze({
  hero: null,
  lede: null,
  'lede:titled': 'about',
  works: 'work',
  'works:writing': 'writing',
  evidence: 'record',
  github: 'record',
  chronology: 'record',
  practice: 'about',
  focus: 'about',
  now: 'about',
  quote: 'about',
  'fun-facts': 'about',
  contact: 'contact',
  cta: 'contact',
  custom: null,
  extension: null,
});

/** The kind a class belongs to, for a map that names the kind for all its classes. */
const kindOf = (name: SectionClass): string => name.split(':')[0]!;

/** `map`'s entry for the class, else for its kind. `undefined` when it has neither. */
function lookup(
  map: Partial<Record<string, DestinationId | null>>,
  name: SectionClass,
): DestinationId | null | undefined {
  if (Object.hasOwn(map, name)) return map[name];
  const kind = kindOf(name);
  return Object.hasOwn(map, kind) ? map[kind] : undefined;
}

/** Where a section goes in every composition: the canonical map's entry for its class. */
export function canonicalDestination(section: OutlineSection): DestinationId | null {
  return lookup(CANONICAL_DESTINATIONS, sectionClass(section)) ?? null;
}

/** The previous name for canonicalDestination(), kept for its callers. */
export const defaultDestination = canonicalDestination;

/**
 * Departures from the canonical map, by class or by kind (a kind names all
 * its classes, the class winning), each to one of the five ids, or null for
 * the index alone. Such as `{ 'evidence:publication': 'writing' }`. A
 * writing works section can't be moved.
 *
 * An `evidence:<type>` key matches a section only while every entry it
 * shows is that type: once the owner adds a talk to Publications, the
 * section is plain `evidence`, and an `evidence:publication` key no longer
 * moves it. Name the kind, `evidence`, to move every evidence section.
 */
export type DestinationOverrideMap = Readonly<
  Partial<Record<SectionClass | ClassKind, DestinationId | null>>
>;

/** The mark only defineNavigationOverrides() sets, so navigationModel() takes no other map. */
const DECLARED = Symbol('navigation overrides');

/**
 * A composition's declared overrides: a DestinationOverrideMap made by
 * defineNavigationOverrides(), the one way to give navigationModel()
 * overrides, so the repo's quality suite finds every declaration by that
 * call and fails a package that doesn't test it.
 */
export type DestinationOverrides = DestinationOverrideMap & { readonly [DECLARED]: true };

/**
 * Declares a composition's departures from the canonical map, for
 * navigationModel()'s `overrides`. Declare it once, as a named constant
 * beside the composition, and test that constant with
 * checkDestinationOverrides(); the repo's quality suite fails a package
 * with a call that no test checks.
 */
export function defineNavigationOverrides(map: DestinationOverrideMap): DestinationOverrides {
  const declared = { ...map };
  Object.defineProperty(declared, DECLARED, { value: true });
  return Object.freeze(declared) as DestinationOverrides;
}

/** Whether `overrides` came from defineNavigationOverrides(), and not a copy, a spread, or a cast. */
function isDeclared(overrides: object): overrides is DestinationOverrides {
  return Object.hasOwn(overrides, DECLARED);
}

/**
 * What's wrong with an override map, for a composition's test, against the
 * outlines it renders (the sample and the contract fixtures, say):
 * - a key that's no class or kind, or a destination that's none of the five;
 * - one that moves a writing works section, which nothing does;
 * - one that sends every section it matches where it would go without it,
 *   which says nothing (a class key that restores the canonical place
 *   against its kind's key does say something);
 * - one that matches no section with an anchor in any outline, which does
 *   nothing, since only those are placed.
 * Empty when the map is sound.
 */
export function checkDestinationOverrides(
  overrides: DestinationOverrideMap,
  outlines: readonly PageOutline[],
): string[] {
  const problems: string[] = [];
  const classes = new Set(
    outlines.flatMap((outline) =>
      outline.sections
        .filter((section) => section.href !== undefined)
        .map((section) => sectionClass(section)),
    ),
  );
  for (const [key, value] of Object.entries(overrides) as [string, DestinationId | null][]) {
    if (!isClassOrKind(key)) {
      problems.push(`${key} is no section class or kind`);
      continue;
    }
    if (value !== null && !DESTINATIONS.includes(value)) {
      problems.push(`${key} goes to ${String(value)}, none of the five destinations`);
    }
    if (key === 'works:writing') {
      problems.push(`${key} can't move: a writing works section is always Writing`);
      continue;
    }
    // A kind's key moves the classes of that kind no class key names, writing works aside.
    const moved = [...classes].filter(
      (name) =>
        name !== 'works:writing' &&
        (name === key || (kindOf(name) === key && !Object.hasOwn(overrides, name))),
    );
    if (moved.length === 0) {
      problems.push(`${key} matches no section in any of the outlines`);
    } else if (moved.every((name) => withoutKey(overrides, key, name) === value)) {
      problems.push(`${key} goes to ${String(value)}, where its sections go without it`);
    }
  }
  return problems;
}

/**
 * Where a class goes under `overrides` less `key`: a class key yields to its
 * kind's key, if the map has one, and a kind's key to the canonical map.
 */
function withoutKey(
  overrides: DestinationOverrideMap,
  key: string,
  name: SectionClass,
): DestinationId | null {
  const kind = kindOf(name);
  if (key === name && kind !== name && Object.hasOwn(overrides, kind)) {
    return overrides[kind as ClassKind] ?? null;
  }
  return lookup(CANONICAL_DESTINATIONS, name) ?? null;
}

const PLAIN_CLASSES = new Set<string>([
  'hero',
  'lede',
  'lede:titled',
  'works',
  'works:writing',
  'evidence',
  'github',
  'chronology',
  'practice',
  'practice:thesis',
  'practice:skills',
  'practice:tools',
  'practice:services',
  'focus',
  'now',
  'quote',
  'fun-facts',
  'contact',
  'cta',
  'custom',
  'extension',
]);

const EVIDENCE_TYPE_NAMES = new Set<string>([
  'metric',
  'testimonial',
  'publication',
  'talk',
  'award',
  'patent',
  'press',
  'exhibition',
  'client',
  'recording',
  'repository',
  'external-work',
]);

/** Whether `key` is a SectionClass or a kind an override may name. */
function isClassOrKind(key: string): boolean {
  if (PLAIN_CLASSES.has(key)) return true;
  const [kind, type] = key.split(':');
  return kind === 'evidence' && type !== undefined && EVIDENCE_TYPE_NAMES.has(type);
}

/** Whether two language tags name the same language, `en` and `en-GB` alike. */
const sameLanguage = (a: string, b: string) =>
  a.toLowerCase().split('-')[0] === b.toLowerCase().split('-')[0];

/** A destination's label and its language, from the owner's words, the composition's, or the default. */
function labelOf(
  id: DestinationId,
  options: NavigationOptions<string>,
  locale: string,
): { label: string; lang?: string } {
  const own = options.ownLabels?.[id]?.trim();
  if (own) return { label: own };
  return composedLabel(options.labels?.[id], DESTINATION_LABELS[id], locale);
}

/** A composition's own word, else `fallback`, both English unless the word says otherwise. */
function composedLabel(
  composed: DestinationLabel | undefined,
  fallback: string,
  locale: string,
): { label: string; lang?: string } {
  const text = composed?.text.trim();
  const label = text || fallback;
  const lang = (text && composed?.lang?.trim()) || 'en';
  return sameLanguage(lang, locale) ? { label } : { label, lang };
}

/**
 * The section among a destination's whose title is its label, case aside,
 * so About lands on the section the page calls About rather than whichever
 * of its sections comes first.
 */
function namedFor(
  label: string,
  sections: readonly OutlineSection[],
  locale: string,
): OutlineSection | undefined {
  // A tag Intl rejects, as a hand-built outline can hold, folds in the root locale.
  let tag: string | undefined;
  try {
    tag = Intl.getCanonicalLocales(locale)[0];
  } catch {
    tag = undefined;
  }
  const fold = (text: string) => text.normalize('NFC').trim().toLocaleLowerCase(tag);
  return sections.find(({ title }) => title !== undefined && fold(title) === fold(label));
}

/**
 * Where a section goes, with a composition's overrides: a writing works
 * section is always Writing; otherwise the overrides' entry for its class,
 * else for its kind, else the canonical map's.
 */
function placeOf(section: OutlineSection, overrides: DestinationOverrideMap): DestinationId | null {
  const name = sectionClass(section);
  if (name === 'works:writing') return 'writing';
  const declared = lookup(overrides, name);
  if (declared !== undefined) {
    return declared !== null && DESTINATIONS.includes(declared) ? declared : null;
  }
  return canonicalDestination(section);
}

/**
 * The page's navigation: the name, at most `primary` destinations in the
 * fixed order DESTINATIONS has them, every section's place, the
 * composition's own groups, and the full index. A section with no href is
 * in none of them. Each destination, and each group, links the section
 * titled as it's labelled, when it has one, and otherwise its first. When
 * more destinations have sections than fit, Writing is kept first, then
 * the rest in DESTINATIONS' order. Overrides not made by
 * defineNavigationOverrides() throw.
 */
export function navigationModel(
  outline: PageOutline,
  options?: NavigationOptions<DestinationId> & { readonly grouping?: undefined },
): NavigationModel<DestinationId>;
export function navigationModel<G extends string>(
  outline: PageOutline,
  options: NavigationOptions<G> & { readonly grouping: GroupingOptions<G> },
): NavigationModel<G>;
export function navigationModel<G extends string = DestinationId>(
  outline: PageOutline,
  options?: NavigationOptions<G>,
): NavigationModel<G | DestinationId>;
export function navigationModel<G extends string = DestinationId>(
  outline: PageOutline,
  options: NavigationOptions<G> = {},
): NavigationModel<G | DestinationId> {
  const limit = Math.max(0, Math.floor(options.primary ?? DESTINATIONS.length));
  if (options.overrides !== undefined && !isDeclared(options.overrides)) {
    throw new TypeError(
      'navigationModel: overrides must be a map made by defineNavigationOverrides(), and tested with checkDestinationOverrides(), not a copy, a spread, or a cast.',
    );
  }
  const overrides: DestinationOverrideMap = options.overrides ?? {};
  const index = outline.sections.filter((section) => section.href !== undefined);
  const placed = new Map(index.map((section) => [section.id, placeOf(section, overrides)]));
  const byDestination = new Map<DestinationId, OutlineSection[]>();
  for (const section of index) {
    const id = placed.get(section.id);
    if (id === null || id === undefined) continue;
    const group = byDestination.get(id);
    if (group) group.push(section);
    else byDestination.set(id, [section]);
  }
  const destination = (id: DestinationId): Destination => {
    const sections = byDestination.get(id)!;
    const label = labelOf(id, options, outline.locale);
    return {
      id,
      ...label,
      href: (namedFor(label.label, sections, outline.locale) ?? sections[0]!).href!,
      sections,
    };
  };
  const kept = new Set(KEEP.filter((id) => byDestination.has(id)).slice(0, limit));
  const primary = DESTINATIONS.filter((id) => kept.has(id)).map(destination);
  const diagnostics: string[] = [];
  const groups: readonly SectionGroup<G | DestinationId>[] = options.grouping
    ? groupSections(outline, index, placed, options.grouping, options, (message) =>
        diagnostics.push(message),
      )
    : DESTINATIONS.filter((id) => byDestination.has(id)).map((id): SectionGroup<DestinationId> => ({
        ...destination(id),
        destination: id,
      }));
  return {
    name: { label: outline.name, href: outline.home },
    primary,
    placed,
    groups,
    diagnostics,
    index,
    works: outline.works,
  };
}

/**
 * What the grouping hook refused on these outlines, for the composition's
 * test, which expects none on the sample and every contract fixture: each
 * section groupOf() put in a group standing for another destination, and
 * each destination with sections that no group stands for. The same as
 * every model's `diagnostics`, gathered.
 */
export function checkGrouping<G extends string>(
  options: NavigationOptions<G> & { readonly grouping: GroupingOptions<G> },
  outlines: readonly PageOutline[],
): string[] {
  return outlines.flatMap((outline) => [...navigationModel(outline, options).diagnostics]);
}

/** The composition's own groups, from its grouping hook, and what it refused. */
function groupSections<G extends string>(
  outline: PageOutline,
  index: readonly OutlineSection[],
  placed: ReadonlyMap<string, DestinationId | null>,
  grouping: GroupingOptions<G>,
  options: NavigationOptions<G>,
  warn: (message: string) => void,
): SectionGroup<G>[] {
  const declared = new Map(grouping.groups.map((group) => [group.id, group]));
  if (declared.size !== grouping.groups.length) {
    throw new TypeError('navigationModel: grouping declares a group id twice.');
  }
  for (const group of grouping.groups) {
    if (!DESTINATIONS.includes(group.destination)) {
      throw new TypeError(
        `navigationModel: group ${group.id} stands for ${String(group.destination)}, none of the five destinations.`,
      );
    }
  }
  if (grouping.unplaced !== undefined && !declared.has(grouping.unplaced)) {
    throw new TypeError(`navigationModel: unplaced names ${grouping.unplaced}, which no group is.`);
  }
  // Each destination's home group: the one named after it, else the only one that stands for it.
  const home = new Map<DestinationId, G>();
  for (const id of DESTINATIONS) {
    const standing = grouping.groups.filter((group) => group.destination === id);
    const named = standing.find((group) => group.id === id);
    if (!named && standing.length > 1) {
      throw new TypeError(
        `navigationModel: ${standing.map((group) => group.id).join(', ')} all stand for ${id}, and none is named ${id}, so its sections have no home group.`,
      );
    }
    const chosen = named ?? standing[0];
    if (chosen) home.set(id, chosen.id);
  }
  const members = new Map<G, OutlineSection[]>();
  const kinds = new Set<string>();
  const classes = new Set<SectionClass>();
  index.forEach((section, position) => {
    const name = sectionClass(section);
    const destination = placed.get(section.id) ?? null;
    const context: GroupContext = {
      destination,
      sectionClass: name,
      position,
      firstOfKind: !kinds.has(section.kind),
      firstOfClass: !classes.has(name),
    };
    kinds.add(section.kind);
    classes.add(name);
    const chosen = grouping.groupOf?.(section, context);
    if (chosen !== undefined && chosen !== null && !declared.has(chosen)) {
      throw new TypeError(
        `navigationModel: groupOf put ${section.id} in ${chosen}, which no group is.`,
      );
    }
    if (chosen === null) return;
    let id: G | undefined;
    if (destination === null) {
      id = chosen ?? grouping.unplaced;
    } else {
      // Display alone: a section stays in a group standing for its own destination.
      if (chosen !== undefined && declared.get(chosen)!.destination !== destination) {
        warn(
          `groupOf put ${section.id}, whose destination is ${destination}, in ${chosen}, which stands for ${declared.get(chosen)!.destination}. Grouping never moves a section to another destination, so it stays in ${destination}'s group.`,
        );
      } else {
        id = chosen;
      }
      id ??= home.get(destination);
      if (id === undefined) {
        warn(
          `no group stands for ${destination}, so ${section.id} is in no group. Declare one, which drops while it's empty.`,
        );
      }
    }
    if (id === undefined) return;
    const list = members.get(id);
    if (list) list.push(section);
    else members.set(id, [section]);
  });
  return grouping.groups.flatMap((group): SectionGroup<G>[] => {
    const sections = members.get(group.id);
    if (!sections) return [];
    const label = group.label
      ? composedLabel(group.label, DESTINATION_LABELS[group.destination], outline.locale)
      : labelOf(group.destination, options, outline.locale);
    return [
      {
        id: group.id,
        destination: group.destination,
        ...label,
        href: (namedFor(label.label, sections, outline.locale) ?? sections[0]!).href!,
        sections,
      },
    ];
  });
}
