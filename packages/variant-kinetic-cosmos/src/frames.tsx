import type { ReactNode } from 'react';
import {
  Heading,
  present,
  type SectionFrame,
  type SectionFrameProps,
} from '@portfolio/kit/sections';
import { FoldOnPhone } from './fold';

// Kinetic Cosmos's section frames (redesign, stream E). Inside a ring, a
// section opens on its orbit rule: a body on the line, the title, a
// hairline to the far edge, and what it holds, counted. The owner's
// subtitle follows it. On the stages, the opening's and the closing's, a
// section's frame is a plain part of the stage, which lays out what its
// renderer gives it. Every frame spreads renderSection()'s attributes on a
// <section>, so links, the outline check, and the host's tests find it.

/** What a section's frame shows beside its title, by content id, and how wide it sits in its ring. */
export interface RingFrameData {
  readonly notes: ReadonlyMap<string, ReactNode>;
  readonly spans: ReadonlyMap<string, 'half' | 'full'>;
  /** The sections that fold into a disclosure on a phone, by content id. */
  readonly folds?: ReadonlySet<string>;
  /** The sections that sit in a closed disclosure at every width, by content id (the home outline). */
  readonly closed?: ReadonlySet<string>;
}

const titleOf = (section: SectionFrameProps['section']) =>
  'title' in section && present(section.title) ? section.title : undefined;
const subtitleOf = (section: SectionFrameProps['section']) =>
  'subtitle' in section && typeof section.subtitle === 'string' && present(section.subtitle)
    ? section.subtitle
    : undefined;

/** The frame of a section in a ring, with its orbit rule. */
export function ringFrame({ notes, spans, folds, closed }: RingFrameData): SectionFrame {
  function RingSectionFrame({ frame, section, level, children }: SectionFrameProps) {
    const title = titleOf(section);
    const subtitle = subtitleOf(section);
    const note = notes.get(section.id);
    if (title !== undefined && (folds?.has(section.id) || closed?.has(section.id))) {
      // The orbit rule is the disclosure's summary: its parts are phrasing content.
      return (
        <section {...frame} className="kc-section" data-span={spans.get(section.id) ?? 'full'}>
          <FoldOnPhone
            closed={closed?.has(section.id) ?? false}
            summary={
              <>
                <span className="kc-rule__body" aria-hidden="true" />
                <Heading level={level} className="kc-rule__title">
                  {title}
                </Heading>
                <span className="kc-rule__line" aria-hidden="true" />
                {note !== undefined && note !== null ? (
                  <span className="kc-rule__note" data-type-role="label">
                    {note}
                  </span>
                ) : null}
              </>
            }
          >
            {subtitle !== undefined ? <p className="kc-section__subtitle">{subtitle}</p> : null}
            {children}
          </FoldOnPhone>
        </section>
      );
    }
    return (
      <section {...frame} className="kc-section" data-span={spans.get(section.id) ?? 'full'}>
        {title !== undefined ? (
          <header className="kc-rule">
            <span className="kc-rule__body" aria-hidden="true" />
            <Heading level={level} className="kc-rule__title">
              {title}
            </Heading>
            <span className="kc-rule__line" aria-hidden="true" />
            {note !== undefined && note !== null ? (
              <p className="kc-rule__note" data-type-role="label">
                {note}
              </p>
            ) : null}
          </header>
        ) : null}
        {subtitle !== undefined ? <p className="kc-section__subtitle">{subtitle}</p> : null}
        {children}
      </section>
    );
  }
  return RingSectionFrame;
}

/** A section on the opening stage: the stage lays out its parts. */
export function OpeningFrame({ frame, section, children }: SectionFrameProps) {
  return (
    <section {...frame} className="kc-opening__part" data-part={section.kind}>
      {children}
    </section>
  );
}

/** A section on the closing stage. */
export function ClosingFrame({ frame, section, children }: SectionFrameProps) {
  return (
    <section {...frame} className="kc-closing__part" data-part={section.kind}>
      {children}
    </section>
  );
}
