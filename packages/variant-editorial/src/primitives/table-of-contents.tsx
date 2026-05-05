'use client';

import { useEffect, useRef, useState } from 'react';
import type { NavItem } from '@portfolio/kit';
import { cn } from '@portfolio/kit';

interface TableOfContentsProps {
  items: NavItem[];
  /** Brand label rendered on the left (typically the author's name). */
  brand: string;
  /** Anchor href for the brand link. Defaults to '#top'. */
  brandHref?: string;
}

const HEADER_HEIGHT = 64;

/**
 * Sticky top-of-page navigation rail. Builds from `deriveNavItems` server-side,
 * highlights the active section via IntersectionObserver, and hides on
 * scroll-down so it gets out of the way while reading.
 *
 * No-op when `items` is empty — variants without enough sections to navigate
 * shouldn't show empty chrome.
 */
export function TableOfContents({ items, brand, brandHref = '#top' }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string | null>(items[0]?.href.replace(/^#/, '') ?? null);
  const [hidden, setHidden] = useState(false);
  const lastScrollY = useRef(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (items.length === 0) return;

    const ids = items.map((item) => item.href.replace(/^#/, '')).filter(Boolean);
    if (ids.length === 0) return;

    const elementToRatio = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            elementToRatio.set(entry.target.id, entry.intersectionRatio);
          } else {
            elementToRatio.delete(entry.target.id);
          }
        }
        if (elementToRatio.size === 0) return;
        let bestId: string | null = null;
        let bestRatio = 0;
        for (const [id, ratio] of elementToRatio) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestId = id;
          }
        }
        if (bestId) setActiveId(bestId);
      },
      {
        rootMargin: `-${HEADER_HEIGHT}px 0px -40% 0px`,
        threshold: [0, 0.15, 0.35, 0.6, 0.85, 1],
      },
    );

    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [items]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        const y = window.scrollY;
        const goingDown = y > lastScrollY.current && y > HEADER_HEIGHT * 1.5;
        const nearTop = y < HEADER_HEIGHT;
        setHidden(goingDown && !nearTop);
        lastScrollY.current = y;
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  function onClick(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (!href.startsWith('#')) return;
    const id = href.slice(1);
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveId(id);
    history.replaceState(null, '', href);
  }

  if (items.length === 0) return null;

  return (
    <nav
      aria-label="Table of contents"
      className={cn('editorial-toc')}
      data-hidden={hidden}
    >
      <div className="editorial-toc__inner">
        <a href={brandHref} className="editorial-toc__brand" onClick={(e) => onClick(e, brandHref)}>
          {brand}
        </a>
        <ul className="editorial-toc__list">
          {items.map((item) => {
            const id = item.href.replace(/^#/, '');
            const isActive = id === activeId;
            return (
              <li key={item.href} className="editorial-toc__item">
                <a
                  href={item.href}
                  className="editorial-toc__link"
                  aria-current={isActive ? 'true' : undefined}
                  onClick={(e) => onClick(e, item.href)}
                >
                  {item.label}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
