'use client';

import { useEffect, useRef } from 'react';
import type { VariantRenderInput } from '@portfolio/variant-contract';

// Terra Field's one enhancement, on a page that's complete without it:
// 1. Field notes opens with showModal() where the browser has no invoker
//    commands (it opens with none where it has them), closes on a click
//    outside it where closedby isn't supported, and closes before a link
//    in it moves the page;
// 2. the masthead marks the destination in view (aria-current="location")
//    and the marker writes its name;
// 3. a link to a section of the full record opens its disclosure, so does
//    focus inside one, and the page prints with every one open;
// 4. below the fold, each work, frame and column rises into place once as
//    it enters (a row fades in), under no-preference and full motion only, staggered at
//    most 500 ms across a group (TF-S3), as a WAAPI entrance with
//    fill: 'backwards', so what's there is never hidden waiting for it.
// No frame loop, no timer, no scroll listener: idle cost is nothing.
// Inside an inert plate it attaches nothing.

// Each form enters its own way (S-7): works, frames and essay columns rise; the log's and the
// record's rows only fade in; voices, citations and seals stay where they are.
const REVEAL = '.tf-entry,.tf-gallery__frame,.tf-essay,.tf-log>li,.tf-chron>li';
const STAGGER = 60;
const SPREAD = 500;

/**
 * The field the reader is in: the last one reaching the window's top part,
 * in page order, or none while the reader is above them all (the opening).
 */
export function currentField<T>(fields: readonly T[], seen: ReadonlySet<T>): T | undefined {
  return [...fields].reverse().find((each) => seen.has(each));
}

/** Whether the page holds still: the visitor's reduce, or the boundary's motion short of full. */
export function holdsStill(reduce: boolean, motion: string | undefined): boolean {
  return reduce || (motion ?? 'full') !== 'full';
}

/** The nth of n entrances' timing: staggered, at most SPREAD ms across the group, filling backwards. */
export function entrance(index: number, count: number, scene: number, easing: string) {
  const step = Math.min(STAGGER, SPREAD / Math.max(1, count));
  return { duration: scene, easing, delay: index * step, fill: 'backwards' } as const;
}

/** A fragment's id, as written when it isn't valid percent-encoding. */
export function fragmentId(hash: string): string {
  const raw = hash.replace(/^#/, '');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Attaches each part on its own, in order, so one that throws can't strand
 * the others' listeners; the stop undoes every part that attached.
 */
export function attachAll(
  parts: readonly (() => () => void)[],
  report: (error: unknown) => void = console.error,
): () => void {
  const stops: (() => void)[] = [];
  for (const part of parts) {
    try {
      stops.push(part());
    } catch (error) {
      report(error);
    }
  }
  return () => stops.forEach((stop) => stop());
}

/** A duration token's value in ms. */
function ms(value: string, fallback: number): number {
  const n = parseFloat(value);
  if (Number.isNaN(n)) return fallback;
  return value.trim().endsWith('ms') ? n : n * 1000;
}

function notes(root: HTMLElement, dialog: HTMLDialogElement): () => void {
  const invokers = 'command' in HTMLButtonElement.prototype;
  const lightDismiss = 'closedBy' in HTMLDialogElement.prototype;
  const click = (event: MouseEvent) => {
    const target = event.target as Element;
    if (!invokers && target.closest('[data-tf-notes]')) dialog.showModal();
    else if (!invokers && target.closest('[data-tf-close]')) dialog.close();
    else if (target === dialog && !lightDismiss) dialog.close();
    else if (dialog.open && target.closest('a[href^="#"]') && dialog.contains(target)) {
      dialog.close();
      // Closing hands focus back to the opener; the reader is going to the target, so it goes there.
      const at = document.getElementById(fragmentId(target.closest('a')!.hash));
      if (at) {
        if (!at.hasAttribute('tabindex')) at.tabIndex = -1;
        at.focus({ preventScroll: true });
      }
    }
  };
  root.addEventListener('click', click);
  return () => root.removeEventListener('click', click);
}

function spy(root: HTMLElement): () => void {
  const fields = [...root.querySelectorAll<HTMLElement>('[data-tf-destination], .tf-close')];
  const where = root.querySelector<HTMLElement>('.tf-marker__where');
  const links = [...root.querySelectorAll<HTMLAnchorElement>('[data-tf-to]')];
  const idOf = (field: HTMLElement) => field.dataset.tfDestination ?? 'contact';
  const seen = new Set<HTMLElement>();
  const mark = () => {
    // Above every field (the opening) no destination is current, and the marker names none.
    const field = currentField(fields, seen);
    const id = field ? idOf(field) : undefined;
    for (const link of links) {
      if (id !== undefined && link.dataset.tfTo === id)
        link.setAttribute('aria-current', 'location');
      // A work's page marks its destination "page" from the server; only "location" moves.
      else if (link.getAttribute('aria-current') === 'location')
        link.removeAttribute('aria-current');
    }
    const label =
      id === undefined ? '' : links.find((link) => link.dataset.tfTo === id)?.textContent;
    if (where) where.textContent = label ?? '';
  };
  const watch = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        // A field reaches the window's top part only with some of it there, not at an edge.
        if (entry.isIntersecting && entry.intersectionRect.height > 0)
          seen.add(entry.target as HTMLElement);
        else seen.delete(entry.target as HTMLElement);
      }
      mark();
    },
    { rootMargin: '0px 0px -60% 0px', threshold: [0, 0.001] },
  );
  let live = true;
  const observe = () => {
    if (!live) return;
    watch.disconnect();
    seen.clear();
    for (const field of fields) watch.observe(field);
  };
  observe();
  // Once the fonts and the media have set the page's lengths, look again.
  void document.fonts?.ready.then(observe);
  addEventListener('load', observe, { once: true });
  return () => {
    live = false;
    removeEventListener('load', observe);
    watch.disconnect();
  };
}

function records(root: HTMLElement): () => void {
  const closed = () => [
    ...root.querySelectorAll<HTMLDetailsElement>('details[data-record]:not([open])'),
  ];
  const open = (at: Element | null, scroll: boolean) => {
    const holding = closed().filter(
      (fold) => at && (fold.contains(at) || fold.parentElement === at),
    );
    for (const fold of holding) fold.open = true;
    if (scroll && holding.length > 0) at?.scrollIntoView({ block: 'start' });
  };
  const onHash = () => {
    const id = fragmentId(location.hash);
    open(id ? document.getElementById(id) : null, true);
  };
  const onFocus = (event: FocusEvent) => {
    const at = event.target as Element;
    if (!at.matches('summary')) open(at, false);
  };
  let printed: HTMLDetailsElement[] = [];
  const before = () => {
    printed = closed();
    for (const fold of printed) fold.open = true;
  };
  const after = () => {
    for (const fold of printed) fold.open = false;
    printed = [];
  };
  onHash();
  addEventListener('hashchange', onHash);
  addEventListener('beforeprint', before);
  addEventListener('afterprint', after);
  root.addEventListener('focusin', onFocus);
  return () => {
    removeEventListener('hashchange', onHash);
    removeEventListener('beforeprint', before);
    removeEventListener('afterprint', after);
    root.removeEventListener('focusin', onFocus);
  };
}

function reveals(root: HTMLElement): () => void {
  const style = getComputedStyle(root);
  const scene = ms(style.getPropertyValue('--motion-scene'), 700);
  const curve = style.getPropertyValue('--motion-curve').trim() || 'ease-out';
  const seen = new WeakSet<Element>();
  let first = true;
  const watch = new IntersectionObserver(
    (entries) => {
      const entering = entries.filter((entry) => entry.isIntersecting);
      // What's on screen when the page loads stays as it is.
      if (first) {
        first = false;
        for (const entry of entering) {
          seen.add(entry.target);
          watch.unobserve(entry.target);
        }
        return;
      }
      entering.forEach((entry, index) => {
        if (seen.has(entry.target)) return;
        seen.add(entry.target);
        watch.unobserve(entry.target);
        entry.target.animate(
          [
            // The report's 16 px rise, at the element's own text size; a row only fades.
            { opacity: 0, translate: entry.target.matches('li') ? '0 0' : '0 1em' },
            { opacity: 1, translate: '0 0' },
          ],
          entrance(index, entering.length, scene, curve),
        );
      });
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  for (const element of root.querySelectorAll(REVEAL)) watch.observe(element);
  return () => watch.disconnect();
}

export default function FieldEnhancement({
  input,
}: {
  readonly input: Pick<VariantRenderInput, 'variant'>;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const root = ref.current?.closest<HTMLElement>('.tf-root');
    if (!root || root.closest('[inert]')) return;
    const dialog = root.querySelector<HTMLDialogElement>('dialog.tf-notes');
    const boundary = root.closest<HTMLElement>('[data-appearance-boundary]');
    const still = holdsStill(
      matchMedia('(prefers-reduced-motion: reduce)').matches,
      boundary?.dataset.motion,
    );
    return attachAll([
      records.bind(null, root),
      ...(dialog ? [notes.bind(null, root, dialog)] : []),
      spy.bind(null, root),
      ...(!still && 'animate' in Element.prototype ? [reveals.bind(null, root)] : []),
    ]);
  }, []);
  // A mark that the enhancement mounted, for the page's own checks.
  return <span ref={ref} hidden data-tf-enhanced={input.variant} />;
}
