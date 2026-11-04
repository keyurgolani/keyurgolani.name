// The settle signal (the capture race, 2026-11-03): an element carrying
// `data-enhancement-pending`, naming the enhancement ids whose first pass is
// still to run, says the page isn't settled yet. The kit's <Enhancement>
// renders one for every enhancement, an inert <template> in its own place,
// and drops it once the enhancement has attached. An enhancement whose first
// real pass comes later, after an observer's first delivery say, holds the
// page as unsettled with one on an element of its own markup, and takes its
// id off once that pass has run (enhancementSettled()), and only its own: a
// composition settles nothing else. The kit takes the id off a hold for an
// enhancement that fails or that the boundary turns off, so nothing waits on
// a pass that never comes. The variant specs' desktop and
// mobile shots and the quality cells' reads (watchEnhancements()) wait until
// no element on the page carries it. It never styles anything; the page
// reads the same with or without it.
//
// Its own subpath, with no dependency, so an enhancement's chunk imports it
// without the contract's validators.

/** The attribute: on the kit's template, and on an element of a composition's own markup that holds. */
export const ENHANCEMENT_PENDING = 'data-enhancement-pending';

/** The attribute's prop for the element, naming each enhancement whose first pass is still to run. */
export function enhancementPending(...ids: readonly string[]): { [ENHANCEMENT_PENDING]: string } {
  return { [ENHANCEMENT_PENDING]: ids.join(' ') };
}

/** What enhancementSettled() reads and writes on the element. */
export interface PendingElement {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/**
 * Takes `id` off the element's pending list once its first pass has run, and
 * the attribute with the last id. An element that names no such id is left
 * as it is.
 */
export function enhancementSettled(element: PendingElement | null | undefined, id: string): void {
  const value = element?.getAttribute(ENHANCEMENT_PENDING);
  if (!element || value === null || value === undefined) return;
  const rest = value.split(/\s+/).filter((each) => each !== '' && each !== id);
  if (rest.length > 0) element.setAttribute(ENHANCEMENT_PENDING, rest.join(' '));
  else element.removeAttribute(ENHANCEMENT_PENDING);
}
