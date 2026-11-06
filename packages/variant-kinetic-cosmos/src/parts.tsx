import { Fragment, type ReactNode } from 'react';
import type { Link, Placement } from '@portfolio/schema';
import {
  DateText,
  hrefFor,
  placedImage,
  present,
  Ui,
  type PlacedImage,
  type RenderContext,
} from '@portfolio/kit/sections';

// The small pieces Kinetic Cosmos's renderers share (redesign, stream E):
// a line of facts joined by commas, a ruled fact list, a link from a Link,
// and an address shown as its own text. No middle dots, no arrows, no
// eyebrow labels: facts read as a sentence or as labelled rows.

/**
 * Main's first child: an empty mark inside <noscript>. The parser makes it an element only when
 * it reads the page with scripting off; with scripting on it's the noscript's text. The
 * stylesheet's no-script rules key on it, never on a scripting query: the quality runner's
 * no-JavaScript rows audit with script on for axe, which such a query would flip (Terra Field's,
 * Shell's and Obsidian Atelier's NoScriptMark). Main lays out as a block, so the empty inline is
 * never a box: its line has no height, and nothing hides it.
 */
export function NoScriptMark() {
  return (
    <noscript>
      <i data-kc-nojs="" />
    </noscript>
  );
}

/** Whether a part of a line has something to show: blank text and false don't. */
function shows(part: ReactNode): boolean {
  if (part === null || part === undefined || part === false || part === true) return false;
  return typeof part !== 'string' || present(part);
}

/** Short facts as one phrase, joined by commas, in order. */
export function Phrase({
  parts,
  className,
  role,
}: {
  readonly parts: readonly ReactNode[];
  readonly className?: string;
  readonly role?: string;
}) {
  const shown = parts.filter(shows);
  if (shown.length === 0) return null;
  return (
    <p className={className} data-type-role={role}>
      {shown.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? ', ' : null}
          {part}
        </Fragment>
      ))}
    </p>
  );
}

/** A ruled list of labelled facts: a `dl` whose rows show only when they have a value. */
export function Facts({
  rows,
  className = 'kc-facts',
}: {
  readonly rows: ReadonlyArray<readonly [label: ReactNode, value: ReactNode, key: string]>;
  readonly className?: string;
}) {
  const shown = rows.filter(([, value]) => shows(value));
  if (shown.length === 0) return null;
  return (
    <dl className={className}>
      {shown.map(([label, value, key]) => (
        <div key={key} className="kc-facts__row">
          <dt data-type-role="label">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** An address as its own link text, without its scheme, a leading www., or a trailing slash. */
export function shortUrl(url: string): string {
  return url.replace(/^(?:https?:\/\/(?:www\.)?|mailto:|tel:)/i, '').replace(/\/$/, '');
}

/** A Link's text: its label, else its platform, else its address. */
export const linkText = (link: Link) =>
  [link.label, link.platform].find(present) ?? shortUrl(link.url);

/** A Link as an anchor. */
export function LinkTo({
  link,
  ctx,
  className,
}: {
  readonly link: Link;
  readonly ctx: RenderContext;
  readonly className?: string;
}) {
  return (
    <a className={className} href={hrefFor(link.url, ctx.input)} data-platform={link.platform}>
      {linkText(link)}
    </a>
  );
}

/** Links in a row, each its own item. */
export function LinkRow({
  links,
  ctx,
  className = 'kc-links',
}: {
  readonly links: readonly Link[] | undefined;
  readonly ctx: RenderContext;
  readonly className?: string;
}) {
  if (!links?.length) return null;
  return (
    <ul className={className} role="list">
      {links.map((link, index) => (
        <li key={index}>
          <LinkTo link={link} ctx={ctx} />
        </li>
      ))}
    </ul>
  );
}

/** The fixed label each kind of address takes, the kit's English. */
const URL_LABELS: Readonly<Record<string, string>> = {
  audioUrl: 'Listen',
  videoUrl: 'Watch',
  slidesUrl: 'Slides',
  pdfUrl: 'PDF',
};

/** Each field's label for what it opens, when the thing is named: "Listen to episode 24", "Watch the keynote". */
const URL_PHRASES: Readonly<Record<string, (subject: string) => string>> = {
  audioUrl: (subject) => `Listen to ${subject}`,
  videoUrl: (subject) => `Watch ${subject}`,
  slidesUrl: (subject) => `Slides for ${subject}`,
  pdfUrl: (subject) => `PDF of ${subject}`,
};

/**
 * Addresses the owner gave no label for, each under its field's fixed label,
 * naming what it opens when `subject` says, so three "Listen" links on a
 * page each say which (WCAG 2.4.4). Absent ones are left out.
 */
export function UrlRow({
  urls,
  ctx,
  subject,
}: {
  readonly urls: ReadonlyArray<readonly [field: string, url: string | undefined]>;
  readonly ctx: RenderContext;
  readonly subject?: string;
}) {
  const shown = urls.filter((entry): entry is readonly [string, string] => present(entry[1]));
  if (shown.length === 0) return null;
  return (
    <ul className="kc-links" role="list">
      {shown.map(([field, url]) => (
        <li key={field}>
          <a href={hrefFor(url, ctx.input)} data-field={field}>
            {subject !== undefined && URL_PHRASES[field] ? (
              <Ui ctx={ctx}>{URL_PHRASES[field]!(subject)}</Ui>
            ) : URL_LABELS[field] ? (
              <Ui ctx={ctx}>{URL_LABELS[field]!}</Ui>
            ) : (
              shortUrl(url)
            )}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** A number range written with a hyphen, such as 20-40, with the en dash it takes (T8). */
export const ranged = (text: string) => text.replace(/(\d)-(\d)/g, '$1\u2013$2');

/** Short items as a ruled list, each with its body dot. Blank ones are left out. */
export function RuledList({
  items,
  className = 'kc-ruled',
}: {
  readonly items: readonly string[] | undefined;
  readonly className?: string;
}) {
  const shown = items?.filter(present) ?? [];
  if (shown.length === 0) return null;
  return (
    <ul className={className}>
      {shown.map((item, index) => (
        <li key={index}>{ranged(item)}</li>
      ))}
    </ul>
  );
}

/**
 * A placement with Kinetic Cosmos's caption: the owner's caption, then where
 * and when it was taken as one phrase. The kit's placedMedia() joins those
 * with middle dots, which this composition never uses.
 */
// LOCAL: the kit's caption is a dotted meta line; this one is a comma phrase.
export function placedPhoto(
  placement: Placement | undefined,
  ctx: RenderContext,
): PlacedImage | undefined {
  if (!placement) return undefined;
  const captioned =
    present(placement.caption) || present(placement.location) || placement.takenAt !== undefined;
  return placedImage(
    placement,
    ctx.input,
    captioned ? (
      <>
        {present(placement.caption) ? (
          <span className="kc-caption__title">{placement.caption}</span>
        ) : null}
        <Phrase
          className="kc-caption__details"
          parts={[
            placement.location,
            placement.takenAt !== undefined && (
              <DateText key="taken" raw={placement.takenAt} ctx={ctx} field="takenAt" />
            ),
          ]}
        />
      </>
    ) : undefined,
  );
}
