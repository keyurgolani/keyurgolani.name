// Demo Studio's browser storage (#9, design note section 2): every key under
// `portfolio-demo:`, never Owner Studio's `portfolio-studio:` keys or the
// visitor's appearance cookie. The selection lives in localStorage, so it
// outlasts the tab; the working copy, which #9's import fills, in
// sessionStorage, so it never does. Where a store can't be reached, or a
// write fails because it's full, state stays in memory for the page, and
// Studio says so. Framework-free, so a test drives it with fake stores.

/** The prefix of every key Demo Studio writes. */
export const DEMO_PREFIX = 'portfolio-demo:';

/** The selection, in localStorage. */
export const SELECTION_KEY = `${DEMO_PREFIX}v1:selection`;

/** The working copy, in sessionStorage, which the local source (#9's import) writes first. */
export const WORKING_KEY = `${DEMO_PREFIX}v1:working`;

/** What Studio says while state can't outlast the page. */
export const MEMORY_ONLY_NOTICE = 'Changes will not survive a reload.';

/** The part of the Web Storage interface Demo Studio uses. */
export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DemoStore {
  read(key: string): string | null;
  write(key: string, value: string): void;
  /**
   * False while a write sits in memory because its own store refused it, or
   * when the selection's store can't be reached at all: a reload loses it.
   */
  persistent(): boolean;
  /** Deletes every `portfolio-demo:` key from both stores, and from memory. */
  clearAll(): void;
}

/** The browser's store of `which`, or null where reaching it throws, as in an opaque or locked-down document. */
export function browserStorage(which: 'local' | 'session'): StorageLike | null {
  try {
    const store = which === 'local' ? window.localStorage : window.sessionStorage;
    // Some browsers hand out a store that throws on first use.
    store.getItem(SELECTION_KEY);
    return store;
  } catch {
    return null;
  }
}

/** The store each key belongs in: the working copy in the tab's, everything else in the browser's. */
const placeOf = (key: string): 'local' | 'session' => (key === WORKING_KEY ? 'session' : 'local');

/**
 * Demo Studio's store over `local` and `session`, either of which may be
 * null. A key outside `portfolio-demo:` is refused, so no caller can write
 * another surface's key through it.
 */
export function demoStore(local: StorageLike | null, session: StorageLike | null): DemoStore {
  const stores = { local, session };
  // What a write couldn't put in its own store, which a reload loses.
  const memory = new Map<string, string>();
  const own = (key: string) => {
    if (!key.startsWith(DEMO_PREFIX))
      throw new Error(`Demo Studio writes only ${DEMO_PREFIX} keys.`);
  };
  return {
    read(key) {
      own(key);
      if (memory.has(key)) return memory.get(key)!;
      try {
        return stores[placeOf(key)]?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    write(key, value) {
      own(key);
      const store = stores[placeOf(key)];
      if (store) {
        try {
          store.setItem(key, value);
          memory.delete(key);
          return;
        } catch {
          // Full, or refused: the value stays in memory below.
        }
      }
      memory.set(key, value);
    },
    // By the store each write used: true while every key written sits in its own store, and the
    // selection's store can be reached, so blocking only sessionStorage leaves the selection kept.
    persistent: () => local !== null && memory.size === 0,
    clearAll() {
      memory.clear();
      for (const store of [local, session]) {
        if (!store) continue;
        try {
          const keys: string[] = [];
          for (let index = 0; index < store.length; index++) {
            const key = store.key(index);
            if (key?.startsWith(DEMO_PREFIX)) keys.push(key);
          }
          for (const key of keys) store.removeItem(key);
        } catch {
          // A store that throws holds nothing this page can clear.
        }
      }
    },
  };
}
