import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { judge, META_CASES, tableProblems, type MetaCase } from './meta/cases';

// pnpm quality:meta's frame (#11, Slice 1): a table of cases, each a known-bad
// or known-good input to one gate, judged so a known-bad input passes the
// frame only when it fails its gate for the reason it names.

const knownBad: MetaCase = {
  id: 'trial/bad',
  gate: 'trial',
  input: 'a known-bad input',
  expect: 'fail',
  reason: /^the reason/,
  run: () => ({ passed: false, findings: [] }),
};
const knownGood: MetaCase = { ...knownBad, id: 'trial/good', expect: 'pass', reason: undefined };

test('a known-bad case holds only when its gate fails it, with every finding naming its reason', () => {
  assert.equal(
    judge(knownBad, { passed: false, findings: ['the reason, once', 'the reason, twice'] }),
    null,
  );
  assert.equal(
    judge(knownBad, { passed: true, findings: [] }),
    'it should fail, and the gate passed it.',
  );
  assert.equal(
    judge(knownBad, { passed: false, findings: [] }),
    'the gate failed it without a finding, so no reason shows.',
  );
  assert.equal(
    judge(knownBad, { passed: false, findings: ['the reason', 'another reason'] }),
    'it failed for another reason than /^the reason/: another reason',
  );
  assert.equal(
    judge({ ...knownBad, reason: undefined }, { passed: false, findings: ['x'] }),
    'a known-bad case names the reason it must fail for.',
  );
});

test('a known-good case holds only when its gate passes it with no finding', () => {
  assert.equal(judge(knownGood, { passed: true, findings: [] }), null);
  assert.equal(
    judge(knownGood, { passed: false, findings: ['a problem'] }),
    'it should pass, and the gate failed it: a problem',
  );
  assert.equal(
    judge(knownGood, { passed: true, findings: ['a warning that counts'] }),
    'it passed with findings: a warning that counts',
  );
});

test('an empty table, a repeated id, or a gate without both kinds of case is refused before anything runs', () => {
  assert.deepEqual(tableProblems([]), ['The table has no case, so nothing was checked.']);
  assert.deepEqual(tableProblems([knownBad, knownGood]), []);
  assert.deepEqual(tableProblems([knownBad, knownGood, knownBad]), ['Case ids repeat: trial/bad.']);
  assert.deepEqual(tableProblems([knownBad]), [
    'The trial gate has no known-good case, so a gate that fails everything would pass.',
  ]);
  assert.deepEqual(tableProblems([knownGood, { ...knownGood, id: 'other/good', gate: 'other' }]), [
    'The trial gate has no known-bad case, so a gate that passes everything would pass.',
    'The other gate has no known-bad case, so a gate that passes everything would pass.',
  ]);
  assert.deepEqual(tableProblems(META_CASES), []);
});

test('every gate so far has a known-bad case and a known-good one, and each id is unique', () => {
  const ids = META_CASES.map(({ id }) => id);
  assert.deepEqual(ids, [...new Set(ids)]);
  for (const metaCase of META_CASES) {
    assert.match(metaCase.id, new RegExp(`^${metaCase.gate}/[a-z0-9-]+$`), metaCase.id);
    if (metaCase.expect === 'fail') assert.ok(metaCase.reason, metaCase.id);
  }
  const gates = [...new Set(META_CASES.map(({ gate }) => gate))];
  assert.deepEqual(gates, [
    'workflows',
    'exceptions',
    'appearance',
    'fixture-gate',
    'runner',
    'perf',
    'timing',
    'budgets',
    'keyboard',
    'focus',
    'occlusion',
    'hover',
    'reflow',
    'inventory',
    'enhancement',
    'motion',
    'transparency',
    'contrast',
    'axe',
    'merged-verdict',
    'sweep',
    'sweep-isolation',
    'sweep-rows',
    'release',
    'manual-runs',
  ]);
  for (const gate of gates) {
    const cases = META_CASES.filter((metaCase) => metaCase.gate === gate);
    assert.ok(
      cases.some(({ expect }) => expect === 'fail'),
      `${gate} has no known-bad case`,
    );
    assert.ok(
      cases.some(({ expect }) => expect === 'pass'),
      `${gate} has no known-good case`,
    );
  }
  // The inputs the brief names: one workflow per rule, the six exception
  // inputs, the low-contrast pack, and the leak.
  for (const id of [
    'workflows/repository',
    'workflows/pull-request-target',
    'workflows/write-permissions',
    'workflows/secrets',
    'workflows/secrets-in-string-run',
    'workflows/secrets-in-string-env',
    'workflows/yaml-directive',
    'workflows/pull-request-review',
    'workflows/pull-request-review-comment',
    'workflows/workflow-run',
    'workflows/issue-comment',
    'workflows/not-pull-request-if',
    'exceptions/repository',
    'exceptions/expired',
    'exceptions/wildcard',
    'exceptions/non-waivable',
    'exceptions/over-90-days',
    'exceptions/missing-scope',
    'exceptions/quarantine-over-14-days',
    'exceptions/low-contrast',
    'appearance/tier-packs',
    'appearance/low-contrast',
    'fixture-gate/production',
    'fixture-gate/leak',
    // The runner's fail-closed rules, a known-bad input for each.
    'runner/zero-tests-none',
    'runner/undeclared-skip-no-reason',
    'runner/missing-browser-not-installed',
    'runner/target-without-results-surface-uncollected',
    'runner/ignored-media-emulation-ignored',
    // 11-3's performance gates: the deterministic rules, the release timing
    // gate, and VR1's bundle size through #6's check.
    'perf/missing-lcp-entry',
    'perf/canvas-only',
    'perf/canvas-led-client-headline',
    'perf/canvas-led-small-headline',
    'perf/canvas-led-body-text',
    'perf/static-emulation-ignored',
    'perf/probe-good',
    'perf/probe-late-canvas',
    'perf/probe-small-text',
    'perf/probe-script-text',
    'perf/probe-frame-loop',
    'timing/rerun',
    'perf/static-frame-loop',
    'perf/static-layout',
    'timing/over',
    'timing/one-slow-load',
    'timing/retried',
    'budgets/fixture-over-budget',
    'budgets/fixture-variant-light',
    // Slice 2: VR1's known-bad fixtures but bundle size, and each new row's ignored emulation.
    'focus/no-indicator',
    'contrast/gradient',
    'axe/color-contrast',
    'motion/spinner',
    'motion/tokens-over-os',
    'motion/hover-over-os',
    'motion/kill-switch',
    'reflow/fixed-width',
    'axe/target-size',
    'axe/button-name',
    'enhancement/needs-canvas',
    'runner/ignored-high-contrast-ignored',
    'runner/ignored-reduced-transparency-ignored',
    'runner/ignored-print-ignored',
    'runner/ignored-no-javascript-ignored',
    // The 11-2 review round: each fix's known-bad, or the known-good it stopped failing.
    'focus/ring-set-out',
    'occlusion/pointer-events-footer',
    'occlusion/scroll-shown-footer',
    'keyboard/dialog-slow',
    'runner/too-many-triggers',
    'hover/too-many-hovers',
    'reflow/wider-than-320',
    'reflow/undeclared-scroller',
    'transparency/see-through-gradient',
    'contrast/past-forty',
    // #20's .pf-period: a neighbour's glyph in the sampled box, and a faint date beside it.
    'contrast/neighbour-glyphs',
    'contrast/neighbour-faint',
    'contrast/backdrop-numeral',
    // An ancestor's inherited color transition reaching a word: read once it ends (Flux's tabs).
    'contrast/inherited-paint',
    // Row 25: a color a script turns as the shots end a transition, read from one state of the
    // page; and one that never settles, unresolved, a record, never a pass.
    'contrast/script-turn',
    'contrast/timed-turn',
    'contrast/own-transition',
    'contrast/restless-ink',
    // Row 25's residual (#211): a turn a chain of timeouts makes after the drop's transition, read
    // once the word's ancestors hold still; and one whose ancestor never does, unresolved.
    'contrast/late-turn',
    'contrast/restless-ancestor',
    // Row 25's RC2 hardening: the sampler's watch bounded on a churning page.
    'contrast/turns-bounded',
    // Its own pins never the page's changes, a pending page change still kept.
    'contrast/own-pin-still',
    // High contrast at thresholds.json's 7:1: 5.5:1 text fails there and passes in normal mode.
    'axe/high-contrast-solid-5-5',
    'contrast/high-contrast-gradient-5-5',
    'contrast/contrast-more-5-5',
    'contrast/normal-5-5',
    'contrast/high-contrast-7-5',
    'runner/no-javascript-scripting-media',
    'transparency/nav-over-image',
    // Both fills read off one settled frame: a focused control's ring still settling is no
    // see-through surface (lead, 3 Nov 2026, KC's offer dialog under reduced transparency).
    'transparency/ring-settling',
    // A surface whose DOM still moves isn't settled because two shots match, and one that never
    // holds still says so (lead, 3 Nov 2026, the ring-settling case's 2-in-10 flake under load).
    'transparency/ring-script-settling',
    'transparency/ring-restless',
    // A field in the surface: the caret hidden without a style on every input at each shot, so
    // it settles and the sign rule reads it (see-through round 3b).
    'transparency/input-settles',
    'occlusion/grain-overlay',
    // 11-4: what only a sharded run's shards together show.
    'merged-verdict/whole-run',
    'merged-verdict/zero-tests-every-shard',
    'merged-verdict/plan-coverage-in-no-shard',
    'merged-verdict/canary-probe-missing-in-no-shard',
    'merged-verdict/missing-shard',
    'merged-verdict/perf-coverage-in-no-shard',
    'merged-verdict/perf-coverage-in-two-shards',
    // quality-pr's shards: a shard job that didn't succeed, and a shard of another run.
    'merged-verdict/pr-whole-run',
    'merged-verdict/shard-job-failure',
    'merged-verdict/shard-job-cancelled',
    'merged-verdict/shard-job-skipped',
    'merged-verdict/missing-shard-pr-skipped',
    'merged-verdict/missing-shard-pr-cancelled',
    'merged-verdict/shard-mismatch-pr-count',
    'release/matrix-failed',
    'release/release-gate-failed',
    'release/timing-breach',
    'manual-runs/repository',
    'manual-runs/templates-filled',
    'manual-runs/template-unfilled',
    // A condition's reload waits for a lazy enhancement to mount or fail (lead, 31 Oct 2026),
    // and failed enhancement lets a button that submits nothing wait for it, and nothing else.
    'inventory/lazy-reveal',
    // A frame loop is callbacks sustained over many frames, not one late frame (row 65).
    'motion/one-late-frame',
    'motion/double-raf-once',
    'runner/lazy-never',
    'enhancement/lazy-button',
    'enhancement/lazy-link',
    'enhancement/lazy-input',
    'enhancement/lazy-submit',
    // A button that submits nothing takes its own label with it, without JavaScript, under
    // failed enhancement, and in print (lead, 1 Nov 2026), and nothing broader: a paragraph,
    // a link's text, a submit button's label, and a link styled as a button still count.
    'inventory/button-label',
    'enhancement/button-label',
    'inventory/hidden-text',
    'enhancement/hidden-text',
    'inventory/hidden-link-text',
    'enhancement/hidden-link-text',
    'inventory/submit-label',
    'enhancement/submit-label',
    'inventory/link-button-label',
    'enhancement/link-button-label',
    // A same-document skip link is a control, and a block of such controls and a short label
    // goes with them, without JavaScript, under failed enhancement, and in print (lead, 1 Nov
    // 2026, for Swiss's Back to the top), and nothing broader: a link to a section, a paragraph
    // of its own words beside a button, and a short label beside a real link still count.
    'inventory/skip-link',
    'enhancement/skip-link',
    'inventory/control-label',
    'enhancement/control-label',
    'inventory/fragment-link',
    'enhancement/fragment-link',
    'inventory/own-words-and-button',
    'enhancement/own-words-and-button',
    'inventory/label-and-link',
    'enhancement/label-and-link',
    // Words on a live status marked data-script-only go the same way (lead, 3 Nov 2026, for HC's
    // position status), on role="status" and on an aria-live region, and nothing broader: the
    // status unmarked, the mark on an ordinary element or an aria-live="off" one (the mark counts
    // only on a live status, lead, 6 Nov 2026), and a link, a heading or a control inside a
    // marked status still count.
    'inventory/script-only',
    'enhancement/script-only',
    'inventory/script-only-live',
    'enhancement/script-only-live',
    'inventory/unmarked-status',
    'enhancement/unmarked-status',
    // The mark is what counts, on the live element itself (the coordinator, 7 Nov 2026, F3): an
    // unmarked live region, a status inside a marked element that isn't one, and a marked
    // element inside a live region still count; a marked live region's server words are a
    // finding too.
    'inventory/unmarked-live',
    'enhancement/unmarked-live',
    'inventory/script-only-outer-mark',
    'enhancement/script-only-outer-mark',
    'inventory/script-only-inner-mark',
    'enhancement/script-only-inner-mark',
    'inventory/script-only-live-server-words',
    'inventory/script-only-hidden-server-words',
    'inventory/script-only-ordinary',
    'enhancement/script-only-ordinary',
    'inventory/script-only-live-off',
    'enhancement/script-only-live-off',
    'inventory/script-only-link',
    'enhancement/script-only-link',
    // Live as ARIA reads it (the coordinator, 7 Nov 2026, F2): a status with an empty aria-live,
    // and aria-live=" Polite ", are live; an empty, "OFF" or unknown aria-live, and a status
    // with aria-live="off", aren't.
    'inventory/script-only-status-empty-live',
    'enhancement/script-only-status-empty-live',
    'inventory/script-only-live-cased',
    'enhancement/script-only-live-cased',
    'inventory/script-only-live-empty',
    'enhancement/script-only-live-empty',
    'inventory/script-only-live-upper-off',
    'enhancement/script-only-live-upper-off',
    'inventory/script-only-live-bogus',
    'enhancement/script-only-live-bogus',
    'inventory/script-only-status-off',
    'enhancement/script-only-status-off',
    // Text only: a block holding a link or a control, and a heading, inside a marked status still
    // count; and a marked status holding the server's own words is a finding by name (the
    // coordinator, 6 Nov 2026).
    'inventory/script-only-block-link',
    'enhancement/script-only-block-link',
    'inventory/script-only-heading',
    'enhancement/script-only-heading',
    'inventory/script-only-control',
    'enhancement/script-only-control',
    // Whatever the kind (the coordinator, 7 Nov 2026, F4): an image, a submit button, or a
    // focusable span in the block.
    'inventory/script-only-image',
    'enhancement/script-only-image',
    'inventory/script-only-submit',
    'enhancement/script-only-submit',
    'inventory/script-only-tabindex',
    'enhancement/script-only-tabindex',
    'inventory/script-only-server-words',
    // Judged against the page with its script: server words a script makes live, marks, or moves
    // into a marked status are a finding too (the coordinator, 7 Nov 2026, F1).
    'inventory/script-only-role-by-script',
    'inventory/script-only-mark-by-script',
    'inventory/script-only-moved',
    // And on a surface that needs its script (F6).
    'inventory/script-only-requires-script',
    // Each reflow condition reads the page once its enhancements have settled, before its root
    // text (push 3, row 50), and so does the landscape occlusion pass (push 3, run-cell.ts:293).
    'reflow/late-overflow',
    'occlusion/late-occluder',
    // And waits out React's Suspense retry when the page changed during the wait (push 3 r2, F1).
    'reflow/suspense-retry',
    // From a chunk that landed before the wait, and on a held page flipped twice (push 3 r3).
    'reflow/suspense-retry-early',
    'reflow/held-flip',
    // With the chunk's tag kept, as Turbopack keeps it, and from the later of two early chunks
    // (push 3 r4's pins).
    'reflow/suspense-retry-early-removed-tag',
    'reflow/suspense-retry-two-early',
    // A chunk that failed before the wait and was asked for again, after a 404 or at the network,
    // and failed enhancement letting the page's own chunk through and waiting out a late reveal
    // (push 3 r5's pins and r5c's).
    'reflow/suspense-retry-failed-250',
    'reflow/suspense-retry-failed-590',
    'reflow/suspense-retry-aborted-590',
    'enhancement/own-chunk',
    'enhancement/lazy-link-late-reveal',
    // A page that never settles is no skip: STILL_ENHANCING under each reflow condition and in the
    // landscape pass, and STILL_BUSY there, each at its own viewport (push 3 r2, F2, F3 and F4).
    'reflow/never-enhanced',
    'occlusion/landscape-never-enhanced',
    'occlusion/landscape-still-busy',
    // A row's main pass audits the page once its enhancements have mounted or failed (lead,
    // 1 Nov 2026): a pale plain link a late chunk hides passes, a pale live button it shows fails.
    'contrast/pre-live-node',
    'axe/low-after-live',
  ]) {
    assert.ok(ids.includes(id), id);
  }
});

// The unit job has no browser, so this runs the cases that need none; the
// quality-meta job runs every case, in the Playwright image.
test('pnpm quality:meta --no-browser passes on the repository, every case it runs going the way it should', () => {
  const tsx = createRequire(import.meta.url).resolve('tsx/cli');
  const script = fileURLToPath(new URL('./meta/run.ts', import.meta.url));
  const run = spawnSync(process.execPath, [tsx, script, '--no-browser'], { encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const cases = META_CASES.filter(({ browser }) => !browser);
  const left = META_CASES.length - cases.length;
  assert.ok(left > 0, 'some cases launch Chromium');
  const ok = run.stdout.split('\n').filter((line) => line.startsWith('[quality:meta] ok '));
  assert.equal(ok.length, cases.length);
  assert.match(
    run.stdout,
    new RegExp(
      `\\[quality:meta\\] ${cases.length} cases over ${new Set(cases.map(({ gate }) => gate)).size} gates: ${cases.filter(({ expect }) => expect === 'fail').length} known-bad inputs failing for the reason each names, and ${cases.filter(({ expect }) => expect === 'pass').length} known-good inputs passing\\.\\n\\[quality:meta\\] --no-browser left out ${left} cases that launch Chromium\\.`,
    ),
  );
  for (const args of [['--all'], ['--no-browser', '--all']]) {
    const usage = spawnSync(process.execPath, [tsx, script, ...args], { encoding: 'utf8' });
    assert.equal(usage.status, 2, args.join(' '));
  }
});

// Harness push 2's follow-up, in a block of its own (push 3 edits this file too).
test("harness push 2's follow-up cases are in the table: row 65's slow loop and INV-N1's four field shapes", () => {
  const ids = META_CASES.map(({ id }) => id);
  for (const id of [
    'motion/loop-every-250ms',
    'inventory/script-only-as-link',
    'inventory/script-only-as-submit',
    'inventory/script-only-as-heading',
    'inventory/script-only-as-image-alt',
  ]) {
    assert.ok(ids.includes(id), id);
  }
});

// Row 92, in a block of its own (push 3 and row 91 edit this file too).
test("row 92's cases are in the table: print reads the live page, and the key hint's passes and guards", () => {
  const ids = META_CASES.map(({ id }) => id);
  for (const id of [
    'inventory/print-reads-live',
    'inventory/key-hint-touch',
    'inventory/key-hint-no-javascript',
    'inventory/key-hint-print',
    'inventory/key-hint-no-id',
    'inventory/key-hint-dangling',
    'inventory/key-hint-dangling-print',
    'inventory/key-hint-control-touch-hidden',
    'inventory/key-hint-control-scriptless-hidden',
    'inventory/key-hint-not-a-control',
    'inventory/key-hint-unmarked',
    'inventory/key-hint-no-kbd',
    'inventory/key-hint-link-inside',
    'inventory/key-hint-mark-on-text',
    'inventory/key-hint-mark-on-wrapper',
    'inventory/key-hint-server-words',
    'inventory/requires-script-print-reads-notice',
  ]) {
    assert.ok(ids.includes(id), id);
  }
});
