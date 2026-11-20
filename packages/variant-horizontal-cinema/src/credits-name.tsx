'use client';

import { useEffect, useRef } from 'react';
import { useBoundary } from '@portfolio/appearance/react';

// The credits' name, at the display size, set smaller wherever its widest word, kept whole, is
// wider than its line: with large text on a phone the display size, twice what it is at 100%, ran
// a surname past the line, and the role's overflow-wrap broke it inside the word. The fit is the
// line's width over that word's, read again whenever the name's box changes size: a resize, or a
// change of text size, which moves the page's margins and the name's own size. Unscripted, or in a
// plate, it's the role's size, and a word too wide for its line still breaks rather than run out.

export function CreditsName({ id, name }: { id: string; name: string }) {
  const { plate } = useBoundary();
  const root = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    const element = root.current;
    if (plate || !element || typeof ResizeObserver === 'undefined') return;
    const view = element.ownerDocument.defaultView!;
    const style = element.style;
    let frame: number | undefined;
    let set = '';
    const fit = () => {
      frame = undefined;
      style.removeProperty('--layout-credits-fit');
      // The widest word, kept whole: the name's narrowest width when no word may break.
      style.setProperty('overflow-wrap', 'normal');
      style.setProperty('inline-size', 'min-content');
      const widest = element.getBoundingClientRect().width;
      style.removeProperty('overflow-wrap');
      style.removeProperty('inline-size');
      const line = element.getBoundingClientRect().width;
      set = widest > line + 0.5 ? String(Math.floor((1000 * line) / widest) / 1000) : '';
      if (set) style.setProperty('--layout-credits-fit', set);
    };
    // Fitted in the next frame, not in the observer's own callback: the fit changes the box it
    // watches, and its next report, the fitted size, reads the same fit again and changes nothing.
    const observer = new ResizeObserver(() => {
      frame ??= view.requestAnimationFrame(fit);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (frame !== undefined) view.cancelAnimationFrame(frame);
      if (set) style.removeProperty('--layout-credits-fit');
    };
  }, [plate]);

  return (
    <p ref={root} id={id} className="hc-credits__name" data-type-role="display">
      {name}
    </p>
  );
}
