import { Fragment, type ReactNode } from 'react';
import type { Link, Period, Section } from '@portfolio/schema';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { routeHref } from '@portfolio/variant-contract/runtime';
import { formatDate, parseLooseDate } from '../format';
import type { HeadingLevel } from './types';

// The pieces every shared renderer is built from. Styling is classes alone,
// under [data-variant] in styles.css: no inline style but an image's focal
// point (media.tsx), and no text made faint with opacity. Every text node is
// the owner's, formatted from the owner's data, a dated snapshot value, or
// one of the fixed labels (#10, slice 1, item 7): no default heading, no
// default link label, and no decoration around a number.

/** What a shared renderer passes its pieces. */
export interface RenderContext {
  readonly input: VariantRenderInput;
  /** The section's own heading level. */
  readonly level: HeadingLevel;
  /** The content's language: the section's, else the portfolio's. */
  readonly locale: string;
  /** The locale numbers and lists are formatted in: the content's when the runtime has it, else English. */
  readonly formatLocale: string;
  /** `en` when the content isn't English, for the words and dates the renderers add, such as Present. */
  readonly uiLang: 'en' | undefined;
  /**
   * The level of an item's heading: one below the section's heading, or the
   * section's own level when it has no title, so no level is skipped.
   */
  readonly itemLevel: HeadingLevel;
  /**
   * The addresses the section's entries show by their host (hostLabelled()),
   * so a row's link that shares a host with a sibling's reads apart from it.
   */
  readonly linkSiblings?: readonly string[];
}

/** Whether `text` has something to show: a string that isn't empty or only spaces. */
export function present(text: string | undefined | null): text is string {
  return typeof text === 'string' && text.trim() !== '';
}

const resolvedLocales = new Map<string, string>();

/**
 * The locale to format in for `locale`. A tag the runtime has no data for,
 * such as `tlh`, would otherwise format in the runtime's own default, which
 * changes from machine to machine.
 */
function formatLocaleFor(locale: string): string {
  let resolved = resolvedLocales.get(locale);
  if (resolved === undefined) {
    try {
      resolved = Intl.NumberFormat.supportedLocalesOf([locale])[0] ?? 'en';
    } catch {
      resolved = 'en';
    }
    resolvedLocales.set(locale, resolved);
  }
  return resolved;
}

export function renderContext(
  input: VariantRenderInput,
  section: Pick<Section, 'id' | 'lang' | 'title'>,
  level: HeadingLevel,
): RenderContext {
  const locale = section.lang ?? input.portfolio.locale;
  const language = locale.toLowerCase();
  const english = language === 'en' || language.startsWith('en-');
  return {
    input,
    level,
    locale,
    formatLocale: formatLocaleFor(locale),
    uiLang: english ? undefined : 'en',
    itemLevel: present(section.title) ? deeper(level) : level,
  };
}

const listFormats = new Map<string, Intl.ListFormat>();
const numberFormats = new Map<string, Intl.NumberFormat>();

/** Names joined the way the content's language joins them, such as "A, B, and C". */
export function formatNames(names: readonly string[], ctx: RenderContext): string {
  let format = listFormats.get(ctx.formatLocale);
  if (!format) {
    format = new Intl.ListFormat(ctx.formatLocale, { style: 'long', type: 'conjunction' });
    listFormats.set(ctx.formatLocale, format);
  }
  return format.format(names.filter(present));
}

/** A figure as the content's language writes it, such as 1,200. Text stays as written. */
export function formatFigure(value: string | number, ctx: RenderContext): string {
  if (typeof value !== 'number') return value;
  let format = numberFormats.get(ctx.formatLocale);
  if (!format) {
    format = new Intl.NumberFormat(ctx.formatLocale);
    numberFormats.set(ctx.formatLocale, format);
  }
  return format.format(value);
}

/** Whether a part of a line has something to show: blank text and false don't. */
function shows(part: ReactNode): boolean {
  if (part === null || part === undefined || part === false || part === true) return false;
  return typeof part !== 'string' || present(part);
}

/**
 * A line of short facts, such as a venue and a date, in order. Each part is
 * its own box, set apart by the layout's gap, never by a dot; a space
 * between them keeps them apart for assistive technology and in plain text.
 */
export function Meta({
  parts,
  className = 'pf-meta',
}: {
  parts: readonly ReactNode[];
  className?: string;
}) {
  const shown = parts.filter(shows);
  if (shown.length === 0) return null;
  return (
    <p className={className}>
      {shown.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? ' ' : null}
          <span className="pf-meta__part">{part}</span>
        </Fragment>
      ))}
    </p>
  );
}

const labelFormats = new Map<string, Intl.ListFormat>();

/**
 * Short labels joined as the content's language lists them in its narrowest
 * form: "A, B, C" in English and Russian, "A、B、C" in Chinese and Japanese,
 * and with the language's own word before the last where it has one, as
 * German and Korean do. Each label keeps its boundary: none run together.
 */
export function formatLabels(labels: readonly string[], ctx: RenderContext): string {
  let format = labelFormats.get(ctx.formatLocale);
  if (!format) {
    format = new Intl.ListFormat(ctx.formatLocale, { style: 'narrow', type: 'conjunction' });
    labelFormats.set(ctx.formatLocale, format);
  }
  return format.format(labels.filter(present));
}

/**
 * Short labels, such as a work's tags, folded into its meta line as one
 * part, the list as the content's language writes one, so a row of tags
 * reads as one fact beside the others, not as loose words. None when every
 * label is blank.
 */
export function labelParts(
  items: readonly string[] | undefined,
  field: string,
  ctx: RenderContext,
): ReactNode[] {
  const shown = (items ?? []).filter(present);
  if (shown.length === 0) return [];
  return [
    <span key={field} data-field={field}>
      {formatLabels(shown, ctx)}
    </span>,
  ];
}

/** One level below `level`, as deep as h6. */
export function deeper(level: HeadingLevel): HeadingLevel {
  return Math.min(level + 1, 6) as HeadingLevel;
}

export function Heading({
  level,
  className,
  lang,
  typeRole,
  children,
}: {
  level: HeadingLevel;
  className?: string;
  lang?: string;
  /** The type role it's set in, such as label for a quiet heading, when not its level's default. */
  typeRole?: string;
  children: ReactNode;
}) {
  const Tag = `h${level}` as const;
  return (
    <Tag className={className} lang={lang} data-type-role={typeRole}>
      {children}
    </Tag>
  );
}

/** An item's heading, a link when it has a URL, or nothing when its text is blank. */
export function ItemTitle({
  text,
  url,
  ctx,
  className = 'pf-item__title',
}: {
  text: string | undefined;
  url?: string;
  ctx: RenderContext;
  className?: string;
}) {
  if (!present(text)) return null;
  return (
    <Heading level={ctx.itemLevel} className={className}>
      <MaybeLink url={url} ctx={ctx}>
        {text}
      </MaybeLink>
    </Heading>
  );
}

/** Words the renderers add, marked English inside content that isn't. */
export function Ui({ ctx, children }: { ctx: RenderContext; children: string }) {
  return ctx.uiLang ? <span lang={ctx.uiLang}>{children}</span> : <>{children}</>;
}

/**
 * The section's heading and subtitle, as the owner wrote them. A section
 * without a title has no heading: no kind has a default one.
 */
export function SectionHeader({
  section,
  ctx,
}: {
  section: { readonly title?: string; readonly subtitle?: string };
  ctx: RenderContext;
}) {
  const title = present(section.title) ? section.title : undefined;
  const subtitle = present(section.subtitle) ? section.subtitle : undefined;
  if (title === undefined && subtitle === undefined) return null;
  return (
    <header className="pf-section__header">
      {title !== undefined ? (
        <Heading level={ctx.level} className="pf-section__title">
          {title}
        </Heading>
      ) : null}
      {subtitle !== undefined ? <p className="pf-section__subtitle">{subtitle}</p> : null}
    </header>
  );
}

/**
 * A URL as an href. A `#fragment` names a section on this page, and `/#id`
 * one on the home page, where the routes are mounted, keeping the render's
 * query, such as /sample's `variant`; either way the DOM id carries the
 * render's id prefix.
 */
export function hrefFor(url: string, input: VariantRenderInput): string {
  if (url.startsWith('#') && url.length > 1) return `#${input.ids.prefix}${url.slice(1)}`;
  if (url.startsWith('/#') && url.length > 2) {
    return `${routeHref(input, HOME)}#${input.ids.prefix}${url.slice(2)}`;
  }
  return url;
}

const HOME = { route: 'home' } as const;

/**
 * `url` as an href only when it's an https address, else undefined: for
 * links read from data a composition doesn't author, such as a GitHub
 * snapshot's, which names only GitHub's own pages.
 */
export function safeHref(url: string): string | undefined {
  try {
    return new URL(url).protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/** `text` with its percent-escapes decoded, or as written when they don't decode. */
function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * An address without its scheme, a leading www., or a trailing slash, its
 * escapes decoded: what a link shows when it names no host, such as a path
 * on this site.
 */
export function formatUrl(url: string): string {
  return decoded(url.replace(/^(?:https?:\/\/(?:www\.)?|mailto:|tel:)/i, '').replace(/\/$/, ''));
}

/**
 * An absolute address's host as written, before the URL parser turns an
 * internationalized one into punycode: bücher.de, not xn--bcher-kva.de.
 */
const WRITTEN_HOST = /^[a-z][\w+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^/:?#]+)/i;

/**
 * Where a link goes, as a link the owner gave no label for shows it: its
 * host as the owner wrote it, such as slides.example.com or 例え.jp,
 * without a leading www., or a mail or phone link's address. So its text
 * reads the same in any language, and is never a whole URL. The renderers
 * add no word of their own to name a link: the kit has no strings in the
 * content's language to name one with.
 */
export function hostLabel(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'mailto:' || parsed.protocol === 'tel:') {
      return decoded(parsed.pathname);
    }
    const host = WRITTEN_HOST.exec(url.trim())?.[1];
    if (parsed.hostname !== '' && host !== undefined) {
      return decoded(host)
        .replace(/^www\./i, '')
        .toLowerCase();
    }
  } catch {
    // Not an absolute URL, such as a path: shown as written, below.
  }
  return formatUrl(url);
}

/** A link's text: the owner's label, else its platform, else where it goes. */
export function linkLabel(link: Pick<Link, 'label' | 'platform' | 'url'>): string {
  return [link.label, link.platform].find(present) ?? hostLabel(link.url);
}

/** A link whose text is its label, else its platform, else its host. */
export function LinkText({
  link,
  ctx,
  className,
}: {
  link: Link;
  ctx: RenderContext;
  className?: string;
}) {
  return (
    <a className={className} href={hrefFor(link.url, ctx.input)} data-platform={link.platform}>
      {linkLabel(link)}
    </a>
  );
}

/**
 * What tells an address apart from another on its host, shortest first, as
 * what follows the host in its label: the last part of its path, then that
 * and its query, then its whole path and query, then those and its
 * fragment, then all of it with its port, each decoded. Never the scheme.
 * The bare root adds nothing.
 */
function distinguishing(url: string): readonly string[] {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean).map(decoded);
    const last = segments.at(-1) ?? '';
    const query = decoded(parsed.search);
    const parts = [
      `/${last}`,
      `/${last}${query}`,
      `/${segments.join('/')}${query}`,
      `/${segments.join('/')}${query}${decoded(parsed.hash)}`,
    ].map((part) => (part === '/' ? '' : part));
    return [...parts, `${parsed.port ? `:${parsed.port}` : ''}${parts[3]}`];
  } catch {
    return [];
  }
}

/**
 * The text of each link a row or a section shows by its host, so no two
 * that go to different places read the same. One alone on its host shows
 * the host. Links that share a host each add, as `host/part`, the shortest
 * part that tells them apart: the last part of the path, else that and the
 * query, else the whole path and query, else those and the fragment, else
 * all of it with the port (`host:8443/part`). The same address twice reads
 * the same, since it goes to the same place.
 */
export function distinctHostLabels(urls: readonly string[]): ReadonlyMap<string, string> {
  const groups = new Map<string, string[]>();
  for (const url of new Set(urls)) {
    const host = hostLabel(url);
    groups.set(host, [...(groups.get(host) ?? []), url]);
  }
  const labels = new Map<string, string>();
  for (const [host, group] of groups) {
    const parts = group.map(distinguishing);
    const levels = Math.max(0, ...parts.map((each) => each.length));
    let level = 0;
    while (
      group.length > 1 &&
      level < levels - 1 &&
      new Set(parts.map((each) => each[level] ?? '')).size < group.length
    ) {
      level++;
    }
    group.forEach((url, index) => {
      const part = group.length > 1 ? parts[index]![level] : undefined;
      labels.set(url, part ? `${host}${part}` : host);
    });
  }
  return labels;
}

/** One link in a row: the owner's, or an address a field holds, such as a talk's slidesUrl. */
type RowLink =
  | { readonly kind: 'link'; readonly link: Link }
  | { readonly kind: 'field'; readonly field: string; readonly url: string };

/** Whether a link shows its host: it has no label or platform of the owner's. */
const unlabelled = (link: Link) => ![link.label, link.platform].some(present);

/**
 * The addresses a work's or a record's row shows by their host, for
 * distinctHostLabels() across a section: its field links, and its own links
 * with no label or platform.
 */
export function hostLabelled(
  fields: ReadonlyArray<string | undefined>,
  links: readonly Link[] | undefined,
): string[] {
  return [...fields.filter(present), ...(links ?? []).filter(unlabelled).map(({ url }) => url)];
}

/**
 * A work's or a record's links as one row: the addresses its fields hold,
 * such as a talk's slides, then the owner's own links. A field's link shows
 * its host, as a link without a label does, and the field's name rides on
 * `data-field` for a composition that labels it. Links shown by their host
 * that share one, in this row or with the section's other entries
 * (`ctx.linkSiblings`), each add the part that tells them apart
 * (distinctHostLabels()). Absent ones are left out.
 */
export function LinkRow({
  fields = [],
  links,
  ctx,
}: {
  fields?: ReadonlyArray<readonly [field: string, url: string | undefined]>;
  links?: readonly Link[] | undefined;
  ctx: RenderContext;
}) {
  const row: RowLink[] = [
    ...fields
      .filter((entry): entry is readonly [string, string] => present(entry[1]))
      .map(([field, url]) => ({ kind: 'field' as const, field, url })),
    ...(links ?? []).map((link) => ({ kind: 'link' as const, link })),
  ];
  if (row.length === 0) return null;
  const hosts = distinctHostLabels([
    ...(ctx.linkSiblings ?? []),
    ...hostLabelled(
      row.flatMap((entry) => (entry.kind === 'field' ? [entry.url] : [])),
      links,
    ),
  ]);
  return (
    <ul className="pf-links" role="list">
      {row.map((entry, index) => (
        <li key={index}>
          {entry.kind === 'link' ? (
            <a href={hrefFor(entry.link.url, ctx.input)} data-platform={entry.link.platform}>
              {unlabelled(entry.link)
                ? (hosts.get(entry.link.url) ?? linkLabel(entry.link))
                : linkLabel(entry.link)}
            </a>
          ) : (
            <a href={hrefFor(entry.url, ctx.input)} data-field={entry.field}>
              {hosts.get(entry.url) ?? hostLabel(entry.url)}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The owner's links as a row. */
export function LinkList({
  links,
  ctx,
}: {
  links: readonly Link[] | undefined;
  ctx: RenderContext;
}) {
  return <LinkRow links={links} ctx={ctx} />;
}

/** A count of minutes as the content's language writes it, such as 8 min. */
export function formatMinutes(minutes: number, ctx: RenderContext): string {
  return new Intl.NumberFormat(ctx.formatLocale, {
    style: 'unit',
    unit: 'minute',
    unitDisplay: 'short',
    maximumFractionDigits: 0,
  }).format(minutes);
}

/** Text that links to `url` when there is one. */
export function MaybeLink({
  url,
  ctx,
  children,
}: {
  url: string | undefined;
  ctx: RenderContext;
  children: ReactNode;
}) {
  return url === undefined ? <>{children}</> : <a href={hrefFor(url, ctx.input)}>{children}</a>;
}

/** The lists styles.css keeps bullets on. Every other list drops them, so it says it's a list. */
const BULLETED = new Set(['pf-highlights', 'pf-short-list']);

/** Short labels, such as tags or technologies. Blank ones are left out. */
export function TagList({
  items,
  className = 'pf-tags',
}: {
  items: readonly string[] | undefined;
  className?: string;
}) {
  const shown = items?.filter(present) ?? [];
  if (shown.length === 0) return null;
  return (
    <ul className={className} role={BULLETED.has(className) ? undefined : 'list'}>
      {shown.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

/** A loose date's `<time datetime>` value, or none for present. */
function dateTimeOf(raw: string, ctx: RenderContext): string | undefined {
  const parsed = parseLooseDate(raw, ctx.input.env.now);
  if (!parsed || parsed.isPresent) return undefined;
  const pad = (value: number) => String(value).padStart(2, '0');
  if (parsed.month === undefined) return String(parsed.year);
  if (parsed.day === undefined) return `${parsed.year}-${pad(parsed.month + 1)}`;
  return `${parsed.year}-${pad(parsed.month + 1)}-${pad(parsed.day)}`;
}

/**
 * A loose date: `<time>` when it names a day, month, or year, else Present.
 * Month names are English, so the date is marked English inside content that
 * isn't. `field` names which date it is, such as filedAt, for a composition
 * that labels it; the shared renderers add no word of their own.
 */
export function DateText({ raw, ctx, field }: { raw: string; ctx: RenderContext; field?: string }) {
  const dateTime = dateTimeOf(raw, ctx);
  if (dateTime === undefined && parseLooseDate(raw, ctx.input.env.now)?.isPresent) {
    return (
      <span className="pf-date" data-field={field}>
        <Ui ctx={ctx}>Present</Ui>
      </span>
    );
  }
  return (
    <time className="pf-date" dateTime={dateTime} lang={ctx.uiLang} data-field={field}>
      {formatDate(raw)}
    </time>
  );
}

/** A date after a fixed label: As of, the one the shared renderers use. */
export function LabeledDate({
  label,
  raw,
  ctx,
}: {
  label: string;
  raw: string | undefined;
  ctx: RenderContext;
}) {
  if (raw === undefined) return null;
  return (
    <span className="pf-labeled-date">
      <Ui ctx={ctx}>{label}</Ui> <DateText raw={raw} ctx={ctx} />
    </span>
  );
}

/** A period, start to end. Without an end, it runs to the present. */
export function PeriodText({ period, ctx }: { period: Period | undefined; ctx: RenderContext }) {
  if (!period) return null;
  return (
    <span className="pf-period">
      <DateText raw={period.start} ctx={ctx} />
      {/* U+2013, the range separator. */}
      {'\u2013'}
      <DateText raw={period.end ?? 'present'} ctx={ctx} />
    </span>
  );
}
