// How the visitor control saves a choice with JavaScript (#19, Slice 3,
// item 3): load the stylesheets the choice needs, wait until they've
// loaded, then POST the form's values as JSON to the preference route
// (Slice 4's POST /api/appearance). The whole save gets ten seconds; past
// them, or on any failure, it reports so and the control changes nothing.
// A newer save aborts an older one, which then reports `superseded`. The
// browser work goes through `SaveDeps`, so tests run it with fakes.

/** What one save sends: the form's values by query key, or a reset. */
export type SaveBody = Readonly<Record<string, string>> | { readonly reset: true };

export interface SaveRequest {
  /** Where it posts. */
  readonly action: string;
  readonly body: SaveBody;
  /** The stylesheets the choice needs, loaded before anything is sent. */
  readonly stylesheets: readonly string[];
  /** Aborted when a newer save starts. */
  readonly signal?: AbortSignal;
  /** How long the save may take, in milliseconds. */
  readonly timeout?: number;
}

export interface SaveDeps {
  /** Loads a stylesheet without applying it; resolves once it has loaded, rejects if it can't. */
  readonly preload: (href: string, signal: AbortSignal) => Promise<void>;
  /** POSTs `body`, already JSON, and says whether the route took it. */
  readonly post: (
    url: string,
    body: string,
    signal: AbortSignal,
  ) => Promise<{ readonly ok: boolean }>;
  readonly setTimeout: (run: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

export type SaveOutcome = 'saved' | 'failed' | 'timed-out' | 'superseded';

/** Ten seconds, after which a save that hasn't finished counts as failed. */
export const SAVE_TIMEOUT = 10_000;

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
    await Promise.race([
      Promise.all(request.stylesheets.map((href) => deps.preload(href, controller.signal))),
      aborted,
    ]);
    const response = await Promise.race([
      deps.post(request.action, JSON.stringify(request.body), controller.signal),
      aborted,
    ]);
    return response.ok ? 'saved' : 'failed';
  } catch {
    if (request.signal?.aborted) return 'superseded';
    return controller.signal.reason instanceof SaveTimeout ? 'timed-out' : 'failed';
  } finally {
    deps.clearTimeout(timer);
    request.signal?.removeEventListener('abort', supersede);
  }
}

/**
 * Loads a stylesheet through <link rel="preload" as="style">, which fetches
 * it without applying it, and resolves on the link's load event. Once the
 * page renders the new selection, its stylesheet link finds the file
 * already loaded.
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

/** POSTs JSON to the same origin, following no redirect. */
export async function postJson(
  url: string,
  body: string,
  signal: AbortSignal,
): Promise<{ readonly ok: boolean }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal,
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
  });
  return { ok: response.ok };
}

/** The browser's own: what VisitorAppearance saves with unless a test gives it others. */
export const BROWSER_SAVE: SaveDeps = {
  preload: preloadStylesheet,
  post: postJson,
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};
