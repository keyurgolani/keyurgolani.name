import { Fragment, type ReactNode } from 'react';
import type { Image, Link, Period, Section } from '@portfolio/schema';
import type { VariantRenderInput } from '@portfolio/variant-contract';
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
  /** `en` when the content isn't English, for the few words the renderers add, such as Present. */
  readonly uiLang: 'en' | undefined;
}

export function renderContext(
  input: VariantRenderInput,
  section: Pick<Section, 'lang'>,
  level: HeadingLevel,
): RenderContext {
  const locale = section.lang ?? input.portfolio.locale;
  const language = locale.toLowerCase();
  const english = language === 'en' || language.startsWith('en-');
  return { input, level, locale, uiLang: english ? undefined : 'en' };
}

/** Names joined the way the content's language joins them, such as "A, B, and C". */
export function formatNames(names: readonly string[], ctx: RenderContext): string {
  return new Intl.ListFormat(ctx.locale, { style: 'long', type: 'conjunction' }).format(names);
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
  const shown = parts.filter((part) => part !== null && part !== undefined && part !== false);
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
  const title = section.title ?? fallback;
  if (title === undefined && section.subtitle === undefined) return null;
  return (
    <header className="pf-section__header">
      {title !== undefined ? (
        <Heading
          level={ctx.level}
          className="pf-section__title"
          lang={section.title === undefined ? ctx.uiLang : undefined}
        >
          {title}
        </Heading>
      ) : null}
      {section.subtitle !== undefined ? (
        <p className="pf-section__subtitle">{section.subtitle}</p>
      ) : null}
    </header>
  );
}

/**
 * A URL as an href. A `#fragment` names a section, whose DOM id carries the
 * render's id prefix.
 */
export function hrefFor(url: string, input: VariantRenderInput): string {
  return url.startsWith('#') && url.length > 1 ? `#${input.ids.prefix}${url.slice(1)}` : url;
}

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
  return (
    <a className={className} href={hrefFor(link.url, ctx.input)} data-platform={link.platform}>
      {link.label ?? link.platform ?? link.url}
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
    <ul className="pf-links">
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
    <ul className="pf-named-links">
      {shown.map(([label, url, detail]) => (
        <li key={label}>
          <a className="pf-named-link" href={hrefFor(url, ctx.input)}>
            <Ui ctx={ctx}>{label}</Ui>
            {detail !== undefined ? <> {detail}</> : null}
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

/** Short labels, such as tags or technologies. */
export function TagList({
  items,
  className = 'pf-tags',
}: {
  items: readonly string[] | undefined;
  className?: string;
}) {
  if (!items?.length) return null;
  return (
    <ul className={className}>
      {items.map((item, index) => (
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

/** A loose date: `<time>` when it names a day, month, or year, else Present. */
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
    <time className="pf-date" dateTime={dateTime}>
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
 * A content image. Without alt text it's decorative, since the text beside it
 * names what it shows. The focal point goes on data attributes for CSS that
 * crops, because an inline object-position would be an inline style.
 */
export function ContentImage({
  image,
  className,
  caption,
  inline = false,
}: {
  image: Image;
  className?: string;
  caption?: ReactNode;
  /** A logo or avatar beside text: its credit follows it, with no figure. */
  inline?: boolean;
}) {
  const img = (
    // eslint-disable-next-line @next/next/no-img-element -- owner-supplied URL; next/image would proxy it through /_next/image
    <img
      className={className}
      src={image.src}
      alt={image.alt ?? ''}
      width={image.width}
      height={image.height}
      loading="lazy"
      decoding="async"
      data-focal-x={image.focalPoint?.x}
      data-focal-y={image.focalPoint?.y}
    />
  );
  const credit =
    image.credit !== undefined ? <small className="pf-credit">{image.credit}</small> : null;
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
