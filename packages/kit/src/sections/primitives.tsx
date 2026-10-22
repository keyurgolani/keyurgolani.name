import { Fragment, type ReactNode } from 'react';
import type { Image, Link, Period, Section } from '@portfolio/schema';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { formatDate, parseLooseDate } from '../format';
import type { HeadingLevel } from './types';

// The pieces every shared renderer is built from. Styling is classes alone,
// under [data-variant] in styles.css: no inline style, and no text made faint
// with opacity.

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
  /** Whether this is the first section, whose images load at once rather than lazily. */
  readonly eager: boolean;
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
  section: Pick<Section, 'id' | 'lang'>,
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
    eager: input.portfolio.sections[0]?.id === section.id,
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
  before,
}: {
  text: string | undefined;
  url?: string;
  ctx: RenderContext;
  className?: string;
  /** Shown ahead of the text, inside the heading, such as an episode number. */
  before?: ReactNode;
}) {
  if (!present(text)) return null;
  return (
    <Heading level={deeper(ctx.level)} className={className}>
      {before}
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
 * The section's heading and subtitle. A section without a title gets the
 * kind's default heading, if it has one.
 */
export function SectionHeader({
  section,
  ctx,
  fallback,
}: {
  section: Pick<Section, 'title' | 'subtitle'>;
  ctx: RenderContext;
  fallback?: string;
}) {
  const own = present(section.title);
  const title = own ? section.title : fallback;
  const subtitle = present(section.subtitle) ? section.subtitle : undefined;
  if (title === undefined && subtitle === undefined) return null;
  return (
    <header className="pf-section__header">
      {title !== undefined ? (
        <Heading
          level={ctx.level}
          className="pf-section__title"
          lang={own ? undefined : ctx.uiLang}
        >
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

/** A link the renderer names, such as Slides, with an optional detail after the name. */
export type NamedLinkEntry = readonly [label: string, url: string | undefined, detail?: string];

/** Links the renderer names, such as Slides and Video. Absent ones are left out. */
export function NamedLinks({
  links,
  ctx,
}: {
  links: readonly NamedLinkEntry[];
  ctx: RenderContext;
}) {
  const shown = links.filter(
    (link): link is readonly [string, string, string?] => link[1] !== undefined,
  );
  if (shown.length === 0) return null;
  return (
    <ul className="pf-named-links" role="list">
      {shown.map(([label, url, detail]) => (
        <li key={label}>
          <a className="pf-named-link" href={hrefFor(url, ctx.input)}>
            <Ui ctx={ctx}>{label}</Ui>
            {present(detail) ? <> {detail}</> : null}
          </a>
        </li>
      ))}
    </ul>
  );
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
 * isn't.
 */
export function DateText({ raw, ctx }: { raw: string; ctx: RenderContext }) {
  const dateTime = dateTimeOf(raw, ctx);
  if (dateTime === undefined && parseLooseDate(raw, ctx.input.env.now)?.isPresent) {
    return (
      <span className="pf-date">
        <Ui ctx={ctx}>Present</Ui>
      </span>
    );
  }
  return (
    <time className="pf-date" dateTime={dateTime} lang={ctx.uiLang}>
      {formatDate(raw)}
    </time>
  );
}

/** A date with words before it, such as Filed. */
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

/**
 * A content image. Its alt text is its own, and `alt: ''` marks decoration.
 * Without alt text, it's decorative only when the text beside it names what
 * it shows, such as a logo beside the organization's name; otherwise it takes
 * `fallbackAlt`, such as its caption, and with neither it has no alt at all,
 * so an accessibility audit finds it (#4's image.alt-missing warns too). The focal point goes on data attributes
 * for CSS that crops, because an inline object-position would be an inline
 * style. The first section's images load at once, and the rest lazily.
 */
export function ContentImage({
  image,
  ctx,
  className,
  caption,
  inline = false,
  decorative = false,
  fallbackAlt,
}: {
  image: Image;
  ctx: RenderContext;
  className?: string;
  caption?: ReactNode;
  /** A logo or avatar beside text: its credit follows it, with no figure. */
  inline?: boolean;
  /** The text beside it names what it shows. */
  decorative?: boolean;
  /** What it shows, in words, when it has no alt text of its own. */
  fallbackAlt?: string;
}) {
  // alt: '' is the owner saying it's decoration, so only a missing alt falls back.
  const alt =
    image.alt !== undefined
      ? image.alt.trim()
      : decorative
        ? ''
        : present(fallbackAlt)
          ? fallbackAlt.trim()
          : undefined;
  const img = (
    // eslint-disable-next-line @next/next/no-img-element -- owner-supplied URL; next/image would proxy it through /_next/image
    <img
      className={className}
      src={image.src}
      alt={alt}
      width={image.width}
      height={image.height}
      loading={ctx.eager ? 'eager' : 'lazy'}
      decoding="async"
      data-focal-x={image.focalPoint?.x}
      data-focal-y={image.focalPoint?.y}
    />
  );
  const credit = present(image.credit) ? <small className="pf-credit">{image.credit}</small> : null;
  if (inline) {
    return (
      <>
        {img}
        {credit}
      </>
    );
  }
  if (caption === undefined && credit === null) return img;
  return (
    <figure className="pf-figure">
      {img}
      <figcaption>
        {caption}
        {credit}
      </figcaption>
    </figure>
  );
}
