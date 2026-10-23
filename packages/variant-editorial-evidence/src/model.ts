import type { Evidence, Section, Work } from '@portfolio/schema';
import { evidenceByIds, sectionShows, worksByIds } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';

// What Editorial Evidence's home page shows, and in what order (#13), from
// the published view alone. Nothing here picks content by popularity,
// recency, media, or metrics: the signature, the flagships, the proof strip,
// and the archive are the owner's curation lists, and everything else keeps
// the owner's reading order.
//
//   1. The opening: the leading hero, or the identity's name, then the
//      practice thesis, or the tagline when there's no thesis.
//   2. Work: the signature on the largest plate, then the featured works on
//      smaller ones, in the owner's order.
//   3. Proof: the proof strip's evidence.
//   4. The reading order, without what the opening, the plates, and the
//      proof strip already show, and without the archive's works.
//   5. The archive, behind a disclosure.

export type Portfolio = VariantRenderInput['portfolio'];
type ViewSection = Portfolio['sections'][number];
type HeroSection = Extract<Section, { kind: 'hero' }>;

export interface HomeModel {
  /** The hero section the page opens with, when the reading order starts with one. */
  readonly hero: HeroSection | undefined;
  /** The practice thesis, Markdown, when the owner wrote one. */
  readonly thesis: string | undefined;
  /** The identity's tagline, plain text, which opens the page when there's no thesis or hero. */
  readonly tagline: string | undefined;
  readonly signature: Work | undefined;
  /** The featured works, never the signature. */
  readonly flagships: readonly Work[];
  readonly proof: readonly Evidence[];
  /** What the reading order shows after the plates, each section with only what's left to show. */
  readonly sections: readonly ViewSection[];
  /** The archive's works, never one a plate shows. */
  readonly archive: readonly Work[];
  /**
   * Sections the page folds into its own regions, by where they went, so a
   * link to one, such as a hero's `#work`, still lands: the thesis section
   * on the opening's thesis, a works section the plates show whole on the
   * Selected work region, and an evidence section the proof strip shows
   * whole on the Proof region.
   */
  readonly folded: {
    readonly thesis: readonly string[];
    readonly work: readonly string[];
    readonly proof: readonly string[];
  };
}

/** Whether `text` has something to show. */
export function present(text: string | undefined | null): text is string {
  return typeof text === 'string' && text.trim() !== '';
}

/** The home page's content, from the render input. */
export function homeModel(input: Pick<VariantRenderInput, 'portfolio'>): HomeModel {
  const { portfolio } = input;
  const first = portfolio.sections[0];
  const hero = first?.kind === 'hero' ? (first as HeroSection) : undefined;
  const thesis = present(portfolio.practice?.thesis) ? portfolio.practice.thesis : undefined;
  const tagline = present(portfolio.identity.tagline) ? portfolio.identity.tagline : undefined;

  const signature = worksByIds(
    portfolio.signature === undefined ? [] : [portfolio.signature],
    input,
  )[0];
  const flagships = worksByIds(portfolio.featured, input).filter(
    (work) => work.id !== signature?.id,
  );
  const plated = new Set([signature?.id, ...flagships.map(({ id }) => id)]);
  const archive = worksByIds(portfolio.archive, input).filter((work) => !plated.has(work.id));
  const archived = new Set(archive.map(({ id }) => id));

  const proof = evidenceByIds(portfolio.proof, input);
  const proven = new Set(proof.map(({ id }) => id));
  const folded = { thesis: [] as string[], work: [] as string[], proof: [] as string[] };
  const sections = portfolio.sections.flatMap((section): ViewSection[] => {
    if (section === hero) return [];
    // The opening already shows the thesis.
    if (thesis && section.kind === 'practice' && section.part === 'thesis') {
      folded.thesis.push(section.id);
      return [];
    }
    if (section.kind === 'works') {
      const items = section.items.filter((id) => !plated.has(id) && !archived.has(id));
      if (items.length === section.items.length) return [section];
      const rest = { ...section, items } as ViewSection;
      if (items.length > 0 && sectionShows(rest, input)) return [rest];
      folded.work.push(section.id);
      return [];
    }
    if (section.kind === 'evidence' && proven.size > 0) {
      const items = section.items.filter((id) => !proven.has(id));
      if (items.length === section.items.length) return [section];
      const rest = { ...section, items } as ViewSection;
      if (items.length > 0 && sectionShows(rest, input)) return [rest];
      folded.proof.push(section.id);
      return [];
    }
    return [section];
  });

  return {
    hero,
    thesis,
    tagline,
    signature,
    flagships,
    proof,
    sections,
    archive,
    folded,
  };
}

/** The public work at `slug`, if there is one. */
export function workAt(slug: string, portfolio: Portfolio): Work | undefined {
  return portfolio.works.find((work) => work.slug === slug);
}

/** Whether the work has a page of its own: a slug, which a case study needs. */
export function hasPage(work: Work): work is Work & { readonly slug: string } {
  return work.slug !== undefined;
}
