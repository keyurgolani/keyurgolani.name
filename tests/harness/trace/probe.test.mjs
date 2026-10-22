import test from 'node:test';
import assert from 'node:assert/strict';
import { installTraceProbe } from './probe.mjs';

/** Lets every promise continuation that's ready run, as a browser does between tasks. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * A window with a clock, frames, and timers the test drives by hand:
 * frame() runs every frame callback asked for so far, advance(ms) runs the
 * timers that fall due, in order, and run(ms) does both every 16 ms with
 * continuations let run between, as a page sees time pass.
 */
function fakeWindow() {
  let time = 0;
  let nextId = 1;
  let frames = new Map();
  const timers = new Map();
  const listeners = {};
  const animations = [];
  const observers = [];
  // Two unrelated classes, as HTMLCanvasElement and OffscreenCanvas are.
  const canvasClass = () =>
    class {
      constructor() {
        this.isConnected = true;
        this.contexts = {};
      }
      getContext(type) {
        if (type === 'none' || type === 'webgl2') return null;
        this.contexts[type] ??= { type };
        return this.contexts[type];
      }
    };
  const FakeCanvas = canvasClass();
  const FakeOffscreenCanvas = canvasClass();
  class FakeObserver {
    static supportedEntryTypes = ['longtask'];
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe(options) {
      this.options = options;
    }
  }
  const scope = {
    Error,
    location: { href: 'http://127.0.0.1:4100/' },
    performance: { now: () => time },
    requestAnimationFrame(callback) {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    setTimeout(callback, delay = 0, ...args) {
      const id = nextId++;
      timers.set(id, { at: time + delay, callback, args });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    setInterval(callback, delay = 0, ...args) {
      const id = nextId++;
      timers.set(id, { at: time + delay, callback, args, every: delay });
      return id;
    },
    clearInterval(id) {
      timers.delete(id);
    },
    document: {
      visibilityState: 'visible',
      addEventListener(type, listener) {
        listeners[type] = listener;
      },
      getAnimations: () => animations,
    },
    HTMLCanvasElement: FakeCanvas,
    OffscreenCanvas: FakeOffscreenCanvas,
    PerformanceObserver: FakeObserver,
    WeakRef,
  };
  const fake = {
    scope,
    listeners,
    animations,
    observers,
    FakeCanvas,
    FakeOffscreenCanvas,
    /** Runs one frame: every callback asked for before it started. */
    frame(ms = 16) {
      time += ms;
      const due = frames;
      frames = new Map();
      for (const callback of due.values()) callback(time);
    },
    /** Moves the clock on by `ms`, running each timer as it falls due. */
    advance(ms) {
      const end = time + ms;
      for (;;) {
        const [id, timer] =
          [...timers.entries()].sort((a, b) => a[1].at - b[1].at).find(([, t]) => t.at <= end) ??
          [];
        if (!timer) break;
        time = timer.at;
        if (timer.every !== undefined) timer.at += Math.max(timer.every, 1);
        else timers.delete(id);
        timer.callback(...timer.args);
      }
      time = end;
    },
    /** `ms` of a page's life: timers as they fall due, a frame every 16 ms, continuations between. */
    async run(ms) {
      for (let elapsed = 0; elapsed < ms; elapsed += 16) {
        fake.advance(15);
        await settle();
        fake.frame(1);
        await settle();
      }
    },
  };
  return fake;
}

test('installs once, keeping the originals for the harness', () => {
  const fake = fakeWindow();
  const raf = fake.scope.requestAnimationFrame;
  const probe = installTraceProbe(fake.scope);
  assert.equal(installTraceProbe(fake.scope), probe);
  assert.equal(fake.scope.__portfolioTrace, probe);
  assert.notEqual(fake.scope.requestAnimationFrame, raf);
  let ran = false;
  probe.original.requestAnimationFrame(() => (ran = true));
  probe.start();
  fake.frame();
  assert.equal(ran, true);
  assert.equal(probe.read().frames.windowCallbacks, 0, "the harness's own frame doesn't count");
  assert.equal(probe.read().url, 'http://127.0.0.1:4100/');
});

test('three frame loops of three shapes are three loops, each at its own rate', async () => {
  const fake = fakeWindow();
  const probe = installTraceProbe(fake.scope);
  const raf = (callback) => fake.scope.requestAnimationFrame(callback);
  let running = true;
  // A callback that asks for the next frame.
  const direct = () => {
    if (running) raf(direct);
  };
  raf(direct);
  // An await on a promise a frame resolves.
  (async () => {
    while (running) await new Promise((resolve) => raf(resolve));
  })();
  // A frame, then a timeout of 33 ms that asks for the next frame.
  const bridged = () => {
    if (running) fake.scope.setTimeout(() => raf(bridged), 33);
  };
  raf(bridged);
  await fake.run(200);
  probe.start();
  await fake.run(2000);
  const { frames, timers } = probe.read();
  assert.equal(frames.loops.length, 3, JSON.stringify(frames.loops));
  const rates = frames.loops.map((loop) => loop.perSecond).sort((a, b) => a - b);
  assert.ok(rates[0] > 15 && rates[0] < 35, `the bridged loop runs about every 48 ms: ${rates}`);
  assert.ok(rates[1] > 55 && rates[2] > 55, `the other two run every frame: ${rates}`);
  for (const loop of frames.loops) {
    assert.equal(loop.sustained, true);
    assert.match(loop.site, /probe\.test\.mjs:\d+:\d+$/);
  }
  assert.equal(frames.transient.length, 0);
  assert.equal(timers.timeouts.length, 1, 'the bridged loop also recurs as a timeout');
  running = false;
  await fake.run(100);
  probe.start();
  await fake.run(500);
  assert.equal(probe.read().frames.loops.length, 0, 'a stopped loop is no loop in the next window');
});

test('a loop that stops in the first half of the window is transient, not a loop', async () => {
  const fake = fakeWindow();
  const probe = installTraceProbe(fake.scope);
  let frames = 0;
  const transition = () => {
    frames += 1;
    if (frames < 20) fake.scope.requestAnimationFrame(transition);
  };
  probe.start();
  fake.scope.requestAnimationFrame(transition);
  await fake.run(2000);
  const read = probe.read();
  assert.equal(read.frames.loops.length, 0);
  assert.equal(read.frames.transient.length, 1);
  assert.equal(read.frames.transient[0].callbacks, 19, 'the first frame came from another site');
});

test('one-off frames, and a frame asked for from a timer, are no frame loop', async () => {
  const fake = fakeWindow();
  const probe = installTraceProbe(fake.scope);
  probe.start();
  fake.scope.requestAnimationFrame(() => {});
  fake.scope.requestAnimationFrame(() => {});
  await fake.run(500);
  const read = probe.read();
  assert.equal(read.frames.loops.length + read.frames.transient.length, 0);
  assert.equal(read.frames.windowCallbacks, 2);
});

test('frame callbacks count when they run, not when they are asked for', async () => {
  const fake = fakeWindow();
  const probe = installTraceProbe(fake.scope);
  probe.start();
  const kept = fake.scope.requestAnimationFrame(() => {});
  const cancelled = fake.scope.requestAnimationFrame(() => {});
  fake.scope.cancelAnimationFrame(cancelled);
  assert.notEqual(kept, cancelled);
  fake.frame();
  const read = probe.read();
  assert.equal(read.frames.requests, 2);
  assert.equal(read.frames.windowRequests, 2);
  assert.equal(read.frames.callbacks, 1);
  assert.equal(read.frames.windowCallbacks, 1);
});

test('an await on a timeout, round after round, is one recurring timer', async () => {
  const fake = fakeWindow();
  const probe = installTraceProbe(fake.scope);
  let running = true;
  (async () => {
    while (running) await new Promise((resolve) => fake.scope.setTimeout(resolve, 100));
  })();
  await fake.run(300);
  probe.start();
  await fake.run(2000);
  const { timers } = probe.read();
  assert.equal(timers.timeouts.length, 1, JSON.stringify(timers.timeouts));
  assert.ok(timers.timeouts[0].callbacks >= 18, `${timers.timeouts[0].callbacks} rounds`);
  assert.equal(timers.timeouts[0].sustained, true);
  assert.equal(timers.recurring, 1);
  running = false;
});

test('a one-shot timeout never recurs, nor do timeouts that one site sets once each', async () => {
  const fake = fakeWindow();
  const probe = installTraceProbe(fake.scope);
  probe.start();
  for (let i = 0; i < 3; i += 1) fake.scope.setTimeout(() => {}, 10 * i);
  await fake.run(500);
  const { timers } = probe.read();
  assert.equal(timers.timeouts.length, 0);
  assert.equal(timers.windowTimeoutCallbacks, 3);
  assert.equal(timers.recurring, 0);
});

test('an interval recurs until clearInterval or clearTimeout ends it', async () => {
  const fake = fakeWindow();
  const probe = installTraceProbe(fake.scope);
  const first = fake.scope.setInterval(() => {}, 250);
  const second = fake.scope.setInterval(() => {}, 500);
  fake.advance(500);
  probe.start();
  fake.advance(1000);
  let read = probe.read();
  assert.equal(read.timers.intervals.length, 2);
  assert.deepEqual(
    read.timers.intervals.map(({ delayMs, callbacks }) => [delayMs, callbacks]),
    [
      [250, 4],
      [500, 2],
    ],
  );
  assert.match(read.timers.intervals[0].site, /probe\.test\.mjs:\d+:\d+$/);
  assert.equal(read.timers.recurring, 2);

  fake.scope.clearInterval(first);
  // setTimeout and setInterval share their IDs, so clearTimeout ends an interval too.
  fake.scope.clearTimeout(second);
  probe.start();
  fake.advance(1000);
  read = probe.read();
  assert.equal(read.timers.intervals.length, 0);
  assert.equal(read.timers.recurring, 0);
  assert.equal(read.timers.windowIntervalCallbacks, 0);
});

test('timers keep their arguments and return values, and a string callback passes through', () => {
  const fake = fakeWindow();
  installTraceProbe(fake.scope);
  const seen = [];
  const id = fake.scope.setTimeout((a, b) => seen.push(a + b), 5, 2, 3);
  assert.equal(typeof id, 'number');
  fake.scope.setInterval((a) => seen.push(a), 5, 'x');
  fake.advance(5);
  assert.deepEqual(seen, [5, 'x']);
  assert.equal(typeof fake.scope.setTimeout('code', 1), 'number');
  assert.equal(typeof fake.scope.requestAnimationFrame('nope'), 'number');
});

test('canvas contexts count once each, by type, offscreen ones apart, and null WebGL asks too', () => {
  const fake = fakeWindow();
  const probe = installTraceProbe(fake.scope);
  const a = new fake.FakeCanvas();
  const b = new fake.FakeCanvas();
  a.getContext('2d');
  a.getContext('2d');
  b.getContext('experimental-webgl');
  b.getContext('webgl2');
  new fake.FakeOffscreenCanvas().getContext('webgl');
  b.isConnected = false;
  const { canvas } = probe.read();
  assert.deepEqual(canvas.contexts, { '2d': 1, webgl: 2 });
  assert.equal(canvas.total, 3);
  assert.equal(canvas.connected, 1);
  assert.equal(canvas.offscreen, 1);
  assert.deepEqual(canvas.nullContexts, { webgl2: 1 });
});

test('only running animations that never end count as infinite', () => {
  const fake = fakeWindow();
  class CSSAnimation {
    constructor(name, end, state = 'running') {
      this.animationName = name;
      this.playState = state;
      this.effect = {
        target: { tagName: 'DIV', classList: ['orb', 'glow'] },
        getComputedTiming: () => ({ endTime: end }),
      };
    }
  }
  fake.scope.CSSAnimation = CSSAnimation;
  fake.animations.push(
    new CSSAnimation('spin', Infinity),
    new CSSAnimation('fade', 300),
    new CSSAnimation('pulse', Infinity, 'paused'),
    {
      playState: 'running',
      effect: { target: null, getComputedTiming: () => ({ endTime: Infinity }) },
    },
  );
  const probe = installTraceProbe(fake.scope);
  assert.deepEqual(probe.read().animations.infinite, [
    { kind: 'css spin', target: 'div.orb.glow' },
    { kind: 'script', target: 'no target' },
  ]);
});

test('CSP violations and long tasks are kept as they come', () => {
  const fake = fakeWindow();
  const probe = installTraceProbe(fake.scope);
  fake.listeners.securitypolicyviolation({
    blockedURI: 'https://fonts.example.test/a.css',
    violatedDirective: 'style-src',
    effectiveDirective: 'style-src-elem',
    disposition: 'enforce',
    sourceFile: 'http://127.0.0.1/',
    lineNumber: 1,
    sample: '',
  });
  const [observer] = fake.observers;
  assert.deepEqual(observer.options, { type: 'longtask', buffered: true });
  observer.callback({
    getEntries: () => [
      { startTime: 10, duration: 80, name: 'self', attribution: [{ containerType: 'window' }] },
    ],
  });
  const read = probe.read();
  assert.equal(read.csp.length, 1);
  assert.equal(read.csp[0].effectiveDirective, 'style-src-elem');
  assert.equal(read.longTasks.supported, true);
  assert.deepEqual(read.longTasks.entries, [
    {
      startTime: 10,
      duration: 80,
      name: 'self',
      attribution: [{ containerType: 'window', containerSrc: undefined, containerName: undefined }],
    },
  ]);
  assert.equal(read.visibility, 'visible');
});

test('a window that never started reads null, and long task timing can be missing', () => {
  const fake = fakeWindow();
  fake.scope.PerformanceObserver = undefined;
  const probe = installTraceProbe(fake.scope);
  const read = probe.read();
  assert.equal(read.windowMs, null);
  assert.equal(read.longTasks.supported, false);
  assert.deepEqual(read.longTasks.entries, []);
});

test("the probe leaves the page's stack trace limit as it found it", () => {
  const fake = fakeWindow();
  const limit = Error.stackTraceLimit;
  installTraceProbe(fake.scope);
  fake.scope.setTimeout(() => {}, 1);
  fake.scope.requestAnimationFrame(() => {});
  assert.equal(Error.stackTraceLimit, limit);
});
