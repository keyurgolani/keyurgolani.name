import assert from 'node:assert/strict';
import test from 'node:test';
import type { Page } from '@playwright/test';
import {
  enhancementFindings,
  load,
  reflowFindings,
  watchEnhancements,
} from './lib/a11y/conditions';

// Each reflow reload awaits document.fonts.ready before its frames (push 3 r2, item 4), as the
// main pass and the landscape pass do, since the reflow probe measures text boxes. Driven with a
// fake page, as reflowFindings calls load() (the enhancements' wait, a condition at 100% root
// text): the meta stand-in serves only its page and a lazy chunk, so no meta case can serve a
// font late.

/** A page that answers load()'s reads, its fonts held until `fonts.resolve()`, counting frames. */
function fakePage() {
  let resolve!: () => void;
  const ready = new Promise<void>((done) => (resolve = done));
  const state = { asked: false, framesAfterAsk: 0, resolve: () => resolve() };
  const page = {
    on: () => undefined,
    off: () => undefined,
    goto: async () => null,
    // notBusy: nothing on the page is busy.
    waitForFunction: async () => ({}),
    waitForTimeout: async () => undefined,
    evaluate: async (fn: unknown) => {
      const source = String(fn);
      if (source.includes('fonts.ready')) {
        state.asked = true;
        await ready;
        return undefined;
      }
      if (source.includes('scripting: none')) return false;
      if (source.includes('requestIdleCallback')) return undefined;
      if (source.includes('requestAnimationFrame')) {
        if (state.asked) state.framesAfterAsk += 1;
        return undefined;
      }
      if (source.includes('data-enhancement-island')) return '';
      return 0;
    },
  };
  return { page: page as unknown as Page, state };
}

/** Lets pending promise callbacks run, `turns` times. */
async function turns(count: number) {
  for (let turn = 0; turn < count; turn += 1) await new Promise((done) => setImmediate(done));
}

test("a reflow reload's load() runs no frame while document.fonts.ready is pending, and one once it resolves", async () => {
  const { page, state } = fakePage();
  const loading = load(page, '/', undefined, { enhancements: true });
  await turns(200);
  assert.equal(state.asked, true, 'load() asks the page for document.fonts.ready');
  assert.equal(state.framesAfterAsk, 0, 'no frame runs while the fonts are pending');
  state.resolve();
  const loaded = await loading;
  assert.deepEqual(loaded, { settled: true, enhanced: true });
  assert.equal(state.framesAfterAsk, 1, 'once they resolve, load() runs its frames once');
});

/**
 * A page as reflowFindings drives it, through its CDP session too: `held` fonts at the width that
 * holds them, every page busy for good when `busy`, and what it did, in order, by the width it
 * was at.
 */
function fakeReflowPage({ heldAt, busy = false }: { heldAt?: number; busy?: boolean }) {
  let resolve!: () => void;
  const held = new Promise<void>((done) => (resolve = done));
  let width = 1440;
  const events: { readonly kind: 'fonts' | 'switch' | 'frame'; readonly width: number }[] = [];
  const cdp = {
    send: async (method: string, params?: { width?: number }) => {
      if (method === 'Emulation.setDeviceMetricsOverride') width = params!.width!;
      if (method === 'Emulation.clearDeviceMetricsOverride') width = 1440;
      return {};
    },
    detach: async () => undefined,
  };
  const page = {
    on: () => undefined,
    off: () => undefined,
    goto: async () => null,
    viewportSize: () => ({ width: 1440, height: 900 }),
    setViewportSize: async () => undefined,
    context: () => ({ newCDPSession: async () => cdp }),
    waitForFunction: async () => {
      if (busy) throw new Error('still busy');
      return {};
    },
    waitForTimeout: async () => undefined,
    evaluate: async (fn: unknown) => {
      // inPage's probe, a source string: nothing reflows on this page.
      if (typeof fn === 'string') return [];
      const source = String(fn);
      if (source.includes('fonts.ready')) {
        events.push({ kind: 'fonts', width });
        if (width === heldAt) await held;
        return undefined;
      }
      if (source.includes('font-size')) {
        events.push({ kind: 'switch', width });
        return undefined;
      }
      if (source.includes('scripting: none')) return false;
      if (source.includes('requestIdleCallback')) return undefined;
      if (source.includes('requestAnimationFrame')) {
        events.push({ kind: 'frame', width });
        return undefined;
      }
      if (source.includes('data-enhancement-island')) return '';
      return 0;
    },
  };
  return { page: page as unknown as Page, events, resolve: () => resolve() };
}

test("at the 1024 reload (root text 200%), reflowFindings' load awaits the fonts before the switch, and nothing switches or draws until they resolve", async () => {
  const { page, events, resolve } = fakeReflowPage({ heldAt: 1024 });
  const reading = reflowFindings(page, '/');
  await turns(400);
  const asked = events.findIndex((each) => each.kind === 'fonts' && each.width === 1024);
  assert.ok(asked >= 0, 'the 1024 reload asks for document.fonts.ready');
  assert.deepEqual(
    events.slice(asked + 1),
    [],
    'nothing switches or draws while the fonts are pending',
  );
  resolve();
  await reading;
  const after = events.slice(asked + 1).filter((each) => each.width === 1024);
  assert.deepEqual(
    after.map((each) => each.kind).slice(0, 2),
    ['switch', 'frame'],
    'then the root text switches, and frames are drawn',
  );
  // And only there (push 3 r4, item 3): the 320 and 640 reloads, and the restore, stay at 100%.
  assert.deepEqual(
    events.filter((each) => each.kind === 'switch').map((each) => each.width),
    [1024],
    'the root text switches at the 1024 reload alone',
  );
});

test('a page busy for good gives reflowFindings one STILL_BUSY a condition, each at its own viewport, and the restore at none', async () => {
  const { page } = fakeReflowPage({ busy: true });
  const findings = await reflowFindings(page, '/');
  assert.deepEqual(
    findings.map((each) => [each.gate, each.rule, each.expected, each.viewport ?? null]),
    [
      ['runner', 'settled', 'the page settles under reflow', '320x568'],
      ['runner', 'settled', 'the page settles under zoom', '640x400'],
      ['runner', 'settled', 'the page settles under root-text', '1024x768'],
      ['runner', 'settled', 'the page settles under the reload after reflow', null],
    ],
  );
});

/**
 * A page whose HTML, as served, names one chunk, which finished just before the enhancements'
 * wait began, its tag kept in the live page as Turbopack leaves it; nothing else happens on it.
 * Every waitForTimeout it's asked for is kept, and run.
 */
/** A document the fake page loads: its URL and its HTML, or a body that can't be read, or never comes. */
interface FakeDocument {
  readonly url: string;
  readonly html: string | 'unreadable' | 'never';
}

const MAIN_HTML =
  '<!doctype html><html><head><script src="/_next/static/chunks/main.js" async=""></script></head><body><main><h1>A page</h1></main></body></html>';

function servedChunkPage({
  documents = [{ url: 'http://app.test/', html: MAIN_HTML }],
  chunkPath = '/_next/static/chunks/main.js',
}: { readonly documents?: readonly FakeDocument[]; readonly chunkPath?: string } = {}) {
  const CHUNK = `http://app.test${chunkPath}`;
  const handlers = new Map<string, Set<(value: unknown) => void>>();
  const emit = (event: string, value: unknown) => {
    for (const handler of handlers.get(event) ?? []) handler(value);
  };
  const waits: number[] = [];
  const chunk = { resourceType: () => 'script', url: () => CHUNK };
  const responses = documents.map(({ url, html }) => ({
    url: () => url,
    status: () => 200,
    request: () => ({ resourceType: () => 'document' }),
    text: () =>
      html === 'never'
        ? new Promise<string>(() => undefined)
        : html === 'unreadable'
          ? Promise.reject(new Error('No resource with given identifier found'))
          : Promise.resolve(html),
  }));
  const state = { readStarted: false };
  const page = {
    on: (event: string, handler: (value: unknown) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    },
    off: (event: string, handler: (value: unknown) => void) => {
      handlers.get(event)?.delete(handler);
    },
    // Failed enhancement's read starts at its CDP session: noted, and refused.
    context: () => {
      state.readStarted = true;
      return {
        newCDPSession: async () => {
          throw new Error('the read of the page went ahead');
        },
      };
    },
    goto: async () => {
      for (const response of responses) emit('response', response);
      emit('request', chunk);
      emit('requestfinished', chunk);
      return null;
    },
    waitForFunction: async () => ({}),
    waitForTimeout: async (ms: number) => {
      waits.push(ms);
      await new Promise((done) => setTimeout(done, ms));
    },
    evaluate: async (fn: unknown) => {
      const source = String(fn);
      if (source.includes('fonts.ready')) return undefined;
      if (source.includes('scripting: none')) return false;
      if (source.includes('requestIdleCallback')) return undefined;
      if (source.includes('requestAnimationFrame')) return undefined;
      if (source.includes('data-enhancement-island')) return '';
      // As Turbopack leaves it, the live page names the chunk too.
      if (source.includes('document.scripts')) return [CHUNK];
      return 0;
    },
  };
  return { page: page as unknown as Page, waits, state };
}

test("a chunk the page's HTML names as served, finished just before the wait, asks for no wait of 400 ms or more", async () => {
  const { page, waits } = servedChunkPage();
  const started = Date.now();
  const loaded = await load(page, '/', undefined, { enhancements: true });
  const took = Date.now() - started;
  assert.deepEqual(loaded, { settled: true, enhanced: true });
  assert.deepEqual(
    waits.filter((ms) => ms >= 400),
    [],
    'no waitForTimeout of 400 ms or more',
  );
  assert.ok(took < 400, `load() returns in under 400 ms, not ${took}`);
});

// own() reads every frame's document (push 3 r5, item 4): a chunk an iframe's HTML names is the
// page's own, so one that finished just before the wait asks for no floor.
test("a chunk an iframe's HTML names as served, finished just before the wait, asks for no wait of 400 ms or more", async () => {
  const { page, waits } = servedChunkPage({
    documents: [
      {
        url: 'http://app.test/',
        html: '<!doctype html><html><body><iframe src="/frame"></iframe></body></html>',
      },
      {
        url: 'http://app.test/frame',
        html: '<!doctype html><html><head><script src="/_next/static/chunks/frame.js"></script></head><body></body></html>',
      },
    ],
    chunkPath: '/_next/static/chunks/frame.js',
  });
  await load(page, '/', undefined, { enhancements: true });
  assert.deepEqual(
    waits.filter((ms) => ms >= 400),
    [],
    'no waitForTimeout of 400 ms or more',
  );
});

// A src that won't parse as a URL is skipped, and the HTML's other scripts still count (push 3 r5,
// item 4).
test("a script src that won't parse is skipped, and the HTML's other scripts still count as its own", async () => {
  const { page, waits } = servedChunkPage({
    documents: [
      {
        url: 'http://app.test/',
        html: '<!doctype html><html><head><script src="http://[::1"></script><script src="/_next/static/chunks/main.js"></script></head><body></body></html>',
      },
    ],
  });
  const loaded = await load(page, '/', undefined, { enhancements: true });
  assert.deepEqual(loaded, { settled: true, enhanced: true });
  assert.deepEqual(
    waits.filter((ms) => ms >= 400),
    [],
    'no waitForTimeout of 400 ms or more',
  );
});

// own() is bounded by the wait's end (push 3 r5, item 4): a document whose body never comes
// doesn't hold the read past it; it fails closed.
test(
  "a document body that never comes holds load() no longer than the wait's end",
  { timeout: 30_000 },
  async () => {
    const { page } = servedChunkPage({ documents: [{ url: 'http://app.test/', html: 'never' }] });
    const started = Date.now();
    await load(page, '/', undefined, { enhancements: true });
    assert.ok(
      Date.now() - started < 15_000,
      `load() returns by the wait's end, not after ${Date.now() - started} ms`,
    );
  },
);

// When own() fails closed, failed enhancement doesn't read a page with every chunk blocked: it
// records a runner finding that the page's own scripts couldn't be told from its lazy ones (push 3
// r5, item 4).
test("failed enhancement on a page whose own scripts can't be told apart records a runner finding, and reads nothing", async () => {
  const { page, state } = servedChunkPage({
    documents: [{ url: 'http://app.test/', html: 'unreadable' }],
  });
  const watch = watchEnhancements(page);
  await page.goto('/');
  const own = await watch.own();
  watch.stop();
  let findings: Awaited<ReturnType<typeof enhancementFindings>> = [];
  try {
    findings = await enhancementFindings(page, '/', [], own as never);
  } catch {
    // The read went ahead, and the fake refused it.
  }
  assert.equal(state.readStarted, false, 'no read of a page with every chunk blocked');
  assert.deepEqual(
    findings.map((each) => [each.gate, each.rule]),
    [['runner', 'own-scripts']],
    'one runner finding, own-scripts',
  );
});
