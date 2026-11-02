import { Fragment, type CSSProperties, type ReactNode } from 'react';
import type { Link } from '@portfolio/schema';
import { hrefFor, present, type RenderContext } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { longestToken } from './model';

/**
 * Display, tape and title words sized by their cell (the name's fit, .rg-name, the type lint's
 * one exception): at their own size wherever their longest word fits, a step smaller only where
 * it wouldn't, as under 200% text on a phone, so no word breaks inside itself (design r5 P0-2).
 */
export function Fit({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <span
      className="rg-name rg-fit"
      style={{ '--layout-name-chars': longestToken(text) } as CSSProperties}
    >
      {children ?? text}
    </span>
  );
}

// The small pieces every Raw Grid form is built from: the composition's own
// words (marked English in a portfolio in another language), an outbound
// link with its mark, the outline chips, and the checked list.

/** The composition's own words, in English, marked so where the content isn't. */
export function Words({ lang, children }: { lang: 'en' | undefined; children: ReactNode }) {
  return lang ? <span lang={lang}>{children}</span> : <>{children}</>;
}

/** Whether a link leaves the page: anything but a fragment or a path on this site. */
const outbound = (href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('mailto:');

/** A link, with the outbound mark when it leaves the site, so the mark means something (smell 18). */
export function Out({
  href,
  children,
  className,
  lang,
  sentence,
  style,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  lang?: string;
  style?: CSSProperties;
  /** Set in its own case, out of the caps voice: an address. */
  sentence?: boolean;
}) {
  return (
    <a
      className={className}
      href={href}
      lang={lang}
      style={style}
      data-case={sentence ? 'sentence' : undefined}
    >
      {children}
      {outbound(href) ? (
        <span className="rg-out" aria-hidden="true">
          ↗
        </span>
      ) : null}
    </a>
  );
}

/**
 * An address as words that wrap where an address does: after the @ and
 * before each dot or slash, so a narrow cell never splits a word of it
 * ("anamika.example.com", never "anamika.exampl / e.com"). Anything with a
 * space is prose, and stays as it is.
 */
export function Breakable({ text }: { text: string }) {
  if (/\s/.test(text) || !/[@./]/.test(text)) return <>{text}</>;
  const parts = text.split(/(?<=@)|(?=[./])/);
  // One span, so a flex link holds it as one item and wraps only at the <wbr>s.
  return (
    <span>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? <wbr /> : null}
          {part}
        </Fragment>
      ))}
    </span>
  );
}

/** A link record's words: its label, its platform, else its address. */
export const linkText = (link: Pick<Link, 'label' | 'platform' | 'url'>) =>
  [link.label, link.platform].find(present) ?? link.url.replace(/^[a-z]+:\/\//i, '');

/** A run of links, inline. */
export function Links({
  links,
  input,
}: {
  links: readonly { readonly url: string; readonly text: string }[];
  input: VariantRenderInput;
}) {
  if (links.length === 0) return null;
  return (
    <ul className="rg-links" role="list">
      {links.map((link, index) => (
        <li key={index}>
          <Out href={hrefFor(link.url, input)}>{link.text}</Out>
        </li>
      ))}
    </ul>
  );
}

/** Outline chips: tools, tags, categories. At most one row of them, where they carry information. */
export function Chips({ items, label }: { items: readonly string[] | undefined; label?: string }) {
  const shown = (items ?? []).filter(present);
  if (shown.length === 0) return null;
  return (
    <ul className="rg-chips" role="list" aria-label={label}>
      {shown.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

/** A checked list: highlights and results, each a mark and its words. */
export function Checks({ items }: { items: readonly string[] | undefined }) {
  const shown = (items ?? []).filter(present);
  if (shown.length === 0) return null;
  return (
    <ul className="rg-checks" role="list">
      {shown.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

/** Parts of a line, plain-separated: never a middle dot. */
export function Line({ parts, className }: { parts: readonly ReactNode[]; className: string }) {
  const shown = parts.filter(
    (part) => part !== null && part !== undefined && part !== false && part !== '',
  );
  if (shown.length === 0) return null;
  return (
    <p className={className} data-parts="">
      {/* An address among them (a publication's host) wraps at its own points. */}
      {shown.map((part, index) => (
        <span key={index}>{typeof part === 'string' ? <Breakable text={part} /> : part}</span>
      ))}
    </p>
  );
}

/** Past this many characters a caps title reads as a wall: it falls back to sentence case (RG-S7). */
export const CAPS_LIMIT = 40;

/** The attribute that sets a long title in sentence case. */
export const caseOf = (title: string) =>
  [...title].length > CAPS_LIMIT ? ({ 'data-case': 'sentence' } as const) : {};

/** The heading level an item takes inside its section. */
export const itemLevel = (ctx: RenderContext) => ctx.itemLevel;
