// The page side of pnpm test:trace (#6, Slice 1): an init script that runs
// in every frame before any of the page's own scripts and counts what keeps
// the main thread busy. Playwright sends installTraceProbe as source text,
// so it closes over nothing: everything it needs is inside it.
//
// Frame callbacks and timeouts are grouped by their site: the place in the
// page's code that asked for them, the frame below the probe's wrapper. A
// site recurs when it asks again after one of its own callbacks ran during
// the window, whatever the shape: a callback that asks for the next frame,
// an await on a promise a frame or a timeout resolves, or a frame asked for
// from a timeout and the timeout from a frame. A recurring site is
// sustained when it ran in both halves of the window, so a transition that
// finishes early in it is no loop. Its rate is its callbacks over the window.
//
// - Frame loops: requestAnimationFrame sites that recur and are sustained.
// - Recurring timers: setInterval timers still set, which clearInterval or
//   clearTimeout ends (they share one list), and setTimeout sites that recur.
// - Canvas contexts, by type, from HTMLCanvasElement and OffscreenCanvas
//   getContext, counted once per context, and the WebGL contexts asked for
//   that came back null.
// - Running infinite animations: CSS animations, transitions, and Web
//   Animations whose end time is infinite, from document.getAnimations().
// - Content Security Policy violations, from securitypolicyviolation events.
// - Long tasks, from a PerformanceObserver.
//
// The harness's own frames and timers use the originals kept on the probe,
// so they never count.

/**
 * Installs the probe on `scope` (the frame's window) as
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
    clearTimeout: scope.clearTimeout.bind(scope),
    setInterval: scope.setInterval.bind(scope),
    clearInterval: scope.clearInterval.bind(scope),
  };

  // The counting window, from start() until read. Each start() is a new
  // epoch; a site's window counts belong to the epoch it last touched, so
  // nothing has to visit every site to reset them.
  let epoch = 0;
  let startedAt = null;
  const inWindow = () => startedAt !== null;
  const sinceStart = () => now() - startedAt;

  /**
   * The page's frame that called the wrapper that called this: the stack's
   * fourth line, after the message, this function, and the wrapper. As
   * URL:line:column when it has one.
   */
  const ErrorType = scope.Error ?? Error;
  const callerSite = () => {
    // Only the frames it reads, so a call costs little even under throttling.
    const limit = ErrorType.stackTraceLimit;
    ErrorType.stackTraceLimit = 4;
    const stack = String(new ErrorType('site').stack ?? '');
    ErrorType.stackTraceLimit = limit;
    const frame = stack.split('\n')[3]?.trim();
    if (!frame) return 'unknown';
    return /((?:https?|file):\/\/[^\s)]+)/.exec(frame)?.[1] ?? frame;
  };

  // A site's `concurrent` is how many of its rounds ran at once during the
  // window: the most callbacks it ran in one frame, or the most timeouts it
  // had pending at once. Loops behind one shared helper count as many, so a
  // count never comes out low.
  const newEntry = (kind, site) => ({
    kind,
    site,
    epoch: -1,
    callbacks: 0,
    rearms: 0,
    firstAt: null,
    lastAt: null,
    concurrent: 0,
    frameTime: null,
    inFrame: 0,
    pending: 0,
    total: 0,
  });
  const sites = new Map();
  const siteFor = (kind, site) => {
    const key = `${kind} ${site}`;
    if (!sites.has(key)) sites.set(key, newEntry(kind, site));
    return sites.get(key);
  };
  const touch = (entry) => {
    if (entry.epoch === epoch) return;
    entry.epoch = epoch;
    entry.callbacks = 0;
    entry.rearms = 0;
    entry.firstAt = null;
    entry.lastAt = null;
    entry.concurrent = 0;
    entry.frameTime = null;
    entry.inFrame = 0;
  };
  /** Frame callbacks given the same timestamp ran in the same frame. */
  const inFrame = (entry, time) => {
    if (!inWindow()) return;
    if (entry.frameTime !== time) {
      entry.frameTime = time;
      entry.inFrame = 0;
    }
    entry.inFrame += 1;
    entry.concurrent = Math.max(entry.concurrent, entry.inFrame);
  };
  /** A site asked again: a round of it, once one of its callbacks has run in the window. */
  const asked = (entry) => {
    if (!inWindow()) return;
    touch(entry);
    if (entry.callbacks > 0) entry.rearms += 1;
  };
  const ran = (entry) => {
    entry.total += 1;
    if (!inWindow()) return;
    touch(entry);
    entry.callbacks += 1;
    const at = sinceStart();
    if (entry.firstAt === null) entry.firstAt = at;
    entry.lastAt = at;
  };

  // Frames.
  const frames = { requests: 0, callbacks: 0, windowRequests: 0, windowCallbacks: 0 };
  if (original.requestAnimationFrame) {
    scope.requestAnimationFrame = function requestAnimationFrame(callback) {
      if (typeof callback !== 'function') return original.requestAnimationFrame(callback);
      const entry = siteFor('frame', callerSite());
      frames.requests += 1;
      if (inWindow()) frames.windowRequests += 1;
      asked(entry);
      return original.requestAnimationFrame((time) => {
        frames.callbacks += 1;
        if (inWindow()) frames.windowCallbacks += 1;
        ran(entry);
        inFrame(entry, time);
        return callback(time);
      });
    };
  }

  // Timers. setTimeout and setInterval share one list of IDs, which either
  // clear function ends.
  const timers = {
    timeoutCallbacks: 0,
    intervalCallbacks: 0,
    windowTimeoutCallbacks: 0,
    windowIntervalCallbacks: 0,
  };
  const intervals = new Map();
  const pendingTimeouts = new Map();
  const settled = (id) => {
    const entry = pendingTimeouts.get(id);
    if (!entry) return;
    pendingTimeouts.delete(id);
    entry.pending -= 1;
  };
  scope.setTimeout = function setTimeout(callback, delay, ...args) {
    if (typeof callback !== 'function') return original.setTimeout(callback, delay, ...args);
    const entry = siteFor('timeout', callerSite());
    asked(entry);
    entry.pending += 1;
    if (inWindow()) entry.concurrent = Math.max(entry.concurrent, entry.pending);
    const id = original.setTimeout(() => {
      settled(id);
      timers.timeoutCallbacks += 1;
      if (inWindow()) timers.windowTimeoutCallbacks += 1;
      ran(entry);
      return callback(...args);
    }, delay);
    pendingTimeouts.set(id, entry);
    return id;
  };
  scope.setInterval = function setInterval(callback, delay, ...args) {
    if (typeof callback !== 'function') return original.setInterval(callback, delay, ...args);
    // Each interval is its own timer, wherever it was set.
    const entry = { ...newEntry('interval', callerSite()), delay: Number(delay) || 0 };
    const id = original.setInterval(() => {
      timers.intervalCallbacks += 1;
      if (inWindow()) timers.windowIntervalCallbacks += 1;
      ran(entry);
      return callback(...args);
    }, delay);
    intervals.set(id, entry);
    return id;
  };
  scope.clearInterval = function clearInterval(id) {
    intervals.delete(id);
    settled(id);
    return original.clearInterval(id);
  };
  scope.clearTimeout = function clearTimeout(id) {
    intervals.delete(id);
    settled(id);
    return original.clearTimeout(id);
  };

  // Canvas contexts.
  const seenContexts = new WeakSet();
  const canvases = [];
  const nullContexts = {};
  const typeName = (type) => (type === 'experimental-webgl' ? 'webgl' : String(type));
  for (const name of ['HTMLCanvasElement', 'OffscreenCanvas']) {
    const proto = scope[name]?.prototype;
    if (!proto?.getContext) continue;
    const getContext = proto.getContext;
    proto.getContext = function getContextCounted(type, ...rest) {
      const context = getContext.call(this, type, ...rest);
      if (context === null) {
        nullContexts[typeName(type)] = (nullContexts[typeName(type)] ?? 0) + 1;
      } else if (context && typeof context === 'object' && !seenContexts.has(context)) {
        seenContexts.add(context);
        canvases.push({
          type: typeName(type),
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
      const half = windowMs === null ? null : windowMs / 2;
      const describe = (entry) => ({
        site: entry.site,
        callbacks: entry.callbacks,
        perSecond: rate(entry.callbacks),
        firstAtMs: entry.firstAt === null ? null : Math.round(entry.firstAt),
        lastAtMs: entry.lastAt === null ? null : Math.round(entry.lastAt),
        sustained:
          half !== null && entry.firstAt !== null && entry.firstAt < half && entry.lastAt >= half,
        concurrent: Math.max(1, entry.concurrent),
      });
      const recurring = (kind) =>
        [...sites.values()]
          .filter((entry) => entry.kind === kind && entry.epoch === epoch && entry.rearms > 0)
          .map(describe);
      const count = (list) => list.reduce((total, site) => total + site.concurrent, 0);
      const frameSites = recurring('frame');
      const loops = frameSites.filter((site) => site.sustained);
      const timeoutSites = recurring('timeout');
      // Each interval is one timer: it has no concurrency of its own.
      const liveIntervals = [...intervals.values()].map((entry) => {
        const described = describe(
          entry.epoch === epoch ? entry : newEntry(entry.kind, entry.site),
        );
        delete described.concurrent;
        return { ...described, delayMs: entry.delay };
      });
      const contexts = {};
      for (const canvas of canvases) contexts[canvas.type] = (contexts[canvas.type] ?? 0) + 1;
      return {
        url: String(scope.location?.href ?? ''),
        windowMs,
        visibility: scope.document?.visibilityState ?? null,
        frames: {
          ...frames,
          loops,
          loopCount: count(loops),
          transient: frameSites.filter((site) => !site.sustained),
        },
        timers: {
          ...timers,
          intervals: liveIntervals,
          timeouts: timeoutSites,
          recurring: liveIntervals.length + count(timeoutSites),
        },
        canvas: {
          contexts,
          total: canvases.length,
          connected: canvases.filter(
            (canvas) => !canvas.offscreen && canvas.ref?.deref?.()?.isConnected,
          ).length,
          offscreen: canvases.filter((canvas) => canvas.offscreen).length,
          nullContexts: { ...nullContexts },
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
