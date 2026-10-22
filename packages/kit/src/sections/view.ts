// What the shared renderers read of the render input's published view (#10,
// slice 1): the records a section lists, the image a placement shows, a
// github section's snapshot, where a record's anchor goes, and whether a
// section has anything public to show. Every renderer reads the view through
// here, so its shape is known in one place. The view already left out hidden
// sections, private records, what nothing visible reaches, and references to
// any of them, and every list in it is present.

import type { ChronologyEntry, Evidence, Placement, SectionDerived, Work } from '@portfolio/schema';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import type { PlacedImage } from './media';

export type { Placement };

/** Something the portfolio identifies: a section, record, or media asset. */
interface Identified {
  readonly id: string;
}

type Section = VariantRenderInput['portfolio']['sections'][number];

/** What the record helpers read: a render input, or the published view it came from. */
export type ViewSource = Pick<VariantRenderInput, 'portfolio'>;

/** A view source with the composition's capabilities, when it's a render input. */
type RenderedSource = ViewSource & Partial<Pick<VariantRenderInput, 'capabilities'>>;

/** Whether the composition renders the section's kind: its manifest's unsupportedKinds don't. */
export function rendersKind(section: Section, input: RenderedSource): boolean {
  return !(input.capabilities?.unsupportedKinds ?? []).includes(section.kind);
}

/** The records of one collection by id. Built once per collection. */
const indexes = new WeakMap<readonly Identified[], ReadonlyMap<string, Identified>>();

function byId<T extends Identified>(records: readonly T[]): ReadonlyMap<string, T> {
  let index = indexes.get(records);
  if (!index) {
    index = new Map(records.map((record) => [record.id, record]));
    indexes.set(records, index);
  }
  return index as ReadonlyMap<string, T>;
}

/** The record ids a section lists, in its order: a works, evidence, or chronology section's items. */
function itemsOf(section: Section): readonly string[] {
  switch (section.kind) {
    case 'works':
    case 'evidence':
      return section.items;
    case 'chronology':
      // The view fills in the items of a chronology section that lists none.
      return section.items ?? [];
    default:
      return [];
  }
}

function pick<T extends Identified>(ids: readonly string[] | undefined, records: readonly T[]) {
  const index = byId(records);
  return (ids ?? []).flatMap((id) => index.get(id) ?? []);
}

/** The works a works section lists, in its order. */
export function worksOf(section: Section, input: ViewSource): readonly Work[] {
  return section.kind === 'works' ? pick(section.items, input.portfolio.works) : [];
}

/** The evidence an evidence section lists, in its order. */
export function evidenceOf(section: Section, input: ViewSource): readonly Evidence[] {
  return section.kind === 'evidence' ? pick(section.items, input.portfolio.evidence) : [];
}

/**
 * The chronology a section lists, in its order. A section the owner wrote
 * without items lists every public entry, newest first, which the view
 * already put in its items.
 */
export function chronologyOf(section: Section, input: ViewSource): readonly ChronologyEntry[] {
  return section.kind === 'chronology' ? pick(section.items, input.portfolio.chronology) : [];
}

/** Works by id, in the order given: the signature and featured works, say. */
export function worksByIds(ids: readonly string[] | undefined, input: ViewSource): readonly Work[] {
  return pick(ids, input.portfolio.works);
}

/** Evidence by id, in the order given: a work's own, or the proof strip. */
export function evidenceByIds(
  ids: readonly string[] | undefined,
  input: ViewSource,
): readonly Evidence[] {
  return pick(ids, input.portfolio.evidence);
}

/** Whether the work is in the portfolio's archive. */
export function isArchived(work: Identified, input: ViewSource): boolean {
  return input.portfolio.archive.includes(work.id);
}

/** Whether the work is the portfolio's signature work. */
export function isSignature(work: Identified, input: ViewSource): boolean {
  return input.portfolio.signature === work.id;
}

/**
 * The first visible section that lists the record, which holds its anchor.
 * A section of a kind the composition doesn't render is passed over, since
 * it isn't on the page.
 */
export function anchorSection(record: Identified, input: RenderedSource): Section | undefined {
  return input.portfolio.sections.find(
    (section) => rendersKind(section, input) && itemsOf(section).includes(record.id),
  );
}

/**
 * The DOM id for a record on the first visible section that lists it, so a
 * `#<record id>` link lands on it and no id repeats when two sections list
 * the same record. Anywhere else it has none.
 */
export function recordAnchor(
  section: Section,
  record: Identified,
  input: RenderedSource & Pick<VariantRenderInput, 'ids'>,
): string | undefined {
  return anchorSection(record, input)?.id === section.id
    ? `${input.ids.prefix}${record.id}`
    : undefined;
}

/**
 * The image a placement shows, with its overrides applied: its own alt,
 * decorative flag, and focal point over its asset's. None when the asset
 * isn't an image the view holds.
 */
export function placedImage(
  placement: Placement | undefined,
  input: Pick<VariantRenderInput, 'media'>,
  caption?: PlacedImage['caption'],
): PlacedImage | undefined {
  if (!placement) return undefined;
  const asset = Object.hasOwn(input.media, placement.asset)
    ? input.media[placement.asset]
    : undefined;
  if (!asset || asset.kind !== 'image') return undefined;
  const decorative = placement.decorative ?? asset.decorative ?? false;
  return {
    asset: asset.id,
    // Decoration takes no alt text.
    alt: decorative ? undefined : (placement.alt ?? asset.alt),
    caption,
    credit: asset.credit,
    decorative,
    focalPoint: placement.focalPoint ?? asset.focalPoint,
    image: asset.derived,
  };
}

/** A github section's snapshot: ready with its data, or why it has none. */
export function githubSnapshot(
  section: Identified,
  input: Pick<VariantRenderInput, 'derived'>,
): SectionDerived | undefined {
  return Object.hasOwn(input.derived, section.id) ? input.derived[section.id] : undefined;
}

/**
 * Whether the section has anything public to show. The view drops a
 * section that doesn't, so this holds for every section in it; it guards a
 * section a variant hands renderSection() from elsewhere, so the page and
 * the navigation still agree.
 */
export function sectionShows(section: Section, input: ViewSource): boolean {
  switch (section.kind) {
    case 'works':
      return worksOf(section, input).length > 0;
    case 'evidence':
      return evidenceOf(section, input).length > 0;
    case 'chronology':
      return chronologyOf(section, input).length > 0;
    case 'practice':
      return input.portfolio.practice?.[section.part] !== undefined;
    case 'contact':
      // The contact record, or the ways to reach the author it adds to.
      return (
        input.portfolio.contact !== undefined ||
        input.portfolio.identity.email !== undefined ||
        input.portfolio.links.length > 0
      );
    default:
      return true;
  }
}
