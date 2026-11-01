import {
  COMPOSITION_FAMILY,
  UPCOMING_COMPOSITIONS,
} from '@portfolio/variant-contract/studio-catalog';
import { PENDING_LABEL } from '@portfolio/variant-contract/status';
import type { CatalogOption, AppearanceCatalog } from './appearance';
import { FAMILIES, type FamilyCount } from './catalog-filter';
import type { TypeStills, TypeStyle } from './type-stills';

// The grown pickers' data (P-5, the round 5b mockups): what each picker
// files its options under, at 14 compositions, 33 design languages, 34
// schemes, and 15 typography packs (after LANG-5a's merges). Framework-free, so a test holds every
// count the chips show to the catalog's.
//
// - Compositions. Each first-party one sits in one of four families,
//   Print, Technical, Stage, and Surface, which the platform names in
//   @portfolio/variant-contract/studio-catalog beside COMPOSITION_STATUS,
//   since a composition's manifest has no picker family and the host names
//   no composition. The program's
//   compositions a build doesn't register yet are listed too, as in
//   progress (A2): disabled, with no drawing, never checked, never a
//   recipe or a compare plate. Ready ones come first. A family chip counts
//   the ready ones, and a family with none ready has no chip (A P1-1).
//   Flux stays out until its package registers (ruling Q6).
// - Schemes. One axis of character, Earthy, Neutral, or Vivid (ruling Q2):
//   an Accessible scheme keeps its manifest family for its tag and toggle,
//   and takes a character here; a generated one is its own section.
// - Typography. A pack is sans, serif, or mono, by its display role's
//   generic family, and self-hosted or a system font. A self-hosted one's
//   row shows its two stills; a system one's sets its name in its own
//   stack and says "System font", since a system face renders differently
//   on every platform. A self-hosted one the build has no stills for, as a
//   third party's, sets its name in its fallback stack, never its web font.
// - Retired ids (LANG-1) are never an option or a count: the catalog keeps
//   them only as aliases.

/** What the picker labels a composition still in progress with. */
const IN_PROGRESS = PENDING_LABEL;

/** An upcoming composition as the picker lists it: in progress, with nothing to draw. */
function upcomingOption(entry: (typeof UPCOMING_COMPOSITIONS)[number]): CatalogOption {
  return {
    id: entry.id,
    name: entry.name,
    description: null,
    signature: entry.signature,
    tier: null,
    provenance: [],
    performance: null,
    access: null,
    status: 'pending',
    statusLabel: IN_PROGRESS,
    family: COMPOSITION_FAMILY[entry.id] ?? null,
    still: null,
  };
}

/** `options` with the ready ones first, each group in its own order. */
export function readyFirst<T extends Pick<CatalogOption, 'status'>>(options: readonly T[]): T[] {
  return [
    ...options.filter((option) => option.status !== 'pending'),
    ...options.filter((option) => option.status === 'pending'),
  ];
}

/**
 * The composition picker's options: the build's, each with its family, and
 * the program's upcoming ones the build doesn't register, all in progress,
 * ready first. A third-party composition has no family and lists under All.
 */
export { COMPOSITION_FAMILY, UPCOMING_COMPOSITIONS };

export function compositionOptions(catalog: AppearanceCatalog): CatalogOption[] {
  const registered = catalog.axes.find((entry) => entry.axis === 'variant')?.options ?? [];
  const ids = new Set(registered.map(({ id }) => id));
  return readyFirst([
    ...registered.map((option) => ({
      ...option,
      family: option.family ?? COMPOSITION_FAMILY[option.id] ?? null,
    })),
    ...UPCOMING_COMPOSITIONS.filter(({ id }) => !ids.has(id)).map(upcomingOption),
  ]);
}

/**
 * The composition chips: All, then each family with a ready composition,
 * each counting the ready ones, since an option in progress can't be picked.
 */
export function compositionFamilyCounts(options: readonly CatalogOption[]): FamilyCount[] {
  const ready = options.filter((option) => option.status !== 'pending');
  const families = FAMILIES.variant
    .map(({ id, label }) => ({
      id,
      label,
      count: ready.filter((option) => option.family === id).length,
    }))
    .filter((family) => family.count > 0);
  return [{ id: 'all', label: 'All', count: ready.length }, ...families];
}

/** A scheme's character on the one-axis chips (ruling Q2). */
export type SchemeCharacter = 'earthy' | 'neutral' | 'vivid';

/** The character each Accessible scheme files under, since its manifest family is Accessible. */
export const ACCESSIBLE_CHARACTER: Readonly<Record<string, SchemeCharacter>> = Object.freeze({
  'blue-orange-color-safe': 'vivid',
  'cool-color-safe': 'neutral',
  'high-contrast': 'neutral',
  'reduced-chroma': 'neutral',
  'low-stimulus-warm': 'earthy',
});

const CHARACTERS: readonly string[] = ['earthy', 'neutral', 'vivid'];

/**
 * Where a scheme sits on the picker: its character, whether it carries the
 * Accessible tag, and whether it's generated, which has a section of its
 * own and no character. Null character for an Accessible scheme this
 * module names none for, which lists under All.
 */
export function schemePlacement(option: Pick<CatalogOption, 'id' | 'family'>): {
  readonly character: SchemeCharacter | null;
  readonly accessible: boolean;
  readonly generated: boolean;
} {
  const family = option.family ?? '';
  if (family === 'generated') return { character: null, accessible: false, generated: true };
  if (family === 'accessible') {
    return {
      character: ACCESSIBLE_CHARACTER[option.id] ?? null,
      accessible: true,
      generated: false,
    };
  }
  return {
    character: CHARACTERS.includes(family) ? (family as SchemeCharacter) : null,
    accessible: false,
    generated: false,
  };
}

/** A typography row, as the picker draws it. */
export type TypeRow =
  | {
      readonly source: 'self-hosted';
      readonly style: TypeStyle;
      /** Its two stills, or null when the build has none for it, as for a third-party pack. */
      readonly stills: TypeStills;
      readonly label: null;
    }
  | {
      /**
       * A self-hosted pack the build has no stills for, as a third party's: Studio never sets
       * its web font, so the row sets its name in the pack's fallback stack, the stack with
       * the families it ships taken out, and says what it shows.
       */
      readonly source: 'self-hosted';
      readonly style: TypeStyle;
      readonly stills: null;
      /** The fallback stack the row sets its name in. */
      readonly stack: string;
      readonly label: 'Shown in its fallback faces';
    }
  | {
      readonly source: 'system';
      readonly style: TypeStyle;
      /** A system font never has a still: the row sets the name in its own stack. */
      readonly stills: null;
      /** The stack the row sets its name in. */
      readonly stack: string;
      readonly label: 'System font';
    };

/** How the typography picker draws `option`, from its specimen. */
export function typeRowOf(option: Pick<CatalogOption, 'specimen'>): TypeRow | null {
  const specimen = option.specimen;
  if (specimen?.kind !== 'type') return null;
  if (specimen.source === 'system') {
    return {
      source: 'system',
      style: specimen.style,
      stills: null,
      stack: specimen.display,
      label: 'System font',
    };
  }
  if (specimen.stills) {
    return { source: 'self-hosted', style: specimen.style, stills: specimen.stills, label: null };
  }
  return {
    source: 'self-hosted',
    style: specimen.style,
    stills: null,
    stack: specimen.display,
    label: 'Shown in its fallback faces',
  };
}
