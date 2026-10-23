// The preview scheduler (#6, item 5): which catalog plates hold a live #7
// preview frame, for #8 and #9 to adopt. Framework-free, so its unit tests
// drive it with synthetic plates.
//
// Every plate shows its committed still first. A plate goes live only when
// the visitor asks for its preview, or when it's within a viewport of being
// on screen, a prefetch. At most MAX_LIVE plates are live at once, and at
// most MAX_HEAVY of them `heavy`, DESIGN.md's two live previews: a request
// takes a slot from a prefetch first, then from the oldest request. A plate
// that leaves the viewport's neighbourhood loses a prefetch at once; a
// requested one stays live, and its frame goes `hidden` through #7's
// lifecycle (PreviewSurface's own), which pauses #6's runtime inside it.
//
// The scheduler only says which plates are live. The plate mounts its
// PreviewSurface while it's live and unmounts it, back to the still, once
// it isn't, so a frame, its grant, and its channel exist only for a live
// plate.

export type PlateTier = 'light' | 'medium' | 'heavy';

/** At most this many live frames at once. */
export const MAX_LIVE = 2;
/** At most this many of them heavy. */
export const MAX_HEAVY = 1;

interface Plate {
  readonly id: string;
  readonly tier: PlateTier;
  /** Its place on the page, for prefetch order. */
  readonly order: number;
  near: boolean;
  /** When the visitor last asked for its preview, or 0. */
  requested: number;
}

export interface PreviewScheduler {
  /** Adds a plate, still only. Returns the call that removes it. */
  register(id: string, tier: PlateTier): () => void;
  /** The plate came within a viewport of the screen, or went further. */
  setNear(id: string, near: boolean): void;
  /** The visitor asked for the plate's live preview. */
  request(id: string): void;
  /** The visitor put the plate back to its still. */
  release(id: string): void;
  /** Whether the plate holds a live frame now. */
  isLive(id: string): boolean;
  /** Why the plate is live: the visitor asked, or it's prefetched. Null when it isn't. */
  liveFor(id: string): 'request' | 'prefetch' | null;
  /** Calls `listener` whenever the live set changes. Returns the call that stops it. */
  subscribe(listener: () => void): () => void;
}

/** The plates that are live, and why, from every plate's state. */
export function schedule(
  plates: readonly Pick<Plate, 'id' | 'tier' | 'order' | 'near' | 'requested'>[],
): Map<string, 'request' | 'prefetch'> {
  const live = new Map<string, 'request' | 'prefetch'>();
  let heavy = 0;
  const admit = (plate: (typeof plates)[number], why: 'request' | 'prefetch') => {
    if (live.size >= MAX_LIVE || live.has(plate.id)) return;
    if (plate.tier === 'heavy') {
      if (heavy >= MAX_HEAVY) return;
      heavy++;
    }
    live.set(plate.id, why);
  };
  // The latest requests first, so a new one displaces the oldest.
  for (const plate of [...plates]
    .filter(({ requested }) => requested > 0)
    .sort((a, b) => b.requested - a.requested)) {
    admit(plate, 'request');
  }
  // Then prefetches, in page order, into what's left.
  for (const plate of [...plates]
    .filter(({ near, requested }) => near && requested === 0)
    .sort((a, b) => a.order - b.order)) {
    admit(plate, 'prefetch');
  }
  return live;
}

export function createPreviewScheduler(): PreviewScheduler {
  const plates = new Map<string, Plate>();
  const listeners = new Set<() => void>();
  let live = new Map<string, 'request' | 'prefetch'>();
  let order = 0;
  let clock = 0;

  const recompute = () => {
    const next = schedule([...plates.values()]);
    const same = next.size === live.size && [...next].every(([id, why]) => live.get(id) === why);
    live = next;
    if (!same) for (const listener of [...listeners]) listener();
  };

  return {
    register(id, tier) {
      plates.set(id, { id, tier, order: order++, near: false, requested: 0 });
      recompute();
      return () => {
        plates.delete(id);
        recompute();
      };
    },
    setNear(id, near) {
      const plate = plates.get(id);
      if (!plate || plate.near === near) return;
      plate.near = near;
      recompute();
    },
    request(id) {
      const plate = plates.get(id);
      if (!plate) return;
      plate.requested = ++clock;
      recompute();
    },
    release(id) {
      const plate = plates.get(id);
      if (!plate || plate.requested === 0) return;
      plate.requested = 0;
      recompute();
    },
    isLive: (id) => live.has(id),
    liveFor: (id) => live.get(id) ?? null,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
