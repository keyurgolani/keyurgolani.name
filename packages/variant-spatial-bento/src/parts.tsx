import { Fragment, type ReactNode } from 'react';
import type { Link, Placement } from '@portfolio/schema';
import {
  DateText,
  Heading,
  hrefFor,
  placedImage,
  present,
  Ui,
  type HeadingLevel,
  type PlacedImage,
  type RenderContext,
} from '@portfolio/kit/sections';

/**
 * A placement's image with its caption in this composition's one caption
 * system: the owner's caption, then when and where it was taken and its
 * tags, as a comma-set line. None when the asset isn't an image the view holds.
 */
export function placed(
  placement: Placement | undefined,
  ctx: RenderContext,
): PlacedImage | undefined {
  if (!placement) return undefined;
  const parts = [
    placement.takenAt !== undefined ? (
      <DateText key="taken" raw={placement.takenAt} ctx={ctx} field="takenAt" />
    ) : null,
    present(placement.location) ? placement.location : null,
    ...(placement.tags ?? []).filter(present),
  ].filter((part) => part !== null);
  const caption =
    present(placement.caption) || parts.length > 0 ? (
      <>
        {present(placement.caption) ? <p className="pf-caption">{placement.caption}</p> : null}
        <Facts className="sb-caption__facts" parts={parts} />
      </>
    ) : undefined;
  return placedImage(placement, ctx.input, caption);
}

// The pieces Spatial Bento's tiles are built from: a tile's head, a quiet
// line of facts, a button, and a link that says it leaves the page. Every
// word is the owner's or one of the kit's fixed labels; the separators
// between facts are commas, never a dot or a dash.

/** A tile's head: the section's title and subtitle, as the owner wrote them, with anything set beside the title. */
export function TileHead({
  title,
  subtitle,
  level,
  id,
  aside,
  hidden = false,
}: {
  readonly title?: string;
  readonly subtitle?: string;
  readonly level: HeadingLevel;
  readonly id?: string;
  readonly aside?: ReactNode;
  /** The title for assistive technology alone, where the tile's own shape says what it is. */
  readonly hidden?: boolean;
}) {
  const shown = present(title) ? title : undefined;
  const sub = present(subtitle) ? subtitle : undefined;
  if (shown === undefined && sub === undefined && aside === undefined) return null;
  return (
    <div className="sb-tile__head" data-hidden={hidden ? '' : undefined}>
      {shown !== undefined ? (
        <Heading level={level} className={hidden ? 'sb-hidden' : 'sb-title'}>
          <span id={id}>{shown}</span>
        </Heading>
      ) : null}
      {aside}
      {sub !== undefined && !hidden ? <p className="sb-tile__sub">{sub}</p> : null}
    </div>
  );
}

/** A line of short facts, set apart by commas, as a sentence lists them. Blank parts are left out. */
export function Facts({
  parts,
  className = 'sb-facts-line',
}: {
  readonly parts: readonly ReactNode[];
  readonly className?: string;
}) {
  const shown = parts.filter(
    (part) =>
      part !== null &&
      part !== undefined &&
      part !== false &&
      part !== true &&
      (typeof part !== 'string' || present(part)),
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

/** Whether a URL leaves the site: an absolute http or https address. */
export const outbound = (url: string) => /^https?:\/\//i.test(url);

/** A link, marked when it leaves the site. */
export function Out({
  url,
  ctx,
  children,
  className,
}: {
  readonly url: string;
  readonly ctx: RenderContext;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <a
      className={className}
      href={hrefFor(url, ctx.input)}
      data-outbound={outbound(url) ? '' : undefined}
    >
      {children}
    </a>
  );
}

/** A link's own words: its label, else its platform, else its address. */
export const linkWords = (link: Link) =>
  [link.label, link.platform].find(present) ?? formatAddress(link.url);

/** An address as link text: without its scheme, a leading www., or a trailing slash. */
export function formatAddress(url: string): string {
  return url.replace(/^(?:https?:\/\/(?:www\.)?|mailto:|tel:)/i, '').replace(/\/$/, '');
}

/** Hosts where a profile's path is the handle: github.com/anamika reads as anamika. */
const PROFILE_HOSTS = new Set([
  'github.com',
  'gitlab.com',
  'linkedin.com',
  'x.com',
  'twitter.com',
  'instagram.com',
  'bsky.app',
  'medium.com',
  'dribbble.com',
  'behance.net',
  'youtube.com',
  'codeberg.org',
]);

/**
 * An address as short as it can be and still say where it goes: a document
 * as its kind (PDF), a profile as its handle, a Mastodon-style @user as
 * user@host, else the address without its scheme.
 */
export function handleOf(url: string): string {
  if (/\.pdf(?:$|[?#])/i.test(url)) return 'PDF';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return formatAddress(url);
  }
  if (!/^https?:$/.test(parsed.protocol)) return formatAddress(url);
  const host = parsed.host.replace(/^www\./i, '');
  const path = parsed.pathname.replace(/^\/+|\/+$/g, '');
  if (path === '') return host;
  const profile = PROFILE_HOSTS.has(host.toLowerCase());
  // A query or a fragment means a page, not a profile: show where it goes.
  if (parsed.search !== '' || parsed.hash !== '') return formatAddress(url);
  if (!profile && /^@[^/]+$/.test(path)) return `${path}@${host}`;
  if (profile && path.split('/').length <= 2) return path;
  return formatAddress(url);
}

/** A link styled as a button: `strong` on a plain tile, `ghost` beside it. */
export function Button({
  url,
  ctx,
  tone,
  children,
}: {
  readonly url: string;
  readonly ctx: RenderContext;
  readonly tone: 'strong' | 'ghost';
  readonly children: ReactNode;
}) {
  return (
    <Out url={url} ctx={ctx} className={`sb-btn sb-btn--${tone}`}>
      {children}
    </Out>
  );
}

/** Links in a row, each its own words. */
export function LinkRow({
  links,
  ctx,
}: {
  readonly links: readonly Link[] | undefined;
  readonly ctx: RenderContext;
}) {
  if (!links?.length) return null;
  return (
    <ul className="sb-links" role="list">
      {links.map((link, index) => (
        <li key={index}>
          <Out url={link.url} ctx={ctx}>
            {linkWords(link)}
          </Out>
        </li>
      ))}
    </ul>
  );
}

/**
 * Addresses the owner gave no label for, each named by what it is (slides,
 * a video, the paper's PDF) in the composition's words, not its raw URL.
 */
export function AddressRow({
  items,
  ctx,
}: {
  readonly items: readonly (readonly [url: string | undefined, words: string])[];
  readonly ctx: RenderContext;
}) {
  const shown = items.filter((item): item is readonly [string, string] => present(item[0]));
  if (shown.length === 0) return null;
  return (
    <ul className="sb-links" role="list">
      {shown.map(([url, words]) => (
        <li key={url}>
          <Out url={url} ctx={ctx}>
            <Words ctx={ctx}>{words}</Words>
          </Out>
        </li>
      ))}
    </ul>
  );
}

/** A live dot: a status mark beside a dated or current line. Decoration. */
export function Dot() {
  return <span className="sb-dot" aria-hidden="true" />;
}

/** Words the composition adds, marked English in content that isn't. */
export function Words({
  ctx,
  children,
}: {
  readonly ctx: RenderContext;
  readonly children: string;
}) {
  return <Ui ctx={ctx}>{children}</Ui>;
}
