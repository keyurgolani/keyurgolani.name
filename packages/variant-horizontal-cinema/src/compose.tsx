import {
  renderSection,
  type HeadingLevel,
  type SectionComposition,
  type SectionFrameProps,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { EvidenceSection } from './evidence';
import { PracticeSection } from './practice';
import { ChronologyReel, WorksReel } from './reels';
import { isReel, isReservedAnchor } from './scenes';
import { TitleCard } from './title-card';
import {
  ContactSection,
  CtaSection,
  CustomSection,
  FocusSection,
  FunFactsSection,
  GithubSection,
  LedeSection,
  NowSection,
  QuoteSection,
} from './words';

// How Cinema renders its sections (redesign): every core kind its own way,
// each in its own frame. The hero is the title card, works and chronology
// are reels whose parts are scenes, evidence is the record the credits
// would set, the practice and the sections of words give their scene one
// dominant line. An extension's kind renders the way its extension does.

type ViewSection = VariantRenderInput['portfolio']['sections'][number];

/**
 * A section's frame: a `<section>` that spreads the frame's attributes, a
 * landmark of its own. A reel's frame holds its parts, which are scenes of
 * the strip, so the stylesheet lets them sit in the strip as if the frame
 * weren't there.
 */
function SectionFrame({ frame, section, children }: SectionFrameProps) {
  return (
    <section
      {...frame}
      className="hc-section"
      data-family={section.kind}
      data-reel={isReel(section as ViewSection) ? '' : undefined}
    >
      {children}
    </section>
  );
}

/**
 * The composition. A section whose id is one of the strip's own anchors
 * takes none, so the strip keeps the id; pageOutline() and checkOutline()
 * read the same rule.
 */
export const SECTIONS: SectionComposition = {
  renderers: {
    hero: TitleCard,
    works: WorksReel,
    chronology: ChronologyReel,
    evidence: EvidenceSection,
    practice: PracticeSection,
    lede: LedeSection,
    now: NowSection,
    quote: QuoteSection,
    focus: FocusSection,
    'fun-facts': FunFactsSection,
    contact: ContactSection,
    cta: CtaSection,
    github: GithubSection,
    custom: CustomSection,
  },
  Frame: SectionFrame,
  anchorOf: (section) => (isReservedAnchor(section.id) ? null : undefined),
};

/** A section in its frame, at `level`. */
export function renderAt(section: ViewSection, input: VariantRenderInput, level: HeadingLevel) {
  return renderSection(section, input, SECTIONS, { level });
}
