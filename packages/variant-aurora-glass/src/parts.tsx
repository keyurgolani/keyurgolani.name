import type { ReactNode } from 'react';
import type { Placement, Work } from '@portfolio/schema';
import {
  hrefFor,
  MediaFigure,
  placedImage,
  renderContext,
  RichText,
  type PlacedImage,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { longDate, readyMedia } from './model';

// The small pieces every Aurora Glass component shares: its own ids, the
// language of the words it adds, Markdown in one role, dates, outbound
// marks and the kit's picture inside the composition's own frames.

/**
 * The id of one of the composition's own elements. Two hyphens: no content
 * id has them, so no section or record can take one.
 */
export const ownId = (prefix: string, name: string) => `${prefix}ag--${name}`;

/** `en` when the portfolio isn't in English, for the words the composition adds. */
export function uiLang(locale: string): 'en' | undefined {
  return /^en(?:-|$)/i.test(locale) ? undefined : 'en';
}

/** A word or phrase the composition adds, marked English in a portfolio in another language. */
export function Words({ lang, children }: { lang: 'en' | undefined; children: ReactNode }) {
  return lang ? <span lang={lang}>{children}</span> : <>{children}</>;
}

/** Text for assistive technology alone. */
export function Hidden({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <span className="ag-hidden" id={id}>
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

/**
 * A row's longer text, closed under a label: a description or an episode's
 * show notes, which have no page of their own, so home holds them without
 * their length (the code review's blocker 2). Print opens it (enhancements/sky.ts).
 */
export function More({
  label,
  of,
  source,
  input,
}: {
  label: string;
  /** What it's about, the work's or episode's title: it names the summary apart from its neighbours (delta check 2). */
  of: { title: string; lang?: string };
  source: string;
  input: VariantRenderInput;
}) {
  const lang = uiLang(input.portfolio.locale);
  return (
    <details className="ag-more" data-ag-more="">
      <summary className="ag-more__summary" data-type-role="label">
        <Words lang={lang}>{label}</Words>
        <Hidden>
          <Words lang={lang}>: </Words>
          <span lang={of.lang}>{of.title}</span>
        </Hidden>
      </summary>
      <Prose source={source} input={input} role="body-compact" className="ag-more__body" />
    </details>
  );
}

/** Owner Markdown as a phrase, inside a heading or a sentence. */
export function Phrase({ source, input }: { source: string; input: VariantRenderInput }) {
  return <RichText source={source} input={input} inline />;
}

/** Whether a link leaves the site, for the outbound mark. */
export const outbound = (href: string) => /^https?:\/\//i.test(href);

/** An outbound link's mark: the arrow is for outbound links alone (C3). */
export function Out({ href }: { href: string }) {
  return outbound(href) ? (
    <span className="ag-out" aria-hidden="true">
      {/* A no-break space: the arrow stays with the last word. */}
      {'\u00a0↗'}
    </span>
  ) : null;
}

/** A loose date in a `<time>`, `8 February 2026`; its month names are English. */
export function When({ raw, lang }: { raw: string | undefined; lang: 'en' | undefined }) {
  const date = longDate(raw);
  return date ? (
    <time
      className="ag-num"
      dateTime={date.iso}
      lang={/[A-Za-z]/.test(date.text) ? lang : undefined}
    >
      {date.text}
    </time>
  ) : null;
}

/** A placement's image when it's ready to show. */
export function readyImage(
  placement: Placement | undefined,
  input: VariantRenderInput,
): PlacedImage | undefined {
  if (!readyMedia(placement, input)) return undefined;
  return placedImage(placement, input);
}

/** The kit's picture (renditions, srcset) inside the composition's frame. */
export function Img({
  placed,
  input,
  className,
  sizes,
  eager = false,
  decorative = false,
  inline = true,
}: {
  placed: PlacedImage;
  input: VariantRenderInput;
  className?: string;
  sizes: string;
  eager?: boolean;
  decorative?: boolean;
  /** No figure: a picture beside a title that names it. A stage keeps its caption: false. */
  inline?: boolean;
}) {
  const ctx = renderContext(input, { id: placed.asset, title: undefined }, 3);
  const shown: PlacedImage = decorative
    ? {
        ...placed,
        decorative: true,
        alt: undefined,
        caption: undefined,
        credit: undefined,
        rights: undefined,
      }
    : placed;
  return (
    <MediaFigure
      placed={shown}
      ctx={ctx}
      className={className}
      sizes={sizes}
      eager={eager}
      inline={inline}
    />
  );
}

/** A link's words: the owner's label, else its platform, else its address. */
export const linkWords = (link: { url: string; label?: string; platform?: string }) =>
  link.label ?? link.platform ?? link.url.replace(/^https?:\/\//i, '').replace(/\/$/, '');

/**
 * A record's or a work's own links, each by the owner's label, on one quiet
 * line (the content sweep: a label the owner wrote is shown, never dropped
 * for the title's link alone).
 */
export function LinkLine({
  links,
  input,
  className = 'ag-row__links',
}: {
  links: readonly { url: string; label?: string; platform?: string }[] | undefined;
  input: VariantRenderInput;
  className?: string;
}) {
  const shown = (links ?? []).filter((link) => link.url?.trim());
  if (shown.length === 0) return null;
  return (
    <p className={className} data-type-role="label">
      {shown.map((link) => (
        <a key={link.url} href={hrefFor(link.url, input)}>
          {linkWords(link)}
          <Out href={link.url} />
        </a>
      ))}
    </p>
  );
}

const minutesSeconds = (seconds: number) => {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/** A release's tracks, in order, each linked where it has its own URL, with its length. */
export function Tracks({
  tracks,
  input,
  className = 'ag-tracks',
}: {
  tracks: NonNullable<Work['tracks']>;
  input: VariantRenderInput;
  className?: string;
}) {
  if (tracks.length === 0) return null;
  return (
    <ol className={className} data-type-role="body-compact" aria-label="Tracks">
      {tracks.map((track, index) => (
        <li key={`${track.title}-${index}`} className="ag-tracks__row">
          {track.url ? (
            <a href={hrefFor(track.url, input)}>{track.title}</a>
          ) : (
            <span>{track.title}</span>
          )}
          {track.durationSeconds ? (
            <span className="ag-num">{minutesSeconds(track.durationSeconds)}</span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
