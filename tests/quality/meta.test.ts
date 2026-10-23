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
    'runner/no-javascript-scripting-media',
    'transparency/nav-over-image',
    'occlusion/grain-overlay',
    // 11-4: what only a sharded run's shards together show.
    'merged-verdict/whole-run',
    'merged-verdict/zero-tests-every-shard',
    'merged-verdict/plan-coverage-in-no-shard',
    'merged-verdict/canary-probe-missing-in-no-shard',
    'merged-verdict/missing-shard',
    'release/matrix-failed',
    'release/release-gate-failed',
    'manual-runs/repository',
    'manual-runs/templates-filled',
    'manual-runs/template-unfilled',
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
