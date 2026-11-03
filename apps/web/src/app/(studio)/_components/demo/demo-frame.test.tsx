import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULTS } from '~/lib/demo/test-support';
import { frameDocument } from '~/lib/demo/url-state';
import type { ToFramePayload } from '~/preview/protocol';
import { TOKEN } from '~/preview/protocol';
import { MAX_LIVE, SETTLE_MS } from '~/lib/studio/preview-scheduler';
import {
  appearanceKey,
  frameLoad,
  needsLoad,
  nonceSource,
  PENDING_MS,
  plateMotion,
  sendInPlace,
  sendMotion,
  SwapMark,
  SwapPending,
  underNext,
} from './demo-frame';
import { LOADING_TEXT } from './frame-gate';

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

// What Demo Studio's /sample frame takes in place and what loads it again
// (DEM-2), without a browser: each document it loads has a nonce of its own
// in its fragment, unless its source has a fragment already; a change to the
// document itself loads it, and an appearance goes over the channel when one
// is open, or loads it once the run settles when none is.
// demo-studio-split.spec.ts has the same in the browser.

const APPEARANCE: ToFramePayload<'appearance'> = {
  designLanguage: {
    id: 'platform-neutral',
    stylesheet: '/_portfolio/pack/platform-neutral.0123456789ab.css',
  },
  colorScheme: { id: 'paper-ink', stylesheet: '/_portfolio/pack/paper-ink.0123456789ab.css' },
  typography: { id: 'humanist-ui', stylesheet: '/_portfolio/pack/humanist-ui.0123456789ab.css' },
  displayMode: 'dark',
};

/** A channel that records what it sends, open or not. */
function fakeChannel(connected: boolean, refuses = false) {
  const sent: Array<{ type: string; payload: unknown }> = [];
  return {
    sent,
    connected,
    send(type: string, payload: unknown) {
      if (refuses) throw new TypeError('The preview protocol refuses this message.');
      if (!connected) return false;
      sent.push({ type, payload });
      return true;
    },
  };
}

test('each document the frame loads carries a nonce of its own in its fragment, and a source with a fragment of its own keeps it and takes none (DEM-2)', () => {
  const first = frameLoad('/sample?scheme=paper-ink', 'doc', 'shows');
  const second = frameLoad('/sample?scheme=paper-ink', 'doc', 'shows');
  assert.ok(first.nonce !== null && TOKEN.test(first.nonce));
  assert.notEqual(first.nonce, second.nonce, 'a new one each load');
  assert.equal(first.src, `/sample?scheme=paper-ink#nonce=${first.nonce}`);
  const work = frameLoad('/sample?scheme=paper-ink#work', 'doc', 'shows');
  assert.equal(work.nonce, null);
  assert.equal(work.src, '/sample?scheme=paper-ink#work');
  assert.equal(
    nonceSource('/reference', 'NnNnNnNnNnNnNnNnNnNnNn'),
    '/reference#nonce=NnNnNnNnNnNnNnNnNnNnNn',
  );
  assert.equal(nonceSource('/sample', null), '/sample');
});

test('a scheme, typography, design language, or display mode leaves the document as it is; a composition, motion, source, or page is another document (DEM-2)', () => {
  const base = frameDocument(DEFAULTS);
  for (const axis of ['colorScheme', 'typography', 'designLanguage', 'displayMode'] as const) {
    assert.equal(frameDocument({ ...DEFAULTS, [axis]: `${DEFAULTS[axis]}-other` }), base, axis);
  }
  assert.notEqual(frameDocument({ ...DEFAULTS, variant: 'another-variant' }), base);
  assert.notEqual(frameDocument(DEFAULTS, { reduceMotion: true }), base);
  assert.notEqual(frameDocument(DEFAULTS, { source: 'reference' }), base);
  assert.notEqual(frameDocument(DEFAULTS, { page: { kind: 'work' } }), base);
  assert.notEqual(
    frameDocument(DEFAULTS, { page: { kind: 'case', slug: 'one' } }),
    frameDocument(DEFAULTS, { page: { kind: 'case', slug: 'two' } }),
  );
  assert.equal(frameDocument(DEFAULTS, { page: { kind: 'home' } }), base);
});

test('a settled change loads a new document only for another document, or for an appearance the document does not show (DEM-2)', () => {
  const load = { document: 'doc' };
  assert.equal(needsLoad(load, 'a', { document: 'doc', shows: 'a' }), false);
  assert.equal(needsLoad(load, 'b', { document: 'doc', shows: 'b' }), false, 'it went in place');
  assert.equal(
    needsLoad(load, 'a', { document: 'doc', shows: 'b' }),
    true,
    "it couldn't go in place",
  );
  assert.equal(needsLoad(load, 'a', { document: 'other', shows: 'a' }), true);
});

test("an appearance goes in place only over an open channel, only one the frame doesn't show, and never one the protocol refuses (DEM-2)", () => {
  const key = appearanceKey(APPEARANCE);
  assert.equal(appearanceKey(null), '');
  const open = fakeChannel(true);
  assert.equal(sendInPlace(open, APPEARANCE, key, ''), true);
  assert.deepEqual(open.sent, [{ type: 'appearance', payload: APPEARANCE }]);
  assert.equal(sendInPlace(open, APPEARANCE, key, key), false, 'it shows it already');
  assert.equal(sendInPlace(open, null, '', key), false, 'none it can take in place');
  assert.equal(open.sent.length, 1);
  const closed = fakeChannel(false);
  assert.equal(sendInPlace(closed, APPEARANCE, key, ''), false);
  assert.equal(sendInPlace(null, APPEARANCE, key, ''), false);
  assert.equal(sendInPlace(fakeChannel(true, true), APPEARANCE, key, ''), false);
});

test("a plate's motion goes in place over an open channel alone, once a change, never full under the visitor's reduced-motion preview, and never one the protocol refuses (kgn-e/compare-perf)", () => {
  assert.equal(plateMotion(true, false), 'full');
  assert.equal(plateMotion(true, true), 'reduced', "the visitor's reduce wins over the heavy slot");
  assert.equal(plateMotion(false, false), 'reduced');
  assert.equal(plateMotion(false, true), 'reduced');
  const open = fakeChannel(true);
  assert.equal(sendMotion(open, 'full', null), 'full');
  assert.equal(sendMotion(open, 'full', 'full'), 'full', 'sent already: nothing goes');
  assert.equal(sendMotion(open, 'reduced', 'full'), 'reduced');
  assert.equal(sendMotion(open, null, 'reduced'), 'reduced', 'no motion to send');
  assert.deepEqual(open.sent, [
    { type: 'motion', payload: { motion: 'full' } },
    { type: 'motion', payload: { motion: 'reduced' } },
  ]);
  assert.equal(sendMotion(fakeChannel(false), 'full', null), null, 'closed');
  assert.equal(sendMotion(null, 'full', null), null);
  assert.equal(sendMotion(fakeChannel(true, true), 'full', null), null, 'refused');
});

test('each load is one of its own, by its id, even for a source a frame had before (P-5 slice 4)', () => {
  const first = frameLoad('/sample?scheme=paper-ink#work', 'doc', 'shows');
  const again = frameLoad('/sample?scheme=paper-ink#work', 'doc', 'shows');
  assert.equal(first.src, again.src, 'no nonce tells them apart');
  assert.notEqual(first.id, again.id);
});

test('a double-buffered stage keeps the document on screen under the next until the next has painted: two frames at most, never none once one showed, and never a frame it had let go (P-5 slice 4, C P1-F and P2-5)', () => {
  // The stage as DemoFrame runs it: the latest load, the one kept under it, and which has loaded.
  type Load = ReturnType<typeof frameLoad>;
  let current: Load = frameLoad('/sample?variant=a', 'a', '');
  let under: Load | null = null;
  let loaded: number | null = null;
  const everMounted = new Set<number>([current.id]);
  let shownOnce = false;
  const frames = () => [under, current].filter((each): each is Load => each !== null);
  const check = (step: string) => {
    const now = frames();
    assert.ok(now.length <= MAX_LIVE, `${step}: within MAX_LIVE`);
    // A kept frame is one the stage already had, so keeping it never loads it again.
    if (under !== null) assert.ok(everMounted.has(under.id), `${step}: kept, not remounted`);
    // Once a document showed, one is always on screen: the latest loaded, or the one under it.
    if (shownOnce) assert.ok(loaded === current.id || under !== null, `${step}: never blank`);
  };
  const replace = (src: string) => {
    under = underNext({ twin: true, current, mounted: true, loaded, under });
    current = frameLoad(src, src, '');
    everMounted.add(current.id);
    check(`replace with ${src}`);
  };
  const load = () => {
    loaded = current.id;
    shownOnce = true;
    check('load');
  };
  const paint = () => {
    if (loaded === current.id) under = null;
    check('paint');
  };

  // The first document: nothing to keep, one frame, hidden until it loads.
  check('start');
  assert.equal(under, null);
  load();
  paint();
  const a = current;
  // A pick: A stays under B while B loads.
  replace('b');
  assert.equal(under, a);
  // Another pick while B still loads: A still, and B's frame goes, so two.
  replace('c');
  assert.equal(under, a);
  assert.equal(frames().length, 2);
  // C loads, and is painted: C alone.
  load();
  paint();
  assert.deepEqual(frames(), [current]);
  // D loads and shows, and a pick lands before its paint lets C go: D, on screen, is kept, not C.
  replace('d');
  const c = under;
  load();
  replace('e');
  assert.notEqual(under, c, 'D, loaded and on screen, is the one kept');
  assert.equal((under as Load | null)?.document, 'd');
  load();
  paint();
  assert.equal(under, null);

  // Compare's frames and the Grid's plates don't double-buffer: one frame each, as before.
  assert.equal(
    underNext({ twin: false, current, mounted: true, loaded: current.id, under: null }),
    null,
  );
  // A frame that isn't mounted, as a refused source's isn't, is never kept.
  assert.equal(
    underNext({ twin: true, current, mounted: false, loaded: current.id, under: null }),
    null,
  );
});

test("a double-buffered stage's pending state: its mark says the preview is loading, hidden from readers, who hear the same in a polite live region, no second status, outside the stage's aria-busy, there and empty until then", () => {
  assert.equal(
    renderToStaticMarkup(<SwapPending shown={false} />),
    '<p class="studio-visually-hidden demo-frame__status" aria-live="polite"></p>',
  );
  assert.equal(
    renderToStaticMarkup(<SwapPending shown />),
    `<p class="studio-visually-hidden demo-frame__status" aria-live="polite">${LOADING_TEXT}</p>`,
  );
  assert.equal(
    renderToStaticMarkup(<SwapMark />),
    `<span class="demo-frame__pending" aria-hidden="true">${LOADING_TEXT}</span>`,
  );
  // The mark waits past the show-delay as well, so a pick that loads at once never flashes it.
  assert.ok(PENDING_MS > 0 && PENDING_MS < SETTLE_MS);
});
