import { isSectionId, RESERVED_SECTION_IDS, SECTION_ID_MAX_LENGTH } from '../ids';
import { isPlainObject } from '../json';

// Section ids for an old file, which may leave them out or write them in any
// shape (#4, item 20). The generated ids are the anchors the old navigation
// linked to: the old kit's slugify() of the id, the title, or the kind.

/** The old kit's slugify, so a generated id is the anchor visitors had. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Why a section got the id it did. `kind`: it has no title. `unusable`: its
 * title has no letter or digit an id can use, so the id comes from its kind.
 */
export type IdSource =
  'kept' | 'set' | 'hero' | 'title' | 'kind' | 'unusable' | 'slugified' | 'repeated' | 'reserved';

export interface AssignedId {
  readonly index: number;
  readonly id: string;
  readonly source: IdSource;
  /**
   * The id the old page gave the section, which its navigation and links
   * pointed at: the old kit's ensureSectionId() of the id, else the title,
   * else the kind, and `top` for a hero. Hidden sections had none on the
   * page; this is the one they'd have had.
   */
  readonly anchor: string;
}

/** The old kit's ensureSectionId(), as the navigation and the hero called it. */
function oldAnchor(section: Record<string, unknown>): string {
  const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined);
  const id = text(section.id);
  if (id !== undefined && slugify(id) !== '') return slugify(id);
  const kind = text(section.kind) ?? 'section';
  const fallback = kind === 'hero' ? 'top' : (text(section.title) ?? kind);
  return slugify(fallback) || fallback;
}

/** Whether the old navigation linked the section: shown, titled, and not a hero or call to action. */
function navLinked(section: Record<string, unknown>): boolean {
  return (
    section.hidden !== true &&
    section.kind !== 'hero' &&
    section.kind !== 'cta' &&
    typeof section.title === 'string' &&
    section.title !== ''
  );
}

/**
 * One id per section. An id the file (or `--set`) gives in the right shape is
 * kept while it's free. Every other section gets `top` for a hero, else its
 * slugified title, else its kind; an id in the wrong shape is slugified the
 * same way. Each is cut at a hyphen to fit 64 characters, and takes the next
 * free `-2`, `-3` when it's taken or reserved (`main`). The `--set` ids go
 * first, as the owner chose them. Then the sections the old navigation linked
 * claim theirs, in document order, so the links visitors followed keep
 * working, and then the rest, in document order.
 */
export function assignSectionIds(
  sections: readonly unknown[],
  preset: ReadonlyMap<number, string> = new Map(),
): AssignedId[] {
  const fieldsOf = (section: unknown): Record<string, unknown> =>
    isPlainObject(section) ? section : {};
  const given = sections.map((section, index) => {
    const id = preset.get(index) ?? fieldsOf(section).id;
    return typeof id === 'string' ? id : undefined;
  });
  const taken = new Set<string>();
  const assigned = new Map<number, AssignedId>();
  const record = (index: number, id: string, source: IdSource) =>
    assigned.set(index, { index, id, source, anchor: oldAnchor(fieldsOf(sections[index])) });
  const claim = (index: number) => {
    const id = given[index];
    if (id !== undefined && isSectionId(id) && !taken.has(id)) {
      taken.add(id);
      record(index, id, preset.has(index) ? 'set' : 'kept');
    } else {
      generate(index);
    }
  };
  const generate = (index: number) => {
    const id = given[index];
    const fields = fieldsOf(sections[index]);
    const kind = typeof fields.kind === 'string' ? fields.kind : 'section';
    const titled = typeof fields.title === 'string' && fields.title !== '';
    const title = titled ? slugify(fields.title as string) : '';
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
      source = titled ? 'unusable' : 'kind';
    }
    const free = nextFree(base, taken);
    taken.add(free);
    record(index, free, source);
  };
  for (const index of [...preset.keys()].sort((a, b) => a - b)) {
    if (index < sections.length) claim(index);
  }
  const rest = [...sections.keys()].filter((index) => !assigned.has(index));
  for (const index of rest) if (navLinked(fieldsOf(sections[index]))) claim(index);
  for (const index of rest) if (!assigned.has(index)) claim(index);
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
