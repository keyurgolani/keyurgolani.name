'use client';

import { createElement, useCallback, useEffect, useState } from 'react';
import type { VariantRenderInput } from '@portfolio/variant-contract';

// Schematic's one enhancement (brief §5.4, step 10), adding to a page that
// already works: with no script every Index link lands on the drawing index
// in the footer, and every fold is open.
// 1. Where <dialog> works, the Index controls become buttons that open the
//    drawing index as a modal dialog; a link in it closes it, and Escape and
//    Close do too, focus going back to the button.
// 2. The sheet being read, by IntersectionObserver alone: aria-current on
//    its links in the title block, and its number and title in the phone
//    bar's Sheet button. (Each sheet's running marker carries its own
//    number in the markup, so it needs no script.)
// 3. Phone folds (below 48rem) close at load, unless the address lands in
//    one; at every width, an arrival or a fragment link that lands in a
//    closed fold opens it, and an arrival keeps its target where it stood.
// 4. The draw-on is CSS alone, a one-shot inside no-preference, timed by
//    the platform's --motion-scene, which a reduced page shortens to the
//    language's fast fade and a static or printed one sets to 0s. So the
//    enhancement carries no runtime of its own (its budget is 4 KB).
// 5. Focus clearance: every target and focus stop keeps the sticky chrome's
//    size clear by CSS (scroll-margin from --layout-stick-start/-end), which
//    fragment jumps and focus that scrolls from off screen honour. Chromium
//    doesn't apply it to a stop that's already partly in view, so a stop
//    that lands under the phone bar or the running marker is scrolled out
//    by its own scroll-margin: two frames after focus, never a loop. Only
//    for keyboard focus (:focus-visible), so a pointer click never moves
//    the page, and always an instant jump, never a smooth one, so reduced
//    motion has nothing to honour.
// No frame loop, no timer, no scroll listener.

const PHONE = '(max-width: 47.99rem)';

export interface SheetMark {
  readonly id: string;
  readonly no: string;
  readonly title: string;
  /** The title's own language, which the phone bar keeps on it. */
  readonly lang: string | null;
  readonly n: number;
}

/** The sheets as the markup carries them, from each sheet's data-sheet and heading. */
export function sheetsIn(root: ParentNode): SheetMark[] {
  return [...root.querySelectorAll<HTMLElement>('.sx-sheet[data-sheet]')].map((sheet, i) => {
    const heading = sheet.querySelector(
      '.sx-sheet__title span[lang], .sx-sheet__title span:last-child',
    );
    return {
      id: sheet.id,
      no: sheet.dataset.sheet ?? '',
      title: sheet.dataset.sheetTitle ?? heading?.textContent ?? '',
      lang: (heading ?? sheet).closest('[lang]')?.getAttribute('lang') ?? null,
      n: i + 1,
    };
  });
}

/** The element a fragment names in `root`, if any. */
export function targetOf(root: ParentNode, hash: string): Element | null {
  if (!hash || hash === '#') return null;
  try {
    return root.querySelector(`#${CSS.escape(decodeURIComponent(hash.slice(1)))}`);
  } catch {
    return null;
  }
}

/**
 * Opens what a fragment lands on: every closed disclosure around the target
 * (a phone fold, home's outline, "n more"), and the target's own fold, since
 * a view's id is on the section that wraps its <details>.
 */
export function openFoldFor(root: ParentNode, hash: string): Element | null {
  const target = targetOf(root, hash);
  if (!target) return null;
  const own = target.querySelector(':scope > details');
  if (own instanceof HTMLDetailsElement && !own.open) own.open = true;
  for (
    let fold = target.closest('details');
    fold;
    fold = fold.parentElement?.closest('details') ?? null
  ) {
    if (fold instanceof HTMLDetailsElement && !fold.open) fold.open = true;
  }
  return target;
}

/** Whether a link names a place on the page it's on. */
const samePage = (link: HTMLAnchorElement) =>
  link.hash.length > 1 && link.origin === location.origin && link.pathname === location.pathname;

/**
 * Where focus goes when a link from the index lands: the view's fold
 * summary, else its heading, else the target itself, made focusable from
 * script alone; without scrolling, since the browser has scrolled there.
 */
export function focusLanding(target: Element | null): void {
  if (!(target instanceof HTMLElement)) return;
  const stop =
    target.querySelector<HTMLElement>(':scope > details > summary') ??
    target.querySelector<HTMLElement>('h1, h2, h3, h4, h5, h6') ??
    target;
  if (!stop.matches('a[href], button, summary, [tabindex]')) stop.setAttribute('tabindex', '-1');
  stop.focus({ preventScroll: true });
}

/** The documents whose arrival this enhancement has already kept in place: once each. */
const KEPT = new WeakSet<Document>();

function attach(root: HTMLElement): () => void {
  const undo: (() => void)[] = [];
  // Where the fragment's target stands as the enhancement comes in, wherever
  // the reader has scrolled by then: what this script changes above it (the
  // Index controls, the folds) is undone against this, once per document.
  const doc = root.ownerDocument;
  const arrival = KEPT.has(doc) ? null : targetOf(root, window.location.hash);
  const stood = arrival?.getBoundingClientRect().top;
  const dialog = root.querySelector<HTMLDialogElement>('dialog.sx-dialog');
  // While the dialog hands focus back on closing, the focus clearance (5)
  // stays out of it: that move is the dialog's, not the reader's.
  let quiet = false;
  const hush = () => {
    quiet = true;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => requestAnimationFrame(() => (quiet = false))),
    );
  };
  // 1. The index as a dialog.
  if (dialog && typeof dialog.showModal === 'function') {
    // Each Index link to the footer's index opens the dialog instead, unless the reader asks
    // for the link itself: a modified click, a middle click, or a new tab.
    const openers = [...root.querySelectorAll<HTMLAnchorElement>('a[data-sx-open]')];
    for (const opener of openers) {
      opener.setAttribute('aria-haspopup', 'dialog');
      opener.setAttribute('aria-controls', dialog.id);
      opener.setAttribute('aria-expanded', 'false');
    }
    const open = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      dialog.showModal();
      (event.currentTarget as HTMLElement).setAttribute('aria-expanded', 'true');
    };
    const closed = () => {
      for (const opener of openers) opener.setAttribute('aria-expanded', 'false');
    };
    const click = (event: Event) => {
      const target = event.target as Element;
      const link = target.closest('a');
      if (!target.closest('[data-sx-close]') && !link) return;
      hush();
      dialog.close();
      // A link on this page: once the browser has scrolled there, focus
      // follows the reader to where it landed, not back to the opener.
      if (link instanceof HTMLAnchorElement && samePage(link)) {
        const hash = link.hash;
        requestAnimationFrame(() => focusLanding(openFoldFor(root, hash)));
      }
    };
    const cancel = () => hush();
    for (const opener of openers) opener.addEventListener('click', open);
    dialog.addEventListener('click', click);
    dialog.addEventListener('cancel', cancel);
    dialog.addEventListener('close', closed);
    undo.push(() => {
      for (const opener of openers) {
        opener.removeEventListener('click', open);
        for (const name of ['aria-haspopup', 'aria-controls', 'aria-expanded'])
          opener.removeAttribute(name);
      }
      dialog.removeEventListener('click', click);
      dialog.removeEventListener('cancel', cancel);
      dialog.removeEventListener('close', closed);
      if (dialog.open) dialog.close();
    });
  }
  // 2. The sheet being read.
  const sheets = sheetsIn(root);
  const here = [...root.querySelectorAll<HTMLElement>('[data-sx-here]')];
  // The bar's cover line as the server sent it (its <Ui lang> child included), to put back.
  const cover = here.map((el) => [...el.childNodes].map((node) => node.cloneNode(true)));
  const mark = (sheet: SheetMark | undefined) => {
    for (const link of root.querySelectorAll<HTMLAnchorElement>('a[data-sx-sheet]')) {
      if (sheet && link.getAttribute('href') === `#${sheet.id}`)
        link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
    here.forEach((el, i) => {
      if (!sheet) {
        el.replaceChildren(...(cover[i] ?? []).map((node) => node.cloneNode(true)));
        return;
      }
      // The title keeps its language: a sheet named in another language stays marked so.
      const title = document.createElement('span');
      title.className = 'sx-here__title';
      title.textContent = sheet.title;
      if (sheet.lang) title.lang = sheet.lang;
      el.replaceChildren(`${sheet.no} `, title);
    });
  };
  if ('IntersectionObserver' in window && sheets.length > 0) {
    const seen = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) seen.set(entry.target.id, entry.isIntersecting);
        const current = sheets.filter((sheet) => seen.get(sheet.id)).at(-1);
        mark(current);
      },
      { rootMargin: '0px 0px -60% 0px' },
    );
    for (const sheet of sheets) {
      const el = root.querySelector(`#${CSS.escape(sheet.id)}`);
      if (el) observer.observe(el);
    }
    undo.push(() => observer.disconnect());
  }
  // 3. Phone folds. The server sends them open, so the browser has already
  // put the reader somewhere (a fragment, a restored position) by the time
  // this runs. A reload or a return through history keeps every fold open:
  // its restored position can't be known to sit above them. A fresh visit
  // closes only the folds below what the reader sees, the fragment's target
  // or the window's top, and never one that holds the target, so nothing
  // above the reader moves.
  const entry = performance.getEntriesByType?.('navigation')[0] as
    PerformanceNavigationTiming | undefined;
  const restoring = entry?.type === 'reload' || entry?.type === 'back_forward';
  const phone = window.matchMedia(PHONE);
  const closed: HTMLDetailsElement[] = [];
  if (phone.matches) {
    if (!restoring) {
      const target = targetOf(root, window.location.hash);
      // What the reader sees starts at the target, or at the window's top once
      // they've scrolled past it before this ran.
      const line = Math.max(target ? target.getBoundingClientRect().top : 0, 0);
      for (const fold of root.querySelectorAll<HTMLDetailsElement>('details[data-sx-fold]')) {
        if (target && (fold.contains(target) || target.contains(fold))) continue;
        if (fold.getBoundingClientRect().top < line) continue;
        fold.open = false;
        closed.push(fold);
      }
    }
  }
  // A phone turned past a phone's width (a rotation, a resized window) gets
  // back every fold this closed: past a phone they have no control (P2 review).
  const widened = () => {
    if (phone.matches) return;
    for (const fold of closed.splice(0)) fold.open = true;
  };
  phone.addEventListener('change', widened);
  undo.push(() => phone.removeEventListener('change', widened));
  // At every width, an arrival opens what its fragment names: a closed view
  // in home's outline has no open at any width. It only opens the target's
  // own fold and those around it. Then, on a fresh visit (never a reload or a
  // return through history), the shift this script made above the target is
  // undone, so the target stands where it stood when the script came in: at
  // its scroll margin if the reader hasn't moved, or wherever they scrolled
  // it, never snapped back to it. Once per document, so a rerun moves nothing.
  openFoldFor(root, window.location.hash);
  if (arrival && stood !== undefined && !restoring) {
    KEPT.add(doc);
    const shift = arrival.getBoundingClientRect().top - stood;
    if (Math.abs(shift) >= 1) window.scrollBy({ top: shift, behavior: 'instant' });
  }
  const hashchange = () => openFoldFor(root, window.location.hash);
  window.addEventListener('hashchange', hashchange);
  undo.push(() => window.removeEventListener('hashchange', hashchange));
  // A link to a place on this page, in a sheet's views, the footer's index or
  // the dialog's, opens what it lands on before the browser scrolls there,
  // whether or not the address changes.
  const inPage = (event: MouseEvent) => {
    const link = (event.target as Element | null)?.closest?.('a[href]');
    if (!(link instanceof HTMLAnchorElement) || !samePage(link)) return;
    openFoldFor(root, link.hash);
  };
  root.addEventListener('click', inPage, true);
  undo.push(() => root.removeEventListener('click', inPage, true));
  // On paper every disclosure prints open, where the browser has no
  // ::details-content to print a closed one's content; each closes again after.
  let printed: HTMLDetailsElement[] = [];
  const beforeprint = () => {
    printed = [...root.querySelectorAll<HTMLDetailsElement>('details:not([open])')];
    for (const fold of printed) fold.open = true;
  };
  const afterprint = () => {
    for (const fold of printed) fold.open = false;
    printed = [];
  };
  window.addEventListener('beforeprint', beforeprint);
  window.addEventListener('afterprint', afterprint);
  undo.push(() => {
    window.removeEventListener('beforeprint', beforeprint);
    window.removeEventListener('afterprint', afterprint);
  });
  // 5. Focus clearance.
  const chrome = [...root.querySelectorAll<HTMLElement>('.sx-phone, .sx-run')];
  const over = (el: Element, a: DOMRect) =>
    chrome
      .filter((bar) => !bar.contains(el))
      .map((bar) => bar.getBoundingClientRect())
      .find(
        (r) =>
          r.height > 0 &&
          a.right > r.left &&
          a.left < r.right &&
          a.bottom > r.top &&
          a.top < r.bottom,
      );
  const nudge = (el: Element) => {
    const a = el.getBoundingClientRect();
    const r = over(el, a);
    if (!r) return;
    // The stop's own scroll-margin is the clearance: below a bar in the top
    // half, above one in the bottom half.
    const m = getComputedStyle(el);
    const dy =
      r.top < window.innerHeight / 2
        ? a.top - parseFloat(m.scrollMarginTop)
        : a.bottom - (window.innerHeight - parseFloat(m.scrollMarginBottom));
    window.scrollBy({ top: dy, behavior: 'instant' });
  };
  const clear = (event: FocusEvent) => {
    const el = event.target;
    if (!(el instanceof Element)) return;
    // Never inside the open dialog (the page behind it holds still), nor
    // for the focus the dialog returns on closing.
    if (quiet || el.closest('dialog[open]')) return;
    // Chromium may scroll a focused stop in during the next rendering
    // update, after this frame's callbacks, so the check waits a frame more.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (document.activeElement === el && el.matches(':focus-visible')) nudge(el);
      }),
    );
  };
  root.addEventListener('focusin', clear);
  undo.push(() => root.removeEventListener('focusin', clear));
  return () => {
    for (const step of undo.reverse()) step();
    mark(undefined);
  };
}

export default function SheetsEnhancement({
  input,
}: {
  readonly input: Pick<VariantRenderInput, 'ids'>;
}) {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const anchor = useCallback((node: HTMLSpanElement | null) => {
    setRoot(node?.closest<HTMLElement>('.sx') ?? null);
  }, []);
  useEffect(() => {
    // Inside a plate (an inert boundary) nothing attaches.
    if (!root || root.closest('[inert]')) return undefined;
    return attach(root);
  }, [root, input.ids.prefix]);
  return createElement('span', { ref: anchor, hidden: true });
}
