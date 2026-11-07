import assert from 'node:assert/strict';
import test from 'node:test';
import type { Page } from '@playwright/test';
import { load, reflowFindings } from './lib/a11y/conditions';

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
      // The scripts the page's HTML loads itself, which the floor's seed leaves out: none here.
      if (source.includes('document.scripts')) return [];
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
      if (source.includes('document.scripts')) return [];
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
