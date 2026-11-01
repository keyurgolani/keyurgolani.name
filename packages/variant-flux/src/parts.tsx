import type { ReactNode } from 'react';
import type { Placement, Work } from '@portfolio/schema';
import {
  hrefFor,
  MediaFigure,
  placedImage,
  placedMedia,
  renderContext,
  RichText,
  type PlacedImage,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import {
  formatNumber,
  hasCaseStudy,
  linkLabel,
  longDate,
  present,
  readyMedia,
  titleLink,
} from './model';

// The small pieces every Flux component shares: its own ids, the language
// of the words it adds, Markdown in one role, dates, outbound marks and the
// kit's picture inside the composition's own frames.

/**
 * The id of one of the composition's own elements. Two hyphens: no content
 * id has them, so no section or record can take one.
 */
export const ownId = (prefix: string, name: string) => `${prefix}fx--${name}`;

/** `en` when the portfolio isn't in English, for the words the composition adds. */
export function uiLang(locale: string): 'en' | undefined {
  return /^en(?:-|$)/i.test(locale) ? undefined : 'en';
}

/** A word or phrase the composition adds, marked English in a portfolio in another language. */
export function Words({ lang, children }: { lang: 'en' | undefined; children: ReactNode }) {
  return lang ? <span lang={lang}>{children}</span> : <>{children}</>;
}

/**
 * The wipe's curtain (FX-M5, K-4 (a)): an empty layer over the window, named flux-wipe on home
 * and on a work's own page alike, so a navigation between them pours its ink over the page. It
 * shows nothing at rest, and with the control off there's none, so the pages crossfade.
 */
export function WipeCurtain({ on }: { on: boolean }) {
  return on ? <span className="fx-wipe" aria-hidden="true" /> : null;
}

/**
 * A heading's words with a word of one or two letters just inside an opening bracket kept on the
 * line of the word after it ("(a small"), so a line never ends on "(a". Only the wrapping changes:
 * the text is the same, in spans.
 */
export function Bound({ text }: { text: string }) {
  // The next word up to 12 characters: a longer one may need to break, so it isn't held.
  const parts = text.split(/([([{]\p{L}{1,2} \S{1,12})(?=\s|$)/u);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} className="fx-bound">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

/**
 * The rest of a run, folded on a phone (design gate item 7): a native disclosure the server
 * renders closed, which the tabs enhancement opens on wider screens, where its summary hides and
 * the run reads whole. Every item stays on the page: it opens from a fragment, with no script, and
 * on paper.
 */
export function More({
  count,
  input,
  children,
}: {
  count: number;
  input: VariantRenderInput;
  children: ReactNode;
}) {
  return (
    <details className="fx-fold fx-more" data-fx-fold="" data-fx-more="">
      <summary className="fx-fold__summary">
        <span className="fx-fold__word" data-type-role="title">
          <Words lang={uiLang(input.portfolio.locale)}>More</Words>
        </span>
        <span className="fx-fold__count fx-num" data-type-role="label">
          {formatNumber(count, input.portfolio.locale)}
        </span>
      </summary>
      <div className="fx-fold__body">{children}</div>
    </details>
  );
}

/**
 * A disclosure closed at every width, for what a run holds past what it shows (a gallery's
 * pictures past five, a work's description beside its summary): every word in the markup, open
 * from a fragment, with no script, and on paper.
 */
export function Fold({
  word,
  count,
  input,
  children,
}: {
  word: string;
  count?: number;
  input: VariantRenderInput;
  children: ReactNode;
}) {
  return (
    <details className="fx-fold fx-fold--more" data-fx-fold="">
      <summary className="fx-fold__summary">
        <span className="fx-fold__word" data-type-role="title">
          <Words lang={uiLang(input.portfolio.locale)}>{word}</Words>
        </span>
        {count === undefined ? null : (
          <span className="fx-fold__count fx-num" data-type-role="label">
            {formatNumber(count, input.portfolio.locale)}
          </span>
        )}
      </summary>
      <div className="fx-fold__body">{children}</div>
    </details>
  );
}

/** Text for assistive technology alone. */
export function Hidden({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <span className="fx-hidden" id={id}>
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

/** An outbound link's mark: the arrow is for outbound links alone (C3). */
export function Out({ href }: { href: string }) {
  return outbound(href) ? (
    <span className="fx-out" aria-hidden="true">
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
      className="fx-num"
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

/**
 * A placement with what its author wrote about it, as the kit's shared renderers place it: its
 * caption, when and where it was taken and its tags, under the picture, or under its box when the
 * picture isn't there yet. None when the view holds no image for it.
 */
export function captionedImage(
  placement: Placement | undefined,
  input: VariantRenderInput,
): PlacedImage | undefined {
  if (!placement) return undefined;
  return placedMedia(placement, renderContext(input, { id: placement.asset, title: undefined }, 3));
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

/** An email address that breaks only after its @, never at a dot. */
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

/**
 * A release's tracks, each title with its length. More than four fold behind a native disclosure
 * (design gate item 7), as the record's do: it opens from a fragment, with no script, on paper.
 * A work's own page lists them open (`fold` false).
 */
export function Tracks({
  work,
  input,
  fold = true,
}: {
  work: Pick<Work, 'tracks'>;
  input: VariantRenderInput;
  fold?: boolean;
}) {
  const tracks = (work.tracks ?? []).filter((track) => present(track.title));
  if (tracks.length === 0) return null;
  const list = (
    <ol className="fx-tracks" role="list">
      {tracks.map((track, index) => (
        <li key={`${track.title}-${index}`}>
          <span data-type-role="body-compact">{track.title}</span>
          {track.durationSeconds ? (
            <span className="fx-num" data-type-role="caption">
              {lengthOf(track.durationSeconds, input.portfolio.locale)}
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
  if (!fold || tracks.length <= 4) return list;
  return (
    <details className="fx-fold fx-fold--tracks" data-fx-fold="">
      <summary className="fx-fold__summary">
        <span className="fx-fold__word" data-type-role="title">
          <Words lang={uiLang(input.portfolio.locale)}>Tracks</Words>
        </span>
        <span className="fx-fold__count fx-num" data-type-role="label">
          {formatNumber(tracks.length, input.portfolio.locale)}
        </span>
      </summary>
      <div className="fx-fold__body">{list}</div>
    </details>
  );
}

/** A track's length as minutes and seconds: 5:12. */
function lengthOf(seconds: number, locale: string): string {
  const whole = Math.round(seconds);
  return `${formatNumber(Math.floor(whole / 60), locale)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * A work's links after the one its title takes, each by its label. A work with a page of its own
 * lists them there.
 */
export function WorkLinks({ work, input }: { work: Work; input: VariantRenderInput }) {
  if (hasCaseStudy(work)) return null;
  const title = titleLink(work);
  const links = (work.links ?? []).filter(
    (link, index, all) =>
      present(link.url) &&
      link.url !== title &&
      all.findIndex((other) => other.url === link.url) === index,
  );
  if (links.length === 0) return null;
  return (
    <p className="fx-row__links" data-type-role="label">
      {links.map((link) => {
        const href = hrefFor(link.url, input);
        return (
          <a key={link.url} className="fx-link" href={href}>
            {linkLabel(link)}
            <Out href={href} />
          </a>
        );
      })}
    </p>
  );
}
