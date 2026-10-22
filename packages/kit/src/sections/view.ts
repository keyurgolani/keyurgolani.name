// What the shared renderers read of the render input's public view (#10,
// slice 1): the records a section lists, the media a placement shows, a
// github section's snapshot, where a record's anchor goes, and whether a
// section has anything public to show. Every renderer reads the view
// through here, so its shape is known in one place. The view already left
// out hidden sections, private records, the media only they use, and
// references to any of them.

import type { VariantRenderInput } from '@portfolio/variant-contract';
import type { ImageState, PlacedImage } from './media';
import type { GithubSnapshotState } from './renderers/github';

/** Something the portfolio identifies: a section, record, or media asset. */
interface Identified {
  readonly id: string;
}

type Portfolio = VariantRenderInput['portfolio'];
/** What the record helpers read: a render input, or the public view it came from. */
export type ViewSource = Pick<VariantRenderInput, 'portfolio'>;
type Section = Portfolio['sections'][number];
type Work = NonNullable<Portfolio['works']>[number];
type Evidence = NonNullable<Portfolio['evidence']>[number];
type Chronology = NonNullable<Portfolio['chronology']>[number];

/** The records of one collection by id. Built once per collection per input. */
const indexes = new WeakMap<readonly Identified[], ReadonlyMap<string, Identified>>();

function byId<T extends Identified>(records: readonly T[] | undefined): ReadonlyMap<string, T> {
  if (!records) return new Map();
  let index = indexes.get(records);
  if (!index) {
    index = new Map(records.map((record) => [record.id, record]));
    indexes.set(records, index);
  }
  return index as ReadonlyMap<string, T>;
}

/** The ids a section lists, in its order. */
function itemsOf(section: Section): readonly string[] {
  return 'items' in section && Array.isArray(section.items)
    ? (section.items as unknown[]).filter((item): item is string => typeof item === 'string')
    : [];
}

/** The works a works section lists, in its order. */
export function worksOf(section: Section, input: ViewSource): readonly Work[] {
  const works = byId(input.portfolio.works);
  return itemsOf(section).flatMap((id) => works.get(id) ?? []);
}

/** The evidence an evidence section lists, in its order. */
export function evidenceOf(section: Section, input: ViewSource): readonly Evidence[] {
  const evidence = byId(input.portfolio.evidence);
  return itemsOf(section).flatMap((id) => evidence.get(id) ?? []);
}

/** Evidence by id, in the order given: a work's own, say. */
export function evidenceByIds(
  ids: readonly string[] | undefined,
  input: ViewSource,
): readonly Evidence[] {
  const evidence = byId(input.portfolio.evidence);
  return (ids ?? []).flatMap((id) => evidence.get(id) ?? []);
}

/**
 * The chronology a section lists: its items in their order, or with none,
 * every public entry, newest first by its authored dates.
 */
export function chronologyOf(section: Section, input: ViewSource): readonly Chronology[] {
  const entries = input.portfolio.chronology ?? [];
  const items = itemsOf(section);
  if ('items' in section && Array.isArray(section.items)) {
    const index = byId(entries);
    return items.flatMap((id) => index.get(id) ?? []);
  }
  return [...entries].sort(newestFirst);
}

/** A loose date's order: present and an open end last-to-come, so first. */
function dateOrder(raw: string | undefined): number {
  if (raw === undefined) return Number.NEGATIVE_INFINITY;
  const trimmed = raw.trim();
  if (/^(?:present|now|current)$/i.test(trimmed)) return Number.POSITIVE_INFINITY;
  const iso = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(trimmed);
  if (iso) return Number(iso[1]) * 10000 + Number(iso[2] ?? 1) * 100 + Number(iso[3] ?? 1);
  const monthYear = /^([A-Za-z]+)\s+(\d{4})$/.exec(trimmed);
  if (monthYear) {
    const month = MONTHS.indexOf(monthYear[1]!.slice(0, 3).toLowerCase());
    return Number(monthYear[2]) * 10000 + (month + 1) * 100 + 1;
  }
  return Number.NEGATIVE_INFINITY;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Newest first: an ongoing entry, then by end, then by start. Ties keep the document's order. */
function newestFirst(a: Chronology, b: Chronology): number {
  const end = (entry: Chronology) =>
    entry.period ? dateOrder(entry.period.end ?? 'present') : Number.NEGATIVE_INFINITY;
  const start = (entry: Chronology) =>
    entry.period ? dateOrder(entry.period.start) : Number.NEGATIVE_INFINITY;
  return end(b) - end(a) || start(b) - start(a);
}

/** Works by id, in the order given: signature and featured, say. */
export function worksByIds(ids: readonly string[] | undefined, input: ViewSource): readonly Work[] {
  const works = byId(input.portfolio.works);
  return (ids ?? []).flatMap((id) => works.get(id) ?? []);
}

/** Whether the work is in `archive`. */
export function isArchived(work: Identified, input: ViewSource): boolean {
  return (input.portfolio.archive ?? []).includes(work.id);
}

/** Whether the work is the signature work. */
export function isSignature(work: Identified, input: ViewSource): boolean {
  return input.portfolio.signature === work.id;
}

/**
 * The DOM id for a record, on the first visible section that lists it, so
 * a `#<record id>` link lands on it and no id repeats when two sections list
 * the same record. Elsewhere it has none.
 */
export function recordAnchor(
  section: Section,
  record: Identified,
  input: VariantRenderInput,
): string | undefined {
  const first = input.portfolio.sections.find((candidate) =>
    candidate.kind === 'chronology' && !('items' in candidate && Array.isArray(candidate.items))
      ? (input.portfolio.chronology ?? []).some((entry) => entry.id === record.id)
      : itemsOf(candidate).includes(record.id),
  );
  return first?.id === section.id ? `${input.ids.prefix}${record.id}` : undefined;
}

/** A placement: an asset, and what the placement overrides of it. */
export interface Placement {
  readonly asset: string;
  readonly caption?: string;
  readonly alt?: string;
  readonly decorative?: boolean;
  readonly focalPoint?: { readonly x: number; readonly y: number };
}

/** The image a placement shows, its overrides applied, or none when its asset isn't in the view. */
export function placedImage(
  placement: Placement | undefined,
  input: VariantRenderInput,
  caption?: PlacedImage['caption'],
): PlacedImage | undefined {
  if (!placement) return undefined;
  const asset = byId(input.portfolio.media).get(placement.asset);
  if (!asset || asset.kind !== 'image') return undefined;
  const derived = input.media[placement.asset];
  const image: ImageState =
    derived?.state === 'ready'
      ? { state: 'ready', value: derived.value }
      : { state: 'unavailable', reason: derived?.reason ?? 'processing' };
  return {
    asset: placement.asset,
    alt: placement.alt ?? asset.alt,
    caption,
    credit: asset.credit,
    decorative: placement.decorative ?? asset.decorative ?? false,
    focalPoint: placement.focalPoint ?? asset.focalPoint,
    image,
  };
}

/** A github section's snapshot, if the view has one for it. */
export function githubSnapshot(
  section: Identified,
  input: VariantRenderInput,
): GithubSnapshotState | undefined {
  return input.derived.github?.[section.id] as GithubSnapshotState | undefined;
}

/**
 * Whether the section has anything public to show. One that doesn't leaves
 * the page and the navigation: renderSection() renders nothing for it, and
 * deriveNavItems() leaves it out.
 */
export function sectionShows(section: Section, input: ViewSource): boolean {
  switch (section.kind) {
    case 'works':
      return worksOf(section, input).length > 0;
    case 'evidence':
      return evidenceOf(section, input).length > 0;
    case 'chronology':
      return chronologyOf(section, input).length > 0;
    case 'practice': {
      const practice = input.portfolio.practice;
      if (!practice) return false;
      if (section.part === 'thesis') return typeof practice.thesis === 'string';
      return (practice[section.part]?.length ?? 0) > 0;
    }
    case 'contact': {
      const { contact } = input.portfolio;
      return Boolean(contact && (contact.message !== undefined || contact.links?.length));
    }
    default:
      return true;
  }
}
