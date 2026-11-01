import type { Portfolio, Site } from '@portfolio/schema';
import type { PublicationUnit } from './port';
import type { Unit } from './unit';

// A unit as the site renders it (#3, item 19): each document's normalized
// model, the media document's, and the snapshots, frozen to the last field,
// since one is served to every request until the pointer moves. Both
// readers make theirs here.

/** Freezes `value` and everything in it, frozen parts included, so nothing in it can change. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * The unit as visitors' pages read it. Its models are checked already: a
 * unit is built by checkUnit(), or read from a revision whose every hash
 * matched and whose documents the validator accepts.
 */
export function publicationUnitOf(unit: Unit): PublicationUnit {
  return deepFreeze({
    portfolio: unit.portfolio.model as Portfolio,
    site: unit.site.model as Site,
    ...(unit.media ? { media: unit.media.model } : {}),
    snapshots: { ...unit.snapshots },
  });
}
