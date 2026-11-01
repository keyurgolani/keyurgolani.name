import type { Evidence, Work } from '@portfolio/schema';
import {
  anchorSection,
  placedImage,
  type CaseStudyField,
  type CaseStudyOutline,
  type OutlineWork,
  type PlacedImage,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { chromeIds, homeModel, said, type HomeModel, type Span } from './model';

// A work's own page in Mission Control (P2, brief §5.8: "a board with a
// fact-sheet inspector and a decision log"), every derivation pure: the
// parts the case study has in the composition's own words, the spans they
// take on the wall, the records the work cites, and the way on (the next
// case in curation order, else All work beside the nearest related work).

/** What a medium is called on the inspector. */
export const MEDIUM_WORDS: Readonly<Record<string, string>> = {
  interface: 'Interface',
  system: 'System',
  software: 'Software',
  photography: 'Photography',
  'image-series': 'Photo series',
  writing: 'Writing',
  research: 'Research',
  music: 'Music',
  'audio-video': 'Audio and video',
  object: 'Object',
};

/**
 * Each part of a case study in Mission Control's own words, an operations
 * log's, never the schema's field names, so no two compositions print the
 * same fixed heads in one order.
 */
export const PART_WORDS: Readonly<Record<CaseStudyField, string>> = {
  challenge: 'Problem statement',
  context: 'Operating context',
  role: 'My part',
  constraints: 'Constraints',
  decisions: 'Decision log',
  evidence: 'Evidence',
  outcomes: 'Outcomes',
  reflection: 'Retrospective',
};

/** The work's description, which opens the account before its parts. */
export const BRIEF_WORD = 'Brief';

/** The spans the parts take on the wall: the log across it, the short accounts in pairs. */
const PART_SPANS: Readonly<Record<CaseStudyField | 'brief', Span>> = {
  brief: 10,
  challenge: 8,
  context: 8,
  role: 8,
  constraints: 8,
  decisions: 16,
  evidence: 10,
  outcomes: 10,
  reflection: 6,
};

/** One part of the account: the brief, or a case-study part. */
export interface CasePart {
  readonly key: CaseStudyField | 'brief';
  readonly anchor: string;
  readonly href: string;
  readonly label: string;
  /** Decisions and cited records count their items; every other part is 1. */
  readonly count: number;
  readonly span: Span;
}

/** Where the page goes on: the next case, else All work beside the nearest related work. */
export type Onward =
  | { readonly kind: 'next'; readonly next: OutlineWork; readonly work?: Work }
  | {
      readonly kind: 'all';
      readonly href: string;
      readonly related?: {
        readonly title: string;
        readonly lang?: string;
        readonly href: string;
        readonly of?: Work;
        /** What the two share: the medium's word, then the tags and tools. */
        readonly terms: readonly string[];
      };
    };

export interface CaseModel {
  readonly home: HomeModel;
  readonly parts: readonly CasePart[];
  /** The records the work cites, in its order. */
  readonly cited: readonly Evidence[];
  /** The cited awards, which the inspector names as recognition. */
  readonly awards: readonly Evidence[];
  /** The cover, only when its image is ready. */
  readonly cover?: PlacedImage;
  /** Which placement the cover is: the work's own cover (-1), else its media's index. */
  readonly coverAt?: number;
  /** The Work board on home, else the section that lists the work, else home. */
  readonly back: { readonly href: string; readonly label: string; readonly lang?: string };
  readonly onward: Onward;
}

/** Whether a work shows on home: a section that renders lists it. */
const onHome = (work: Work, input: VariantRenderInput) => anchorSection(work, input) !== undefined;

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
    .filter(
      ({ each, shared, sameMedium }) =>
        each.id !== work.id && onHome(each, input) && (shared.length > 0 || sameMedium),
    )
    .sort((a, b) => b.shared.length - a.shared.length || a.order - b.order)
    .map(({ each, shared, sameMedium }) => ({
      title: each.title,
      ...(each.lang ? { lang: each.lang } : {}),
      href: `${home}#${input.ids.prefix}${each.id}`,
      of: each,
      terms: termsOf(shared, sameMedium, work),
    }))[0];
}

/** What a related work shares, as the onward panel says it: the medium first, then tags and tools. */
export function termsOf(
  shared: readonly string[],
  sameMedium: boolean,
  work: Pick<Work, 'medium'>,
) {
  const medium = MEDIUM_WORDS[work.medium];
  return [...(sameMedium && medium ? [medium.toLowerCase()] : []), ...shared];
}

/** The page plan for a work's own page, from the render input and its outline. */
export function caseModel(input: VariantRenderInput, outline: CaseStudyOutline): CaseModel {
  const home = homeModel(input);
  const work = outline.work;
  const { portfolio, ids } = input;
  const cited = (work.evidence ?? []).flatMap((id) => {
    const record = portfolio.evidence.find((each) => each.id === id);
    return record ? [record] : [];
  });
  const brief = `${ids.prefix}${work.id}--brief`;
  const parts: CasePart[] = [
    ...(said(work.description) || said(work.summary)
      ? [
          {
            key: 'brief' as const,
            anchor: brief,
            href: `#${brief}`,
            label: BRIEF_WORD,
            count: 1,
            span: PART_SPANS.brief,
          },
        ]
      : []),
    ...outline.parts.map((part) => ({
      ...part,
      label: PART_WORDS[part.key],
      span: PART_SPANS[part.key],
    })),
  ];
  let cover: PlacedImage | undefined;
  // Where the cover came from: the work's cover (-1), else the index of the media it is.
  let coverAt: number | undefined;
  for (const [index, placement] of [work.cover, ...(work.media ?? [])].entries()) {
    const image = placedImage(placement, input);
    if (image && image.image.state === 'ready') {
      cover = image;
      coverAt = index - 1;
      break;
    }
  }
  const board = home.boards.find(({ id }) => id === 'work');
  const back = board
    ? {
        href: `${outline.home}#${chromeIds(ids.prefix).board('work')}`,
        label: board.label,
        ...(board.lang ? { lang: board.lang } : {}),
      }
    : { href: outline.home, label: home.navigation.name.label };
  const byId = (id: string) => portfolio.works.find((each) => each.id === id);
  const first = outline.related[0];
  const related = first
    ? {
        title: first.title,
        ...(first.lang ? { lang: first.lang } : {}),
        href: first.href,
        ...(byId(first.id) ? { of: byId(first.id)! } : {}),
        terms: termsOf(first.shared, first.sameMedium, work),
      }
    : relatedOnHome(work, input, outline.home);
  const nextWork = outline.next ? byId(outline.next.id) : undefined;
  const onward: Onward = outline.next
    ? { kind: 'next', next: outline.next, ...(nextWork ? { work: nextWork } : {}) }
    : { kind: 'all', href: back.href, ...(related ? { related } : {}) };
  return {
    home,
    parts,
    cited,
    awards: cited.filter((record) => record.type === 'award' && said(record.title)),
    ...(cover ? { cover, coverAt: coverAt! } : {}),
    back,
    onward,
  };
}
