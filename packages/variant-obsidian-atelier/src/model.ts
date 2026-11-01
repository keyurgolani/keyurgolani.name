import type { Placement, Section, Work } from '@portfolio/schema';
import {
  canonicalDestination,
  evidenceOf,
  isArchived,
  pageOutline,
  placedImage,
  worksByIds,
  worksOf,
  type OutlineSection,
  type PageOutline,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { roomName } from './layout';
import { atelierNavigation, type NavigationModel } from './navigation';

// What Obsidian Atelier's home page hangs, and where (redesign, stream C),
// from the published view alone, so nothing private is ever counted:
//
//   1. The entrance: the first hero section as the wall's plaque, the
//      practice's thesis as its room title, and the signature work hung on
//      it as No. 1.
//   2. The rooms: the signature and the featured works in the owner's
//      order, at most five, one to a room. With neither curated, the first
//      three works the reading order shows, the archive's left out.
//   3. The collection: one salon wall, a bay for each works section in
//      reading order, hanging the works no room holds. Catalogue numbers
//      run on from the rooms' in hanging order, and a series of
//      photographs is one number with a plate for each picture, 10.1 to
//      10.3.
//   4. The galleries: Practice, Record, and Contact, each holding the
//      sections the navigation model places in it, in reading order. The
//      first quote is the exit wall, before Contact; it stays Practice's
//      in the navigation, as the map has it, and only hangs at the exit.
//
// The view holds visible content alone: a private work, or one only a
// hidden section reaches, is in none of its lists, so it's no room, no
// number, no plate, and no previous or next.

type ViewSection = VariantRenderInput['portfolio']['sections'][number];
export type HeroSection = Extract<Section, { kind: 'hero' }>;
export type QuoteSection = Extract<Section, { kind: 'quote' }>;
export type PracticeSection = Extract<Section, { kind: 'practice' }>;

/** How a work hangs, from its authored medium and what it places. */
export type Mount = 'screen' | 'sheet' | 'sleeve' | 'print' | 'ledge';

/** How a room shows its work: its reading beside the entrance, a wall, or a vitrine. */
export type RoomLayout = 'reading' | 'wall' | 'vitrine';

export interface Room {
  readonly work: Work;
  /** Its catalogue number, from 1. */
  readonly number: number;
  /** The room's own number, in Roman numerals. */
  readonly numeral: string;
  /** Its name in the room switch: the work's title, or its first words that fit, cut at a word; empty when none fits. */
  readonly name: string;
  /** The element id of the room: the work's own, so `/#<work id>` lands on it. */
  readonly anchor: string;
  readonly layout: RoomLayout;
  /** Which side of the room the wall stands on, alternating from room to room. */
  readonly side: 'start' | 'end';
  /** What hangs: the cover, else the first meaningful image the work places. */
  readonly image?: Placement;
}

export interface Hung {
  readonly work: Work;
  readonly number: number;
  readonly mount: Mount;
  /** A print's pictures, each a plate under the work's number. */
  readonly plates: readonly Placement[];
  /** A screen's or a ledge's picture. */
  readonly image?: Placement;
}

export interface Bay {
  /** The works no room holds, in the section's order. */
  readonly hung: readonly Hung[];
  /** The section's works the rooms hold, in the section's order. */
  readonly inRooms: readonly Room[];
}

/**
 * The navigation's groups, by the fixed ids the shared model will use
 * (director note 8): Work and Writing hang on the collection wall, the rest
 * are galleries. Atelier names them in its own words on top.
 */
export type GalleryKey = 'work' | 'writing' | 'record' | 'about' | 'contact';

export interface Gallery {
  readonly key: Exclude<GalleryKey, 'work' | 'writing'>;
  readonly label: string;
  readonly sections: readonly ViewSection[];
}

/**
 * Practice or Record hung as a room of its own (C1): its numeral after the
 * works' rooms, the one summary it opens on, and the rest of it folded,
 * closed, behind "The whole record" or "The whole practice" (item 8, the
 * home outline: one record summary on the page).
 */
export interface Hall {
  readonly numeral: string;
  /** Practice's words and its notice; the record's one summary, At a glance. */
  readonly lead: readonly Section[];
  /** The rest of the hall, folded: Practice's materials in a vitrine; the record's voices and experience. */
  readonly whole: readonly Section[];
}

export interface AtelierModel {
  readonly outline: PageOutline;
  readonly hero: HeroSection | undefined;
  /** The practice's thesis, which the entrance wall carries as its room title. */
  readonly thesis: PracticeSection | undefined;
  readonly rooms: readonly Room[];
  /** The works sections, in reading order, which hang on the collection wall. */
  readonly collection: readonly ViewSection[];
  /** Each works section's bay, by its id. */
  readonly bays: ReadonlyMap<string, Bay>;
  /** The catalogue numbers the collection wall holds, when it holds any. */
  readonly hangs: { readonly first: number; readonly last: number } | undefined;
  readonly galleries: readonly Gallery[];
  /** The first quote, the exit wall before Contact. */
  readonly exit: QuoteSection | undefined;
  /** The first call to action in Contact, which hangs on the exit wall as its label (OA-S10). */
  readonly exitLabel: Section | undefined;
  readonly navigation: NavigationModel;
  /** Every catalogue number on the page. */
  readonly total: number;
  /** Practice and Record as rooms, by their gallery's key. */
  readonly halls: ReadonlyMap<Gallery['key'], Hall>;
  /** Every room on the page: the works' and the halls'. */
  readonly roomCount: number;
}

/** Whether `text` has something to show. */
export function present(text: string | undefined | null): text is string {
  return typeof text === 'string' && text.trim() !== '';
}

export const NUMERALS = ['I', 'II', 'III', 'IV', 'V'] as const;
/** The most rooms the composition hangs: the rest of the curated works go to the collection. */
export const MAX_ROOMS = NUMERALS.length;
/** The characters the room switch's names share, at the label size on its four columns. */
const SWITCH_CHARACTERS = 42;
/** How many rooms it hangs when the owner curated none. */
const UNCURATED_ROOMS = 3;

/** The works the rooms hang, in order, each once. */
function roomWorks(input: Pick<VariantRenderInput, 'portfolio'>): readonly Work[] {
  const { portfolio } = input;
  const seen = new Set<string>();
  const once = (work: Work) => !seen.has(work.id) && Boolean(seen.add(work.id));
  const curated = worksByIds(
    [...(portfolio.signature === undefined ? [] : [portfolio.signature]), ...portfolio.featured],
    input,
  ).filter(once);
  if (curated.length > 0) return curated.slice(0, MAX_ROOMS);
  return portfolio.sections
    .flatMap((section) => worksOf(section, input).filter((work) => !isArchived(work, input)))
    .filter(once)
    .slice(0, UNCURATED_ROOMS);
}

/** The placements of a work's meaningful images, the cover first. */
export function imagesOf(
  work: Work,
  input: Pick<VariantRenderInput, 'media'>,
): readonly Placement[] {
  return [...(work.cover ? [work.cover] : []), ...(work.media ?? [])].filter((placement) => {
    const image = placedImage(placement, input);
    return image !== undefined && !image.decorative;
  });
}

/** How a work hangs on the collection wall, by its medium, and what it places. */
export function mountOf(work: Work, images: readonly Placement[]): Mount {
  switch (work.medium) {
    case 'photography':
    case 'image-series':
      return images.length > 0 ? 'print' : 'sheet';
    case 'audio-video':
      return work.number !== undefined || present(work.series) || images.length === 0
        ? 'sleeve'
        : 'screen';
    case 'music':
      return images.length > 0 ? 'ledge' : 'sleeve';
    case 'writing':
      return 'sheet';
    default:
      return images.length > 0 ? 'screen' : 'sheet';
  }
}

/** How a room shows its work: the first is the entrance's reading, writing a vitrine, and an image a wall. */
function layoutOf(index: number, work: Work, image: Placement | undefined): RoomLayout {
  if (index === 0) return 'reading';
  if (work.medium === 'writing' && image === undefined) return 'vitrine';
  return image !== undefined ? 'wall' : 'reading';
}

/**
 * The gallery each section hangs in: the destination the navigation model
 * placed it in, the map's with Atelier's one override. A section with no
 * href, which the model doesn't place, takes the map's own answer. One the
 * map leaves to the index alone still renders, so it hangs too: an untitled
 * lede, or a hero past the entrance's, in Practice, and a custom or
 * extension section in Contact. None of that moves a destination: the
 * navigation keeps them in the index alone.
 */
function galleryOf(entry: OutlineSection, navigation: NavigationModel): GalleryKey {
  const place = navigation.placed.has(entry.id)
    ? navigation.placed.get(entry.id)
    : canonicalDestination(entry);
  if (place !== null && place !== undefined) return place;
  return entry.kind === 'hero' || entry.kind === 'lede' || entry.kind === 'practice'
    ? 'about'
    : 'contact';
}

/** The galleries past the collection wall, in the order a visitor walks them. */
const GALLERIES = ['about', 'record', 'contact'] as const;

const GALLERY_LABELS: Readonly<Record<GalleryKey, string>> = {
  work: 'Collection',
  writing: 'Writing',
  about: 'Practice',
  record: 'Record',
  contact: 'Contact',
};

function build(input: VariantRenderInput): AtelierModel {
  const outline = pageOutline(input);
  const byId = new Map(input.portfolio.sections.map((section) => [section.id, section]));
  const shown = outline.sections.flatMap((entry) => byId.get(entry.id) ?? []);
  const hero = shown.find((section): section is HeroSection => section.kind === 'hero');
  // The thesis is the entrance's room title only when the practice has one to show.
  const thesis = present(input.portfolio.practice?.thesis)
    ? shown.find((section): section is PracticeSection => isThesis(section))
    : undefined;

  const curated = roomWorks(input);
  // The switch shares four columns among the rooms' names, so the more rooms, the shorter each.
  const budget = Math.floor(SWITCH_CHARACTERS / Math.max(curated.length, 1));
  const rooms = curated.map((work, index): Room => {
    const image = imagesOf(work, input)[0];
    return {
      work,
      number: index + 1,
      numeral: NUMERALS[index]!,
      name: roomName(work.title, budget, work.lang ?? input.portfolio.locale),
      anchor: `${input.ids.prefix}${work.id}`,
      layout: layoutOf(index, work, image),
      side: index % 2 === 1 ? 'start' : 'end',
      ...(image ? { image } : {}),
    };
  });
  const inRoom = new Map(rooms.map((room) => [room.work.id, room]));

  // The collection: each works section's bay, numbered on from the rooms in hanging order.
  const collection = shown.filter((section) => section.kind === 'works');
  const bays = new Map<string, Bay>();
  const hung = new Set<string>();
  let next = rooms.length + 1;
  for (const section of collection) {
    const works = worksOf(section, input);
    const inRooms = works.flatMap((work) => inRoom.get(work.id) ?? []);
    const items = works.flatMap((work): Hung[] => {
      // A work hangs once: in its room, or in the first bay that lists it.
      if (inRoom.has(work.id) || hung.has(work.id)) return [];
      hung.add(work.id);
      const images = imagesOf(work, input);
      const mount = mountOf(work, images);
      return [
        {
          work,
          number: next++,
          mount,
          plates: mount === 'print' ? images : [],
          ...(mount === 'screen' || mount === 'ledge' ? { image: images[0] } : {}),
        },
      ];
    });
    bays.set(section.id, { hung: items, inRooms });
  }
  const hangs = next > rooms.length + 1 ? { first: rooms.length + 1, last: next - 1 } : undefined;

  // The entrance wall carries the hero and the thesis; every other section hangs in a gallery.
  const entrance = (entry: OutlineSection) => entry.id === hero?.id || entry.id === thesis?.id;
  const navigation = atelierNavigation(outline);
  const hangsIn = (entry: OutlineSection) =>
    entrance(entry) ? null : galleryOf(entry, navigation);
  // The galleries hang every section that renders, linked or not, in reading order.
  const galleries = GALLERIES.flatMap((key): Gallery[] => {
    const sections = outline.sections
      .filter((entry) => hangsIn(entry) === key)
      .flatMap((entry) => byId.get(entry.id) ?? []);
    return sections.length > 0 ? [{ key, label: GALLERY_LABELS[key], sections }] : [];
  });
  // The exit wall: the first quote any gallery holds, hung on its way out, its destination unmoved.
  const exit = galleries
    .flatMap(({ sections }) => sections)
    .find((section): section is QuoteSection => section.kind === 'quote');
  // An untitled inscription takes it, so the label stands beside the words alone.
  const exitLabel =
    exit && !present(exit.title)
      ? galleries
          .find((gallery) => gallery.key === 'contact')
          ?.sections.find((section) => section.kind === 'cta')
      : undefined;

  // Practice and Record as rooms, numbered on from the works' rooms.
  const halls = new Map<Gallery['key'], Hall>();
  for (const gallery of galleries) {
    if (gallery.key === 'contact') continue;
    const hung = hangingOrder(gallery, exit, exitLabel);
    if (hung.length === 0) continue;
    const numeral = roman(rooms.length + halls.size + 1);
    halls.set(gallery.key, { numeral, ...hallParts(gallery.key, hung, input) });
  }

  return {
    outline,
    hero,
    thesis,
    rooms,
    collection,
    bays,
    hangs,
    galleries,
    exit,
    exitLabel,
    navigation,
    total: next - 1,
    halls,
    roomCount: rooms.length + halls.size,
  };
}

/** A room's numeral: I to XXXIX, as many rooms as a page has. */
export function roman(n: number): string {
  const tens = ['', 'X', 'XX', 'XXX'][Math.floor(n / 10)] ?? '';
  const ones = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'][n % 10] ?? '';
  return tens + ones;
}

/** Whether every entry of an evidence section is a metric: At a glance. */
function allMetrics(section: Section, input: VariantRenderInput): boolean {
  if (section.kind !== 'evidence') return false;
  const entries = evidenceOf(section, input);
  return entries.length > 0 && entries.every((entry) => entry.type === 'metric');
}

/**
 * A hall's parts: one summary, and the rest folded. Practice: its words'
 * first paragraph is the wall label, and Now, when it has one, hangs beside
 * it as a dated sheet (the rest of the words and its lists are the whole
 * practice). The record: At a glance, and everything else,
 * the framed voices and the experience too, is the whole record. With
 * neither, the hall's first section is its summary.
 */
function hallParts(
  key: Gallery['key'],
  hung: readonly Section[],
  input: VariantRenderInput,
): Omit<Hall, 'numeral'> {
  const summary =
    key === 'about'
      ? hung.find((section) => section.kind === 'lede')
      : hung.find((section) => allMetrics(section, input));
  // Practice's notice, Now, hangs on its wall beside the words as the room's one object (OBS-4).
  const notice = key === 'about' ? hung.find((section) => section.kind === 'now') : undefined;
  const lead = [summary ?? hung[0], notice].filter(
    (section, index, all): section is Section =>
      section !== undefined && all.indexOf(section) === index,
  );
  return { lead, whole: hung.filter((section) => !lead.includes(section)) };
}

/** Where a section reads in Practice's checklist: the words first, then now, focus and the like, then the practice's parts. */
function practiceColumn(section: ViewSection): 'main' | 'side' | 'shelf' {
  switch (section.kind) {
    case 'lede':
      return 'main';
    case 'practice':
      return 'shelf';
    default:
      return 'side';
  }
}

/**
 * The sections a gallery hangs, in the order it hangs them: the exit wall's
 * quote and its label left to the exit, and Practice as one checklist of wall labels, its
 * words first, then now, focus and the like, then the practice's parts,
 * skills, tools, and services. The rest keep reading order.
 */
export function hangingOrder(
  gallery: Gallery,
  exit: QuoteSection | undefined,
  exitLabel?: Section,
): readonly Section[] {
  const rest = gallery.sections.filter((section) => section !== exit && section !== exitLabel);
  if (gallery.key !== 'about') return rest;
  return (['main', 'side', 'shelf'] as const).flatMap((column) =>
    rest.filter((section) => practiceColumn(section) === column),
  );
}

/** Whether the section is the practice's thesis. */
export function isThesis(section: ViewSection): boolean {
  return section.kind === 'practice' && section.part === 'thesis';
}

const models = new WeakMap<VariantRenderInput, AtelierModel>();

/**
 * The home page's model, built once for each render input, so the page and
 * every section's renderer read the same rooms, numbers, and galleries.
 */
export function atelierModel(input: VariantRenderInput): AtelierModel {
  let model = models.get(input);
  if (!model) {
    model = build(input);
    models.set(input, model);
  }
  return model;
}

/** The gallery a section hangs in, as the model placed it. */
export function galleryFor(model: AtelierModel, sectionId: string): Gallery | undefined {
  return model.galleries.find(({ sections }) => sections.some(({ id }) => id === sectionId));
}

/** The medium in words, for a wall label. None for an extension's medium, which names itself. */
export function mediumLabel(work: Pick<Work, 'medium'>): string | undefined {
  const labels: Record<string, string> = {
    interface: 'Interface',
    system: 'System',
    software: 'Software',
    photography: 'Photography',
    'image-series': 'Photographs',
    writing: 'Writing',
    research: 'Research',
    music: 'Music',
    'audio-video': 'Audio and video',
    object: 'Object',
  };
  return Object.hasOwn(labels, work.medium) ? labels[work.medium] : undefined;
}
