import { cloneElement, type ReactElement, type ReactNode } from 'react';
import { renderSection, type HeadingLevel } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { anchorOf, CHAPTERS, INDEX_ANCHOR, LAST, numberOf, RESERVED_ANCHORS } from './chapters';
import { Frame } from './frame';
import { contentAnchor, type ChapterContent } from './model';
import { ownId, uiLang, Words } from './parts';

// A chapter (#17): its number and label, what the model placed in it, and
// plain previous and next links, so it reads and moves with no script. It's
// a section labelled by its title, which the controller moves focus to when
// a step moves focus out of the chapter it was in. Prologue's title is its
// "01 Prologue" line, before the page's h1; the others are an h2 with the
// number and the label. Epilogue's next is the index.

type ViewSection = VariantRenderInput['portfolio']['sections'][number];

/**
 * The input the shared renderers read, with any record whose id is one of
 * the chapters' anchors left out of every section's list, so the record
 * still renders but takes no anchor of its own: recordAnchor() finds no
 * section to put it on. The input itself when no record collides.
 */
export function anchoringInput(input: VariantRenderInput): VariantRenderInput {
  const { portfolio } = input;
  const records = [...portfolio.works, ...portfolio.evidence, ...portfolio.chronology];
  if (!records.some((record) => RESERVED_ANCHORS.has(record.id))) return input;
  const sections = portfolio.sections.map((section): ViewSection => {
    if (section.kind !== 'works' && section.kind !== 'evidence' && section.kind !== 'chronology') {
      return section;
    }
    const items = (section.items ?? []).filter((id) => !RESERVED_ANCHORS.has(id));
    return { ...section, items } as ViewSection;
  });
  return { ...input, portfolio: { ...portfolio, sections } };
}

/**
 * A section through the shared renderers, at `level`. One whose id is a
 * chapter's anchor renders in place without the id, so the chapter keeps it.
 */
export function renderAt(
  section: ViewSection,
  input: VariantRenderInput,
  level: HeadingLevel,
): ReactElement | null {
  const element = renderSection(section, input, {}, { level });
  if (!element) return null;
  return RESERVED_ANCHORS.has(section.id)
    ? cloneElement(element as ReactElement<{ id?: string }>, { id: undefined })
    : element;
}

/** A link to a neighbor: its role, then its number and label. */
function Neighbor({
  rel,
  position,
  prefix,
  lang,
}: {
  rel: 'Previous' | 'Next';
  position: number | 'index';
  prefix: string;
  lang: 'en' | undefined;
}) {
  const href = `#${prefix}${position === 'index' ? INDEX_ANCHOR : anchorOf(position)}`;
  return (
    <li className={`hc-pager__${rel.toLowerCase()}`}>
      <a href={href}>
        <span className="hc-pager__rel" data-type-role="label">
          <Words lang={lang}>{rel}</Words>
        </span>{' '}
        <span className="hc-pager__name">
          {position === 'index' ? (
            <Words lang={lang}>Index</Words>
          ) : (
            <>
              <span data-type-role="numeric">{numberOf(position)}</span>{' '}
              <Words lang={lang}>{CHAPTERS[position]!.label}</Words>
            </>
          )}
        </span>
      </a>
    </li>
  );
}

/** The heading level of a chapter's sections and frames: under the page's h1 in Prologue, else under the chapter's h2. */
export const levelOf = (position: number): HeadingLevel => (position === 0 ? 2 : 3);

export function Chapter({
  content,
  sections,
  input,
  opening,
  folded,
}: {
  content: ChapterContent;
  /** Its sections, rendered at levelOf() its position. */
  sections: readonly ReactElement[];
  /** The render input, for the frames and the ids. */
  input: VariantRenderInput;
  /** Prologue's opening, which holds the page's h1. */
  opening?: ReactNode;
  /** Works sections the frames show whole, whose ids land here. */
  folded?: readonly string[];
}) {
  const { position } = content;
  const prefix = input.ids.prefix;
  const lang = uiLang(input.portfolio.locale);
  const { key, label } = CHAPTERS[position]!;
  const titleId = ownId(prefix, `title-${key}`);
  const prologue = position === 0;
  const level = levelOf(position);
  const title = (
    <>
      <span className="hc-chapter__number" data-type-role="numeric">
        {numberOf(position)}
      </span>{' '}
      <span className="hc-chapter__label">
        <Words lang={lang}>{label}</Words>
      </span>
    </>
  );
  return (
    <section
      id={`${prefix}${anchorOf(position)}`}
      className="hc-chapter"
      data-chapter={key}
      aria-labelledby={titleId}
    >
      {prologue ? (
        <p id={titleId} className="hc-chapter__title" data-type-role="label" tabIndex={-1}>
          {title}
        </p>
      ) : (
        <h2 id={titleId} className="hc-chapter__title" data-type-role="title" tabIndex={-1}>
          {title}
        </h2>
      )}
      {(folded ?? []).flatMap((id) => {
        const anchor = contentAnchor(input, id);
        return anchor ? [<span key={id} id={anchor} className="hc-anchor" />] : [];
      })}
      <div className="hc-chapter__body">
        {opening}
        {sections.length > 0 ? <div className="hc-chapter__sections">{sections}</div> : null}
        {content.frames.length > 0 ? (
          <div className="hc-chapter__frames">
            {content.frames.map((work) => (
              <Frame
                key={work.id}
                work={work}
                input={input}
                level={level}
                eager={prologue && work === content.frames[0]}
              />
            ))}
          </div>
        ) : null}
      </div>
      <ul className="hc-pager" role="list">
        {position > 0 ? (
          <Neighbor rel="Previous" position={position - 1} prefix={prefix} lang={lang} />
        ) : null}
        <Neighbor
          rel="Next"
          position={position < LAST ? position + 1 : 'index'}
          prefix={prefix}
          lang={lang}
        />
      </ul>
    </section>
  );
}
