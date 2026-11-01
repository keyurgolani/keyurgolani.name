import type { Section } from '@portfolio/schema';
import {
  chronologyOf,
  evidenceOf,
  formatFigure,
  formatNames,
  githubSnapshot,
  present,
  type OutlineSection,
  type PageOutline,
  type RenderContext,
  worksOf,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';

// Kinetic Cosmos's system (redesign, stream E): the page as an orrery. The
// opening stage holds the hero and the thesis; four rings, Work, Writing,
// Record, and Personal, hold every other section, each in the ring its kind
// and its records put it in; and the closing stage holds the ways to get in
// touch. A ring with no section isn't drawn. Pure: it reads the outline and
// the input, and returns no markup.
//
// It groups from pageOutline() itself, so every section it places is one
// renderSection() renders, and every link lands. When the kit's
// navigationModel() lands, ringOf() becomes its destinationOf and RING_LABELS
// its labels; nothing else here changes.

export type RingKey = 'work' | 'writing' | 'record' | 'personal';

/** Where a section sits: the opening stage, a ring, or the closing stage. */
export type Placement = 'opening' | RingKey | 'closing';

export const RING_KEYS: readonly RingKey[] = ['work', 'writing', 'record', 'personal'];

/**
 * Each ring's name. The kit has no translations: like the words the shared
 * renderers add, these are English, marked so in a portfolio that isn't.
 */
export const RING_LABELS: Readonly<Record<RingKey, string>> = {
  work: 'Work',
  writing: 'Writing',
  record: 'Record',
  personal: 'Personal',
};

/** Mediums whose works read as writing: words, papers, and episodes. */
const WRITTEN = new Set(['writing', 'research', 'audio-video']);
/** Mediums whose works are the owner's own pursuits, off the clock. */
const PERSONAL_MEDIA = new Set(['photography', 'image-series', 'music']);
/** Evidence that is something written, said, or written about. */
const SPOKEN = new Set(['talk', 'publication', 'press', 'recording']);
/** Evidence that is work for or with someone. */
const WORKED = new Set(['client', 'repository', 'exhibition']);

const every = <T>(items: readonly T[], test: (item: T) => boolean) =>
  items.length > 0 && items.every(test);

/** Where a section goes, from its kind and the records it lists. */
export function placementOf(
  section: Section,
  input: VariantRenderInput,
  firstThesis: boolean,
): Placement {
  switch (section.kind) {
    case 'hero':
      return 'opening';
    case 'contact':
    case 'cta':
      return 'closing';
    case 'practice':
      if (section.part === 'thesis') return firstThesis ? 'opening' : 'record';
      return section.part === 'services' ? 'work' : 'record';
    case 'works': {
      const media = worksOf(section, input).map((work) => work.medium);
      if (every(media, (medium) => WRITTEN.has(medium))) return 'writing';
      if (every(media, (medium) => PERSONAL_MEDIA.has(medium))) return 'personal';
      return 'work';
    }
    case 'github':
      return 'work';
    case 'evidence': {
      const types = evidenceOf(section, input).map((entry) => entry.type);
      if (every(types, (type) => SPOKEN.has(type))) return 'writing';
      if (every(types, (type) => WORKED.has(type))) return 'work';
      if (every(types, (type) => type === 'external-work')) return 'personal';
      return 'record';
    }
    case 'chronology':
    case 'lede':
      return 'record';
    default:
      // now, focus, fun-facts, quote, custom, and every extension kind.
      return 'personal';
  }
}

/**
 * A section's place within its ring, lowest first: what the ring is about
 * comes before what supports it, so Record reads as the story, the
 * figures, the history, what others said, the honours, and the practice.
 * Sections of the same rank keep their reading order.
 */
export function rankOf(section: Section, input: VariantRenderInput): number {
  switch (section.kind) {
    case 'lede':
    case 'now':
      return 0;
    case 'focus':
      return 1;
    case 'works':
    case 'github':
      return section.kind === 'github' ? 3 : 2;
    case 'chronology':
      return 5;
    case 'practice':
      return section.part === 'services' ? 4 : 9;
    case 'evidence': {
      const types = evidenceOf(section, input).map((entry) => entry.type);
      if (every(types, (type) => type === 'metric')) return 4;
      if (every(types, (type) => type === 'talk')) return 4;
      if (every(types, (type) => type === 'publication')) return 5;
      if (every(types, (type) => type === 'testimonial')) return 6;
      if (every(types, (type) => type === 'press')) return 6;
      if (every(types, (type) => type === 'award' || type === 'patent')) return 7;
      if (every(types, (type) => type === 'external-work')) return 8;
      return 7;
    }
    case 'fun-facts':
      return 6;
    case 'quote':
      return 7;
    default:
      return 8;
  }
}

/** A ring the page draws: its sections, in reading order, and where it is. */
export interface Ring {
  readonly key: RingKey;
  readonly label: string;
  /** `en` when the label is English in a portfolio that isn't. */
  readonly lang?: 'en';
  /** The DOM id of its head, which no content id can take: two hyphens. */
  readonly anchor: string;
  readonly href: string;
  /** Its place among the rings drawn, from 1. */
  readonly position: number;
  readonly sections: readonly OutlineSection[];
}

export interface CosmosModel {
  /** The hero and the first thesis, in that order of content, as the opening stage shows them. */
  readonly opening: readonly OutlineSection[];
  readonly rings: readonly Ring[];
  /** The contact section and any call to action, for the closing stage. */
  readonly closing: readonly OutlineSection[];
  /** Each section's placement, by content id. */
  readonly placement: ReadonlyMap<string, Placement>;
}

/** The page's system: what the opening, each ring, and the closing hold. */
export function cosmosModel(outline: PageOutline, input: VariantRenderInput): CosmosModel {
  const byId = new Map(input.portfolio.sections.map((section) => [section.id, section]));
  const placement = new Map<string, Placement>();
  const groups = new Map<Placement, OutlineSection[]>();
  let thesisTaken = false;
  for (const entry of outline.sections) {
    const section = byId.get(entry.id);
    if (!section) continue;
    const firstThesis = !thesisTaken && section.kind === 'practice' && section.part === 'thesis';
    const where = placementOf(section, input, firstThesis);
    if (where === 'opening' && section.kind === 'practice') thesisTaken = true;
    placement.set(entry.id, where);
    const group = groups.get(where);
    if (group) group.push(entry);
    else groups.set(where, [entry]);
  }
  const english = /^en(?:-|$)/i.test(input.portfolio.locale);
  const drawn = RING_KEYS.filter((key) => groups.has(key));
  const rank = new Map(
    outline.sections.map((entry) => [entry.id, rankOf(byId.get(entry.id)!, input)]),
  );
  for (const key of drawn) {
    // Array.prototype.sort is stable, so equal ranks keep their reading order.
    groups.get(key)!.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  }
  const rings = drawn.map((key, index): Ring => {
    const anchor = `${input.ids.prefix}kc--ring-${key}`;
    return {
      key,
      label: RING_LABELS[key],
      ...(english ? {} : { lang: 'en' as const }),
      anchor,
      href: input.route.route === 'home' ? `#${anchor}` : `${outline.home}#${anchor}`,
      position: index + 1,
      sections: groups.get(key)!,
    };
  });
  return {
    opening: groups.get('opening') ?? [],
    rings,
    closing: groups.get('closing') ?? [],
    placement,
  };
}

const PLURALS: Readonly<Record<string, string>> = {
  project: 'projects',
  essay: 'essays',
  paper: 'papers',
  episode: 'episodes',
  release: 'releases',
  photograph: 'photographs',
  work: 'works',
  track: 'tracks',
  figure: 'figures',
  person: 'people',
  talk: 'talks',
  award: 'awards',
  patent: 'patents',
  piece: 'pieces',
  article: 'articles',
  role: 'roles',
  degree: 'degrees',
  area: 'areas',
  thing: 'things',
  'public repository': 'public repositories',
  exhibition: 'exhibitions',
  client: 'clients',
  recording: 'recordings',
  repository: 'repositories',
  place: 'places',
  entry: 'entries',
  group: 'groups',
  offer: 'offers',
  item: 'items',
  fact: 'facts',
};

const MEDIUM_NOUNS: Readonly<Record<string, string>> = {
  software: 'project',
  interface: 'project',
  system: 'project',
  object: 'project',
  writing: 'essay',
  research: 'paper',
  'audio-video': 'episode',
  music: 'release',
  photography: 'photograph',
  'image-series': 'photograph',
};

const EVIDENCE_NOUNS: Readonly<Record<string, string>> = {
  metric: 'figure',
  testimonial: 'person',
  publication: 'paper',
  talk: 'talk',
  award: 'award',
  patent: 'patent',
  press: 'article',
  exhibition: 'exhibition',
  client: 'client',
  recording: 'recording',
  repository: 'repository',
  'external-work': 'place',
};

/** The noun most of `keys` map to, else `fallback`. */
function dominant(
  keys: readonly string[],
  nouns: Readonly<Record<string, string>>,
  fallback: string,
) {
  const tally = new Map<string, number>();
  for (const key of keys) {
    const noun = nouns[key] ?? fallback;
    tally.set(noun, (tally.get(noun) ?? 0) + 1);
  }
  let best = fallback;
  let most = 0;
  for (const [noun, count] of tally) {
    if (count > most) {
      best = noun;
      most = count;
    }
  }
  return best;
}

/** A count of a noun, in its singular. */
export interface Counted {
  readonly count: number;
  readonly noun: string;
}

const counted = (count: number, noun: string): Counted => ({ count, noun });

/** A count as English writes it: "1 essay", "3 essays". */
const phrase = ({ count, noun }: Counted, ctx: RenderContext) =>
  `${formatFigure(count, ctx)} ${count === 1 ? noun : (PLURALS[noun] ?? noun)}`;

/**
 * What a section holds, counted: how many of what. None for a kind that
 * lists nothing countable.
 */
export function countOf(section: Section, input: VariantRenderInput): Counted | undefined {
  switch (section.kind) {
    case 'works': {
      const works = worksOf(section, input);
      const only = works.length === 1 ? works[0] : undefined;
      if (only?.tracks?.length) return counted(only.tracks.length, 'track');
      if (only?.media?.length && PERSONAL_MEDIA.has(only.medium)) {
        return counted(only.media.length, 'photograph');
      }
      const noun = dominant(
        works.map((work) => work.medium),
        MEDIUM_NOUNS,
        'work',
      );
      return counted(works.length, noun);
    }
    case 'evidence': {
      const entries = evidenceOf(section, input);
      const noun = dominant(
        entries.map((entry) => entry.type),
        EVIDENCE_NOUNS,
        'item',
      );
      return counted(entries.length, noun);
    }
    case 'chronology': {
      // One kind throughout is its noun, roles or degrees; a mix is entries.
      const entries = chronologyOf(section, input);
      const kinds = new Set(entries.map((entry) => entry.kind));
      const only = kinds.size === 1 ? [...kinds][0] : undefined;
      const noun =
        only === 'role'
          ? 'role'
          : only === 'study'
            ? 'degree'
            : only === 'project'
              ? 'project'
              : 'entry';
      return counted(entries.length, noun);
    }
    case 'practice': {
      if (section.part === 'thesis') return undefined;
      const groups = input.portfolio.practice?.[section.part] ?? [];
      if (section.part === 'services') {
        const offers = groups.reduce((sum, group) => sum + group.items.length, 0);
        return counted(offers, 'offer');
      }
      return counted(groups.length, 'area');
    }
    case 'focus':
      return counted(section.items.length, 'thing');
    case 'fun-facts':
      return counted(section.items.length, 'fact');
    default:
      return undefined;
  }
}

/** What a section holds, counted in English, such as "3 essays" or "6 tracks", for its orbit rule. */
export function countLabel(
  section: Section,
  input: VariantRenderInput,
  ctx: RenderContext,
): string | undefined {
  const count = countOf(section, input);
  return count ? phrase(count, ctx) : undefined;
}

/**
 * A ring's sections counted as one phrase, like nouns added together, in the
 * order they first appear: "3 essays, 6 episodes, and 2 papers".
 */
export function ringSummary(
  ring: Ring,
  input: VariantRenderInput,
  ctx: RenderContext,
  limit = Infinity,
): string | undefined {
  const byId = new Map(input.portfolio.sections.map((section) => [section.id, section]));
  const totals = new Map<string, number>();
  for (const entry of ring.sections) {
    const section = byId.get(entry.id);
    const count = section ? countOf(section, input) : undefined;
    if (count) totals.set(count.noun, (totals.get(count.noun) ?? 0) + count.count);
  }
  const labels = [...totals].slice(0, limit).map(([noun, count]) => phrase({ count, noun }, ctx));
  return labels.length > 0 ? formatNames(labels, ctx) : undefined;
}

// The legend's words (review round 2): what a visitor recognises, derived from
// the content's own kinds by meaning, never the containers they're kept in.
// A ring's plate says at most three of them, "12 years, 3 roles, and 2
// degrees"; its chapter opens on a sentence of them all.

/** One thing a section adds to its ring's words: short for the plate, longer for the sentence. */
interface Part {
  /** What the plate says, or none when the plate leaves it out. */
  readonly legend?: string;
  /** What the ring's sentence says. */
  readonly intro: string;
}

const WORDS = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
];

/** A count in words up to twelve, as prose writes it, then in figures. */
const spelled = (count: number, ctx: RenderContext) => WORDS[count] ?? formatFigure(count, ctx);

/** "an EP", "3 essays": one of a thing with its article, more with their count. */
function some(count: number, noun: string, ctx: RenderContext, words = false): string {
  if (count === 1) return `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;
  const plural = PLURALS[noun] ?? `${noun}s`;
  return `${words ? spelled(count, ctx) : formatFigure(count, ctx)} ${plural}`;
}

const both = (count: number, noun: string, ctx: RenderContext): Part => ({
  legend: some(count, noun, ctx),
  intro: some(count, noun, ctx, true),
});

/** A works section's words: an EP, photographs, a podcast, its projects by name, or a count. */
function worksPart(
  section: Section,
  input: VariantRenderInput,
  ctx: RenderContext,
): Part | undefined {
  const works = worksOf(section, input);
  if (works.length === 0) return undefined;
  const only = works.length === 1 ? works[0] : undefined;
  if (only?.tracks?.length) {
    const kind = only.tracks.length > 7 ? 'album' : 'EP';
    return { legend: `an ${kind}`, intro: `an ${kind}` };
  }
  if (only?.media?.length && PERSONAL_MEDIA.has(only.medium)) {
    return { legend: 'photographs', intro: 'photographs' };
  }
  const series = works[0]!.series;
  if (present(series) && works.every((work) => work.series === series)) {
    return works.some((work) => present(work.audioUrl))
      ? { legend: 'a podcast', intro: `the ${series} podcast` }
      : { legend: 'a series', intro: `${spelled(works.length, ctx)} episodes of ${series}` };
  }
  const noun = dominant(
    works.map((work) => work.medium),
    MEDIUM_NOUNS,
    'work',
  );
  if (noun === 'project' && works.length <= 3) {
    return {
      legend: some(works.length, noun, ctx),
      intro: formatNames(
        works.map((work) => work.title),
        ctx,
      ),
    };
  }
  return both(works.length, noun, ctx);
}

/** An evidence section's words: tenure from a figure in years, people, press, or a count. */
function evidencePart(
  section: Section,
  input: VariantRenderInput,
  ctx: RenderContext,
): Part | undefined {
  const entries = evidenceOf(section, input);
  const first = entries[0];
  if (!first) return undefined;
  switch (first.type) {
    case 'metric': {
      const tenure = entries.find(
        (entry) => entry.type === 'metric' && /^years?$/i.test(entry.metric?.unit ?? ''),
      );
      const value = tenure?.type === 'metric' ? tenure.metric?.value : undefined;
      if (value === undefined) return { intro: `${spelled(entries.length, ctx)} figures` };
      return {
        legend: `${formatFigure(value, ctx)} years`,
        intro: `${typeof value === 'number' ? spelled(value, ctx) : value} years in figures`,
      };
    }
    case 'testimonial':
      return { intro: `words from ${some(entries.length, 'collaborator', ctx, true)}` };
    case 'press':
      return { legend: 'press', intro: 'what the press wrote' };
    case 'external-work':
      return { intro: `${some(entries.length, 'home', ctx, true)} elsewhere` };
    default:
      return both(entries.length, EVIDENCE_NOUNS[first.type] ?? 'record', ctx);
  }
}

/** What one section adds to its ring's words, or none. */
function partOf(section: Section, input: VariantRenderInput, ctx: RenderContext): Part | undefined {
  switch (section.kind) {
    case 'works':
      return worksPart(section, input, ctx);
    case 'evidence':
      return evidencePart(section, input, ctx);
    case 'github': {
      const snapshot = githubSnapshot(section, input);
      const repos = snapshot?.state === 'ready' ? snapshot.value.totalRepos : 0;
      return repos > 0
        ? {
            legend: some(repos, 'repository', ctx),
            intro: some(repos, 'public repository', ctx, true),
          }
        : undefined;
    }
    case 'chronology': {
      const entries = chronologyOf(section, input);
      const roles = entries.filter((entry) => entry.kind === 'role').length;
      const degrees = entries.filter((entry) => entry.kind === 'study').length;
      if (roles > 0 && roles >= degrees) return both(roles, 'role', ctx);
      return degrees > 0 ? both(degrees, 'degree', ctx) : undefined;
    }
    case 'practice': {
      if (section.part === 'skills') return { intro: 'the skills' };
      if (section.part === 'tools') return { intro: 'the tools' };
      if (section.part !== 'services') return undefined;
      const offers = (input.portfolio.practice?.services ?? []).reduce(
        (sum, group) => sum + group.items.length,
        0,
      );
      return offers > 0
        ? { intro: `${some(offers, 'way', ctx, true)} to work together` }
        : undefined;
    }
    case 'now':
      return { legend: 'now', intro: "what's happening now" };
    case 'focus':
      return { intro: 'the current focus' };
    case 'fun-facts':
      return { intro: 'a few facts off the page' };
    default:
      return undefined;
  }
}

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The parts of a ring's sections, in their order, skills and tools said together. */
function partsOf(ring: Ring, input: VariantRenderInput, ctx: RenderContext): Part[] {
  const byId = new Map(input.portfolio.sections.map((section) => [section.id, section]));
  const parts = ring.sections.flatMap((entry) => {
    const section = byId.get(entry.id);
    const part = section ? partOf(section, input, ctx) : undefined;
    return part ? [part] : [];
  });
  const skills = parts.findIndex((part) => part.intro === 'the skills');
  const tools = parts.findIndex((part) => part.intro === 'the tools');
  if (skills < 0 || tools < 0) return parts;
  return parts.flatMap((part, index) =>
    index === tools
      ? []
      : index === skills
        ? [{ intro: 'the skills and tools behind it' }]
        : [part],
  );
}

/** A ring's plate: at most three of the things it holds, "12 years, 3 roles, and 2 degrees". */
export function ringLegend(
  ring: Ring,
  input: VariantRenderInput,
  ctx: RenderContext,
): string | undefined {
  const words = [
    ...new Set(partsOf(ring, input, ctx).flatMap((part) => (part.legend ? [part.legend] : []))),
  ];
  return words.length > 0 ? capitalised(formatNames(words.slice(0, 3), ctx)) : undefined;
}

/** A ring's opening sentence: everything it holds, in order, with semicolons when a part has its own commas. */
export function ringIntro(
  ring: Ring,
  input: VariantRenderInput,
  ctx: RenderContext,
): string | undefined {
  const words = partsOf(ring, input, ctx).map((part) => part.intro);
  if (words.length === 0) return undefined;
  const [first, ...rest] = words as [string, ...string[]];
  if (rest.length === 0 || !words.some((word) => word.includes(','))) {
    return `${capitalised(formatNames(words, ctx))}.`;
  }
  // A list of names first, its own commas, then what goes with it.
  if (!rest.some((word) => word.includes(','))) {
    return `${capitalised(first)}, with ${formatNames(rest, ctx)}.`;
  }
  return `${capitalised(words.slice(0, -1).join('; '))}; and ${words.at(-1)}.`;
}
