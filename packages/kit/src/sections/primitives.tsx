import { Fragment, type ReactNode } from 'react';
import type { Link, Period, Section } from '@portfolio/schema';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
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
 * A line of short facts, such as a venue and a date, in order. The dots
 * between them are hidden from assistive technology, which hears the spaces.
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
          {index > 0 ? (
            <>
              {' '}
              <span className="pf-sep" aria-hidden="true">
                ·
              </span>{' '}
            </>
          ) : null}
          {part}
        </Fragment>
      ))}
    </p>
  );
}

/** One level below `level`, as deep as h6. */
export function deeper(level: HeadingLevel): HeadingLevel {
  return Math.min(level + 1, 6) as HeadingLevel;
}

export function Heading({
  level,
  className,
  lang,
  children,
}: {
  level: HeadingLevel;
  className?: string;
  lang?: string;
  children: ReactNode;
}) {
  const Tag = `h${level}` as const;
  return (
    <Tag className={className} lang={lang}>
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

/** A link whose text is its label, else its platform, else its URL. */
export function LinkText({
  link,
  ctx,
  className,
}: {
  link: Link;
  ctx: RenderContext;
  className?: string;
}) {
  const text = [link.label, link.platform].find(present) ?? link.url;
  return (
    <a className={className} href={hrefFor(link.url, ctx.input)} data-platform={link.platform}>
      {text}
    </a>
  );
}

export function LinkList({
  links,
  ctx,
}: {
  links: readonly Link[] | undefined;
  ctx: RenderContext;
}) {
  if (!links?.length) return null;
  return (
    <ul className="pf-links" role="list">
      {links.map((link, index) => (
        <li key={index}>
          <LinkText link={link} ctx={ctx} />
        </li>
      ))}
    </ul>
  );
}

/**
 * An address as its own link text, without its scheme, a leading www., or a
 * trailing slash: a link the owner gave no label for, such as a talk's
 * slides, shows where it goes, never a word the renderer makes up.
 */
export function formatUrl(url: string): string {
  return url.replace(/^(?:https?:\/\/(?:www\.)?|mailto:|tel:)/i, '').replace(/\/$/, '');
}

/** Links the owner gave no label for, each showing its own address. Absent ones are left out. */
export function UrlLinks({
  urls,
  ctx,
}: {
  urls: ReadonlyArray<readonly [field: string, url: string | undefined]>;
  ctx: RenderContext;
}) {
  const shown = urls.filter((entry): entry is readonly [string, string] => present(entry[1]));
  if (shown.length === 0) return null;
  return (
    <ul className="pf-links" role="list">
      {shown.map(([field, url]) => (
        <li key={field}>
          <a href={hrefFor(url, ctx.input)} data-field={field}>
            {formatUrl(url)}
          </a>
        </li>
      ))}
    </ul>
  );
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
