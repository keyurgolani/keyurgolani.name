import type { ChronologyEntry, Evidence, Section, Work } from '@portfolio/schema';
import type { DestinationId, FooterLink, FooterOutline } from '@portfolio/kit/sections';

// Pull Request's model (issue #270): the review page's pieces, pure and
// from the content alone, so the server, a preview frame, and a browser
// render compute the same hashes, diffs, and counts.
//
// The metaphor's furniture is the composition's own: the base branch, the
// head branch's `/join`, the file paths, the commit verbs, and the hunk
// headers. Every other word on the page is the owner's.

/** The branch the change merges into: the reader's team. */
export const BASE_BRANCH = 'your-team/main';

/** The page's tab panels, in reading order, and the merge box beside them. */
export const PANELS = ['conversation', 'commits', 'checks', 'files'] as const;
export type PanelId = (typeof PANELS)[number] | 'merge';

/**
 * A stable short hash of a record's id, as a commit's: FNV-1a over its
 * UTF-16 code units, its first seven hex digits. The same id gives the same
 * hash on every render and every visit.
 */
export function hashOf(id: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').slice(0, 7);
}

/** A run of words in a changed line, and whether the change touched it. */
export interface Token {
  readonly text: string;
  readonly changed: boolean;
}

/** Markdown's own marks: a line holding one is never split into words. */
const MARKUP = /[*_`[\]<>#|\\]/;

/**
 * The words two lines change (an LCS over words, case-insensitive), as runs
 * on each side, or null when the lines share under a third of their words
 * (a Dice coefficient), as a review shows two different lines whole, or
 * when either holds Markdown, whose marks a split would break.
 */
export function wordDiff(
  before: string,
  after: string,
): { readonly before: readonly Token[]; readonly after: readonly Token[] } | null {
  if (MARKUP.test(before) || MARKUP.test(after)) return null;
  const a = before.trim().split(/\s+/).filter(Boolean);
  const b = after.trim().split(/\s+/).filter(Boolean);
  if (a.length === 0 || b.length === 0) return null;
  const n = a.length;
  const m = b.length;
  // The words' LCS lengths, from the end, in one flat array.
  const lcs = new Uint16Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => lcs[i * (m + 1) + j]!;
  const same = (i: number, j: number) => a[i]!.toLowerCase() === b[j]!.toLowerCase();
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i * (m + 1) + j] = same(i, j)
        ? at(i + 1, j + 1) + 1
        : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  if ((2 * at(0, 0)) / (n + m) < 1 / 3) return null;
  const left: [string, boolean][] = [];
  const right: [string, boolean][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (same(i, j)) {
      left.push([a[i]!, false]);
      right.push([b[j]!, false]);
      i += 1;
      j += 1;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      left.push([a[i]!, true]);
      i += 1;
    } else {
      right.push([b[j]!, true]);
      j += 1;
    }
  }
  for (; i < n; i += 1) left.push([a[i]!, true]);
  for (; j < m; j += 1) right.push([b[j]!, true]);
  const runs = (words: [string, boolean][]): Token[] =>
    words.reduce<Token[]>((out, [text, changed]) => {
      const last = out[out.length - 1];
      if (last && last.changed === changed)
        out[out.length - 1] = { text: `${last.text} ${text}`, changed };
      else out.push({ text, changed });
      return out;
    }, []);
  return { before: runs(left), after: runs(right) };
}

/** Markdown reduced to its words, for a line that's matched or measured, never shown. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A run of a commit message: the composition's words (`ui`), or the owner's (`own`). */
export type Segment = { readonly ui: string } | { readonly own: string };

const present = (text: string | undefined): text is string =>
  typeof text === 'string' && text.trim() !== '';

/**
 * A chronology record's commit message, built from its kind: a role is
 * "Join <organization> as <title>", a study "Study <title> at
 * <organization>", a project "Build <title>", and an event or a milestone
 * "Add <title> (<organization>)". The verbs and joiners are the
 * composition's; the title and organization are the owner's, whole.
 */
export function commitMessage(
  entry: Pick<ChronologyEntry, 'kind' | 'title' | 'organization'>,
): Segment[] {
  const title = { own: entry.title };
  const org = present(entry.organization) ? { own: entry.organization } : undefined;
  switch (entry.kind) {
    case 'role':
      return org ? [{ ui: 'Join ' }, org, { ui: ' as ' }, title] : [{ ui: 'Join as ' }, title];
    case 'study':
      return org ? [{ ui: 'Study ' }, title, { ui: ' at ' }, org] : [{ ui: 'Study ' }, title];
    case 'project':
      return org ? [{ ui: 'Build ' }, title, { ui: ' at ' }, org] : [{ ui: 'Build ' }, title];
    default:
      return org
        ? [{ ui: 'Add ' }, title, { ui: ' (' }, org, { ui: ')' }]
        : [{ ui: 'Add ' }, title];
  }
}

/** A loose date's sort key: a year alone sorts before that year's months. */
const sortKey = (start: string) => (/^\d{4}$/.test(start) ? `${start}-00` : start);

/**
 * The commits, newest first by the date each starts, grouped by its year.
 * Records that start in the same month keep the owner's order.
 */
export function commitsByYear<T extends Pick<ChronologyEntry, 'period'>>(
  entries: readonly T[],
): { readonly year: string; readonly entries: readonly T[] }[] {
  const sorted = entries
    .map((entry, order) => ({ entry, order, key: sortKey(String(entry.period.start)) }))
    .sort((x, y) => (x.key < y.key ? 1 : x.key > y.key ? -1 : x.order - y.order));
  const groups: { year: string; entries: T[] }[] = [];
  for (const { entry, key } of sorted) {
    const year = key.slice(0, 4);
    const group = groups[groups.length - 1];
    if (group && group.year === year) group.entries.push(entry);
    else groups.push({ year, entries: [entry] });
  }
  return groups;
}

/** A path segment from the owner's words: lower case, runs of anything else a hyphen. */
export function segmentOf(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'x'
  );
}

/** The head branch: the GitHub login, else the name, joining the reader's team. */
export function headBranch({ github, name }: { github?: string; name: string }): string {
  return `${present(github) ? github.trim() : segmentOf(name)}/join`;
}

/** A note pinned under a line: the author's notes on it, or a decision's Why. */
export interface Note {
  readonly kind: 'note' | 'why';
  readonly items: readonly string[];
  /** Whether the items are Markdown, as a rationale is, or plain text, as highlights are. */
  readonly markdown?: boolean;
}

/** A diff's line: a hunk header, or a line of context, an addition, or a removal. */
export type DiffLine =
  | { readonly kind: 'hunk'; readonly label: string }
  | {
      readonly kind: 'ctx' | 'add' | 'del';
      /** The record field it shows, such as `summary` or `caseStudy.challenge`. */
      readonly field: string;
      readonly text: string;
      /** Whether the text is Markdown, rendered through RichText. */
      readonly markdown?: boolean;
      /** The line's label, a trailer such as `Tools:`, in the composition's words. */
      readonly label?: string;
      /** A heading line, `# title`. */
      readonly heading?: boolean;
      readonly href?: string;
      /** Its number on the old side (context and removals) and the new (context and additions). */
      readonly old?: number;
      readonly new?: number;
      /** The words it changes against the line it pairs with, when they're alike. */
      readonly tokens?: readonly Token[];
      readonly note?: Note;
    };

type TextLine = Extract<DiffLine, { kind: 'ctx' | 'add' | 'del' }>;

/** A work as a changed file. */
export interface DiffFile {
  readonly id: string;
  readonly path: string;
  readonly dir: string;
  readonly name: string;
  /** Modified when the work has a before and an after, added when it has only an after. */
  readonly status: 'modified' | 'added';
  /** What shows at once. */
  readonly lines: readonly DiffLine[];
  /** What Expand opens: the rest of the work, and its case study. */
  readonly more: readonly DiffLine[];
  readonly moreLabel: 'case study' | 'details';
  readonly adds: number;
  readonly dels: number;
}

/** A Markdown field's paragraphs, each its own line, blank ones dropped. */
const paragraphs = (markdown: string | undefined): string[] =>
  present(markdown)
    ? markdown
        .split(/\n\s*\n/)
        .map((block) => block.trim())
        .filter(Boolean)
    : [];

const CASE_LABELS: Readonly<Record<string, string>> = {
  challenge: 'Challenge',
  context: 'Context',
  role: 'Role',
  constraints: 'Constraints',
  evidence: 'Evidence',
  outcomes: 'Outcomes',
  reflection: 'Reflection',
};

/**
 * A work as a file in the change. Its path is `works/<organization>/<slug>.md`,
 * or under the section's id when it names no organization, and writing and
 * research go under `writing/`.
 *
 * A work with both a case study's challenge and its outcomes is a changed
 * file, read as its before and its after: the challenge's paragraphs in
 * red, the outcomes' in green, the highlights pinned as the author's notes
 * to the last green line. Any other work is a new file, every line added,
 * its highlights pinned to its summary. Expanding opens the rest: the
 * description, the trailers (role, organization, tools and the rest), and
 * the case study, each decision its own hunk, the alternatives it turned
 * down in red, the decision in green, and its rationale pinned as the Why.
 */
export function fileOf(work: Work, sectionId?: string): DiffFile {
  const slug = work.slug ?? work.id;
  const writing = work.medium === 'writing' || work.medium === 'research';
  const dir = writing
    ? 'writing'
    : `works/${present(work.organization) ? segmentOf(work.organization) : (sectionId ?? 'work')}`;
  const study = work.caseStudy;
  const modified = present(study?.challenge) && present(study?.outcomes);
  const fresh: 'add' | 'ctx' = modified ? 'ctx' : 'add';
  const highlights = (work.highlights ?? []).filter(present);
  const shown: DiffLine[] = [];
  const push = (into: DiffLine[], line: DiffLine) => into.push(line);

  push(shown, { kind: fresh, field: 'title', text: work.title, heading: true });
  const summary = paragraphs(work.summary);
  summary.forEach((text, i) =>
    push(shown, {
      kind: fresh,
      field: 'summary',
      text,
      markdown: true,
      ...(!modified && i === summary.length - 1 && highlights.length > 0
        ? { note: { kind: 'note', items: highlights } }
        : {}),
    }),
  );
  if (!modified && summary.length === 0 && highlights.length > 0) {
    // With no summary, the notes pin to the title.
    const title = shown[0] as TextLine;
    shown[0] = { ...title, note: { kind: 'note', items: highlights } };
  }
  if (modified) {
    push(shown, { kind: 'hunk', label: 'Challenge → Outcomes' });
    const before = paragraphs(study!.challenge);
    const after = paragraphs(study!.outcomes);
    const diff = before.length === 1 && after.length === 1 ? wordDiff(before[0]!, after[0]!) : null;
    before.forEach((text) =>
      push(shown, {
        kind: 'del',
        field: 'caseStudy.challenge',
        text,
        markdown: true,
        ...(diff ? { tokens: diff.before } : {}),
      }),
    );
    after.forEach((text, i) =>
      push(shown, {
        kind: 'add',
        field: 'caseStudy.outcomes',
        text,
        markdown: true,
        ...(diff ? { tokens: diff.after } : {}),
        ...(i === after.length - 1 && highlights.length > 0
          ? { note: { kind: 'note', items: highlights } }
          : {}),
      }),
    );
  }

  const more: DiffLine[] = [];
  const trailer = (field: string, label: string, text: string | undefined, href?: string) => {
    if (present(text)) push(more, { kind: fresh, field, label, text, ...(href ? { href } : {}) });
  };
  const list = (items: readonly string[] | undefined) =>
    items && items.filter(present).length > 0 ? items.filter(present).join(', ') : undefined;
  for (const text of paragraphs(work.description))
    push(more, { kind: fresh, field: 'description', text, markdown: true });
  trailer('role', 'Role:', work.role);
  trailer('organization', 'Organization:', work.organization);
  trailer('tools', 'Tools:', list(work.tools));
  trailer('tags', 'Tags:', list(work.tags));
  trailer('publication', 'Publication:', work.publication);
  for (const text of paragraphs(work.excerpt))
    push(more, { kind: fresh, field: 'excerpt', text, markdown: true });
  trailer('artist', 'Artist:', work.artist);
  trailer('label', 'Label:', work.label);
  trailer('series', 'Series:', work.series);
  trailer('guests', 'Guests:', list(work.guests));
  for (const track of work.tracks ?? []) trailer('tracks.title', 'Track:', track.title, track.url);
  for (const text of paragraphs(work.showNotes))
    push(more, { kind: fresh, field: 'showNotes', text, markdown: true });
  for (const link of work.links ?? [])
    trailer('links', 'Link:', link.label ?? link.platform ?? link.url, link.url);
  if (present(work.url) && !(work.links ?? []).some((link) => link.url === work.url))
    trailer('url', 'Source:', work.url, work.url);

  if (study) {
    const part = (key: string) => {
      const blocks = paragraphs((study as Record<string, string | undefined>)[key]);
      if (blocks.length === 0) return;
      push(more, { kind: 'hunk', label: CASE_LABELS[key]! });
      for (const text of blocks)
        push(more, { kind: 'ctx', field: `caseStudy.${key}`, text, markdown: true });
    };
    if (!modified) part('challenge');
    part('context');
    part('role');
    part('constraints');
    const decisions = study.decisions ?? [];
    decisions.forEach((decision, i) => {
      push(more, {
        kind: 'hunk',
        label: `Decision ${i + 1} of ${decisions.length}`,
      });
      const alternatives = paragraphs(decision.alternatives);
      const diff = alternatives.length === 1 ? wordDiff(alternatives[0]!, decision.decision) : null;
      for (const text of alternatives)
        push(more, {
          kind: 'del',
          field: 'caseStudy.decisions.alternatives',
          text,
          markdown: true,
          ...(diff ? { tokens: diff.before } : {}),
        });
      push(more, {
        kind: 'add',
        field: 'caseStudy.decisions.decision',
        text: decision.decision,
        markdown: true,
        ...(diff ? { tokens: diff.after } : {}),
        ...(present(decision.rationale)
          ? { note: { kind: 'why', items: [decision.rationale], markdown: true } }
          : {}),
      });
    });
    part('evidence');
    if (!modified) part('outcomes');
    part('reflection');
  }

  // Number the lines: the old side counts context and removals, the new context and additions.
  let old = 0;
  let next = 0;
  let adds = 0;
  let dels = 0;
  const numbered = (line: DiffLine): DiffLine => {
    if (line.kind === 'hunk') return line;
    if (line.kind === 'ctx') return { ...line, old: (old += 1), new: (next += 1) };
    if (line.kind === 'del') {
      dels += 1;
      return { ...line, old: (old += 1) };
    }
    adds += 1;
    return { ...line, new: (next += 1) };
  };
  const numberedLines = shown.map(numbered);
  const numberedMore = more.map(numbered);
  return {
    id: work.id,
    path: `${dir}/${segmentOf(slug)}.md`,
    dir,
    name: `${segmentOf(slug)}.md`,
    status: modified ? 'modified' : 'added',
    lines: numberedLines,
    more: numberedMore,
    moreLabel: study ? 'case study' : 'details',
    adds,
    dels,
  };
}

/** The change's size: every file's additions and removals. */
export function diffStat(files: readonly Pick<DiffFile, 'adds' | 'dels'>[]): {
  adds: number;
  dels: number;
} {
  return files.reduce(
    (total, file) => ({ adds: total.adds + file.adds, dels: total.dels + file.dels }),
    { adds: 0, dels: 0 },
  );
}

/** Where a check's claim comes from. */
export interface Source {
  /** `url` and `link` leave the site; `work` lands on a file, `commit` on a commit, `source` names who said it. */
  readonly kind: 'url' | 'link' | 'source' | 'work' | 'commit';
  /** The record it points at: the evidence's own id for its links, else the work's or entry's. */
  readonly id: string;
  readonly label: string;
  readonly href?: string;
  /** The words that back it, such as the highlight that states the figure. */
  readonly quote?: string;
}

/** A piece of evidence as a passing check. */
export interface Check {
  readonly id: string;
  /** Its check name, `<type>/<id>`, as a CI job is named. */
  readonly name: string;
  readonly sources: readonly Source[];
}

/**
 * A piece of evidence as a check, with its sources: its own URL and links,
 * whoever it names as its source, every work that cites it, and every
 * chronology record or work whose highlights state its figure, the value
 * and its unit as written ("1.1 trillion").
 */
export function checkOf(
  entry: Evidence,
  records: {
    readonly works: readonly Pick<Work, 'id' | 'title' | 'evidence' | 'highlights'>[];
    readonly chronology: readonly Pick<ChronologyEntry, 'id' | 'title' | 'highlights'>[];
  },
): Check {
  const sources: Source[] = [];
  if (present(entry.url))
    sources.push({
      kind: 'url',
      id: entry.id,
      label: entry.urlLabel ?? entry.url,
      href: entry.url,
    });
  for (const link of entry.links ?? [])
    sources.push({
      kind: 'link',
      id: entry.id,
      label: link.label ?? link.platform ?? link.url,
      href: link.url,
    });
  if (entry.source && entry.type !== 'testimonial')
    sources.push({
      kind: 'source',
      id: entry.id,
      label: entry.source.name,
      ...(entry.source.url ? { href: entry.source.url } : {}),
    });
  for (const work of records.works)
    if ((work.evidence ?? []).includes(entry.id))
      sources.push({ kind: 'work', id: work.id, label: work.title });
  const figure =
    entry.metric?.value !== undefined
      ? `${entry.metric.value}${present(entry.metric.unit) ? ` ${entry.metric.unit}` : ''}`.toLowerCase()
      : undefined;
  if (figure && figure.length > 2) {
    const states = (highlight: string) => {
      const text = highlight.toLowerCase();
      const at = text.indexOf(figure);
      // The figure whole: not the 12 in 2012, nor the 1 in 1.1.
      return (
        at >= 0 &&
        !/[\p{N}.,]/u.test(text[at - 1] ?? ' ') &&
        !/[\p{L}\p{N}]/u.test(text[at + figure.length] ?? ' ')
      );
    };
    for (const record of records.chronology) {
      const quote = (record.highlights ?? []).find(states);
      if (quote) sources.push({ kind: 'commit', id: record.id, label: record.title, quote });
    }
    for (const work of records.works) {
      const quote = (work.highlights ?? []).find(states);
      if (quote && !sources.some((s) => s.kind === 'work' && s.id === work.id))
        sources.push({ kind: 'work', id: work.id, label: work.title, quote });
    }
  }
  return { id: entry.id, name: `${entry.type}/${entry.id}`, sources };
}

/**
 * The panel a section reads in, from where the navigation map places it:
 * About and the sections the map leaves to the index are the conversation,
 * the record's chronology is the commits and the rest of the record the
 * checks, the work and writing are the files changed, and contact is the
 * merge box.
 */
export function panelOf(
  section: Pick<Section, 'kind'>,
  destination: DestinationId | null | undefined,
): PanelId {
  switch (destination) {
    case 'record':
      return section.kind === 'chronology' ? 'commits' : 'checks';
    case 'work':
    case 'writing':
      return 'files';
    case 'contact':
      return 'merge';
    default:
      return 'conversation';
  }
}

/**
 * Where Approve and merge goes: the call to action's primary action, else
 * the contact record's first link, else a LinkedIn profile among the
 * portfolio's links, else the email, else the first link. None when the
 * portfolio has nowhere to go.
 */
export function mergeTargetOf(
  footer: Pick<FooterOutline, 'links' | 'email'> & {
    readonly cta?: Pick<NonNullable<FooterOutline['cta']>, 'primary'>;
    readonly contact?: { readonly links: readonly FooterLink[] };
  },
): FooterLink | undefined {
  return (
    footer.cta?.primary ??
    footer.contact?.links[0] ??
    footer.links.find((link) => link.platform?.toLowerCase() === 'linkedin') ??
    footer.email ??
    footer.links[0]
  );
}
