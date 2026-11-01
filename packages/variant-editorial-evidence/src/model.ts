import type { Section, Work } from '@portfolio/schema';
import { renderInlineMarkdown } from '@portfolio/kit/markdown';
import {
  isRoutedWork,
  pageOutline,
  sectionRenders,
  worksByIds,
  worksOf,
  type PageOutline,
  type RoutedWork,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { figureNumbers } from './figures';
import { chaptersOf, type Chapter } from './navigation';
import type { Portfolio, ViewSection } from './view';

// What Editorial Evidence's home page shows, and where (#13, redesign
// stream C), from the render input alone. It's a long-form issue:
//
//   1. The opening: the thesis at display size, the issue's contents, the
//      signature work on Pl. 1 with the standfirst beside it, and the
//      byline from the hero.
//   2. Five chapters at most (navigation.ts), each opening on its number
//      and name, its sections in the owner's order inside it.
//   3. Inside a chapter, bands: a section with a hanging head beside it.
//      A short section (now, focus, a quote, a call to action) that
//      follows a prose band in its chapter sits in that band's margin, as
//      its own framed section, so the margin has a job.
//   4. Record carries one summary (the length ruling, option B, and the
//      design gate's item 8): its figure table, else its first section,
//      stays open, and the rest of the record sits behind one closed
//      disclosure, in the archive's form. Each keeps its own frame.
//   5. A featured work the Writing chapter lists reads there, as a row,
//      not also on a plate in Work (C minor: The Quiet Cost).
//
// Nothing here picks content by popularity, recency, media, or metrics:
// the signature, the featured works, and the archive are the owner's
// curation lists. Every section the page renders keeps a frame of its own
// with its own id, so every link to one lands on it.

export type { Portfolio, ViewSection };
type Of<K extends string> = Extract<Section, { kind: K }>;

/** Whether `text` has something to show. */
export function present(text: string | undefined | null): text is string {
  return typeof text === 'string' && text.trim() !== '';
}

/** The thesis as the opening sets it: a display line, and the rest as the standfirst. */
export interface Thesis {
  /** Markdown: the thesis's first sentence, or all of it when it won't split. */
  readonly headline: string;
  readonly standfirst?: string;
  /** Whether the headline is the whole thesis, set a step down so a long one fits. */
  readonly whole: boolean;
}

/** The longest first sentence the display step holds (the brief's R4). */
export const DISPLAY_SENTENCE = 60;

/** The references the Markdown renderer writes for text, read back. */
const REFERENCES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/** What Markdown reads as: its rendered text, tags gone, references read, spaces collapsed. */
function readText(markdown: string): string {
  return renderInlineMarkdown(markdown)
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39);/g, (reference) => REFERENCES[reference]!)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A full stop that ends an abbreviation, not a sentence: dotted forms (U.S.,
 * e.g., i.e.), and the titles and short forms a thesis might use before a
 * name or a number, in the case they're written in, so "said no." and
 * "plan B." still end sentences.
 */
const ABBREVIATION =
  /(?:^|[\s([“"'‘])(?:(?:\p{L}\.){2,}|(?:Dr|Mr|Mrs|Ms|Mx|Prof|Sr|Jr|St|Mt|Inc|Ltd|Co|Corp|No|Nos|Vol|Fig|Figs|Ch|vs|cf|al|approx|ca|pp)\.)$/u;

/** A name's initial: a capital and a stop after a capitalized word, or opening the text (Ask J. Lee). */
const INITIAL = /(?:^|\p{Lu}[\p{L}'’-]*\s)\p{Lu}\.$/u;

/**
 * The owner's thesis, split after its first sentence when it has two or
 * more and the first is at most DISPLAY_SENTENCE characters: that sentence
 * is the display line, the rest the standfirst. Otherwise the whole thesis
 * is the headline, at the headline step.
 *
 * It splits on what the Markdown reads as, not on its source: a candidate
 * stop counts only when the two halves, each rendered on its own, read as
 * the whole does, so a stop inside a link's text, an emphasis, or code
 * never cuts it, and only when the sentence it ends isn't an abbreviation's
 * (Dr. Lee, e.g., U.S.).
 */
export function splitThesis(source: string): Thesis {
  const text = source.trim().replace(/\s+/g, ' ');
  const whole = readText(text);
  for (const stop of text.matchAll(/[.!?]+[)\]"'”’*_]*(?= )/g)) {
    const end = stop.index + stop[0].length;
    const headline = text.slice(0, end);
    const standfirst = text.slice(end + 1);
    const first = readText(headline);
    if (first.length > DISPLAY_SENTENCE) break;
    if (standfirst === '' || ABBREVIATION.test(first) || INITIAL.test(first)) continue;
    if (`${first} ${readText(standfirst)}` !== whole) continue;
    return { headline, standfirst, whole: false };
  }
  return { headline: text, whole: true };
}

/** A band of a chapter: a section, and the short sections set in its margin. */
export interface Band {
  readonly section: ViewSection;
  readonly margin: readonly ViewSection[];
  /** Whether it reads behind the chapter's fold, "The rest of the record". */
  readonly folded?: boolean;
}

export interface ChapterModel extends Chapter {
  readonly bands: readonly Band[];
}

export interface HomeModel {
  readonly outline: PageOutline;
  /** The hero the byline comes from: the first in the reading order. */
  readonly hero: Of<'hero'> | undefined;
  /** The practice section that places the thesis, which the opening frames. */
  readonly thesisSection: Of<'practice'> | undefined;
  readonly thesis: Thesis | undefined;
  /** The work on Pl. 1, beside the standfirst: the signature, else the first featured work. */
  readonly lead: Work | undefined;
  /** Plate numbers, by work id: the lead's 1, then each featured work's in the owner's order. */
  readonly plates: ReadonlyMap<string, number>;
  /** The featured works after the lead, in the owner's order. */
  readonly featured: readonly Work[];
  /** The archive's works, never one on a plate. */
  readonly archive: readonly Work[];
  /** The works section that sets the curated run: the lead's feature, the plates, and the archive. */
  readonly selection: string | undefined;
  readonly chapters: readonly ChapterModel[];
  /** Figure numbers, by figureKey(), in the order the page sets them. */
  readonly figures: ReadonlyMap<string, number>;
}

/** Kinds that sit in the margin of the prose band before them. */
const MARGINAL = new Set(['now', 'focus', 'quote', 'cta']);
/** Kinds whose band reads in the text column alone, leaving its margin free. */
const PROSE = new Set(['lede', 'fun-facts', 'contact', 'custom']);
/** The most short sections one margin holds. */
const MARGIN_LIMIT = 3;

/** A custom section with items sets them in its margin, so only one without does. */
const proseHost = (section: ViewSection) =>
  PROSE.has(section.kind) && !(section.kind === 'custom' && (section.items?.length ?? 0) > 0);

/** The chapter's bands, from its sections in reading order. */
function bandsOf(sections: readonly ViewSection[]): Band[] {
  const bands: { section: ViewSection; margin: ViewSection[] }[] = [];
  for (const section of sections) {
    const last = bands.at(-1);
    // A call to action goes beside contact alone; the rest beside any prose.
    const fits =
      last !== undefined &&
      proseHost(last.section) &&
      last.margin.length < MARGIN_LIMIT &&
      (section.kind !== 'cta' || last.section.kind === 'contact');
    if (MARGINAL.has(section.kind) && fits) last.margin.push(section);
    else bands.push({ section, margin: [] });
  }
  return bands;
}

/** The fewest bands worth a fold: one alone stays open. */
const FOLD_LEAST = 2;

/**
 * Record's bands with all but its one summary folded: the summary is its
 * first band, as the owner ordered it (in the sample, At a glance), so the
 * chapter opens on one piece of proof, the rest of the record is one action
 * away, and the page, the Contents sheet, and the rail number alike.
 */
function foldRecord(bands: Band[]): Band[] {
  const marked = bands.map((band, index) => ({ ...band, folded: index > 0 }));
  return marked.filter((band) => band.folded).length >= FOLD_LEAST
    ? marked
    : marked.map((band) => ({ ...band, folded: false }));
}

/** The home page's content, from the render input. */
export function homeModel(input: VariantRenderInput): HomeModel {
  const { portfolio } = input;
  const rendered = portfolio.sections.filter((section) => sectionRenders(section, input));
  const hero = rendered.find((section): section is Of<'hero'> => section.kind === 'hero');
  const thesisText = present(portfolio.practice?.thesis) ? portfolio.practice.thesis : undefined;
  const thesisSection = thesisText
    ? rendered.find(
        (section): section is Of<'practice'> =>
          section.kind === 'practice' && section.part === 'thesis',
      )
    : undefined;

  const outline = pageOutline(input);
  const nav = chaptersOf(input, outline);
  // The works the Writing chapter lists read there, never also on a plate in Work.
  const writing = new Set(
    (nav.find(({ id }) => id === 'writing')?.sections ?? []).flatMap(({ id }) => {
      const section = rendered.find((each) => each.id === id);
      return section?.kind === 'works' ? worksOf(section, input).map((work) => work.id) : [];
    }),
  );
  const signature = worksByIds(portfolio.signature ? [portfolio.signature] : [], input)[0];
  const featuredAll = worksByIds(portfolio.featured, input).filter(
    (work) =>
      work.id !== signature?.id && (work.id === portfolio.featured[0] || !writing.has(work.id)),
  );
  const lead = signature ?? featuredAll[0];
  const featured = featuredAll.filter((work) => work.id !== lead?.id);
  const plates = new Map<string, number>();
  [lead, ...featured].forEach((work, index) => {
    if (work) plates.set(work.id, index + 1);
  });
  const archive = worksByIds(portfolio.archive, input).filter((work) => !plates.has(work.id));

  // The curated run goes where the owner listed curated work first, else in
  // the first works section.
  const curated = new Set([...plates.keys(), ...archive.map(({ id }) => id)]);
  const works = rendered.filter((section) => section.kind === 'works');
  const selection = (
    works.find((section) => worksOf(section, input).some(({ id }) => curated.has(id))) ??
    (curated.size > 0 ? works[0] : undefined)
  )?.id;

  const byId = new Map(rendered.map((section) => [section.id, section]));
  const chapters = nav.map((chapter) => {
    const bands = bandsOf(
      chapter.sections.flatMap(({ id }) => {
        const section = byId.get(id);
        return section && section !== thesisSection ? [section] : [];
      }),
    );
    return { ...chapter, bands: chapter.id === 'record' ? foldRecord(bands) : bands };
  });

  // Numbered once the chapters the opening empties are gone, so the issue reads 1, 2, 3.
  const shown = chapters
    .filter((chapter) => chapter.bands.length > 0)
    .map((chapter, index) => ({ ...chapter, number: index + 1 }));
  return {
    outline,
    hero,
    thesisSection,
    thesis: thesisText ? splitThesis(thesisText) : undefined,
    lead,
    plates,
    featured,
    archive,
    selection,
    chapters: shown,
    figures: figureNumbers(
      shown.flatMap((chapter) => chapter.bands.map(({ section }) => section)),
      input,
      selection,
      new Set(plates.keys()),
    ),
  };
}

// Whether a work has its own page at /work/<slug>: a case study and a slug,
// the rule #10b's route serves by, from the kit.
export { isRoutedWork, type RoutedWork };

/** The routed work at `slug`, if the view has one. */
export function routedWorkAt(slug: string, portfolio: Portfolio): RoutedWork | undefined {
  return portfolio.works.find(
    (work): work is RoutedWork => isRoutedWork(work) && work.slug === slug,
  );
}

/** The DOM id of a work's plate on the home page. */
export const plateId = (input: Pick<VariantRenderInput, 'ids'>, work: Pick<Work, 'id'>) =>
  `${input.ids.prefix}ee--plate-${work.id}`;

/** The DOM id of the archive's disclosure on the home page. */
export const archiveId = (input: Pick<VariantRenderInput, 'ids'>) =>
  `${input.ids.prefix}ee--archive`;

/**
 * The chapter a work belongs to, for a case study's running head: the
 * chapter of the works section that lists it, else the one that holds the
 * curated selection, else the first.
 */
export function chapterOfWork(work: Work, model: HomeModel): ChapterModel | undefined {
  const lists = (chapter: ChapterModel, test: (section: ViewSection) => boolean) =>
    chapter.bands.some(({ section }) => test(section));
  return (
    model.chapters.find((chapter) =>
      lists(chapter, (section) => section.kind === 'works' && section.items.includes(work.id)),
    ) ??
    model.chapters.find((chapter) => lists(chapter, (section) => section.id === model.selection)) ??
    model.chapters[0]
  );
}

/** Where a work shows on the home page, for a way back to it. */
export type Placement =
  | { readonly kind: 'plate'; readonly number: number }
  | { readonly kind: 'archive' }
  | { readonly kind: 'section'; readonly section: ViewSection }
  | { readonly kind: 'none' };

/** Where the home page shows `work`: on a plate, in the archive, in a section, or nowhere. */
export function placementOf(work: Work, model: HomeModel): Placement {
  const number = model.plates.get(work.id);
  if (number !== undefined) return { kind: 'plate', number };
  if (model.archive.some(({ id }) => id === work.id)) return { kind: 'archive' };
  for (const chapter of model.chapters) {
    for (const { section } of chapter.bands) {
      if (section.kind === 'works' && section.items.includes(work.id)) {
        return { kind: 'section', section };
      }
    }
  }
  return { kind: 'none' };
}
