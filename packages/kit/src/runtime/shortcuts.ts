// The document key binding's runtime (K-4 (d), the review's H1, M1, and L5): what
// the host's listener, the visitor's Single-key shortcuts toggle, and a
// variant's palette share. A variant declares the binding in its manifest
// and subscribes to its action with useDocumentAction(); it never touches the
// document or storage. The host renders <DocumentKeyBinding>, which listens
// on the document once, however many times it mounts, and dispatches the
// action here, and the visitor's choice for `/` lives here beside the motion
// pause (./store): in localStorage, so it lasts, and in memory for the
// page's life where storage throws, as it does in an opaque-origin preview
// frame, so `/` can still be turned off (WCAG 2.1.4).

import type {
  DocumentAction,
  DocumentBinding,
  DocumentKeyEvent,
} from '@portfolio/variant-contract';
import { documentKeyAction, isEditableTarget } from '@portfolio/variant-contract/runtime';

/** Where the visitor's choice lasts: localStorage, `off` while single-key shortcuts are off. */
export const SINGLE_KEY_SHORTCUTS_KEY = 'portfolio.shortcuts.single-key';

/** The site's localStorage, or null where it can't be reached: on the server, or in an opaque-origin frame, whose getter throws. */
function siteStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The visitor's choice this page made, which wins over storage, so it holds where storage can't. */
let chosen: boolean | undefined;
const choiceListeners = new Set<() => void>();

/** Whether the visitor leaves single-key shortcuts on: on unless they turned them off. */
export function singleKeyShortcutsEnabled(): boolean {
  if (chosen !== undefined) return chosen;
  try {
    return siteStorage()?.getItem(SINGLE_KEY_SHORTCUTS_KEY) !== 'off';
  } catch {
    return true;
  }
}

/**
 * Turns single-key shortcuts on or off. It takes effect at once, for the page's life, and
 * returns whether it also persisted: false where storage can't be written.
 */
export function setSingleKeyShortcuts(enabled: boolean): boolean {
  chosen = enabled;
  for (const listener of [...choiceListeners]) listener();
  try {
    const storage = siteStorage();
    if (!storage) return false;
    if (enabled) storage.removeItem(SINGLE_KEY_SHORTCUTS_KEY);
    else storage.setItem(SINGLE_KEY_SHORTCUTS_KEY, 'off');
    return true;
  } catch {
    return false;
  }
}

/** Forgets this page's choice, so storage decides again: for tests, which run many pages in one. */
export function forgetSingleKeyChoice(): void {
  chosen = undefined;
}

/** Tells `listener` each time the visitor's choice changes. */
export function subscribeSingleKeyShortcuts(listener: () => void): () => void {
  choiceListeners.add(listener);
  return () => void choiceListeners.delete(listener);
}

/** Each action's handlers, newest last. */
const handlers = new Map<DocumentAction, (() => void)[]>();

/** Runs `handler` when the document binding's `action` fires, until the returned function stops it. */
export function onDocumentAction(action: DocumentAction, handler: () => void): () => void {
  const list = handlers.get(action) ?? [];
  list.push(handler);
  handlers.set(action, list);
  return () => {
    const at = list.indexOf(handler);
    if (at !== -1) list.splice(at, 1);
  };
}

/** Runs the newest handler of `action`, so one palette opens, and says whether one ran. */
export function dispatchDocumentAction(action: DocumentAction): boolean {
  const handler = handlers.get(action)?.at(-1);
  if (!handler) return false;
  handler();
  return true;
}

/**
 * Whether this browser's platform takes Cmd as `mod`: macOS and iOS, iPadOS's MacIntel among
 * them, where either navigator.platform or navigator.userAgentData says so. In a browser the two
 * agree; where a user agent is emulated, as Playwright's is, userAgentData follows the emulated
 * agent and navigator.platform the machine whose keyboard the visitor has.
 */
export function applePlatform(): boolean {
  try {
    const navigator = globalThis.navigator as
      (Navigator & { readonly userAgentData?: { readonly platform?: string } }) | undefined;
    return [navigator?.platform, navigator?.userAgentData?.platform].some((platform) =>
      /Mac|iPhone|iPad|iPod/i.test(platform ?? ''),
    );
  } catch {
    return false;
  }
}

/** The element with focus, through open shadow roots. A closed one stops at its host. */
function deepActiveElement(doc: Document): Element | null {
  let active = doc.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

/** The document's one listener, the binding it listens for, and how many bindings hold it. */
const bound = new WeakMap<object, { holders: number; stop: () => void; binding: string }>();

/**
 * Listens for `binding` on the page's document, and hands its action to the newest handler
 * (`run`, dispatchDocumentAction by default), taking the keydown from the page only when one
 * ran. The visitor's `/` choice, the document's focus, and the platform are read on each key.
 * A second bind on the same document adds no second listener: each returns its own release,
 * and the listener goes with the last one. One binding a document: the first one's keys and
 * action stand, and a second that differs says so in development.
 */
export function bindDocumentKeys(
  binding: DocumentBinding,
  run: (action: DocumentAction) => boolean = dispatchDocumentAction,
): () => void {
  const doc = globalThis.document as Document | undefined;
  if (!doc) return () => {};
  const existing = bound.get(doc);
  const key = JSON.stringify([binding.keys, binding.action]);
  if (existing) {
    existing.holders++;
    if (existing.binding !== key && process.env.NODE_ENV !== 'production') {
      console.warn(
        `[kit runtime] a second document binding, ${key}, was ignored: ${existing.binding} listens already, and a document has one.`,
      );
    }
  } else {
    const listener = (event: KeyboardEvent) => {
      const action = documentKeyAction(event as DocumentKeyEvent, binding, {
        apple: applePlatform(),
        focused: doc.hasFocus(),
        slash: singleKeyShortcutsEnabled(),
      });
      if (action === null || isEditableTarget(deepActiveElement(doc))) return;
      if (run(action)) event.preventDefault();
    };
    doc.addEventListener('keydown', listener);
    bound.set(doc, {
      holders: 1,
      stop: () => doc.removeEventListener('keydown', listener),
      binding: key,
    });
  }
  let released = false;
  return () => {
    const entry = bound.get(doc);
    if (released || !entry) return;
    released = true;
    if (--entry.holders === 0) {
      entry.stop();
      bound.delete(doc);
    }
  };
}
