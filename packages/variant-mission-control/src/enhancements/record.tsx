'use client';

import { useEffect, useRef } from 'react';
import type { VariantRenderInput } from '@portfolio/variant-contract';

// Mission Control's full record (Design gate rule 8), on a page that's whole
// without it: the closed panels at a board's end are native disclosures,
// which open on a click and, with no script, from a fragment link (the
// stylesheet's :target rule, while the root has no data-mc-folds mark) and
// on paper (its print rule). This opens the
// one a fragment link lands in, so the page then scrolls to it, and opens
// every closed one for printing, closing them again after. No frame loop,
// no timer, no scroll listener. Inside an inert plate it attaches nothing.

/** A fragment's id, as written when it isn't valid percent-encoding. */
export function fragmentId(hash: string): string {
  const raw = hash.replace(/^#/, '');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function attach(root: HTMLElement): () => void {
  const closed = () => [
    ...root.querySelectorAll<HTMLDetailsElement>('details[data-mc-fold]:not([open])'),
  ];
  // The folds that hold the element, or that the element's own panel holds, outermost first.
  const open = (at: Element | null) => {
    if (!at || !root.contains(at)) return false;
    const holding = closed().filter((fold) => fold.contains(at) || fold.parentElement === at);
    for (const fold of holding) fold.open = true;
    return holding.length > 0;
  };
  const onHash = () => {
    const id = fragmentId(location.hash);
    const at = id ? document.getElementById(id) : null;
    if (open(at)) at?.scrollIntoView({ block: 'start' });
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
  // From here the enhancement opens a targeted fold itself: the stylesheet's no-script look for
  // one steps aside (it keys on this mark's absence, never on a scripting query).
  root.setAttribute('data-mc-folds', '');
  addEventListener('hashchange', onHash);
  addEventListener('beforeprint', before);
  addEventListener('afterprint', after);
  return () => {
    root.removeAttribute('data-mc-folds');
    removeEventListener('hashchange', onHash);
    removeEventListener('beforeprint', before);
    removeEventListener('afterprint', after);
  };
}

export default function RecordEnhancement({
  input,
}: {
  readonly input: Pick<VariantRenderInput, 'variant'>;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const root = ref.current?.closest<HTMLElement>('.mc-root');
    if (!root || root.closest('[inert]')) return;
    return attach(root);
  }, []);
  // A mark that the enhancement mounted, for the page's own checks.
  return <span ref={ref} hidden data-mc-record={input.variant} />;
}
