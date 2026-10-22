import { isSectionId } from './ids';
import { isPlainObject } from './json';
import { redactedPointer } from './secrets';
import type { Context, Diagnostic, UnitValidator } from './diagnostics';

// Every id a portfolio document holds (#10, item 3): its sections', records',
// and media assets', in one namespace. Read from the data as written, so a
// schema problem elsewhere doesn't hide a repeated id, and shared by the
// validator, `pnpm config:ids-fix`, the migration, and `id.reused`.

/** What holds an id. */
export type IdOwner = 'section' | 'work' | 'evidence' | 'chronology' | 'media';

/** The top-level lists whose entries carry ids, and what each entry is. */
export const ID_LISTS: ReadonlyArray<readonly [list: string, owner: IdOwner]> = [
  ['sections', 'section'],
  ['works', 'work'],
  ['evidence', 'evidence'],
  ['chronology', 'chronology'],
  ['media', 'media'],
];

export interface OwnedId {
  /** The id as written: a string, or anything else when it isn't one. */
  readonly id: unknown;
  readonly owner: IdOwner;
  /** Path to the entry; its id is at `[...path, 'id']`. */
  readonly path: readonly (string | number)[];
}

/** Every entry that should carry an id, in document order, list by list. */
export function documentEntries(portfolio: unknown): OwnedId[] {
  if (!isPlainObject(portfolio)) return [];
  const entries: OwnedId[] = [];
  for (const [list, owner] of ID_LISTS) {
    const items = portfolio[list];
    if (!Array.isArray(items)) continue;
    items.forEach((item, index) => {
      entries.push({ id: isPlainObject(item) ? item.id : undefined, owner, path: [list, index] });
    });
  }
  return entries;
}

/** Each entry whose id an earlier entry already has, with that earlier entry. */
export function repeatedIds(portfolio: unknown): Array<{ entry: OwnedId; first: OwnedId }> {
  const first = new Map<string, OwnedId>();
  const repeats: Array<{ entry: OwnedId; first: OwnedId }> = [];
  for (const entry of documentEntries(portfolio)) {
    if (typeof entry.id !== 'string') continue;
    const seen = first.get(entry.id);
    if (seen === undefined) first.set(entry.id, entry);
    else repeats.push({ entry, first: seen });
  }
  return repeats;
}

/** Every well-formed id the document holds, by what holds it. */
export function idOwners(portfolio: unknown): Map<string, OwnedId> {
  const owners = new Map<string, OwnedId>();
  for (const entry of documentEntries(portfolio)) {
    if (typeof entry.id === 'string' && isSectionId(entry.id) && !owners.has(entry.id)) {
      owners.set(entry.id, entry);
    }
  }
  return owners;
}

const OWNER_NAMES: Readonly<Record<IdOwner, string>> = {
  section: 'a section',
  work: 'a work',
  evidence: 'evidence',
  chronology: 'a chronology entry',
  media: 'a media asset',
};

/** How a message names what holds an id. */
export function ownerName(owner: IdOwner): string {
  return OWNER_NAMES[owner];
}

/**
 * `id.reused` (#10, item 3): a draft can't publish while it gives an id the
 * live revision uses to something of another type, since the id names that
 * thing in anchors, feed GUIDs, JSON-LD, and media URLs. It reads the live
 * revision from `ctx.publication`; without it, it reports `notChecked`.
 */
export const idReused: UnitValidator = {
  id: 'id.reused',
  covers: ['id.reused'],
  validate(pair, ctx: Context) {
    const publication = ctx.publication;
    if (!publication) return { diagnostics: [], notChecked: ['id.reused'] };
    if (publication.live === null) return { diagnostics: [] };
    const live = idOwners(publication.live.pair.portfolio);
    const diagnostics: Diagnostic[] = [];
    for (const [id, entry] of idOwners(pair.portfolio)) {
      const before = live.get(id);
      if (before === undefined || before.owner === entry.owner) continue;
      const pointer = redactedPointer([...entry.path, 'id']);
      diagnostics.push({
        code: 'id.reused',
        severity: 'blocks-publish',
        document: 'portfolio',
        pointer,
        message: `${pointer} gives ${ownerName(entry.owner)} the id ${id}, which the live revision gives ${ownerName(before.owner)}.`,
        remediation:
          'Give it an id of its own. An id names one thing for good: anchors, feed entries, JSON-LD, and media URLs point at it. pnpm config:ids-fix mints one.',
      });
    }
    return { diagnostics };
  },
};
