'use client';

import { useEffect, useRef } from 'react';
import type { VariantRenderInput } from '@portfolio/variant-contract';

// Mission Control's correlate (brief §5.8, MC-M4), on a page that's whole
// without it: pointing at a record that names others, or pinning it, lights
// every record it names anywhere on the wall, and the rest dim.
// - Pointing counts only as hover intent: a fine pointer that can hover,
//   resting on the record for INTENT_MS. A touch, a coarse pointer or a
//   pass over the wall on the way elsewhere lights nothing.
// - The pin is the record's Linked control: the browser opens its popover
//   with no script, and while it's open its records stay lit. A link in it
//   keeps them lit while the page moves there, until the next press or
//   Escape.
// - The list takes the keyboard as a dialog does: opening it moves focus to
//   its first link, and Tab or Shift+Tab off either end, or Escape (the
//   browser's), closes it with focus back on its control. A press elsewhere
//   on the page closes it and leaves focus where the press put it.
// - Focus alone never lights anything: there's no focus listener.
// The dim is the muted text role, which every scheme holds at 4.5:1 or more
// on the panels; a transition eases it only under no-preference and full
// motion (the stylesheet), so under reduce it's an instant change. One
// timer while the pointer rests, then nothing: no frame loop, no polling.
// Inside an inert plate it attaches nothing.

/** How long a fine pointer rests on a record before it counts as intent (MC-M4). */
export const INTENT_MS = 220;

/** The keys a source lights: itself (every copy of it) and the records it names. */
export function litKeys(source: string, names: string | undefined): ReadonlySet<string> {
  return new Set([source, ...(names ?? '').split(/\s+/).filter(Boolean)]);
}

/** Whether a pointer event can carry hover intent: a mouse or a pen, on a device that hovers finely. */
export function intends(pointerType: string, fineHover: boolean): boolean {
  return fineHover && (pointerType === 'mouse' || pointerType === 'pen');
}

/** What lights: the pin over the hover, else nothing. */
export const sourceOf = (pinned: string | undefined, hovered: string | undefined) =>
  pinned ?? hovered;

/**
 * Marks the wall for a source: each record whose key it lights carries
 * data-mc-lit ("source" on the source's own copies), each record and panel
 * that holds nothing lit carries data-mc-dim, and the root names the
 * source. With no source every mark goes.
 */
export function mark(root: HTMLElement, source: string | undefined): void {
  const records = [...root.querySelectorAll<HTMLElement>('[data-mc-rec]')];
  const panels = [...root.querySelectorAll<HTMLElement>('.mc-panel')];
  if (source === undefined) {
    root.removeAttribute('data-mc-trace');
    for (const element of [...records, ...panels]) {
      element.removeAttribute('data-mc-lit');
      element.removeAttribute('data-mc-dim');
    }
    return;
  }
  const names = root.querySelector<HTMLElement>(
    `[data-mc-rec="${CSS.escape(source)}"][data-mc-names]`,
  )?.dataset.mcNames;
  const lit = litKeys(source, names);
  root.setAttribute('data-mc-trace', source);
  for (const record of records) {
    const key = record.dataset.mcRec!;
    if (lit.has(key)) record.setAttribute('data-mc-lit', key === source ? 'source' : '');
    else record.removeAttribute('data-mc-lit');
  }
  for (const element of [...records, ...panels]) {
    const holds = element.hasAttribute('data-mc-lit') || element.querySelector('[data-mc-lit]');
    if (holds) element.removeAttribute('data-mc-dim');
    else element.setAttribute('data-mc-dim', '');
  }
}

function attach(root: HTMLElement): () => void {
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  let hovered: string | undefined;
  let pinned: string | undefined;
  let waiting: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // A link in an open popover hands the pin on to the page it moves.
  let carried = false;
  // Where the last press since a list opened landed: a press outside a list and its control
  // dismisses it there, and focus stays where the press put it.
  let pressed: Element | null = null;
  let shown: string | undefined;
  const render = () => {
    const source = sourceOf(pinned, hovered);
    if (source === shown) return;
    shown = source;
    mark(root, source);
  };
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    waiting = undefined;
  };
  const recordAt = (target: EventTarget | null) =>
    target instanceof Element ? target.closest<HTMLElement>('[data-mc-names]') : null;

  const over = (event: PointerEvent) => {
    if (!intends(event.pointerType, fine.matches)) return;
    const record = recordAt(event.target);
    if (!record || !root.contains(record)) return;
    const key = record.dataset.mcRec!;
    if (key === hovered || key === waiting) return;
    cancel();
    waiting = key;
    timer = setTimeout(() => {
      timer = undefined;
      waiting = undefined;
      hovered = key;
      render();
    }, INTENT_MS);
  };
  const out = (event: PointerEvent) => {
    const record = recordAt(event.target);
    if (!record) return;
    const next = event.relatedTarget;
    if (next instanceof Node && record.contains(next)) return;
    const key = record.dataset.mcRec;
    if (key === waiting) cancel();
    if (key === hovered) {
      hovered = undefined;
      render();
    }
  };
  const toggle = (event: Event) => {
    const pop = event.target;
    if (!(pop instanceof HTMLElement) || !pop.dataset.mcPop) return;
    const state = (event as Event & { newState?: string }).newState;
    if (state === 'open') {
      carried = false;
      pressed = null;
      pinned = pop.dataset.mcPop;
      // Focus moves into the list it opened, as into a dialog.
      if (!pop.contains(document.activeElement)) pop.querySelector<HTMLElement>('a[href]')?.focus();
    } else {
      if (pinned === pop.dataset.mcPop && !carried) pinned = undefined;
      // Closed with focus left inside it or dropped to the page: it goes back to the control.
      // A link that carried the pin keeps the focus where it moved it, and so does a press
      // elsewhere on the page (the browser's light dismiss), which may be far from the control:
      // focusing it then would scroll the page back to it.
      const control = controlOf(pop);
      const away = pressed !== null && !pop.contains(pressed) && !control?.contains(pressed);
      const active = document.activeElement;
      if (!carried && !away && (!active || active === document.body || pop.contains(active)))
        control?.focus();
    }
    render();
  };
  const click = (event: MouseEvent) => {
    const link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
    const pop = link?.closest<HTMLElement>('[data-mc-pop]');
    if (!link || !pop || !root.contains(pop)) return;
    carried = true;
    pop.hidePopover();
  };
  // A press anywhere, or Escape, ends a pin a link carried; an open popover ends its own.
  const release = () => {
    if (!carried) return;
    carried = false;
    if (root.querySelector('[data-mc-pop]:popover-open')) return;
    pinned = undefined;
    render();
  };
  const press = (event: PointerEvent) => {
    pressed = event.target instanceof Element ? event.target : null;
    release();
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') release();
    if (event.key === 'Tab') leave(event);
  };
  // Tab off either end of an open list closes it and stops on its control, so focus never
  // reaches the page behind an open list and the next Tab goes on from the control.
  const leave = (event: KeyboardEvent) => {
    const pop = document.activeElement?.closest<HTMLElement>('[data-mc-pop]');
    if (!pop || !root.contains(pop) || !pop.matches(':popover-open')) return;
    const links = [...pop.querySelectorAll<HTMLElement>('a[href]')];
    const at = links.indexOf(document.activeElement as HTMLElement);
    if (!(event.shiftKey ? at <= 0 : at === links.length - 1)) return;
    event.preventDefault();
    pop.hidePopover();
    controlOf(pop)?.focus();
  };
  const controlOf = (pop: HTMLElement) =>
    root.querySelector<HTMLElement>(`[popovertarget="${CSS.escape(pop.id)}"]`);
  root.addEventListener('pointerover', over);
  root.addEventListener('pointerout', out);
  root.addEventListener('toggle', toggle, true);
  root.addEventListener('click', click);
  document.addEventListener('pointerdown', press, true);
  document.addEventListener('keydown', key);
  return () => {
    cancel();
    root.removeEventListener('pointerover', over);
    root.removeEventListener('pointerout', out);
    root.removeEventListener('toggle', toggle, true);
    root.removeEventListener('click', click);
    document.removeEventListener('pointerdown', press, true);
    document.removeEventListener('keydown', key);
    mark(root, undefined);
  };
}

export default function CorrelateEnhancement({
  input,
}: {
  readonly input: Pick<VariantRenderInput, 'variant'>;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const root = ref.current?.closest<HTMLElement>('.mc-root');
    if (!root || root.closest('[inert]') || !root.querySelector('[data-mc-names]')) return;
    return attach(root);
  }, []);
  // A mark that the enhancement mounted, for the page's own checks.
  return <span ref={ref} hidden data-mc-enhanced={input.variant} />;
}
