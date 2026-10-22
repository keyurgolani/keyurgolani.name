'use client';

// The client half of a presentation boundary (#19, Slice 3, item 1): the
// boundary's element and the context the 'use client' primitives read
// through useBoundary() and useBoundaryId(). PresentationBoundary, which
// server code renders, passes it plain data only.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { lowerMotion, type BoundaryAttributes, type BoundaryKind } from '../boundary';
import { prefixedId, type BoundaryIds } from '../ids';
import type { Motion } from '../resolve';

/** What a boundary tells the primitives inside it. */
export interface BoundaryContextValue {
  /** The nearest boundary's kind, or `none` outside every boundary. */
  readonly kind: BoundaryKind | 'none';
  /** Inside a plate: render markup that needs no JavaScript, attach no listener, and render landmarks as plain elements. */
  readonly plate: boolean;
  /** What every id inside starts with: '' in a document boundary. */
  readonly prefix: string;
  /** The id of the variant's one main. */
  readonly main: string;
  /** The motion that renders now. */
  readonly motion: Motion;
  /**
   * Lowers the boundary's motion, as #6's pause does with `static`; null
   * returns it to the resolved motion. It can't raise motion above what
   * resolveAppearance() gave, and a plate stays static.
   */
  readonly setMotion: (motion: Motion | null) => void;
}

const NO_BOUNDARY: BoundaryContextValue = Object.freeze({
  kind: 'none',
  plate: false,
  prefix: '',
  main: 'main',
  motion: 'full',
  setMotion: () => {},
});

const BoundaryContext = createContext<BoundaryContextValue | null>(null);

export interface BoundaryRootProps {
  readonly kind: BoundaryKind;
  readonly ids: BoundaryIds;
  readonly attributes: BoundaryAttributes;
  readonly children?: ReactNode;
}

/**
 * The boundary's element, with its attributes, and its context. A plate is
 * inert. Nesting a plate inside a plate throws, and so does a document
 * boundary anywhere but outermost.
 */
export function BoundaryRoot({ kind, ids, attributes, children }: BoundaryRootProps) {
  const parent = useContext(BoundaryContext);
  if (parent && kind === 'document') {
    throw new Error(
      `A document boundary renders outermost, and this one is inside a ${parent.kind} boundary. A page has one document boundary; a preview inside it is a plate.`,
    );
  }
  if (parent?.plate && kind === 'plate') {
    throw new Error(
      'A plate renders inside another plate. Plates sit side by side in a page or in its document boundary, never in each other.',
    );
  }
  const [lowered, setLowered] = useState<Motion | null>(null);
  const plate = kind === 'plate';
  const resolved = (attributes['data-motion'] ?? 'full') as Motion;
  const motion = plate ? 'static' : lowerMotion(resolved, lowered);
  const setMotion = useCallback(
    (next: Motion | null) => {
      if (!plate) setLowered(next);
    },
    [plate],
  );
  const value = useMemo<BoundaryContextValue>(
    () => ({ kind, plate, prefix: ids.prefix, main: ids.main, motion, setMotion }),
    [kind, plate, ids.prefix, ids.main, motion, setMotion],
  );
  return (
    <div {...attributes} data-motion={motion} inert={plate || undefined}>
      <BoundaryContext.Provider value={value}>{children}</BoundaryContext.Provider>
    </div>
  );
}

/** The nearest boundary, for a 'use client' primitive. Outside every boundary, a document's defaults with kind `none`. */
export function useBoundary(): BoundaryContextValue {
  return useContext(BoundaryContext) ?? NO_BOUNDARY;
}

/** `local` with the nearest boundary's id prefix, for a 'use client' primitive: the client's boundaryId(). */
export function useBoundaryId(local: string): string {
  return prefixedId(useBoundary().prefix, local);
}

const subscribe = () => () => {};

/**
 * False on the server and while the browser hydrates the server's markup,
 * then true: when a primitive may swap its no-JavaScript markup for its
 * interactive one without a hydration mismatch. A primitive mounted after
 * hydration, as on a client navigation, is interactive from its first render.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
