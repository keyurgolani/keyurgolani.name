import type { ChronologyEntry, Section, Work } from '@portfolio/schema';
import {
  recordAnchor,
  chronologyOf,
  evidenceOf,
  sectionRenders,
  worksByIds,
  worksOf,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { CHAPTERS, RESERVED_ANCHORS } from './chapters';
import { yearOf as yearText } from './parts';

// Horizontal Cinema's scenes (redesign): the portfolio as a film strip of
// framed scenes in its five chapters. Pure and browser-safe, so the server
// render, the controller, and the tests read one list.
//
//   Prologue  the title card, from the leading hero; the signature work as
//             its lead frame; then the thesis, the lede, and any quote the
//             Origins card doesn't take as its epigraph
//   Origins   an intertitle, its epigraph the first quote; then the
//             timeline, a figure of every dated entry; then the chronology
//             and the fun facts
//   Journey   an intertitle; then the works sections the film has room
//             for, each a reel of one scene or more; the rest wait in the
//             full record
//   Craft     an intertitle; then the evidence, the practice, GitHub, and
//             custom sections, the ones that read together sharing a scene
//   Epilogue  an intertitle; then now, focus, the calls to action, and contact
//
// Every section that renders is in exactly one scene, or one reel, in its
// authored order inside its chapter, each in its own frame. An extension's
// section, which no chapter names, reads in Craft. A scene is 4, 6, 8, or 12
// columns wide, from what it holds, so each fits the stage. Works and
// chronology, which hold the most, are reels: the section is one frame whose
// records run over as many scenes as they need, each scene a part, never a
// scroller of its own. The stylesheet stacks every scene on a narrow screen
// and in the List view, and the controller does the same where a scene
// still doesn't fit.

type ViewSection = VariantRenderInput['portfolio']['sections'][number];
type HeroSection = Extract<Section, { kind: 'hero' }>;

/** A scene's width in the strip's columns. */
export type SceneWidth = 4 | 6 | 8 | 12;

export type Scene =
  | {
      readonly kind: 'title';
      readonly chapter: 0;
      readonly width: 8;
      /** The leading hero, which holds the page's one h1, or none for the identity's name alone. */
      readonly hero: HeroSection | undefined;
    }
  | {
      readonly kind: 'lead';
      readonly chapter: 0;
      readonly width: 12;
      /** The signature work, framed here as the Prologue's second scene. Its works section still renders in Journey. */
      readonly work: Work;
    }
  | {
      readonly kind: 'intertitle';
      readonly chapter: number;
      /** Four columns, six for a card with an epigraph and a long contents list, eight for a longer one in two columns. */
      readonly width: 4 | 6 | 8;
      /** A quote section the card sets as its epigraph, in its own frame. */
      readonly epigraph: ViewSection | undefined;
    }
  | {
      readonly kind: 'timeline';
      readonly chapter: number;
      readonly width: 12;
      /** The chronology sections it draws, each entry a bar on its thread. It frames none of them. */
      readonly sections: readonly ReelSection[];
    }
  | {
      readonly kind: 'reel';
      readonly chapter: number;
      readonly width: SceneWidth;
      /** The works or chronology section the reel frames, once, around all its parts. */
      readonly section: ReelSection;
      /** This part's place in the reel, from 0. */
      readonly part: number;
      readonly parts: number;
      /** The records this part shows, in order. */
      readonly items: readonly ReelItem[];
    }
  | {
      readonly kind: 'sections';
      readonly chapter: number;
      readonly width: SceneWidth;
      /** What the scene frames, one frame each, in reading order. */
      readonly sections: readonly ViewSection[];
    };

/** The sections a reel frames. */
export type ReelSection = Extract<ViewSection, { kind: 'works' | 'chronology' }>;

/**
 * How a record reads in its reel's part: a work with its still beside its
 * words, a release with its cover and tracks, a series of pictures, a
 * record of words alone, or the signature work, which opens the film, as
 * a line that points there.
 */
export type ReelRole = 'feature' | 'release' | 'gallery' | 'entry' | 'note';

export interface ReelItem {
  readonly id: string;
  readonly role: ReelRole;
  /** For a gallery, which of the work's pictures this part shows, [from, to). */
  readonly media?: readonly [number, number];
  /** For a chronology entry, how many of its part's columns its words take. */
  readonly columns?: number;
}

/** A scene with its place in the strip. */
export type PlacedScene = Scene & {
  /** From 1, in strip order. */
  readonly number: number;
  /** What its bars and the scrubber call it. */
  readonly title: string;
  /** The title without ", continued". */
  readonly base: string;
  /** The whole title is the composition's own word, not the owner's. */
  readonly own: boolean;
  /** A reel's later part. */
  readonly continued: boolean;
};

export interface HomeScenes {
  /** Every scene, in strip order. */
  readonly scenes: readonly PlacedScene[];
  /** The leading hero, if the page opens with one. */
  readonly hero: HeroSection | undefined;
  /** The signature work, if the portfolio names one. */
  readonly lead: Work | undefined;
  /** The full record, after the film, each section behind a closed disclosure, in authored order. */
  readonly record: readonly ViewSection[];
}

/**
 * Whether a section is the full record, which home carries behind a closed
 * disclosure after the film rather than as a scene (the home outline): the
 * chronology in detail, the practice's skills and stack, the code hosts'
 * activity, and any evidence beyond the figures and the words from
 * collaborators. The film keeps the thesis, the works it has room for (see
 * filmWorks), and one summary of the record: the figures, the
 * testimonials, the timeline, and the latest role on the title card.
 */
export function isRecord(
  section: ViewSection,
  input: Pick<VariantRenderInput, 'portfolio'>,
): boolean {
  switch (section.kind) {
    case 'chronology':
    case 'github':
      return true;
    case 'practice':
      return section.part === 'skills' || section.part === 'tools';
    case 'evidence': {
      const entries = evidenceOf(section, input);
      return (
        entries.length > 0 &&
        !entries.every((entry) => entry.type === 'metric' || entry.type === 'testimonial')
      );
    }
    default:
      return false;
  }
}

/** The scene anchor for a scene number: `scene-6`. */
export const sceneAnchor = (number: number): string => `scene-${number}`;

/**
 * Whether a scene is the closing slate, set on the matte like the title
 * card: the film's last scene of sections, holding calls to action alone.
 * A call to action anywhere earlier is a scene like any other.
 */
export function isClosing(scene: Scene, scenes: readonly Scene[]): boolean {
  if (scene.kind !== 'sections' || scene.sections.length === 0) return false;
  if (!scene.sections.every((section) => section.kind === 'cta')) return false;
  return scenes.findLast((one) => one.kind === 'sections') === scene;
}

/**
 * A record's anchor on the first section that lists it, the way the kit
 * gives it, unless its id is one the strip keeps for itself: a record
 * called `scene-3` or `chapter-journey` reads in place with none.
 */
export function recordId(
  section: Section,
  record: { readonly id: string },
  input: Parameters<typeof recordAnchor>[2],
): string | undefined {
  return isReservedAnchor(record.id) ? undefined : recordAnchor(section, record, input);
}

/**
 * Whether a scene folds on a phone, where every section at full length
 * makes the page too long to read: the timeline, whose entries the full
 * record holds again in detail; the fun facts; the practice's skills,
 * tools, and services; a record of awards, patents, or publications; and a
 * chronology of study alone. It stays open everywhere else, and with no
 * script at all.
 */
export function foldsOnPhone(scene: Scene, input: Pick<VariantRenderInput, 'portfolio'>): boolean {
  if (scene.kind === 'timeline') return true;
  const quiet = (section: ViewSection): boolean => {
    if (section.kind === 'fun-facts') return true;
    if (section.kind === 'practice') return section.part !== 'thesis';
    if (section.kind === 'evidence') {
      const entries = evidenceOf(section, input);
      return (
        entries.length > 0 &&
        entries.every((entry) => ['award', 'patent', 'publication'].includes(entry.type))
      );
    }
    if (section.kind === 'chronology') {
      const entries = chronologyOf(section, input);
      return entries.length > 0 && entries.every((entry) => entry.kind === 'study');
    }
    return false;
  };
  if (scene.kind === 'sections') return scene.sections.every(quiet);
  if (scene.kind === 'reel') return quiet(scene.section);
  return false;
}

/** Whether a section reads as a reel. */
export const isReel = (section: ViewSection): section is ReelSection =>
  section.kind === 'works' || section.kind === 'chronology';

/** Whether a content id is a scene's anchor, which the scene keeps. */
export const isSceneAnchor = (id: string): boolean => /^scene-[1-9]\d*$/.test(id);

/** Whether a content id is one the strip keeps for itself: a chapter's, the index's, or a scene's. */
export const isReservedAnchor = (id: string): boolean =>
  RESERVED_ANCHORS.has(id) || isSceneAnchor(id);

/** The chapter each core kind reads in, by position. A quote reads in Prologue unless Origins takes it. */
const CHAPTER_OF_KIND: Readonly<Record<string, number>> = {
  hero: 0,
  lede: 0,
  quote: 0,
  chronology: 1,
  'fun-facts': 1,
  works: 2,
  evidence: 3,
  github: 3,
  custom: 3,
  now: 4,
  focus: 4,
  cta: 4,
  contact: 4,
};

/** The chapter a section reads in; an extension's reads in Craft. */
function chapterOf(section: ViewSection): number {
  if (section.kind === 'practice') return section.part === 'thesis' ? 0 : 3;
  return Object.hasOwn(CHAPTER_OF_KIND, section.kind) ? CHAPTER_OF_KIND[section.kind]! : 3;
}

/**
 * Which sections share a scene when they're next to each other in a
 * chapter: the evidence that reads as a record, the practice's parts, now
 * with focus, the ways to get in touch, and GitHub with what's beside it.
 * Works and chronology, which carry the most, always take a scene alone.
 */
function groupOf(section: ViewSection): string | undefined {
  switch (section.kind) {
    case 'practice':
      return section.part === 'thesis' ? 'opening' : 'practice';
    case 'lede':
    case 'quote':
      return 'opening';
    case 'evidence':
    case 'github':
      return 'proof';
    case 'now':
    case 'focus':
      return 'now';
    // A call to action beside Get in touch shares its scene, one way to get in touch; alone at
    // the end, it's the film's closing slate.
    case 'contact':
    case 'cta':
      return 'connect';
    case 'fun-facts':
      return 'facts';
    default:
      return undefined;
  }
}

/** At most this many sections share a scene: two columns of text, never a page cut into a frame. */
const PER_SCENE = 2;

/** And at most this much of what they hold, by weightOf(), so a shared scene fits the stage. */
const SHARED_WEIGHT = 5;

/** The words in a value: every string with a space in it, so ids, addresses, and dates don't count. */
function wordsIn(value: unknown): number {
  if (typeof value === 'string') return /\s/.test(value.trim()) ? value.length : 0;
  if (Array.isArray(value)) return value.reduce((sum: number, one) => sum + wordsIn(one), 0);
  if (value && typeof value === 'object') {
    return Object.values(value).reduce((sum: number, one) => sum + wordsIn(one), 0);
  }
  return 0;
}

/** About how many characters of words a section shows: its own and its records'. */
function charsOf(section: ViewSection, input: Pick<VariantRenderInput, 'portfolio'>): number {
  const records = [...evidenceOf(section, input), ...chronologyOf(section, input)];
  return wordsIn(section) + wordsIn(records);
}

/** How much a section holds, roughly: its items, or 1 for a section of prose. */
function weightOf(section: ViewSection, input: Pick<VariantRenderInput, 'portfolio'>): number {
  switch (section.kind) {
    case 'works':
      return worksOf(section, input).length;
    case 'evidence':
      // A figure takes half a record's room.
      return evidenceOf(section, input).reduce(
        (sum, entry) => sum + (entry.type === 'metric' ? 0.5 : 1),
        0,
      );
    case 'chronology':
      return chronologyOf(section, input).length;
    case 'custom':
      return section.items?.length ?? 1;
    default:
      return 1;
  }
}

/**
 * A scene's width from how much it says: a short scene closes up to four
 * columns, a long one opens to eight or the full twelve, so no frame is a
 * few lines in an empty field or a page of small type.
 */
function widthOf(
  sections: readonly ViewSection[],
  input: Pick<VariantRenderInput, 'portfolio'>,
): SceneWidth {
  const chars = sections.reduce((sum, section) => sum + charsOf(section, input), 0);
  // Two sections share a frame, a column each: eight for a little, twelve for more.
  if (sections.length > 1) return chars > 1500 ? 12 : 8;
  // Items with pictures set each picture beside its words, which takes eight columns at least.
  const pictured = sections.some(
    (section) =>
      section.kind === 'custom' && (section.items ?? []).some((item) => item.media?.length),
  );
  if (pictured) return chars < 2100 ? 8 : 12;
  if (chars < 450) return 4;
  if (chars < 1200) return 6;
  if (chars < 2100) return 8;
  return 12;
}

/** A work's pictures besides its cover, the ones a gallery shows. */
function picturesOf(work: Work): number {
  return (work.media ?? []).length;
}

/** How a work reads in a reel. */
function roleOf(work: Work, lead: Work | undefined): ReelRole {
  if (work.id === lead?.id) return 'note';
  if (work.tracks?.length) return 'release';
  if (!work.cover && picturesOf(work) > 1) return 'gallery';
  if (work.cover || picturesOf(work) === 1) return 'feature';
  return 'entry';
}

/** At most this many records share a part, besides a note. */
const PER_PART = 3;

/** At most this many pictures of a gallery show in one part. */
const PER_GALLERY = 3;

/**
 * A works section's parts: each holds at most one record with a picture
 * and PER_PART records in all, a gallery PER_GALLERY pictures at a time,
 * and the signature work rides along as a note in whichever part it falls.
 */
function workParts(works: readonly Work[], lead: Work | undefined): ReelItem[][] {
  const parts: ReelItem[][] = [];
  let open: ReelItem[] | undefined;
  const counted = (part: readonly ReelItem[]) => part.filter((item) => item.role !== 'note');
  const pictured = (part: readonly ReelItem[]) =>
    part.some((item) => item.role !== 'entry' && item.role !== 'note');
  for (const work of works) {
    const role = roleOf(work, lead);
    if (role === 'note') {
      (open ??= (parts.push([]), parts.at(-1)!)).push({ id: work.id, role });
      continue;
    }
    if (role === 'gallery') {
      const total = picturesOf(work);
      for (let from = 0; from < total; from += PER_GALLERY) {
        open = [{ id: work.id, role, media: [from, Math.min(total, from + PER_GALLERY)] }];
        parts.push(open);
      }
      open = undefined;
      continue;
    }
    const big = role !== 'entry';
    if (
      open === undefined ||
      counted(open).length >= PER_PART ||
      (big && pictured(open)) ||
      open.some((item) => item.role === 'release')
    ) {
      open = [];
      parts.push(open);
    }
    open.push({ id: work.id, role });
    if (role === 'release') open = undefined;
  }
  return parts.filter((part) => part.length > 0);
}

/** About how many characters fill one column of a chronology part. */
const COLUMN_CHARS = 900;

/** At most this many columns in a chronology part. */
const PER_TIMELINE = 3;

/**
 * A chronology section's parts: its entries side by side, each as many
 * columns as its words need, at most PER_TIMELINE columns a part.
 */
function chronologyParts(entries: readonly ChronologyEntry[]): ReelItem[][] {
  const columnsOf = (entry: ChronologyEntry) => {
    const words = [
      entry.description ?? '',
      ...(entry.highlights ?? []),
      ...(entry.achievements ?? []),
    ].join(' ').length;
    return Math.min(PER_TIMELINE, Math.max(1, Math.ceil(words / COLUMN_CHARS)));
  };
  const total = entries.reduce((sum, entry) => sum + columnsOf(entry), 0);
  // As few parts as the columns need, the entries spread evenly over them, so no part is one entry left over.
  const count = Math.max(1, Math.ceil(total / PER_TIMELINE));
  const per = Math.ceil(entries.length / count);
  const parts: ReelItem[][] = [];
  let used = 0;
  for (const entry of entries) {
    const columns = columnsOf(entry);
    const open = parts.at(-1);
    // A part closes at its share of the entries, or before it would hold more columns than a frame fits.
    if (!open || open.length >= per || used + columns > PER_TIMELINE) {
      parts.push([]);
      used = 0;
    }
    parts.at(-1)!.push({ id: entry.id, role: 'entry', columns });
    used += columns;
  }
  return parts;
}

/**
 * A reel part's width: a full frame for a picture beside words, the cover
 * and tracks of a release in eight, and works of words alone as wide as
 * what they say.
 */
function partWidth(items: readonly ReelItem[], words: number): SceneWidth {
  const columns = items.reduce((sum, item) => sum + (item.columns ?? 0), 0);
  if (columns > 0) return columns >= 3 ? 12 : columns === 2 ? 8 : 6;
  const counted = items.filter((item) => item.role !== 'note');
  if (counted.some((item) => item.role === 'feature' || item.role === 'gallery')) return 12;
  if (counted.length === 1 && counted[0]!.role === 'release') return 8;
  if (counted.length >= 3) return words > 900 ? 12 : 8;
  if (counted.length === 2) return words > 600 ? 8 : 6;
  return 6;
}

/** The words a part of a works reel shows: its works' titles, summaries, and excerpts. */
function partWords(items: readonly ReelItem[], works: readonly Work[]): number {
  return items.reduce((sum, item) => {
    const work = works.find((one) => one.id === item.id);
    return work ? sum + wordsIn([work.title, work.summary, work.excerpt, work.description]) : sum;
  }, 0);
}

/** A reel's scenes, one a part. */
function reel(
  chapter: number,
  section: ReelSection,
  input: Pick<VariantRenderInput, 'portfolio'>,
  lead: Work | undefined,
): Scene[] {
  const works = section.kind === 'works' ? worksOf(section, input) : [];
  const parts =
    section.kind === 'works'
      ? workParts(works, lead)
      : chronologyParts(chronologyOf(section, input));
  return parts.map((items, part) => ({
    kind: 'reel',
    chapter,
    width: partWidth(items, partWords(items, works)),
    section,
    part,
    parts: parts.length,
    items,
  }));
}

/**
 * Packs a chapter's sections into scenes: works and chronology each a reel,
 * and neighbors in the same group sharing one, up to PER_SCENE and
 * SHARED_WEIGHT.
 */
function pack(
  chapter: number,
  sections: readonly ViewSection[],
  input: Pick<VariantRenderInput, 'portfolio'>,
  lead: Work | undefined,
): Scene[] {
  const scenes: Scene[] = [];
  // The sections the scene being packed shares, while it's open.
  let shared: ViewSection[] | undefined;
  const close = () => {
    if (shared)
      scenes.push({ kind: 'sections', chapter, width: widthOf(shared, input), sections: shared });
    shared = undefined;
  };
  for (const section of sections) {
    if (isReel(section)) {
      close();
      scenes.push(...reel(chapter, section, input, lead));
      continue;
    }
    const group = groupOf(section);
    const joins =
      shared !== undefined &&
      group !== undefined &&
      shared.length < PER_SCENE &&
      shared.every((one) => groupOf(one) === group) &&
      shared.reduce((sum, one) => sum + weightOf(one, input), 0) + weightOf(section, input) <=
        SHARED_WEIGHT;
    if (!joins) close();
    (shared ??= []).push(section);
  }
  close();
  return scenes;
}

/** The title a scene takes in its bars and the scrubber. */
function titleOf(scene: Scene, name: string): string {
  switch (scene.kind) {
    case 'title':
      return 'Opening';
    case 'lead':
      return scene.work.title;
    case 'intertitle':
      return CHAPTERS[scene.chapter]!.label;
    case 'timeline':
      return 'Timeline';
    case 'reel': {
      const title = scene.section.title?.trim() || name;
      return scene.part === 0 ? title : `${title}, continued`;
    }
    case 'sections':
      return scene.sections.map((section) => section.title?.trim()).find((title) => title) ?? name;
  }
}

/** At most this many works in the film, the signature among them (the home outline: 4 to 6). */
const FILM_WORKS = 6;

/**
 * The works sections the film shows: in authored order, the signature
 * counted first, each whole section while the works it adds keep the film
 * at FILM_WORKS or fewer. The first that would pass it, and every one after,
 * waits in the full record, so the film holds the signature and the works
 * authored first. A first section longer than that alone still shows whole,
 * since a section's records never split between the film and the record.
 */
function filmWorks(
  shown: readonly ViewSection[],
  input: Pick<VariantRenderInput, 'portfolio' | 'capabilities'>,
  lead: Work | undefined,
): ReadonlySet<ViewSection> {
  const film = new Set<ViewSection>();
  const counted = new Set<string>(lead ? [lead.id] : []);
  for (const section of shown) {
    if (section.kind !== 'works') continue;
    const added = worksOf(section, input)
      .map((work) => work.id)
      .filter((id) => !counted.has(id));
    if (film.size > 0 && counted.size + new Set(added).size > FILM_WORKS) break;
    film.add(section);
    for (const id of added) counted.add(id);
  }
  return film;
}

/**
 * A works section's records as the full record lists them, all in one
 * list: each read as it would in a reel, a series with all its pictures.
 */
export function recordItems(works: readonly Work[], lead: Work | undefined): ReelItem[] {
  return works.map((work) => {
    const role = roleOf(work, lead);
    return role === 'gallery'
      ? { id: work.id, role, media: [0, picturesOf(work)] as const }
      : { id: work.id, role };
  });
}

/** Each render input's scenes, worked out once: the page, every reel, and the case page read the same list. */
const placed = new WeakMap<object, HomeScenes>();

/** The home page's scenes, from the render input. */
export function homeScenes(
  input: Pick<VariantRenderInput, 'portfolio' | 'capabilities'>,
): HomeScenes {
  const known = placed.get(input);
  if (known) return known;
  const scenes = placeScenes(input);
  placed.set(input, scenes);
  return scenes;
}

function placeScenes(input: Pick<VariantRenderInput, 'portfolio' | 'capabilities'>): HomeScenes {
  const { portfolio } = input;
  const shown = portfolio.sections.filter((section) => sectionRenders(section, input));
  const first = shown[0];
  const hero = first?.kind === 'hero' ? (first as HeroSection) : undefined;
  const [lead] = worksByIds(portfolio.signature === undefined ? [] : [portfolio.signature], input);
  const byChapter: ViewSection[][] = CHAPTERS.map(() => []);
  const record: ViewSection[] = [];
  // The chronology the Origins timeline draws, though the record holds its sections.
  const drawn = shown.filter((section): section is ReelSection => section.kind === 'chronology');
  const film = filmWorks(shown, input, lead);
  for (const section of shown) {
    if (section === hero) continue;
    if (isRecord(section, input) || (section.kind === 'works' && !film.has(section)))
      record.push(section);
    else byChapter[chapterOf(section)]!.push(section);
  }
  // The first quote opens Origins as its epigraph.
  const epigraph = byChapter[0]!.find((section) => section.kind === 'quote');
  const scenes: Scene[] = [{ kind: 'title', chapter: 0, width: 8, hero }];
  if (lead) scenes.push({ kind: 'lead', chapter: 0, width: 12, work: lead });
  scenes.push(
    ...pack(
      0,
      byChapter[0]!.filter((section) => section !== epigraph),
      input,
      lead,
    ),
  );
  for (let chapter = 1; chapter < CHAPTERS.length; chapter++) {
    const opening: Extract<Scene, { kind: 'intertitle' }> = {
      kind: 'intertitle',
      chapter,
      width: 4,
      epigraph: chapter === 1 ? epigraph : undefined,
    };
    scenes.push(opening);
    // Origins opens on its timeline when it has one to draw: every dated entry on its thread.
    const dated = drawn
      .flatMap((section) => chronologyOf(section, input))
      .filter((entry) => entry.period);
    if (chapter === 1 && dated.length >= 2) {
      scenes.push({ kind: 'timeline', chapter, width: 12, sections: drawn });
    }
    scenes.push(...pack(chapter, byChapter[chapter]!, input, lead));
    // A card with an epigraph and a long contents list opens to six columns, and a longer one
    // to eight, its contents in two columns, so it fits the stage.
    const at = scenes.indexOf(opening);
    const named = scenes
      .slice(at + 1)
      .filter((one) => one.kind !== 'reel' || one.part === 0).length;
    const lines = named + (opening.epigraph ? 3 : 0);
    if (lines > 7) scenes[at] = { ...opening, width: 8 };
    else if (lines > 6) scenes[at] = { ...opening, width: 6 };
  }
  return {
    scenes: scenes.map((scene, index) => ({
      ...scene,
      number: index + 1,
      title: titleOf(scene, portfolio.identity.name),
      base: titleOf(scene.kind === 'reel' ? { ...scene, part: 0 } : scene, portfolio.identity.name),
      own: scene.kind === 'title' || scene.kind === 'intertitle' || scene.kind === 'timeline',
      continued: scene.kind === 'reel' && scene.part > 0,
    })),
    hero,
    lead,
    record,
  };
}

/** The scenes of one chapter, in order. */
export const chapterScenes = (scenes: readonly PlacedScene[], chapter: number) =>
  scenes.filter((scene) => scene.chapter === chapter);

/** Every section a scene frames, its epigraph among them. */
export function framedSections(scene: Scene): readonly ViewSection[] {
  if (scene.kind === 'sections') return scene.sections;
  // A reel frames its section once, around its first part.
  if (scene.kind === 'reel') return scene.part === 0 ? [scene.section] : [];
  if (scene.kind === 'intertitle' && scene.epigraph) return [scene.epigraph];
  return [];
}

/** The year a raw date names, as a number, or none. */
function yearOf(raw: string | undefined): number | undefined {
  const year = yearText(raw);
  return year === undefined ? undefined : Number(year);
}

/** A chapter's years, as the dates its records carry. */
export interface Span {
  readonly first: number;
  readonly last: number;
  readonly open: boolean;
}

/**
 * The span of years a chapter tells, read as one sequence through the
 * film: Origins from its first date until the year before Journey starts,
 * Journey from there, `2022–now` when something in it is ongoing, Craft
 * the years its records carry where they start no earlier than Journey's,
 * and the Epilogue's year. Prologue, the
 * opening rather than a stretch of time, carries none, and neither does a
 * chapter with no dates.
 */
export function yearsOf(
  scenes: readonly PlacedScene[],
  chapter: number,
  input: Pick<VariantRenderInput, 'portfolio'>,
): string | undefined {
  const span = chapterSpan(scenes, chapter, input);
  if (!span) return undefined;
  const { first, last, open } = span;
  if (open) return `${first}–now`;
  return first === last ? String(first) : `${first}–${last}`;
}

/**
 * The years a chapter tells, as numbers: what its card prints, and where
 * the Origins timeline's plot ends, so the figure never runs past the
 * years the chapter names (HOR-3).
 */
export function chapterSpan(
  scenes: readonly PlacedScene[],
  chapter: number,
  input: Pick<VariantRenderInput, 'portfolio'>,
): Span | undefined {
  if (chapter === 0) return undefined;
  const own = spanOf(scenes, chapter, input);
  if (!own) return undefined;
  const { first } = own;
  let { last, open } = own;
  if (chapter === 1) {
    // Origins ends where Journey begins, so the chapters read in order.
    const next = spanOf(scenes, 2, input);
    if (next && next.first > first && (open || last >= next.first)) {
      last = next.first - 1;
      open = false;
    }
  }
  if (chapter === 3) {
    // Craft reads after Journey: a span that starts before Journey's would read backwards, so it shows none.
    const before = spanOf(scenes, 2, input) ?? spanOf(scenes, 1, input);
    if (before && first < before.first) return undefined;
  }
  return { first, last, open };
}

/** The years a chapter's scenes cover, its timeline's included, or none. */
function spanOf(
  scenes: readonly PlacedScene[],
  chapter: number,
  input: Pick<VariantRenderInput, 'portfolio'>,
): Span | undefined {
  const years: number[] = [];
  let open = false;
  for (const scene of chapterScenes(scenes, chapter)) {
    const sections = scene.kind === 'timeline' ? scene.sections : framedSections(scene);
    for (const section of sections) {
      if (section.kind === 'now') {
        const year = yearOf(section.asOf);
        if (year !== undefined) years.push(year);
      }
      for (const entry of chronologyOf(section, input)) {
        const start = yearOf(entry.period?.start);
        if (start !== undefined) years.push(start);
        const end = yearOf(entry.period?.end);
        if (end !== undefined) years.push(end);
        else if (entry.period) open = true;
      }
      for (const work of worksOf(section, input)) {
        // Every date a work carries: its period, when it came out, and each picture's.
        const start = yearOf(work.period?.start);
        if (start !== undefined) years.push(start);
        const end = yearOf(work.period?.end);
        if (end !== undefined) years.push(end);
        else if (work.period) open = true;
        for (const raw of [
          work.publishedAt,
          work.releasedAt,
          ...(work.media ?? []).map((one) => one.takenAt),
        ]) {
          const year = yearOf(raw);
          if (year !== undefined) years.push(year);
        }
      }
      for (const entry of evidenceOf(section, input)) {
        const raw = entry as unknown as Record<string, unknown>;
        for (const field of ['receivedAt', 'publishedAt', 'presentedAt', 'grantedAt', 'date']) {
          const year = typeof raw[field] === 'string' ? yearOf(raw[field] as string) : undefined;
          if (year !== undefined) years.push(year);
        }
      }
    }
  }
  if (years.length === 0) return undefined;
  return { first: Math.min(...years), last: Math.max(...years), open };
}
