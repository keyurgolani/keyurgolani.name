import type { Work } from '@portfolio/schema';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { caseHref } from '../hero';
import { firstLink, hasCaseStudy } from '../model';

// Its own module, so the works renderer and the medium renderers it hands a
// run to (sleeve, looking, essays, episodes) all link a work the same way
// without importing each other in a circle.

/** Where a work's title links: its own page, else its first link. */
export function workHref(work: Work, input: VariantRenderInput): string | undefined {
  return hasCaseStudy(work) ? caseHref(input)(work) : firstLink(work);
}
