import { isSectionId, RESERVED_SECTION_IDS, SECTION_ID_MAX_LENGTH } from '../ids';
import { isPlainObject } from '../json';

// Section ids for an old file, which may leave them out or write them in any
// shape (#4, item 20). The generated ids are the anchors the old navigation
// linked to: the old kit's slugify() of the title, or of the kind.

/** The old kit's slugify, so a generated id is the anchor visitors had. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Why a section got the id it did. */
export type IdSource =
  'kept' | 'set' | 'hero' | 'title' | 'kind' | 'slugified' | 'repeated' | 'reserved';

export interface AssignedId {
  readonly index: number;
  readonly id: string;
  readonly source: IdSource;
}

/**
 * One id per section. Ids the file (or `--set`) gives in the right shape are
 * kept, first come first served. Every other section gets `top` for a hero,
 * else its slugified title, else its kind; an id in the wrong shape is
 * slugified the same way. Each is cut at a hyphen to fit 64 characters, and
 * takes the next free `-2`, `-3` when it's taken or reserved (`main`), in
 * document order.
 */
export function assignSectionIds(
  sections: readonly unknown[],
  preset: ReadonlyMap<number, string> = new Map(),
): AssignedId[] {
  const given = sections.map((section, index) => {
    const id = preset.get(index) ?? (isPlainObject(section) ? section.id : undefined);
    return typeof id === 'string' ? id : undefined;
  });
  const taken = new Set<string>();
  const assigned = new Map<number, AssignedId>();
  // Well-shaped ids first, `--set` ones before the file's, so a generated id
  // never takes one the owner chose.
  const order = [...given.keys()].sort((a, b) => Number(!preset.has(a)) - Number(!preset.has(b)));
  for (const index of order) {
    const id = given[index];
    if (id !== undefined && isSectionId(id) && !taken.has(id)) {
      taken.add(id);
      assigned.set(index, { index, id, source: preset.has(index) ? 'set' : 'kept' });
    }
  }
  sections.forEach((section, index) => {
    if (assigned.has(index)) return;
    const id = given[index];
    const fields = isPlainObject(section) ? section : {};
    const kind = typeof fields.kind === 'string' ? fields.kind : 'section';
    const title = typeof fields.title === 'string' ? slugify(fields.title) : '';
    let base: string;
    let source: IdSource;
    if (id !== undefined && slugify(id) !== '') {
      base = slugify(id);
      // A well-shaped id that got here is another section's already.
      source = RESERVED_SECTION_IDS.includes(id)
        ? 'reserved'
        : isSectionId(id)
          ? 'repeated'
          : 'slugified';
    } else if (kind === 'hero') {
      base = 'top';
      source = 'hero';
    } else if (title !== '') {
      base = title;
      source = 'title';
    } else {
      base = slugify(kind) || 'section';
      source = 'kind';
    }
    const free = nextFree(base, taken);
    taken.add(free);
    assigned.set(index, { index, id: free, source });
  });
  return sections.map((_, index) => assigned.get(index)!);
}

/** `base` cut to fit, or with the first `-2`, `-3`, ... no section has. */
function nextFree(base: string, taken: ReadonlySet<string>): string {
  const free = (id: string) => !taken.has(id) && !RESERVED_SECTION_IDS.includes(id);
  const first = fit(base, '');
  if (free(first)) return first;
  for (let n = 2; ; n++) {
    const id = fit(base, `-${n}`);
    if (free(id)) return id;
  }
}

/** `base` plus `suffix` in 64 characters, cutting `base` at a hyphen when it must. */
function fit(base: string, suffix: string): string {
  const room = SECTION_ID_MAX_LENGTH - suffix.length;
  if (base.length <= room) return `${base}${suffix}`;
  const cut = base.slice(0, room + 1).lastIndexOf('-');
  const kept = cut > 0 ? base.slice(0, cut) : base.slice(0, room);
  return `${kept.replace(/-+$/, '')}${suffix}`;
}
