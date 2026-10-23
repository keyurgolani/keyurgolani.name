// Two compared frames, linked (#7, item 7): when the owner turns linking on,
// a frame's reader scrolling, or moving to another of its pages, moves the
// other frame the same way, over Slice 3's `scrolled` and `navigated`. Off,
// which is where it starts, nothing one frame says reaches the other. A
// frame's word is its claim: a route is one the protocol already read, and
// the other frame's agent loads it under its own grant alone, so linking
// gives a frame no more than its reader's own clicks would.
//
// A move Studio passes on comes back as the other frame's `navigated`, which
// names the route that frame is already on, so it goes no further. A
// scroll-to the agent makes it never reports as the reader's.

/** Which of the two frames. */
export type FrameSide = 0 | 1;

/** Where a reader is in a frame: a section, and how far through it. */
export interface ScrollPosition {
  readonly anchor: string;
  readonly progress: number;
}

export interface FrameLink {
  /** Whether the frames are linked. */
  readonly linked: boolean;
  setLinked(linked: boolean): void;
  /** `side` loaded `route`, its `ready`: noted, and passed on to no frame. */
  arrived(side: FrameSide, route: string): void;
  /**
   * `side` moved to `route`, its `navigated`: the route the other frame is to
   * load, or null. Where the other frame is changes only once it takes the
   * move, moved(), or says where it is itself.
   */
  navigated(side: FrameSide, route: string): string | null;
  /** `side` took a move to `route` that navigated() passed it: it's on its way there. */
  moved(side: FrameSide, route: string): void;
  /** `side`'s reader scrolled to `position`: where the other frame scrolls, or null. */
  scrolled(side: FrameSide, position: ScrollPosition): ScrollPosition | null;
}

/** A link between two frames, off until the owner turns it on. */
export function createFrameLink(): FrameLink {
  let linked = false;
  const routes: [string | null, string | null] = [null, null];
  return {
    get linked() {
      return linked;
    },
    setLinked(next) {
      linked = next;
    },
    arrived(side, route) {
      routes[side] = route;
    },
    navigated(side, route) {
      routes[side] = route;
      const other: FrameSide = side === 0 ? 1 : 0;
      if (!linked || routes[other] === route) return null;
      return route;
    },
    moved(side, route) {
      routes[side] = route;
    },
    scrolled(_side, position) {
      return linked ? { anchor: position.anchor, progress: position.progress } : null;
    },
  };
}
