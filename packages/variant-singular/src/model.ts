// Singular's derivations (variants-10 brief §5.7): which content answers
// each of the six questions, which ground each panel stands on, what its one
// action is, and which sections follow in the record, computed from the
// render input alone. Pure and browser-safe: no markup, no clock, no
// network, no randomness, and no person-specific literal (N4). Every rule
// reads kinds, fields, the curation lists and the owner's controls.
//
// Three helpers are local copies until A lifts them into the kit (K-6):
// firstSentence(), currentRole() and proofOf(), with the signatures the
// kit will take.

import type { ChronologyEntry, Evidence, Link, Section, Work } from '@portfolio/schema';
import {
  chronologyOf,
  evidenceOf,
  isRoutedWork,
  navigationModel,
  present,
  sectionShows,
  worksByIds,
  worksOf,
  type DestinationId,
  type PageOutline,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';

export { present };

/** What the derivations read: the visible content, the owner's controls, and the snapshots. */
export type ModelInput = Pick<VariantRenderInput, 'portfolio' | 'controls' | 'derived'>;

// ───────────── text ─────────────

/** Collapses runs of white space. */
export const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Inline Markdown as plain text, for a line set in one voice: link text
 * kept, emphasis and code marks dropped (C3, smell 17).
 */
export function plainInline(markdown: string): string {
  return squash(
    markdown
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(\*|_)(.+?)\1/g, '$2')
      .replace(/`([^`]+)`/g, '$1'),
  );
}

/** A Latin, Arabic or Devanagari stop before a space or the end, or a CJK stop. */
const SENTENCE_END = /^([\s\S]+?(?:[.!?؟۔।](?=\s|$)|[。！？]))\s*([\s\S]*)$/u;

/**
 * A text's first sentence, and what follows it (K-6 `firstSentence`, local
 * copy). A text with no sentence end is one sentence.
 */
export function firstSentence(text: string): { lead: string; rest?: string } {
  const flat = squash(text);
  const match = SENTENCE_END.exec(flat);
  if (!match) return { lead: flat };
  const rest = match[2]!.trim();
  return rest ? { lead: match[1]!, rest } : { lead: match[1]! };
}

/** How long a display line is, which sets its step: short lines take the hero step, the rest one less. */
export function lengthClass(text: string): 'short' | 'long' {
  return [...squash(text)].length <= 48 ? 'short' : 'long';
}

/** A number as the portfolio's language writes it. */
export function formatNumber(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return new Intl.NumberFormat('en').format(value);
  }
}

/** Names joined as English joins them, "a, b and c", for the composition's own sentences. */
export function listAnd(items: readonly string[]): string {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** Two digits, as the counter sets each number. */
export const pad2 = (n: number) => String(n).padStart(2, '0');

/** A URL's host as a reader sees it, without www.; the address for a mailto; the text for a path. */
export function hostOf(url: string): string {
  const trimmed = url.trim();
  if (/^mailto:/i.test(trimmed)) return trimmed.replace(/^mailto:/i, '').split('?')[0]!;
  try {
    const parsed = new URL(trimmed);
    if (parsed.host) return parsed.host.replace(/^www\./i, '').toLowerCase();
  } catch {
    // Not an absolute URL: shown as written, below.
  }
  return trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/+$/, '');
}

/** Whether a URL leaves the site. */
export const outbound = (url: string) => /^https?:\/\//i.test(url.trim());

/** Whether a URL is a fragment of this page, such as `#contact`. */
export const fragment = (url: string) => url.trim().startsWith('#');

// ───────────── once per render ─────────────

/** A derivation several parts read, worked out once per render input, which no render changes. */
function once<T>(read: (input: ModelInput) => T): (input: ModelInput) => T {
  const cache = new WeakMap<object, T>();
  return (input) => {
    const key = input as object;
    if (cache.has(key)) return cache.get(key)!;
    const value = read(input);
    cache.set(key, value);
    return value;
  };
}

// ───────────── the records ─────────────

/**
 * The current role (K-6 `currentRole`, local copy): the role-kind
 * chronology entry with no end and the latest start.
 */
export function currentRole(input: Pick<ModelInput, 'portfolio'>): ChronologyEntry | undefined {
  const open = input.portfolio.chronology.filter(
    (entry) => entry.kind === 'role' && entry.period && !present(entry.period.end),
  );
  return [...open].sort((a, b) => String(b.period.start).localeCompare(String(a.period.start)))[0];
}

/**
 * What vouches for a work (K-6 `proofOf`, local copy, for one work): its
 * highlights, else the titles of the evidence it cites, at most three.
 */
export function proofOf(input: Pick<ModelInput, 'portfolio'>, work: Work): readonly string[] {
  const highlights = (work.highlights ?? []).filter(present).map(squash);
  if (highlights.length > 0) return highlights.slice(0, 3);
  // In the order the work cites them.
  const byId = new Map(input.portfolio.evidence.map((entry) => [entry.id, entry]));
  return (work.evidence ?? [])
    .map((id) => byId.get(id))
    .filter((entry): entry is Evidence => entry !== undefined && present(entry.title))
    .map((entry) => squash(entry.title!))
    .slice(0, 3);
}

/** The control's id, when it's a string the owner set. */
const chosen = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/** The first hero section: panel 1's frame. */
export function heroOf(input: ModelInput): Extract<Section, { kind: 'hero' }> | undefined {
  return input.portfolio.sections.find(
    (section): section is Extract<Section, { kind: 'hero' }> => section.kind === 'hero',
  );
}

/** The first practice section that shows the thesis. */
export function thesisSectionOf(input: ModelInput): Section | undefined {
  if (!present(input.portfolio.practice?.thesis)) return undefined;
  return input.portfolio.sections.find(
    (section) => section.kind === 'practice' && section.part === 'thesis',
  );
}

/** An evidence section's share of one evidence type. */
function share(section: Section, input: ModelInput, test: (entry: Evidence) => boolean): number {
  const items = evidenceOf(section, input);
  return items.length ? items.filter(test).length / items.length : 0;
}

/** A metric entry with a value, which panel 3 can set as a figure. */
export const isFigure = (entry: Evidence) =>
  entry.type === 'metric' && typeof entry.metric?.value === 'number';

// ───────────── panel 1: who ─────────────

export interface Who {
  /** The panel's single display line (SG-M1): the thesis's first sentence, else a tagline. */
  readonly line?: string;
  readonly lineClass: 'short' | 'long';
  /** The lede under it, at title size: whichever of the hero's tagline or the thesis the line didn't take. */
  readonly lede?: string;
  /** The aside: the subtagline, the current role, and the place. */
  readonly aside: readonly string[];
}

function readWho(input: ModelInput): Who {
  const { identity, practice } = input.portfolio;
  const hero = heroOf(input);
  const thesis = present(practice?.thesis)
    ? firstSentence(plainInline(practice.thesis)).lead
    : undefined;
  const tagline = present(hero?.tagline) ? squash(hero.tagline) : undefined;
  const identityTagline = present(identity.tagline) ? squash(identity.tagline) : undefined;
  const order = input.controls.introSource === 'hero' ? [tagline, thesis] : [thesis, tagline];
  const line = [...order, identityTagline].find(present);
  const lede = order.find((text) => present(text) && text !== line);
  const role = currentRole(input);
  const where = present(identity.location) ? squash(identity.location) : undefined;
  const pronouns = present(identity.pronouns) ? squash(identity.pronouns) : undefined;
  const aside = [
    present(hero?.subtagline) ? squash(hero.subtagline) : undefined,
    role ? [role.title, role.organization].filter(present).map(squash).join(', ') : undefined,
    where && pronouns ? `${where} (${pronouns})` : (where ?? pronouns),
  ].filter(present);
  return { line, lineClass: line ? lengthClass(line) : 'short', lede, aside };
}
export const whoOf = once(readWho);

// ───────────── panel 2: best work ─────────────

/** The first works section with a work to show. */
function firstWorksSection(input: ModelInput): Section | undefined {
  return input.portfolio.sections.find(
    (section) => section.kind === 'works' && worksOf(section, input).length > 0,
  );
}

/**
 * Panel 2's work: the bestWork control, else the signature, else the first
 * featured work, else the first work of the first works section.
 */
export function bestWorkOf(input: ModelInput): Work | undefined {
  const pick = (id: string | undefined) => (id ? worksByIds([id], input)[0] : undefined);
  const first = firstWorksSection(input);
  return (
    pick(chosen(input.controls.bestWork)) ??
    pick(input.portfolio.signature) ??
    pick(input.portfolio.featured?.[0]) ??
    (first ? worksOf(first, input)[0] : undefined)
  );
}

/** Where a work's own page or its own address is, the case page first. */
export type WorkLink =
  { readonly kind: 'case'; readonly slug: string } | { readonly kind: 'url'; readonly url: string };

export function workLink(work: Work): WorkLink | undefined {
  if (isRoutedWork(work)) return { kind: 'case', slug: work.slug };
  const url = [work.url, work.links?.[0]?.url, work.audioUrl, work.videoUrl].find(present);
  return url ? { kind: 'url', url: url.trim() } : undefined;
}

// ───────────── panel 3: numbers ─────────────

export interface Numbers {
  /** The evidence section the figures come from, or none when they're the proof list's. */
  readonly section?: Section;
  readonly figures: readonly Evidence[];
}

function readNumbers(input: ModelInput): Numbers | undefined {
  const sections = input.portfolio.sections.filter((section) => section.kind === 'evidence');
  const figuresOf = (section: Section) => evidenceOf(section, input).filter(isFigure);
  const control = chosen(input.controls.numbersSection);
  const owned = sections.find((section) => section.id === control);
  if (owned && figuresOf(owned).length >= 2) {
    return { section: owned, figures: figuresOf(owned).slice(0, 6) };
  }
  const section = sections.find(
    (candidate) =>
      share(candidate, input, (entry) => entry.type === 'metric') >= 0.5 &&
      figuresOf(candidate).length >= 2,
  );
  if (section) return { section, figures: figuresOf(section).slice(0, 6) };
  const proof = input.portfolio.evidence.filter(
    (entry) => (input.portfolio.proof ?? []).includes(entry.id) && isFigure(entry),
  );
  return proof.length >= 2 ? { figures: proof.slice(0, 6) } : undefined;
}
export const numbersOf = once(readNumbers);

/**
 * A figure's row: its statement, its description, and its value with its
 * unit, the unit dropped when the statement already starts with it.
 */
export function figureRow(entry: Evidence, locale: string) {
  const statement = present(entry.statement)
    ? plainInline(entry.statement)
    : present(entry.title)
      ? squash(entry.title)
      : '';
  const unit = present(entry.metric?.unit) ? squash(entry.metric.unit) : undefined;
  const folded = unit !== undefined && statement.toLowerCase().startsWith(unit.toLowerCase());
  return {
    statement,
    description: present(entry.description) ? plainInline(entry.description) : undefined,
    value: formatNumber(entry.metric!.value!, locale),
    raw: entry.metric!.value!,
    unit: folded ? undefined : unit,
  };
}

// ───────────── panel 4: more work ─────────────

/** At most this many works in panel 4: with the best work, 4 to 6 on home in all (the home outline, Design gate item 8). */
export const MORE_MAX = 5;

/** A works section the record shows as one work's gallery or album, which a row in panel 4 can't stand in for. */
const ownForm = (works: readonly Work[]) =>
  works.length === 1 &&
  ((works[0]!.medium === 'image-series' && (works[0]!.media?.length ?? 0) > 0) ||
    works[0]!.medium === 'music');

/**
 * Panel 4's works: the featured works without the best one, then the rest
 * of the best work's own section, then each later works section whose
 * works all fit in what's left (the lead's ruling on the mockup, item 3:
 * Essays folds into a back-pointer), never splitting a section and never
 * a gallery's or an album's; at most MORE_MAX, each once.
 */
function readMoreWorks(input: ModelInput): readonly Work[] {
  const best = bestWorkOf(input);
  const sections = input.portfolio.sections.filter(
    (section) => section.kind === 'works' && sectionShows(section, input),
  );
  const home = best
    ? sections.find((section) => worksOf(section, input).some((work) => work.id === best.id))
    : undefined;
  const seen = new Set<string>(best ? [best.id] : []);
  const out: Work[] = [];
  const add = (works: readonly Work[]) => {
    for (const work of works) {
      if (seen.has(work.id) || out.length >= MORE_MAX) continue;
      seen.add(work.id);
      out.push(work);
    }
  };
  add(worksByIds(input.portfolio.featured, input));
  if (home) add(worksOf(home, input));
  for (const section of sections) {
    if (section === home) continue;
    const works = worksOf(section, input);
    if (works.length === 0 || ownForm(works)) continue;
    const left = works.filter((work) => !seen.has(work.id));
    if (left.length > 0 && out.length + left.length <= MORE_MAX) add(left);
  }
  return out;
}
export const moreWorksOf = once(readMoreWorks);

// ───────────── panel 5: references ─────────────

/** Evidence types that read as a reference when no one's words do. */
const CITED = ['publication', 'award', 'press'] as const;

function readReferences(input: ModelInput): Section | undefined {
  const numbers = numbersOf(input)?.section?.id;
  const sections = input.portfolio.sections.filter(
    (section) =>
      section.kind === 'evidence' && section.id !== numbers && evidenceOf(section, input).length,
  );
  const control = chosen(input.controls.referencesSection);
  return (
    sections.find((section) => section.id === control) ??
    sections.find((section) => share(section, input, (e) => e.type === 'testimonial') >= 0.5) ??
    sections.find((section) =>
      CITED.some((type) => share(section, input, (e) => e.type === type) >= 0.5),
    )
  );
}
export const referencesOf = once(readReferences);

// ───────────── panel 6: contact ─────────────

/** The contact section: panel 6's frame. */
export function contactSectionOf(input: ModelInput): Section | undefined {
  // Only one that renders: with no contact record, email or link it renders nothing, so no panel, rail dot or band may point at it.
  return input.portfolio.sections.find(
    (section) => section.kind === 'contact' && sectionShows(section, input),
  );
}

/** The call-to-action sections the contact panel nests, only when there is a contact section. */
export function nestedCtasOf(input: ModelInput): readonly Extract<Section, { kind: 'cta' }>[] {
  if (!contactSectionOf(input)) return [];
  return input.portfolio.sections.filter(
    (section): section is Extract<Section, { kind: 'cta' }> => section.kind === 'cta',
  );
}

/**
 * The hero's calls to action that panel 1's band doesn't carry (all of them,
 * unless heroAction: cta puts the first on the band), in his words, for Contents:
 * panel 1 keeps its one action (SG-M3), and his words still show (the
 * lead's ruling on the sweep).
 */
export function heroCtasOf(input: ModelInput): readonly Link[] {
  const ctas = (heroOf(input)?.ctas ?? []).filter(
    (cta) => present(cta.label) && present(cta.url) && landsOnHome(cta.url, input),
  );
  // One that names a stop Contents already lists, in the stop's own words, is a true duplicate
  // there (design review P1-7); in words of his own, it stays.
  const stops = homeStopsOf(input);
  const words = (text: string) => squash(text).toLowerCase();
  const repeats = (cta: Link) => {
    const hash = /^\/?#(.+)$/.exec(cta.url.trim());
    const stop = hash ? stops.find((each) => each.anchor === hash[1]) : undefined;
    return stop !== undefined && words(stop.label.text) === words(cta.label ?? '');
  };
  return ctas.slice(input.controls.heroAction === 'cta' ? 1 : 0).filter((cta) => !repeats(cta));
}

/** The owner's own words for an email to his address: a hero's or a nested call to action's label for that mailto, the first one. */
export function ownEmailLabel(input: ModelInput): string | undefined {
  const { identity } = input.portfolio;
  if (!present(identity.email)) return undefined;
  const mailto = `mailto:${identity.email.trim()}`.toLowerCase();
  const actions = [
    ...(heroOf(input)?.ctas ?? []),
    ...nestedCtasOf(input).flatMap((cta) => [cta.primaryAction, cta.secondaryAction]),
  ].filter((action) => action !== undefined);
  const own = actions.find(
    (action) => action.url.trim().toLowerCase() === mailto && present(action.label),
  );
  return own ? squash(own.label) : undefined;
}

/**
 * The contact panel's one action: an email to the identity's address, in
 * the owner's words when a call to action to that address has them (the
 * lead's ruling: his label wins), else "Email" and the name, or the
 * address, as contactLabel says; with no email, the first nested call to
 * action, else the first link.
 */
export function emailAction(input: ModelInput): PanelAction | undefined {
  const { identity } = input.portfolio;
  const email = present(identity.email) ? identity.email.trim() : undefined;
  const own = ownEmailLabel(input);
  if (email && own) {
    return {
      label: own,
      own: true,
      target: { kind: 'url', url: `mailto:${email}` },
      dest: { text: email, own: true },
      dir: 'out',
    };
  }
  if (email) {
    const byAddress = input.controls.contactLabel === 'email';
    return {
      label: 'Email',
      own: false,
      object: byAddress ? email : squash(identity.name),
      target: { kind: 'url', url: `mailto:${email}` },
      dest: byAddress ? undefined : { text: email, own: true },
      dir: 'out',
    };
  }
  const action = nestedCtasOf(input)
    .flatMap((cta) => [cta.primaryAction, cta.secondaryAction])
    .find((a) => a !== undefined);
  const link = action ?? contactLinksOf(input)[0];
  if (!link) return undefined;
  return linkAction(linkText(link), link.url, input);
}

/**
 * An owner's link as a band's one action. A `#id`, or `/#id` (home's
 * section, from any page), is a place on this site: down the page, its
 * destination the section's heading (none when that only repeats the
 * label). A `/path` is this site's own page: no destination word. Anything
 * else leaves the site, named by its host.
 */
/**
 * Whether a link lands on home: an address elsewhere does; a #id or /#id
 * does only when home has that place, a panel, the record, or a record row.
 */
export function landsOnHome(url: string, input: ModelInput): boolean {
  const hash = /^\/?#(.+)$/.exec(url.trim());
  if (!hash) return true;
  const { panels, record } = planOf(input);
  const id = hash[1]!;
  return (
    panels.some((panel) => panel.anchor === id) ||
    (record.length > 0 && id === RECORD_ANCHOR) ||
    record.some((section) => section.id === id)
  );
}

function linkAction(label: string, url: string, input: ModelInput): PanelAction {
  const raw = url.trim();
  const hash = /^\/?#(.+)$/.exec(raw);
  if (hash) {
    const section = input.portfolio.sections.find((each) => each.id === hash[1]);
    const head = section ? headOf(section) : undefined;
    const dest = head && head.text !== label ? { dest: head } : {};
    return raw.startsWith('#')
      ? { label, own: true, target: { kind: 'anchor', anchor: hash[1]! }, ...dest, dir: 'down' }
      : { label, own: true, target: { kind: 'url', url: raw }, ...dest, dir: 'down' };
  }
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    return { label, own: true, target: { kind: 'url', url: raw }, dir: 'out' };
  }
  return {
    label,
    own: true,
    target: { kind: 'url', url: raw },
    dest: { text: hostOf(raw), own: true },
    dir: 'out',
  };
}

/** A link's text: the owner's label, else its platform, else its host. */
export function linkText(link: Pick<Link, 'label' | 'platform' | 'url'>): string {
  if (present(link.label)) return squash(link.label);
  if (present(link.platform)) return squash(link.platform);
  return hostOf(link.url);
}

/**
 * The contact panel's links: the portfolio's, the contact record's, the
 * hero's calls to action, and the nested calls to action's own, each
 * address once, never the band's own email and never the contact panel
 * itself.
 */
export function contactLinksOf(input: ModelInput): readonly Link[] {
  const { portfolio } = input;
  const email = present(portfolio.identity.email)
    ? `mailto:${portfolio.identity.email.trim()}`
    : '';
  const hero = heroOf(input);
  const ctas = nestedCtasOf(input);
  const all: Link[] = [
    ...(portfolio.links ?? []),
    ...(portfolio.contact?.links ?? []),
    ...(hero?.ctas ?? []),
    ...ctas
      .flatMap((cta) => [cta.primaryAction, cta.secondaryAction])
      .filter((a) => a !== undefined),
  ];
  const seen = new Map<string, number>();
  const out: Link[] = [];
  const here = contactSectionOf(input)?.id;
  for (const link of all) {
    const url = link.url.trim();
    const key = url.toLowerCase().replace(/\/+$/, '');
    // A link to the contact panel itself, from inside it, goes nowhere.
    if (url === '#' || (here !== undefined && url === `#${here}`)) continue;
    if (key === email.toLowerCase()) continue;
    const at = seen.get(key);
    if (at !== undefined) {
      // Each address once, under the first of his labels for it: an unlabelled first takes a later one's words.
      if (!present(out[at]!.label) && present(link.label))
        out[at] = { ...out[at]!, label: link.label };
      continue;
    }
    seen.set(key, out.length);
    out.push(link);
  }
  return out;
}

// ───────────── the plan ─────────────

export type PanelKey = 'who' | 'best' | 'numbers' | 'more' | 'refs' | 'contact';
export type Ground = 'canvas' | 'inverse' | 'accent';

export interface Panel {
  readonly key: PanelKey;
  /** Its place, from 1. */
  readonly n: number;
  readonly ground: Ground;
  /** The action band's ground: the other of paper and ink, so the alternation shows at a glance (SG-M2). */
  readonly band: 'canvas' | 'inverse';
  /** The content section it frames, when it frames one. */
  readonly section?: Section;
  /** Its anchor, before the id prefix: the section's id, or an own id under sg-. */
  readonly anchor: string;
  /** What the rail and Contents call it: the owner's title when the section has one. */
  readonly label: { readonly text: string; readonly own: boolean };
}

/** The composition's own words for each panel, when the owner's title doesn't name it. */
export const PANEL_WORDS: Readonly<Record<PanelKey, string>> = {
  who: 'Home',
  best: 'Best work',
  numbers: 'Numbers',
  more: 'More work',
  refs: 'References',
  contact: 'Contact',
};

/** The record's anchor, before the id prefix. */
export const RECORD_ANCHOR = 'sg-record';

export interface Plan {
  readonly panels: readonly Panel[];
  readonly panelOf: ReadonlyMap<string, Panel>;
  readonly best?: Work;
  readonly more: readonly Work[];
  readonly numbers?: Numbers;
  /** The sections the panels frame, which the record leaves out. */
  readonly consumed: ReadonlySet<string>;
  /** Every other section, in authored order. */
  readonly record: readonly Section[];
  /** The works shown in panels 2 and 4, by id, for the record's back-pointers. */
  readonly shown: ReadonlyMap<string, PanelKey>;
}

function readPlan(input: ModelInput): Plan {
  const hero = heroOf(input);
  const best = bestWorkOf(input);
  const numbers = numbersOf(input);
  const more = moreWorksOf(input);
  const refs = referencesOf(input);
  const contact = contactSectionOf(input);
  const titled = (section: Section | undefined, key: PanelKey) =>
    present(section?.title)
      ? { text: squash(section.title), own: true }
      : { text: PANEL_WORDS[key], own: false };
  const draft: Omit<Panel, 'n' | 'ground' | 'band'>[] = [
    // The hero's own title names panel 1, as a section's names its panel; with none, the composition's word.
    { key: 'who', section: hero, anchor: hero?.id ?? 'sg-who', label: titled(hero, 'who') },
  ];
  if (best) draft.push({ key: 'best', anchor: 'sg-best-work', label: titled(undefined, 'best') });
  if (numbers) {
    draft.push({
      key: 'numbers',
      section: numbers.section,
      anchor: numbers.section?.id ?? 'sg-numbers',
      label: titled(numbers.section, 'numbers'),
    });
  }
  if (more.length > 0) {
    draft.push({ key: 'more', anchor: 'sg-more-work', label: titled(undefined, 'more') });
  }
  if (refs)
    draft.push({ key: 'refs', section: refs, anchor: refs.id, label: titled(refs, 'refs') });
  if (contact) {
    draft.push({
      key: 'contact',
      section: contact,
      anchor: contact.id,
      label: titled(contact, 'contact'),
    });
  }
  // Grounds by position, whatever leaves: paper, ink, paper…; the contact panel is always the accent.
  const panels = draft.map((panel, i): Panel => {
    const ground: Ground = panel.key === 'contact' ? 'accent' : i % 2 ? 'inverse' : 'canvas';
    return { ...panel, n: i + 1, ground, band: ground === 'inverse' ? 'canvas' : 'inverse' };
  });
  const consumed = new Set<string>(
    [
      hero?.id,
      numbers?.section?.id,
      refs?.id,
      contact?.id,
      ...nestedCtasOf(input).map((cta) => cta.id),
    ].filter(present),
  );
  const shown = new Map<string, PanelKey>();
  if (best) shown.set(best.id, 'best');
  for (const work of more) shown.set(work.id, 'more');
  return {
    panels,
    panelOf: new Map(
      panels.filter((p) => p.section !== undefined).map((p) => [p.section!.id, p] as const),
    ),
    best,
    more,
    numbers,
    consumed,
    record: input.portfolio.sections.filter(
      (section) => !consumed.has(section.id) && sectionShows(section, input),
    ),
    shown,
  };
}
export const planOf = once(readPlan);

/** Whether a record works section only repeats works the panels show: it becomes one back-pointer line. */
export function backPointer(
  section: Section,
  input: ModelInput,
): { readonly works: readonly Work[]; readonly where: readonly ('best' | 'more')[] } | undefined {
  if (section.kind !== 'works') return undefined;
  const { shown } = planOf(input);
  const works = worksOf(section, input);
  if (works.length === 0 || !works.every((work) => shown.has(work.id))) return undefined;
  const panels = new Set(works.map((work) => shown.get(work.id)!));
  const where = (['best', 'more'] as const).filter((key) => panels.has(key));
  return { works, where };
}

// ───────────── each panel's one action ─────────────

export type Target =
  | { readonly kind: 'anchor'; readonly anchor: string }
  | { readonly kind: 'case'; readonly slug: string }
  | { readonly kind: 'url'; readonly url: string };

export interface PanelAction {
  /** What it says: the composition's words, or the owner's when `own`. */
  readonly label: string;
  readonly own: boolean;
  /** The owner's words after the label, such as a work's title. */
  readonly object?: string;
  readonly target: Target;
  /** Where it leads, beside the label. */
  readonly dest?: { readonly text: string; readonly own: boolean };
  /** Down the page, or out of it. */
  readonly dir: 'down' | 'out';
}

/** The first record section of a kind, with something to show. */
function recordFirst(input: ModelInput, test: (section: Section) => boolean) {
  return planOf(input).record.find(test);
}

/** Nouns for the evidence types the record still holds, for panel 5's action. */
const TYPE_NOUNS: Readonly<Partial<Record<Evidence['type'], string>>> = {
  publication: 'papers',
  talk: 'talks',
  award: 'awards',
  patent: 'patents',
  press: 'press',
  testimonial: 'references',
};

/** Words for "on to the next panel", by what the next panel is. */
const NEXT_WORDS: Readonly<Record<PanelKey, string>> = {
  who: 'Back to the start',
  best: 'See the work',
  numbers: 'See the numbers',
  more: 'See more work',
  refs: 'Read what others say',
  contact: 'Get in touch',
};

const RECORD_DEST = { text: 'The record', own: false };

/** On to the next panel; after the last, to the record, else to the owner's email. */
function next(input: ModelInput, panel: Panel): PanelAction | undefined {
  const plan = planOf(input);
  const after = plan.panels[panel.n];
  if (after) {
    return {
      label: NEXT_WORDS[after.key],
      own: false,
      target: { kind: 'anchor', anchor: after.anchor },
      dest: after.label,
      dir: 'down',
    };
  }
  if (plan.record.length > 0) {
    return {
      label: 'See the record',
      own: false,
      target: { kind: 'anchor', anchor: RECORD_ANCHOR },
      dest: RECORD_DEST,
      dir: 'down',
    };
  }
  return emailAction(input);
}

export function actionOf(input: ModelInput, panel: Panel): PanelAction | undefined {
  switch (panel.key) {
    case 'who': {
      const cta = heroOf(input)?.ctas?.find(
        (each) => present(each.label) && present(each.url) && landsOnHome(each.url, input),
      );
      // With heroAction: cta, his first call to action, in his words (the lead's ruling: 'next', the
      // composition's own way on, stays the default).
      if (input.controls.heroAction === 'cta' && cta) {
        return linkAction(squash(cta.label), cta.url, input);
      }
      return next(input, panel);
    }
    case 'best': {
      const work = planOf(input).best!;
      const link = workLink(work);
      if (link?.kind === 'case') {
        return {
          label: 'Read the case study',
          own: false,
          target: { kind: 'case', slug: link.slug },
          dir: 'out',
        };
      }
      if (link?.kind === 'url') {
        return {
          label: 'Visit',
          own: false,
          object: squash(work.title),
          target: { kind: 'url', url: link.url },
          dest: { text: hostOf(link.url), own: true },
          dir: 'out',
        };
      }
      return next(input, panel);
    }
    case 'numbers': {
      const chronology = recordFirst(
        input,
        (section) => section.kind === 'chronology' && chronologyOf(section, input).length > 0,
      );
      return chronology
        ? {
            label: 'See the record behind them',
            own: false,
            target: { kind: 'anchor', anchor: chronology.id },
            dest: present(chronology.title)
              ? { text: squash(chronology.title), own: true }
              : RECORD_DEST,
            dir: 'down',
          }
        : next(input, panel);
    }
    case 'more': {
      const works = recordFirst(
        input,
        (section) =>
          section.kind === 'works' &&
          worksOf(section, input).length > 0 &&
          !backPointer(section, input),
      );
      return works
        ? {
            label: 'See every work',
            own: false,
            target: { kind: 'anchor', anchor: works.id },
            dest: present(works.title) ? { text: squash(works.title), own: true } : RECORD_DEST,
            dir: 'down',
          }
        : next(input, panel);
    }
    case 'refs': {
      const left = planOf(input).record.filter((section) => section.kind === 'evidence');
      const nouns = [
        ...new Set(
          left.flatMap((section) =>
            evidenceOf(section, input)
              .map((entry) => TYPE_NOUNS[entry.type])
              .filter(present),
          ),
        ),
      ].slice(0, 3);
      const first = left.find((section) =>
        evidenceOf(section, input).some((entry) => TYPE_NOUNS[entry.type] !== undefined),
      );
      return first && nouns.length > 0
        ? {
            label: `Read ${listAnd(nouns)}`,
            own: false,
            target: { kind: 'anchor', anchor: first.id },
            dest: RECORD_DEST,
            dir: 'down',
          }
        : next(input, panel);
    }
    case 'contact':
      return emailAction(input);
    default:
      return undefined;
  }
}

// ───────────── the record's index ─────────────

export interface IndexEntry {
  readonly id: string;
  readonly href: string;
  readonly title: string;
  readonly own: boolean;
}

export interface IndexGroup {
  readonly id: DestinationId | 'more';
  readonly label: string;
  /** The label's language when it's the kit's or the composition's English in a portfolio that isn't. */
  readonly lang?: string;
  readonly sections: readonly IndexEntry[];
}

/**
 * The record's index sentence: its sections grouped by K-1's destinations,
 * in the fixed order, each group's sections in reading order, then any the
 * map leaves to the index alone under More.
 */
export function recordIndex(input: ModelInput, outline: PageOutline): readonly IndexGroup[] {
  const { consumed } = planOf(input);
  const model = navigationModel(outline);
  const byId = new Map(input.portfolio.sections.map((section) => [section.id, section]));
  const entry = (id: string, href: string): IndexEntry => {
    const head = headOf(byId.get(id)!);
    return { id, href, title: head.text, own: head.own };
  };
  const kept = (id: string, href: string | undefined): href is string =>
    href !== undefined && !consumed.has(id) && byId.has(id);
  const groups: IndexGroup[] = model.groups
    .map((group) => ({
      id: group.destination,
      label: group.label,
      lang: group.lang,
      sections: group.sections
        .filter((section) => kept(section.id, section.href))
        .map((section) => entry(section.id, section.href!)),
    }))
    .filter((group) => group.sections.length > 0);
  const grouped = new Set(model.groups.flatMap((group) => group.sections.map(({ id }) => id)));
  const unplaced = model.index.filter(
    (section) => !grouped.has(section.id) && kept(section.id, section.href),
  );
  if (unplaced.length > 0) {
    const english = /^en(?:-|$)/i.test(outline.locale);
    groups.push({
      id: 'more',
      label: 'More',
      lang: english ? undefined : 'en',
      sections: unplaced.map((section) => entry(section.id, section.href!)),
    });
  }
  return groups;
}

// ───────────── heads ─────────────

/** The composition's words for a section with no title, by kind. */
export const KIND_WORDS: Readonly<Record<string, string>> = {
  hero: 'Introduction',
  lede: 'About',
  now: 'Now',
  works: 'Work',
  evidence: 'Evidence',
  chronology: 'Chronology',
  contact: 'Contact',
  custom: 'More',
  quote: 'Quote',
  focus: 'Focus',
  'fun-facts': 'Off the page',
  cta: 'Next step',
  github: 'GitHub',
};

const PART_WORDS: Readonly<Record<string, string>> = {
  thesis: 'Practice',
  skills: 'Skills',
  tools: 'Tools',
  services: 'Services',
};

/** A section's heading: the owner's title, else the composition's word for its kind. */
export function headOf(section: Section): { readonly text: string; readonly own: boolean } {
  if (present(section.title)) return { text: squash(section.title), own: true };
  if (section.kind === 'practice')
    return { text: PART_WORDS[section.part] ?? 'Practice', own: false };
  return { text: KIND_WORDS[section.kind] ?? 'More', own: false };
}

// ───────────── works and evidence words ─────────────

/** A work's medium in the composition's words, or none for an extension's medium. */
export function mediumWord(work: Work): string | undefined {
  switch (work.medium) {
    case 'writing':
      return present(work.publishedAt) ? 'Essay' : 'Writing';
    case 'audio-video':
      return present(work.series) ? 'Episode' : 'Audio and video';
    case 'image-series':
      return 'Photographs';
    case 'interface':
      return 'Interface';
    case 'system':
      return 'System';
    case 'software':
      return 'Software';
    case 'photography':
      return 'Photography';
    case 'research':
      return 'Research';
    case 'music':
      return 'Album';
    case 'object':
      return 'Object';
    default:
      return undefined;
  }
}

/** A year from a loose date. */
export function yearOf(raw: string | undefined): string | undefined {
  const match = /^(\d{4})/.exec(String(raw ?? ''));
  return match ? match[1] : undefined;
}

/** The track count and running time of an album, the time only when every track has one. */
export function minutesSeconds(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

// ───────────── the record's folds (P2, the home outline) ─────────────

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Evidence nouns, one and many, for a fold's line. */
const EVIDENCE_NOUNS: Readonly<Partial<Record<Evidence['type'], readonly [string, string]>>> = {
  publication: ['publication', 'publications'],
  talk: ['talk', 'talks'],
  award: ['award', 'awards'],
  patent: ['patent', 'patents'],
  press: ['press mention', 'press mentions'],
  testimonial: ['reference', 'references'],
  metric: ['figure', 'figures'],
};

/** Chronology nouns, by the entries' kind. */
const ENTRY_NOUNS: Readonly<Record<ChronologyEntry['kind'], readonly [string, string]>> = {
  role: ['role', 'roles'],
  study: ['study', 'studies'],
  project: ['project', 'projects'],
  event: ['event', 'events'],
  milestone: ['milestone', 'milestones'],
};

/**
 * What a closed record row's summary says it holds (the lead's ruling on
 * the mockup, item 2): a count in the composition's words, from the
 * content ("6 roles, 2014 to now", "4 talks"); or, for a row of prose, its
 * first sentence in the owner's words, which CSS clips to one line; or
 * nothing, and the row shows its plus alone. Nothing is invented.
 */
export type FoldLine =
  | { readonly kind: 'count'; readonly text: string }
  | { readonly kind: 'prose'; readonly text: string };

const prose = (markdown: string | undefined): FoldLine | undefined => {
  if (!present(markdown)) return undefined;
  const { lead } = firstSentence(plainInline(markdown));
  return lead ? { kind: 'prose', text: lead } : undefined;
};

const count = (n: number, one: string, many: string): FoldLine | undefined =>
  n > 0 ? { kind: 'count', text: plural(n, one, many) } : undefined;

export function foldLineOf(section: Section, input: ModelInput): FoldLine | undefined {
  switch (section.kind) {
    case 'chronology': {
      const entries = chronologyOf(section, input);
      if (entries.length === 0) return undefined;
      const kinds = new Set(entries.map((entry) => entry.kind));
      const [one, many] =
        kinds.size === 1 ? ENTRY_NOUNS[entries[0]!.kind] : (['entry', 'entries'] as const);
      const starts = entries.map((entry) => yearOf(entry.period?.start)).filter(present);
      const ongoing = entries.some((entry) => entry.period?.start && !present(entry.period.end));
      const ends = entries.map((entry) => yearOf(entry.period?.end)).filter(present);
      const from = starts.sort()[0];
      const to = ongoing ? 'now' : ends.sort().at(-1);
      const span = from && to && from !== to ? `, ${from} to ${to}` : '';
      return { kind: 'count', text: `${plural(entries.length, one, many)}${span}` };
    }
    case 'evidence': {
      const items = evidenceOf(section, input);
      const types = new Set(items.map((item) => item.type));
      const nouns = types.size === 1 ? EVIDENCE_NOUNS[items[0]!.type] : undefined;
      return nouns ? count(items.length, nouns[0], nouns[1]) : count(items.length, 'item', 'items');
    }
    case 'works': {
      const n = worksOf(section, input).length;
      const line = count(n, 'work', 'works');
      return line && backPointer(section, input)
        ? { kind: 'count', text: `${line.text}, shown above` }
        : line;
    }
    case 'focus':
    case 'fun-facts':
      return count(section.items.filter(present).length, 'item', 'items');
    case 'practice': {
      const practice = input.portfolio.practice;
      if (!practice) return undefined;
      if (section.part === 'thesis') return prose(practice.thesis);
      const groups = practice[section.part] ?? [];
      const n = groups.reduce((sum, group) => sum + group.items.length, 0);
      const nouns = {
        skills: ['skill', 'skills'],
        tools: ['tool', 'tools'],
        services: ['service', 'services'],
      } as const;
      const [one, many] = nouns[section.part];
      return count(n, one, many);
    }
    case 'lede':
    case 'now':
      return prose(section.body);
    case 'quote':
      return prose(section.text);
    case 'cta':
      return prose(section.description);
    case 'custom':
      return prose(section.body) ?? count(section.items?.length ?? 0, 'item', 'items');
    default:
      return undefined;
  }
}

// ───────────── stops: where the rail, the strip and Contents move to ─────────────

/** A panel or a case stop, with its number; or the record or the case's Notes, without one. */
export interface Stop {
  readonly anchor: string;
  readonly label: { readonly text: string; readonly own: boolean };
  readonly n?: number;
}

/** Home's stops: the panels, then the record. */
export function homeStopsOf(input: ModelInput): readonly Stop[] {
  const { panels, record } = planOf(input);
  return [
    ...panels.map((panel) => ({ anchor: panel.anchor, label: panel.label, n: panel.n })),
    ...(record.length > 0
      ? [{ anchor: RECORD_ANCHOR, label: { text: 'The record', own: false } }]
      : []),
  ];
}

// ───────────── the case page's stops (P2, brief §5.7 "Case stops") ─────────────

export type CaseKey = 'brief' | 'exhibit' | 'problem' | 'choices' | 'result' | 'hindsight';

export interface CaseStop extends Stop {
  readonly key: CaseKey;
  readonly n: number;
  readonly ground: Ground;
  readonly band: 'canvas' | 'inverse';
}

const CASE_WORDS: Readonly<Record<CaseKey, string>> = {
  brief: 'Brief',
  exhibit: 'Exhibit',
  problem: 'Problem',
  choices: 'Choices',
  result: 'Result',
  hindsight: 'Hindsight',
};

/** The words on a band that leads to a stop, by what the stop is. */
const CASE_NEXT: Readonly<Record<CaseKey | 'notes', string>> = {
  brief: 'Back to the brief',
  exhibit: 'See the work',
  problem: 'See what was wrong',
  choices: 'See what was decided',
  result: 'See what changed',
  hindsight: 'Read the reflection',
  notes: 'Read the notes',
};

export const NOTES_ANCHOR = 'sg-case-notes';

/** The case study's own fields, as the schema holds them. */
export type CaseFields = NonNullable<Work['caseStudy']>;

/**
 * The stops a work's page has, in order: Brief always; Exhibit with a
 * cover; Problem with a challenge or context; Choices with decisions,
 * constraints or the role; Result with outcomes or evidence; Hindsight with a
 * reflection. Grounds alternate by position and the last is the accent,
 * as home's contact panel; then Notes, unnumbered.
 */
export function caseStopsOf(work: Work & { readonly caseStudy: CaseFields }): readonly CaseStop[] {
  const study = work.caseStudy;
  const keys: CaseKey[] = ['brief'];
  if (work.cover !== undefined || (work.media?.length ?? 0) > 0) keys.push('exhibit');
  if (present(study.challenge) || present(study.context)) keys.push('problem');
  if ((study.decisions?.length ?? 0) > 0 || present(study.constraints) || present(study.role)) {
    keys.push('choices');
  }
  if (present(study.outcomes) || present(study.evidence)) keys.push('result');
  if (present(study.reflection)) keys.push('hindsight');
  return keys.map((key, i) => {
    const last = i === keys.length - 1 && keys.length > 1;
    const ground: Ground = last ? 'accent' : i % 2 ? 'inverse' : 'canvas';
    return {
      key,
      n: i + 1,
      anchor: `sg-case-${key}`,
      label: { text: CASE_WORDS[key], own: false },
      ground,
      band: ground === 'inverse' ? 'canvas' : 'inverse',
    };
  });
}

/** A stop's one action: on to the next stop, else to Notes; the last numbered stop goes back to the portfolio's More work. */
export function caseActionOf(
  stops: readonly CaseStop[],
  stop: CaseStop,
  input: ModelInput,
): PanelAction {
  const after = stops[stop.n];
  if (after) {
    return {
      label: CASE_NEXT[after.key],
      own: false,
      target: { kind: 'anchor', anchor: after.anchor },
      dest: after.label,
      dir: 'down',
    };
  }
  if (stops.length > 1) {
    const more = planOf(input).panels.find((panel) => panel.key === 'more');
    return {
      label: 'Back to the portfolio',
      own: false,
      target: { kind: 'url', url: `/#${more ? more.anchor : 'main'}` },
      dest: more ? more.label : undefined,
      dir: 'out',
    };
  }
  return {
    label: CASE_NEXT.notes,
    own: false,
    target: { kind: 'anchor', anchor: NOTES_ANCHOR },
    dest: { text: 'Notes', own: false },
    dir: 'down',
  };
}
