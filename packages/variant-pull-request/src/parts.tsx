import type { ReactNode } from 'react';
import type { ChronologyEntry, Section } from '@portfolio/schema';
import {
  anchorSection,
  chronologyOf,
  evidenceOf,
  footerOutline,
  githubSnapshot,
  hrefFor,
  isRoutedWork,
  navigationModel,
  pageOutline,
  recordAnchor,
  sectionRenders,
  worksOf,
  type DestinationId,
  type FooterLink,
  type FooterOutline,
  type GroupingOptions,
  type NavigationModel,
  type PageOutline,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import {
  BASE_BRANCH,
  commitsByYear,
  diffStat,
  fileOf,
  headBranch,
  mergeTargetOf,
  panelOf,
  type DiffFile,
  type PanelId,
  type Segment,
} from './model';

// The pieces every part of the review page shares: the composition's own
// words, the author's login and avatar, the panels each section reads in,
// every work's file, and the counts the header, the tabs and the merge box
// show. Markup only; `reviewOf` is computed once a render.

/** `en` when the portfolio isn't English, for the words the composition adds. */
export function uiLangOf(input: Pick<VariantRenderInput, 'portfolio'>): 'en' | undefined {
  return /^en(?:-|$)/i.test(input.portfolio.locale) ? undefined : 'en';
}

/** The composition's own words, marked English in a portfolio that isn't. */
export function Words({ lang, children }: { lang: 'en' | undefined; children: ReactNode }) {
  return lang ? <span lang={lang}>{children}</span> : <>{children}</>;
}

/** Text only assistive tech reads. */
export function Sr({ children, lang }: { children: ReactNode; lang?: string }) {
  return (
    <span className="pr-sr" lang={lang}>
      {children}
    </span>
  );
}

/** A commit message's runs: the composition's verbs marked as its words, the owner's kept as written. */
export function Message({
  segments,
  lang,
}: {
  segments: readonly Segment[];
  lang: 'en' | undefined;
}) {
  return (
    <>
      {segments.map((segment, i) =>
        'ui' in segment ? (
          <Words key={i} lang={lang}>
            {segment.ui}
          </Words>
        ) : (
          <span key={i}>{segment.own}</span>
        ),
      )}
    </>
  );
}

/** A tick in a ring: a passing check. Decoration; its words say it passed. */
export function Tick() {
  return (
    <svg className="pr-tick" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="7" />
      <path d="M4.6 8.3l2.2 2.2 4.6-4.9" />
    </svg>
  );
}

/** The author's initials in a disc, beside their login. Decoration: the login names them. */
export function Avatar({ initials, you }: { initials: string; you?: boolean }) {
  return (
    <span className={you ? 'pr-av pr-av--you' : 'pr-av'} aria-hidden="true">
      {initials}
    </span>
  );
}

/** The author line a post or a note opens with: the avatar, the login, and what they did. */
export function Who({
  review,
  children,
}: {
  review: Pick<Review, 'login' | 'initials'>;
  children?: ReactNode;
}) {
  return (
    <>
      <Avatar initials={review.initials} />
      <b className="pr-who">{review.login}</b>
      {children ? <> {children}</> : null}
    </>
  );
}

/** Whether a URL leaves the site. */
export const external = (url: string) => /^https?:/i.test(url);

/** A link from the content, through hrefFor(). */
export function Link({
  url,
  input,
  className,
  children,
}: {
  url: string;
  input: VariantRenderInput;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a className={className} href={hrefFor(url, input)}>
      {children}
    </a>
  );
}

/** The composition's groups: About and the index are the conversation, the record splits in two. */
export type GroupId = 'about' | 'record' | 'checks' | 'work' | 'writing' | 'contact';

/** The navigation's grouping: one group a panel, the record's chronology as Commits and the rest as Checks. */
export const GROUPING: GroupingOptions<GroupId> = {
  groups: [
    { id: 'about', destination: 'about', label: { text: 'Conversation' } },
    { id: 'record', destination: 'record', label: { text: 'Commits' } },
    { id: 'checks', destination: 'record', label: { text: 'Checks' } },
    { id: 'work', destination: 'work', label: { text: 'Files changed' } },
    { id: 'writing', destination: 'writing', label: { text: 'Files changed' } },
    { id: 'contact', destination: 'contact', label: { text: 'Merge' } },
  ],
  groupOf: (section, context) =>
    context.destination === 'record' && section.kind !== 'chronology' ? 'checks' : undefined,
  unplaced: 'about',
};

/** A panel's name, and the destination it reads as. */
export const PANEL_LABELS: Readonly<
  Record<PanelId, { readonly label: string; readonly dest: string }>
> = {
  conversation: { label: 'Conversation', dest: 'About' },
  commits: { label: 'Commits', dest: 'Record' },
  checks: { label: 'Checks', dest: 'Evidence' },
  files: { label: 'Files changed', dest: 'Work and writing' },
  merge: { label: 'Merge', dest: 'Contact' },
};

/** Everything the page reads across its parts, once a render. */
export interface Review {
  readonly outline: PageOutline;
  readonly nav: NavigationModel<GroupId>;
  /** The sections that render, in reading order, each with its panel. */
  readonly sections: readonly { readonly section: Section; readonly panel: PanelId }[];
  /** Every work the page shows, once, as a file, in the order the page lists them. */
  readonly files: readonly DiffFile[];
  /** The works by id, for a file's link to its own page. */
  readonly routed: ReadonlyMap<string, string>;
  readonly stat: { readonly adds: number; readonly dels: number };
  readonly notes: number;
  readonly commits: number;
  /** Every commit the page shows, newest first, for the conversation's summary of them. */
  readonly latest: readonly ChronologyEntry[];
  readonly checks: number;
  readonly login: string;
  readonly initials: string;
  readonly head: string;
  readonly base: string;
  readonly footer: FooterOutline;
  readonly merge: FooterLink | undefined;
  /** The DOM ids the chrome's panels, tree and merge box take. Two hyphens: no content id has them. */
  readonly ids: {
    readonly panel: (panel: PanelId) => string;
    readonly tree: string;
    readonly live: string;
    readonly merged: string;
  };
}

/** The GitHub login: a github section's username, else a GitHub link's first path step. */
function loginOf(input: VariantRenderInput): string | undefined {
  for (const section of input.portfolio.sections)
    if (section.kind === 'github') return section.username;
  for (const link of input.portfolio.links) {
    const match = /^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)/i.exec(link.url);
    if (match) return match[1];
  }
  return undefined;
}

/** Up to two initials from the name, for the avatar. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = [...(words[0] ?? '')][0] ?? '';
  const last = words.length > 1 ? ([...words[words.length - 1]!][0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

const reviews = new WeakMap<object, Review>();

/** The review page's whole model for this render, computed once. */
export function reviewOf(input: VariantRenderInput): Review {
  const cached = reviews.get(input);
  if (cached) return cached;
  const outline = pageOutline(input);
  const nav = navigationModel(outline, { grouping: GROUPING });
  const destinationOf = (id: string): DestinationId | null => nav.placed.get(id) ?? null;
  const shown = input.portfolio.sections.filter((section) => sectionRenders(section, input));
  const sections = shown.map((section) => ({
    section,
    panel: panelOf(section, destinationOf(section.id)),
  }));
  const files: DiffFile[] = [];
  const seen = new Set<string>();
  let commits = 0;
  const entries: ChronologyEntry[] = [];
  let checks = 0;
  const counted = new Set<string>();
  for (const { section, panel } of sections) {
    if (section.kind === 'works') {
      for (const work of worksOf(section, input)) {
        if (seen.has(work.id)) continue;
        seen.add(work.id);
        files.push(fileOf(work, anchorSection(work, input)?.id ?? section.id));
      }
    } else if (section.kind === 'chronology' && panel === 'commits') {
      for (const entry of chronologyOf(section, input)) {
        if (counted.has(`c:${entry.id}`)) continue;
        counted.add(`c:${entry.id}`);
        commits += 1;
        entries.push(entry);
      }
    } else if (section.kind === 'evidence') {
      for (const entry of evidenceOf(section, input)) {
        if (counted.has(`e:${entry.id}`)) continue;
        counted.add(`e:${entry.id}`);
        checks += 1;
      }
    } else if (section.kind === 'github') {
      if (githubSnapshot(section, input)?.state === 'ready') checks += 1;
    }
  }
  const routed = new Map(
    outline.works.filter((work) => work.href !== undefined).map((work) => [work.id, work.href]),
  );
  const footer = footerOutline(input);
  const name = input.portfolio.identity.name;
  const login = loginOf(input);
  const prefix = input.ids.prefix;
  const review: Review = {
    outline,
    nav,
    sections,
    files,
    routed,
    stat: diffStat(files),
    notes: files.reduce(
      (total, file) =>
        total +
        [...file.lines, ...file.more].filter((line) => line.kind !== 'hunk' && line.note).length,
      0,
    ),
    commits,
    latest: commitsByYear(entries).flatMap((group) => group.entries),
    checks,
    login: login ?? name,
    initials: initialsOf(name),
    head: headBranch({ ...(login ? { github: login } : {}), name }),
    base: BASE_BRANCH,
    footer,
    merge: mergeTargetOf(footer),
    ids: {
      panel: (panel) => `${prefix}pr--${panel}`,
      tree: `${prefix}pr--tree`,
      live: `${prefix}pr--live`,
      merged: `${prefix}pr--merged`,
    },
  };
  reviews.set(input, review);
  return review;
}

/** Where a record lands: its anchor on home, else its own page for a work that has one. */
export function recordHref(
  input: VariantRenderInput,
  record: { readonly id: string },
  review: Review,
): string | undefined {
  const home = anchorSection(record, input);
  if (home) {
    const anchor = recordAnchor(home, record, input);
    if (anchor) return `${onHome(input) ? '' : review.outline.home}#${anchor}`;
  }
  return review.routed.get(record.id);
}

/** Whether the page is home, where a record's anchor is a bare fragment. */
export const onHome = (input: Pick<VariantRenderInput, 'route'>) => input.route.route === 'home';

/** Whether a work has its own page, for a file's path link. */
export const routes = isRoutedWork;
