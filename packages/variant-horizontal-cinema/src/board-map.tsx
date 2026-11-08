'use client';

import { useEffect, useRef, useState } from 'react';
import { useBoundary } from '@portfolio/appearance/react';
import { Words } from './parts';

// The storyboard's minimap (redesign): the case study's scenes as blocks on
// the bottom edge, each a real link to its scene, slabs filled with the
// matte, the scene being read in the accent. An IntersectionObserver says
// which scene that is: the one across the upper third, or at the page's
// foot, where the last scenes never reach it, the last one in view. Nothing
// runs while the page is still, and in a plate it's the markup alone.

export interface BoardMark {
  /** Its scene's id, with the prefix. */
  readonly id: string;
  readonly label: string;
  /** A slab on the matte, drawn filled. */
  readonly matte: boolean;
}

export function BoardMap({
  marks,
  lang,
  label,
}: {
  marks: readonly BoardMark[];
  lang: 'en' | undefined;
  label: string;
}) {
  const { plate } = useBoundary();
  const [current, setCurrent] = useState<number | undefined>(undefined);
  const root = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (plate || !root.current || typeof IntersectionObserver === 'undefined') return;
    const doc = root.current.ownerDocument;
    const elements = marks.map((mark) => doc.getElementById(mark.id));
    const view = doc.defaultView!;
    const shown = new Set<number>();
    const read = () => {
      const page = doc.documentElement;
      if (view.scrollY > 0 && view.scrollY + view.innerHeight >= page.scrollHeight - 2) {
        // At the foot: the last scene whose top is on screen.
        const last = elements.findLastIndex(
          (element) => element !== null && element.getBoundingClientRect().top < view.innerHeight,
        );
        if (last >= 0) return setCurrent(last);
      }
      if (shown.size > 0) setCurrent(Math.min(...shown));
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = elements.indexOf(entry.target as HTMLElement);
          if (entry.isIntersecting) shown.add(index);
          else shown.delete(index);
        }
        read();
      },
      // The scene crossing the upper third of the screen is the one being read.
      { rootMargin: '-30% 0px -65% 0px' },
    );
    // The foot of the page moves no scene across the band, so it's read from the scroll that reaches it.
    const foot = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) read();
    });
    for (const element of elements) if (element) observer.observe(element);
    const end = doc.querySelector('.hc-credits');
    if (end) foot.observe(end);
    view.addEventListener('scrollend', read, { passive: true });
    return () => {
      observer.disconnect();
      foot.disconnect();
      view.removeEventListener('scrollend', read);
    };
  }, [marks, plate]);

  const now = current === undefined ? undefined : marks[current];
  return (
    <nav ref={root} className="hc-board__map" aria-label={label}>
      <ol role="list">
        {marks.map((mark, index) => (
          <li key={mark.id}>
            <a
              href={`#${mark.id}`}
              aria-current={current === index ? 'location' : undefined}
              data-matte={mark.matte ? '' : undefined}
            >
              <span className="hc-visually-hidden">{`Scene ${index + 1}: ${mark.label}`}</span>
            </a>
          </li>
        ))}
      </ol>
      {/* Before the observer reads a scene, the server's and the first render's words, the page opens on
          the first scene, the slate, so that's its position: a count instead would be a line the live page
          never shows, and the page without its script would read it. */}
      <p className="hc-board__where" data-type-role="label" aria-hidden="true">
        {now ? (
          <Words lang={lang}>{`${now.label}, ${(current ?? 0) + 1} of ${marks.length}`}</Words>
        ) : marks[0] ? (
          <Words lang={lang}>{`${marks[0].label}, 1 of ${marks.length}`}</Words>
        ) : (
          <Words lang={lang}>{`${marks.length} scenes`}</Words>
        )}
      </p>
    </nav>
  );
}
