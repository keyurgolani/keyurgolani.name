// The quality runner's cases for `pnpm quality:meta` (#11, Slice 1, items 7,
// 8, and 11): a known-bad and a known-good input for each fail-closed rule,
// appended to META_CASES (cases.ts). Each runs the check the quality runs
// use, not a copy: the verdict over summary.json (lib/verdict.ts), the
// missing-browser launch, the emulation check, the browser policy, the
// socket guard beside the egress trap, and the artifact scrub and scan. A
// verdict case's findings are every failure the verdict gives, so a
// known-bad input is built to break its one rule and no other: take the
// rule away and the case goes the wrong way. The cases marked `browser`
// launch Chromium; pnpm test runs quality:meta with --no-browser, since the
// unit job has none, and the quality-meta job runs them all.

import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Summary, SummaryTest } from '../reporter';
import { plantCanary, scanArtifacts, scrubArtifacts, writeZip } from '../lib/artifacts.mjs';
import { CANARY_FORMS, everyForm, UNKNOWN_FORM } from '../lib/canary-forms.mjs';
import { requiredChecks, VISUAL_CHECKS } from '../lib/checks';
import { checkEmulation } from '../lib/emulation';
import { egressFailure, installBrowserPolicy, serverEgressFailure } from '../lib/egress';
import { PREFERENCE_ROWS } from '../lib/matrix';
import { judge as verdictOf, type VerdictInput, type VerdictTest } from '../lib/verdict';
import { startEgressTrap } from '../../harness/egress-trap.mjs';
import { TRACE_LAUNCH_ARGS } from '../../harness/trace/policy.mjs';
import type { MetaCase, MetaOutcome } from './cases';

const QUALITY = fileURLToPath(new URL('../', import.meta.url));
const GATE = 'runner';

const HARNESS = 'chromium harness';
const CELLS = 'chromium c946a80325';
const CELL =
  'composition:fallback complete / fallback/platform-neutral/warm-parchment/humanist-ui/system';
const STAND_IN = 'Stand-in until #1 and #3 can make a revision unavailable on demand.';

/** Three planned tests of one cell: two that run, and one whose state skips it. */
const RUNS: VerdictTest = {
  cell: { id: CELL },
  viewport: { id: '1440x900' },
  row: { id: 'default' },
  engineSkips: {},
};
const ALSO_RUNS: VerdictTest = { ...RUNS, viewport: { id: '1024x768' } };
/** A Slice 2 row's test, which owes the row's own checks. */
const REDUCED_MOTION: VerdictTest = { ...RUNS, row: { id: 'reduced-motion' } };
const SKIPS: VerdictTest = { ...RUNS, viewport: { id: '390x844' }, skip: STAND_IN };

/** A passing cell test of the fallback composition, as the reporter lists one. */
function cellTest(planned: VerdictTest = RUNS, overrides: Partial<SummaryTest> = {}): SummaryTest {
  return {
    title: `fallback complete / at ${planned.viewport.id}, ${planned.row.id}`,
    file: 'tests/quality/cells.spec.ts',
    line: 35,
    project: CELLS,
    engine: 'chromium',
    kind: 'cell',
    cell: planned.cell.id,
    target: 'composition:fallback',
    route: '/',
    viewport: planned.viewport.id,
    row: planned.row.id,
    outcome: 'expected',
    expectedStatus: 'passed',
    status: 'passed',
    skipReason: null,
    checks: requiredChecks('default', '1440x900'),
    canaryProbe: false,
    errors: [],
    records: 0,
    ...overrides,
  };
}

const SKIPPED = { outcome: 'skipped', status: 'skipped', expectedStatus: 'skipped' } as const;

/** The planned skip, with its own reason. */
const skippedTest = (overrides: Partial<SummaryTest> = {}) =>
  cellTest(SKIPS, { ...SKIPPED, skipReason: STAND_IN, ...overrides });

/** The canary probe, passed. */
const PROBE: SummaryTest = {
  ...cellTest(),
  title: 'every request the page makes carries the canary',
  file: 'tests/quality/canary.spec.ts',
  project: HARNESS,
  kind: undefined,
  cell: undefined,
  target: undefined,
  viewport: undefined,
  row: undefined,
  checks: [],
  canaryProbe: true,
};

/** A visual test of the cell, passed with its checks. */
const VISUAL: SummaryTest = {
  ...cellTest(),
  title: 'fallback complete at 1440x900, seeded, in the pinned image',
  file: 'tests/quality/visual.spec.ts',
  kind: 'visual',
  row: undefined,
  checks: [...VISUAL_CHECKS],
};

function summary(tests: readonly SummaryTest[], overrides: Partial<Summary> = {}): Summary {
  return {
    schemaVersion: 1,
    mode: 'pr',
    shard: null,
    status: 'passed',
    projects: [
      { name: HARNESS, browserName: 'chromium' },
      { name: CELLS, browserName: 'chromium' },
    ],
    tests,
    errors: [],
    ...overrides,
  };
}

const PLAN: VerdictInput['plan'] = {
  targets: [{ kind: 'composition', id: 'fallback' }],
  tests: [RUNS, ALSO_RUNS, SKIPS],
};

const HELD = { file: 'results/canary/trace.zip', entry: 'trace.network', canary: 'the run canary' };

/**
 * A run that's fine: one target, its planned tests each run once on
 * Chromium with every check or skipped with its own reason, the canary
 * probe passed, and its trace held the canary until the scrub.
 */
const CLEAN: VerdictInput = {
  plan: PLAN,
  engines: ['chromium'],
  summary: summary([cellTest(), cellTest(ALSO_RUNS), skippedTest(), PROBE]),
  missingBrowsers: [],
  canary: { before: [HELD], after: [] },
};

/** CLEAN's tests with `change` made, the probe kept. */
const cleanWith = (
  change: (tests: SummaryTest[]) => SummaryTest[],
  overrides: Partial<Summary> = {},
) => summary(change([cellTest(), cellTest(ALSO_RUNS), skippedTest()]).concat(PROBE), overrides);

/** The verdict on `input`, every failure a finding. */
function verdictOutcome(input: Partial<VerdictInput>): MetaOutcome {
  const verdict = verdictOf({ ...CLEAN, ...input });
  return {
    passed: verdict.ok,
    findings: verdict.failures.map(({ rule, message }) => `${rule}: ${message}`),
  };
}

/** A case fed to the verdict. A known-bad one must fail on `rule` alone. */
function verdictCase(
  rule: string,
  slug: string,
  input: string,
  expect: MetaCase['expect'],
  verdictInput: Partial<VerdictInput>,
): MetaCase {
  return {
    id: `${GATE}/${rule}-${slug}`,
    gate: GATE,
    input,
    expect,
    reason: expect === 'fail' ? new RegExp(`^${rule}: `) : undefined,
    run: () => verdictOutcome(verdictInput),
  };
}

/** The missing-browser check in a child, with `env` added, fed to the verdict with a clean summary. */
function launchOutcome(env: Record<string, string>): MetaOutcome {
  const result = spawnSync(
    process.execPath,
    [path.join(QUALITY, 'lib', 'browsers.mjs'), 'chromium'],
    { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 120_000 },
  );
  let missing: VerdictInput['missingBrowsers'];
  try {
    missing = (JSON.parse(result.stdout) as { missing: VerdictInput['missingBrowsers'] }).missing;
  } catch {
    return { passed: false, findings: [`the check printed no report: ${result.stderr.trim()}`] };
  }
  return verdictOutcome({
    missingBrowsers: missing,
    summary: missing.length > 0 ? null : CLEAN.summary,
  });
}

/** A loopback server that answers every request with `answer`. */
async function standInHost(
  answer: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ origin: string; server: Server }> {
  const server = createServer(answer);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

/** A host's answer: `html`. */
const page = (html: string) => (_request: IncomingMessage, response: ServerResponse) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(html);
};

const PAGE =
  '<!doctype html><html lang="en"><head><title>Stand-in</title></head><body><main><h1>Stand-in</h1></main></body></html>';

/** The emulation check on the reduced-motion row, with the context emulating it or not. */
async function emulationOutcome(emulated: boolean): Promise<MetaOutcome> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext(emulated ? { reducedMotion: 'reduce' } : {});
    const tab = await context.newPage();
    await tab.setContent(PAGE);
    const row = PREFERENCE_ROWS.find((each) => each.id === 'reduced-motion')!;
    const problems = await checkEmulation(tab, row);
    return { passed: problems.length === 0, findings: problems };
  } finally {
    await browser.close();
  }
}

/** The browser policy on a page from a loopback host, as the quality config launches Chromium. */
async function browserEgressOutcome(
  answer: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<MetaOutcome> {
  const { chromium } = await import('playwright');
  const { origin, server } = await standInHost(answer);
  const browser = await chromium.launch({ args: [...TRACE_LAUNCH_ARGS] });
  try {
    const context = await browser.newContext();
    const blocked = await installBrowserPolicy(context, origin);
    const tab = await context.newPage();
    // A redirect off the machine fails to load, since Chromium resolves no outside name.
    await tab.goto(`${origin}/`).catch(() => undefined);
    await tab.waitForLoadState('load').catch(() => undefined);
    const failure = egressFailure(blocked);
    return { passed: failure === null, findings: failure ? [failure.split('\n')[0]!] : [] };
  } finally {
    await browser.close();
    server.close();
  }
}

/**
 * The socket guard and the trap on a child that opens a socket to an
 * outside host, or doesn't. The child runs while this process keeps
 * serving the trap, which the guard reports the refused socket to.
 */
async function serverEgressOutcome(outside: boolean): Promise<MetaOutcome> {
  const trap = await startEgressTrap();
  const guard = new URL('../../harness/egress-guard.mjs', import.meta.url).href;
  try {
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        outside
          ? "import net from 'node:net'; await new Promise((done) => { const s = net.connect(443, '192.0.2.9'); s.on('error', done); s.on('connect', done); });"
          : "import net from 'node:net'; const s = net.createServer().listen(0, '127.0.0.1', () => { const c = net.connect(s.address().port, '127.0.0.1', () => { c.end(); s.close(); }); });",
      ],
      {
        env: {
          PATH: process.env.PATH ?? '',
          ...trap.env,
          NODE_OPTIONS: `${trap.env.NODE_OPTIONS} --import=${guard}`,
        },
        stdio: 'ignore',
      },
    );
    const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
    await once(child, 'close');
    clearTimeout(timer);
  } finally {
    await trap.close();
  }
  const failure = serverEgressFailure(trap.attempts());
  return { passed: failure === null, findings: failure ? [failure] : [] };
}

/**
 * The scrub, by its rules alone, and the scan, fed to the verdict: a trace,
 * a server log, and summary.json holding the canary in every form a run
 * writes one (lib/canary-forms.mjs), and, for `unknown`, once more in a form
 * no rule knows.
 */
async function canaryOutcome(scrub: 'none' | 'rules' | 'unknown'): Promise<MetaOutcome> {
  const dir = mkdtempSync(path.join(tmpdir(), 'quality-meta-canary-'));
  try {
    const canary = plantCanary();
    mkdirSync(path.join(dir, 'results'));
    await writeZip(path.join(dir, 'results', 'trace.zip'), [
      {
        name: 'trace.network',
        bytes: Buffer.from(CANARY_FORMS['header-pair']![0]!(canary)),
        mtime: new Date(0),
      },
      { name: 'trace.trace', bytes: Buffer.from(everyForm(canary)), mtime: new Date(0) },
    ]);
    writeFileSync(
      path.join(dir, 'server.log'),
      `${CANARY_FORMS['header-line']![0]!(canary)}${scrub === 'unknown' ? UNKNOWN_FORM(canary) : ''}`,
    );
    writeFileSync(path.join(dir, 'summary.json'), CANARY_FORMS['header-line']![4]!(canary));
    const canaries = [{ label: 'the run canary', value: canary }];
    const before = await scanArtifacts(dir, canaries);
    // Never the canary's own value: only the rules may take it out.
    if (scrub !== 'none') await scrubArtifacts(dir);
    const after = await scanArtifacts(dir, canaries);
    return verdictOutcome({ canary: { before, after } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const RUNNER_CASES: readonly MetaCase[] = [
  // zero collected tests. With no target or test planned, nothing else catches it.
  verdictCase(
    'zero-tests',
    'none',
    'a run that collected no test, with nothing planned to miss',
    'fail',
    {
      plan: { targets: [], tests: [] },
      summary: summary([]),
    },
  ),
  verdictCase('zero-tests', 'some', 'a run that collected its planned tests', 'pass', {}),

  // what ran against the plan
  verdictCase('plan-coverage', 'dropped', 'a planned cell test that never ran', 'fail', {
    summary: cleanWith((tests) => tests.filter((test) => test.viewport !== '1024x768')),
  }),
  verdictCase('plan-coverage', 'twice', 'a planned cell test that ran twice', 'fail', {
    summary: cleanWith((tests) => [...tests, cellTest()]),
  }),
  verdictCase('plan-coverage', 'unplanned', 'a cell test the plan has no entry for', 'fail', {
    summary: cleanWith((tests) => [...tests, cellTest({ ...RUNS, row: { id: 'forced-colors' } })]),
  }),
  verdictCase(
    'plan-coverage',
    'one-engine',
    'a run planning Chromium and Firefox whose tests ran on Chromium alone',
    'fail',
    { engines: ['chromium', 'firefox'] },
  ),
  verdictCase(
    'plan-coverage',
    'sharded',
    "a shard holding only some of the plan's tests, each once",
    'pass',
    { summary: cleanWith((tests) => tests.slice(0, 1), { shard: '1/2' }) },
  ),
  verdictCase(
    'plan-coverage',
    'once',
    'every planned test ran once on the planned engine',
    'pass',
    {},
  ),
  verdictCase('empty-project', 'none-collected', 'a project that collected no test', 'fail', {
    summary: cleanWith((tests) => tests, {
      projects: [
        { name: HARNESS, browserName: 'chromium' },
        { name: CELLS, browserName: 'chromium' },
        { name: 'chromium 0123456789', browserName: 'chromium' },
      ],
    }),
  }),
  verdictCase('empty-project', 'each-collected', 'every project collected a test', 'pass', {}),
  verdictCase(
    'canary-probe-missing',
    'never-ran',
    'an unsharded run whose canary probe never ran',
    'fail',
    {
      summary: summary([cellTest(), cellTest(ALSO_RUNS), skippedTest()], {
        projects: [{ name: CELLS, browserName: 'chromium' }],
      }),
    },
  ),
  verdictCase('canary-probe-missing', 'passed', 'a run whose canary probe passed', 'pass', {}),

  // a test expected to fail
  verdictCase(
    'expected-failure',
    'test-fail',
    'a cell test marked test.fail(), which failed as expected',
    'fail',
    {
      summary: cleanWith((tests) => [
        cellTest(RUNS, { expectedStatus: 'failed', status: 'failed' }),
        ...tests.slice(1),
      ]),
    },
  ),
  verdictCase(
    'expected-failure',
    'expected-pass',
    'every test expected to pass or to skip',
    'pass',
    {},
  ),

  // a skip without its own declared reason
  verdictCase('undeclared-skip', 'no-reason', 'the planned skip, with no reason', 'fail', {
    summary: cleanWith((tests) => [...tests.slice(0, 2), skippedTest({ skipReason: null })]),
  }),
  verdictCase('undeclared-skip', 'blank-reason', 'the planned skip, with a blank reason', 'fail', {
    summary: cleanWith((tests) => [...tests.slice(0, 2), skippedTest({ skipReason: ' ' })]),
  }),
  verdictCase(
    'undeclared-skip',
    'generic-reason',
    'the planned skip, with "n/a" for a reason',
    'fail',
    {
      summary: cleanWith((tests) => [...tests.slice(0, 2), skippedTest({ skipReason: 'n/a' })]),
    },
  ),
  verdictCase(
    'undeclared-skip',
    'undeclared-reason',
    'the planned skip, with a sentence nothing declares',
    'fail',
    {
      summary: cleanWith((tests) => [
        ...tests.slice(0, 2),
        skippedTest({ skipReason: 'It was flaky today, so it skipped.' }),
      ]),
    },
  ),
  verdictCase(
    'undeclared-skip',
    'borrowed-reason',
    "a cell test the plan runs, skipped with another test's declared reason",
    'fail',
    {
      summary: cleanWith((tests) => [
        tests[0]!,
        cellTest(ALSO_RUNS, { ...SKIPPED, skipReason: STAND_IN }),
        tests[2]!,
      ]),
    },
  ),
  verdictCase('undeclared-skip', 'own-reason', 'the planned skip, with its own reason', 'pass', {}),

  // a missing browser
  verdictCase(
    'missing-browser',
    'not-launching',
    "an engine the run plans that doesn't launch, which stops the run before Playwright",
    'fail',
    {
      missingBrowsers: [
        { engine: 'chromium', error: "browserType.launch: Executable doesn't exist" },
      ],
      summary: null,
    },
  ),
  verdictCase('missing-browser', 'launching', 'every engine the run plans launches', 'pass', {}),
  {
    id: `${GATE}/missing-browser-not-installed`,
    gate: GATE,
    input: 'the launch check with PLAYWRIGHT_BROWSERS_PATH at an empty directory',
    expect: 'fail',
    reason: /^missing-browser: chromium doesn't launch: /,
    browser: true,
    run: () => {
      const empty = mkdtempSync(path.join(tmpdir(), 'quality-meta-browsers-'));
      try {
        return launchOutcome({ PLAYWRIGHT_BROWSERS_PATH: empty });
      } finally {
        rmSync(empty, { recursive: true, force: true });
      }
    },
  },
  {
    id: `${GATE}/missing-browser-installed`,
    gate: GATE,
    input: 'the launch check on the installed Chromium',
    expect: 'pass',
    browser: true,
    run: () => launchOutcome({}),
  },

  // a registered composition or surface with no results
  verdictCase(
    'target-without-results',
    'composition-uncollected',
    'a registered composition none of whose tests was collected',
    'fail',
    {
      summary: cleanWith((tests) => tests.map((test) => ({ ...test, target: 'surface:login' }))),
    },
  ),
  verdictCase(
    'target-without-results',
    'surface-uncollected',
    'a registered surface none of whose tests was collected',
    'fail',
    { plan: { ...PLAN, targets: [...PLAN.targets, { kind: 'surface', id: 'login' }] } },
  ),
  verdictCase(
    'target-without-results',
    'all-skipped',
    'a registered composition whose one planned test skipped, with its own reason',
    'fail',
    { plan: { ...PLAN, tests: [SKIPS] }, summary: summary([skippedTest(), PROBE]) },
  ),
  verdictCase(
    'target-without-results',
    'with-result',
    'a registered composition with a passing test',
    'pass',
    {},
  ),

  // a test that passed without every check its kind runs
  verdictCase(
    'unchecked-cell',
    'no-axe',
    'a passing cell test that never ran its axe check',
    'fail',
    {
      summary: cleanWith((tests) => [
        cellTest(RUNS, {
          checks: requiredChecks('default', '1440x900').filter((check) => check !== 'axe'),
        }),
        ...tests.slice(1),
      ]),
    },
  ),
  verdictCase(
    'unchecked-cell',
    'no-motion',
    'a passing reduced-motion cell test that never ran its motion check (#11, Slice 2)',
    'fail',
    {
      plan: { ...PLAN, tests: [...PLAN.tests, REDUCED_MOTION] },
      summary: cleanWith((tests) => [
        ...tests,
        cellTest(REDUCED_MOTION, {
          checks: requiredChecks('reduced-motion', '1440x900').filter(
            (check) => check !== 'motion',
          ),
        }),
      ]),
    },
  ),
  verdictCase(
    'unchecked-cell',
    'row-checks',
    'a passing reduced-motion cell test that ran every check its row owes',
    'pass',
    {
      plan: { ...PLAN, tests: [...PLAN.tests, REDUCED_MOTION] },
      summary: cleanWith((tests) => [
        ...tests,
        cellTest(REDUCED_MOTION, { checks: requiredChecks('reduced-motion', '1440x900') }),
      ]),
    },
  ),
  verdictCase(
    'unchecked-cell',
    'visual-no-screenshot',
    'a passing visual test that took no screenshot',
    'fail',
    {
      summary: cleanWith((tests) => [
        ...tests,
        { ...VISUAL, checks: VISUAL_CHECKS.filter((check) => check !== 'screenshot') },
      ]),
    },
  ),
  verdictCase(
    'unchecked-cell',
    'visual-every-check',
    "a passing visual test that ran its own checks, not a cell test's",
    'pass',
    { summary: cleanWith((tests) => [...tests, VISUAL]) },
  ),
  verdictCase(
    'unchecked-cell',
    'every-check',
    'a passing cell test that ran every cell check',
    'pass',
    {},
  ),

  // a failed test, and an error outside any test
  verdictCase('tests-failed', 'one-failed', 'a cell test that failed', 'fail', {
    summary: cleanWith((tests) => [
      tests[0]!,
      cellTest(ALSO_RUNS, { outcome: 'unexpected', status: 'failed' }),
      tests[2]!,
    ]),
  }),
  verdictCase('tests-failed', 'none-failed', 'every cell test passed', 'pass', {}),
  verdictCase(
    'run-errors',
    'late-egress',
    "a worker's late server egress, outside any test",
    'fail',
    {
      summary: cleanWith((tests) => tests, {
        errors: [
          'The app under test tried to reach 1 host(s) outside the machine: tcp://192.0.2.9:443',
        ],
      }),
    },
  ),
  verdictCase('run-errors', 'none', 'a run with no error outside its tests', 'pass', {}),
  verdictCase('no-summary', 'none', 'a run that wrote no summary.json', 'fail', { summary: null }),
  verdictCase('no-summary', 'written', 'a run that wrote its summary.json', 'pass', {}),

  // ignored media emulation
  {
    id: `${GATE}/ignored-media-emulation-ignored`,
    gate: GATE,
    input: 'the reduced-motion row in a context that emulates nothing',
    expect: 'fail',
    reason:
      /^reduced-motion: \(prefers-reduced-motion: reduce\) should match, but .* the emulation was ignored$/,
    browser: true,
    run: () => emulationOutcome(false),
  },
  {
    id: `${GATE}/ignored-media-emulation-emulated`,
    gate: GATE,
    input: 'the reduced-motion row in a context that emulates it',
    expect: 'pass',
    browser: true,
    run: () => emulationOutcome(true),
  },

  // egress, from the browser and from the server
  {
    id: `${GATE}/browser-egress-outside`,
    gate: GATE,
    input: 'a page that asks for an image from an outside host',
    expect: 'fail',
    reason:
      /^The page requested 1 URL\(s\) outside the app: https:\/\/fonts\.example\.test\/x\.png$/,
    browser: true,
    run: () =>
      browserEgressOutcome(
        page(
          '<!doctype html><html lang="en"><body><img src="https://fonts.example.test/x.png" alt=""></body></html>',
        ),
      ),
  },
  {
    id: `${GATE}/browser-egress-redirect`,
    gate: GATE,
    input: "a loopback page that answers 302 to an outside host, a hop routing doesn't see",
    expect: 'fail',
    reason:
      /^The page requested 1 URL\(s\) outside the app: https:\/\/outside\.example\.test\/landing$/,
    browser: true,
    run: () =>
      browserEgressOutcome((_request, response) => {
        response.writeHead(302, { location: 'https://outside.example.test/landing' });
        response.end();
      }),
  },
  {
    id: `${GATE}/browser-egress-app-only`,
    gate: GATE,
    input: 'a page that asks only for the app',
    expect: 'pass',
    browser: true,
    run: () => browserEgressOutcome(page(PAGE)),
  },
  {
    id: `${GATE}/server-egress-outside`,
    gate: GATE,
    input: 'a server process that opens a socket to an outside address',
    expect: 'fail',
    reason:
      /^The app under test tried to reach 1 host\(s\) outside the machine: tcp:\/\/192\.0\.2\.9:443$/,
    run: () => serverEgressOutcome(true),
  },
  {
    id: `${GATE}/server-egress-loopback`,
    gate: GATE,
    input: 'a server process that opens a socket only to loopback',
    expect: 'pass',
    run: () => serverEgressOutcome(false),
  },

  // the canary, after the scrub, and the probe that proves the scan
  {
    id: `${GATE}/canary-leaked-unscrubbed`,
    gate: GATE,
    input:
      'a trace, a server log, and summary.json holding the canary in every form a run writes, unscrubbed',
    expect: 'fail',
    reason: /^canary-leaked: .* holds the run canary after the scrub\.$/,
    run: () => canaryOutcome('none'),
  },
  {
    id: `${GATE}/canary-leaked-unknown-form`,
    gate: GATE,
    input: 'the same, scrubbed, with the canary once more in a header no rule knows',
    expect: 'fail',
    reason: /^canary-leaked: .*server\.log holds the run canary after the scrub\.$/,
    run: () => canaryOutcome('unknown'),
  },
  {
    id: `${GATE}/canary-leaked-scrubbed`,
    gate: GATE,
    input:
      'the same trace, log, and summary.json, scrubbed by the rules, never by the canary itself',
    expect: 'pass',
    run: () => canaryOutcome('rules'),
  },
  verdictCase(
    'canary-unproven',
    'never-held',
    'a canary probe that ran, with no artifact holding the canary before the scrub',
    'fail',
    { canary: { before: [], after: [] } },
  ),
  verdictCase(
    'canary-unproven',
    'held',
    'a canary probe whose trace held the canary until the scrub',
    'pass',
    {},
  ),
];
