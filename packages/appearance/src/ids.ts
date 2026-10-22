// Ids inside a presentation boundary (#19, Slice 3, item 1). A document
// boundary's ids are unprefixed, so fragment URLs stay stable; a plate's all
// start with its own prefix, so plates and the page share one document
// without a collision. The prefix is VariantRenderInput.ids.prefix, which
// ids.main and #5's idFor() already carry, so a variant's sections, the
// primitives, and SVG ids line up, and nothing else mints ids: server code
// asks boundaryId(), and the 'use client' primitives useBoundaryId().

import type { VariantRenderInput } from '@portfolio/variant-contract';

/** A boundary's ids, as a variant's render input carries them. */
export type BoundaryIds = Pick<VariantRenderInput['ids'], 'prefix' | 'main'>;

/**
 * A local id: lowercase words joined by single hyphens, such as `contact`
 * or `evidence-tabs`. Never two hyphens in a row, which partId() and #5's
 * idFor() keep for what they add, so no local id takes one of theirs.
 */
const LOCAL_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** A part's own name, such as `label` or `tab-summary`. */
const PART = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Why `local` can't be a local id, or null when it can. */
export function localIdProblem(local: unknown): string | null {
  if (typeof local !== 'string' || !LOCAL_ID.test(local)) {
    return `A local id is lowercase words joined by single hyphens, such as evidence-tabs, and ${JSON.stringify(local)} isn't.`;
  }
  return null;
}

/** `local` with the prefix, for an id a boundary's render shares: `boundaryId(input.ids, 'contact')`. */
export function boundaryId(ids: Pick<BoundaryIds, 'prefix'>, local: string): string {
  return prefixedId(ids.prefix, local);
}

/** `local` with `prefix`. It throws on a local id that isn't lowercase words joined by single hyphens. */
export function prefixedId(prefix: string, local: string): string {
  const problem = localIdProblem(local);
  if (problem) throw new TypeError(problem);
  return `${prefix}${local}`;
}

/**
 * The id of a primitive's part, from the primitive's own id: `<id>--<part>`,
 * such as `pv-contact--error`. The double hyphen keeps it from any local id,
 * and a word, never a number, from idFor()'s repeats.
 */
export function partId(id: string, part: string): string {
  if (!PART.test(part)) throw new TypeError(`A part name is lowercase words, and ${part} isn't.`);
  return `${id}--${part}`;
}
