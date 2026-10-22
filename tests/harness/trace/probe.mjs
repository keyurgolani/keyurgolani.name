// The page side of pnpm test:trace (#6, Slice 1): an init script that runs
// before any of the page's own scripts and counts what keeps the main
// thread busy. Playwright sends installTraceProbe as source text, so it
// closes over nothing: everything it needs is inside it.
//
// - Frame loops. Every requestAnimationFrame callback belongs to a chain: a
//   request made inside a frame callback continues that callback's chain,
//   and any other request starts one. A chain that asks for another frame
//   during the window is a loop, and its rate is its callbacks over the
//   window. Where a loop asks again is its origin.
// - Recurring timers. A setInterval that's still set, and a setTimeout
//   chain, a timeout set inside a timeout callback, that set another during
//   the window.
// - Canvas contexts, by type, from HTMLCanvasElement and OffscreenCanvas
//   getContext, counted once per context.
// - Running infinite animations: CSS animations, transitions, and Web
//   Animations whose end time is infinite, from document.getAnimations()
//   when read.
// - Content Security Policy violations, from securitypolicyviolation events.
// - Long tasks, from a PerformanceObserver.
//
// The harness's own frames and timers use the originals kept on the probe,
// so they never count.

/**
 * Installs the probe on `scope` (the page's window) as
 * `scope.__portfolioTrace`. Installing twice keeps the first.
 *
 * @param {any} scope
 */
export function installTraceProbe(scope) {
  if (scope.__portfolioTrace) return scope.__portfolioTrace;
  const now = () => scope.performance.now();
  const original = {
    requestAnimationFrame: scope.requestAnimationFrame?.bind(scope),
    setTimeout: scope.setTimeout.bind(scope),
    setInterval: scope.setInterval.bind(scope),
    clearInterval: scope.clearInterval.bind(scope),
  };

  // The counting window, from start() until read. Each start() is a new
  // epoch; a chain's window counts belong to the epoch it last touched, so
  // nothing has to visit every chain to reset them.
  let epoch = 0;
  let startedAt = null;
  const inWindow = () => startedAt !== null;
  const windowChains = new Set();
  const touch = (chain) => {
    if (chain.epoch === epoch) return;
    chain.epoch = epoch;
    chain.windowCallbacks = 0;
    chain.windowRearms = 0;
  };
  const counted = (chain) => (chain.epoch === epoch ? chain.windowCallbacks : 0);

  let nextChain = 1;
  const newChain = (kind) => ({
    id: nextChain++,
    kind,
    origin: null,
    epoch: -1,
    callbacks: 0,
    windowCallbacks: 0,
    windowRearms: 0,
  });

  /**
   * The stack frame `depth` frames below the one that made `error`, as
   * URL:line:column when it has one: the page's code, past the probe's own.
   */
  const originOf = (error, depth) => {
    const frame = String(error?.stack ?? '')
      .split('\n')
      [depth + 1]?.trim();
    if (!frame) return null;
    return /((?:https?|file):\/\/[^\s)]+)/.exec(frame)?.[1] ?? frame;
  };

  /**
   * A request made inside `chain`'s own callback: another round of the
   * chain. Called by a wrapper the page called, so the page's frame is two
   * below this one.
   */
  const rearm = (chain) => {
    if (!chain.origin) chain.origin = originOf(new Error('trace origin'), 2);
    if (!inWindow()) return;
    touch(chain);
    chain.windowRearms += 1;
    windowChains.add(chain);
  };
  const ran = (chain) => {
    chain.callbacks += 1;
    if (!inWindow()) return;
    touch(chain);
    chain.windowCallbacks += 1;
  };

  // Frame loops.
  let currentFrame = null;
  const frames = { requests: 0, callbacks: 0, windowRequests: 0, windowCallbacks: 0 };
  if (original.requestAnimationFrame) {
    scope.requestAnimationFrame = function requestAnimationFrame(callback) {
      if (typeof callback !== 'function') return original.requestAnimationFrame(callback);
      frames.requests += 1;
      if (inWindow()) frames.windowRequests += 1;
      const chain = currentFrame ?? newChain('frame');
      if (chain === currentFrame) rearm(chain);
      return original.requestAnimationFrame((time) => {
        frames.callbacks += 1;
        if (inWindow()) frames.windowCallbacks += 1;
        ran(chain);
        const outer = currentFrame;
        currentFrame = chain;
        try {
          return callback(time);
        } finally {
          currentFrame = outer;
        }
      });
    };
  }

  // Timers.
  let currentTimeout = null;
  const timers = {
    timeoutCallbacks: 0,
    intervalCallbacks: 0,
    windowTimeoutCallbacks: 0,
    windowIntervalCallbacks: 0,
  };
  const intervals = new Map();
  scope.setTimeout = function setTimeout(callback, delay, ...args) {
    if (typeof callback !== 'function') return original.setTimeout(callback, delay, ...args);
    const chain = currentTimeout ?? newChain('timeout');
    if (chain === currentTimeout) rearm(chain);
    return original.setTimeout(() => {
      timers.timeoutCallbacks += 1;
      if (inWindow()) timers.windowTimeoutCallbacks += 1;
      ran(chain);
      const outer = currentTimeout;
      currentTimeout = chain;
      try {
        return callback(...args);
      } finally {
        currentTimeout = outer;
      }
    }, delay);
  };
  scope.setInterval = function setInterval(callback, delay, ...args) {
    if (typeof callback !== 'function') return original.setInterval(callback, delay, ...args);
    const chain = newChain('interval');
    chain.origin = originOf(new Error('trace origin'), 1);
    chain.delay = Number(delay) || 0;
    const id = original.setInterval(() => {
      timers.intervalCallbacks += 1;
      if (inWindow()) timers.windowIntervalCallbacks += 1;
      ran(chain);
      return callback(...args);
    }, delay);
    intervals.set(id, chain);
    return id;
  };
  scope.clearInterval = function clearInterval(id) {
    intervals.delete(id);
    return original.clearInterval(id);
  };

  // Canvas contexts.
  const seenContexts = new WeakSet();
  const canvases = [];
  for (const name of ['HTMLCanvasElement', 'OffscreenCanvas']) {
    const proto = scope[name]?.prototype;
    if (!proto?.getContext) continue;
    const getContext = proto.getContext;
    proto.getContext = function getContextCounted(type, ...rest) {
      const context = getContext.call(this, type, ...rest);
      if (context && typeof context === 'object' && !seenContexts.has(context)) {
        seenContexts.add(context);
        canvases.push({
          type: type === 'experimental-webgl' ? 'webgl' : String(type),
          offscreen: name === 'OffscreenCanvas',
          ref: typeof scope.WeakRef === 'function' ? new scope.WeakRef(this) : null,
        });
      }
      return context;
    };
  }

  // Content Security Policy violations.
  const violations = [];
  scope.document?.addEventListener?.(
    'securitypolicyviolation',
    (event) => {
      violations.push({
        blockedURI: event.blockedURI,
        violatedDirective: event.violatedDirective,
        effectiveDirective: event.effectiveDirective,
        disposition: event.disposition,
        sourceFile: event.sourceFile,
        lineNumber: event.lineNumber,
        sample: event.sample,
      });
    },
    true,
  );

  // Long tasks.
  const longTasks = [];
  const longTasksSupported = Boolean(
    scope.PerformanceObserver?.supportedEntryTypes?.includes?.('longtask'),
  );
  if (longTasksSupported) {
    new scope.PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks.push({
          startTime: entry.startTime,
          duration: entry.duration,
          name: entry.name,
          attribution: (entry.attribution ?? []).map((item) => ({
            containerType: item.containerType,
            containerSrc: item.containerSrc,
            containerName: item.containerName,
          })),
        });
      }
    }).observe({ type: 'longtask', buffered: true });
  }

  /** Running animations whose end time is infinite, described well enough to find. */
  const infiniteAnimations = () => {
    const found = [];
    for (const animation of scope.document?.getAnimations?.() ?? []) {
      if (animation.playState !== 'running') continue;
      const effect = animation.effect;
      if (effect?.getComputedTiming?.().endTime !== Infinity) continue;
      const kind =
        typeof scope.CSSAnimation === 'function' && animation instanceof scope.CSSAnimation
          ? `css ${animation.animationName}`
          : typeof scope.CSSTransition === 'function' && animation instanceof scope.CSSTransition
            ? `transition ${animation.transitionProperty}`
            : 'script';
      const target = effect.target;
      found.push({
        kind,
        target: target
          ? [String(target.tagName ?? 'node').toLowerCase(), ...(target.classList ?? [])].join('.')
          : 'no target',
      });
    }
    return found;
  };

  const probe = {
    original,
    /** Starts the counting window: every window count starts again at 0. */
    start() {
      epoch += 1;
      startedAt = now();
      windowChains.clear();
      frames.windowRequests = 0;
      frames.windowCallbacks = 0;
      timers.windowTimeoutCallbacks = 0;
      timers.windowIntervalCallbacks = 0;
    },
    /** Everything counted so far, with the window's counts up to now. */
    read() {
      const windowMs = startedAt === null ? null : now() - startedAt;
      const rate = (callbacks) =>
        windowMs ? Math.round((callbacks / (windowMs / 1000)) * 10) / 10 : null;
      const loops = (kind) =>
        [...windowChains]
          .filter((chain) => chain.kind === kind && chain.epoch === epoch)
          .map((chain) => ({
            id: chain.id,
            callbacks: counted(chain),
            perSecond: rate(counted(chain)),
            origin: chain.origin,
          }));
      const frameLoops = loops('frame');
      const timeoutChains = loops('timeout');
      const liveIntervals = [...intervals.values()].map((chain) => ({
        id: chain.id,
        delayMs: chain.delay,
        callbacks: counted(chain),
        origin: chain.origin,
      }));
      const contexts = {};
      for (const canvas of canvases) contexts[canvas.type] = (contexts[canvas.type] ?? 0) + 1;
      return {
        windowMs,
        visibility: scope.document?.visibilityState ?? null,
        frames: { ...frames, loops: frameLoops },
        timers: {
          ...timers,
          intervals: liveIntervals,
          timeoutChains,
          recurring: liveIntervals.length + timeoutChains.length,
        },
        canvas: {
          contexts,
          total: canvases.length,
          connected: canvases.filter(
            (canvas) => !canvas.offscreen && canvas.ref?.deref?.()?.isConnected,
          ).length,
          offscreen: canvases.filter((canvas) => canvas.offscreen).length,
        },
        animations: { infinite: infiniteAnimations() },
        csp: violations.slice(),
        longTasks: { supported: longTasksSupported, entries: longTasks.slice() },
      };
    },
  };
  scope.__portfolioTrace = probe;
  return probe;
}
