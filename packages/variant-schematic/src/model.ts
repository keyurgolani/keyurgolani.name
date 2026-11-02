// Schematic's derivations (variants-10 brief §5.4, step 2): the sheet set,
// its numbering, the cover's dimension labels and notes, Figure 1, every
// interface figure's ports, IN/OUT and depth, and the title block's cells,
// computed from the render input alone. Pure and browser-safe: no markup, no
// clock, no network, no randomness, and no person-specific literal (N4):
// every rule reads kinds, fields, curation lists and the owner's controls.
// The concept generator's sample FOLD set (build.mjs:188) was deleted before
// porting; only the generic fold rule is here (SC-S6).
//
// Three helpers are local copies until lead A lifts them into the kit (K-6),
// with the signatures the kit will take: firstSentence(text),
// currentRole(input) and proofOf(input).

import type { ChronologyEntry, Evidence, Link, Section, Work } from '@portfolio/schema';
import {
  chronologyOf,
  evidenceByIds,
  evidenceOf,
  githubSnapshot,
  hrefFor,
  isRoutedWork,
  navigationModel,
  pageOutline,
  present,
  worksByIds,
  worksOf,
  type DestinationId,
  type GroupingOptions,
  type PageOutline,
  type SectionOf,
} from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { stringsFor } from './strings';

export { present };

/** What the derivations read. */
export type ModelInput = VariantRenderInput;

// ───────────── text ─────────────

/** Collapses runs of white space. */
export const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Inline Markdown as plain text, for a line set in one voice (a dimension
 * label, a title-block cell): link text and code kept, marks dropped.
 */
export function plainInline(markdown: string): string {
  return squash(
    markdown
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/!\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
      .replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, '$1')
      .replace(/\*\*\*(?!\s)(.+?)(?<!\s)\*\*\*/g, '$1')
      .replace(/\*\*(?!\s)(.+?)(?<!\s)\*\*/g, '$1')
      .replace(/\*(?!\s)(.+?)(?<!\s)\*/g, '$1')
      .replace(/(?<![\p{L}\p{N}_])(_{1,3})(?!\s)(.+?)(?<!\s)\1(?![\p{L}\p{N}_])/gu, '$2'),
  );
}

/** A Latin, Arabic or Devanagari stop before a space or the end, or a CJK stop. */
const SENTENCE_END = /^([\s\S]+?(?:[.!?؟۔।](?=\s|$)|[。！？]))\s*[\s\S]*$/u;

/** A text's first sentence, as plain text (K-6 `firstSentence`, local copy). */
export function firstSentence(text: string | undefined): string | undefined {
  if (!present(text)) return undefined;
  const flat = plainInline(text);
  const match = SENTENCE_END.exec(flat);
  return match ? match[1]! : flat;
}

/** `text` with its percent-escapes decoded, or as written when they don't decode. */
function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** An absolute address's host as written, before the URL parser turns it into punycode. */
const WRITTEN_HOST = /^[a-z][\w+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^/:?#]+)/i;

/**
 * A link's text, the kit's rule (`linkLabel`, local copy until the kit's
 * sections entry exports it): the owner's label, else its platform, else
 * where it goes: a mail or phone link's address, else its host as written
 * (bücher.de, never xn--bcher-kva.de) without a leading www., else the
 * address without its scheme.
 */
export function linkLabel(link: Pick<Link, 'label' | 'platform' | 'url'>): string {
  const own = [link.label, link.platform].find(present);
  if (own) return own;
  const url = link.url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'mailto:' || parsed.protocol === 'tel:')
      return decoded(parsed.pathname);
    const host = WRITTEN_HOST.exec(url.trim())?.[1];
    if (parsed.hostname !== '' && host !== undefined)
      return decoded(host)
        .replace(/^www\./i, '')
        .toLowerCase();
  } catch {
    // Not an absolute URL, such as a path: shown as written, below.
  }
  return decoded(url.replace(/^(?:https?:\/\/(?:www\.)?|mailto:|tel:)/i, '').replace(/\/$/, ''));
}

/** Whether a URL leaves the site. */
export const outbound = (url: string) => /^https?:\/\//i.test(url);

/** The letter initials of a name, upper-cased, such as "AD"; empty when it has no letters. */
export function initialsOf(name: string): string {
  return squash(name)
    .split(' ')
    .map((word) => [...word].find((char) => /\p{L}/u.test(char)) ?? '')
    .join('')
    .toLocaleUpperCase();
}

/** The drawing number: the name's initials and -001, none when the name has no letters. */
export function drawingNumber(name: string): string | undefined {
  const initials = initialsOf(name);
  return initials ? `${initials}-001` : undefined;
}

// ───────────── records ─────────────

/**
 * The current role (K-6 `currentRole`, local copy): the role-kind
 * chronology entry with no end and the latest start, else none.
 */
export function currentRole(
  input: Pick<VariantRenderInput, 'portfolio'>,
): ChronologyEntry | undefined {
  const open = input.portfolio.chronology.filter(
    (entry) => entry.kind === 'role' && entry.period && !present(entry.period.end),
  );
  return [...open].sort((a, b) => String(b.period.start).localeCompare(String(a.period.start)))[0];
}

/**
 * The cover's notes (K-6 `proofOf`, local copy, with the owner's control
 * first): the heroNotes control's evidence, else portfolio.proof, at most 4.
 */
export function proofOf(
  input: Pick<VariantRenderInput, 'portfolio' | 'controls'>,
): readonly Evidence[] {
  const chosen = input.controls.heroNotes;
  const ids =
    Array.isArray(chosen) && chosen.length > 0
      ? (chosen as readonly string[])
      : (input.portfolio.proof ?? []);
  return evidenceByIds(ids, input).slice(0, 4);
}

/** The first works section that renders. */
function firstWorksSection(input: VariantRenderInput): Section | undefined {
  return input.portfolio.sections.find(
    (section) => section.kind === 'works' && worksOf(section, input).length > 0,
  );
}

/**
 * Figure 1, the work the cover draws: the signatureFigure control, else the
 * portfolio's signature, else its first featured work, else the first work
 * of the first works section. None: the cover closes up.
 */
export function signatureOf(input: VariantRenderInput): Work | undefined {
  const control = input.controls.signatureFigure;
  const pick = (id: unknown) => (typeof id === 'string' ? worksByIds([id], input)[0] : undefined);
  return (
    pick(control) ??
    pick(input.portfolio.signature) ??
    pick(input.portfolio.featured?.[0]) ??
    (() => {
      const section = firstWorksSection(input);
      return section ? worksOf(section, input)[0] : undefined;
    })()
  );
}

/** The first practice section with part thesis that renders, if the practice has a thesis. */
export function thesisSection(input: VariantRenderInput): Section | undefined {
  if (!present(input.portfolio.practice?.thesis)) return undefined;
  return input.portfolio.sections.find(
    (section) => section.kind === 'practice' && section.part === 'thesis',
  );
}

/** The hero section, the cover's source. */
export function heroOf(input: VariantRenderInput): Extract<Section, { kind: 'hero' }> | undefined {
  return input.portfolio.sections.find((section) => section.kind === 'hero') as
    Extract<Section, { kind: 'hero' }> | undefined;
}

/** Where the dimension label over the name comes from (SC-M3). */
export type LabelSource = 'thesis' | 'role' | 'tagline';

/**
 * The cover's two dimension labels. Width, over the name (SC-M3): the
 * thesis's first sentence, else the current role, else the identity
 * tagline, else ticks only. Height, beside the name block (SC-S1): the
 * current role when the width didn't take it, else ticks only.
 */
export function dimensionLabels(input: VariantRenderInput): {
  width?: { text: string; source: LabelSource };
  height?: string;
} {
  const thesis = firstSentence(input.portfolio.practice?.thesis);
  const role = currentRole(input);
  const roleText = role ? squash(role.title) : undefined;
  const tagline = present(input.portfolio.identity.tagline)
    ? squash(input.portfolio.identity.tagline)
    : undefined;
  const width = thesis
    ? { text: thesis, source: 'thesis' as const }
    : roleText
      ? { text: roleText, source: 'role' as const }
      : tagline
        ? { text: tagline, source: 'tagline' as const }
        : undefined;
  const height = width?.source !== 'role' ? roleText : undefined;
  return { ...(width ? { width } : {}), ...(height ? { height } : {}) };
}

// ───────────── the interface figure ─────────────

export interface Port {
  readonly href: string;
  readonly label: string;
  readonly out: boolean;
  /** The case-study route: a word of Schematic's own. */
  readonly own?: boolean;
}

export interface Depth {
  readonly measured: readonly string[];
  readonly parts: readonly string[];
  readonly references: readonly { title: string; by: readonly string[]; note?: number }[];
  /** Role and period, shown when nothing is measured. */
  readonly role?: string;
}

/** The optional content-extension override (phase 2): `{ in, out }`, both present, or none. */
function overrideOf(work: Work): { in: string; out: string } | undefined {
  const ext = (work as { extensions?: Record<string, unknown> }).extensions?.[
    '@portfolio/content-schematic'
  ] as { interface?: { in?: unknown; out?: unknown } } | undefined;
  const io = ext?.interface;
  return typeof io?.in === 'string' &&
    typeof io.out === 'string' &&
    present(io.in) &&
    present(io.out)
    ? { in: io.in, out: io.out }
    : undefined;
}

/**
 * A work's interface: its ports (its links, its url, and its case-study
 * route, left out on its own page) and IN/OUT, from the content extension's
 * override, else the first sentence of caseStudy.challenge (In) and of
 * caseStudy.outcomes (Out), both or neither; else none, never invented.
 */
export function interfaceOf(
  work: Work,
  input: VariantRenderInput,
  { full = false }: { full?: boolean } = {},
): { ports: readonly Port[]; io?: { in: string; out: string } } {
  const { t } = stringsFor(input.portfolio.locale);
  const ports: Port[] = [
    ...(work.links ?? []).map((link) => ({
      href: hrefFor(link.url, input),
      label: linkLabel(link),
      out: outbound(link.url),
    })),
    ...(present(work.url)
      ? [{ href: hrefFor(work.url, input), label: t.read, out: outbound(work.url), own: true }]
      : []),
  ];
  if (isRoutedWork(work) && !full) {
    ports.push({
      href: routeHref(input, { route: 'work', slug: work.slug }),
      label: t.caseStudy,
      out: false,
      own: true,
    });
  }
  const override = overrideOf(work);
  const challenge = firstSentence(work.caseStudy?.challenge);
  const outcomes = firstSentence(work.caseStudy?.outcomes);
  const io = override ?? (challenge && outcomes ? { in: challenge, out: outcomes } : undefined);
  return io ? { ports, io } : { ports };
}

/** A work's depth: what it measured, its parts, what it cites, and its role when nothing is measured. */
export function depthOf(
  work: Work,
  input: VariantRenderInput,
  noteOf: ReadonlyMap<string, number>,
): Depth {
  const measured = (work.highlights ?? []).filter(present);
  const parts = (work.tools ?? []).filter(present);
  const references = evidenceByIds(work.evidence ?? [], input).map((entry) => {
    const date = entry.receivedAt ?? entry.publishedAt ?? entry.presentedAt;
    const by = [entry.organization ?? entry.publication ?? entry.venue, date].filter(present);
    const note = noteOf.get(entry.id);
    return {
      title: plainInline(entry.title ?? entry.statement ?? ''),
      by,
      ...(note ? { note } : {}),
    };
  });
  const role = measured.length === 0 && present(work.role) ? work.role : undefined;
  return { measured, parts, references, ...(role ? { role } : {}) };
}

/** The count dimension over a depth region, such as "3 measured values, 3 parts, 2 references". */
export function depthCount(depth: Depth, locale: string): string {
  const { t } = stringsFor(locale);
  return [
    depth.measured.length ? t.measuredValues(depth.measured.length) : '',
    depth.parts.length ? t.partsCount(depth.parts.length) : '',
    depth.references.length ? t.referencesCount(depth.references.length) : '',
  ]
    .filter(present)
    .join(', ');
}

/** Whether a depth region has anything to draw. */
export const hasDepth = (depth: Depth) =>
  depth.measured.length + depth.parts.length + depth.references.length > 0 || !!depth.role;

// ───────────── forms ─────────────

export type WorkForm = 'drawings' | 'photos' | 'record' | 'essays' | 'episodes';

/** How a works section draws, from its works' mediums alone. */
export function workForm(works: readonly Work[]): WorkForm {
  const all = (...media: string[]) =>
    works.length > 0 && works.every((w) => media.includes(w.medium));
  if (all('image-series', 'photography')) return 'photos';
  // A set of records draws as records once any of them lists its tracks; one without draws its head alone.
  if (all('music') && works.some((w) => (w.tracks?.length ?? 0) > 0)) return 'record';
  if (all('writing', 'research')) return 'essays';
  if (all('audio-video')) return 'episodes';
  return 'drawings';
}

export type EvidenceForm =
  | 'chain'
  | 'references'
  | 'schedule'
  | 'reports'
  | 'signoff'
  | 'certificates'
  | 'patents'
  | 'related'
  | 'list';

const EVIDENCE_FORMS: Readonly<Record<string, EvidenceForm>> = {
  metric: 'chain',
  publication: 'references',
  talk: 'schedule',
  press: 'reports',
  testimonial: 'signoff',
  award: 'certificates',
  patent: 'patents',
  'external-work': 'related',
};

/** How an evidence section draws: its one type's form, else a plain list of references. */
export function evidenceForm(entries: readonly Evidence[]): EvidenceForm {
  const type = entries[0]?.type;
  if (!type || !entries.every((entry) => entry.type === type)) return 'list';
  if (type === 'metric' && !entries.every((entry) => typeof entry.metric?.value === 'number')) {
    return 'list';
  }
  return EVIDENCE_FORMS[type] ?? 'list';
}

// ───────────── the sheet set ─────────────

export type SheetId = DestinationId;

/** The sheets in drawing order: About, Work, Writing, Record, Contact. */
export const SHEET_ORDER: readonly SheetId[] = ['about', 'work', 'writing', 'record', 'contact'];

export interface View {
  readonly section: Section;
  /** Its number on its sheet, from 1. */
  readonly no: number;
  /** Its title: the owner's, else a kind label of Schematic's own. */
  readonly title: string;
  readonly own: boolean;
  /** Whether it folds on phones (the generic FOLD_KIND rule, SC-S6). */
  readonly folds: boolean;
  /** Whether home's outline shows it closed, at every width (N3): see closedOf. */
  readonly closed: boolean;
  /** The first figure number its body draws, when it draws any. */
  readonly fig?: number;
}

export interface Sheet {
  readonly id: SheetId;
  /** Its number in the set, from 1, after empty sheets drop. */
  readonly n: number;
  /** Its reference, S-01. */
  readonly no: string;
  readonly label: string;
  readonly lang?: string;
  readonly views: readonly View[];
}

export interface SheetSet {
  readonly cover?: Section;
  readonly sheets: readonly Sheet[];
  readonly viewOf: ReadonlyMap<string, View & { sheet: Sheet }>;
  /** The figures each section's body draws, so the page numbers them in reading order. */
  readonly signature?: Work;
  readonly notes: readonly Evidence[];
  readonly noteOf: ReadonlyMap<string, number>;
  readonly outline: PageOutline;
}

/** Sheet ids the grouping hook declares, each standing for its own destination. */
export const GROUPING: GroupingOptions<SheetId> = {
  groups: SHEET_ORDER.map((id) => ({ id, destination: id })),
  // The cover takes the hero; everything else goes to its destination's sheet.
  groupOf: (section) => (section.kind === 'hero' ? null : undefined),
  // An untitled lede, a custom or an extension section: About, the sheet of the person.
  unplaced: 'about',
};

/** A view's title: the owner's, else the kind's label of Schematic's own (never invented content). */
export function viewTitle(section: Section, locale: string): { text: string; own: boolean } {
  if (present(section.title)) return { text: section.title, own: true };
  const { t } = stringsFor(locale);
  return { text: t.kind[section.kind] ?? t.kind.custom!, own: false };
}

/** How many figures a section's body draws, for page-wide numbering. */
function figuresIn(
  section: Section,
  input: VariantRenderInput,
  signature: Work | undefined,
): number {
  switch (section.kind) {
    case 'works': {
      const works = worksOf(section, input);
      const form = workForm(works);
      if (form === 'photos' || form === 'record') return works.length;
      if (form === 'drawings') return works.filter((work) => work.id !== signature?.id).length;
      return 0;
    }
    case 'evidence':
      return evidenceForm(evidenceOf(section, input)) === 'chain' ? 1 : 0;
    case 'github': {
      const snap = githubSnapshot(section, input);
      return snap?.state === 'ready' &&
        section.showContributionGraph !== false &&
        snap.value.contributionCalendar.length >= 14
        ? 1
        : 0;
    }
    default:
      return 0;
  }
}

/** The generic phone-fold rule (FOLD_KIND): skills and tools, a later chronology, awards and patents. */
function folds(
  section: Section,
  input: VariantRenderInput,
  firstChronology: string | undefined,
): boolean {
  if (section.kind === 'practice') return section.part === 'skills' || section.part === 'tools';
  if (section.kind === 'chronology') return section.id !== firstChronology;
  if (section.kind === 'evidence') {
    const entries = evidenceOf(section, input);
    return entries.length > 0 && entries.every((e) => e.type === 'award' || e.type === 'patent');
  }
  return false;
}

/**
 * Home's outline (N3, night-2 item 8): display grouping only, no section
 * moves and none is dropped. The sections a sheet shows closed, behind a
 * native disclosure with its view title, number and Index entry, so home
 * carries the cover, a handful of works and the record's two summaries.
 * Work and Writing keep the works section that holds the signature, else
 * their first, open; Record keeps its figures at a glance (a metric chain)
 * and its words from collaborators, and a Record of neither keeps its
 * first section; About keeps the person (the thesis, the lede, Now, a
 * custom note) and closes what follows them (focus, skills, fun facts, a
 * quotation, stack, services), so they run as one schedule on a phone too
 * (Design gate item 8: Skills and Stack sit behind closed disclosures);
 * Contact keeps everything.
 */
export function closedOf(
  sheet: SheetId,
  sections: readonly Section[],
  input: VariantRenderInput,
  signature: Work | undefined,
): ReadonlySet<string> {
  const closed = new Set<string>();
  if (sheet === 'work' || sheet === 'writing') {
    const works = sections.filter((s) => s.kind === 'works');
    const kept =
      (signature
        ? works.find((s) => worksOf(s, input).some((work) => work.id === signature.id))
        : undefined) ??
      works[0] ??
      sections[0];
    for (const section of sections) if (section !== kept) closed.add(section.id);
  } else if (sheet === 'about') {
    for (const section of sections) {
      if (
        section.kind === 'focus' ||
        section.kind === 'fun-facts' ||
        section.kind === 'quote' ||
        (section.kind === 'practice' &&
          (section.part === 'services' || section.part === 'skills' || section.part === 'tools'))
      )
        closed.add(section.id);
    }
  } else if (sheet === 'record') {
    for (const section of sections) {
      const form =
        section.kind === 'evidence' ? evidenceForm(evidenceOf(section, input)) : undefined;
      if (form !== 'chain' && form !== 'signoff') closed.add(section.id);
    }
    if (closed.size === sections.length && sections[0]) closed.delete(sections[0].id);
  }
  return closed;
}

/** The repositories a GitHub section shows, once its snapshot is ready: pinned, then recently active, deduplicated, at most eight. */
export function githubRepos(section: SectionOf<'github'>, input: VariantRenderInput) {
  const snapshot = githubSnapshot(section, input);
  if (!snapshot || snapshot.state !== 'ready') return undefined;
  const data = snapshot.value;
  const excluded = new Set(section.excludeRepos ?? []);
  const seen = new Set<string>();
  return [
    ...(section.showPinnedRepos !== false ? data.pinnedRepos : []),
    ...(section.showRecentlyActive !== false ? data.recentlyActive : []),
  ]
    .filter(
      (repo) => !excluded.has(repo.name) && !seen.has(repo.name) && (seen.add(repo.name), true),
    )
    .slice(0, 8);
}

/**
 * How many entries a closed view holds, for its row in the schedule: every
 * list counts its entries, a quotation counts one, and a GitHub section its
 * repositories once its snapshot is ready, else its one profile link.
 */
export function countOf(section: Section, input: VariantRenderInput): number | undefined {
  switch (section.kind) {
    case 'works':
      return worksOf(section, input).length;
    case 'evidence':
      return evidenceOf(section, input).length;
    case 'chronology':
      return chronologyOf(section, input).length;
    case 'focus':
    case 'fun-facts':
      return section.items.filter(present).length;
    case 'quote':
      return present(section.text) ? 1 : 0;
    case 'github':
      return githubRepos(section, input)?.length ?? 1;
    case 'practice': {
      // A bill of materials counts its rows (a group each); services count their work orders.
      const practice = input.portfolio.practice;
      if (section.part === 'skills') return practice?.skills?.length ?? 0;
      if (section.part === 'tools') return practice?.tools?.length ?? 0;
      if (section.part === 'services')
        return (practice?.services ?? []).reduce((n, group) => n + group.items.length, 0);
      return undefined;
    }
    default:
      return undefined;
  }
}

/** Home shows this many of a drawings section's figures; the rest wait behind "n more" (N3). */
export const DRAWINGS_SHOWN = 5;

const SETS = new WeakMap<VariantRenderInput, SheetSet>();

/**
 * The sheet set: the cover (the hero), then one sheet per destination with
 * sections, through the kit's grouping hook (K-1), in drawing order or, with
 * sheetOrder authored, by where each sheet's first section sits. Empty
 * sheets drop and the rest renumber; the authored order holds within each.
 * View numbers run per sheet, figure numbers page-wide (Figure 1 on the
 * cover), both in reading order. Memoised per render input.
 */
export function sheetSet(input: VariantRenderInput): SheetSet {
  const cached = SETS.get(input);
  if (cached) return cached;
  const outline = pageOutline(input);
  const nav = navigationModel(outline, { grouping: GROUPING });
  const byId = new Map(input.portfolio.sections.map((section) => [section.id, section]));
  const locale = input.portfolio.locale;
  const { t, lang } = stringsFor(locale);
  const cover = outline.sections
    .map((section) => byId.get(section.id))
    .find((section) => section?.kind === 'hero');
  const signature = signatureOf(input);
  const notes = proofOf(input);
  const noteOf = new Map(notes.map((entry, i) => [entry.id, i + 1]));
  const position = new Map(outline.sections.map((section, i) => [section.id, i]));
  const groups = [...nav.groups];
  if (input.controls.sheetOrder === 'authored') {
    const first = (g: (typeof groups)[number]) =>
      Math.min(...g.sections.map((s) => position.get(s.id) ?? Infinity));
    groups.sort((a, b) => first(a) - first(b));
  }
  // Figure 1 is the cover's, drawn whether or not the portfolio has a hero.
  let fig = signature ? 2 : 1;
  const viewOf = new Map<string, View & { sheet: Sheet }>();
  const sheets: Sheet[] = [];
  for (const group of groups) {
    const sections = group.sections
      .map((s) => byId.get(s.id))
      .filter((s): s is Section => s !== undefined && s.kind !== 'hero');
    if (sections.length === 0) continue;
    const n = sheets.length + 1;
    const firstChronology = sections.find((s) => s.kind === 'chronology')?.id;
    const closed = closedOf(group.id, sections, input, signature);
    const views: View[] = sections.map((section, i) => {
      const count = figuresIn(section, input, signature);
      const title = viewTitle(section, locale);
      const view: View = {
        section,
        no: i + 1,
        title: title.text,
        own: title.own,
        closed: closed.has(section.id),
        folds: !closed.has(section.id) && folds(section, input, firstChronology),
        ...(count > 0 ? { fig } : {}),
      };
      fig += count;
      return view;
    });
    const sheet: Sheet = {
      id: group.id,
      n,
      no: `S-${String(n).padStart(2, '0')}`,
      label: t.sheetLabel[group.id] ?? group.label,
      ...(lang ? { lang } : {}),
      views,
    };
    for (const view of views) viewOf.set(view.section.id, { ...view, sheet });
    sheets.push(sheet);
  }
  const set: SheetSet = {
    ...(cover ? { cover } : {}),
    sheets,
    viewOf,
    ...(signature ? { signature } : {}),
    notes,
    noteOf,
    outline,
  };
  SETS.set(input, set);
  return set;
}

/** The revision numbers of a chronology section's entries, counting down: 04, 03, 02, 01. */
export function revisionsOf(entries: readonly ChronologyEntry[]): ReadonlyMap<string, string> {
  const pad = String(entries.length).length < 2 ? 2 : String(entries.length).length;
  return new Map(
    entries.map((entry, i) => [entry.id, String(entries.length - i).padStart(pad, '0')]),
  );
}

/** A chronology section's entries, for the revision block. */
export const entriesOf = (section: Section, input: VariantRenderInput) =>
  chronologyOf(section, input);

/** The title block's Revised cell: the first Now section's asOf. */
export function revisedOf(input: VariantRenderInput): string | undefined {
  const now = input.portfolio.sections.find((s) => s.kind === 'now') as
    Extract<Section, { kind: 'now' }> | undefined;
  return present(now?.asOf) ? now.asOf : undefined;
}

/** The title block's Title cell: the thesis's first sentence, else the identity tagline. */
export function titleOf(input: VariantRenderInput): string | undefined {
  return (
    firstSentence(input.portfolio.practice?.thesis) ??
    (present(input.portfolio.identity.tagline)
      ? squash(input.portfolio.identity.tagline)
      : undefined)
  );
}

/** Essay sheet heights, in rem: 15 + 9 × reading time / the longest; 15 without one. */
export function essayHeights(works: readonly Work[]): ReadonlyMap<string, number> {
  const max = Math.max(0, ...works.map((w) => w.readingTimeMinutes ?? 0));
  return new Map(
    works.map((w) => [
      w.id,
      max > 0 && w.readingTimeMinutes
        ? Math.round((15 + (9 * w.readingTimeMinutes) / max) * 100) / 100
        : 15,
    ]),
  );
}

/** Each essay's reading time over the longest's, 0 to 1: the share the sheet's height scales by. */
export function essayShares(works: readonly Work[]): ReadonlyMap<string, number> {
  const max = Math.max(0, ...works.map((w) => w.readingTimeMinutes ?? 0));
  return new Map(
    works.map((w) => [
      w.id,
      max > 0 && w.readingTimeMinutes ? Math.round((w.readingTimeMinutes / max) * 1000) / 1000 : 0,
    ]),
  );
}

/** Whole months from one loose date to another, or none when either doesn't parse. */
export function monthsBetween(
  from: string | undefined,
  to: string | undefined,
): number | undefined {
  const parse = (raw: string | undefined) => {
    const match = /^(\d{4})(?:-(\d{2}))?/.exec(raw ?? '');
    return match ? Number(match[1]) * 12 + (match[2] ? Number(match[2]) - 1 : 0) : undefined;
  };
  const a = parse(from);
  const b = parse(to);
  return a === undefined || b === undefined || b < a ? undefined : b - a;
}

/** A GitHub calendar's weekly sums, from its first day, seven days a week. */
export function weeklySums(
  days: readonly { date: string; count: number }[],
): readonly { start: string; sum: number }[] {
  const weeks: { start: string; sum: number }[] = [];
  for (let i = 0; i < days.length; i += 7) {
    const week = days.slice(i, i + 7);
    weeks.push({ start: week[0]!.date, sum: week.reduce((a, d) => a + d.count, 0) });
  }
  return weeks;
}

/** The pen trace's path over a 1000 × 100 box, and its busiest week. */
export function penTrace(weeks: readonly { start: string; sum: number }[]): {
  line: string;
  area: string;
  busiest?: { start: string; sum: number };
} {
  if (weeks.length < 2) return { line: '', area: '' };
  const max = Math.max(1, ...weeks.map((w) => w.sum));
  const x = (i: number) => ((i / (weeks.length - 1)) * 1000).toFixed(1);
  const y = (v: number) => (100 - (v / max) * 94).toFixed(1);
  const line = weeks.map((w, i) => `${i ? 'L' : 'M'}${x(i)} ${y(w.sum)}`).join(' ');
  const busiest = weeks.reduce((a, w) => (w.sum > a.sum ? w : a));
  return { line, area: `${line} H1000 V100 H0 Z`, busiest };
}

// ───────────── the detail sheet (a work's own page) ─────────────

export type DetailViewKey = 'elevation' | 'section' | 'decisions' | 'report' | 'revision';

/** One view on a detail sheet: its key, its code (A, A–A, ECN, TR, Δ), its title and its id. */
export interface DetailView {
  readonly key: DetailViewKey;
  readonly code: string;
  readonly title: string;
  readonly id: string;
}

export interface Detail {
  /** W-01: its number among the works with their own page, in their order. */
  readonly no: string;
  readonly n: number;
  readonly total: number;
  readonly id: string;
  readonly titleId: string;
  /** The home sheet that draws the work, for the crumb and the way back. */
  readonly home?: {
    readonly no: string;
    readonly label: string;
    readonly lang?: string;
    readonly href: string;
  };
  readonly views: readonly DetailView[];
}

/**
 * A work's detail sheet: its number, the home sheet that draws it, and the
 * views its case study fills. The elevation always draws (the work's
 * interface figure); the section cut when it has a context, constraints or
 * a role; change notices when it has decisions; the test report when it
 * has outcomes or evidence; the next revision when it has a reflection.
 */
export function detailOf(
  input: VariantRenderInput,
  work: Work,
  outline: {
    readonly parts: readonly { readonly key: string }[];
    readonly works: readonly { readonly id: string }[];
  },
): Detail {
  const { t } = stringsFor(input.portfolio.locale);
  const index = outline.works.findIndex((each) => each.id === work.id);
  const n = index + 1 || 1;
  const no = t.detailNo(n);
  const set = sheetSet(input);
  const sheet = set.sheets.find((s) =>
    s.views.some(
      (view) =>
        view.section.kind === 'works' && worksOf(view.section, input).some((w) => w.id === work.id),
    ),
  );
  const has = (...keys: string[]) => outline.parts.some((part) => keys.includes(part.key));
  const id = `${input.ids.prefix}sx-detail-${work.id}`;
  const view = (key: DetailViewKey, title: string): DetailView => ({
    key,
    code: t.partCode[key]!,
    title,
    id: `${id}--${key}`,
  });
  const views = [
    view('elevation', t.elevation),
    ...(has('context', 'constraints', 'role') ? [view('section', t.sectionCut)] : []),
    ...(has('decisions') ? [view('decisions', t.changeNotices)] : []),
    ...(has('outcomes', 'evidence') ? [view('report', t.testReport)] : []),
    ...(has('reflection') ? [view('revision', t.nextRevision)] : []),
  ];
  return {
    no,
    n,
    total: Math.max(outline.works.length, 1),
    id,
    titleId: `${id}--title`,
    ...(sheet
      ? {
          home: {
            no: sheet.no,
            label: sheet.label,
            ...(sheet.lang ? { lang: sheet.lang } : {}),
            href: `${routeHref(input, { route: 'home' })}#${input.ids.prefix}sx-sheet-${sheet.id}`,
          },
        }
      : {}),
    views,
  };
}

/**
 * A title block's rows drawn full, as a drawing's are: a one-column cell
 * without a one-column neighbour takes two, so a phone's two columns pair
 * only one-column cells, and the last cell of a four-column row that the
 * next can't join takes the rest of it.
 */
export function filledRows<T extends { span: 1 | 2 | 3 | 4 }>(cells: readonly T[]): T[] {
  const paired = cells.map((cell, i) =>
    cell.span === 1 && cells[i - 1]?.span !== 1 && cells[i + 1]?.span !== 1
      ? { ...cell, span: 2 as const }
      : cell,
  );
  const out: T[] = [];
  let used = 0;
  for (const cell of paired) {
    if (used > 0 && used + cell.span > 4) {
      const last = out.length - 1;
      out[last] = { ...out[last]!, span: (out[last]!.span + 4 - used) as T['span'] };
      used = 0;
    }
    out.push(cell);
    used = (used + cell.span) % 4;
  }
  if (used > 0 && out.length) {
    const last = out.length - 1;
    out[last] = { ...out[last]!, span: (out[last]!.span + 4 - used) as T['span'] };
  }
  return out;
}
