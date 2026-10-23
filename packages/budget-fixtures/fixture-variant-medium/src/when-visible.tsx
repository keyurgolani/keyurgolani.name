'use client';

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';

// fixture-variant-medium's visible trigger (#6, Slice 2): its children, the
// glint enhancement, render once the slot comes within 200 px of the
// viewport, so the enhancement's module loads then and not with the page.
// #6's Slice 4 replaces it with EnhancementIsland's visible trigger.

export function WhenVisible({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}): ReactElement {
  const slot = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = slot.current;
    if (!element || seen) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen]);
  return (
    <div ref={slot} className={className}>
      {seen ? children : null}
    </div>
  );
}
