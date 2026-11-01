import { Fragment, type ReactNode } from 'react';
import type { Link } from '@portfolio/schema';
import { hrefFor, present } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';

// The small pieces every Terra Field form is built from: the composition's
// own words (marked English in a portfolio in another language), an
// outbound link whose mark never wraps alone, an address that wraps only
// where an address does, and plain-separated lines.

/** The composition's own words, in English, marked so where the content isn't. */
export function Words({ lang, children }: { lang: 'en' | undefined; children: ReactNode }) {
  return lang ? <span lang={lang}>{children}</span> : <>{children}</>;
}

/** Whether a link leaves the site: anything with a scheme but mail. */
export const outbound = (href: string) =>
  /^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('mailto:');

/**
 * A link's text with the outbound mark joined to its last word by a word
 * joiner (U+2060), so the mark never starts a line by itself, while a long
 * last word (an address, a username) can still break where it must, which
 * a nowrap run would stop (code review low 3).
 */
function Joined({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <span className="tf-out" aria-hidden="true">
        {'⁠↗'}
      </span>
    </>
  );
}

/** A link, with the outbound mark when it leaves the site, so the mark means something. */
export function Out({
  href,
  children,
  className,
  lang,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  lang?: string;
}) {
  return (
    <a className={className} href={href} lang={lang}>
      {outbound(href) ? <Joined>{children}</Joined> : children}
    </a>
  );
}

/**
 * An address as words that wrap where an address does: after the @ and
 * before each dot or slash, so a narrow line never splits a word of it.
 * Anything with a space is prose, and stays as it is.
 */
export function Breakable({ text }: { text: string }) {
  if (/\s/.test(text) || !/[@./]/.test(text)) return <>{text}</>;
  const parts = text.split(/(?<=@)|(?=[./])/);
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
  className = 'tf-links',
}: {
  links: readonly { readonly url: string; readonly text: string }[];
  input: VariantRenderInput;
  className?: string;
}) {
  if (links.length === 0) return null;
  return (
    <ul className={className} role="list">
      {links.map((link, index) => (
        <li key={index}>
          <Out href={hrefFor(link.url, input)}>{link.text}</Out>
        </li>
      ))}
    </ul>
  );
}

/** Parts of a line, comma-separated in the source and spaced on screen: never a middle dot. */
export function Line({ parts, className }: { parts: readonly ReactNode[]; className: string }) {
  const shown = parts.filter(
    (part) => part !== null && part !== undefined && part !== false && part !== '',
  );
  if (shown.length === 0) return null;
  return (
    <p className={className}>
      {shown.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? ', ' : null}
          <span>{part}</span>
        </Fragment>
      ))}
    </p>
  );
}

/** A visually hidden span, for words a sighted reader gets from the layout. */
export function Hidden({ children, lang }: { children: ReactNode; lang?: string }) {
  return (
    <span className="tf-sr" lang={lang}>
      {children}
    </span>
  );
}
