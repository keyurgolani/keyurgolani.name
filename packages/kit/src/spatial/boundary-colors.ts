'use client';

import { useEffect, useState, type RefObject } from 'react';
import type { ColorRole } from '@portfolio/appearance';

// A canvas can't read a CSS variable, so the kit's canvas effects ask the
// nearest appearance boundary for the colors its packs define (#19, Slice
// 4): each role's --color-<role> as the element computes it, read once the
// element has mounted, and again when the appearance there changes, an
// attribute of the boundary's or the system's color scheme or contrast that
// a `system` display mode follows. It runs no frame loop of its own: a read
// is one getComputedStyle, and the effect redraws its still frame with what
// it read, or its runtime's next frame does.

/** What the system's color scheme and contrast can change under a `system` display mode. */
const SYSTEM_QUERIES = ['(prefers-color-scheme: dark)', '(prefers-contrast: more)'] as const;

/** `role`'s color where `element` is, as its boundary's packs resolve it, or null outside one. */
export function readBoundaryColor(element: Element, role: ColorRole): string | null {
  const value = getComputedStyle(element).getPropertyValue(`--color-${role}`).trim();
  return value === '' ? null : value;
}

/**
 * The colors `roles` name where `ref`'s element is: null on the server and
 * until the element has mounted, then each role's color, or null for one
 * the element's boundary doesn't define.
 */
export function useBoundaryColors<R extends ColorRole>(
  ref: RefObject<Element | null>,
  roles: readonly R[],
): Readonly<Record<R, string | null>> | null {
  const key = roles.join(' ');
  const [colors, setColors] = useState<Readonly<Record<R, string | null>> | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const wanted = key.split(' ') as R[];
    const read = () => {
      const next = Object.fromEntries(
        wanted.map((role) => [role, readBoundaryColor(element, role)]),
      ) as Record<R, string | null>;
      setColors((previous) =>
        previous && wanted.every((role) => previous[role] === next[role]) ? previous : next,
      );
    };
    read();
    const boundary = element.closest('[data-appearance-boundary]');
    const observer = boundary ? new MutationObserver(read) : null;
    if (boundary) observer!.observe(boundary, { attributes: true });
    const media = SYSTEM_QUERIES.map((query) => window.matchMedia(query));
    for (const list of media) list.addEventListener('change', read);
    return () => {
      observer?.disconnect();
      for (const list of media) list.removeEventListener('change', read);
    };
  }, [ref, key]);
  return colors;
}

/** `color` with `alpha` (0 to 1), for a canvas: a hex color as rgba(), anything else as given. */
export function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1];
  if (!hex) return color;
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** A hex color as three channels from 0 to 1, for a shader, or null for anything else. */
export function channels(color: string | null): [number, number, number] | null {
  const hex = color ? /^#([0-9a-f]{6})$/i.exec(color)?.[1] : undefined;
  if (!hex) return null;
  return [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}
