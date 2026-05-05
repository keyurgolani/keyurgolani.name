'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { NavItem } from '@portfolio/kit';
import { cn } from '@portfolio/kit';

interface NavigationProps {
  items: NavItem[];
  brand: string;
}

const HEADER_HEIGHT = 64;

/**
 * Fixed glassmorphic top navigation. Desktop: brand + horizontal link list.
 * Mobile (<768px): brand + hamburger that opens a full-height overlay.
 * Hides on scroll down, shows on scroll up. IntersectionObserver tracks the
 * active section.
 */
export function Navigation({ items, brand }: NavigationProps) {
  const [activeId, setActiveId] = useState<string | null>(
    items[0]?.href.replace(/^#/, '') ?? null,
  );
  const [hidden, setHidden] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const lastScrollY = useRef(0);

  useEffect(() => {
    if (typeof window === 'undefined' || items.length === 0) return;
    const ids = items.map((it) => it.href.replace(/^#/, '')).filter(Boolean);
    if (ids.length === 0) return;
    const ratios = new Map<string, number>();
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) ratios.set(e.target.id, e.intersectionRatio);
          else ratios.delete(e.target.id);
        }
        if (ratios.size === 0) return;
        let bestId: string | null = null;
        let bestRatio = 0;
        for (const [id, r] of ratios) {
          if (r > bestRatio) {
            bestRatio = r;
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
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
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
        setHidden(goingDown && !nearTop && !menuOpen);
        lastScrollY.current = y;
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [menuOpen]);

  // Lock body scroll when overlay is open.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  function onAnchorClick(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (!href.startsWith('#')) return;
    const id = href.slice(1);
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveId(id);
    setMenuOpen(false);
    history.replaceState(null, '', href);
  }

  function onBrandClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setMenuOpen(false);
    history.replaceState(null, '', '#');
  }

  if (items.length === 0) return null;

  return (
    <>
      <nav
        aria-label="Site navigation"
        className={cn('kc-nav')}
        data-hidden={hidden || undefined}
      >
        <div className="kc-nav__inner">
          <a href="#" className="kc-nav__brand" onClick={onBrandClick}>
            {brand}
          </a>
          <ul className="kc-nav__list">
            {items.map((item) => {
              const id = item.href.replace(/^#/, '');
              const isActive = id === activeId;
              return (
                <li key={item.href} className="kc-nav__item">
                  <a
                    href={item.href}
                    className="kc-nav__link"
                    aria-current={isActive ? 'true' : undefined}
                    data-active={isActive || undefined}
                    onClick={(e) => onAnchorClick(e, item.href)}
                  >
                    {item.label}
                  </a>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="kc-nav__hamburger"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span aria-hidden="true">{menuOpen ? '✕' : '☰'}</span>
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {menuOpen ? (
          <motion.div
            className="kc-nav-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setMenuOpen(false)}
          >
            <motion.ul
              className="kc-nav-overlay__list"
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -20, opacity: 0 }}
              transition={{ delay: 0.05, duration: 0.25 }}
              onClick={(e) => e.stopPropagation()}
            >
              {items.map((item) => {
                const id = item.href.replace(/^#/, '');
                const isActive = id === activeId;
                return (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      className="kc-nav-overlay__link"
                      aria-current={isActive ? 'true' : undefined}
                      data-active={isActive || undefined}
                      onClick={(e) => onAnchorClick(e, item.href)}
                    >
                      {item.label}
                    </a>
                  </li>
                );
              })}
            </motion.ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
