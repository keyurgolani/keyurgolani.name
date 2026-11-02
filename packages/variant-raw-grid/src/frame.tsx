import type { ReactElement } from 'react';
import type { Section } from '@portfolio/schema';
import { Heading, type SectionFrameProps } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { countOf, said } from './model';
import { Fit, Words } from './parts';
import { shapeOf } from './shapes';

// The frames every section renders in (the kit's SectionComposition): each
// is the section's own <section>, spreading the attributes renderSection()
// gives it, so every section has a landmark of its own with its own id.
//
// - A band: a run of cells on the sheet's twelve columns, sharing their
//   rules. Its head is a strip across the band: the section's own title as
//   black tape, its subtitle, and its count. A section with no title has no
//   heading, as the kit's renderers have none, and its band opens on its
//   cells.
// - An opening cell: the hero's poster and the thesis, which the opening
//   places itself.

/** The id of a frame's heading, for the frame's accessible name. */
export const headId = (frame: SectionFrameProps['frame']) =>
  frame.id === undefined ? undefined : `${frame.id}--head`;

export const titleOf = (section: Section) =>
  'title' in section && said(section.title) ? section.title : undefined;
const subtitleOf = (section: Section) =>
  'subtitle' in section && said(section.subtitle) ? section.subtitle : undefined;

/** Named by its title when it has one, so a titled section is a named region. */
export function named(props: SectionFrameProps) {
  return titleOf(props.section) !== undefined ? { 'aria-labelledby': headId(props.frame) } : {};
}

/** The count a band head shows, with its unit, or nothing for a section that is one thing. */
function Count({
  section,
  input,
  uiLang,
}: {
  section: Section;
  input: VariantRenderInput;
  uiLang: 'en' | undefined;
}) {
  const count = countOf(section, input);
  if (!count || count.n === 0) return null;
  const unit =
    count.unit === 'photographs'
      ? count.n === 1
        ? 'photograph'
        : 'photographs'
      : count.n === 1
        ? 'entry'
        : 'entries';
  return (
    <p className="rg-band__count">
      <span className="rg-num">{count.n}</span> <Words lang={uiLang}>{unit}</Words>
    </p>
  );
}

/** A band's head: the tape title, the subtitle, the count. Nothing for a section with neither. */
export function BandHead({
  props,
  input,
  uiLang,
}: {
  props: SectionFrameProps;
  input: VariantRenderInput;
  uiLang: 'en' | undefined;
}): ReactElement | null {
  const title = titleOf(props.section);
  const subtitle = subtitleOf(props.section);
  if (title === undefined && subtitle === undefined) return null;
  return (
    <div className="rg-cell rg-band__head">
      {title !== undefined ? (
        <Heading level={props.level} className="rg-tab">
          <span id={headId(props.frame)}>
            <Fit text={title} />
          </span>
        </Heading>
      ) : null}
      {subtitle !== undefined ? <p className="rg-band__sub">{subtitle}</p> : null}
      <Count section={props.section} input={input} uiLang={uiLang} />
    </div>
  );
}

/** The band frame for one input: each section a band of cells, its shape a class. */
export function bandFrame(input: VariantRenderInput, uiLang: 'en' | undefined) {
  return function BandFrame(props: SectionFrameProps) {
    return (
      <section
        {...props.frame}
        {...named(props)}
        className={`rg-band rg-band--${shapeOf(props.section, input)}`}
      >
        <BandHead props={props} input={input} uiLang={uiLang} />
        {props.children}
      </section>
    );
  };
}

/** The opening's frame: a cell the opening places, named by its title, which the cell sets itself. */
export function cellFrame(className: string) {
  return function CellFrame(props: SectionFrameProps) {
    return (
      <section {...props.frame} {...named(props)} className={`rg-cell ${className}`}>
        {props.children}
      </section>
    );
  };
}
