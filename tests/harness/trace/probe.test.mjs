import test from 'node:test';
import assert from 'node:assert/strict';
import { installTraceProbe } from './probe.mjs';

/**
 * A window with a clock, frames, and timers the test drives by hand:
 * frame() runs every frame callback asked for so far, and advance(ms) runs
 * the timers that fall due, in order.
 */
function fakeWindow() {
  let time = 0;
  let nextId = 1;
  let frames = [];
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
        if (type === 'none') return null;
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
    performance: { now: () => time },
    requestAnimationFrame(callback) {
      const id = nextId++;
      frames.push({ id, callback });
      return id;
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
  return {
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
      frames = [];
      for (const { callback } of due) callback(time);
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
  };
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
});

test('a frame loop is one chain that asks again, at its callbacks per second', () => {
  const fake = fakeWindow();
  const probe = installTraceProbe(fake.scope);
  let running = true;
  const loop = () => {
    if (running) fake.scope.requestAnimationFrame(loop);
  };
  fake.scope.requestAnimationFrame(loop);
  fake.scope.requestAnimationFrame(() => {});
  fake.frame();
  fake.frame();
  probe.start();
  for (let i = 0; i < 10; i += 1) fake.frame(100);
  const read = probe.read();
  assert.equal(read.windowMs, 1000);
  assert.equal(read.frames.windowCallbacks, 10);
  assert.equal(read.frames.loops.length, 1);
  assert.equal(read.frames.loops[0].callbacks, 10);
  assert.equal(read.frames.loops[0].perSecond, 10);
  assert.equal(typeof read.frames.loops[0].origin, 'string');
  assert.equal(read.frames.callbacks, 13, 'every callback since install');

  running = false;
  fake.frame();
  probe.start();
  fake.frame();
  const stopped = probe.read();
  assert.equal(stopped.frames.loops.length, 0, 'a stopped loop is no loop in the next window');
  assert.equal(stopped.frames.windowCallbacks, 0);
});

test('one-off frames and a frame asked for from a timer are no loop', () => {
  const fake = fakeWindow();
  const probe = installTraceProbe(fake.scope);
  probe.start();
  const tick = () => {
    fake.scope.requestAnimationFrame(() => {});
    fake.scope.setTimeout(tick, 100);
  };
  fake.scope.setTimeout(tick, 100);
  for (let i = 0; i < 5; i += 1) {
    fake.advance(100);
    fake.frame(0);
  }
  const read = probe.read();
  assert.equal(read.frames.loops.length, 0);
  assert.equal(read.frames.windowCallbacks, 5);
  assert.equal(
    read.timers.timeoutChains.length,
    1,
    'the timeout that sets itself again is one chain',
  );
  assert.equal(read.timers.recurring, 1);
});

test('an interval recurs until cleared, and a one-shot timeout never does', () => {
  const fake = fakeWindow();
  const probe = installTraceProbe(fake.scope);
  const id = fake.scope.setInterval(() => {}, 250);
  fake.scope.setTimeout(() => {}, 10);
  fake.advance(500);
  probe.start();
  fake.advance(1000);
  let read = probe.read();
  assert.equal(read.timers.intervals.length, 1);
  assert.equal(read.timers.intervals[0].delayMs, 250);
  assert.equal(read.timers.intervals[0].callbacks, 4);
  assert.equal(read.timers.windowIntervalCallbacks, 4);
  assert.equal(read.timers.timeoutChains.length, 0);
  assert.equal(read.timers.recurring, 1);
  assert.equal(read.timers.timeoutCallbacks, 1);

  fake.scope.clearInterval(id);
  probe.start();
  fake.advance(1000);
  read = probe.read();
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

test('canvas contexts count once each, by type, and offscreen ones apart', () => {
  const fake = fakeWindow();
  const probe = installTraceProbe(fake.scope);
  const a = new fake.FakeCanvas();
  const b = new fake.FakeCanvas();
  a.getContext('2d');
  a.getContext('2d');
  b.getContext('experimental-webgl');
  b.getContext('none');
  new fake.FakeOffscreenCanvas().getContext('webgl2');
  b.isConnected = false;
  const { canvas } = probe.read();
  assert.deepEqual(canvas.contexts, { '2d': 1, webgl: 1, webgl2: 1 });
  assert.equal(canvas.total, 3);
  assert.equal(canvas.connected, 1);
  assert.equal(canvas.offscreen, 1);
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
