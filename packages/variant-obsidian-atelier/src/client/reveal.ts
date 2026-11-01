// Landing on a place, and keeping a focused control in sight (redesign,
// stream C). The whole record, the whole practice, and a bay's checklist
// are closed on the server, so a fragment into one, from the plan, Index,
// or another page, opens every disclosure holding it, scrolls it clear of
// the fixed and sticky boxes, and moves focus there without the browser's
// own scroll. Chromium opens a fold itself on a fragment; other browsers
// don't, so this does. Focus moves only on a hash navigation this code
// handles, or the skip link, never on a click.

/** The fixed and sticky boxes that can stand over the page: Index, the marker and its strip, the bars, the rails. */
export const COVERS =
  '.oa-chrome__pin, .oa-chrome__here, .oa-chrome__strip, .oa-casebar, .oa-hall__rail, .oa-signage';

/** How far below them a place stops. */
const CLEAR = 8;

/** The id a fragment names, or null for none, or for one that isn't valid percent-encoding ("#100%"). */
export function fragmentId(hash: string): string | null {
  if (!hash.startsWith('#') || hash.length < 2) return null;
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return null;
  }
}

/** The element a fragment names in `root`, when there is one. */
export function placeOf(root: Element, hash: string): HTMLElement | null {
  const id = fragmentId(hash);
  const place = id === null ? null : document.getElementById(id);
  return place && root.contains(place) ? place : null;
}

/**
 * The lowest edge of the fixed or sticky boxes drawn over `target`, or 0: what's painted at points
 * along its top and middle, so a box whose rectangle meets it but is drawn under it doesn't count.
 */
function coveredTo(root: Element, target: Element, r: DOMRect): number {
  let under = 0;
  for (const y of [r.top + 0.5, (r.top + r.bottom) / 2]) {
    for (const f of [0.02, 0.25, 0.5, 0.75, 0.98]) {
      const x = r.left + f * r.width;
      if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
      const box = document.elementFromPoint(x, y)?.closest<HTMLElement>(COVERS);
      if (!box || !root.contains(box) || box.contains(target)) continue;
      const position = getComputedStyle(box).position;
      if (position === 'fixed' || position === 'sticky') {
        under = Math.max(under, box.getBoundingClientRect().bottom);
      }
    }
  }
  return under;
}

/**
 * Scroll `target` down from under the boxes over it, when its top is under
 * one: never a target taller than the window, and never one in the clear.
 */
export function clearOf(root: Element, target: Element): void {
  // A control in the fixed chrome, Index or the dialog, is where it is: nothing to scroll from under.
  if (target.closest('.oa-chrome, dialog')) return;
  const r = target.getBoundingClientRect();
  if (r.height > window.innerHeight) return;
  const under = coveredTo(root, target, r);
  if (under > 0 && r.top < under + CLEAR) window.scrollBy(0, r.top - under - CLEAR);
}

/** Open every disclosure holding `place`, scroll it to the window's top clear of the boxes, and focus it. */
export function land(root: Element, place: HTMLElement): void {
  for (let at = place.parentElement; at; at = at.parentElement) {
    if (at instanceof HTMLDetailsElement) at.open = true;
  }
  // Focusable for this landing alone, so a later click inside it doesn't focus it.
  if (!place.hasAttribute('tabindex')) {
    place.setAttribute('tabindex', '-1');
    place.addEventListener('blur', () => place.removeAttribute('tabindex'), { once: true });
  }
  place.focus({ preventScroll: true });
  const pin = root.querySelector('.oa-chrome__pin')?.getBoundingClientRect();
  window.scrollBy(0, place.getBoundingClientRect().top - (pin ? pin.bottom : 0) - CLEAR);
  clearOf(root, place);
}
