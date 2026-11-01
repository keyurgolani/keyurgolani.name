import test from 'node:test';
import assert from 'node:assert/strict';
import {
  curveOf,
  dropInsets,
  durationMs,
  easeTime,
  POUR_CAP_MS,
  POUR_FIRST,
  REPEAT_MS,
  pours,
  slowDevice,
  STUCK_MS,
  stretchOf,
  supportsPopover,
  takeFolds,
  turnShare,
  underDrop,
  WAIT_MS,
} from './tabs';

// The tab bar's drop as geometry: its clip is a tab's box inside the bar's,
// as physical insets whatever the page's direction, and a stretch covers
// both tabs before it snaps to the new one.

test('the drop clips to a tab by its insets from the bar', () => {
  assert.deepEqual(dropInsets({ left: 120, right: 200 }, { left: 100, right: 900 }), {
    left: 20,
    right: 700,
  });
});

test('a stretch covers both tabs, either way round', () => {
  const work = { left: 100, right: 600 };
  const about = { left: 400, right: 300 };
  assert.deepEqual(stretchOf(work, about), { left: 100, right: 300 });
  assert.deepEqual(stretchOf(about, work), { left: 100, right: 300 });
});

test('the words the drop lies under take the inverse ink: the place, and every tab a stretch spans', () => {
  const bar = { left: 100, right: 900 };
  const name = { left: 100, right: 230, width: 130 };
  const work = { left: 234, right: 307, width: 73 };
  const writing = { left: 311, right: 399, width: 88 };
  // Landed on Work: Work alone.
  const onWork = dropInsets(work, bar);
  assert.deepEqual(
    [name, work, writing].map((tab) => underDrop(tab, bar, onWork)),
    [false, true, false],
  );
  // Stretched from the name to Writing: all three, the drop over them.
  const span = stretchOf(dropInsets(name, bar), dropInsets(writing, bar));
  assert.deepEqual(
    [name, work, writing].map((tab) => underDrop(tab, bar, span)),
    [true, true, true],
  );
  // A tab with no box (a phone's hidden destination) is under nothing.
  assert.equal(underDrop({ left: 0, right: 0, width: 0 }, bar, { left: 0, right: 0 }), false);
});

test("a tab a pixel past the drop's edge is under nothing, and one inside it is", () => {
  const bar = { left: 100, right: 900 };
  const insets = dropInsets({ left: 300, right: 400 }, bar);
  assert.equal(underDrop({ left: 300, right: 400, width: 100 }, bar, insets), true);
  assert.equal(underDrop({ left: 299.5, right: 400, width: 100.5 }, bar, insets), true);
  assert.equal(underDrop({ left: 297, right: 400, width: 103 }, bar, insets), false);
  assert.equal(underDrop({ left: 300, right: 403, width: 103 }, bar, insets), false);
});

test("each word turns as the drop's moving edge passes its centre, at the time the clip's curve gets there (SF-P2-2)", () => {
  const bar = { left: 0, right: 800 };
  const name = { left: 0, right: 100, width: 100 };
  const work = { left: 104, right: 204, width: 100 };
  const writing = { left: 208, right: 308, width: 100 };
  const onName = dropInsets(name, bar);
  const onWriting = dropInsets(writing, bar);
  const span = stretchOf(onName, onWriting);
  // The stretch from the name to Writing grows its end edge 100 to 308: Work's centre (154) is
  // a quarter of the way, Writing's (258) three quarters; the name, under it already, waits.
  assert.equal(turnShare(name, bar, onName, span), undefined);
  assert.equal(turnShare(work, bar, onName, span), (154 - 100) / 208);
  assert.equal(turnShare(writing, bar, onName, span), (258 - 100) / 208);
  // The snap pulls its start edge in, 0 to 208: the name leaves at its centre, Work after it.
  assert.equal(turnShare(name, bar, span, onWriting), 50 / 208);
  assert.equal(turnShare(work, bar, span, onWriting), 154 / 208);
  assert.equal(turnShare(writing, bar, span, onWriting), undefined);
  // The time a curve takes to a share: linear is the share itself; an ease-out gets there sooner.
  assert.ok(Math.abs(easeTime(curveOf('linear'), 0.25) - 0.25) < 1e-6);
  assert.ok(Math.abs(easeTime(curveOf('cubic-bezier(0, 0, 1, 1)'), 0.6) - 0.6) < 1e-6);
  const out = curveOf('cubic-bezier(0.2, 0, 0, 1)');
  assert.ok(easeTime(out, 0.5) < 0.25, String(easeTime(out, 0.5)));
  assert.equal(easeTime(out, 0), 0);
  assert.equal(easeTime(out, 1), 1);
  assert.deepEqual(curveOf('ease-out, linear'), [0, 0, 0.58, 1]);
  assert.deepEqual(curveOf('steps(4)'), [0, 0, 1, 1]);
  assert.equal(durationMs('0.22s, 1s'), 220);
  assert.equal(durationMs('160ms'), 160);
  assert.equal(durationMs('0s'), 0);
});

test("the wipe pours before the page goes only for a plain click to home or a work's own page (SF-P2-1)", () => {
  const plain = {
    button: 0,
    defaultPrevented: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  };
  const link = (href: string, extra: Partial<{ target: string; download: boolean }> = {}) => ({
    href,
    target: '',
    download: false,
    ...extra,
  });
  const home = 'https://example.test/sample/';
  const here = 'https://example.test/sample/';
  assert.equal(pours(plain, link('https://example.test/sample/work/press'), here, home), true);
  assert.equal(
    pours(plain, link('/sample/'), 'https://example.test/sample/work/press', home),
    true,
  );
  // Not the same page, another site, a new window, a download, a modified or other button, or a
  // page outside home and its works.
  assert.equal(pours(plain, link('#fx--sheet-work'), here, home), false);
  assert.equal(pours(plain, link('https://elsewhere.test/sample/work/press'), here, home), false);
  assert.equal(pours(plain, link('/sample/work/press', { target: '_blank' }), here, home), false);
  assert.equal(pours(plain, link('/sample/work/press', { download: true }), here, home), false);
  assert.equal(pours({ ...plain, metaKey: true }, link('/sample/work/press'), here, home), false);
  assert.equal(pours({ ...plain, button: 1 }, link('/sample/work/press'), here, home), false);
  assert.equal(
    pours({ ...plain, defaultPrevented: true }, link('/sample/work/press'), here, home),
    false,
  );
  assert.equal(pours(plain, link('/studio'), here, home), false);
  assert.equal(pours(plain, link('/sample/cv.pdf'), here, home), false);
});

test('the pour holds a page 250ms at most, and a page that started to go and stays clears its ink in the end (the lead, 2026-11-01)', () => {
  assert.equal(POUR_CAP_MS, 250);
  assert.ok(STUCK_MS >= 5000 && STUCK_MS <= 15_000, String(STUCK_MS));
  // The ink names where it's going only once an answer is slow, and well before it gives up (R2).
  assert.ok(WAIT_MS >= 400 && WAIT_MS < STUCK_MS, String(WAIT_MS));
  // The watchdog is the bottom of its range (the lead's follow-up).
  assert.equal(STUCK_MS, 5000);
});

test('pour-first is off: a followed link goes at once, and the next page pours on arrival (the lead, 2026-11-01)', () => {
  // Pour-first waits on post-surge.md (E). Turning it back on takes its e2e out of fixme.
  assert.equal(POUR_FIRST, false);
  // A double press is one press; a retry, or another link, past it goes (the code re-look).
  assert.ok(REPEAT_MS >= 500 && REPEAT_MS <= 1000, String(REPEAT_MS));
});

test("the folds become the script's after the fragment lands, and give the page back on cleanup (data-fx-folds)", () => {
  const calls: string[] = [];
  const root = {
    toggleAttribute: (name: string, force: boolean) => calls.push(`set ${name} ${force}`),
    removeAttribute: (name: string) => calls.push(`remove ${name}`),
  };
  const undo = takeFolds(root, () => calls.push('land'));
  assert.deepEqual(calls, ['land', 'set data-fx-folds true']);
  undo();
  assert.deepEqual(calls, ['land', 'set data-fx-folds true', 'remove data-fx-folds']);
});

test('the Index goes live only where the browser has the Popover API', () => {
  assert.equal(supportsPopover({}), false);
  assert.equal(supportsPopover({ popover: null }), true);
});

test('the wipe cuts on a slow device: two cores or less, 2 GB or less, or data saving', () => {
  assert.equal(slowDevice({ cores: 8 }), false);
  assert.equal(slowDevice({}), false);
  assert.equal(slowDevice({ cores: 8, memory: 8 }), false);
  assert.equal(slowDevice({ cores: 2 }), true);
  assert.equal(slowDevice({ memory: 2 }), true);
  assert.equal(slowDevice({ saveData: true }), true);
});
