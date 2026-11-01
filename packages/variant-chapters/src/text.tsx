import type { ReactNode } from 'react';
import { hrefFor, present, RichText, safeHref } from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { dateTimeOf, longDate, moment } from './model/dates';
import { ANCHORS, type Book, type Chapter, type Locator, type SectionPlace } from './model/book';

// The small pieces every page is set from: dates, links, Markdown, and the
// book's own routes. Dates go in a <time> the stylesheet keeps on one line,
// so "18 September 2025" and "14-minute read" never break (C2).

export type Input = VariantRenderInput;

/** The chapter view, as the manifest declares it. */
export const CHAPTER_VIEW = {
  id: 'chapter',
  under: 'home',
  type: 'path',
  segment: 'chapters/{chapter}',
} as const;
/** The back matter view, as the manifest declares it. */
export const BACK_VIEW = {
  id: 'back-matter',
  under: 'home',
  type: 'path',
  segment: 'back-matter',
} as const;

/** An id on the page: the render's prefix and the anchor. */
export const idOf = (input: Input, key: string) => `${input.ids.prefix}${key}`;

export const homeHref = (input: Input, key?: string) =>
  `${routeHref(input, { route: 'home' })}${key ? `#${idOf(input, key)}` : ''}`;

export const chapterHref = (input: Input, chapter: Chapter, key?: string) =>
  `${routeHref(input, { route: 'view', view: CHAPTER_VIEW, params: { chapter: chapter.slug } })}${
    key ? `#${idOf(input, key)}` : ''
  }`;

export const backHref = (input: Input, key?: string) =>
  `${routeHref(input, { route: 'view', view: BACK_VIEW, params: {} })}${key ? `#${idOf(input, key)}` : ''}`;

/** Where a locator points: its chapter's page, or the back matter's. */
export const locatorHref = (input: Input, at: Locator) =>
  at.chapter ? chapterHref(input, at.chapter, at.key) : backHref(input, at.key);

/** Whether a place in the book is the page this render is. */
function isThisPage(input: Input, place: SectionPlace): boolean {
  const { route } = input;
  if (place === 'colophon') return true;
  if (place === 'home') return route.route === 'home';
  if (place === 'back') return route.route === 'view' && route.view.id === BACK_VIEW.id;
  return (
    route.route === 'view' &&
    route.view.id === CHAPTER_VIEW.id &&
    route.params.chapter === place.slug
  );
}

/**
 * Where a link the owner wrote lands in the book. A fragment that names a
 * section or a record goes to the page that holds it, since the book spreads
 * them over its views; anything else is the kit's hrefFor().
 */
export function bookHref(input: Input, book: Book, url: string): string {
  const fragment = /^\/?#(.+)$/.exec(url)?.[1];
  if (fragment === undefined) return hrefFor(url, input);
  const id = fragment.startsWith(input.ids.prefix)
    ? fragment.slice(input.ids.prefix.length)
    : fragment;
  const place = book.sectionAt.get(id);
  if (place !== undefined) {
    if (isThisPage(input, place)) return `#${idOf(input, id)}`;
    if (place === 'home' || place === 'colophon') return homeHref(input, id);
    if (place === 'back') return backHref(input, id);
    return chapterHref(input, place, id);
  }
  const at = book.printed.get(id);
  if (at) {
    const here = at.chapter ? isThisPage(input, at.chapter) : isThisPage(input, 'back');
    return here
      ? `#${idOf(input, id)}`
      : at.chapter
        ? chapterHref(input, at.chapter, id)
        : backHref(input, id);
  }
  return hrefFor(url, input);
}

/** A resolved href of the kit's (footerOutline's), through bookHref when it's a fragment on this page. */
export function bookLink(input: Input, book: Book, href: string): string {
  const base = routeHref(input, { route: 'home' }).split('?')[0]!;
  const match = new RegExp(
    `^(?:${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})?(?:\\?[^#]*)?#(.+)$`,
  ).exec(href);
  return match ? bookHref(input, book, `#${match[1]}`) : href;
}

/** The page a view is: home, a chapter, the back matter, or a case study. */
export type Here =
  | { readonly view: 'home' }
  | { readonly view: 'chapter'; readonly chapter: Chapter }
  | { readonly view: 'back' }
  | { readonly view: 'work'; readonly chapter: Chapter | undefined };

/** A loose date in a <time>, as the book prints it. */
export function When({ raw, input }: { raw: string | undefined; input: Input }) {
  const at = moment(raw, 'start', input.env.now);
  if (!at) return null;
  return (
    <time className="ch-date" dateTime={dateTimeOf(at)}>
      {longDate(at)}
    </time>
  );
}

/** Markdown from the content, inline or as paragraphs. */
export function Md({
  source,
  input,
  inline = false,
  className,
  role,
}: {
  source: string | undefined;
  input: Input;
  inline?: boolean;
  className?: string;
  role?: string;
}) {
  if (!present(source)) return null;
  return (
    <RichText source={source} inline={inline} className={className} typeRole={role} input={input} />
  );
}

/** A link to an address the owner wrote, or the text alone when it isn't a safe one. */
export function Out({
  url,
  input,
  children,
  className,
}: {
  url: string | undefined;
  input: Input;
  children: ReactNode;
  className?: string;
}) {
  const href =
    url === undefined ? undefined : url.startsWith('#') ? hrefFor(url, input) : safeHref(url);
  return href === undefined ? (
    <>{children}</>
  ) : (
    <a className={className} href={href}>
      {children}
    </a>
  );
}

/**
 * A quantity ("14 min", "3.2k") or a hyphenated name ("postmortem-template-kit"): the runs
 * Unbroken keeps on one line (C2), when they're short enough to fit any page's line.
 */
export const UNBROKEN =
  /(\d[\d.,]*\s?(?:min|ms|s|h|hrs?|days?|weeks?|years?|%|k|KB|MB|GB)(?![\w-])|[\w.]+(?:-[\w.]+)+)/;

/** The longest run kept whole: about a phone line at the compact size. A longer one breaks. */
export const UNBROKEN_MAX = 28;

/** Text whose quantities and hyphenated names never break across lines. */
export function Unbroken({ text }: { text: string }) {
  const parts = text.split(new RegExp(UNBROKEN.source, 'g'));
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 && part.length <= UNBROKEN_MAX ? (
          <span key={i} className="ch-nobreak">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** Parts of a line joined by ", ", each its own node. */
export function joined(parts: readonly ReactNode[], separator = ', '): ReactNode[] {
  const shown = parts.filter(
    (part) => part !== null && part !== undefined && part !== false && part !== '',
  );
  return shown.flatMap((part, i) => (i === 0 ? [part] : [separator, part]));
}

/**
 * A locator as the book cites it: "page 14", or with folios off (the `folios` control),
 * "chapter 3", and the back matter by name.
 */
export function cite(book: Book, at: Locator): string {
  if (book.options.folios) return `page ${at.page}`;
  return at.chapter ? `chapter ${at.chapter.n}` : 'the back matter';
}

/** The author's first name, for "Write to Anamika". */
export const firstName = (input: Input) =>
  input.portfolio.identity.name.trim().split(/\s+/)[0] ?? '';

/** The fore-edge's segments: the front matter, each chapter, the back matter. */
export interface Segment {
  readonly key: string;
  readonly n: string;
  readonly label: string;
  readonly sub: string;
  readonly href: string;
  readonly pages: number;
  readonly ink: number;
}

export function segments(book: Book, input: Input): Segment[] {
  return [
    {
      key: 'front',
      n: 'i',
      label: 'Front matter',
      sub: `Title page, contents and preface${book.options.folios ? '. Pages i to iv' : ''}`,
      href: homeHref(input),
      pages: 4,
      ink: 0,
    },
    ...book.chapters.map((chapter) => ({
      key: chapter.slug,
      n: String(chapter.n),
      label: `Chapter ${chapter.n}: ${chapter.title}`,
      sub: [
        chapter.years,
        book.options.folios ? `Pages ${chapter.firstPage} to ${chapter.lastPage}` : '',
      ]
        .filter(Boolean)
        .join('. '),
      href: chapterHref(input, chapter),
      pages: chapter.lastPage - chapter.firstPage + 1,
      ink: chapter.ink,
    })),
    {
      key: 'back',
      n: 'B',
      label: 'Back matter',
      sub: `About the author and the index${book.options.folios ? `. From page ${book.backStart}` : ''}`,
      href: backHref(input),
      pages: book.totalPages - book.backStart + 1,
      ink: 0,
    },
  ];
}

export { ANCHORS };

/** A section's own subtitle, where the book sets the section as one of its parts. */
export function Sub({
  section,
  className = 'gp__sub',
}: {
  section: { readonly subtitle?: string } | undefined;
  className?: string;
}) {
  const subtitle = section?.subtitle;
  return present(subtitle) ? (
    <p className={className} data-type-role="body-compact">
      {subtitle}
    </p>
  ) : null;
}

/**
 * Markdown as the words a reader sees, for a place that sets plain text (a link's own text, a
 * figure's sentence): a link is its label, and emphasis, code and heading marks go.
 */
export function plain(markdown: string | undefined): string {
  return (markdown ?? '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|`)(\S(?:.*?\S)?)\1/g, '$2')
    .replace(/^\s*#+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * An owner's words where the book sets a short line (the imprint's proof): plain words keep
 * their quantities and hyphenated names whole (Unbroken, C2); words with Markdown render as
 * Markdown, never as the marks typed.
 */
export function Words({ source, input }: { source: string; input: Input }) {
  return plain(source) === source.replace(/\s+/g, ' ').trim() ? (
    <Unbroken text={source} />
  ) : (
    <Md source={source} input={input} inline />
  );
}

/** The id of the colophon's note on where the title came from, which names the thesis's article. */
export const TITLE_FROM = 'ch--title-from';

/** Where the book's title came from: the thesis's section title, when the title is the thesis. */
export function titleFrom(input: Input, book: Book): string | undefined {
  const thesis = book.front.thesisSection;
  return thesis && present(thesis.title) && present(input.portfolio.practice?.thesis)
    ? thesis.title
    : undefined;
}

/**
 * An entry's compact prose (P2-11): one paragraph of plain words keeps its quantities and
 * hyphenated names whole, in the same rich-text block Md sets; anything with Markdown, or more
 * than one paragraph, is Md's.
 */
export function Prose({
  source,
  input,
  className,
  role,
}: {
  source: string | undefined;
  input: Input;
  className?: string;
  role?: string;
}) {
  if (!present(source)) return null;
  const flat = source.replace(/\s+/g, ' ').trim();
  if (/\n\s*\n/.test(source) || plain(source) !== flat) {
    return <Md source={source} input={input} className={className} role={role} />;
  }
  return (
    <div className={className ? `pf-rich-text ${className}` : 'pf-rich-text'} data-type-role={role}>
      <p>
        <Unbroken text={flat} />
      </p>
    </div>
  );
}
