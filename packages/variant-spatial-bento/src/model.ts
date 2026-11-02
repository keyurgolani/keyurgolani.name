import type { ChronologyEntry, Section } from '@portfolio/schema';
import {
  chronologyOf,
  evidenceOf,
  present,
  worksOf,
  type OutlineSection,
  type PageOutline,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';

// Spatial Bento's page model: which sections the overview field claims,
// which board every other section sits on, and how each board's tiles pack
// into rows of the 12-column field. Pure, and read from the render input
// alone, so the server, a plate, and a test all get the same answer, and
// the plane drawings and the stylesheet's spans come from one place.

/** The boards after the overview, in page order. */
export const BOARD_IDS = ['work', 'writing', 'record', 'about', 'contact'] as const;
export type BoardId = (typeof BOARD_IDS)[number];

/** Each board's name: the composition's own navigation words. */
export const BOARD_NAMES: Readonly<Record<BoardId, string>> = {
  // The Work destination, relabelled: its board holds the practice, the
  // engagements and the tools, while the works themselves are Selected work.
  work: 'Practice',
  writing: 'Writing',
  record: 'Record',
  about: 'About',
  contact: 'Contact',
};

/** The most common value, ties to the first seen; undefined for none. */
function mostOf<T>(values: readonly T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: T | undefined;
  let most = 0;
  for (const [value, n] of counts) {
    if (n > most) {
      best = value;
      most = n;
    }
  }
  return best;
}

/** What a works section mostly holds. */
export function worksMedium(section: Section, input: VariantRenderInput): string | undefined {
  return mostOf(worksOf(section, input).map((work) => work.medium));
}

/** What an evidence section mostly holds. */
export function evidenceType(section: Section, input: VariantRenderInput): string | undefined {
  return mostOf(evidenceOf(section, input).map((entry) => entry.type));
}

/** The evidence types the full record holds. */
const RECORD_EVIDENCE = new Set([
  'publication',
  'talk',
  'award',
  'patent',
  'press',
  'external-work',
  'repository',
]);

/**
 * Whether a section is part of the full record (design gate 8): Experience
 * in detail, Education, Publications, Talks, Awards, Patents, Press,
 * Elsewhere, GitHub, Skills and Stack. Home keeps them at the end of the
 * Record board, each behind a closed disclosure in one tile; each stays on
 * its own board for the dock, the Menu, Contents and the board's index.
 */
export function archived(section: Section, input: VariantRenderInput): boolean {
  switch (section.kind) {
    case 'chronology':
    case 'github':
      return true;
    case 'practice':
      return section.part === 'skills' || section.part === 'tools';
    case 'evidence':
      return RECORD_EVIDENCE.has(evidenceType(section, input) ?? '');
    default:
      return false;
  }
}

/** The owner's latest role, for the Record board's summary: the one still open, else the last to end. */
export function latestRole(
  sections: readonly Section[],
  input: VariantRenderInput,
): { readonly section: Section; readonly entry: ChronologyEntry } | undefined {
  const roles = sections.flatMap((section) =>
    section.kind === 'chronology'
      ? chronologyOf(section, input)
          .filter((entry) => entry.kind === 'role')
          .map((entry) => ({ section, entry }))
      : [],
  );
  return roles.reduce<(typeof roles)[number] | undefined>(
    (best, each) => (best === undefined || laterRole(each.entry, best.entry) > 0 ? each : best),
    undefined,
  );
}

/** Two ISO dates of any precision in order: by their text, so a year comes before a month in it. */
const byDate = (a: string, b: string): number => (a === b ? 0 : a < b ? -1 : 1);

/** Which of two roles is the later: one still open, else the later end, else the later start. */
export function laterRole(a: ChronologyEntry, b: ChronologyEntry): number {
  const open = Number(a.period.end === undefined) - Number(b.period.end === undefined);
  if (open !== 0) return open;
  return byDate(a.period.end ?? '', b.period.end ?? '') || byDate(a.period.start, b.period.start);
}

/** Whether every entry a chronology section lists is a study. */
export function allStudies(section: Section, input: VariantRenderInput): boolean {
  const entries = chronologyOf(section, input);
  return entries.length > 0 && entries.every((entry) => entry.kind === 'study');
}

const WRITING_MEDIA = new Set(['writing', 'audio-video']);
const PERSONAL_MEDIA = new Set(['photography', 'image-series', 'music']);
const WRITING_EVIDENCE = new Set(['publication', 'talk', 'press', 'recording']);

/** The board a section sits on, from its kind and what it holds. */
export function boardOf(section: Section, input: VariantRenderInput): BoardId {
  switch (section.kind) {
    case 'works': {
      const medium = worksMedium(section, input) ?? '';
      if (WRITING_MEDIA.has(medium)) return 'writing';
      if (PERSONAL_MEDIA.has(medium)) return 'about';
      return 'work';
    }
    case 'evidence': {
      const type = evidenceType(section, input) ?? '';
      if (WRITING_EVIDENCE.has(type)) return 'writing';
      if (type === 'repository') return 'work';
      if (type === 'external-work') return 'about';
      return 'record';
    }
    case 'practice':
      return section.part === 'thesis' ? 'about' : 'work';
    case 'github':
      return 'work';
    case 'chronology':
      return 'record';
    case 'contact':
    case 'cta':
      return 'contact';
    default:
      return 'about';
  }
}

/** The sections the overview field claims, each at most once, and the shape it takes. */
export interface Overview {
  readonly hero?: Section;
  /** The practice thesis, set in the hero's tile as its display line and lede. */
  readonly thesis?: Section;
  readonly now?: Section;
  /** The first evidence section of metrics alone: a ledger. */
  readonly glance?: Section;
  /** The works section that leads: the signature's, else the first. */
  readonly showcase?: Section;
  /** The top band's side column: now and the ledger, one of them, or neither. */
  readonly top: 'both' | 'now' | 'glance' | 'none';
  /** How many work tiles the bottom band holds: the showcase's works, three at most. */
  readonly works: 0 | 1 | 2 | 3;
}

/** The most works a showcase holds: the signature plate, the band, and two in the rest tile. */
export const SHOWCASE_MOST = 4;

/** A showcase's works in the order the field sets them: the signature first, then the rest as written. */
export function showcaseOrder<W extends { readonly id: string }>(
  works: readonly W[],
  signature: string | undefined,
): readonly W[] {
  const lead = works.find((work) => work.id === signature);
  return lead ? [lead, ...works.filter((work) => work !== lead)] : works;
}

/** The overview: what it claims of the sections that render, in their reading order. */
export function overviewOf(sections: readonly Section[], input: VariantRenderInput): Overview {
  const hero = sections.find((section) => section.kind === 'hero');
  const thesis = sections.find(
    (section) => section.kind === 'practice' && section.part === 'thesis',
  );
  const now = sections.find((section) => section.kind === 'now');
  const glance = sections.find(
    (section) =>
      section.kind === 'evidence' &&
      evidenceOf(section, input).every((entry) => entry.type === 'metric'),
  );
  const signature = input.portfolio.signature;
  const works = sections.filter(
    (section) =>
      section.kind === 'works' &&
      !WRITING_MEDIA.has(worksMedium(section, input) ?? '') &&
      !PERSONAL_MEDIA.has(worksMedium(section, input) ?? ''),
  );
  // The field holds four works at most, so a longer section stays on the Work board, whole.
  const fits = works.filter((section) => worksOf(section, input).length <= SHOWCASE_MOST);
  const showcase =
    fits.find(
      (section) =>
        signature !== undefined && worksOf(section, input).some((w) => w.id === signature),
    ) ?? fits[0];
  const count = showcase ? worksOf(showcase, input).length : 0;
  const top = now && glance ? 'both' : now ? 'now' : glance ? 'glance' : 'none';
  return {
    ...(hero ? { hero } : {}),
    ...(thesis ? { thesis } : {}),
    ...(now ? { now } : {}),
    ...(glance ? { glance } : {}),
    ...(showcase ? { showcase } : {}),
    top,
    works: Math.min(count, 3) as Overview['works'],
  };
}

/** The ids the overview claims. */
export function claimed(overview: Overview): ReadonlySet<string> {
  return new Set(
    [overview.hero, overview.thesis, overview.now, overview.glance, overview.showcase].flatMap(
      (section) => (section ? [section.id] : []),
    ),
  );
}

/** How a tile wants to sit in a row: its preferred span of 12, its least, and whether it takes a row alone. */
export interface TileSize {
  readonly prefer: number;
  readonly least: number;
  readonly wide: boolean;
}

const size = (prefer: number, least: number, wide = false): TileSize => ({ prefer, least, wide });

/** A section's tile size, from its kind and what it holds. */
export function tileSize(section: Section, input: VariantRenderInput): TileSize {
  switch (section.kind) {
    case 'github':
      return size(12, 12, true);
    case 'chronology':
      return allStudies(section, input) ? size(4, 4) : size(12, 12, true);
    case 'evidence': {
      const type = evidenceType(section, input);
      const n = evidenceOf(section, input).length;
      if (type === 'testimonial') return n > 1 ? size(12, 12, true) : size(6, 4);
      if (type === 'publication') return size(4, 4);
      if (type === 'press') return size(4, 3);
      if (type === 'talk') return size(5, 4);
      if (type === 'external-work') return size(5, 4);
      return size(4, 3);
    }
    case 'works': {
      const medium = worksMedium(section, input);
      const n = worksOf(section, input).length;
      if (medium === 'writing') return size(5, 4);
      if (medium === 'audio-video') return size(5, 4);
      if (medium === 'image-series' || medium === 'photography') return size(5, 4);
      if (medium === 'music') return size(5, 4);
      return n > 2 ? size(12, 12, true) : size(6, 4);
    }
    case 'practice':
      if (section.part === 'services') return size(9, 6);
      if (section.part === 'tools') return size(7, 5);
      if (section.part === 'skills') return size(5, 4);
      return size(7, 5);
    case 'lede':
      return size(5, 4);
    case 'quote':
      // Wide enough to close a board as its own band, in display type, rather than leave a row short.
      return size(9, 5);
    case 'cta':
      return size(7, 5);
    case 'contact':
      return size(5, 4);
    case 'focus':
      return size(3, 3);
    case 'custom':
      return size(6, 4);
    default:
      return size(4, 3);
  }
}

/** A tile on a board, with its spans at the wide and the middle layouts. */
export interface PlacedTile {
  readonly section: Section;
  /** Columns of 12 at the wide layout. */
  readonly span: number;
  /** Columns of 6 at the middle layout. */
  readonly spanMd: number;
  /** Its row at the wide layout, from 0, and how many rows it takes there. */
  readonly row: number;
  readonly rows: 1 | 2;
  /** Its start column at the wide layout, from 0, the label's three counted. */
  readonly col: number;
  /** Whether the stylesheet sets its start column: the lower of a stacked pair. */
  readonly fixed: boolean;
  /** Whether it's the board's one inverse plate. */
  readonly inverse: boolean;
}

/** Spans for a row's tiles that fill `available` columns exactly, each at least its least. */
export function distribute(sizes: readonly TileSize[], available: number): number[] {
  if (sizes.length === 1) return [available];
  const total = sizes.reduce((sum, { prefer }) => sum + prefer, 0);
  const spans = sizes.map(({ prefer, least }) =>
    Math.max(least, Math.round((prefer * available) / total)),
  );
  let over = spans.reduce((sum, span) => sum + span, 0) - available;
  // Take from the tile with the most room over its least, or give to the widest-preferring one.
  while (over !== 0) {
    if (over > 0) {
      let index = -1;
      let room = 0;
      spans.forEach((span, i) => {
        if (span - sizes[i]!.least > room) {
          room = span - sizes[i]!.least;
          index = i;
        }
      });
      if (index < 0) break;
      spans[index]! -= 1;
      over -= 1;
    } else {
      let index = 0;
      sizes.forEach((each, i) => {
        if (each.prefer > sizes[index]!.prefer) index = i;
      });
      spans[index]! += 1;
      over += 1;
    }
  }
  return spans;
}

/** The most tiles a row holds. */
const ROW_MAX = 3;

/**
 * Tiles in reading order, packed into rows that each fill their columns:
 * `first` columns in the first row, where the board's label takes the rest,
 * and `columns` after it. A wide tile takes a row alone. A last row of one
 * tile takes the previous row's last, when that leaves the previous row two.
 */
export function pack(
  sizes: readonly TileSize[],
  columns: number,
  first: number,
): { spans: number[]; rows: number[] } {
  const rows: number[][] = [];
  let index = 0;
  while (index < sizes.length) {
    const available = rows.length === 0 ? first : columns;
    const row: number[] = [];
    let least = 0;
    while (index < sizes.length && row.length < ROW_MAX) {
      const tile = sizes[index]!;
      const fits = Math.min(tile.least, available);
      if (row.length > 0 && (tile.wide || least + fits > available)) break;
      row.push(index);
      least += fits;
      index += 1;
      if (tile.wide) break;
    }
    rows.push(row);
  }
  const last = rows.at(-1);
  const before = rows.at(-2);
  if (
    rows.length > 1 &&
    last?.length === 1 &&
    !sizes[last[0]!]!.wide &&
    before !== undefined &&
    before.length > 2
  ) {
    last.unshift(before.pop()!);
  }
  const spans: number[] = [];
  const rowOf: number[] = [];
  rows.forEach((row, r) => {
    const available = r === 0 ? first : columns;
    const clipped = row.map((i) => {
      const { prefer, least, wide } = sizes[i]!;
      return size(Math.min(prefer, available), Math.min(least, available), wide);
    });
    distribute(clipped, available).forEach((span, k) => {
      spans[row[k]!] = span;
      rowOf[row[k]!] = r;
    });
  });
  return { spans, rows: rowOf };
}

/** The kinds that may be a board's one inverse plate, most wanted first. */
function inverseRank(section: Section, input: VariantRenderInput): number {
  if (section.kind === 'github') return 1;
  if (section.kind === 'evidence' && evidenceType(section, input) === 'testimonial') return 2;
  if (section.kind === 'quote') return 3;
  if (section.kind === 'works' && worksMedium(section, input) === 'audio-video') return 4;
  return 0;
}

/**
 * Where a section stands on its board before the rows are packed: what the
 * owner offers and has made first, then what shows it working, then the
 * inventory of skills and tools, so the Work board opens on the work, not
 * a list of what it's made with. Otherwise reading order.
 */
function leadRank(section: Section): number {
  if (section.kind === 'practice') {
    if (section.part === 'services') return 0;
    if (section.part === 'tools') return 3;
    if (section.part === 'skills') return 4;
  }
  if (section.kind === 'github') return 2;
  return 1;
}

/** A board's sections, the lead ranks first, each rank in reading order. */
export function leadFirst(sections: readonly Section[]): Section[] {
  return sections
    .map((section, index) => ({ section, index, rank: leadRank(section) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ section }) => section);
}

/** One board: its id, name, and tiles, packed. */
export interface Board {
  readonly id: BoardId;
  readonly name: string;
  /** The tiles it sets on its field. */
  readonly tiles: readonly PlacedTile[];
  /** Every section it stands for, its tiles' then those in the full record: its index, count and Menu entries. */
  readonly members: readonly Section[];
  /** The full record, on the Record board alone: every board's sections that sit behind its disclosures. */
  readonly archive?: readonly Section[];
  /** The owner's latest role, the Record board's summary beside its testimonials. */
  readonly latest?: { readonly section: Section; readonly entry: ChronologyEntry };
  /** How many rows its tiles take at the wide layout. */
  readonly rows: number;
  /** Whether its first row is a stacked one, so the label takes both of its rows. */
  readonly tallFirst: boolean;
}

/** The label takes three columns of the first row at the wide layout. */
export const LABEL_SPAN = 3;

/** The boards, in page order, each with the sections that sit on it in reading order. Empty ones are left out. */
export function boardsOf(
  sections: readonly Section[],
  overview: Overview,
  input: VariantRenderInput,
): Board[] {
  const taken = claimed(overview);
  const rest = sections.filter((section) => !taken.has(section.id));
  const record = rest.filter((section) => archived(section, input));
  return BOARD_IDS.flatMap((id) => {
    const all = leadFirst(rest.filter((section) => boardOf(section, input) === id));
    const found = all.filter((section) => !archived(section, input));
    const held = all.filter((section) => archived(section, input));
    const archive = id === 'record' ? record : [];
    const latest = id === 'record' ? latestRole(rest, input) : undefined;
    const extra = { ...(archive.length > 0 ? { archive } : {}), ...(latest ? { latest } : {}) };
    if (found.length === 0) {
      if (held.length === 0 && archive.length === 0) return [];
      return [
        {
          id,
          name: BOARD_NAMES[id],
          tiles: [],
          members: held,
          rows: 0,
          tallFirst: false,
          ...extra,
        },
      ];
    }
    // Rows packed by how tall each tile comes out, so a row's tiles end level.
    const costs = found.map((section) => {
      const content = contentOf(section, input);
      return { ...tileSize(section, input), height: (span: number) => heightAt(content, span) };
    });
    const wide = packByHeight(costs, 12, 12 - LABEL_SPAN);
    const mine = wide.order.map((i) => found[i]!);
    const places = wide.order.map((i) => wide.places[i]!);
    const sizes = wide.order.map((i) => costs[i]!);
    const middle = pack(
      sizes.map(({ prefer, wide: alone }) =>
        alone ? size(6, 6, true) : size(Math.ceil(prefer / 2), 3),
      ),
      6,
      6,
    );
    const ranks = mine.map((section) => inverseRank(section, input));
    const best = Math.min(...ranks.filter((rank) => rank > 0));
    const inverseAt = Number.isFinite(best) ? ranks.indexOf(best) : -1;
    const tiles = mine.map((section, i) => ({
      section,
      span: places[i]!.span,
      spanMd: middle.spans[i]!,
      row: places[i]!.row,
      rows: places[i]!.rows,
      col: places[i]!.col,
      fixed: places[i]!.fixed,
      inverse: i === inverseAt,
    }));
    return [
      {
        id,
        name: BOARD_NAMES[id],
        tiles,
        members: [...mine, ...held],
        rows: wide.rows,
        tallFirst: wide.tallFirst,
        ...extra,
      },
    ];
  });
}

/** A block on a plane: a tile's columns and rows on its board's grid, and its tone. */
export interface PlaneBlock {
  readonly c0: number;
  readonly c1: number;
  readonly r0: number;
  readonly r1: number;
  readonly tone: 'plain' | 'ink' | 'accent';
}

/** What a plane draws: its grid and its blocks. */
export interface PlaneModel {
  readonly columns: number;
  readonly rows: number;
  readonly blocks: readonly PlaneBlock[];
}

/** The overview's areas on its grid of 24 half columns by 9, as the stylesheet lays them out at the wide layout. */
export function overviewPlane(overview: Overview): PlaneModel {
  const blocks: PlaneBlock[] = [];
  const add = (c0: number, c1: number, r0: number, r1: number, tone: PlaneBlock['tone']) =>
    blocks.push({ c0, c1, r0, r1, tone });
  // The top band, on half columns: rows 0 to 4.
  if (overview.top === 'none') {
    add(0, 16, 0, 4, 'plain');
    add(17, 23, 0, 4, 'plain');
  } else {
    add(0, 11, 0, 4, 'plain');
    add(12, 16, 0, 4, 'plain');
    if (overview.top === 'both') {
      add(17, 23, 0, 2, 'plain');
      add(17, 23, 3, 4, 'plain');
    } else {
      add(17, 23, 0, 4, 'plain');
    }
  }
  // The bottom band, on whole columns, two half columns each: rows 5 to 8.
  switch (overview.works) {
    case 3:
      add(0, 9, 5, 8, 'plain');
      add(10, 17, 5, 8, 'ink');
      add(18, 23, 5, 6, 'plain');
      add(18, 23, 7, 8, 'accent');
      break;
    case 2:
      add(0, 9, 5, 8, 'plain');
      add(10, 17, 5, 8, 'ink');
      add(18, 23, 5, 8, 'accent');
      break;
    case 1:
      add(0, 17, 5, 8, 'plain');
      add(18, 23, 5, 8, 'accent');
      break;
    default:
      add(0, 23, 5, 8, 'accent');
  }
  return { columns: 24, rows: 9, blocks };
}

/** A board's tiles on its 12-column grid, where the wide layout sets them, the label's corner left bare. */
export function boardPlane(board: Board): PlaneModel {
  const blocks: PlaneBlock[] = board.tiles.map((tile) => ({
    c0: tile.col,
    c1: tile.col + tile.span - 1,
    r0: tile.row,
    r1: tile.row + tile.rows - 1,
    tone: tile.inverse ? 'ink' : tile.section.kind === 'cta' ? 'accent' : 'plain',
  }));
  return { columns: 12, rows: Math.max(board.rows, 2), blocks };
}

/** A board's sections as the page outline lists them, in the order the board sets its tiles. */
export function boardOutline(board: Board, outline: PageOutline): OutlineSection[] {
  const entries = new Map(outline.sections.map((entry) => [entry.id, entry]));
  return board.members.flatMap((section) => {
    const entry = entries.get(section.id);
    return entry ? [entry] : [];
  });
}

/** The DOM id of a board's anchor: the prefix, two hyphens, and its id, which no content id can take. */
export const boardAnchor = (input: VariantRenderInput, id: BoardId | 'overview') =>
  `${input.ids.prefix}sb--${id}`;

/**
 * Whether a board sets a field of its own on home: tiles, or on Record the
 * full record. A board every one of whose sections sits in the full record
 * has none, so it renders no label over nothing; the dock, the Menu and
 * Contents still name it, landing on its first section in the record.
 */
export const fielded = (board: Pick<Board, 'id' | 'tiles'>): boolean =>
  board.tiles.length > 0 || board.id === 'record';

/** The DOM id a link to a board lands on: its field, or with none, its first section's part. */
export function boardTarget(input: VariantRenderInput, board: Board): string {
  const first = board.members[0];
  return fielded(board) || !first ? boardAnchor(input, board.id) : `${input.ids.prefix}${first.id}`;
}

/**
 * The thesis split into a display line and the rest: its first sentence,
 * when it's short enough to set large, and what follows. A long first
 * sentence leaves the whole thesis as the lede.
 */
/** The longest line the hero sets at display size; a longer statement is its standfirst. */
export const DISPLAY_MOST = 64;

/** The hero's class for a statement of its own: the display line when it's short enough, else the standfirst. */
export const statementClass = (text: string) =>
  text.trim().length <= DISPLAY_MOST ? 'sb-hero__display' : 'sb-hero__standfirst';

export function splitThesis(thesis: string): { display?: string; rest?: string } {
  const text = thesis.trim();
  const match = /^([^\n]*?[.!?])(?:\s+([\s\S]*))?$/.exec(text);
  const first = match?.[1]?.trim();
  if (first === undefined || first.length > DISPLAY_MOST || /[*_`[\]]/.test(first))
    return { rest: text };
  const rest = match?.[2]?.trim();
  return { display: first, ...(present(rest) ? { rest } : {}) };
}

// ── Rows by height ───────────────────────────────────────────────────────

/** How a tile's height answers its width: its height in px at a span of 12, and its spans' bounds. */
export interface TileCost {
  readonly height: (span: number) => number;
  readonly least: number;
  readonly prefer: number;
  readonly wide: boolean;
}

/** One tile's place on the wide field: its span, its start column, its first row and how many it takes. */
export interface Placement {
  readonly span: number;
  /** Its start column, from 0, counting the label's three in the first row. */
  readonly col: number;
  readonly row: number;
  readonly rows: 1 | 2;
  /** Set only where the stylesheet must place it: the lower of a stacked pair. */
  readonly fixed: boolean;
}

export interface Packed {
  /** The tiles' indices in the order they're set, row by row. */
  readonly order: readonly number[];
  /** Each tile's place, by its index. */
  readonly places: readonly Placement[];
  /** Whether the first row is a stacked one, so the label takes both its rows. */
  readonly tallFirst: boolean;
  /** Grid rows in all. */
  readonly rows: number;
}

/** The gap between two stacked tiles, in px, at the wide layout. */
const GAP = 12;
/** What a column of slack costs against a column of a tile stretched past its measure. */
const STRETCH = 120;
/** What a column off a tile's preferred span costs: enough to settle a tie, never a row's slack. */
const NEAR = 10;
/** What a tile out of its reading place costs, a place at a time. */
const MOVE = 300;
/** The most tiles a row sets side by side. */
const ROW_MOST = 3;
/** Past this many tiles a board keeps its reading order exactly. */
const REORDER_MOST = 10;

interface Row {
  readonly tiles: readonly number[];
  readonly spans: readonly number[];
  readonly stack: boolean;
  readonly cost: number;
}

/** Every way to give `bounds` spans summing to `total`, each within its least and most. */
function* compositions(
  bounds: readonly (readonly [number, number])[],
  total: number,
): Generator<number[]> {
  if (bounds.length === 1) {
    const [least, most] = bounds[0]!;
    if (total >= least && total <= most) yield [total];
    return;
  }
  const [least, most] = bounds[0]!;
  for (let span = least; span <= Math.min(most, total); span += 1) {
    for (const rest of compositions(bounds.slice(1), total - span)) yield [span, ...rest];
  }
}

/** The span past which a tile is set wider than it reads well. */
const comfortable = (tile: TileCost) => (tile.wide ? 12 : Math.min(12, tile.prefer + 3));

/** The best row of `tiles` in `available` columns: side by side, or for three, the last two stacked. */
function bestRow(
  tiles: readonly number[],
  costs: readonly TileCost[],
  available: number,
): Row | null {
  const all = tiles.map((i) => costs[i]!);
  if (all.some((tile) => tile.wide) && tiles.length > 1) return null;
  // Past its measure a tile pays heavily; off its preferred span, a little, which settles ties.
  const stretch = (tile: TileCost, span: number) =>
    Math.max(0, span - comfortable(tile)) * STRETCH * 100 + Math.abs(span - tile.prefer) * NEAR;
  let best: Row | null = null;
  const bounds = all.map((tile) => [Math.min(tile.least, available), available] as const);
  for (const spans of compositions(bounds, available)) {
    const heights = spans.map((span, k) => all[k]!.height(span));
    const tall = Math.max(...heights);
    const cost = heights.reduce(
      (sum, h, k) => sum + (tall - h) * spans[k]! + stretch(all[k]!, spans[k]!),
      0,
    );
    if (!best || cost < best.cost) best = { tiles, spans, stack: false, cost };
  }
  if (tiles.length === 3) {
    const [a, b, c] = all as [TileCost, TileCost, TileCost];
    const pair = [
      [Math.min(a.least, available), available],
      [Math.min(Math.max(b.least, c.least), available), available],
    ] as const;
    for (const spans of compositions(pair, available)) {
      const left = spans[0]!;
      const right = spans[1]!;
      const ha = a.height(left);
      const hb = b.height(right);
      const hc = c.height(right);
      const tall = Math.max(ha, hb + hc + GAP);
      const cost =
        (tall - ha) * left +
        (tall - hb - hc - GAP) * right +
        stretch(a, left) +
        stretch(b, right) +
        stretch(c, right);
      if (!best || cost < best.cost)
        best = { tiles, spans: [left, right, right], stack: true, cost };
    }
  }
  return best;
}

/**
 * Tiles packed into rows that each fill their columns, the label taking
 * `12 - first` of the first, each row's spans chosen so its tiles come out
 * as near one height as they can, so no tile stands half empty beside a
 * taller one. A row is up to three tiles side by side, or one beside two
 * stacked. A tile may move a place or two from its reading order where
 * that saves a tile's worth of slack; the order they're set in is the DOM's.
 */
export function packByHeight(costs: readonly TileCost[], columns: number, first: number): Packed {
  const n = costs.length;
  const rowsOf = (choose: () => Row[]): Packed => {
    const chosen = choose();
    const order: number[] = [];
    const places: Placement[] = [];
    let row = 0;
    chosen.forEach((r, k) => {
      const offset = k === 0 ? columns - first : 0;
      let col = offset;
      r.tiles.forEach((i, j) => {
        order.push(i);
        if (r.stack && j === 2) {
          places[i] = {
            span: r.spans[j]!,
            col: col - r.spans[j]!,
            row: row + 1,
            rows: 1,
            fixed: true,
          };
          return;
        }
        places[i] = {
          span: r.spans[j]!,
          col,
          row,
          rows: r.stack && j === 0 ? 2 : 1,
          fixed: false,
        };
        col += r.spans[j]!;
      });
      row += r.stack ? 2 : 1;
    });
    return { order, places, tallFirst: chosen[0]?.stack ?? false, rows: row };
  };
  if (n === 0) return { order: [], places: [], tallFirst: false, rows: 0 };

  if (n > REORDER_MOST) {
    // In reading order: the cheapest split of the sequence into rows.
    return rowsOf(() => {
      const best: { cost: number; row: Row | null; from: number }[] = [
        { cost: 0, row: null, from: -1 },
      ];
      for (let end = 1; end <= n; end += 1) {
        best[end] = { cost: Infinity, row: null, from: -1 };
        for (let size = 1; size <= Math.min(ROW_MOST, end); size += 1) {
          const start = end - size;
          if (best[start]!.cost === Infinity) continue;
          const tiles = Array.from({ length: size }, (_, k) => start + k);
          const row = bestRow(tiles, costs, start === 0 ? first : columns);
          if (row && best[start]!.cost + row.cost < best[end]!.cost) {
            best[end] = { cost: best[start]!.cost + row.cost, row, from: start };
          }
        }
      }
      const rows: Row[] = [];
      for (let end = n; end > 0; end = best[end]!.from) rows.unshift(best[end]!.row!);
      return rows;
    });
  }

  // Each row starts with the first tile not yet set, and may take up to two
  // of the three after it: the cheapest set of rows over every such choice.
  const memo = new Map<number, { cost: number; rows: Row[] }>();
  const full = (1 << n) - 1;
  const solve = (mask: number, placedCount: number): { cost: number; rows: Row[] } => {
    if (mask === full) return { cost: 0, rows: [] };
    const known = memo.get(mask);
    if (known) return known;
    const open: number[] = [];
    for (let i = 0; i < n; i += 1) if (!(mask & (1 << i))) open.push(i);
    const lead = open[0]!;
    const window = open.slice(1, 4);
    const picks: number[][] = [[lead]];
    for (let a = 0; a < window.length; a += 1) {
      picks.push([lead, window[a]!]);
      for (let b = a + 1; b < window.length; b += 1) picks.push([lead, window[a]!, window[b]!]);
    }
    let best = { cost: Infinity, rows: [] as Row[] };
    for (const tiles of picks) {
      const row = bestRow(tiles, costs, mask === 0 ? first : columns);
      if (!row) continue;
      // How far each tile lands from its reading place.
      const moved = tiles.reduce((sum, i, k) => sum + Math.abs(placedCount + k - i), 0) * MOVE;
      let next = mask;
      for (const i of tiles) next |= 1 << i;
      const rest = solve(next, placedCount + tiles.length);
      const cost = row.cost + moved + rest.cost;
      if (cost < best.cost) best = { cost, rows: [row, ...rest.rows] };
    }
    memo.set(mask, best);
    return best;
  };
  return rowsOf(() => solve(0, 0).rows);
}

// ── A tile's height, estimated ───────────────────────────────────────────
//
// What a board's rows are packed by: how tall each tile comes out at each
// span, near enough that a row's spans can be chosen so its tiles end level.
// It reads the words a tile sets and the pictures it shows, each in its
// typographic role, and lays them out at the wide layout's measure: text's
// lines fall as the tile widens, a picture's height grows with it. It's an
// estimate, not a layout; the stylesheet still decides, and no tile is ever
// cut to fit it.

/** The wide layout's geometry at 1440px, in px: a column, the gutter, and a tile's padding. */
const COLUMN = 106;
const GUTTER = 12;
const PAD = 24;
const PAD_LARGE = 32;
/** Between a tile's head and its body, and between the items of a list. */
const HEAD = 46;
const ITEM_GAP = 24;

/** Each typographic role's average character width and line height, in px. */
const ROLES = {
  body: { char: 7.4, line: 25 },
  strong: { char: 7.9, line: 24 },
  label: { char: 6.4, line: 19 },
  title: { char: 10.4, line: 28 },
  standfirst: { char: 9.6, line: 29 },
  display: { char: 19.5, line: 46 },
} as const;
type Role = keyof typeof ROLES;

/** The longest line prose is set to, in characters, whatever the tile's width. */
const MEASURE = 62;

/** What a tile holds, as heights to lay out. */
export interface Content {
  /**
   * Text, each block its characters in a role, the share of the tile's
   * measure it's set in, and whether it's prose, held to MEASURE.
   */
  readonly text: readonly {
    readonly chars: number;
    readonly role: Role;
    readonly share?: number;
    readonly prose?: boolean;
  }[];
  /** Heights that don't change with width: rows of a fixed size, bars, buttons, gaps. */
  readonly fixed: number;
  /** Pictures as the share of the measure's width they take in height. */
  readonly ratio: number;
  /** Whether it takes the large tile's padding. */
  readonly large?: boolean;
  /** Height it adds below a span, where its layout stacks what sits side by side wider. */
  readonly narrow?: { readonly below: number; readonly px: number };
  /** The width a fixed column beside the text takes from it, such as a year or a ticket's stub. */
  readonly inset?: number;
}

/** A tile's inner width at a span of the wide layout. */
export const measureOf = (span: number, large = false) =>
  span * COLUMN + (span - 1) * GUTTER - 2 * (large ? PAD_LARGE : PAD);

/** The estimated height of `content` set at `span`. */
export function heightAt(content: Content, span: number): number {
  const large = content.large ?? span >= 7;
  const inner = Math.max(measureOf(span, large), COLUMN);
  const text = content.text.reduce((sum, block) => {
    const role = ROLES[block.role];
    const width = Math.max(inner - (content.inset ?? 0), COLUMN / 2) * (block.share ?? 1);
    const fits = Math.max(8, Math.floor(width / role.char));
    const perLine = block.prose ? Math.min(fits, MEASURE) : fits;
    return sum + Math.max(1, Math.ceil(block.chars / perLine)) * role.line;
  }, 0);
  const narrow = content.narrow && span < content.narrow.below ? content.narrow.px : 0;
  return 2 * (large ? PAD_LARGE : PAD) + text + content.fixed + content.ratio * inner + narrow;
}

/** A string's length as set: markdown's marks gone, spaces folded. */
const charsOf = (value: unknown): number =>
  typeof value === 'string'
    ? value
        .replace(/[*_`#>[\]()]|\bhttps?:\/\/\S+/g, '')
        .replace(/\s+/g, ' ')
        .trim().length
    : 0;

/** Fields that set no words: ids, addresses, keys, and what the model reads but doesn't show. */
const SILENT = new Set([
  'id',
  'slug',
  'url',
  'href',
  'key',
  'type',
  'kind',
  'medium',
  'lang',
  'asset',
  'media',
  'cover',
  'avatar',
  'source',
  'metric',
  'caseStudy',
  'links',
  'tracks',
  'level',
  'visibility',
  'extensions',
  'pdfUrl',
  'doi',
  'slidesUrl',
  'videoUrl',
  'audioUrl',
  'urlLabel',
  'buttonText',
  'relatedWorks',
  'evidence',
  'works',
  'tags',
  'focal',
  'alt',
]);
const NAMES = ['title', 'name', 'degree', 'role'];
const LONG = ['excerpt', 'summary', 'statement', 'abstract', 'description'];

/** The words of one record as blocks: its name in `name`, its long text in `role`, its lists a line each, the rest a meta line. */
function recordText(
  record: Record<string, unknown>,
  role: Role = 'body',
  name: Role = 'strong',
): Content['text'] {
  const blocks: { chars: number; role: Role; prose?: boolean }[] = [];
  const key = NAMES.find((field) => charsOf(record[field]) > 0);
  if (key) blocks.push({ chars: charsOf(record[key]), role: name });
  const long = LONG.find((field) => charsOf(record[field]) > 0);
  if (long) blocks.push({ chars: charsOf(record[long]), role, prose: true });
  let meta = 0;
  for (const [field, value] of Object.entries(record)) {
    if (SILENT.has(field) || field === key || field === long || LONG.includes(field)) continue;
    if (field === 'highlights' && Array.isArray(value)) {
      for (const item of value) {
        const chars =
          typeof item === 'string'
            ? charsOf(item)
            : charsOf((item as Record<string, unknown>)?.label);
        if (chars > 0) blocks.push({ chars: chars + 3, role: 'body' });
      }
    } else if (Array.isArray(value)) {
      meta += value.reduce(
        (sum: number, item) => sum + (typeof item === 'string' ? item.length + 2 : 0),
        0,
      );
    } else if (typeof value === 'string' && value.length < 160) {
      meta += value.length + 2;
    }
  }
  if (meta > 0) blocks.push({ chars: meta, role: 'label' });
  return blocks;
}

/** A list's records as content: each its text, with a gap between them. */
function listOf(
  records: readonly Record<string, unknown>[],
  options: { role?: Role; name?: Role; each?: number; inset?: number } = {},
): Content {
  return {
    text: records.flatMap((record) => recordText(record, options.role, options.name)),
    fixed: Math.max(0, records.length - 1) * ITEM_GAP + records.length * (options.each ?? 0),
    ratio: 0,
    ...(options.inset ? { inset: options.inset } : {}),
  };
}

/** Two contents as one. */
export const both = (a: Content, b: Content): Content => ({
  text: [...a.text, ...b.text],
  fixed: a.fixed + b.fixed,
  ratio: a.ratio + b.ratio,
  ...(a.large || b.large ? { large: true } : {}),
  ...((a.inset ?? b.inset) ? { inset: Math.max(a.inset ?? 0, b.inset ?? 0) } : {}),
  ...((a.narrow ?? b.narrow) ? { narrow: (a.narrow ?? b.narrow)! } : {}),
});

/** A section's content, from what its tile sets. */
export function contentOf(section: Section, input: VariantRenderInput): Content {
  const head: Content = {
    text: present(section.subtitle) ? [{ chars: charsOf(section.subtitle), role: 'label' }] : [],
    fixed: present(section.title) ? HEAD : 0,
    ratio: 0,
  };
  const rec = (value: unknown) => value as Record<string, unknown>;
  switch (section.kind) {
    case 'works': {
      const works = worksOf(section, input);
      const medium = worksMedium(section, input);
      if (medium === 'photography' || medium === 'image-series') {
        const pictures = works.reduce((sum, work) => sum + (work.media?.length ?? 0), 0);
        // The first picture across the tile, the rest in pairs under it, each with its caption.
        return both(head, {
          text: [],
          fixed: pictures * 42,
          ratio: 0.62 + Math.ceil(Math.max(0, pictures - 1) / 2) * 0.32,
        });
      }
      if (medium === 'music') {
        const tracks = works.reduce(
          (sum, work) => sum + ((rec(work).tracks as unknown[] | undefined)?.length ?? 0),
          0,
        );
        return both(both(head, listOf(works.map(rec))), {
          text: [],
          fixed: 150 + tracks * 23 + 40,
          ratio: 0,
          // The cover above the tracklist in a narrow tile, beside it wider.
          narrow: { below: 6, px: 190 },
        });
      }
      if (medium === 'audio-video') return both(head, listOf(works.map(rec), { each: 72 }));
      if (medium === 'writing')
        return both(head, listOf(works.map(rec), { name: 'title', each: 20 }));
      return both(head, listOf(works.map(rec), { each: 30 }));
    }
    case 'evidence': {
      const entries = evidenceOf(section, input).map(rec);
      const type = evidenceType(section, input);
      if (type === 'press') return both(head, listOf(entries, { role: 'standfirst', each: 8 }));
      if (type === 'testimonial') {
        // Several set side by side, each a column: the row is as tall as the longest.
        const longest = entries.reduce(
          (most, entry) => (charsOf(entry.statement) > charsOf(most.statement) ? entry : most),
          entries[0] ?? {},
        );
        const share = 1 / Math.max(entries.length, 1);
        return both(head, {
          text: recordText(longest, 'standfirst').map((block) => ({ ...block, share })),
          fixed: 60,
          ratio: 0,
        });
      }
      if (type === 'external-work') {
        // Its figures run in its caption line, not a line each.
        const caption = (highlights: unknown) =>
          Array.isArray(highlights)
            ? highlights.map((h) => `${rec(h).label ?? ''} ${rec(h).sub ?? ''}`).join(', ')
            : '';
        return both(
          head,
          listOf(
            entries.map(({ highlights, ...entry }) => ({ ...entry, figures: caption(highlights) })),
            { each: 10 },
          ),
        );
      }
      if (type === 'publication') return both(head, listOf(entries, { each: 44 }));
      if (type === 'talk') return both(head, listOf(entries, { each: 80, inset: 70 }));
      if (type === 'award') return both(head, listOf(entries, { each: 20, inset: 74 }));
      if (type === 'patent') return both(head, listOf(entries, { each: 70 }));
      if (type === 'metric') return both(head, listOf(entries, { each: 12 }));
      return both(head, listOf(entries, { each: 20 }));
    }
    case 'chronology': {
      const entries = chronologyOf(section, input).map(rec);
      if (allStudies(section, input)) return both(head, listOf(entries, { each: 30, inset: 74 }));
      const open = entries[0] ? recordText(entries[0]) : [];
      return both(head, { text: open, fixed: 70 + entries.length * 44, ratio: 0, large: true });
    }
    case 'practice': {
      const practice = input.portfolio.practice;
      if (section.part === 'services') {
        const offers = (practice?.services ?? []).flatMap((group) => group.items.map(rec));
        return both(head, {
          text: offers.flatMap((offer) => [
            { chars: charsOf(offer.name), role: 'title' as const, share: 0.38 },
            ...recordText({ ...offer, name: undefined }).map((block) => ({ ...block, share: 0.5 })),
          ]),
          fixed: offers.length * 40,
          ratio: 0,
        });
      }
      const groups = (section.part === 'skills' ? practice?.skills : practice?.tools) ?? [];
      return both(head, {
        text: groups.flatMap((group) => {
          const items = (group.items as readonly unknown[]).map((item) =>
            typeof item === 'string' ? item : String(rec(item).name ?? ''),
          );
          return [
            { chars: charsOf(group.name), role: 'strong' as const },
            ...(present(group.description)
              ? [{ chars: charsOf(group.description), role: 'label' as const }]
              : []),
            { chars: items.join(', ').length + 6, role: 'body' as const },
          ];
        }),
        fixed: Math.max(0, groups.length - 1) * 45,
        ratio: 0,
      });
    }
    case 'lede':
      return both(head, {
        text: [
          ...String(section.body ?? '')
            .split(/\n\s*\n/)
            .map((paragraph) => ({
              chars: charsOf(paragraph),
              role: 'body' as const,
              prose: true,
            })),
        ],
        fixed: 24 + String(section.body ?? '').split(/\n\s*\n/).length * 24,
        ratio: 0,
      });
    case 'focus':
      return both(
        head,
        listOf(
          (section.items ?? []).map((item) => ({
            title: typeof item === 'string' ? item : rec(item).label,
          })),
          { name: 'title', each: 10 },
        ),
      );
    case 'fun-facts':
      return both(
        head,
        listOf(
          (section.items ?? []).map((item) => ({
            description: typeof item === 'string' ? item : rec(item).text,
          })),
          { each: 26 },
        ),
      );
    case 'quote':
      return {
        text: [{ chars: charsOf(section.text) + 2, role: 'display', share: 0.85 }],
        fixed: 90,
        ratio: 0,
        large: true,
      };
    case 'contact': {
      const links = input.portfolio.contact?.links?.length ?? input.portfolio.links.length;
      return both(head, {
        text: [{ chars: charsOf(input.portfolio.contact?.message), role: 'body' }],
        fixed: 64 + links * 50,
        ratio: 0,
      });
    }
    case 'cta':
      return {
        text: [
          { chars: charsOf(section.title), role: 'display', share: 0.8 },
          { chars: charsOf(section.description), role: 'body', share: 0.8 },
        ],
        fixed: 150,
        ratio: 0,
        large: true,
      };
    case 'github':
      // The sentence, the heatmap, whose cells are squares across the tile, and the repositories.
      return { text: [], fixed: 300, ratio: 0.13, large: true };
    default:
      return both(head, {
        text: [{ chars: charsOf(rec(section).body), role: 'body' }],
        fixed: 40,
        ratio: 0,
      });
  }
}
