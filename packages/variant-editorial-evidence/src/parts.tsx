import type { ReactNode } from 'react';
import { Surface } from '@portfolio/appearance/primitives';
import {
  deeper,
  Heading,
  MediaFigure,
  present,
  renderContext,
  type HeadingLevel,
  type MediaFigureProps,
  type PlacedImage,
  type RenderContext,
} from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';

// What the composition's own pieces share: its region ids, the language of
// the words it adds, links home, and the issue's furniture: the one caption
// system, ruled rows with a leader, and ruled fact sheets.

/**
 * The id of one of the composition's own regions. Two hyphens: no content
 * id has them, so no section or record can take one.
 */
export const regionId = (input: Pick<VariantRenderInput, 'ids'>, name: string) =>
  `${input.ids.prefix}ee--${name}`;

/** `en` when the portfolio isn't in English, for the words the composition adds, such as Work. */
export function uiLang(input: Pick<VariantRenderInput, 'portfolio'>): 'en' | undefined {
  return /^en(?:-|$)/i.test(input.portfolio.locale) ? undefined : 'en';
}

/** An email address that, when it must wrap, wraps after its @, never inside a word. */
export function Address({ email }: { email: string }) {
  const at = email.lastIndexOf('@');
  if (at <= 0) return <>{email}</>;
  return (
    <>
      {email.slice(0, at + 1)}
      <wbr />
      {email.slice(at + 1)}
    </>
  );
}

/** A word or phrase the composition adds, marked English in a portfolio in another language. */
export function Words({
  input,
  children,
}: {
  input: Pick<VariantRenderInput, 'portfolio'>;
  children: string;
}) {
  const lang = uiLang(input);
  return lang ? <span lang={lang}>{children}</span> : <>{children}</>;
}

/** Where a region of the home page is, from any route: a fragment on home, or home and the fragment. */
export function homeRegion(input: VariantRenderInput, id: string): string {
  if (input.route.route === 'home') return `#${id}`;
  const home = routeHref(input, { route: 'home' });
  return `${home}#${id}`;
}

/** A render context for a section, or one of the composition's own parts, at `level`. */
export function contextFor(
  input: VariantRenderInput,
  section: { readonly id: string; readonly lang?: string; readonly title?: string },
  level: HeadingLevel,
): RenderContext {
  return renderContext(input, section, level);
}

/**
 * The one caption system (C7): the title on the start of the row, the index
 * at its end, and everything after on the lines below, quieter.
 */
export function Caption({
  title,
  index,
  children,
  className,
}: {
  title?: ReactNode;
  index?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className ? `ee-caption ${className}` : 'ee-caption'} data-type-role="caption">
      {title ? <div className="ee-caption__title">{title}</div> : null}
      {index ? <p className="ee-caption__index">{index}</p> : null}
      {children}
    </div>
  );
}

/** A ruled list of rows, one item each. */
export function Rows({
  children,
  ordered = false,
  className,
}: {
  children: ReactNode;
  ordered?: boolean;
  className?: string;
}) {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag className={className ? `ee-rows ${className}` : 'ee-rows'} role="list">
      {children}
    </Tag>
  );
}

/**
 * One row, as a table of contents sets it: the title, a hairline leader, and
 * what ends the line, such as a date, on the text column; the line under it;
 * the body; and a note in the margin, beside the row.
 */
export function Row({
  id,
  title,
  level,
  end,
  sub,
  note,
  children,
  lang,
  attributes,
}: {
  id?: string;
  title: ReactNode;
  level: HeadingLevel;
  end?: ReactNode;
  sub?: ReactNode;
  note?: ReactNode;
  children?: ReactNode;
  lang?: string;
  attributes?: Readonly<Record<string, string | undefined>>;
}) {
  return (
    <li id={id} className="ee-row" lang={lang} {...attributes}>
      <div className="ee-row__line">
        <Heading level={level} className="ee-row__title">
          {title}
        </Heading>
        {end ? (
          <>
            <span className="ee-row__leader" aria-hidden="true" />
            <span className="ee-row__end" data-type-role="body-compact">
              {end}
            </span>
          </>
        ) : null}
      </div>
      {sub ? (
        <div className="ee-row__sub" data-type-role="body-compact">
          {sub}
        </div>
      ) : null}
      {children ? <div className="ee-row__body">{children}</div> : null}
      {note ? (
        <div className="ee-row__note" data-type-role="body-compact">
          {note}
        </div>
      ) : null}
    </li>
  );
}

/**
 * A ruled fact sheet: each term on the start of its row, its value after it. With
 * `surfaceClassName`, the sheet sits on the language's subtle Surface, which that class lays out;
 * none renders when it has no facts.
 */
export function Facts({
  facts,
  className,
  surfaceClassName,
}: {
  facts: ReadonlyArray<readonly [term: ReactNode, value: ReactNode] | null | false | undefined>;
  className?: string;
  surfaceClassName?: string;
}) {
  const shown = facts.filter((fact): fact is readonly [ReactNode, ReactNode] => Boolean(fact));
  if (shown.length === 0) return null;
  const sheet = (
    <dl className={className ? `ee-facts ${className}` : 'ee-facts'} data-type-role="body-compact">
      {shown.map(([term, value], index) => (
        <div key={index}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
  return surfaceClassName ? (
    <Surface emphasis="subtle" className={surfaceClassName}>
      {sheet}
    </Surface>
  ) : (
    sheet
  );
}

/** A name as it reads: composed, its spaces one apiece, so a name typed twice compares equal. */
const asRead = (name: string) => name.normalize('NFC').replace(/\s+/g, ' ').trim();

/**
 * A picture's credit and rights as the issue writes an attribution (C3): one
 * line, comma to comma, never run together, and a name said once, so a
 * rights holder who is the credit's own name isn't repeated beside it. Each
 * part keeps the kit's class, and the rights their attribution flag. It goes
 * after the caption, where the kit sets the credit; a picture with neither
 * credit nor rights is as the kit placed it.
 */
export function credited(placed: PlacedImage): PlacedImage {
  const credit = present(placed.credit) ? placed.credit : undefined;
  const { holder, license, attributionRequired } = placed.rights ?? {};
  const owner =
    present(holder) && (credit === undefined || asRead(holder) !== asRead(credit))
      ? holder
      : undefined;
  const terms = present(license) ? license : undefined;
  if (credit === undefined && owner === undefined && terms === undefined) return placed;
  const rights =
    owner !== undefined || terms !== undefined ? (
      <small
        className="pf-rights"
        {...(attributionRequired === true ? { 'data-attribution-required': 'true' } : {})}
      >
        {owner !== undefined ? <span className="pf-rights-holder">{owner}</span> : null}
        {owner !== undefined && terms !== undefined ? ', ' : null}
        {terms !== undefined ? <span className="pf-rights-license">{terms}</span> : null}
      </small>
    ) : null;
  return {
    ...placed,
    caption: (
      <>
        {placed.caption}
        {credit !== undefined ? <small className="pf-credit">{credit}</small> : null}
        {credit !== undefined && rights !== null ? ', ' : null}
        {rights}
      </>
    ),
    credit: undefined,
    rights: undefined,
  };
}

/** The kit's figure, its credit and rights in the issue's own grammar (credited, above). */
export function Figure(props: MediaFigureProps) {
  return <MediaFigure {...props} placed={credited(props.placed)} />;
}

/** Parts joined by commas, each a node: a plain separator, never a dot. */
export function joined(parts: readonly ReactNode[]): ReactNode {
  const shown = parts.filter(
    (part) => part !== null && part !== undefined && part !== false && part !== '',
  );
  return shown.map((part, index) => (
    <span key={index}>
      {index > 0 ? ', ' : null}
      {part}
    </span>
  ));
}

/** The level an item's heading takes under a section heading at `level`. */
export const itemLevel = (level: HeadingLevel) => deeper(level);
