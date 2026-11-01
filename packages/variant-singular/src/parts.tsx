import type { ReactNode } from 'react';
import { DateText, hrefFor, PeriodText, renderContext, RichText } from '@portfolio/kit/sections';
import type { Period } from '@portfolio/schema';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { outbound, type Target } from './model';

// The small pieces every Singular part is built from: ids under the render's
// prefix, the composition's own words marked English inside a portfolio
// that isn't, the owner's Markdown through the kit's one renderer, dates as
// <time>, and the drawn arrows (never a typed "→", C3).

/** An id of Singular's own, under the render's prefix. */
export const ownId = (prefix: string, name: string) => `${prefix}${name}`;

/** `en` when the portfolio isn't English, for the words the composition adds. */
export function uiLang(locale: string): 'en' | undefined {
  return /^en(?:-|$)/i.test(locale) ? undefined : 'en';
}

/** The composition's own words, marked English when the portfolio isn't. */
export function Words({ lang, children }: { lang?: string; children: ReactNode }) {
  return lang ? <span lang={lang}>{children}</span> : <>{children}</>;
}

/** The owner's inline Markdown. */
export function Phrase({ source, input }: { source: string; input: VariantRenderInput }) {
  return <RichText source={source} inline input={input} />;
}

/** The owner's Markdown, in paragraphs, in the body role. */
export function Prose({
  source,
  input,
  className,
}: {
  source: string;
  input: VariantRenderInput;
  className?: string;
}) {
  return <RichText source={source} input={input} className={className} typeRole="body" />;
}

/** A loose date as <time>. */
export function When({ raw, input }: { raw: string | undefined; input: VariantRenderInput }) {
  if (!raw) return null;
  return <DateText raw={raw} ctx={renderContext(input, { id: 'sg', title: undefined }, 3)} />;
}

/** A period as two <time>s, an en dash between. */
export function Span({ period, input }: { period: Period | undefined; input: VariantRenderInput }) {
  if (!period) return null;
  return (
    <PeriodText period={period} ctx={renderContext(input, { id: 'sg', title: undefined }, 3)} />
  );
}

/** An owner's URL as an href: a `#id` or `/#id` keeps this render's id prefix and query (hrefFor). */
export const urlHref = (url: string, input: VariantRenderInput) => hrefFor(url.trim(), input);

/** Where a panel action goes, as an href for this render. */
export function hrefOf(target: Target, input: VariantRenderInput): string {
  switch (target.kind) {
    case 'anchor':
      return `#${input.ids.prefix}${target.anchor}`;
    case 'case':
      return routeHref(input, { route: 'work', slug: target.slug });
    case 'url':
      return urlHref(target.url, input);
  }
}

/** The arrow an action ends on: down the page, or out of it. Drawn, so no text reads it. */
export function Arrow({ dir }: { dir: 'down' | 'out' }) {
  return (
    <svg
      className="sg-arrow"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      data-dir={dir}
    >
      {dir === 'down' ? (
        <path d="M12 4v15M5.5 12.5 12 19l6.5-6.5" />
      ) : (
        <path d="M4 12h15M12.5 5.5 19 12l-6.5 6.5" />
      )}
    </svg>
  );
}

/** A link that marks itself as leaving the site with a small drawn arrow. */
export function Out({
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

/** Visually hidden text, read by assistive technology. */
export function Hidden({ children, lang }: { children: ReactNode; lang?: string }) {
  return (
    <span className="sg-hidden" lang={lang}>
      {children}
    </span>
  );
}
