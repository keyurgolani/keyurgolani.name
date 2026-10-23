// The preview frames on one Studio page, and what each one's `lifecycle`
// message says (#7, Slice 4, item 9): `hidden` while the frame is off screen
// or the tab is in the background, which #6's runtime pauses on, and
// `focused` only on the frame the user last interacted with, while it shows.
// Framework-free, so tests drive it with a stand-in document.

/** What a frame's `lifecycle` message carries. */
export interface Lifecycle {
  readonly state: 'visible' | 'hidden';
  readonly focused: boolean;
}

/** One frame's part in the registry. */
export interface FrameLifecycle {
  /** The frame came on screen, or went off it. */
  setOnScreen(onScreen: boolean): void;
  /** The user interacted with the frame or its controls. */
  used(): void;
  /** What its last `lifecycle` said, which a new channel hears again. */
  readonly current: Lifecycle;
  /** The frame went. */
  unregister(): void;
}

/** The part of a document the registry reads: whether the tab is in the background. */
export interface LifecycleDocument {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface LifecycleRegistry {
  /** Adds a frame, which hears its lifecycle through `send` whenever it changes. */
  register(send: (lifecycle: Lifecycle) => void): FrameLifecycle;
}

interface Entry {
  onScreen: boolean;
  current: Lifecycle;
  readonly send: (lifecycle: Lifecycle) => void;
}

/** The registry for `document`'s frames. */
export function createLifecycleRegistry(document: LifecycleDocument): LifecycleRegistry {
  const entries = new Set<Entry>();
  let lastUsed: Entry | null = null;
  let listening = false;

  const recompute = () => {
    const shown = document.visibilityState === 'visible';
    for (const entry of entries) {
      const state = shown && entry.onScreen ? 'visible' : 'hidden';
      const next: Lifecycle = { state, focused: state === 'visible' && entry === lastUsed };
      if (next.state === entry.current.state && next.focused === entry.current.focused) continue;
      entry.current = next;
      entry.send(next);
    }
  };

  return {
    register(send) {
      if (!listening) {
        document.addEventListener('visibilitychange', recompute);
        listening = true;
      }
      // A frame starts off screen, and hidden, until its observer says otherwise.
      const entry: Entry = { onScreen: false, current: { state: 'hidden', focused: false }, send };
      entries.add(entry);
      return {
        setOnScreen(onScreen) {
          entry.onScreen = onScreen;
          recompute();
        },
        used() {
          if (!entries.has(entry)) return;
          lastUsed = entry;
          recompute();
        },
        get current() {
          return entry.current;
        },
        unregister() {
          entries.delete(entry);
          if (lastUsed === entry) lastUsed = null;
          if (entries.size === 0 && listening) {
            document.removeEventListener('visibilitychange', recompute);
            listening = false;
          }
          recompute();
        },
      };
    },
  };
}

let page: LifecycleRegistry | undefined;

/** The registry for this page's frames, made the first time a frame needs it. */
export function pageLifecycle(): LifecycleRegistry {
  page ??= createLifecycleRegistry(document);
  return page;
}
