import type { ReactNode } from 'react';
import { RichText } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { shortDate } from './model';

// The small pieces every Swiss Signal component shares: its own ids, the
// language of the words it adds, the parenthetical, and Markdown in one
// role. Server-safe, so the enhancement reads the same ids the page writes.

/**
 * The id of one of the composition's own elements. Two hyphens: no content
 * id has them, so no section or record can take one.
 */
export const ownId = (prefix: string, name: string) => `${prefix}ss--${name}`;

/** `en` when the portfolio isn't in English, for the words the composition adds. */
export function uiLang(locale: string): 'en' | undefined {
  return /^en(?:-|$)/i.test(locale) ? undefined : 'en';
}

/** A word or phrase the composition adds, marked English in a portfolio in another language. */
export function Words({ lang, children }: { lang: 'en' | undefined; children: ReactNode }) {
  return lang ? <span lang={lang}>{children}</span> : <>{children}</>;
}

/**
 * The parenthetical, the composition's one voice device: the aside in the
 * quote role, set italic by the composition so it stays italic under every
 * typography pack (SS-M1, N9). `signal` sets it in the signal colour, for
 * sizes of 24 px and up; smaller ones take the accessible accent text (S5).
 */
export function Paren({
  children,
  signal = false,
  className,
}: {
  children: ReactNode;
  signal?: boolean;
  className?: string;
}) {
  return (
    <span
      className={['ss-paren', signal ? 'ss-paren--signal' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      data-type-role="quote"
    >
      ({children})
    </span>
  );
}

/** Text for assistive technology alone. */
export function Hidden({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <span className="ss-hidden" id={id}>
      {children}
    </span>
  );
}

/** Owner Markdown as a block in one role. */
export function Prose({
  source,
  input,
  role = 'body',
  className,
}: {
  source: string;
  input: VariantRenderInput;
  role?: string;
  className?: string;
}) {
  return <RichText source={source} input={input} typeRole={role} className={className} />;
}

/** Owner Markdown as a phrase, inside a heading or a sentence. */
export function Phrase({ source, input }: { source: string; input: VariantRenderInput }) {
  return <RichText source={source} input={input} inline />;
}

/** Whether a link leaves the site, for the outbound mark. */
export const outbound = (href: string) => /^https?:\/\//i.test(href);

/**
 * An address as paper sets it: a break opportunity after each separator
 * (/ . - ? & = # _ ~), so a long one wraps at its joints and never inside a
 * word, and a table's column never has to grow past the page to hold it.
 */
export function breakable(address: string): ReactNode[] {
  return address
    .split(/(?<=[/.\-?&=#_~])/)
    .flatMap((piece, index) => (index === 0 ? [piece] : [<wbr key={index} />, piece]));
}

/**
 * An outbound link's mark: the arrow is for outbound links alone (C3). On
 * paper the link prints its address after it (styles.css shows .ss-addr in
 * print alone), breakable at its separators.
 */
export function Out({ href }: { href: string }) {
  return outbound(href) ? (
    <>
      <span className="ss-out" aria-hidden="true">
        {' ↗'}
      </span>
      <span className="ss-addr" aria-hidden="true">
        {' ('}
        {breakable(href)}
        {')'}
      </span>
    </>
  ) : null;
}

/** A loose date as a table sets it, `8 Feb 2026`, in a `<time>`; its month names are English. */
export function When({ raw, lang }: { raw: string | undefined; lang: 'en' | undefined }) {
  const date = shortDate(raw);
  return date ? (
    <time
      className="ss-num"
      dateTime={date.iso}
      lang={/[A-Za-z]/.test(date.text) ? lang : undefined}
    >
      {date.text}
    </time>
  ) : null;
}
