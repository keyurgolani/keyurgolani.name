import type { Section, Work } from '@portfolio/schema';
import { isArchived, sectionShows, worksByIds, worksOf } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';

// What Obsidian Atelier's home page shows, and in what order (#15), from
// the published view alone, so nothing private is ever counted:
//
//   1. The opening: the leading hero, or the identity's name and tagline.
//   2. The chapter index.
//   3. The chapters: one a work, the signature and then the featured works
//      in the owner's order. With neither curated, the works the reading
//      order's works sections show, in that order, the archive's left out.
//   4. The rest of the reading order, without the works the chapters show.
//
// The view holds visible content alone: a private work, or one only a
// hidden section reaches, is in none of its lists, so it's no chapter, no
// number, and no previous or next.

type ViewSection = VariantRenderInput['portfolio']['sections'][number];
type HeroSection = Extract<Section, { kind: 'hero' }>;

/** How a room shows its artifact, from the work's authored medium alone. */
export type Treatment = 'plate' | 'screen' | 'diagram' | 'text' | 'object';

export interface Chapter {
  readonly work: Work;
  /** Its place among the chapters, from 1. */
  readonly number: number;
  /** The element id of its room, the work's own id, so `/#<work id>` lands on it. */
  readonly anchor: string;
}

export interface HomeModel {
  readonly hero: HeroSection | undefined;
  readonly chapters: readonly Chapter[];
  /** What the reading order shows after the chapters, each works section without the chapters' works. */
  readonly sections: readonly ViewSection[];
  /** Works sections the chapters show whole: their ids land on the first chapter. */
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

/** The works the chapters show, in order, each once. */
function chapterWorks(input: Pick<VariantRenderInput, 'portfolio'>): readonly Work[] {
  const { portfolio } = input;
  const curated = worksByIds(
    [...(portfolio.signature === undefined ? [] : [portfolio.signature]), ...portfolio.featured],
    input,
  );
  const works =
    curated.length > 0
      ? curated
      : portfolio.sections.flatMap((section) =>
          worksOf(section, input).filter((work) => !isArchived(work, input)),
        );
  const seen = new Set<string>();
  return works.filter((work) => !seen.has(work.id) && Boolean(seen.add(work.id)));
}

/** The home page's content, from the render input. */
export function homeModel(input: Pick<VariantRenderInput, 'portfolio' | 'ids'>): HomeModel {
  const { portfolio } = input;
  const first = portfolio.sections[0];
  const hero = first?.kind === 'hero' ? (first as HeroSection) : undefined;
  const chapters = chapterWorks(input).map((work, index) => ({
    work,
    number: index + 1,
    anchor: `${input.ids.prefix}${work.id}`,
  }));
  const shown = new Set(chapters.map(({ work }) => work.id));
  const folded: string[] = [];
  const sections = portfolio.sections.flatMap((section): ViewSection[] => {
    if (section === hero) return [];
    if (section.kind !== 'works') return [section];
    const items = section.items.filter((id) => !shown.has(id));
    if (items.length === section.items.length) return [section];
    const rest = { ...section, items } as ViewSection;
    if (items.length > 0 && sectionShows(rest, input)) return [rest];
    folded.push(section.id);
    return [];
  });
  return { hero, chapters, sections, folded };
}

/** How a room shows a work's artifact, by its medium. */
export function treatmentOf(work: Pick<Work, 'medium'>): Treatment {
  switch (work.medium) {
    case 'photography':
    case 'image-series':
      return 'plate';
    case 'interface':
      return 'screen';
    case 'system':
    case 'software':
    case 'research':
      return 'diagram';
    case 'writing':
      return 'text';
    default:
      return 'object';
  }
}

/** The medium in words, for the room's label. None for an extension's medium, which names itself. */
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
