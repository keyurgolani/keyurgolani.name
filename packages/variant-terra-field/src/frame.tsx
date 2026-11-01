import type { ReactElement } from 'react';
import type { Section } from '@portfolio/schema';
import { Heading, type SectionFrameProps } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { countOf, said } from './model';
import { Words } from './parts';

// The frame every section renders in inside a field: the section's own
// <section>, spreading what renderSection() gives it, on the page's twelve
// columns. Its head is the title, then a horizon line to the edge with the
// count at its end, then the subtitle in the caption voice. A section with
// no title opens on its content, as the kit's renderers do.

/** The id of a frame's heading, for the frame's accessible name. */
export const headId = (frame: SectionFrameProps['frame']) =>
  frame.id === undefined ? undefined : `${frame.id}--head`;

export const titleOf = (section: Section) =>
  'title' in section && said(section.title) ? section.title : undefined;
const subtitleOf = (section: Section) =>
  'subtitle' in section && said(section.subtitle) ? section.subtitle : undefined;

/** Named by its title when it has one, so a titled section is a named region. */
export function named(props: SectionFrameProps) {
  return titleOf(props.section) !== undefined && headId(props.frame) !== undefined
    ? { 'aria-labelledby': headId(props.frame) }
    : {};
}

/** A section's head: title, horizon line, count, subtitle. */
export function SectionHead({
  props,
  input,
  uiLang,
  echoed = false,
}: {
  props: SectionFrameProps;
  input: VariantRenderInput;
  uiLang: 'en' | undefined;
  /** The title only repeats the field's word: the heading stays, out of sight. */
  echoed?: boolean;
}): ReactElement | null {
  const title = titleOf(props.section);
  const subtitle = subtitleOf(props.section);
  if (title === undefined && subtitle === undefined) return null;
  if (echoed && title !== undefined && subtitle === undefined)
    return (
      <Heading level={props.level} className="tf-sr">
        <span id={headId(props.frame)}>{title}</span>
      </Heading>
    );
  const count = countOf(props.section, input);
  return (
    <header className="tf-sechead">
      <div className="tf-sechead__line">
        {title !== undefined ? (
          <Heading level={props.level} className="tf-title tf-sechead__title">
            <span id={headId(props.frame)}>{title}</span>
          </Heading>
        ) : null}
        {count && count.n > 1 ? (
          <p className="tf-sechead__count tf-compact">
            <span className="tf-num">{count.n}</span> <Words lang={uiLang}>{count.many}</Words>
          </p>
        ) : null}
      </div>
      {subtitle !== undefined ? <p className="tf-sechead__sub tf-caption">{subtitle}</p> : null}
    </header>
  );
}

/**
 * A section of the full record, behind a closed native disclosure (Design
 * gate rule 8): its title and count are the summary, its subtitle and body
 * the content. It opens with no script, from a fragment link (the field
 * enhancement, and :target with no script), and prints open. Its frame, id
 * and index entry stay as they are; no destination moves.
 */
function Fold({
  props,
  input,
  uiLang,
}: {
  props: SectionFrameProps;
  input: VariantRenderInput;
  uiLang: 'en' | undefined;
}) {
  const title = titleOf(props.section);
  const subtitle = subtitleOf(props.section);
  const count = countOf(props.section, input);
  return (
    <details className="tf-fold" data-record="">
      <summary className="tf-fold__summary">
        <Heading level={props.level} className="tf-title tf-sechead__title">
          <span id={headId(props.frame)}>{title}</span>
        </Heading>
        {count && count.n > 0 ? (
          // Closed, the count is all the summary says of what's inside, so one shows too.
          <span className="tf-sechead__count tf-compact">
            <span className="tf-num">{count.n}</span>{' '}
            <Words lang={uiLang}>{count.n === 1 ? count.one : count.many}</Words>
          </span>
        ) : null}
      </summary>
      <div className="tf-fold__body">
        {subtitle !== undefined ? <p className="tf-sechead__sub tf-caption">{subtitle}</p> : null}
        {props.children}
      </div>
    </details>
  );
}

/** The frame for one input: each section on the page grid, its form a data attribute, the full record folded. */
export function sectionFrame(
  input: VariantRenderInput,
  uiLang: 'en' | undefined,
  formOf: (section: Section) => string,
  folds: (section: Section) => boolean,
  echoed: (section: Section) => boolean = () => false,
) {
  return function SectionFrame(props: SectionFrameProps) {
    const fold = folds(props.section) && titleOf(props.section) !== undefined;
    return (
      <section
        {...props.frame}
        {...named(props)}
        className="tf-page tf-section"
        data-form={formOf(props.section)}
        data-fold={fold ? '' : undefined}
      >
        {fold ? (
          <Fold props={props} input={input} uiLang={uiLang} />
        ) : (
          <>
            <SectionHead
              props={props}
              input={input}
              uiLang={uiLang}
              echoed={echoed(props.section)}
            />
            {props.children}
          </>
        )}
      </section>
    );
  };
}
