import type { Section, Work } from '@portfolio/schema';
import { isArchived, sectionShows, worksByIds, worksOf } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { CHAPTERS, RESERVED_ANCHORS } from './chapters';

// What each of Horizontal Cinema's five chapters holds (#17), from the
// published view alone, so nothing private is ever placed or counted:
//
//   Prologue  the opening: the leading hero, or the identity's name and
//             tagline, then the lede, quotes, and the practice's thesis,
//             and the signature work as its lead frame
//   Origins   the chronology and the fun facts
//   Journey   the featured works, each a frame of its media and its
//             evidence; with nothing curated, the works the works
//             sections show, the archive's left out, six at most
//   Craft     the evidence, the rest of the practice, GitHub, and custom
//             sections
//   Epilogue  now, focus, the calls to action, and contact
//
// Every section keeps its authored order inside its chapter. What no
// chapter holds, a works section's works that aren't frames and an
// extension's sections, reads in the index after the chapters, in the
// reading order, so nothing in the view goes unshown.

type ViewSection = VariantRenderInput['portfolio']['sections'][number];
type HeroSection = Extract<Section, { kind: 'hero' }>;

/** The most works Journey frames when the owner curated none. */
export const JOURNEY_DEFAULT_LIMIT = 6;

/** The chapter each core kind reads in, by position. Works become Journey's frames. */
const CHAPTER_OF_KIND: Readonly<Record<string, number>> = {
  hero: 0,
  lede: 0,
  quote: 0,
  chronology: 1,
  'fun-facts': 1,
  evidence: 3,
  github: 3,
  custom: 3,
  now: 4,
  focus: 4,
  cta: 4,
  contact: 4,
};

export interface ChapterContent {
  readonly position: number;
  /** The sections it shows through the shared renderers, in reading order. */
  readonly sections: readonly ViewSection[];
  /** The works it shows as frames, in order. */
  readonly frames: readonly Work[];
}

export interface HomeModel {
  /** The leading hero, which holds the page's one h1 in Prologue. */
  readonly hero: HeroSection | undefined;
  /** The five chapters, always five, in order. */
  readonly chapters: readonly ChapterContent[];
  /** What no chapter holds, read in the index after them. */
  readonly rest: readonly ViewSection[];
  /** Works sections the frames show whole: each id still lands, on Journey. */
  readonly folded: readonly string[];
}

/** Whether `text` has something to show. */
export function present(text: string | undefined | null): text is string {
  return typeof text === 'string' && text.trim() !== '';
}

/** A section the index can name: one with a title. The hero and a call to action stand apart. */
export function named(section: ViewSection): boolean {
  return section.kind !== 'hero' && section.kind !== 'cta' && present(section.title);
}

/**
 * The element id a content id takes on the page, or none when it's one of
 * the anchors the chapters and the index keep: a section with the id
 * `chapter-journey` reads in place, and `/#chapter-journey` still opens
 * Journey.
 */
export function contentAnchor(input: Pick<VariantRenderInput, 'ids'>, id: string) {
  return RESERVED_ANCHORS.has(id) ? undefined : `${input.ids.prefix}${id}`;
}

/** The chapter a section reads in, or none for the index. */
function chapterOf(section: ViewSection): number | undefined {
  if (section.kind === 'practice') return section.part === 'thesis' ? 0 : 3;
  return Object.hasOwn(CHAPTER_OF_KIND, section.kind) ? CHAPTER_OF_KIND[section.kind] : undefined;
}

/** The works the frames show, Prologue's and Journey's, each once. */
function frameWorks(input: Pick<VariantRenderInput, 'portfolio'>): {
  lead: Work | undefined;
  journey: readonly Work[];
} {
  const { portfolio } = input;
  const [lead] = worksByIds(portfolio.signature === undefined ? [] : [portfolio.signature], input);
  const featured = worksByIds(portfolio.featured, input);
  const curated = lead !== undefined || featured.length > 0;
  const works = curated
    ? featured
    : portfolio.sections.flatMap((section) =>
        worksOf(section, input).filter((work) => !isArchived(work, input)),
      );
  const seen = new Set<string>(lead ? [lead.id] : []);
  const journey = works.filter((work) => !seen.has(work.id) && Boolean(seen.add(work.id)));
  return { lead, journey: curated ? journey : journey.slice(0, JOURNEY_DEFAULT_LIMIT) };
}

/** The home page's content, chapter by chapter, from the render input. */
export function homeModel(input: Pick<VariantRenderInput, 'portfolio'>): HomeModel {
  const { portfolio } = input;
  const first = portfolio.sections[0];
  const hero = first?.kind === 'hero' ? (first as HeroSection) : undefined;
  const { lead, journey } = frameWorks(input);
  const framed = new Set([...(lead ? [lead.id] : []), ...journey.map((work) => work.id)]);
  const sections: ViewSection[][] = CHAPTERS.map(() => []);
  const rest: ViewSection[] = [];
  const folded: string[] = [];
  for (const section of portfolio.sections) {
    if (section === hero) continue;
    if (section.kind === 'works') {
      const items = section.items.filter((id) => !framed.has(id));
      if (items.length === section.items.length) {
        rest.push(section);
        continue;
      }
      const remainder = { ...section, items } as ViewSection;
      if (items.length > 0 && sectionShows(remainder, input)) rest.push(remainder);
      else folded.push(section.id);
      continue;
    }
    const position = chapterOf(section);
    if (position === undefined) rest.push(section);
    else sections[position]!.push(section);
  }
  return {
    hero,
    chapters: CHAPTERS.map((_, position) => ({
      position,
      sections: sections[position]!,
      frames: position === 0 ? (lead ? [lead] : []) : position === 2 ? journey : [],
    })),
    rest,
    folded,
  };
}

/** The medium in words, for a frame's label. None for an extension's medium, which names itself. */
export function mediumLabel(work: Pick<Work, 'medium'>): string | undefined {
  const labels: Record<string, string> = {
    interface: 'Interface',
    system: 'System',
    software: 'Software',
    photography: 'Photography',
    'image-series': 'Image series',
    writing: 'Writing',
    research: 'Research',
    music: 'Music',
    'audio-video': 'Audio and video',
    object: 'Object',
  };
  return Object.hasOwn(labels, work.medium) ? labels[work.medium] : undefined;
}
