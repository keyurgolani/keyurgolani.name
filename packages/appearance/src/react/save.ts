// How the visitor control saves a choice with JavaScript (#19, Slice 3,
// item 3): POST the form's values as JSON to the preference route (Slice
// 4's POST /api/appearance), then preload the stylesheets its answer names,
// the new selection's packs, so once the host refreshes, the page renders
// with them already loaded. The page itself names no stylesheet it doesn't
// render (#6's purity check), so the URLs come only from the route's answer,
// and only same-origin pack paths are taken from it. A preload that fails
// still counts as saved: the refresh loads what it needs. The post gets ten
// seconds; past them, or on any failure, it reports so and the control
// changes nothing. The preloads get what's left of the ten. A newer save
// aborts an older one, which then reports `superseded`. The browser work
// goes through `SaveDeps`, so tests run it with fakes.

/** What one save sends: the form's values by query key, or a reset. */
export type SaveBody = Readonly<Record<string, string>> | { readonly reset: true };

export interface SaveRequest {
  /** Where it posts. */
  readonly action: string;
  readonly body: SaveBody;
  /** Aborted when a newer save starts. */
  readonly signal?: AbortSignal;
  /** How long the save may take, in milliseconds. */
  readonly timeout?: number;
}

/** What the route answered: whether it took the save, and the stylesheets the new selection needs. */
export interface PostResult {
  readonly ok: boolean;
  readonly stylesheets?: readonly string[];
}

export interface SaveDeps {
  /** POSTs `body`, already JSON, and says whether the route took it, with the stylesheets it named. */
  readonly post: (url: string, body: string, signal: AbortSignal) => Promise<PostResult>;
  /** Loads a stylesheet without applying it; resolves once it has loaded, rejects if it can't. */
  readonly preload: (href: string, signal: AbortSignal) => Promise<void>;
  readonly setTimeout: (run: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

export type SaveOutcome = 'saved' | 'failed' | 'timed-out' | 'superseded';

/** Ten seconds, after which a save that hasn't finished counts as failed. */
export const SAVE_TIMEOUT = 10_000;

/** The stylesheet URLs a save takes from the route's answer: this origin's compiled pack files. */
const PACK_PATH = /^\/_portfolio\/pack\/[a-z0-9][a-z0-9-]*\.[0-9a-f]{12}\.css$/;

/** The answer's stylesheets that are pack paths on this origin, each once, and nothing else. */
export function packStylesheets(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((href): href is string => typeof href === 'string' && PACK_PATH.test(href)),
    ),
  ];
}

class SaveTimeout extends Error {
  constructor() {
    super("The appearance preference didn't save in time.");
  }
}

export async function saveAppearance(request: SaveRequest, deps: SaveDeps): Promise<SaveOutcome> {
  if (request.signal?.aborted) return 'superseded';
  const controller = new AbortController();
  const supersede = () => controller.abort(request.signal?.reason);
  request.signal?.addEventListener('abort', supersede, { once: true });
  const timer = deps.setTimeout(
    () => controller.abort(new SaveTimeout()),
    request.timeout ?? SAVE_TIMEOUT,
  );
  // Whichever settles first: the work, or the abort that ends it.
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
      once: true,
    });
  });
  aborted.catch(() => {});
  try {
    let response: PostResult;
    try {
      response = await Promise.race([
        deps.post(request.action, JSON.stringify(request.body), controller.signal),
        aborted,
      ]);
    } catch {
      if (request.signal?.aborted) return 'superseded';
      return controller.signal.reason instanceof SaveTimeout ? 'timed-out' : 'failed';
    }
    if (!response.ok) return 'failed';
    // Saved. A preload that fails, or runs out the time, still refreshes.
    try {
      await Promise.race([
        Promise.all(
          packStylesheets(response.stylesheets).map((href) =>
            deps.preload(href, controller.signal),
          ),
        ),
        aborted,
      ]);
    } catch {
      if (request.signal?.aborted) return 'superseded';
    }
    return 'saved';
  } finally {
    deps.clearTimeout(timer);
    request.signal?.removeEventListener('abort', supersede);
  }
}

/** The CSP nonce the page's own elements carry, which a preload link it adds needs to load. */
function pageNonce(): string | undefined {
  const carrier = document.querySelector<HTMLElement>('link[nonce], style[nonce], script[nonce]');
  return carrier?.nonce || undefined;
}

/**
 * Loads a stylesheet through <link rel="preload" as="style">, which fetches
 * it without applying it, and resolves on the link's load event. Once the
 * page renders the new selection, its stylesheet link finds the file
 * already loaded. The link carries the page's CSP nonce, where the page has
 * one, as the page's own stylesheet links do.
 */
export function preloadStylesheet(href: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'style';
    const nonce = pageNonce();
    if (nonce) link.nonce = nonce;
    link.href = href;
    const abort = () => {
      link.remove();
      reject(signal.reason);
    };
    link.addEventListener(
      'load',
      () => {
        signal.removeEventListener('abort', abort);
        resolve();
      },
      { once: true },
    );
    link.addEventListener(
      'error',
      () => {
        signal.removeEventListener('abort', abort);
        link.remove();
        reject(new Error(`${href} didn't load.`));
      },
      { once: true },
    );
    signal.addEventListener('abort', abort, { once: true });
    document.head.append(link);
  });
}

/** POSTs JSON to the same origin, following no redirect, and reads the stylesheets the answer names. */
export async function postJson(
  url: string,
  body: string,
  signal: AbortSignal,
): Promise<PostResult> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal,
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
  });
  if (!response.ok) return { ok: false };
  let answer: unknown = null;
  try {
    answer = await response.json();
  } catch {
    answer = null;
  }
  const stylesheets =
    answer && typeof answer === 'object' ? (answer as { stylesheets?: unknown }).stylesheets : [];
  return { ok: true, stylesheets: packStylesheets(stylesheets) };
}

/** The browser's own: what VisitorAppearance saves with unless a test gives it others. */
export const BROWSER_SAVE: SaveDeps = {
  post: postJson,
  preload: preloadStylesheet,
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};
