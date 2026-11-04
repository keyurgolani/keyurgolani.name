// The kit's side of the settle signal (@portfolio/variant-contract/settle):
// when an enhancement fails or the boundary turns it off, its first pass
// will never come, so the kit takes its id off every hold a composition
// rendered for it, inside that variant's presentation boundary, the boundary
// element itself included. It matches by attribute value, never by a
// selector built from the ids, and never throws: a settle signal can't break
// the page it describes.

import { ENHANCEMENT_PENDING, enhancementSettled } from '@portfolio/variant-contract/settle';

/** What settleHolds() reads of an element. */
export interface HoldElement {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  readonly parentElement: HoldElement | null;
}

/** Whether `element`, or an ancestor of it, is `variant`'s presentation boundary. */
function inBoundary(element: HoldElement, variant: string): boolean {
  for (let at: HoldElement | null = element; at; at = at.parentElement) {
    if (at.getAttribute('data-variant') === variant) return true;
  }
  return false;
}

/** Takes `id` off every hold inside `variant`'s boundary, the boundary itself included. */
export function settleHolds(
  document: { querySelectorAll(selector: string): ArrayLike<HoldElement> } | undefined,
  variant: string,
  id: string,
): void {
  try {
    if (!document) return;
    for (const element of Array.from(document.querySelectorAll(`[${ENHANCEMENT_PENDING}]`))) {
      const ids = (element.getAttribute(ENHANCEMENT_PENDING) ?? '').split(/\s+/);
      if (ids.includes(id) && inBoundary(element, variant)) enhancementSettled(element, id);
    }
  } catch {
    // Nothing to report: the page reads the same without it, and a read that waits on it says so.
  }
}
