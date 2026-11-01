// Shell's derivations (variants-10 brief §5.6, V10/shell/concept.json): the
// prompt, each section's directory and command, the transcript's order and
// rhythm, the listing marks, the git lanes, the BibTeX entries and the man
// section, all computed from the render input alone. Pure and browser-safe:
// no markup, no clock, no network, no randomness, and no person-specific
// literal (N4). Every rule reads kinds, fields and the owner's controls.
//
// Two helpers are local copies until A lifts them into the kit (K-6), with
// the signatures the kit will take: stableDigest() and chronologyLanes().
// Destinations are the kit's navigation model (K-1), with no overrides.

import type { ChronologyEntry, Evidence, Placement, Section, Work } from '@portfolio/schema';
import {
  CASE_STUDY_FIELDS,
  chronologyOf,
  evidenceByIds,
  evidenceOf,
  isArchived,
  isSignature,
  navigationModel,
  placedImage,
  worksOf,
  type CaseStudyField,
  type DestinationId,
  type NavigationModel,
  type PageOutline,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';

/** What the derivations read: the visible content and the owner's controls. */
export type ModelInput = Pick<VariantRenderInput, 'portfolio' | 'controls'>;

// ───────────── text ─────────────

/** Whether `text` has something to show. */
export function present(text: string | undefined | null): text is string {
  return typeof text === 'string' && text.trim() !== '';
}

/** Collapses runs of white space. */
const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Inline Markdown as plain text: link text kept, emphasis and code marks dropped. */
export function plainInline(markdown: string): string {
  return squash(
    markdown
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(\*|_)(.+?)\1/g, '$2')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^#+\s+/gm, ''),
  );
}

/** Sentence ends: a Latin, Arabic or Devanagari stop before a space or the end, or a CJK full stop. */
const SENTENCE_END = /^([\s\S]+?(?:[.!?؟۔।](?=\s|$)|[。！？]))\s*([\s\S]*)$/u;

/** A text's first sentence, and what follows it (K-6 `firstSentence`). */
export function firstSentence(text: string): { lead: string; rest?: string } {
  const flat = squash(text);
  const match = SENTENCE_END.exec(flat);
  if (!match) return { lead: flat };
  const rest = match[2]!.trim();
  return rest ? { lead: match[1]!, rest } : { lead: match[1]! };
}

/** A path segment: ASCII-folded, lowercase, hyphenated. Empty when nothing Latin is left. */
export function slugOf(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ───────────── the hash (K-6) ─────────────

/**
 * A record id's 7-hex digest, the git log's hash: FNV-1a 32-bit over the
 * id's code points, lowercase hex padded to 8, its first 7. Stable across
 * deploys, derived from content, never shown to assistive tech (SH-S3).
 */
export function stableDigest(id: string): string {
  let hash = 0x811c9dc5;
  for (const char of id) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').slice(0, 7);
}

// ───────────── controls ─────────────

export type PromptStyle = 'full' | 'directory' | 'bare';
export type CommandsStyle = 'shown' | 'titles';
export type PaneStyle = 'docked' | 'dialog';

function enumControl<T extends string>(input: ModelInput, id: string, values: readonly T[]): T {
  const value = input.controls[id];
  return typeof value === 'string' && (values as readonly string[]).includes(value)
    ? (value as T)
    : values[0]!;
}

/** The owner's controls, each its default when unset, stale or invalid. */
export function controlsOf(input: ModelInput) {
  const pinned = input.controls.pinned;
  return {
    prompt: enumControl<PromptStyle>(input, 'prompt', ['full', 'directory', 'bare']),
    pane: enumControl<PaneStyle>(input, 'pane', ['docked', 'dialog']),
    commands: enumControl<CommandsStyle>(input, 'commands', ['shown', 'titles']),
    pinned: typeof pinned === 'string' && pinned !== '' ? pinned : undefined,
  };
}

// ───────────── the prompt ─────────────

export interface Prompt {
  /** The user before the @, or none. */
  readonly user?: string;
  /** The host after the @, or none: it shows only with a user. */
  readonly host?: string;
}

/** The first path segment of a URL, or none. */
function firstSegment(url: string): string | undefined {
  try {
    return new URL(url).pathname.split('/').find((part) => part !== '');
  } catch {
    return undefined;
  }
}

/**
 * The prompt's user@host: the user is the GitHub link's path segment, else
 * the github section's username, else the first word of the name, ASCII-
 * folded and slugged; the host is a slug of the location's first comma part.
 * Either one missing is left out, and nothing is made up.
 */
export function promptOf(input: ModelInput): Prompt {
  const { portfolio } = input;
  const github = portfolio.links.find((link) => link.platform?.toLowerCase() === 'github');
  const fromLink = github ? firstSegment(github.url) : undefined;
  const section = portfolio.sections.find(
    (entry): entry is Extract<Section, { kind: 'github' }> => entry.kind === 'github',
  );
  const candidates = [fromLink, section?.username, portfolio.identity.name.trim().split(/\s+/)[0]];
  const user = candidates.map((text) => (text ? slugOf(text) : '')).find((text) => text !== '');
  const host = present(portfolio.identity.location)
    ? slugOf(portfolio.identity.location.split(',')[0]!)
    : '';
  return { ...(user ? { user } : {}), ...(user && host ? { host } : {}) };
}

// ───────────── the thesis (N5, SH-M1) ─────────────

export type ThesisSource = 'thesis' | 'hero' | 'tagline' | 'name';

export interface Thesis {
  readonly text: string;
  readonly source: ThesisSource;
}

/**
 * The first view's lead line: the first sentence of the practice thesis a
 * visible thesis section shows, else the hero's tagline, else the
 * identity's, else the name alone.
 */
export function thesisOf(input: ModelInput): Thesis {
  const { portfolio } = input;
  const shown = portfolio.sections.some(
    (section) => section.kind === 'practice' && section.part === 'thesis',
  );
  if (shown && present(portfolio.practice?.thesis)) {
    return { text: firstSentence(plainInline(portfolio.practice.thesis)).lead, source: 'thesis' };
  }
  const hero = portfolio.sections.find(
    (section): section is Extract<Section, { kind: 'hero' }> => section.kind === 'hero',
  );
  if (present(hero?.tagline)) return { text: squash(hero.tagline), source: 'hero' };
  if (present(portfolio.identity.tagline)) {
    return { text: squash(portfolio.identity.tagline), source: 'tagline' };
  }
  return { text: squash(portfolio.identity.name), source: 'name' };
}

// ───────────── directories ─────────────

/** The five directories, in the index's order. */
export const DIRECTORIES: readonly DestinationId[] = [
  'work',
  'writing',
  'record',
  'about',
  'contact',
];

/** A destination's path: `~/<label>` from the model's label, so an owner's relabel is its path. */
export function cwdOf(destination: DestinationId | null, model?: NavigationModel): string {
  if (destination === null) return '~';
  const label = model?.primary.find(({ id }) => id === destination)?.label;
  const slug = label ? slugOf(label) : '';
  return `~/${slug || destination}`;
}

/** Where a section sits in the session. */
export interface TranscriptEntry {
  readonly section: Section;
  /** Its destination, or null for `~`. */
  readonly destination: DestinationId | null;
  readonly cwd: string;
  /** Blank rows before it: 0 for the first, 1 in the same directory, 2 at a directory change. */
  readonly gap: 0 | 1 | 2;
}

/**
 * The transcript's order (SH-M2): the hero and an untitled lede at `~`
 * first, then the five directories in the index's order, the owner's
 * order kept inside each, with the sections no destination takes (custom,
 * an extension's) at `~` just before Contact. Only sections with an anchor
 * in the outline are placed; `sections` is what the page renders.
 */
export function transcriptOf(
  sections: readonly Section[],
  outline: PageOutline,
  model: NavigationModel = navigationModel(outline),
): TranscriptEntry[] {
  const placed = model.placed;
  const placeOf = (section: Section): DestinationId | null => placed.get(section.id) ?? null;
  const opening = (section: Section) =>
    placeOf(section) === null && (section.kind === 'hero' || section.kind === 'lede');
  const head = sections.filter(opening);
  const loose = sections.filter((section) => placeOf(section) === null && !opening(section));
  const ordered: Section[] = [...head];
  for (const directory of DIRECTORIES) {
    if (directory === 'contact') ordered.push(...loose);
    ordered.push(...sections.filter((section) => placeOf(section) === directory));
  }
  const entries: TranscriptEntry[] = [];
  let previous: string | undefined;
  for (const section of ordered) {
    const destination = placeOf(section);
    const cwd = cwdOf(destination, model);
    const gap = previous === undefined ? 0 : previous === cwd ? 1 : 2;
    entries.push({ section, destination, cwd, gap });
    previous = cwd;
  }
  return entries;
}

// ───────────── commands ─────────────

export interface Command {
  readonly verb: string;
  /** Its arguments, flags first, or none. */
  readonly args?: string;
}

const WRITTEN = new Set(['writing', 'research']);
const PICTURED = new Set(['image-series', 'photography']);

/** Every item matches, and there's at least one. */
const every = <T>(items: readonly T[], test: (item: T) => boolean) =>
  items.length > 0 && items.every(test);

/** The type most entries have, the first to reach that count winning a tie; none for no entries. */
export function majorityType(entries: readonly Evidence[]): Evidence['type'] | undefined {
  const counts = new Map<Evidence['type'], number>();
  let best: Evidence['type'] | undefined;
  for (const { type } of entries) {
    const count = (counts.get(type) ?? 0) + 1;
    counts.set(type, count);
    if (best === undefined || count > counts.get(best)!) best = type;
  }
  return best;
}

/** The form a works section's listing takes. */
export type WorksForm = 'ls-time' | 'open' | 'ls-long';

export function worksForm(works: readonly Work[]): WorksForm {
  if (every(works, (work) => WRITTEN.has(work.medium))) return 'ls-time';
  if (every(works, (work) => PICTURED.has(work.medium))) return 'open';
  return 'ls-long';
}

/** The form an evidence section's output takes, by its majority type. */
export type EvidenceForm = 'kv' | 'bibtex' | 'mail' | 'patents' | 'ls-table';

export function evidenceForm(entries: readonly Evidence[]): EvidenceForm {
  switch (majorityType(entries)) {
    case 'metric':
      return 'kv';
    case 'publication':
      return 'bibtex';
    case 'testimonial':
    case 'press':
      return 'mail';
    case 'patent':
      return 'patents';
    default:
      return 'ls-table';
  }
}

/**
 * The command that prints a section, by its kind (and part, medium or
 * evidence type), its path the section's own id, the same id as its anchor.
 */
export function commandFor(section: Section, input: ModelInput): Command {
  const { id } = section;
  switch (section.kind) {
    case 'hero':
      return { verb: 'whoami' };
    case 'lede':
      return { verb: 'cat', args: `${id}.md` };
    case 'practice':
      switch (section.part) {
        case 'thesis':
          return { verb: 'cat', args: 'README.md' };
        case 'skills':
          return { verb: 'ls', args: `${id}/` };
        case 'tools':
          return { verb: 'tree', args: `${id}/` };
        default:
          return { verb: 'man', args: id };
      }
    case 'works': {
      const form = worksForm(worksOf(section, input));
      if (form === 'ls-time') return { verb: 'ls', args: `-lt ${id}/` };
      if (form === 'open') return { verb: 'open', args: `${id}/` };
      return { verb: 'ls', args: `-l ${id}/` };
    }
    case 'evidence': {
      const form = evidenceForm(evidenceOf(section, input));
      if (form === 'kv') return { verb: 'cat', args: `${id}.txt` };
      if (form === 'bibtex') return { verb: 'cat', args: `${id}.bib` };
      if (form === 'mail') return { verb: 'mail', args: `-f ${id}` };
      if (form === 'patents') return { verb: 'cat', args: `${id}/*` };
      return { verb: 'ls', args: `-l ${id}/` };
    }
    case 'chronology':
      return { verb: 'git', args: `log --graph ${id}` };
    case 'now': {
      const { user } = promptOf(input);
      return user ? { verb: 'finger', args: user } : { verb: 'finger' };
    }
    case 'focus':
      return { verb: 'jobs' };
    case 'fun-facts':
      return { verb: 'cat', args: `${id}.txt` };
    case 'quote':
      return { verb: 'cat', args: '/etc/motd' };
    case 'github':
      return { verb: 'gh', args: `repo list ${section.username}` };
    case 'contact': {
      const email = input.portfolio.identity.email;
      return present(email) ? { verb: 'mail', args: email.trim() } : { verb: 'cat', args: id };
    }
    case 'cta':
      return { verb: `./${id}` };
    default:
      return { verb: 'cat', args: id };
  }
}

/** A section's kind in plain words, the hidden h2 of an untitled section. */
export const KIND_LABELS: Readonly<Record<string, string>> = {
  hero: 'Introduction',
  lede: 'About',
  works: 'Work',
  evidence: 'Record',
  chronology: 'History',
  practice: 'Practice',
  contact: 'Contact',
  custom: 'More',
  now: 'Now',
  quote: 'Quote',
  focus: 'Focus',
  'fun-facts': 'Fun facts',
  cta: 'Next step',
  github: 'GitHub',
};

// ───────────── listings ─────────────

/** A listing's date: the period's start, else when it was published, else released; none otherwise. */
export function dateOf(work: Work): string | undefined {
  const raw = work.period?.start ?? work.publishedAt ?? work.releasedAt;
  return raw === undefined ? undefined : String(raw);
}

export type ListingMark = 'signature' | 'featured';

export interface ListingRow {
  readonly work: Work;
  /** `d` for a work with its own page, `-` otherwise. */
  readonly flag: 'd' | '-';
  readonly date?: string;
  /** The signature's star, or a featured work's hollow star, when it has a cover. */
  readonly mark?: ListingMark;
  readonly archived: boolean;
  /** The work's highlights, verbatim, each shown in brackets. */
  readonly highlights: readonly string[];
}

/** The signature work the first view previews: the owner's pinned work, else the signature. */
export function signatureOf(input: ModelInput): string | undefined {
  const { pinned } = controlsOf(input);
  if (pinned !== undefined && input.portfolio.works.some(({ id }) => id === pinned)) return pinned;
  return input.portfolio.signature;
}

/** One row of an ls listing for each work, in the section's order. */
export function listingOf(works: readonly Work[], input: ModelInput): ListingRow[] {
  const signature = signatureOf(input);
  const featured = new Set(input.portfolio.featured);
  return works.map((work) => {
    const mark: ListingMark | undefined =
      work.id === signature || (signature === undefined && isSignature(work, input))
        ? 'signature'
        : featured.has(work.id) && work.cover !== undefined
          ? 'featured'
          : undefined;
    const date = dateOf(work);
    return {
      work,
      flag: work.slug !== undefined && work.caseStudy !== undefined ? 'd' : '-',
      ...(date !== undefined ? { date } : {}),
      ...(mark !== undefined ? { mark } : {}),
      archived: isArchived(work, input),
      highlights: work.highlights ?? [],
    };
  });
}

/** An album's length in whole seconds, the sum of its timed tracks; none when no track is timed. */
export function albumSeconds(work: Work): number | undefined {
  const timed = (work.tracks ?? []).filter(({ durationSeconds }) => durationSeconds !== undefined);
  if (timed.length === 0) return undefined;
  return Math.round(timed.reduce((sum, { durationSeconds }) => sum + durationSeconds!, 0));
}

/** Seconds as m:ss, or h:mm:ss past an hour. */
export function clockOf(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

// ───────────── proof in whoami ─────────────

export interface ProofLine {
  readonly id: string;
  /** The figure, value and unit, as one string: none for an award. */
  readonly figure?: string;
  /** The words after the figure, or the award's title. */
  readonly words: string;
  /** An award's year. */
  readonly year?: string;
}

/** A number in the portfolio's locale. */
function numberOf(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return String(value);
  }
}

/**
 * The curation list's proof as whoami prints it: a metric as its value and
 * unit and the words of its key the unit doesn't already say; an award as
 * its title and year. Anything else shows its title or statement.
 */
export function proofLines(input: ModelInput): ProofLine[] {
  const { portfolio } = input;
  const byId = new Map(portfolio.evidence.map((entry) => [entry.id, entry]));
  return portfolio.proof.flatMap((id): ProofLine[] => {
    const entry = byId.get(id);
    if (!entry) return [];
    const metric = entry.metric;
    if (entry.type === 'metric' && metric?.value !== undefined) {
      const unit = metric.unit?.trim() ?? '';
      const unitWords = new Set(unit.toLowerCase().split(/\s+/));
      const keyWords = (metric.key ?? '')
        .split('-')
        .filter(
          (word) =>
            word !== '' &&
            !unitWords.has(word) &&
            !unitWords.has(`${word}s`) &&
            !/^\d+$/.test(word),
        );
      const fallback =
        keyWords.length === 0 && present(entry.title) ? plainInline(entry.title) : '';
      return [
        {
          id,
          figure: [numberOf(metric.value, portfolio.locale), unit].filter(Boolean).join(' '),
          words: keyWords.join(' ') || fallback,
        },
      ];
    }
    const year = /^(\d{4})/.exec(String(entry.receivedAt ?? entry.publishedAt ?? ''))?.[1];
    const words = present(entry.title)
      ? plainInline(entry.title)
      : present(entry.statement)
        ? firstSentence(plainInline(entry.statement)).lead
        : '';
    if (!words) return [];
    return [{ id, words, ...(year ? { year } : {}) }];
  });
}

// ───────────── git lanes (K-6) ─────────────

/** The lane colours: data-categorical 1, 2, 4 and 5, cycling. */
export const LANE_COLOURS = [1, 2, 4, 5] as const;

/** One cell of the graph: a glyph, and the lane whose colour draws it. */
export interface GraphCell {
  readonly glyph: '*' | '|' | '/' | '\\' | ' ';
  /** Index into the lanes; none for a blank. */
  readonly lane?: number;
}

export type GraphRow =
  | {
      readonly kind: 'entry';
      readonly entry: ChronologyEntry;
      readonly lane: number;
      readonly cells: readonly GraphCell[];
    }
  | { readonly kind: 'fork' | 'merge'; readonly cells: readonly GraphCell[] };

export interface ChronologyLanes {
  /** Each lane's thread, in the owner's order of first appearance; `undefined` for entries without one. */
  readonly lanes: readonly (string | undefined)[];
  /** Graph rows, newest first, with a fork or merge row where a branch joins. */
  readonly rows: readonly GraphRow[];
  /** How many columns the graph takes at most. */
  readonly width: number;
}

/** A date for ordering: `2023-04` reads as 2023-04, `2014` as 2014. */
const orderKey = (raw: unknown) => String(raw ?? '');

/**
 * The git log's lanes (K-6 `chronologyLanes`): one lane per thread in the
 * owner's order; rows newest first by period start, ties in the owner's
 * order; an open period draws its lane from the top; a lane's column is
 * freed once its thread has no older rows, and reused; `branchesFrom` an
 * entry in the same list draws the `|/` fork below the branch's oldest row,
 * and `mergesInto` one draws the `|\` join below the entry it merges into.
 */
export function chronologyLanes(entries: readonly ChronologyEntry[]): ChronologyLanes {
  const lanes: (string | undefined)[] = [];
  const laneOf = (entry: ChronologyEntry) => {
    let index = lanes.indexOf(entry.thread);
    if (index < 0) index = lanes.push(entry.thread) - 1;
    return index;
  };
  entries.forEach(laneOf);
  const sorted = entries
    .map((entry, order) => ({ entry, order }))
    .sort(
      (a, b) =>
        orderKey(b.entry.period.start).localeCompare(orderKey(a.entry.period.start)) ||
        a.order - b.order,
    )
    .map(({ entry }) => entry);
  const ids = new Set(entries.map(({ id }) => id));
  const byId = new Map(entries.map((entry) => [entry.id, entry]));

  // Each lane's span over the entry rows: from its first row (row 0 if any
  // of its entries is open) to its last.
  const span = lanes.map((_, lane) => {
    const rows = sorted.flatMap((entry, row) => (laneOf(entry) === lane ? [row] : []));
    const open = sorted.some((entry) => laneOf(entry) === lane && entry.period.end === undefined);
    return { from: open ? 0 : rows[0]!, to: rows[rows.length - 1]! };
  });
  // A lane that branches from another lane stays drawn to the fork below its oldest row.
  const forkInto = new Map<number, number>();
  const mergeFrom = new Map<number, { target: number; at: number }>();
  for (const entry of sorted) {
    const lane = laneOf(entry);
    if (entry.branchesFrom && ids.has(entry.branchesFrom)) {
      const parent = laneOf(byId.get(entry.branchesFrom)!);
      if (parent !== lane && span[lane]!.to === sorted.indexOf(entry)) forkInto.set(lane, parent);
    }
    if (entry.mergesInto && ids.has(entry.mergesInto)) {
      const target = laneOf(byId.get(entry.mergesInto)!);
      if (target !== lane) {
        // It runs from just below the entry it merges into, where the join row draws it.
        const at = sorted.indexOf(byId.get(entry.mergesInto)!);
        mergeFrom.set(lane, { target, at });
        span[lane] = { ...span[lane]!, from: Math.min(span[lane]!.from, at + 1) };
      }
    }
  }
  // Columns: each lane takes the lowest free column when its span starts.
  const column = new Map<number, number>();
  const freeAt: number[] = [];
  const order = lanes.map((_, lane) => lane).sort((a, b) => span[a]!.from - span[b]!.from || a - b);
  for (const lane of order) {
    let col = 0;
    while (freeAt[col] !== undefined && freeAt[col]! >= span[lane]!.from) col += 1;
    column.set(lane, col);
    freeAt[col] = span[lane]!.to;
  }
  const width = Math.max(1, ...[...column.values()].map((col) => col + 1));
  const live = (lane: number, row: number) => span[lane]!.from <= row && row <= span[lane]!.to;
  const blank = (): GraphCell[] => Array.from({ length: width }, () => ({ glyph: ' ' as const }));

  const rows: GraphRow[] = [];
  sorted.forEach((entry, row) => {
    const own = laneOf(entry);
    const cells = blank();
    lanes.forEach((_, lane) => {
      if (live(lane, row)) cells[column.get(lane)!] = { glyph: lane === own ? '*' : '|', lane };
    });
    rows.push({ kind: 'entry', entry, lane: own, cells });
    // A merge splits off below the entry another lane merges into.
    for (const [lane, { target, at }] of mergeFrom) {
      if (at !== row) continue;
      const join = blank();
      lanes.forEach((_, other) => {
        if (other !== lane && live(other, row + 1))
          join[column.get(other)!] = { glyph: '|', lane: other };
      });
      join[column.get(target)!] = { glyph: '|', lane: target };
      join[column.get(lane)!] = { glyph: '\\', lane };
      rows.push({ kind: 'merge', cells: join });
    }
    // A branch joins its parent below its oldest row.
    for (const [lane, parent] of forkInto) {
      if (span[lane]!.to !== row) continue;
      const fork = blank();
      lanes.forEach((_, other) => {
        if (other !== lane && live(other, row + 1))
          fork[column.get(other)!] = { glyph: '|', lane: other };
      });
      fork[column.get(parent)!] = { glyph: '|', lane: parent };
      fork[column.get(lane)!] = { glyph: '/', lane };
      rows.push({ kind: 'fork', cells: fork });
    }
  });
  return { lanes, rows, width };
}

/** A lane's colour: its data-categorical index. */
export const laneColour = (lane: number) => LANE_COLOURS[lane % LANE_COLOURS.length]!;

// ───────────── BibTeX ─────────────

export interface BibEntry {
  readonly type: 'inproceedings' | 'article';
  readonly key: string;
  /** Fields present on the record, in BibTeX's usual order. */
  readonly fields: readonly { readonly name: string; readonly value: string }[];
  /** The owner's formatted citation, printed as a `%` comment over the entry. */
  readonly comment?: string;
}

/** A publication as a BibTeX entry: its type by venue, its cite key from author, year and title. */
export function bibtexOf(entry: Evidence): BibEntry {
  const venue = entry.venue ?? '';
  const type = /proc|conference|symposium|workshop/i.test(venue) ? 'inproceedings' : 'article';
  const author = entry.authors?.[0] ?? entry.source?.name ?? '';
  const surname = slugOf(author.trim().split(/\s+/).pop() ?? '').replace(/-/g, '');
  const year = /^(\d{4})/.exec(String(entry.publishedAt ?? ''))?.[1] ?? '';
  const word =
    (entry.title ?? '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^A-Za-z]+/)
      .find((part) => part.length >= 4)
      ?.toLowerCase() ?? '';
  const key = `${surname}${year}${word}` || slugOf(entry.id).replace(/-/g, '');
  const fields: { name: string; value: string }[] = [];
  const add = (name: string, value: string | undefined) => {
    if (present(value)) fields.push({ name, value: squash(value) });
  };
  add('title', entry.title);
  add('author', entry.authors?.join(' and '));
  add(type === 'inproceedings' ? 'booktitle' : 'journal', entry.venue);
  add('year', year || undefined);
  add('doi', entry.doi);
  add('url', entry.url ?? entry.pdfUrl);
  add('note', entry.awards?.filter(present).join('; '));
  add('abstract', entry.abstract !== undefined ? plainInline(entry.abstract) : undefined);
  const comment = present(entry.citation) ? squash(entry.citation) : undefined;
  return comment !== undefined ? { type, key, fields, comment } : { type, key, fields };
}

// ───────────── the man page ─────────────

/** A work's manual section: 1 for software, systems and interfaces, 7 otherwise. */
export function manSectionOf(work: Pick<Work, 'medium'>): 1 | 7 {
  return work.medium === 'software' || work.medium === 'system' || work.medium === 'interface'
    ? 1
    : 7;
}

// ───────────── folds (gate item 8) ─────────────

/** A folded section's summary: how many it holds, of what, and the first of them. */
export interface Fold {
  readonly count: number;
  readonly unit: string;
  readonly first?: string;
}

const firstPresent = (values: readonly (string | undefined)[]) => values.find(present);

/**
 * Whether a section folds on home (gate item 8, the lead's ruling for Shell): the minor parts
 * of Record and About print as their command line, closed, with how many and the first; the
 * rest stay open. By kind, never by title: in Record, the figures and words from collaborators
 * (metrics and testimonials) and the roles (Experience) stay open, and every other record,
 * history and GitHub folds; in About, the thesis, the lede, Now, the focus and the quote stay
 * open, and the other practice parts and the fun facts fold. Undefined: it stays open.
 */
export function foldOf(
  section: Section,
  destination: DestinationId | null,
  input: ModelInput,
): Fold | undefined {
  if (destination !== 'record' && destination !== 'about') return undefined;
  switch (section.kind) {
    case 'evidence': {
      const entries = evidenceOf(section, input);
      const type = majorityType(entries);
      if (entries.length === 0 || type === 'metric' || type === 'testimonial') return undefined;
      const head = entries[0]!;
      return {
        count: entries.length,
        unit: entries.length === 1 ? 'entry' : 'entries',
        first: firstPresent([head.title, head.source?.name, head.publication, head.organization]),
      };
    }
    case 'chronology': {
      const entries = chronologyOf(section, input);
      const roles = entries.filter(({ kind }) => kind === 'role').length;
      if (entries.length === 0 || roles * 2 > entries.length) return undefined;
      return {
        count: entries.length,
        unit: entries.length === 1 ? 'commit' : 'commits',
        first: entries[0]!.title,
      };
    }
    case 'github':
      return { count: 0, unit: 'repositories', first: `github.com/${section.username}` };
    case 'fun-facts':
      return section.items.length === 0
        ? undefined
        : {
            count: section.items.length,
            unit: section.items.length === 1 ? 'line' : 'lines',
            first: plainInline(section.items[0]!),
          };
    case 'practice': {
      const practice = input.portfolio.practice;
      const names =
        section.part === 'skills'
          ? (practice?.skills ?? []).flatMap((group) => group.items)
          : section.part === 'tools'
            ? (practice?.tools ?? []).flatMap((group) => group.items.map(({ name }) => name))
            : section.part === 'services'
              ? (practice?.services ?? []).flatMap((group) => group.items.map(({ name }) => name))
              : [];
      if (names.length === 0) return undefined;
      return {
        count: names.length,
        unit: names.length === 1 ? 'item' : 'items',
        first: names[0],
      };
    }
    default:
      return undefined;
  }
}

/** A work's name as its man page heads it: the slug in capitals, and the section. */
export function manTitleOf(work: Pick<Work, 'id' | 'slug' | 'medium'>): string {
  return `${(work.slug ?? work.id).toUpperCase()}(${manSectionOf(work)})`;
}

/** The records a work cites that the view holds (the kit's `evidenceByIds`), in its order, each once. */
export function citedOf(work: Pick<Work, 'evidence'>, input: ModelInput): readonly Evidence[] {
  const seen = new Set<string>();
  return evidenceByIds(work.evidence, input).filter((record) => {
    if (seen.has(record.id)) return false;
    seen.add(record.id);
    return true;
  });
}

/** HISTORY: the awards the work cites, in its order. */
export const historyOf = (cited: readonly Evidence[]): readonly Evidence[] =>
  cited.filter((record) => record.type === 'award');

/**
 * SEE ALSO: the other records the work cites, then the works that share a
 * tag or a tool with it (those with their own page first, in the outline's
 * order, then the rest, as `alsoWorksOf` lists them); a work alike only in
 * its medium isn't one to see.
 */
export function seeAlsoOf<W extends { readonly shared: readonly string[] }>(
  cited: readonly Evidence[],
  related: readonly W[],
): { readonly records: readonly Evidence[]; readonly works: readonly W[] } {
  return {
    records: cited.filter((record) => record.type !== 'award'),
    works: related.filter((work) => work.shared.length > 0),
  };
}

/** A work SEE ALSO names: its own page when it has one, else its address, else just its name. */
export interface AlsoWork {
  readonly id: string;
  readonly title: string;
  readonly name: string;
  readonly section: 1 | 7;
  readonly href?: string;
  /** Whether `href` is the work's own page here. */
  readonly routed: boolean;
  readonly shared: readonly string[];
  readonly lang?: string;
}

/**
 * The works SEE ALSO names: those with their own page that share a tag or a
 * tool with this one, in the outline's order (most shared first), then the
 * other works the page holds that share one, most shared first, each named
 * by its slug, else its id. The ranking of the works with no page is a local
 * copy of `caseStudyOutline`'s shared-term ranking for its `related` (which
 * holds routed works only), until A lifts it into the kit (K-6).
 */
export function alsoWorksOf(
  work: Pick<Work, 'id' | 'tags' | 'tools'>,
  input: ModelInput,
  related: readonly {
    readonly id: string;
    readonly href: string;
    readonly shared: readonly string[];
  }[],
): readonly AlsoWork[] {
  const terms = [...(work.tags ?? []), ...(work.tools ?? [])];
  const byId = new Map(input.portfolio.works.map((each) => [each.id, each]));
  const of = (
    each: Work,
    shared: readonly string[],
    href: string | undefined,
    routed: boolean,
  ) => ({
    id: each.id,
    title: each.title,
    name: each.slug ?? each.id,
    section: manSectionOf(each),
    ...(href !== undefined ? { href } : {}),
    routed,
    shared,
    ...(each.lang !== undefined ? { lang: each.lang } : {}),
  });
  const routed = related.flatMap((each) => {
    const found = byId.get(each.id);
    return found && each.shared.length > 0 ? [of(found, each.shared, each.href, true)] : [];
  });
  const seen = new Set([work.id, ...related.map((each) => each.id)]);
  const others = input.portfolio.works
    .filter((each) => !seen.has(each.id))
    .map((each, order) => {
      const theirs = new Set([...(each.tags ?? []), ...(each.tools ?? [])]);
      return { each, order, shared: [...new Set(terms.filter((term) => theirs.has(term)))] };
    })
    .filter(({ shared }) => shared.length > 0)
    .sort((a, b) => b.shared.length - a.shared.length || a.order - b.order)
    .map(({ each, shared }) => of(each, shared, present(each.url) ? each.url : undefined, false));
  return [...routed, ...others];
}

/** A work's date as the synopsis says it: since when, or when it came out. */
export function sinceOf(
  work: Pick<Work, 'period' | 'publishedAt' | 'releasedAt'>,
): { readonly label: 'since' | 'published' | 'released'; readonly raw: unknown } | undefined {
  if (work.period) return { label: 'since', raw: work.period.start };
  if (work.publishedAt !== undefined) return { label: 'published', raw: work.publishedAt };
  if (work.releasedAt !== undefined) return { label: 'released', raw: work.releasedAt };
  return undefined;
}

type Pictured = Pick<Work, 'cover' | 'media'>;
type MediaInput = Pick<VariantRenderInput, 'media'>;

/**
 * Whether a placement shows as a picture: its asset is an image the view holds, and it isn't
 * decoration with nothing ready to draw (which the kit's figure leaves out).
 */
export function pictured(placement: Placement | undefined, input: MediaInput): boolean {
  const placed = placedImage(placement, input);
  return placed !== undefined && !(placed.decorative && placed.image.state !== 'ready');
}

/** The cover a work's page shows: its own, else its first picture that shows. */
export function coverOf(work: Pictured, input: MediaInput): Placement | undefined {
  if (work.cover !== undefined && pictured(work.cover, input)) return work.cover;
  return (work.media ?? []).find((placement) => pictured(placement, input));
}

/** A work's pictures past its cover: each one that shows, less the one standing as the cover. */
export function restMediaOf(work: Pictured, input: MediaInput): readonly Placement[] {
  const cover = coverOf(work, input);
  return (work.media ?? []).filter(
    (placement) => placement !== cover && pictured(placement, input),
  );
}

/** A man page's section: a case part, or one the page itself has. */
export type ManKey =
  'name' | 'synopsis' | 'description' | CaseStudyField | 'history' | 'see-also' | 'authors';

export interface ManSection {
  readonly key: ManKey;
  readonly anchor: string;
  /** Its heading, in the composition's words (a case part's is the kit's label). */
  readonly label: string;
}

const MAN_LABELS: Readonly<Record<string, string>> = {
  name: 'Name',
  synopsis: 'Synopsis',
  description: 'Description',
  history: 'History',
  'see-also': 'See also',
  authors: 'Authors',
  ...Object.fromEntries(CASE_STUDY_FIELDS),
};

/**
 * The man page's sections, in man(1)'s order: NAME, SYNOPSIS, DESCRIPTION
 * when the work has one (its description, highlights or pictures), the case
 * study's parts as the outline lists them (each at the outline's anchor),
 * HISTORY and SEE ALSO when there's something in them, and AUTHORS. Each
 * anchor is the work's id and the key, as the outline's parts are.
 */
export function manSectionsOf(
  work: Pick<Work, 'id' | 'description' | 'highlights' | 'cover' | 'media' | 'evidence'>,
  outline: { readonly parts: readonly { readonly key: CaseStudyField; readonly anchor: string }[] },
  input: ModelInput & Pick<VariantRenderInput, 'ids' | 'media'>,
  related: readonly { readonly shared: readonly string[] }[] = [],
): readonly ManSection[] {
  const at = (key: ManKey): ManSection => ({
    key,
    anchor: `${input.ids.prefix}${work.id}--${key}`,
    label: MAN_LABELS[key]!,
  });
  const cited = citedOf(work, input);
  const see = seeAlsoOf(cited, related);
  const described =
    present(work.description) ||
    (work.highlights ?? []).some(present) ||
    restMediaOf(work, input).length > 0;
  return [
    at('name'),
    at('synopsis'),
    ...(described ? [at('description')] : []),
    ...outline.parts.map((part) => ({
      key: part.key,
      anchor: part.anchor,
      label: MAN_LABELS[part.key]!,
    })),
    ...(historyOf(cited).length > 0 ? [at('history')] : []),
    ...(see.records.length + see.works.length > 0 ? [at('see-also')] : []),
    at('authors'),
  ];
}

// ───────────── counts ─────────────

/** What `total n` counts under a listing: the items the section shows. */
export function totalOf(section: Section, input: ModelInput): number {
  switch (section.kind) {
    case 'works':
      return worksOf(section, input).length;
    case 'evidence':
      return evidenceOf(section, input).length;
    case 'focus':
    case 'fun-facts':
      return section.items.length;
    default:
      return 0;
  }
}
