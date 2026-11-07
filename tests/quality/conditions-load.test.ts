import assert from 'node:assert/strict';
import test from 'node:test';
import type { Page } from '@playwright/test';
import { load } from './lib/a11y/conditions';

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
