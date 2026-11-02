import type { ReactNode } from 'react';
import {
  DateText,
  formatFigure,
  PeriodText,
  renderContext,
  RichText,
} from '@portfolio/kit/sections';
import type { Period } from '@portfolio/schema';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { outbound } from './model';
import { stringsFor, type Strings } from './strings';

// The small pieces every Schematic part is built from: its own words marked
// English inside a portfolio that isn't, ids under the render's prefix, the
// owner's Markdown through the kit's one renderer, and dates as <time>.

/** An id of Schematic's own, under the render's prefix: `sx-` and the name. */
export const ownId = (prefix: string, name: string) => `${prefix}sx-${name}`;

/** The chrome strings and their language for this render. */
export function words(input: VariantRenderInput): { t: Strings; lang?: 'en' } {
  return stringsFor(input.portfolio.locale);
}

/** Schematic's own words, marked English when the portfolio isn't. */
export function Ui({ lang, children }: { lang?: string; children: ReactNode }) {
  return lang ? <span lang={lang}>{children}</span> : <>{children}</>;
}

/**
 * A figure caption (SC-M5): the figure's number in the numeric role, and
 * the sentence after it in body-compact, never mono.
 */
export function Caption({
  id,
  n,
  lang,
  fig,
  children,
}: {
  id?: string;
  n: number;
  lang?: string;
  fig: string;
  children?: ReactNode;
}) {
  return (
    <figcaption id={id} className="sx-caption" data-type-role="body-compact">
      <span className="sx-caption__no" data-type-role="numeric">
        <Ui lang={lang}>
          {fig}&nbsp;{n}.
        </Ui>
      </span>
      {children ? (
        <>
          {' '}
          <Ui lang={lang}>{children}</Ui>
        </>
      ) : null}
    </figcaption>
  );
}

/** The owner's inline Markdown, in the language of the record it's from when that differs. */
export function Phrase({
  source,
  input,
  lang,
}: {
  source: string;
  input: VariantRenderInput;
  lang?: string;
}) {
  const text = <RichText source={source} inline input={input} />;
  return lang ? <span lang={lang}>{text}</span> : text;
}

/** The owner's Markdown, in paragraphs, in the body role (SC-M5: prose is never mono). */
export function Prose({
  source,
  input,
  className,
  lang,
}: {
  source: string;
  input: VariantRenderInput;
  className?: string;
  /** The record's own language, when it differs from the page's. */
  lang?: string;
}) {
  const text = <RichText source={source} input={input} className={className} typeRole="body" />;
  return lang ? <div lang={lang}>{text}</div> : text;
}

/** A link that marks itself as leaving the site with a drawn arrow, never a typed one. */
export function Port({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a href={href} className={className} data-out={outbound(href) ? '' : undefined}>
      {children}
    </a>
  );
}

/** A loose date as <time>. */
export function When({ raw, input }: { raw: string | undefined; input: VariantRenderInput }) {
  if (!raw) return null;
  return <DateText raw={raw} ctx={renderContext(input, { id: 'sx', title: undefined }, 3)} />;
}

/** A period as two <time>s. */
export function Span({ period, input }: { period: Period | undefined; input: VariantRenderInput }) {
  if (!period) return null;
  return (
    <PeriodText period={period} ctx={renderContext(input, { id: 'sx', title: undefined }, 3)} />
  );
}

/** A number as the portfolio's language writes it. */
export function figure(value: number | null | undefined, input: VariantRenderInput): string {
  if (typeof value !== 'number') return '';
  return formatFigure(value, renderContext(input, { id: 'figure' }, 2));
}
