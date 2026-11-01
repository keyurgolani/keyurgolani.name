// Aurora Glass's derivations (variants-10 brief §5.2, step 3): every word,
// tile, band and form the sky, the opening, the bands and the horizon show,
// computed from the render input alone. Pure and browser-safe: no markup, no
// clock, no network, no randomness, and no person-specific literal (N4).
// Nothing here names a sample record; each rule reads kinds, fields, media
// sizes and the owner's controls.
//
// Four helpers are local copies until lead A lifts them into the kit (K-6),
// with the signatures the kit will take: posterLine(input), proofOf(input),
// repoForWork(input, work) and chronologyLanes(entries). The bands are the
// kit's navigation model (K-1), grouped for display.

import type { ChronologyEntry, Evidence, Link, Placement, Section, Work } from '@portfolio/schema';
import {
  backdropOf as kitBackdropOf,
  chronologyOf,
  evidenceByIds,
  evidenceOf,
  formatFigure,
  githubSnapshot,
  navigationModel,
  present,
  renderContext,
  safeHref,
  sectionRenders,
  worksByIds,
  worksOf,
  type Backdrop as KitBackdrop,
  type DestinationId,
  type GroupingOptions,
  type PageOutline,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';

/** What the derivations read: the visible content, the owner's controls, media and snapshots. */
export type ModelInput = Pick<
  VariantRenderInput,
  'portfolio' | 'controls' | 'derived' | 'media' | 'capabilities'
>;

// ───────────── text ─────────────

/** Whether `text` has something to show: the kit's own test, re-exported for the renderers. */
export { present };

/** Collapses runs of white space. */
export const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Inline Markdown as plain text, for a line set in one voice: link text and
 * code kept, marks dropped. As CommonMark has it, a mark doesn't open before
 * or close after a space, `_` marks only at a word's edge (snake_case stays),
 * and nothing spans a line break.
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

/** Sentence ends: a Latin, Arabic or Devanagari stop before a space or the end, or a CJK stop. */
const SENTENCE_END = /^([\s\S]+?(?:[.!?؟۔।](?=\s|$)|[。！？]))\s*([\s\S]*)$/u;

/** A text's first sentence and what follows it (K-6 `firstSentence`). */
export function firstSentence(text: string): { lead: string; rest?: string } {
  const flat = squash(text);
  const match = SENTENCE_END.exec(flat);
  if (!match) return { lead: flat };
  const rest = match[2]!.trim();
  return rest ? { lead: match[1]!, rest } : { lead: match[1]! };
}

/** An image or a link, on one line. */
const LINK_SPAN = /!?\[[^\]\n]+\]\([^)\n]*\)/y;
const WORD_CHAR = /[\p{L}\p{N}]/u;

/** A Latin, Arabic or Devanagari stop ends a sentence before a space or the end; a CJK stop always. */
const STOP = /[.!?؟۔।]/u;
const CJK_STOP = /[。！？]/u;

/**
 * A Markdown text's first sentence and the rest, cut once on the Markdown
 * itself, so the display line and what follows come from the same cut. The
 * lead is plain (it's set in one voice); the rest stays Markdown, its marks
 * and paragraphs kept. A stop inside a link's text or a mark only ends the
 * sentence when it closes the span, so `**Small systems, patiently
 * built.** I work…` leads with the bold sentence and `[the guide. It
 * helps](…) today.` keeps its link whole. A stop inside code never ends
 * it. Marks follow CommonMark closely enough for that: `*`, `**` and `***`
 * don't open before a space or close after one, `_` marks only at a word's
 * edge (snake_case is a word), and no span crosses a line break.
 */
export function leadOf(markdown: string): { lead: string; rest?: string } {
  const text = markdown.trim();
  const ends = (at: number) => at >= text.length || /\s/u.test(text[at]!);
  const runAt = (at: number) => {
    let end = at;
    while (text[end] === text[at]) end += 1;
    return end - at;
  };
  /**
   * The span that opens at `at`, if one does: its end, and whether a stop
   * at its close may end the sentence (never for code). A mark that doesn't
   * open or never closes on its line is plain text, skipped as one run.
   */
  const spanAt = (at: number): { end: number; closes: boolean } | undefined => {
    const char = text[at]!;
    if (char === '`') {
      const n = runAt(at);
      for (let j = at + n; j < text.length && text[j] !== '\n';) {
        if (text[j] !== '`') {
          j += 1;
          continue;
        }
        const m = runAt(j);
        if (m === n) return { end: j + m, closes: false };
        j += m;
      }
      return { end: at + n, closes: false };
    }
    if (char === '[' || (char === '!' && text[at + 1] === '[')) {
      LINK_SPAN.lastIndex = at;
      const link = LINK_SPAN.exec(text);
      return link ? { end: at + link[0].length, closes: true } : undefined;
    }
    if (char !== '*' && char !== '_') return undefined;
    const n = runAt(at);
    const literal = { end: at + n, closes: false };
    const next = text[at + n];
    if (n > 3 || next === undefined || /\s/u.test(next)) return literal;
    if (char === '_' && at > 0 && WORD_CHAR.test(text[at - 1]!)) return literal;
    for (let j = at + n; j < text.length && text[j] !== '\n';) {
      if (text[j] === '`') {
        j = spanAt(j)!.end;
        continue;
      }
      if (text[j] !== char) {
        j += 1;
        continue;
      }
      const m = runAt(j);
      const after = text[j + m];
      const closer =
        m === n &&
        !/\s/u.test(text[j - 1]!) &&
        (char !== '_' || after === undefined || !WORD_CHAR.test(after));
      if (closer) return { end: j + m, closes: true };
      j += m;
    }
    return literal;
  };
  let cut: number | undefined;
  for (let at = 0; at < text.length && cut === undefined;) {
    const span = spanAt(at);
    if (span) {
      if (span.closes) {
        const last = plainInline(text.slice(at, span.end)).at(-1) ?? '';
        if (CJK_STOP.test(last) || (STOP.test(last) && ends(span.end))) cut = span.end;
      }
      at = span.end;
      continue;
    }
    const char = text[at]!;
    if (CJK_STOP.test(char) || (STOP.test(char) && ends(at + 1))) cut = at + 1;
    at += 1;
  }
  if (cut === undefined) return { lead: plainInline(text) };
  const rest = text.slice(cut).trim();
  const lead = plainInline(text.slice(0, cut));
  return rest ? { lead, rest } : { lead };
}

/** A text up to its first comma, for a tile's label: "Years engineering, from…" is "Years engineering". */
export function upToComma(text: string): string {
  const flat = squash(text);
  const at = flat.search(/[,،、，]/u);
  return (at > 0 ? flat.slice(0, at) : flat).replace(/[.!?。]$/u, '').trim();
}

// ───────────── once per render ─────────────

/** A derivation several components read, computed once per render input object. */
function once<T>(read: (input: ModelInput) => T): (input: ModelInput) => T {
  const cache = new WeakMap<object, { value: T }>();
  return (input) => {
    const hit = cache.get(input);
    if (hit) return hit.value;
    const value = read(input);
    cache.set(input, { value });
    return value;
  };
}

// ───────────── controls ─────────────

export interface Controls {
  /** What sits under the sky's colours: `auto` (the owner's landscape photograph) or `field`. */
  readonly backdrop: 'auto' | 'field';
  /**
   * The photograph the owner chose for the sky (K-8's media ref), or null:
   * the host renders a stale value, `controls.invalid` or `controls.dangling-ref`,
   * as the default, null, and so does backdropOf when the view doesn't hold it.
   */
  readonly backdropMedia: string | null;
  /** Whether the curtains may drift (always still under reduce, static, touch and narrow screens). */
  readonly drift: boolean;
  /** Whether the Lens shows. */
  readonly lens: boolean;
  /** Whether the opening shows the proof tiles. */
  readonly proof: 'auto' | 'off';
}

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;

const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

/**
 * The owner's controls (`variantControls.aurora-glass.values`), each at its
 * default when unset or invalid. The owner's own sky photograph is K-8's
 * media ref, `backdropMedia`; `backdrop` decides only when it names none.
 */
export function controlsOf(input: Pick<ModelInput, 'controls'>): Controls {
  const { controls } = input;
  return {
    backdrop: controls.backdrop === 'field' ? 'field' : 'auto',
    backdropMedia:
      typeof controls.backdropMedia === 'string' && controls.backdropMedia.trim()
        ? controls.backdropMedia
        : null,
    drift: flag(controls.drift, true),
    lens: flag(controls.lens, true),
    proof: pick(controls.proof, ['auto', 'off'] as const, 'auto'),
  };
}

// ───────────── numbers and dates ─────────────

/**
 * A number as the content's language writes it: the kit's formatFigure, in
 * the locale the kit's renderContext resolves for `locale` (English for a
 * tag the runtime has no data for), so a figure here reads as the shared
 * renderers write it. renderContext reads only the locale off its input.
 */
export function formatNumber(value: number, locale: string): string {
  const source = { portfolio: { locale } } as Pick<VariantRenderInput, 'portfolio'>;
  return formatFigure(value, renderContext(source as VariantRenderInput, { id: 'figure' }, 2));
}

/** The year a loose date names, `2022` from `2022-01` or `March 2022`, or none. */
export function yearOf(raw: string | undefined): string | undefined {
  return raw === undefined ? undefined : /(\d{4})/.exec(raw)?.[1];
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * A loose date as a sentence sets it, `January 2022`, `8 February 2026` or
 * `2022`, with its ISO form for `<time>`. The month names are English, the
 * composition's words. None for "present" or a date it can't read.
 */
export function longDate(raw: string | undefined): { text: string; iso: string } | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  const iso = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(trimmed);
  const pad = (value: number) => String(value).padStart(2, '0');
  if (iso) {
    const [, year, month, day] = iso;
    if (month === undefined) return { text: year!, iso: year! };
    const name = MONTHS[Number(month) - 1];
    if (!name) return { text: year!, iso: year! };
    if (day === undefined) return { text: `${name} ${year}`, iso: `${year}-${pad(Number(month))}` };
    return {
      text: `${Number(day)} ${name} ${year}`,
      iso: `${year}-${pad(Number(month))}-${pad(Number(day))}`,
    };
  }
  const year = yearOf(trimmed);
  return year ? { text: trimmed, iso: year } : undefined;
}

const OPEN = /^(?:present|now|current)$/i;

/** A period as a year range with an en dash: `2018–2023`, one year when both ends share it, `2023–now`. */
export function rangeOf(
  period: { readonly start: string; readonly end?: string } | undefined,
): { text: string; open: boolean } | undefined {
  if (!period) return undefined;
  const start = yearOf(period.start);
  if (start === undefined) return undefined;
  const end =
    period.end === undefined || OPEN.test(period.end.trim()) ? undefined : yearOf(period.end);
  if (end === undefined) return { text: `${start}–now`, open: true };
  return { text: start === end ? start : `${start}–${end}`, open: false };
}

// ───────────── the opening ─────────────

export type Hero = Extract<Section, { kind: 'hero' }>;

/** The first hero section: the opening's own. */
export function heroOf(input: Pick<ModelInput, 'portfolio'>): Hero | undefined {
  return input.portfolio.sections.find((section): section is Hero => section.kind === 'hero');
}

/** The first thesis section: the view keeps the thesis only where one shows. */
export function thesisSectionOf(input: Pick<ModelInput, 'portfolio'>): Section | undefined {
  return input.portfolio.sections.find(
    (section) => section.kind === 'practice' && section.part === 'thesis',
  );
}

/** Where the display line came from (N5). */
export type LineSource = 'thesis' | 'hero' | 'tagline' | 'name';

export interface PosterLine {
  /** The display line. */
  readonly text: string;
  readonly source: LineSource;
  /** How long it is, which sets its step: up to 32 characters, up to 64, or longer. */
  readonly length: 'short' | 'medium' | 'long';
}

const lengthClass = (text: string): PosterLine['length'] => {
  const count = [...squash(text)].length;
  return count <= 32 ? 'short' : count <= 64 ? 'medium' : 'long';
};

/**
 * The display line (K-6 `posterLine(input)`, N5, AG-M1): the thesis's first
 * sentence where a thesis section shows, else the hero's tagline's first
 * sentence, else the identity's tagline, else the name.
 */
export const posterLine = once((input): PosterLine => {
  const { portfolio } = input;
  const thesis = portfolio.practice?.thesis;
  const hero = heroOf(input);
  const candidates: [LineSource, string | undefined][] = [
    ['thesis', thesisSectionOf(input) && present(thesis) ? leadOf(thesis).lead : undefined],
    ['hero', present(hero?.tagline) ? leadOf(hero.tagline).lead : undefined],
    [
      'tagline',
      present(portfolio.identity.tagline) ? squash(portfolio.identity.tagline) : undefined,
    ],
  ];
  for (const [source, text] of candidates) {
    if (present(text)) return { text, source, length: lengthClass(text) };
  }
  const name = squash(portfolio.identity.name);
  return { text: name, source: 'name', length: lengthClass(name) };
});

/** A hero call to action, the first primary and the rest text links. */
export interface Cta {
  readonly label: string;
  readonly url: string;
  readonly primary: boolean;
}

export interface Opening {
  /** The greeting, set at label size above the name, never as the display line (N5). */
  readonly greeting?: string;
  /** The name, at title size inside the h1. */
  readonly name: string;
  readonly line: PosterLine;
  /** The rest of the thesis after its first sentence, the standfirst under the h1. */
  readonly standfirst?: string;
  /** The hero's tagline, when the display line isn't it. */
  readonly lede?: string;
  /** The hero's subtagline, the status line. */
  readonly status?: string;
  readonly ctas: readonly Cta[];
  /** The meta row: the identity's tagline (unless it's the display line), location and pronouns. */
  readonly meta: {
    readonly tagline?: string;
    readonly location?: string;
    readonly pronouns?: string;
  };
}

/** The identity pane's contents (brief §5.2, the hero). */
export const openingOf = once((input): Opening => {
  const { identity, practice } = input.portfolio;
  const hero = heroOf(input);
  const line = posterLine(input);
  const name = squash(present(hero?.name) ? hero.name : identity.name);
  const rest =
    line.source === 'thesis' && present(practice?.thesis)
      ? leadOf(practice.thesis).rest
      : undefined;
  const lede =
    present(hero?.tagline) && line.source !== 'hero'
      ? hero.tagline
      : line.source === 'hero' && present(hero?.tagline)
        ? leadOf(hero.tagline).rest
        : undefined;
  const ctas = (hero?.ctas ?? [])
    .filter((cta) => present(cta.label) && present(cta.url))
    .map((cta, index) => ({ label: squash(cta.label), url: cta.url, primary: index === 0 }));
  return {
    ...(present(hero?.greeting) ? { greeting: squash(hero.greeting) } : {}),
    name,
    line,
    ...(present(rest) ? { standfirst: rest } : {}),
    ...(present(lede) ? { lede } : {}),
    ...(present(hero?.subtagline) ? { status: hero.subtagline } : {}),
    ctas,
    meta: {
      ...(present(identity.tagline) && line.source !== 'tagline'
        ? { tagline: squash(identity.tagline) }
        : {}),
      ...(present(identity.location) ? { location: squash(identity.location) } : {}),
      ...(present(identity.pronouns) ? { pronouns: squash(identity.pronouns) } : {}),
    },
  };
});

// ───────────── proof ─────────────

/**
 * The records the portfolio leads with (K-6 `proofOf(input)`): the signature
 * work, `portfolio.signature`, else the first featured work; and the proof
 * strip, `portfolio.proof`, resolved to the evidence the view shows, in the
 * owner's order. Ids the view doesn't hold are dropped.
 */
export const proofOf = once((input): { signature?: Work; proof: readonly Evidence[] } => {
  const { portfolio } = input;
  const ids = [portfolio.signature, ...portfolio.featured].filter(present);
  const signature = worksByIds(ids, input)[0];
  return { ...(signature ? { signature } : {}), proof: evidenceByIds(portfolio.proof, input) };
});

/** Units set tight against the number. */
const TIGHT_UNITS = /^(?:%|‰|°|′|″|x|×|\+|k|m|b|K|M|B)$/;

/** Whether a caption opens with the unit as a whole word, so the tile doesn't say it twice. */
function opensWith(caption: string, unit: string, locale: string): boolean {
  if (unit === '') return false;
  const wordy = unit.length > 1 && /^\p{L}+$/u.test(unit);
  const head = caption.slice(0, unit.length);
  const same = wordy
    ? head.toLocaleLowerCase(locale) === unit.toLocaleLowerCase(locale)
    : head === unit;
  if (!same) return false;
  const next = caption.slice(unit.length, unit.length + 1);
  return next === '' || !/[\p{L}\p{N}]/u.test(next);
}

/** A metric's value with its unit folded in, unless the label opens with the unit. */
export function metricValue(
  entry: Evidence,
  label: string | undefined,
  locale: string,
): string | undefined {
  const value = entry.metric?.value;
  if (value === undefined) return undefined;
  const unit = entry.metric?.unit?.trim();
  const number = formatNumber(value, locale);
  if (
    unit === undefined ||
    unit === '' ||
    (label !== undefined && opensWith(label, unit, locale))
  ) {
    return number;
  }
  return TIGHT_UNITS.test(unit) ? `${number}${unit}` : `${number} ${unit}`;
}

/** One stat tile: a value over its label, from a record on the page. */
export interface Tile {
  readonly id: string;
  readonly value: string;
  readonly label: string;
  /** Whether the value is a year, which takes no grouping. */
  readonly year: boolean;
}

/**
 * The opening's stat tiles (brief §5.2): from the proof strip, at most 3. A
 * metric with a value shows it with the statement up to its first comma; an
 * award, its year and title. Other proof shows elsewhere on the page, and
 * with no tile, or the owner's `proof: off`, the band closes.
 */
export const proofTiles = once((input): readonly Tile[] => {
  if (controlsOf(input).proof === 'off') return [];
  const locale = input.portfolio.locale;
  const tiles: Tile[] = [];
  for (const entry of proofOf(input).proof) {
    if (tiles.length === 3) break;
    if (entry.type === 'metric') {
      const statement = present(entry.statement) ? plainInline(entry.statement) : undefined;
      const label = statement
        ? upToComma(statement)
        : present(entry.title)
          ? squash(entry.title)
          : undefined;
      const value = metricValue(entry, label, locale);
      if (value && label) tiles.push({ id: entry.id, value, label, year: false });
    } else if (entry.type === 'award') {
      const year = yearOf(entry.receivedAt ?? entry.publishedAt ?? entry.asOf);
      const title = present(entry.title) ? squash(entry.title) : undefined;
      if (year && title) tiles.push({ id: entry.id, value: year, label: title, year: true });
    }
  }
  return tiles;
});

// ───────────── the signature sheet ─────────────

export interface SignatureSheet {
  readonly work: Work;
  /** The cover, else the first image; none closes the sheet up to text. */
  readonly media?: Placement;
  /** When it started, for the kicker "Signature work, since January 2022". */
  readonly since?: { readonly text: string; readonly iso: string };
  /** The case study's route, else the work's first link. */
  readonly link?: { readonly href: string; readonly caseStudy: boolean };
}

/** Whether a work has its own page: a case study, which needs a slug. */
export const hasCaseStudy = (work: Work): work is Work & { slug: string } =>
  work.caseStudy !== undefined && work.slug !== undefined;

/**
 * A work's longer description, for home, when nothing else shows it: the
 * work has no page of its own and its row shows a summary that isn't it
 * (the code review's blocker 2).
 */
export function homeDescription(work: Work): string | undefined {
  if (hasCaseStudy(work) || !work.summary?.trim()) return undefined;
  const description = work.description?.trim();
  return description && description !== work.summary.trim() ? description : undefined;
}

/** A placement whose image is ready, with its width and height. */
export function readyMedia(
  placement: Placement | undefined,
  input: Pick<ModelInput, 'media'>,
): { width: number; height: number } | undefined {
  if (!placement || !Object.hasOwn(input.media, placement.asset)) return undefined;
  const state = input.media[placement.asset]!.derived;
  if (state.state !== 'ready') return undefined;
  const { width, height } = state.value;
  return typeof width === 'number' && typeof height === 'number' ? { width, height } : undefined;
}

/** The first link a work names: its URL, else its first link. */
export function firstLink(work: Work): string | undefined {
  return present(work.url) ? work.url : (work.links ?? []).find((link) => present(link.url))?.url;
}

/**
 * The signature sheet (brief §5.2): the signature work, its media, its
 * kicker from `period.start`, and its link. `caseHref` is the route to a
 * work's own page, which the render input knows. None without a work.
 */
export function signatureSheet(
  input: ModelInput,
  caseHref: (work: Work & { slug: string }) => string,
): SignatureSheet | undefined {
  const work = proofOf(input).signature;
  if (!work) return undefined;
  const media = [work.cover, ...(work.media ?? [])].find(
    (placement): placement is Placement =>
      placement !== undefined && readyMedia(placement, input) !== undefined,
  );
  const since = longDate(work.period?.start);
  const href = hasCaseStudy(work) ? caseHref(work) : firstLink(work);
  return {
    work,
    ...(media ? { media } : {}),
    ...(since ? { since } : {}),
    ...(href ? { link: { href, caseStudy: hasCaseStudy(work) } } : {}),
  };
}

// ───────────── the sky ─────────────

export interface Backdrop {
  readonly placement: Placement;
  readonly width: number;
  readonly height: number;
  /** The section the photograph came from, for the footer's credit. */
  readonly section: { readonly id: string; readonly title?: string };
  readonly work: Work;
}

const PHOTOGRAPHIC = new Set(['image-series', 'photography']);

/**
 * The sky's photograph (control `backdrop`): under `auto`, the first image
 * that isn't decorative and is landscape (width at least 1.3 times height),
 * in the first visible works section of image series or photography; else
 * none, and the sky is the scheme's colours alone. `field` is always none,
 * and so is a sky the owner chose by media ref (ownerSkyOf).
 */
export const backdropOf = once((input): Backdrop | undefined => {
  // The owner's own choice (K-8) wins; this is the automatic pick alone.
  if (ownerSkyOf(input)) return undefined;
  if (controlsOf(input).backdrop === 'field') return undefined;
  const first = input.portfolio.sections.find(
    (section) =>
      section.kind === 'works' &&
      sectionRenders(section, input) &&
      worksOf(section, input).some((work) => PHOTOGRAPHIC.has(work.medium)),
  );
  if (!first) return undefined;
  for (const work of worksOf(first, input)) {
    if (!PHOTOGRAPHIC.has(work.medium)) continue;
    for (const placement of [work.cover, ...(work.media ?? [])]) {
      if (!placement || placement.decorative === true) continue;
      if (input.media[placement.asset]?.decorative === true) continue;
      const size = readyMedia(placement, input);
      if (size && size.width >= 1.3 * size.height) {
        return {
          placement,
          ...size,
          section: {
            id: first.id,
            ...(present(first.title) ? { title: squash(first.title) } : {}),
          },
          work,
        };
      }
    }
  }
  return undefined;
});

/** The owner's chosen sky (K-8): the media ref's renditions, and where the page places the photograph, for the credit. */
export interface OwnerSky {
  readonly backdrop: KitBackdrop;
  readonly placement?: Placement;
  readonly section?: { readonly id: string; readonly title?: string };
  readonly work?: Work;
}

/**
 * The sky's photograph by the owner's media ref (`backdropMedia`, K-8),
 * through the kit's backdropOf: its WebP renditions up to 1600w, or none for
 * no value or a value the view doesn't hold, so `backdrop` decides (`auto`,
 * else `field`). The credit reads the first visible works section that
 * places the asset.
 */
export const ownerSkyOf = once((input): OwnerSky | undefined => {
  const id = controlsOf(input).backdropMedia;
  const backdrop = id ? kitBackdropOf(input, id) : null;
  if (!backdrop) return undefined;
  for (const section of input.portfolio.sections) {
    if (section.kind !== 'works' || !sectionRenders(section, input)) continue;
    for (const work of worksOf(section, input)) {
      const placement = [work.cover, ...(work.media ?? [])].find(
        (each) => each?.asset === backdrop.asset,
      );
      if (placement) {
        return {
          backdrop,
          placement,
          section: {
            id: section.id,
            ...(present(section.title) ? { title: squash(section.title) } : {}),
          },
          work,
        };
      }
    }
  }
  return { backdrop };
});

// ───────────── bands ─────────────

/** A band: one of the five destinations, or the unlabelled band of the owner's own sections. */
export type BandId = DestinationId | 'more';

/** The bands in reading order, Contact last: the unlabelled band sits just before it. */
export const BAND_ORDER: readonly BandId[] = [
  'work',
  'writing',
  'record',
  'about',
  'more',
  'contact',
];

/**
 * Aurora's bands are the kit's five destinations, through navigationModel's
 * grouping hook (K-1): display only, so every section keeps the destination
 * the canonical map gives it. The first hero and the thesis it shows open the
 * page, so neither is in a band; the sections the map leaves to the index
 * (custom, extension and untitled lede sections) go in an unlabelled band
 * before Contact, which stands for About.
 */
export function bandGrouping(input: ModelInput): GroupingOptions<BandId> {
  const opening = new Set([heroOf(input)?.id, thesisSectionOf(input)?.id].filter(present));
  return {
    groups: BAND_ORDER.map((id) => ({ id, destination: id === 'more' ? 'about' : id })),
    unplaced: 'more',
    groupOf: (section) => (opening.has(section.id) ? null : undefined),
  };
}

export interface Band {
  readonly id: BandId;
  /** The band's word, none for the unlabelled band. */
  readonly word?: string;
  /** Whether the word is the composition's (English) rather than the owner's title. */
  readonly own: boolean;
  readonly sections: readonly Section[];
}

const bandsCache = new WeakMap<object, readonly Band[]>();

/**
 * The page's bands, from the navigation model's groups for `outline`, each
 * with its sections in reading order, none empty. Contact's word is the
 * contact section's own title when it has one ("Get in touch").
 */
export function bandsOf(input: ModelInput, outline: PageOutline): readonly Band[] {
  const cached = bandsCache.get(input);
  if (cached) return cached;
  const model = navigationModel(outline, { grouping: bandGrouping(input) });
  const byId = new Map(input.portfolio.sections.map((section) => [section.id, section]));
  const bands = model.groups
    .map((group) => ({
      id: group.id,
      label: group.label,
      sections: group.sections.flatMap((entry) => {
        const section = byId.get(entry.id);
        return section ? [section] : [];
      }),
    }))
    .filter((band) => band.sections.length > 0)
    .map(({ label, ...band }): Band => {
      if (band.id === 'more') return { ...band, own: true };
      const contactTitle =
        band.id === 'contact'
          ? band.sections.find((section) => section.kind === 'contact')?.title
          : undefined;
      // Else the navigation model's label for the destination: the kit's word, English.
      return present(contactTitle)
        ? { ...band, word: squash(contactTitle), own: false }
        : { ...band, word: label, own: true };
    });
  bandsCache.set(input, bands);
  return bands;
}

// ───────────── the forms ─────────────

/**
 * A band's sections as blocks: a lede with the Now and focus sections right
 * after it is one spread, the lede's lite beside a column of theirs (the
 * reading lite never parks beside an empty half); every other section is a
 * block of its own. Reading order is kept.
 */
export function spreadsOf(sections: readonly Section[]): { main: Section; side: Section[] }[] {
  const blocks: { main: Section; side: Section[] }[] = [];
  for (const section of sections) {
    const last = blocks.at(-1);
    if (
      last &&
      last.main.kind === 'lede' &&
      (section.kind === 'now' || section.kind === 'focus') &&
      last.side.length < 2
    ) {
      last.side.push(section);
    } else {
      blocks.push({ main: section, side: [] });
    }
  }
  return blocks;
}

/** How a work shows (brief §5.2, works by medium). */
export type WorkForm = 'sheet' | 'essay' | 'episode' | 'looking' | 'sleeve';

export function workForm(work: Work): WorkForm {
  switch (work.medium) {
    case 'writing':
    case 'research':
      return 'essay';
    case 'audio-video':
      return 'episode';
    case 'image-series':
    case 'photography':
      return 'looking';
    case 'music':
      return 'sleeve';
    default:
      // software, system, interface, object, and an extension's medium.
      return 'sheet';
  }
}

/** How a piece of evidence shows (brief §5.2, evidence by type; AG-M3). */
export type EvidenceForm = 'lites' | 'cascade' | 'rows' | 'portals';

export function evidenceForm(entry: Evidence): EvidenceForm {
  switch (entry.type) {
    case 'metric':
      return entry.metric?.value !== undefined ? 'lites' : 'rows';
    case 'testimonial':
      return 'cascade';
    case 'external-work':
      return 'portals';
    default:
      return 'rows';
  }
}

/** Consecutive items that share a form, in their order: a mixed section renders each run in its form. */
export function runsOf<T, F extends string>(
  items: readonly T[],
  formOf: (item: T) => F,
): { form: F; items: T[] }[] {
  const runs: { form: F; items: T[] }[] = [];
  for (const item of items) {
    const form = formOf(item);
    const last = runs.at(-1);
    if (last && last.form === form) last.items.push(item);
    else runs.push({ form, items: [item] });
  }
  return runs;
}

/** The evidence of a section, in runs of one form. */
export const evidenceRuns = (section: Section, input: ModelInput) =>
  runsOf(evidenceOf(section, input), evidenceForm);

/** The works of a section, in runs of one form. */
export const workRuns = (section: Section, input: ModelInput) =>
  runsOf(worksOf(section, input), workForm);

/** Whether a work is the one the opening's sheet shows, so a band only links back to it (N6, AG-S6). */
export const isShownAbove = (work: Work, input: ModelInput) =>
  proofOf(input).signature?.id === work.id;

// ───────────── chronology ─────────────

export interface LaneEntry {
  readonly entry: ChronologyEntry;
  /** Its lane, from 0: the first thread met takes lane 0. */
  readonly lane: number;
  /** The entry it forks from, when the section shows it. */
  readonly branchesFrom?: string;
  /** The entry it merges into, when the section shows it. */
  readonly mergesInto?: string;
}

/**
 * Thread lanes (K-6 `chronologyLanes(entries)`): each entry takes its
 * thread's lane, in the order threads first appear; an entry with no thread
 * takes its own kind's lane. Forks name an entry only when it's among
 * `entries`.
 */
export function chronologyLanes(entries: readonly ChronologyEntry[]): readonly LaneEntry[] {
  const lanes = new Map<string, number>();
  const ids = new Set(entries.map((entry) => entry.id));
  return entries.map((entry) => {
    const key = present(entry.thread) ? `thread:${entry.thread}` : `kind:${entry.kind}`;
    if (!lanes.has(key)) lanes.set(key, lanes.size);
    return {
      entry,
      lane: lanes.get(key)!,
      ...(entry.branchesFrom && ids.has(entry.branchesFrom)
        ? { branchesFrom: entry.branchesFrom }
        : {}),
      ...(entry.mergesInto && ids.has(entry.mergesInto) ? { mergesInto: entry.mergesInto } : {}),
    };
  });
}

/** A bead's look on the rail: work as the accent, study hollow, the rest offset. */
export function beadOf(entry: ChronologyEntry): 'work' | 'study' | 'other' {
  return entry.kind === 'role' ? 'work' : entry.kind === 'study' ? 'study' : 'other';
}

// ───────────── GitHub ─────────────

/** A GitHub repository the snapshot shows. */
export interface Repo {
  readonly name: string;
  readonly url: string;
  readonly stars: number;
  readonly description?: string;
  readonly language?: string;
}

const urlKey = (url: string) => url.trim().toLowerCase().replace(/\/+$/, '');

/**
 * The GitHub snapshot repository whose URL matches the work's own URL or
 * one of its links (K-6 `repoForWork(input, work)`), from any ready
 * snapshot, pinned repositories first.
 */
export function repoForWork(input: Pick<ModelInput, 'derived'>, work: Work): Repo | undefined {
  const urls = new Set(
    [work.url, ...(work.links ?? []).map((link) => link.url)].filter(present).map(urlKey),
  );
  if (urls.size === 0) return undefined;
  for (const derived of Object.values(input.derived)) {
    if (derived.state !== 'ready') continue;
    const { pinnedRepos, recentlyActive } = derived.value;
    for (const repo of [...pinnedRepos, ...recentlyActive]) {
      if (urls.has(urlKey(repo.url))) return { name: repo.name, url: repo.url, stars: repo.stars };
    }
  }
  return undefined;
}

/** A repository a GitHub section lists: its link only when it's https, else its name as text. */
export type ListedRepo = Omit<Repo, 'url'> & { readonly url?: string };

export interface GithubView {
  readonly profileUrl: string;
  readonly username: string;
  /** The totals sentence, honouring the section's `show*` flags. */
  readonly totals: string;
  /**
   * The repositories it lists, none excluded: the featured ones first, in
   * the section's order, from anywhere in the snapshot (pinned or recently
   * active), then the pinned ones unless showPinnedRepos is false. At most six.
   */
  readonly repos: readonly ListedRepo[];
  /** Weekly contribution sums, oldest first, for the rays; none when the graph is off. */
  readonly weeks: readonly number[];
}

const plural = (count: number, one: string, many: string, locale: string) =>
  `${formatNumber(count, locale)} ${count === 1 ? one : many}`;

/** What a GitHub section shows, from its publish-frozen snapshot, or none until it's ready. */
export function githubView(section: Section, input: ModelInput): GithubView | undefined {
  if (section.kind !== 'github') return undefined;
  const snapshot = githubSnapshot(section, input);
  if (snapshot?.state !== 'ready') return undefined;
  const data = snapshot.value;
  const locale = input.portfolio.locale;
  const parts = [plural(data.totalRepos, 'public repository', 'public repositories', locale)];
  if (section.showTotalStars && data.totalStarsReceived !== null) {
    parts.push(plural(data.totalStarsReceived, 'star received', 'stars received', locale));
  }
  if (section.showContributionGraph && data.contributionsLastYear !== null) {
    parts.push(
      `${plural(data.contributionsLastYear, 'contribution', 'contributions', locale)} in the last year`,
    );
  }
  const list =
    parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  const excluded = new Set((section.excludeRepos ?? []).map((name) => name.toLowerCase()));
  const known = [...data.pinnedRepos, ...data.recentlyActive];
  const byName = (name: string) => known.find((repo) => repo.name.toLowerCase() === name);
  const featured = (section.featuredRepos ?? [])
    .map((name) => byName(name.toLowerCase()))
    .filter((repo) => repo !== undefined);
  const pinned = section.showPinnedRepos === false ? [] : data.pinnedRepos;
  const seen = new Set<string>();
  const repos = [...featured, ...pinned]
    .filter((repo) => {
      const key = repo.name.toLowerCase();
      if (excluded.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6)
    .map((repo): ListedRepo => ({
      name: repo.name,
      // The kit's rule: a link only to an https address; any other repository is listed as text.
      ...(safeHref(repo.url) ? { url: repo.url } : {}),
      stars: repo.stars,
      ...(present(repo.description) ? { description: repo.description } : {}),
      ...(repo.language ? { language: repo.language } : {}),
    }));
  const weeks: number[] = [];
  if (section.showContributionGraph) {
    const days = [...data.contributionCalendar].sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < days.length; i += 7) {
      weeks.push(days.slice(i, i + 7).reduce((sum, day) => sum + day.count, 0));
    }
  }
  const profileUrl =
    safeHref(data.profileUrl) ?? `https://github.com/${encodeURIComponent(section.username)}`;
  return { profileUrl, username: data.username, totals: `${list}.`, repos, weeks };
}

// ───────────── contact ─────────────

/** Platforms whose names aren't a plain capital. */
const PLATFORM_WORDS: Readonly<Record<string, string>> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  email: 'Email',
  rss: 'RSS',
  orcid: 'ORCID',
};

/** A link's address as a reader sees it: no scheme, no trailing slash; a mailto's address. */
export function addressOf(url: string): string {
  const trimmed = url.trim();
  if (/^mailto:/i.test(trimmed)) return trimmed.replace(/^mailto:/i, '').split('?')[0]!;
  return trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/+$/, '');
}

/** A contact link's label: its own, else its platform's name, else its address. */
export function linkLabel(link: Link): string {
  if (present(link.label)) return squash(link.label);
  if (present(link.platform)) {
    const key = link.platform.trim().toLowerCase();
    return PLATFORM_WORDS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
  }
  return addressOf(link.url);
}

/**
 * The links the horizon lists (brief §5.2, contact): the contact record's,
 * else the portfolio's, without a mailto to the email the horizon already
 * sets as its line.
 */
export function contactLinks(input: Pick<ModelInput, 'portfolio'>): readonly Link[] {
  const { contact, links, identity } = input.portfolio;
  const listed = contact?.links?.length ? contact.links : links;
  const email = present(identity.email) ? identity.email.trim().toLowerCase() : undefined;
  return listed.filter((link) => !(email && addressOf(link.url).toLowerCase() === email));
}

// ───────────── the index ─────────────

/**
 * How many things a section lists, for the Index's counts: works, evidence
 * and entries; a practice part's groups; focus, fun-facts and custom items.
 * Zero for the kinds that list nothing.
 */
export function itemCount(section: Section, input: ModelInput): number {
  switch (section.kind) {
    case 'works':
      return worksOf(section, input).length;
    case 'evidence':
      return evidenceOf(section, input).length;
    case 'chronology':
      return chronologyOf(section, input).length;
    case 'practice':
      return section.part === 'thesis'
        ? 0
        : (input.portfolio.practice?.[section.part]?.length ?? 0);
    case 'focus':
    case 'fun-facts':
      return section.items.length;
    case 'custom':
      return section.items?.length ?? 0;
    default:
      return 0;
  }
}

/** Each core kind's name, for an untitled section's heading. */
export const KIND_WORDS: Readonly<Record<string, string>> = {
  hero: 'Introduction',
  lede: 'Introduction',
  now: 'Now',
  works: 'Works',
  evidence: 'Evidence',
  chronology: 'Chronology',
  practice: 'Practice',
  contact: 'Contact',
  custom: 'Notes',
  quote: 'Quote',
  focus: 'Focus',
  'fun-facts': 'Facts',
  cta: 'Next step',
  github: 'GitHub',
};

/** A section's heading: its title, else its kind's word, which the page marks as the composition's. */
export function headOf(section: Section): { title: string; own: boolean } {
  return present(section.title)
    ? { title: squash(section.title), own: false }
    : { title: KIND_WORDS[section.kind] ?? 'Section', own: true };
}

// ───────────── the home outline's folds (design gate item 8) ─────────────

/** The majority of `values`, the first met on a tie; none for an empty list. */
function majorityOf<T>(values: readonly T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: T | undefined;
  let most = 0;
  for (const [value, count] of counts) {
    if (count > most) {
      best = value;
      most = count;
    }
  }
  return best;
}

/**
 * The sections a band holds behind closed folds, at its end (design gate
 * item 8, lead A's P2 addition 2): display grouping only, so every section
 * keeps its frame, id, destination and Contents entry.
 * - Work and Writing keep one works section open, the one that holds the
 *   signature work, else their first, so home shows four to six works.
 * - Record keeps its summary open: figures (At a glance) and words from
 *   collaborators. Everything else folds; the experience fold's summary is
 *   the latest role.
 * - About keeps the owner's own words (the lede, Now, focus, the quote) and
 *   folds the practice's skills, tools and services and the fun facts.
 * A band whose sections would all fold keeps its first one open.
 */
export function foldsOf(
  band: { readonly id: BandId; readonly sections: readonly Section[] },
  input: ModelInput,
): ReadonlySet<string> {
  const folded = new Set<string>();
  const { sections } = band;
  if (band.id === 'work' || band.id === 'writing') {
    const works = sections.filter((section) => section.kind === 'works');
    const signature = proofOf(input).signature;
    const kept =
      (signature
        ? works.find((section) => worksOf(section, input).some((work) => work.id === signature.id))
        : undefined) ??
      works[0] ??
      sections[0];
    for (const section of sections) if (section !== kept) folded.add(section.id);
  } else if (band.id === 'record') {
    for (const section of sections) {
      const form =
        section.kind === 'evidence'
          ? majorityOf(evidenceOf(section, input).map(evidenceForm))
          : undefined;
      if (form !== 'lites' && form !== 'cascade') folded.add(section.id);
    }
  } else if (band.id === 'about') {
    for (const section of sections) {
      if (
        (section.kind === 'practice' && section.part !== 'thesis') ||
        section.kind === 'fun-facts'
      )
        folded.add(section.id);
    }
  }
  if (sections.length > 0 && folded.size === sections.length) folded.delete(sections[0]!.id);
  return folded;
}

const WORK_NOUNS: Readonly<Record<string, readonly [string, string]>> = {
  writing: ['essay', 'essays'],
  research: ['paper', 'papers'],
  'audio-video': ['episode', 'episodes'],
  music: ['record', 'records'],
};

const EVIDENCE_NOUNS: Readonly<Record<string, readonly [string, string]>> = {
  publication: ['publication', 'publications'],
  talk: ['talk', 'talks'],
  award: ['award', 'awards'],
  patent: ['patent', 'patents'],
  press: ['piece', 'pieces'],
  'external-work': ['site', 'sites'],
  testimonial: ['quote', 'quotes'],
  metric: ['figure', 'figures'],
};

/** The latest role a chronology lists: "Principal Engineer, Reliability, Solstice Payments, 2023–now". */
export function latestRole(section: Section, input: ModelInput): string | undefined {
  if (section.kind !== 'chronology') return undefined;
  const role = chronologyOf(section, input).find((entry) => entry.kind === 'role');
  if (!role) return undefined;
  return [squash(role.title), role.organization, rangeOf(role.period)?.text]
    .filter(present)
    .join(', ');
}

/**
 * A closed fold's summary line, read as content (design gate item 8): the
 * first thing the section holds, in the owner's words (for a chronology,
 * the latest role), and what it holds counted in its own noun, "3 talks".
 */
export function foldLine(
  section: Section,
  input: ModelInput,
): { readonly first?: string; readonly firstLang?: string; readonly count?: string } {
  const locale = input.portfolio.locale;
  const counted = (n: number, [one, many]: readonly [string, string]) =>
    n > 0 ? plural(n, one, many, locale) : undefined;
  switch (section.kind) {
    case 'works': {
      const works = worksOf(section, input);
      const only = works.length === 1 ? works[0] : undefined;
      if (only && PHOTOGRAPHIC.has(only.medium) && only.media?.length) {
        const caption = only.media.map((media) => media.caption).find(present);
        return {
          first: caption ? squash(caption) : squash(only.title),
          firstLang: only.lang,
          count: counted(only.media.length, ['photograph', 'photographs']),
        };
      }
      if (only?.tracks?.length) {
        return {
          first: squash(only.title),
          firstLang: only.lang,
          count: counted(only.tracks.length, ['track', 'tracks']),
        };
      }
      const medium = majorityOf(works.map((work) => work.medium));
      return {
        first: works[0] ? squash(works[0].title) : undefined,
        firstLang: works[0]?.lang,
        count: counted(works.length, (medium && WORK_NOUNS[medium]) || ['work', 'works']),
      };
    }
    case 'evidence': {
      const entries = evidenceOf(section, input);
      const type = majorityOf(entries.map((entry) => entry.type));
      const lead = entries[0];
      const name = lead
        ? [lead.title, lead.publication, lead.organization, lead.statement].find(present)
        : undefined;
      return {
        first: name ? squash(plainInline(name)) : undefined,
        firstLang: lead?.lang,
        count: counted(entries.length, (type && EVIDENCE_NOUNS[type]) || ['record', 'records']),
      };
    }
    case 'chronology': {
      const entries = chronologyOf(section, input);
      const roles = entries.filter((entry) => entry.kind === 'role').length;
      const lead = entries[0];
      const first =
        latestRole(section, input) ??
        (lead
          ? [squash(lead.title), lead.organization, rangeOf(lead.period)?.text]
              .filter(present)
              .join(', ')
          : undefined);
      return {
        first,
        firstLang: lead?.lang,
        count: counted(
          entries.length,
          roles === entries.length ? ['role', 'roles'] : ['entry', 'entries'],
        ),
      };
    }
    case 'practice': {
      if (section.part === 'thesis') return {};
      const groups = input.portfolio.practice?.[section.part] ?? [];
      const names = groups.map((group) => group.name).filter(present);
      if (section.part === 'services') {
        const services = (input.portfolio.practice?.services ?? []).flatMap((group) => group.items);
        return {
          first: services[0] ? squash(services[0].name) : undefined,
          count: counted(services.length, ['offer', 'offers']),
        };
      }
      return {
        first: names.length > 0 ? names.join(', ') : undefined,
        count: counted(groups.length, ['group', 'groups']),
      };
    }
    case 'fun-facts': {
      const items = section.items.filter(present);
      return {
        first: items[0] ? squash(plainInline(items[0])) : undefined,
        count: counted(items.length, ['note', 'notes']),
      };
    }
    case 'github': {
      const view = githubView(section, input);
      const snapshot = githubSnapshot(section, input);
      const repos = snapshot?.state === 'ready' ? snapshot.value.totalRepos : 0;
      return view
        ? { first: view.repos[0]?.name, count: counted(repos, ['repository', 'repositories']) }
        : {};
    }
    default: {
      const n = itemCount(section, input);
      return { count: counted(n, ['item', 'items']) };
    }
  }
}

/** A band's sections in the order the page shows them: the open ones, then the folds. */
export function shownOrder(
  band: { readonly id: BandId; readonly sections: readonly Section[] },
  input: ModelInput,
): readonly Section[] {
  const folded = foldsOf(band, input);
  return [
    ...band.sections.filter((section) => !folded.has(section.id)),
    ...band.sections.filter((section) => folded.has(section.id)),
  ];
}

// ───────────── the case study ─────────────

/** Each medium's word, for the fact sheet. */
const MEDIUM_WORDS: Readonly<Record<string, string>> = {
  software: 'Software',
  system: 'System',
  interface: 'Interface',
  object: 'Object',
  writing: 'Writing',
  research: 'Research',
  'audio-video': 'Audio and video',
  'image-series': 'Image series',
  photography: 'Photography',
  music: 'Music',
};

/** One row of the case study's fact sheet (S4): its term, the composition's word, and the owner's value. */
export interface Fact {
  readonly term: string;
  readonly value: string;
  /** Whether the value is a range of dates, set in tabular figures. */
  readonly numeric?: boolean;
  /** Whether the value is the composition's own word (the medium), not the owner's. */
  readonly own?: boolean;
}

/**
 * The fact sheet a case study leads with (brief §5.2, S4), from the work's
 * own fields alone: its role, its period, its medium, what it's made with,
 * and each award it cites. Reach (highlights) isn't here: it's What it is.
 */
export function caseFacts(work: Work, cited: readonly Evidence[]): readonly Fact[] {
  const facts: Fact[] = [];
  if (present(work.role)) facts.push({ term: 'Role', value: squash(work.role) });
  if (present(work.organization)) facts.push({ term: 'For', value: squash(work.organization) });
  const range = rangeOf(work.period);
  if (range) {
    const since = range.open ? longDate(work.period?.start)?.text : undefined;
    facts.push({ term: 'Period', value: since ? `Since ${since}` : range.text, numeric: true });
  }
  const medium = MEDIUM_WORDS[work.medium];
  if (medium) facts.push({ term: 'Medium', value: medium, own: true });
  const tools = (work.tools ?? []).filter(present).map(squash);
  if (tools.length > 0) facts.push({ term: 'Made with', value: tools.join(', ') });
  for (const award of cited) {
    if (award.type !== 'award' || !present(award.title)) continue;
    const value = [squash(award.title), award.organization, yearOf(award.receivedAt)]
      .filter(present)
      .join(', ');
    facts.push({ term: 'Recognition', value });
  }
  return facts;
}

/** The works section on home a work sits in, for the crumb, and the others there, for All work. */
export function caseHome(
  work: Work,
  input: ModelInput,
):
  | {
      readonly section: Section;
      readonly title: string;
      readonly count: number;
      /** The section's other works, in its order, for the case page's close. */
      readonly others: readonly Work[];
    }
  | undefined {
  const section = input.portfolio.sections.find(
    (each) =>
      each.kind === 'works' &&
      sectionRenders(each, input) &&
      worksOf(each, input).some((listed) => listed.id === work.id),
  );
  if (!section) return undefined;
  return {
    section,
    title: headOf(section).title,
    count: worksOf(section, input).length,
    others: worksOf(section, input).filter((listed) => listed.id !== work.id),
  };
}
