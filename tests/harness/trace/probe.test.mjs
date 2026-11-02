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

/**
 * Starts three frame loops of three shapes, each asking through `raf`: a
 * callback that asks for the next frame, an await on a promise a frame
 * resolves, and a frame then a timeout of 33 ms that asks for the next one.
 * Returns a function that stops them.
 */
function threeLoops(fake, raf) {
  let running = true;
  const direct = () => {
    if (running) raf(direct);
  };
  raf(direct);
  (async () => {
    while (running) await new Promise((resolve) => raf(resolve));
  })();
  const bridged = () => {
    if (running) fake.scope.setTimeout(() => raf(bridged), 33);
  };
  raf(bridged);
  return () => {
    running = false;
  };
}

test('three frame loops of three shapes, each at its own site, are three loops', async () => {
  const fake = fakeWindow();
  const probe = installTraceProbe(fake.scope);
  // Each shape asks from its own line, as separate code does.
  let running = true;
  const direct = () => {
    if (running) fake.scope.requestAnimationFrame(direct);
  };
  fake.scope.requestAnimationFrame(direct);
  (async () => {
    while (running) await new Promise((resolve) => fake.scope.requestAnimationFrame(resolve));
  })();
  const bridged = () => {
    if (running) fake.scope.setTimeout(() => fake.scope.requestAnimationFrame(bridged), 33);
  };
  fake.scope.requestAnimationFrame(bridged);
  await fake.run(200);
  probe.start();
  await fake.run(2000);
  const { frames, timers } = probe.read();
  assert.equal(frames.loops.length, 3, JSON.stringify(frames.loops));
  assert.equal(frames.loopCount, 3);
  const rates = frames.loops.map((loop) => loop.perSecond).sort((a, b) => a - b);
  assert.ok(rates[0] > 15 && rates[0] < 35, `the bridged loop runs about every 48 ms: ${rates}`);
  assert.ok(rates[1] > 55 && rates[2] > 55, `the other two run every frame: ${rates}`);
  for (const loop of frames.loops) {
    assert.equal(loop.sustained, true);
    assert.equal(loop.concurrent, 1);
    assert.match(loop.site, /probe\.test\.mjs:\d+:\d+$/);
  }
  assert.equal(frames.transient.length, 0);
  assert.equal(timers.timeouts.length, 1, 'the bridged loop also recurs as a timeout');
  assert.equal(timers.recurring, 1);
  running = false;
  await fake.run(100);
  probe.start();
  await fake.run(500);
  const stopped = probe.read().frames;
  assert.equal(stopped.loops.length, 0, 'a stopped loop is no loop in the next window');
  assert.equal(stopped.loopCount, 0);
});

test('three frame loops behind one shared helper are one site and still three loops', async () => {
  const fake = fakeWindow();
  const probe = installTraceProbe(fake.scope);
  const stop = threeLoops(fake, (callback) => fake.scope.requestAnimationFrame(callback));
  await fake.run(200);
  probe.start();
  await fake.run(2000);
  const { frames } = probe.read();
  assert.equal(frames.loops.length, 1, 'the helper is the one site that asks');
  assert.equal(frames.loops[0].concurrent, 3, 'three of its callbacks run in one frame');
  assert.equal(frames.loopCount, 3);
  stop();
});

test('two timeout loops behind one shared sleep helper are two recurring timers', async () => {
  const fake = fakeWindow();
  const probe = installTraceProbe(fake.scope);
  let running = true;
  const sleep = (ms) => new Promise((resolve) => fake.scope.setTimeout(resolve, ms));
  for (const ms of [100, 250]) {
    (async () => {
      while (running) await sleep(ms);
    })();
  }
  await fake.run(300);
  probe.start();
  await fake.run(2000);
  const { timers } = probe.read();
  assert.equal(timers.timeouts.length, 1);
  assert.equal(timers.timeouts[0].concurrent, 2);
  assert.equal(timers.recurring, 2);
  running = false;
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

test('R3: an infinite loop counts, and a finite reveal or a scroll-driven animation never does', () => {
  const fake = fakeWindow();
  class ScrollTimeline {}
  class ViewTimeline extends ScrollTimeline {}
  const documentTimeline = {};
  fake.scope.ScrollTimeline = ScrollTimeline;
  class CSSAnimation {
    constructor(name, end, timeline = documentTimeline) {
      this.animationName = name;
      this.playState = 'running';
      this.timeline = timeline;
      this.effect = {
        target: { tagName: 'DIV', classList: [name] },
        getComputedTiming: () => ({ endTime: end }),
      };
    }
  }
  fake.scope.CSSAnimation = CSSAnimation;
  fake.animations.push(
    // An ambient loop on the document timeline.
    new CSSAnimation('drift', Infinity),
    // A one-shot reveal, however long.
    new CSSAnimation('reveal', 800),
    new CSSAnimation('slow-reveal', 20_000),
    // One iteration that outlasts any window, as a loop would (K-4 round 2).
    new CSSAnimation('endless', 1e9),
    // Scroll-driven, by a scroll() or a view() timeline, even with infinite iterations.
    new CSSAnimation('progress', Infinity, new ScrollTimeline()),
    new CSSAnimation('parallax', Infinity, new ViewTimeline()),
  );
  const probe = installTraceProbe(fake.scope);
  assert.deepEqual(probe.read().animations.infinite, [
    { kind: 'css drift', target: 'div.drift' },
    { kind: 'css endless', target: 'div.endless' },
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

test('K-4 M3: an animation iterating over 1000 times counts as infinite, as many as 1000 never', () => {
  const fake = fakeWindow();
  const animation = (iterations, end) => ({
    playState: 'running',
    effect: { target: null, getComputedTiming: () => ({ endTime: end, iterations }) },
  });
  fake.animations.push(
    animation(100000, 200_000_000),
    animation(1000, 20_000),
    animation(1, 800),
    // A thousand iterations or fewer, yet more than 30 s still to run (K-4 round 2).
    animation(10, 45_000),
  );
  const probe = installTraceProbe(fake.scope);
  assert.equal(probe.read().animations.infinite.length, 2);
});

test('K-4 M3: a Web Animation restarted on finish, by animate() again or by play(), is a restarting site', () => {
  const fake = fakeWindow();
  class FakeAnimation {
    constructor() {
      this.playState = 'running';
      this.listeners = [];
    }
    addEventListener(type, listener) {
      if (type === 'finish') this.listeners.push(listener);
    }
    finish() {
      this.playState = 'finished';
      const listeners = this.listeners;
      this.listeners = [];
      for (const listener of listeners) listener();
    }
    play() {
      this.playState = 'running';
    }
  }
  class FakeElement {
    animate() {
      return new FakeAnimation();
    }
  }
  fake.scope.Element = FakeElement;
  fake.scope.Animation = FakeAnimation;
  const probe = installTraceProbe(fake.scope);
  const element = new FakeElement();
  probe.start();
  // `for (;;) await element.animate(...).finished`, one site asking again.
  const again = () => element.animate([], 2000);
  for (let round = 0; round < 3; round++) again().finish();
  assert.equal(probe.read().animations.restarting.length, 1);
  // `animation.onfinish = () => animation.play()`: the same animation, played again.
  const looping = new FakeAnimation();
  const replay = () => looping.play();
  for (let round = 0; round < 3; round++) {
    looping.finish();
    replay();
  }
  assert.equal(probe.read().animations.restarting.length, 2);
  // One animation played once, and one finished and never played again, aren't.
  const once = element.animate([], 800);
  once.finish();
  assert.equal(probe.read().animations.restarting.length, 2);
});

test('K-4 M3: requestIdleCallback and scheduler.postTask loops are recurring timers', async () => {
  const fake = fakeWindow();
  const idle = [];
  const tasks = [];
  fake.scope.requestIdleCallback = (callback) => idle.push(callback);
  fake.scope.scheduler = {
    postTask: (callback) => new Promise((resolve) => tasks.push(() => resolve(callback()))),
  };
  const probe = installTraceProbe(fake.scope);
  probe.start();
  const idleTick = () => fake.scope.requestIdleCallback(idleTick);
  const taskTick = () => fake.scope.scheduler.postTask(taskTick);
  idleTick();
  taskTick();
  for (let round = 0; round < 4; round++) {
    idle.splice(0).forEach((callback) => callback({ timeRemaining: () => 10 }));
    tasks.splice(0).forEach((run) => run());
    await settle();
  }
  const { timers } = probe.read();
  assert.equal(timers.idle.length, 1);
  assert.equal(timers.tasks.length, 1);
  assert.equal(timers.recurring, 2);
});

test('K-4 round 2: reverse() or a seek back on a finished animation restarts it, and CSS restarts recur by their events', async () => {
  const fake = fakeWindow();
  class FakeAnimation {
    constructor() {
      this.playState = 'running';
      this.listeners = [];
      this.time = 0;
    }
    addEventListener(type, listener) {
      if (type === 'finish') this.listeners.push(listener);
    }
    finish() {
      this.playState = 'finished';
      const listeners = this.listeners;
      this.listeners = [];
      for (const listener of listeners) listener();
    }
    reverse() {
      this.playState = 'running';
    }
    get currentTime() {
      return this.time;
    }
    set currentTime(value) {
      this.time = value;
      this.playState = 'running';
    }
  }
  fake.scope.Animation = FakeAnimation;
  const probe = installTraceProbe(fake.scope);
  probe.start();
  // A ping-pong: reverse on finish.
  const pingPong = new FakeAnimation();
  const back = () => pingPong.reverse();
  for (let round = 0; round < 3; round++) {
    pingPong.finish();
    back();
  }
  // A seek back to 0 on finish.
  const seeking = new FakeAnimation();
  const rewind = () => {
    seeking.currentTime = 0;
  };
  for (let round = 0; round < 3; round++) {
    seeking.finish();
    rewind();
  }
  assert.equal(probe.read().animations.restarting.length, 2);
  // A class toggled on animationend restarts it: its start events fall in both halves.
  const target = { tagName: 'DIV', classList: ['ticker'] };
  const fire = (type) => fake.listeners[type]?.({ type, target });
  fire('animationstart');
  await fake.run(1000);
  fire('animationstart');
  await fake.run(1000);
  fire('animationstart');
  const once = { tagName: 'DIV', classList: ['reveal'] };
  fake.listeners.transitionrun?.({ type: 'transitionrun', target: once });
  const { cssRestarts } = probe.read().animations;
  assert.deepEqual(cssRestarts, [{ type: 'animationstart', target: 'div.ticker', events: 3 }]);
});
