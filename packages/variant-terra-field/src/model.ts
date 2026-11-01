import type {
  ChronologyEntry,
  Evidence,
  Placement,
  Section,
  SectionKind,
  Work,
} from '@portfolio/schema';
import {
  anchorSection,
  DESTINATION_LABELS,
  footerOutline,
  hrefFor,
  isRoutedWork,
  defineNavigationOverrides,
  navigationModel,
  pageOutline,
  placedImage,
  present,
  sectionRenders,
  worksOf,
  type CaseStudyField,
  type CaseStudyOutline,
  type DestinationId,
  type FooterOutline,
  type OutlineWork,
  type RelatedWork,
  type NavigationModel,
  type OutlineSection,
  type PlacedImage,
  type SectionOf,
} from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';

// Terra Field's content model (brief §5.5, TF-M6): every derivation the
// composition makes from a portfolio, pure, with no person's words in it
// (N4, S6). The page reads the portfolio only through these, so what a
// render shows is what the rules give: the opening field (the kicker, the
// one display line, the lede, one action, the seal on the arc), the anchor
// band (one photograph and two captioned plates), the five destination
// fields in the fixed order, each with its own short index, and the
// closing field.

/** The fixed order of the fields: the five destinations (K-1). */
export const FIELD_ORDER: readonly DestinationId[] = [
  'work',
  'writing',
  'record',
  'about',
  'contact',
];

/** The display line takes the thesis's first sentence only up to this many characters. */
export const HERO_LINE_MAX = 60;

/** At most this many companion plates beside the photograph. */
export const MAX_COMPANIONS = 2;

/**
 * The seal holds its label in two short lines at most. Past these, a
 * metric's label falls back to its unit alone, and an award, which has no
 * shorter words of its own, takes no seal (TF-M2: never author new text).
 */
export const SEAL_WORDS = 3;
export const SEAL_CHARS = 22;

/** Ids the composition gives its own elements: two hyphens, which no content id has. */
export function chromeIds(prefix: string) {
  return {
    notes: `${prefix}tf--notes`,
    notesTitle: `${prefix}tf--notes-title`,
    band: `${prefix}tf--band`,
    bandTitle: `${prefix}tf--band-title`,
    companion: (index: number) => `${prefix}tf--companion-${index + 1}`,
    field: (id: DestinationId) => `${prefix}tf--${id}`,
    fieldTitle: (id: DestinationId) => `${prefix}tf--${id}-title`,
    where: `${prefix}tf--where`,
    heroTitle: `${prefix}tf--hero-title`,
    caseTitle: `${prefix}tf--case-title`,
    caseFacts: `${prefix}tf--case-facts`,
    caseNext: `${prefix}tf--case-next`,
  };
}

/** Whether the text is there to show. */
export const said = (text: string | undefined | null): text is string => present(text);

/** Abbreviations a sentence never ends on. */
const ABBREVIATION = /(?:^|\s)(?:[A-Z]|Mr|Mrs|Ms|Dr|St|Jr|Sr|Prof|vs|etc|e\.g|i\.e|cf|No|Vol)\.$/;

/**
 * A text's first sentence and the rest (K-6 `firstSentence`, kept here
 * until the kit lifts it): the first `.`, `!` or `?` followed by a space and
 * a capital or a digit, outside a Markdown link or code, and never after an
 * abbreviation or an initial.
 */
export function firstSentence(text: string): { readonly lead: string; readonly rest?: string } {
  const source = text.replace(/\s+/g, ' ').trim();
  let depth = 0;
  let code = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (char === '`') code = !code;
    if (code) continue;
    if (char === '[' || char === '(') depth++;
    else if ((char === ']' || char === ')') && depth > 0) depth--;
    if (depth > 0 || !/[.!?]/.test(char)) continue;
    let end = i + 1;
    while (end < source.length && /["'”’*_)]/.test(source[end]!)) end++;
    if (source[end] !== ' ' || !/[\p{Lu}\p{N}"“‘(]/u.test(source[end + 1] ?? '')) continue;
    const lead = source.slice(0, end);
    if (char === '.' && ABBREVIATION.test(lead.replace(/[*_]+$/, ''))) continue;
    return { lead, rest: source.slice(end + 1) };
  }
  return { lead: source };
}

/** Plain characters of a short Markdown line, for counting: a link's words, not its target (low 6). */
const plain = (text: string) => text.replace(/\]\([^)]*\)/g, ']').replace(/[*_`[\]]/g, '');

/** The words of a text. */
const wordsOf = (text: string) => text.trim().split(/\s+/).filter(Boolean);

/** The newest of the records by a date each gives, the first listed on a tie. */
function newest<T>(records: readonly T[], date: (record: T) => string): T | undefined {
  let best: T | undefined;
  for (const record of records) {
    if (best === undefined || date(record).localeCompare(date(best)) > 0) best = record;
  }
  return best;
}

/**
 * The current role (K-6 `currentRole`, kept here until the kit lifts it):
 * the role-kind chronology entry with no end and the latest start.
 */
export function currentRole(
  input: Pick<VariantRenderInput, 'portfolio'>,
): ChronologyEntry | undefined {
  return newest(
    input.portfolio.chronology.filter(
      (entry) => entry.kind === 'role' && entry.period.end === undefined,
    ),
    (entry) => String(entry.period.start ?? ''),
  );
}

/** The records the curation lists name (K-6 `proofOf`). */
export interface Proof {
  /** The signature work, when it's a public work. */
  readonly signature?: Work;
  /** The proof strip's evidence, in its order, each a public record. */
  readonly proof: readonly Evidence[];
}

/**
 * K-6 `proofOf(input)`, kept here with the kit's planned signature until A
 * lifts it: the signature id resolved to its work and the proof ids to
 * their evidence, in order, leaving out any id the view doesn't hold.
 */
export function proofOf(input: Pick<VariantRenderInput, 'portfolio'>): Proof {
  const { portfolio } = input;
  const evidence = new Map(portfolio.evidence.map((record) => [record.id, record]));
  const signature = portfolio.signature
    ? portfolio.works.find((work) => work.id === portfolio.signature)
    : undefined;
  return {
    ...(signature ? { signature } : {}),
    proof: portfolio.proof.flatMap((id) => {
      const record = evidence.get(id);
      return record ? [record] : [];
    }),
  };
}

/** Whether the record has its anchor on this page: a section the composition renders lists it. */
export function onPage(record: { readonly id: string }, input: VariantRenderInput): boolean {
  return anchorSection(record, input) !== undefined;
}

/** A link to a record where the page shows it, or none when no section shows it. */
export const recordHref = (record: { readonly id: string }, input: VariantRenderInput) =>
  onPage(record, input) ? `#${input.ids.prefix}${record.id}` : undefined;

/** A work's own page, when it has a case study. */
export function workHref(work: Work, input: VariantRenderInput): string | undefined {
  return isRoutedWork(work) ? routeHref(input, { route: 'work', slug: work.slug }) : undefined;
}

// ---- the opening -----------------------------------------------------------

/** Which words the display line is. */
export type HeroLineSource = 'thesis' | 'tagline' | 'name';

export interface HeroLine {
  readonly text: string;
  readonly source: HeroLineSource;
}

/**
 * The display line, the page's h1 (N5): the `heroLine` control's choice,
 * falling to the next the content can fill, in the order thesis, tagline,
 * name. The thesis is its first sentence when that is HERO_LINE_MAX
 * characters or fewer; the tagline is the hero's.
 */
export function heroLine(input: VariantRenderInput, hero?: SectionOf<'hero'>): HeroLine {
  const thesis = input.portfolio.practice?.thesis;
  const lead = said(thesis) ? firstSentence(thesis).lead : undefined;
  const fromThesis =
    lead !== undefined && [...plain(lead)].length <= HERO_LINE_MAX ? lead : undefined;
  const tagline = said(hero?.tagline) ? hero!.tagline : undefined;
  const name = said(hero?.name) ? hero!.name : input.portfolio.identity.name;
  const order: readonly HeroLineSource[] =
    input.controls.heroLine === 'name'
      ? ['name']
      : input.controls.heroLine === 'tagline'
        ? ['tagline', 'name']
        : ['thesis', 'tagline', 'name'];
  for (const source of order) {
    if (source === 'thesis' && fromThesis !== undefined) return { text: fromThesis, source };
    if (source === 'tagline' && tagline !== undefined) return { text: tagline, source };
  }
  return { text: name, source: 'name' };
}

/** The kicker (TF-M3): the name and the current role, in place of a greeting. */
export interface Kicker {
  /** The name, unless the display line already is the name. */
  readonly name?: string;
  /** The current role's title. */
  readonly role?: string;
  /** Where, which the kicker joins to the title with "at", not a third comma (S-13). */
  readonly organization?: string;
  readonly lang?: string;
}

export function kickerOf(
  input: VariantRenderInput,
  line: HeroLine,
  hero?: SectionOf<'hero'>,
): Kicker | undefined {
  const name = said(hero?.name) ? hero!.name : input.portfolio.identity.name;
  const role = currentRole(input);
  // The name and the current role only (TF-M3): with no role there's no tagline in its place,
  // which the footer says already (code review low 7).
  const kicker: Kicker = {
    ...(line.source !== 'name' && said(name) ? { name } : {}),
    ...(role && said(role.title) ? { role: role.title } : {}),
    ...(role && said(role.title) && said(role.organization)
      ? { organization: role.organization }
      : {}),
    ...(role?.lang !== undefined ? { lang: role.lang } : {}),
  };
  return kicker.name !== undefined || kicker.role !== undefined ? kicker : undefined;
}

/** The lede (brief §5.5): the hero's tagline, unless it's the display line, then the subtagline. */
export function ledeOf(
  line: HeroLine,
  hero?: SectionOf<'hero'>,
): { readonly lede?: string; readonly sub?: string } {
  return {
    ...(line.source !== 'tagline' && said(hero?.tagline) ? { lede: hero!.tagline } : {}),
    ...(said(hero?.subtagline) ? { sub: hero!.subtagline } : {}),
  };
}

/** The one action (TF-M3): the hero's first, else the contact section's place. */
export interface Action {
  /** Resolved for the page: the outline's contact anchor already carries the ids prefix. */
  readonly href: string;
  readonly label: string;
  /** Whose words the label is: the owner's, or the composition's own ("Get in touch"). */
  readonly own: boolean;
}

export function actionOf(
  input: VariantRenderInput,
  hero: SectionOf<'hero'> | undefined,
  footer: FooterOutline,
): Action | undefined {
  const first = hero?.ctas?.find((cta) => said(cta.label) && said(cta.url));
  if (first) return { href: hrefFor(first.url, input), label: first.label, own: false };
  if (footer.contactHref) return { href: footer.contactHref, label: 'Get in touch', own: true };
  return undefined;
}

/** The seal on the arc's low point (TF-M2): one proof record's figure and its words. */
export interface Seal {
  readonly id: string;
  /** The big line: a metric's figure, an award's year. */
  readonly value: string;
  /** The small line under it, the record's own words. */
  readonly label?: string;
  /** Where it links: the record on the page, when a section shows it. */
  readonly href?: string;
  readonly lang?: string;
  /**
   * The label's line, in characters, as the seal sets it on two lines at most:
   * the longer line of its best split between words. It sets the seal's size.
   */
  readonly widest: number;
  /** The figure's length in characters, which sets the seal's size too. */
  readonly figure: number;
}

/**
 * A statement's first clause, as written: up to its first semicolon, colon
 * or dash, its first comma that isn't inside a number (1,200), or its first
 * stop that ends a sentence (not 99.95 or 3.5x).
 */
export const firstClause = (text: string) =>
  plain(text)
    .split(/[;:—–]|(?<!\d),|,(?!\d)|\.(?=\s|$)/)[0]!
    .trim();

/** Whether a label fits the seal's two short lines. */
const fits = (label: string) =>
  wordsOf(label).length <= SEAL_WORDS && [...label].length <= SEAL_CHARS;

/** East Asian wide and full-width characters, about two `ch` each (code review low 5). */
const WIDE =
  /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u;

/** A word's width in `ch`: a wide character counts two. */
const columnsOf = (word: string) => [...word].reduce((n, char) => n + (WIDE.test(char) ? 2 : 1), 0);

/**
 * The longer line, in characters, when `text` breaks between words onto two
 * lines as evenly as it can: one line for a single word.
 */
export function twoLineWidth(text: string | undefined): number {
  const words = text ? wordsOf(text).map(columnsOf) : [];
  if (words.length === 0) return 0;
  const line = (from: number, to: number) =>
    words.slice(from, to).reduce((sum, n) => sum + n, 0) + Math.max(0, to - from - 1);
  let best = line(0, words.length);
  for (let cut = 1; cut < words.length; cut++) {
    best = Math.min(best, Math.max(line(0, cut), line(cut, words.length)));
  }
  return best;
}

/** The figure a metric shows, grouped in the content's locale. */
export function figureOf(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return new Intl.NumberFormat('en').format(value);
  }
}

/**
 * The seal's words for a proof record (brief §5.5): a metric is its figure,
 * then its unit plus its statement's first clause (the unit once, when the
 * clause starts with it), or the unit alone when that won't fit the seal,
 * or nothing; an award is its year and its title, when the title fits. Any
 * other type takes no seal.
 */
export function sealText(
  record: Evidence,
  locale: string,
): Pick<Seal, 'value' | 'label'> | undefined {
  if (record.type === 'metric' && record.metric?.value !== undefined) {
    const value = figureOf(record.metric.value, locale);
    const unit = said(record.metric.unit) ? record.metric.unit.trim() : undefined;
    const clause = said(record.statement) ? firstClause(record.statement) : '';
    const leads = unit !== undefined && clause.toLowerCase().startsWith(unit.toLowerCase());
    // The owner's words exactly, case and all (N3): never a changed or new word.
    const full = [leads ? undefined : unit, clause].filter(said).join(' ');
    const label = said(full) && fits(full) ? full : unit;
    return label !== undefined ? { value, label } : { value };
  }
  if (record.type === 'award' && said(record.receivedAt) && said(record.title)) {
    const year = /^(\d{4})/.exec(String(record.receivedAt))?.[1];
    if (year && fits(record.title)) return { value: year, label: record.title };
  }
  return undefined;
}

/** The seal, from the first proof record, unless the `seal` control is off. */
export function sealOf(input: VariantRenderInput): Seal | undefined {
  if (input.controls.seal === false) return undefined;
  const record = proofOf(input).proof[0];
  if (!record) return undefined;
  const text = sealText(record, record.lang ?? input.portfolio.locale);
  if (!text) return undefined;
  const href = recordHref(record, input);
  return {
    id: record.id,
    ...text,
    ...(href ? { href } : {}),
    ...(record.lang !== undefined ? { lang: record.lang } : {}),
    widest: twoLineWidth(text.label),
    figure: [...text.value].length,
  };
}

// ---- the anchor band -------------------------------------------------------

const PHOTOGRAPHS = new Set(['photography', 'image-series']);

/** The works the page's rendered works sections show, in reading order, once each. */
function shownWorks(input: VariantRenderInput): readonly Work[] {
  const seen = new Set<string>();
  return input.portfolio.sections
    .filter((section) => section.kind === 'works' && sectionRenders(section, input))
    .flatMap((section) => worksOf(section, input))
    .filter((work) => (seen.has(work.id) ? false : (seen.add(work.id), true)));
}

/** A work's first placed image, and the placement it came from. */
function firstImage(
  work: Work,
  input: VariantRenderInput,
): { readonly placement: Placement; readonly image: PlacedImage } | undefined {
  for (const placement of [work.cover, ...(work.media ?? [])]) {
    if (!placement) continue;
    const image = placedImage(placement, input);
    // Only an image that's ready anchors the opening; one still processing or lost would be an empty frame.
    if (image && image.image.state === 'ready') return { placement, image };
  }
  return undefined;
}

/** The band's photograph. */
export interface AnchorPhoto {
  readonly work: Work;
  readonly placement: Placement;
  readonly image: PlacedImage;
  /** How many images the work holds. */
  readonly count: number;
  /** Where the work sits on the page. */
  readonly href?: string;
  /** Whether it's the signature work's cover, which then takes no companion of its own. */
  readonly signature: boolean;
}

/** One captioned plate beside the photograph. */
export type Companion =
  | {
      readonly kind: 'work';
      readonly work: Work;
      readonly signature: boolean;
      readonly href?: string;
    }
  | { readonly kind: 'evidence'; readonly record: Evidence; readonly href?: string };

export interface AnchorBand {
  readonly photo?: AnchorPhoto;
  readonly companions: readonly Companion[];
}

/** The ids a control lists. */
const idList = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];

/**
 * The anchor band (brief §5.5, TF-M4): the photograph is the `anchorWork`
 * control's work when it has an image, else the first photography or
 * image-series work the page shows with an image, else the signature
 * work's cover; with none, the band is its two plates alone. The plates
 * are the `companions` control's records when any is public, else the
 * signature work (unless it's the photograph) and then the proof list
 * after the seal's record, up to MAX_COMPANIONS.
 */
export function anchorBandOf(input: VariantRenderInput, seal?: Seal): AnchorBand {
  const { portfolio } = input;
  const { signature, proof } = proofOf(input);
  const works = new Map(portfolio.works.map((work) => [work.id, work]));
  const photoOf = (work: Work | undefined, isSignature = false): AnchorPhoto | undefined => {
    if (!work) return undefined;
    const found = firstImage(work, input);
    if (!found) return undefined;
    const href = recordHref(work, input);
    return {
      work,
      ...found,
      // Every photograph the series holds: its media and a cover that isn't one of them (low 10).
      count:
        new Set([work.cover, ...(work.media ?? [])].flatMap((each) => (each ? [each.asset] : [])))
          .size || 1,
      ...(href ? { href } : {}),
      signature: isSignature,
    };
  };
  const control = input.controls.anchorWork;
  const chosen = typeof control === 'string' ? works.get(control) : undefined;
  const photo =
    photoOf(chosen, chosen !== undefined && chosen.id === signature?.id) ??
    shownWorks(input)
      .filter((work) => PHOTOGRAPHS.has(work.medium))
      .map((work) => photoOf(work, work.id === signature?.id))
      .find((found) => found !== undefined) ??
    (signature && signature.cover ? photoOf({ ...signature, media: [] }, true) : undefined);

  const asCompanion = (id: string): Companion | undefined => {
    const work = works.get(id);
    if (work) {
      const href = workHref(work, input) ?? recordHref(work, input);
      return {
        kind: 'work',
        work,
        signature: work.id === signature?.id,
        ...(href ? { href } : {}),
      };
    }
    const record = portfolio.evidence.find((each) => each.id === id);
    if (record) {
      const href = recordHref(record, input);
      return { kind: 'evidence', record, ...(href ? { href } : {}) };
    }
    return undefined;
  };
  const pick = (ids: readonly string[]) => {
    const companions: Companion[] = [];
    for (const id of ids) {
      if (companions.length === MAX_COMPANIONS) break;
      if (id === photo?.work.id || companions.some((each) => idOf(each) === id)) continue;
      const companion = asCompanion(id);
      if (companion) companions.push(companion);
    }
    return companions;
  };
  const chosenCompanions = pick(idList(input.controls.companions));
  const sealIndex = seal ? proof.findIndex((record) => record.id === seal.id) : -1;
  const companions =
    chosenCompanions.length > 0
      ? chosenCompanions
      : pick([
          ...(signature && !photo?.signature ? [signature.id] : []),
          ...proof.slice(sealIndex + 1).map(({ id }) => id),
        ]);
  return { ...(photo ? { photo } : {}), companions };
}

/** A companion's record id. */
export const idOf = (companion: Companion) =>
  companion.kind === 'work' ? companion.work.id : companion.record.id;

// ---- the fields ------------------------------------------------------------

/** How a destination's field opens (TF-M5): its ground's role, which way its arc bends, how deep. */
export interface FieldForm {
  /** The ground: a surface role, or the accent (its text then on-accent). */
  readonly tone: 'prominent' | 'subtle' | 'default' | 'accent';
  /** `sag`: the field's lower edge bows down to the page; `rise`: its upper edge bows up. */
  readonly arc: 'sag' | 'rise';
  readonly depth: 'shallow' | 'mid' | 'deep';
  /**
   * A subtle ground's hairline along its arc, so it opens in every scheme
   * (S-5): the border's, or the accent's for the one destination that keeps
   * the accent quietly, as a line, not a ground (S-6).
   */
  readonly edge?: 'border' | 'accent';
}

/**
 * Each destination's field, so no two open alike, and all quieter than the
 * hero's: only the close, the other bookend, takes the accent's full ground.
 */
export const FIELD_FORMS: Readonly<Record<DestinationId, FieldForm>> = {
  work: { tone: 'prominent', arc: 'sag', depth: 'deep' },
  writing: { tone: 'subtle', arc: 'rise', depth: 'shallow', edge: 'border' },
  record: { tone: 'subtle', arc: 'sag', depth: 'mid', edge: 'accent' },
  about: { tone: 'default', arc: 'rise', depth: 'mid' },
  contact: { tone: 'accent', arc: 'rise', depth: 'deep' },
};

/** One destination's field: its word, its form, its short index, and its sections. */
export interface Field {
  readonly id: DestinationId;
  readonly label: string;
  readonly lang?: string;
  readonly form: FieldForm;
  /** What its index lists: every titled section it holds, with somewhere to land. */
  readonly index: readonly OutlineSection[];
  readonly sections: readonly Section[];
}

/**
 * The sections whose title only repeats their field's word ("About" under
 * About): their heads stay for the outline but don't show twice (S-9).
 */
export function echoedHeads(fields: readonly Field[]): ReadonlySet<string> {
  const same = (a: string, b: string) =>
    a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
  return new Set(
    fields.flatMap((field) =>
      field.sections.flatMap((section) =>
        'title' in section && said(section.title) && same(section.title, field.label)
          ? [section.id]
          : [],
      ),
    ),
  );
}

/** The page plan. */
export interface HomeModel {
  readonly navigation: NavigationModel;
  readonly footer: FooterOutline;
  readonly hero?: SectionOf<'hero'>;
  readonly line: HeroLine;
  readonly kicker?: Kicker;
  readonly lede: { readonly lede?: string; readonly sub?: string };
  readonly action?: Action;
  readonly seal?: Seal;
  readonly band: AnchorBand;
  /** The thesis section, which stays the opening's standfirst. */
  readonly thesis?: SectionOf<'practice'>;
  /** The standfirst's words: the thesis after the display line, or all of it. */
  readonly standfirst?: string;
  readonly fields: readonly Field[];
  readonly contact?: SectionOf<'contact'>;
  readonly cta?: SectionOf<'cta'>;
  /** The field quiet: the `field` control. */
  readonly quiet: boolean;
  /** The host's words, marked English in a portfolio in another language. */
  readonly uiLang: 'en' | undefined;
}

/**
 * Terra's departures from the canonical map: the sections it has no index
 * place for (a custom section) close the About field, so the
 * masthead, Field notes and the footer reach the field they render in (N7).
 */
export const TERRA_OVERRIDES = defineNavigationOverrides({ custom: 'about' });

/** Builds the page plan from the render input. */
export function homeModel(input: VariantRenderInput): HomeModel {
  const { portfolio } = input;
  const outline = pageOutline(input);
  const navigation = navigationModel(outline, { overrides: TERRA_OVERRIDES });
  const footer = footerOutline(input);
  const rendered = portfolio.sections.filter((section) => sectionRenders(section, input));
  const hero = rendered.find((section): section is SectionOf<'hero'> => section.kind === 'hero');
  const thesisText = portfolio.practice?.thesis;
  const thesis = said(thesisText)
    ? rendered.find(
        (section): section is SectionOf<'practice'> =>
          section.kind === 'practice' && section.part === 'thesis',
      )
    : undefined;
  const contact = rendered.find(
    (section): section is SectionOf<'contact'> => section.kind === 'contact',
  );
  const cta = footer.cta
    ? rendered.find(
        (section): section is SectionOf<'cta'> =>
          section.kind === 'cta' && section.id === footer.cta!.id,
      )
    : undefined;
  const line = heroLine(input, hero);
  const kicker = kickerOf(input, line, hero);
  const seal = sealOf(input);
  // The thesis after the display line, or the whole thesis when the line isn't it.
  const standfirst =
    thesis && said(thesisText)
      ? line.source === 'thesis'
        ? firstSentence(thesisText).rest
        : thesisText.replace(/\s+/g, ' ').trim()
      : undefined;

  // The opening and the close render their own sections; the fields the rest.
  const elsewhere = new Set([hero?.id, thesis?.id, contact?.id, cta?.id].filter(said));
  const placed = new Map<DestinationId, Section[]>();
  const unplaced: Section[] = [];
  for (const section of rendered) {
    if (elsewhere.has(section.id)) continue;
    const to = navigation.placed.get(section.id) ?? null;
    // Contact is the closing field; anything else Contact holds, or nothing
    // places (a second hero), closes About too.
    if (to === null || to === 'contact') unplaced.push(section);
    else placed.set(to, [...(placed.get(to) ?? []), section]);
  }
  const destinations = new Map(
    navigation.primary.map((destination) => [destination.id, destination]),
  );
  // They close About when the index reaches About; else the last field it does reach, so no
  // field renders that the masthead, Field notes and the footer can't (N7, re-review residual).
  const closes =
    destinations.has('about') || placed.has('about')
      ? 'about'
      : ([...FIELD_ORDER]
          .reverse()
          .find((id) => id !== 'contact' && destinations.has(id) && placed.has(id)) ?? 'about');
  if (unplaced.length > 0) placed.set(closes, [...(placed.get(closes) ?? []), ...unplaced]);
  const uiLang = /^en(?:-|$)/i.test(portfolio.locale) ? undefined : ('en' as const);
  const fields: Field[] = FIELD_ORDER.filter((id) => id !== 'contact').flatMap((id): Field[] => {
    const sections = placed.get(id) ?? [];
    if (sections.length === 0) return [];
    const destination = destinations.get(id);
    const ids = new Set(sections.map((section) => section.id));
    const index = outline.sections.filter(
      (entry) => ids.has(entry.id) && said(entry.title) && entry.href !== undefined,
    );
    return [
      {
        id,
        label: destination?.label ?? DESTINATION_LABELS[id],
        ...(destination?.lang !== undefined
          ? { lang: destination.lang }
          : uiLang
            ? { lang: uiLang }
            : {}),
        form: FIELD_FORMS[id],
        index,
        sections,
      },
    ];
  });
  return {
    navigation,
    footer,
    ...(hero ? { hero } : {}),
    line,
    ...(kicker ? { kicker } : {}),
    lede: ledeOf(line, hero),
    ...(actionOf(input, hero, footer) ? { action: actionOf(input, hero, footer)! } : {}),
    ...(seal ? { seal } : {}),
    band: anchorBandOf(input, seal),
    ...(thesis ? { thesis } : {}),
    ...(said(standfirst) ? { standfirst } : {}),
    fields,
    ...(contact ? { contact } : {}),
    ...(cta ? { cta } : {}),
    quiet: input.controls.field === 'quiet',
    uiLang,
  };
}

// ---- section forms ---------------------------------------------------------

const WRITTEN = new Set(['writing', 'research']);

/** Whether every record passes the test, and there is one. */
const all = <T>(records: readonly T[], test: (record: T) => boolean) =>
  records.length > 0 && records.every(test);

/** Which form a works section takes, by its works' mediums (brief §5.5), never by id or title. */
export type WorksForm = 'series' | 'episodes' | 'gallery' | 'sleeve' | 'essays';

export function worksForm(section: Section, input: VariantRenderInput): WorksForm {
  const works = worksOf(section, input);
  if (all(works, (work) => WRITTEN.has(work.medium))) return 'essays';
  if (all(works, (work) => work.medium === 'audio-video')) return 'episodes';
  if (
    all(
      works,
      (work) => PHOTOGRAPHS.has(work.medium) && (work.media ?? []).some((each) => each.asset),
    )
  )
    return 'gallery';
  if (all(works, (work) => work.medium === 'music')) return 'sleeve';
  return 'series';
}

/** Which form an evidence section takes, by its records' types. */
export type EvidenceForm =
  | 'ledger'
  | 'voices'
  | 'citations'
  | 'talks'
  | 'year-seals'
  | 'pull-quotes'
  | 'signposts'
  | 'ruled';

export function evidenceForm(records: readonly Evidence[]): EvidenceForm {
  if (all(records, (record) => record.type === 'metric' && record.metric?.value !== undefined))
    return 'ledger';
  if (all(records, (record) => record.type === 'testimonial')) return 'voices';
  if (all(records, (record) => record.type === 'publication' || record.type === 'patent'))
    return 'citations';
  if (all(records, (record) => record.type === 'talk')) return 'talks';
  if (all(records, (record) => record.type === 'award' && said(record.receivedAt)))
    return 'year-seals';
  if (all(records, (record) => record.type === 'press')) return 'pull-quotes';
  if (all(records, (record) => record.type === 'external-work')) return 'signposts';
  return 'ruled';
}

/** What a section head counts: its items and their noun, in English, or none. */
export function countOf(
  section: Section,
  input: VariantRenderInput,
): { readonly n: number; readonly one: string; readonly many: string } | undefined {
  switch (section.kind) {
    case 'works': {
      const works = worksOf(section, input);
      const form = worksForm(section, input);
      if (form === 'gallery') {
        const n = works.reduce((sum, work) => sum + (work.media?.length ?? 0), 0);
        return { n, one: 'photograph', many: 'photographs' };
      }
      if (form === 'episodes') return { n: works.length, one: 'episode', many: 'episodes' };
      if (form === 'essays') return { n: works.length, one: 'piece', many: 'pieces' };
      if (form === 'sleeve') return { n: works.length, one: 'record', many: 'records' };
      return { n: works.length, one: 'work', many: 'works' };
    }
    case 'evidence':
      return {
        n: section.items.filter((id) => input.portfolio.evidence.some((each) => each.id === id))
          .length,
        one: 'entry',
        many: 'entries',
      };
    case 'chronology': {
      const ids = section.items ?? input.portfolio.chronology.map(({ id }) => id);
      return {
        n: ids.filter((id) => input.portfolio.chronology.some((entry) => entry.id === id)).length,
        one: 'entry',
        many: 'entries',
      };
    }
    default:
      return undefined;
  }
}

/** The form a section's frame names (data-form), for its layout: by content shape, never by id. */
export function sectionForm(section: Section, input: VariantRenderInput): string {
  switch (section.kind) {
    case 'works':
      return worksForm(section, input);
    case 'evidence':
      return evidenceForm(
        section.items.flatMap((id) =>
          input.portfolio.evidence.filter((record) => record.id === id),
        ),
      );
    case 'practice':
      return section.part;
    default:
      return section.kind;
  }
}

/** The evidence forms of the full record, which fold (Design gate rule 8). */
const RECORD_FORMS = new Set([
  'citations',
  'talks',
  'year-seals',
  'pull-quotes',
  'signposts',
  'ruled',
]);

/**
 * Whether a section is part of the full record, behind a closed disclosure
 * at home (Design gate rule 8): education (a chronology of studies),
 * publications, talks, awards, patents, press and work elsewhere, the GitHub
 * snapshot, and the skills and the stack. The summary stays open: the
 * figures, the voices, the roles, and every work. By content shape, never
 * by id or title.
 */
export function folds(section: Section, input: VariantRenderInput): boolean {
  switch (section.kind) {
    case 'evidence':
      return RECORD_FORMS.has(sectionForm(section, input));
    case 'chronology': {
      const ids = section.items ?? input.portfolio.chronology.map(({ id }) => id);
      const entries = input.portfolio.chronology.filter((entry) => ids.includes(entry.id));
      return all(entries, (entry) => entry.kind === 'study');
    }
    case 'github':
      return true;
    case 'practice':
      return section.part === 'skills' || section.part === 'tools';
    default:
      return false;
  }
}

/** Whether Field notes has an index to hold: a destination besides Contact. */
export const hasNotes = (model: Pick<HomeModel, 'navigation'>) =>
  model.navigation.primary.some(({ id }) => id !== 'contact');

/** The sections of one kind, for a renderer that needs its section's kind narrowed. */
export const isKind = <K extends SectionKind>(section: Section, kind: K): section is SectionOf<K> =>
  section.kind === kind;

// ---------------------------------------------------------------------------
// A work's own page (P2, brief §5.5 step 9)

/** What a medium is called in a work's kicker and the case's fact sheet. */
export const MEDIUM_WORDS: Readonly<Record<string, string>> = {
  interface: 'Interface',
  system: 'System',
  software: 'Software',
  photography: 'Photography',
  'image-series': 'Photographs',
  writing: 'Writing',
  research: 'Research',
  music: 'Music',
  'audio-video': 'Recording',
  object: 'Object',
};

/**
 * Each part of a case study in Terra's own words, never the schema's field
 * names, so no two compositions print the same fixed heads in one order.
 */
export const PART_WORDS: Readonly<Record<CaseStudyField, string>> = {
  challenge: 'The problem',
  context: 'Where it sat',
  role: 'What I did',
  constraints: 'What held it in',
  decisions: 'Decisions, in order',
  evidence: 'On the record',
  outcomes: 'What came of it',
  reflection: 'In hindsight',
};

/** The work's description, which opens the account before its parts. */
export const OVERVIEW_WORD = 'Overview';

/** One part of the account: a case-study part, or the overview before them. */
export interface CasePart {
  readonly key: CaseStudyField | 'overview';
  readonly anchor: string;
  readonly href: string;
  readonly label: string;
  /** Decisions and cited records count their items; every other part is 1. */
  readonly count: number;
}

/** Where the page goes on: the next case study, else All work beside a related plate. */
export type Onward =
  | { readonly kind: 'next'; readonly next: OutlineWork; readonly work?: Work }
  | {
      readonly kind: 'all';
      readonly href: string;
      readonly related?: {
        readonly title: string;
        readonly lang?: string;
        /** Its own page, else its place on home. */
        readonly href: string;
        readonly of?: Work;
        /** What the two share, as the plate's label says it: the medium, then the tags and tools. */
        readonly terms: readonly string[];
      };
    };

export interface CaseModel {
  readonly home: HomeModel;
  /** The home section that holds the work: the crumb back. */
  readonly place?: {
    readonly id: string;
    readonly label: string;
    readonly href: string;
    readonly lang?: string;
  };
  /** The destination that holds its place on home, which the masthead marks current (S-4). */
  readonly here?: DestinationId;
  readonly signature: boolean;
  /** The cover the field's arc opens onto, only when its image is ready. */
  readonly cover?: { readonly placement: Placement; readonly image: PlacedImage };
  readonly parts: readonly CasePart[];
  /** The records the work cites, in its order. */
  readonly cited: readonly Evidence[];
  /** The cited awards, which the fact sheet names as recognition. */
  readonly awards: readonly Evidence[];
  readonly onward: Onward;
}

/** The first rendered, titled works section on home that lists the work, with its anchor. */
function placeOf(work: Work, input: VariantRenderInput): CaseModel['place'] {
  for (const entry of pageOutline(input).sections) {
    if (entry.kind !== 'works' || entry.href === undefined || !said(entry.title)) continue;
    const section = input.portfolio.sections.find(({ id }) => id === entry.id);
    if (!section || !worksOf(section, input).some(({ id }) => id === work.id)) continue;
    return {
      id: entry.id,
      label: entry.title,
      href: entry.href,
      ...(entry.lang ? { lang: entry.lang } : {}),
    };
  }
  return undefined;
}

/** What a related plate says the two works share: the medium first, then the tags and tools. */
export function relatedTerms(
  related: Pick<RelatedWork, 'sameMedium' | 'shared'>,
  work: Pick<Work, 'medium'>,
): string[] {
  const medium = MEDIUM_WORDS[work.medium];
  return [...(related.sameMedium && medium ? [medium.toLowerCase()] : []), ...related.shared];
}

/**
 * The nearest related work with no page of its own, at its place on home:
 * most shared tags and tools first, then the same medium, in the works'
 * order. For a case with no next one whose outline relates no other page.
 */
function relatedOnHome(work: Work, input: VariantRenderInput, home: string) {
  const terms = [...(work.tags ?? []), ...(work.tools ?? [])];
  return input.portfolio.works
    .map((each, order) => {
      const theirs = new Set([...(each.tags ?? []), ...(each.tools ?? [])]);
      const shared = [...new Set(terms.filter((term) => theirs.has(term)))];
      return { each, order, shared, sameMedium: each.medium === work.medium };
    })
    .filter(({ each, shared, sameMedium }) => {
      if (each.id === work.id || !onPage(each, input)) return false;
      return shared.length > 0 || sameMedium;
    })
    .sort((a, b) => b.shared.length - a.shared.length || a.order - b.order)
    .map(({ each, shared, sameMedium }) => ({
      title: each.title,
      ...(each.lang ? { lang: each.lang } : {}),
      href: `${home}#${input.ids.prefix}${each.id}`,
      of: each,
      terms: relatedTerms({ shared, sameMedium }, work),
    }))[0];
}

const withWork = (work: Work | undefined) => (work ? { work } : {});
const withOf = (work: Work | undefined) => (work ? { of: work } : {});

/**
 * An in-page link the content wrote (a call to action's `#section`), from
 * wherever the page is: on home as written, on a work's own page through
 * home's path, where that section is.
 */
export const homeward = (href: string, input: VariantRenderInput) =>
  href.startsWith('#') && input.route.route !== 'home'
    ? `${routeHref(input, { route: 'home' })}${href}`
    : href;

/** The page plan for a work's own page, from the render input and its outline. */
export function caseModel(input: VariantRenderInput, outline: CaseStudyOutline): CaseModel {
  const home = homeModel(input);
  const work = outline.work;
  const { portfolio, ids } = input;
  const cited = (work.evidence ?? []).flatMap((id) => {
    const record = portfolio.evidence.find((each) => each.id === id);
    return record ? [record] : [];
  });
  const overviewAnchor = `${ids.prefix}${work.id}--overview`;
  const parts: CasePart[] = [
    ...(said(work.description)
      ? [
          {
            key: 'overview' as const,
            anchor: overviewAnchor,
            href: `#${overviewAnchor}`,
            label: OVERVIEW_WORD,
            count: 1,
          },
        ]
      : []),
    ...outline.parts.map((part) => ({ ...part, label: PART_WORDS[part.key] })),
  ];
  let cover: CaseModel['cover'];
  for (const placement of [work.cover, ...(work.media ?? [])]) {
    if (!placement) continue;
    const image = placedImage(placement, input);
    // Only a ready image overlaps the arc; one still processing would be an empty frame (MF-1).
    if (image && image.image.state === 'ready') {
      cover = { placement, image };
      break;
    }
  }
  const byId = (id: string) => portfolio.works.find((each) => each.id === id);
  const place = placeOf(work, input);
  // With no Work field on home, All work goes to the section that lists this work (code low 4).
  const allWork = home.fields.some(({ id }) => id === 'work')
    ? `${outline.home}#${chromeIds(ids.prefix).field('work')}`
    : (place?.href ?? outline.home);
  const first = outline.related[0];
  const related = first
    ? {
        title: first.title,
        ...(first.lang ? { lang: first.lang } : {}),
        href: first.href,
        ...withOf(byId(first.id)),
        terms: relatedTerms(first, work),
      }
    : relatedOnHome(work, input, outline.home);
  const onward: Onward = outline.next
    ? { kind: 'next', next: outline.next, ...withWork(byId(outline.next.id)) }
    : { kind: 'all', href: allWork, ...(related ? { related } : {}) };
  const here = place ? home.navigation.placed.get(place.id) : undefined;
  return {
    home,
    ...(place ? { place } : {}),
    ...(here ? { here } : {}),
    signature: portfolio.signature === work.id,
    ...(cover ? { cover } : {}),
    parts,
    cited,
    awards: cited.filter((record) => record.type === 'award' && said(record.title)),
    onward,
  };
}
