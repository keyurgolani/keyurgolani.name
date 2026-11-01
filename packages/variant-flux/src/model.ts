// Flux's derivations (variants-10 brief §5.10, step 2): every word, item,
// sheet and ink the field, the opening, the sheets and the close show,
// computed from the render input alone. Pure and browser-safe: no markup, no
// clock, no network, no randomness, and no person-specific literal (N4).
// Nothing here names a sample record; each rule reads kinds, fields, media
// sizes and the owner's controls.
//
// The text helpers, the opening's display line and the GitHub view are the
// same rules Aurora Glass wrote (a lane's local copies until lead A lifts
// them into the kit, K-6), with the signatures the kit will take:
// posterLine(input), proofOf(input) and chronologyLanes(entries). The sheets
// are the kit's navigation model (K-1), grouped for display.

import type { ChronologyEntry, Evidence, Link, Placement, Section, Work } from '@portfolio/schema';
import {
  chronologyOf,
  evidenceByIds,
  evidenceOf,
  formatFigure,
  githubSnapshot,
  navigationModel,
  present,
  renderContext,
  safeHref,
  worksByIds,
  worksOf,
  type DestinationId,
  type CaseStudyOutline,
  type GroupingOptions,
  type PageOutline,
  type RoutedWork,
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

/** How many paragraphs a Markdown text holds: blocks between blank lines, at least one. */
export const paragraphsOf = (markdown: string) =>
  Math.max(1, markdown.split(/\n\s*\n/).filter((block) => block.trim() !== '').length);

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
  /** How many inks pour through the opening's field: three, two (no pool under the drop) or none. */
  readonly blobs: '3' | '2' | 'off';
  /** Whether home and a work's own page pour into each other (FX-M5), else the host's crossfade. */
  readonly wipe: boolean;
}

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;

/** The owner's controls (`variantControls.flux.values`), each at its default when unset or invalid. */
export function controlsOf(input: Pick<ModelInput, 'controls'>): Controls {
  return {
    blobs: pick(input.controls.blobs, ['3', '2', 'off'] as const, '3'),
    wipe: typeof input.controls.wipe === 'boolean' ? input.controls.wipe : true,
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

/**
 * A chronology's entries as Experience sets them on home: with three or more and at least one
 * role, the current roles stay open (else the latest entry) and the rest fold as Earlier.
 */
export function currentFirst<T extends Pick<ChronologyEntry, 'kind' | 'period'>>(
  entries: readonly T[],
): { shown: readonly T[]; earlier: readonly T[] } {
  if (entries.length < 3 || !entries.some((entry) => entry.kind === 'role'))
    return { shown: entries, earlier: [] };
  const open = entries.filter((entry) => rangeOf(entry.period)?.open);
  const shown = open.length > 0 ? open : entries.slice(0, 1);
  return { shown, earlier: entries.filter((entry) => !shown.includes(entry)) };
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
 * The display line (K-6 `posterLine(input)`, N5, FX-S6): the thesis's first
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

/** A hero call to action. */
export interface Cta {
  readonly label: string;
  readonly url: string;
}

/**
 * The sentence stop a name takes when the greeting line closes on it: the
 * Devanagari danda for the languages written in it, the ideographic full
 * stop for Chinese and Japanese, else a full stop. None when the name
 * already ends a sentence.
 */
export function terminatorFor(name: string, locale: string): string {
  if (/[.!?؟۔।。！？]$/u.test(name.trim())) return '';
  const language = locale.toLowerCase().split('-')[0] ?? '';
  if (['hi', 'mr', 'ne', 'sa', 'mai', 'bho', 'kok', 'doi'].includes(language)) return '।';
  if (language === 'ja' || language === 'zh') return '。';
  return '.';
}

export interface Opening {
  /**
   * The h1's first line (FX-S6, N5): the greeting with the name, set as a
   * sentence. Without a greeting it's the name alone. When the key phrase
   * is the name itself, the greeting's words alone, so the name shows once;
   * none without a greeting.
   */
  readonly greeting?: {
    readonly words?: string;
    readonly name?: string;
    readonly stop?: string;
  };
  /** The h1's second line, the key phrase: the thesis's first sentence (N5). */
  readonly key: PosterLine;
  /** The one positioning line: the hero's tagline, unless it's the key phrase, else its subtagline. */
  readonly positioning?: string;
  /**
   * The now line (P-0's `positioning.now`): the hero's subtagline, when the
   * positioning line isn't already it. The thesis frame sets it after the
   * thesis's rest; with no thesis section, the opening sets it under the
   * positioning line.
   */
  readonly now?: string;
  /** The one call to action: the hero's first. */
  readonly cta?: Cta;
}

/** The first view's words (brief §5.10, derivations). */
export const openingOf = once((input): Opening => {
  const { identity, locale } = input.portfolio;
  const hero = heroOf(input);
  const key = posterLine(input);
  const name = squash(present(hero?.name) ? hero.name : identity.name);
  const tagline =
    present(hero?.tagline) && key.source !== 'hero'
      ? hero.tagline
      : key.source === 'hero' && present(hero?.tagline)
        ? leadOf(hero.tagline).rest
        : undefined;
  const positioning = present(tagline)
    ? tagline
    : present(hero?.subtagline)
      ? hero.subtagline
      : undefined;
  const first = (hero?.ctas ?? []).find((cta) => present(cta.label) && present(cta.url));
  return {
    ...(key.source === 'name'
      ? present(hero?.greeting)
        ? { greeting: { words: squash(hero.greeting) } }
        : {}
      : {
          greeting: {
            ...(present(hero?.greeting) ? { words: squash(hero.greeting) } : {}),
            name,
            stop: terminatorFor(name, locale),
          },
        }),
    key,
    ...(present(positioning) ? { positioning } : {}),
    ...(present(hero?.subtagline) && hero.subtagline !== positioning
      ? { now: hero.subtagline }
      : {}),
    ...(first ? { cta: { label: squash(first.label), url: first.url } } : {}),
  };
});

/** The hero's calls to action after the first: the close lists them, since the opening keeps one. */
export function moreActions(input: Pick<ModelInput, 'portfolio'>): readonly Cta[] {
  const ctas = (heroOf(input)?.ctas ?? []).filter((cta) => present(cta.label) && present(cta.url));
  return ctas.slice(1).map((cta) => ({ label: squash(cta.label), url: cta.url }));
}

/** The h1 as one accessible string: the greeting line, a space, the key phrase (FX-M6). */
export function headlineText(opening: Opening): string {
  const { greeting, key } = opening;
  if (!greeting) return key.text;
  const named = greeting.name ? `${greeting.name}${greeting.stop ?? ''}` : undefined;
  const line = [greeting.words, named].filter(present).join(' ');
  return `${line} ${key.text}`;
}

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

/** One item of the proof line: a figure and its words, or words alone. */
export interface ProofItem {
  readonly id: string;
  /** The figure, set in the numeric role: a metric's value, or none. */
  readonly figure?: string;
  /** The words: a metric's statement up to its first comma, else its title; an award's title and year. */
  readonly words: string;
}

/**
 * The one line of proof under the call to action (FX-S7, N8): the proof
 * strip, at most 3, as a list of items in the owner's order. A metric with a
 * value shows it with its words; an award, its title and year; other
 * evidence, its title. Nothing is lower-cased.
 */
export const proofLine = once((input): readonly ProofItem[] => {
  const locale = input.portfolio.locale;
  const items: ProofItem[] = [];
  for (const entry of proofOf(input).proof) {
    if (items.length === 3) break;
    const statement = present(entry.statement) ? plainInline(entry.statement) : undefined;
    const title = present(entry.title) ? squash(entry.title) : undefined;
    if (entry.type === 'metric') {
      const words = statement ? upToComma(statement) : title;
      const figure = metricValue(entry, words, locale);
      if (words) items.push({ id: entry.id, ...(figure ? { figure } : {}), words });
    } else if (entry.type === 'award') {
      const year = yearOf(entry.receivedAt ?? entry.publishedAt ?? entry.asOf);
      if (title) {
        const words = year && !title.includes(year) ? `${title} ${year}` : title;
        items.push({ id: entry.id, words });
      }
    } else if (title) {
      items.push({ id: entry.id, words: title });
    }
  }
  return items;
});

// ───────────── the plate ─────────────

export interface Plate {
  readonly work: Work;
  /** The cover, else the first image; none sets the work's title as type inside the drop. */
  readonly media?: Placement;
  /**
   * How the image sits in the drop's safe area (FX-M11): a landscape image
   * between 1.4 and 1.85 wide per unit of height is cropped about its focal
   * point, and anything else is contained whole.
   */
  readonly fit?: 'crop' | 'contain';
  /** When it started, for the kicker "Signature work, since January 2022". */
  readonly since?: { readonly text: string; readonly iso: string };
  /** The case study's route, else the work's first link. */
  readonly link?: { readonly href: string; readonly caseStudy: boolean };
}

/** Whether a work has its own page: a case study, which needs a slug. */
export const hasCaseStudy = (work: Work): work is Work & { slug: string } =>
  work.caseStudy !== undefined && work.slug !== undefined;

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
 * Where a work's title links when it has no page of its own: its URL, else its first link when the
 * owner gave that link no name. A named one keeps its name, in a links line under the work's words.
 */
export function titleLink(work: Work): string | undefined {
  if (present(work.url)) return work.url;
  const link = (work.links ?? []).find((each) => present(each.url));
  return link && !present(link.label) ? link.url : undefined;
}

/**
 * The plate under the headline (FX-M2, N6): the signature work in its
 * liquid drop, with its media, its kicker from `period.start`, and its link.
 * `caseHref` is the route to a work's own page, which the render input knows.
 * None without a signature work (or a featured one in its place).
 */
export function plateOf(
  input: ModelInput,
  caseHref: (work: Work & { slug: string }) => string,
): Plate | undefined {
  const work = proofOf(input).signature;
  if (!work) return undefined;
  const since = longDate(work.period?.start);
  const href = hasCaseStudy(work) ? caseHref(work) : titleLink(work);
  return {
    work,
    ...dropMedia(work, input),
    ...(since ? { since } : {}),
    ...(href ? { link: { href, caseStudy: hasCaseStudy(work) } } : {}),
  };
}

/** What a work's drop holds: its cover, else its first ready image, and how it sits there. */
function dropMedia(work: Work, input: ModelInput): Pick<Plate, 'media' | 'fit'> {
  const media = [work.cover, ...(work.media ?? [])].find(
    (placement): placement is Placement =>
      placement !== undefined && readyMedia(placement, input) !== undefined,
  );
  if (!media) return {};
  const size = readyMedia(media, input)!;
  const ratio = size.height > 0 ? size.width / size.height : 0;
  return { media, fit: ratio >= 1.4 && ratio <= 1.85 ? 'crop' : 'contain' };
}

// ───────────── a work's own page ─────────────

/** The case study's parts as the page sets them, each with the outline's anchor. */
export type CasePartKey = CaseStudyOutline['parts'][number]['key'];

export interface CaseView {
  readonly work: RoutedWork;
  /** The drop's image, as the plate's: the cover, else the first ready image. */
  readonly media?: Placement;
  readonly fit?: 'crop' | 'contain';
  /** Its title's length, which sets its step, as the key phrase's. */
  readonly length: PosterLine['length'];
  /** Its widest word in em, so the title keeps every word whole on a phone. */
  readonly titleEms: number;
  /** Whether it's the signature work: the crumb says so. */
  readonly signature: boolean;
  readonly since?: { readonly text: string; readonly iso: string };
  /** The sheet on home that lists the work: the crumb's link and the tab the bar marks. */
  readonly home: { readonly id: SheetId; readonly word: string; readonly own: boolean };
  /** The work's highlights as the opening's one line of proof, at most three. */
  readonly proof: readonly string[];
  /** Where each part sits: the decisions after the work's words, then the account in two runs. */
  readonly decisions?: CaseStudyOutline['parts'][number];
  readonly before: readonly CaseStudyOutline['parts'][number][];
  readonly after: readonly CaseStudyOutline['parts'][number][];
  readonly reflection?: CaseStudyOutline['parts'][number];
  /** The records the work cites, in its order, that the page lists on the record. */
  readonly cited: readonly Evidence[];
  /** Whether the evidence part's anchor sits on the record (its text is empty). */
  readonly evidenceOnRecord: boolean;
}

const BEFORE = new Set<CasePartKey>(['challenge', 'context', 'role', 'constraints']);
const AFTER = new Set<CasePartKey>(['evidence', 'outcomes']);

/**
 * A work's own page (brief §5.10, P2): the outline's parts placed as P-0's
 * case sets them. The decisions are the centrepiece, after the work's own
 * words; the account reads in two runs, what it was up against and what
 * changed; the reflection closes it; and the records the work cites follow
 * on the record. The evidence part is its text in the second run, or the
 * record when it has no text of its own.
 */
export function caseOf(
  input: ModelInput,
  outline: CaseStudyOutline,
  sheets: readonly Sheet[],
): CaseView {
  const { work } = outline;
  const at = (key: CasePartKey) => outline.parts.find((part) => part.key === key);
  const cited = evidenceByIds(work.evidence, input);
  const evidenceOnRecord = at('evidence') !== undefined && !present(work.caseStudy.evidence);
  const holder =
    sheets.find((sheet) =>
      sheet.sections.some((section) => worksOf(section, input).some((each) => each.id === work.id)),
    ) ?? sheets.find((sheet) => sheet.id === 'work');
  const since = longDate(work.period?.start ?? work.publishedAt ?? work.releasedAt);
  return {
    work,
    ...dropMedia(work, input),
    length: lengthClass(work.title),
    titleEms: widestWordEms(work.title),
    signature: proofOf(input).signature?.id === work.id,
    ...(since ? { since } : {}),
    home:
      holder?.word !== undefined
        ? { id: holder.id, word: holder.word, own: holder.own }
        : { id: 'work', word: 'Work', own: true },
    proof: (work.highlights ?? []).filter(present).slice(0, 3),
    ...(at('decisions') ? { decisions: at('decisions')! } : {}),
    before: outline.parts.filter((part) => BEFORE.has(part.key)),
    after: outline.parts.filter(
      (part) => AFTER.has(part.key) && !(part.key === 'evidence' && evidenceOnRecord),
    ),
    ...(at('reflection') ? { reflection: at('reflection')! } : {}),
    cited,
    evidenceOnRecord,
  };
}

// ───────────── sheets ─────────────

/** A sheet: one of the five destinations, or the untitled sheet of the owner's own sections. */
export type SheetId = DestinationId | 'more';

/** The sheets in reading order, Contact last: the untitled sheet sits just before it. */
export const SHEET_ORDER: readonly SheetId[] = [
  'work',
  'writing',
  'record',
  'about',
  'more',
  'contact',
];

/** The field's three inks: signature-start, signature-end and emphasis. */
export type Ink = 'a' | 'b' | 'c';

const INKS: readonly Ink[] = ['a', 'b', 'c'];

/**
 * Flux's sheets are the kit's five destinations, through navigationModel's
 * grouping hook (K-1): display only, so every section keeps the destination
 * the canonical map gives it. The first hero and the thesis it shows open the
 * page, so neither is on a sheet; the sections the map leaves to the index
 * (custom, extension and untitled lede sections) go on an untitled sheet
 * before Contact, which stands for About.
 */
export function sheetGrouping(input: ModelInput): GroupingOptions<SheetId> {
  const opening = new Set([heroOf(input)?.id, thesisSectionOf(input)?.id].filter(present));
  return {
    groups: SHEET_ORDER.map((id) => ({ id, destination: id === 'more' ? 'about' : id })),
    unplaced: 'more',
    groupOf: (section) => (opening.has(section.id) ? null : undefined),
  };
}

export interface Sheet {
  readonly id: SheetId;
  /** The sheet's word, on its tab; none for the untitled sheet. */
  readonly word?: string;
  /** Whether the word is the composition's (English) rather than the owner's title. */
  readonly own: boolean;
  readonly sections: readonly Section[];
  /** The ink its tab's lip and drip take, in turn down the page. */
  readonly ink: Ink;
  /**
   * Where its tab sits along the page's width, 0 to 1: the tabs step across
   * the page in reading order, the first at the start and the last at the end.
   */
  readonly step: number;
}

/** Advances in em of the narrow and wide characters a display face sets; the rest take the class's. */
const NARROW = /[\s.,:;'’!|ijl]/u;
const SLIM = /[frtI()[\]\-]/u;
const BROAD = /[mwMW@%]/u;
const UPPER = /\p{Lu}/u;
// Han, kana, Hangul, and the full-width forms: about one em each.
const SQUARE =
  /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Hangul}\u{3000}-\u{303F}\u{FF01}-\u{FF60}]/u;

/**
 * About how many em a word takes in a proportional display face, so its tab
 * can size it to fit before it wraps: the word's characters by width class,
 * a little wider than Inter and Trebuchet set them (the planned and default
 * faces measure 5.56 and 5.4 em for "Get in touch", which this puts at 5.98),
 * so the estimate errs toward a size that fits. A monospaced or extended face
 * runs wider than this, and its word balances onto a second line instead.
 */
export function wordEms(word: string): number {
  let ems = 0;
  for (const character of word) {
    if (SQUARE.test(character)) ems += 1;
    else if (NARROW.test(character)) ems += 0.28;
    else if (SLIM.test(character)) ems += 0.38;
    else if (BROAD.test(character)) ems += 0.9;
    else if (UPPER.test(character)) ems += 0.68;
    else ems += 0.56;
  }
  return Math.round(ems * 1.06 * 100) / 100;
}

/**
 * The widest word of a display line, in em, so the line can size itself to keep its widest word
 * whole on its measure. Han, kana and Hangul break between any two characters, so each is a word.
 */
export function widestWordEms(text: string): number {
  const words = squash(text)
    .split(' ')
    .flatMap((word) =>
      [...word].reduce<string[]>(
        (runs, character) => {
          if (SQUARE.test(character)) return [...runs, character, ''];
          runs[runs.length - 1] += character;
          return runs;
        },
        [''],
      ),
    );
  return Math.max(0, ...words.map(wordEms));
}

const sheetsCache = new WeakMap<object, WeakMap<object, readonly Sheet[]>>();

/**
 * The page's sheets, from the navigation model's groups for `outline`, each
 * with its sections in reading order, none empty. Contact's word is the
 * contact section's own title when it has one.
 */
export function sheetsOf(input: ModelInput, outline: PageOutline): readonly Sheet[] {
  // Keyed on the outline too: one input may be asked for the sheets of another outline.
  const byOutline = sheetsCache.get(input) ?? new WeakMap<object, readonly Sheet[]>();
  sheetsCache.set(input, byOutline);
  const cached = byOutline.get(outline);
  if (cached) return cached;
  const model = navigationModel(outline, { grouping: sheetGrouping(input) });
  const byId = new Map(input.portfolio.sections.map((section) => [section.id, section]));
  const groups = model.groups
    .map((group) => ({
      id: group.id,
      label: group.label,
      sections: group.sections.flatMap((entry) => {
        const section = byId.get(entry.id);
        return section ? [section] : [];
      }),
    }))
    .filter((group) => group.sections.length > 0);
  const titled = groups.filter((group) => group.id !== 'more').length;
  let place = 0;
  const sheets = groups.map(({ label, ...group }, index): Sheet => {
    const ink = INKS[index % INKS.length]!;
    if (group.id === 'more') return { ...group, own: true, ink, step: 0 };
    const step = titled > 1 ? place / (titled - 1) : 0;
    place += 1;
    const contactTitle =
      group.id === 'contact'
        ? group.sections.find((section) => section.kind === 'contact')?.title
        : undefined;
    // Else the navigation model's label for the destination: the kit's word, English.
    return present(contactTitle)
      ? { ...group, word: squash(contactTitle), own: false, ink, step }
      : { ...group, word: label, own: true, ink, step };
  });
  byOutline.set(outline, sheets);
  return sheets;
}

/**
 * Whether a section shows folded, behind a native disclosure at the end of
 * its sheet (the home outline, lead A 2026-10-26): Record keeps its summary
 * open (the figures, the words from collaborators and the latest roles) and
 * folds the rest of the record; About folds its skills and tools. Display
 * grouping alone: no destination moves.
 */
export function folds(section: Section, input: ModelInput): boolean {
  switch (section.kind) {
    case 'evidence':
      return evidenceOf(section, input).some(
        (entry) => entry.type !== 'metric' && entry.type !== 'testimonial',
      );
    case 'chronology':
      return !chronologyOf(section, input).some((entry) => entry.kind === 'role');
    case 'github':
      return true;
    case 'practice':
      return section.part === 'skills' || section.part === 'tools';
    default:
      return false;
  }
}

// ───────────── the forms ─────────────

/**
 * A sheet's sections as blocks: a lede with the Now and focus sections right
 * after it is one spread, the lede beside a column of theirs (the reading
 * column never parks beside an empty half); every other section is a
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

/** How a work shows (brief §5.10: every work a card, the gallery blob-masked). */
export type WorkForm = 'card' | 'essay' | 'episode' | 'gallery' | 'sleeve';

export function workForm(work: Work): WorkForm {
  switch (work.medium) {
    case 'writing':
    case 'research':
      return 'essay';
    case 'audio-video':
      return 'episode';
    case 'image-series':
    case 'photography':
      return 'gallery';
    case 'music':
      return 'sleeve';
    default:
      // software, system, interface, object, and an extension's medium.
      return 'card';
  }
}

/** How a piece of evidence shows (brief §5.10). */
export type EvidenceForm = 'glance' | 'voices' | 'rows' | 'links';

export function evidenceForm(entry: Evidence): EvidenceForm {
  switch (entry.type) {
    case 'metric':
      return entry.metric?.value !== undefined ? 'glance' : 'rows';
    case 'testimonial':
      return 'voices';
    case 'external-work':
      return 'links';
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

/** Whether a work is the one the opening's plate shows, so a sheet only links back to it (N6). */
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
 * The links the close lists (brief §5.10, contact): the contact record's,
 * else the portfolio's, without a mailto to the email the close already
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
/**
 * Whether a section's title says its sheet's tab word again, so it shows for assistive
 * technology alone: the same words, or, for the sheet's first section, a title that opens with
 * the tab's word ("Work Showcase" under Work), so the tab reads once (the lead's SF14 ruling).
 */
export function echoesTab(title: string, word: string | undefined, first: boolean): boolean {
  if (!present(title) || !present(word)) return false;
  const a = squash(title).toLocaleLowerCase();
  const b = squash(word).toLocaleLowerCase();
  return a === b || (first && a.startsWith(`${b} `));
}

export function headOf(section: Section): { title: string; own: boolean } {
  return present(section.title)
    ? { title: squash(section.title), own: false }
    : { title: KIND_WORDS[section.kind] ?? 'Section', own: true };
}
