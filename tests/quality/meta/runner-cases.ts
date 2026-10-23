// The quality runner's cases for `pnpm quality:meta` (#11, Slice 1, items 7,
// 8, and 11): a known-bad and a known-good input for each fail-closed rule,
// appended to META_CASES (cases.ts). Each runs the check the quality runs
// use, not a copy: the verdict over summary.json (lib/verdict.ts), the
// missing-browser launch, the emulation check, the browser policy, the socket guard beside the egress trap, and the artifact
// scan. A verdict case's findings are every failure the verdict gives, so a
// known-bad input is built to break its one rule and no other: take the
// rule away and the case goes the wrong way. The cases marked `browser`
// launch Chromium; pnpm test runs quality:meta with --no-browser, since the
// unit job has none, and the quality-meta job runs them all.

import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Summary, SummaryTest } from '../reporter';
import { plantCanary, scanArtifacts, scrubArtifacts, writeZip } from '../lib/artifacts.mjs';
import { CELL_CHECKS } from '../lib/checks';
import { checkEmulation } from '../lib/emulation';
import { egressFailure, installBrowserPolicy, serverEgressFailure } from '../lib/egress';
import { PREFERENCE_ROWS } from '../lib/matrix';
import { judge as verdictOf, type VerdictInput } from '../lib/verdict';
import { startEgressTrap } from '../../harness/egress-trap.mjs';
import type { MetaCase, MetaOutcome } from './cases';

const QUALITY = fileURLToPath(new URL('../', import.meta.url));
const GATE = 'runner';

/** A passing cell test of the fallback composition, as the reporter lists one. */
function cellTest(overrides: Partial<SummaryTest> = {}): SummaryTest {
  return {
    title:
      'composition:fallback complete / > 1440x900 default > fallback complete / at 1440x900, default',
    file: 'tests/quality/cells.spec.ts',
    line: 35,
    project: 'chromium c946a80325',
    cell: 'composition:fallback complete / fallback/platform-neutral/warm-parchment/humanist-ui/system',
    target: 'composition:fallback',
    route: '/',
    viewport: '1440x900',
    row: 'default',
    outcome: 'expected',
    status: 'passed',
    skipReason: null,
    checks: [...CELL_CHECKS],
    canaryProbe: false,
    errors: [],
    records: 0,
    ...overrides,
  };
}

function summary(tests: readonly SummaryTest[], overrides: Partial<Summary> = {}): Summary {
  return {
    schemaVersion: 1,
    mode: 'pr',
    shard: null,
    status: 'passed',
    projects: [{ name: 'chromium c946a80325' }],
    tests,
    errors: [],
    ...overrides,
  };
}

const PLAN: VerdictInput['plan'] = {
  targets: [{ kind: 'composition', id: 'fallback' }],
  reasons: ['Stand-in until #1 and #3 can make a revision unavailable on demand.'],
};

/** A run that's fine: one target, its one cell test passed with every check, no canary probe. */
const CLEAN: VerdictInput = {
  plan: PLAN,
  summary: summary([cellTest()]),
  missingBrowsers: [],
  canary: { before: [], after: [] },
};

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

/** A loopback server that answers every request with `html`. */
async function standInHost(html: string): Promise<{ origin: string; server: Server }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

const PAGE =
  '<!doctype html><html lang="en"><head><title>Stand-in</title></head><body><main><h1>Stand-in</h1></main></body></html>';

/** The emulation check on the reduced-motion row, with the context emulating it or not. */
async function emulationOutcome(emulated: boolean): Promise<MetaOutcome> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext(emulated ? { reducedMotion: 'reduce' } : {});
    const page = await context.newPage();
    await page.setContent(PAGE);
    const row = PREFERENCE_ROWS.find((each) => each.id === 'reduced-motion')!;
    const problems = await checkEmulation(page, row);
    return { passed: problems.length === 0, findings: problems };
  } finally {
    await browser.close();
  }
}

/** The browser policy on a page from a loopback host that asks for an outside image, or doesn't. */
async function browserEgressOutcome(outside: boolean): Promise<MetaOutcome> {
  const { chromium } = await import('playwright');
  const { origin, server } = await standInHost(
    `<!doctype html><html lang="en"><body>${outside ? '<img src="https://fonts.example.test/x.png" alt="">' : ''}</body></html>`,
  );
  const browser = await chromium.launch({
    args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
  });
  try {
    const context = await browser.newContext();
    const blocked = await installBrowserPolicy(context, origin);
    const page = await context.newPage();
    await page.goto(`${origin}/`);
    await page.waitForLoadState('load');
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

/** The artifact scan, fed to the verdict, on a trace and a log that hold the canary, scrubbed first or not. */
async function canaryOutcome(scrubbed: boolean): Promise<MetaOutcome> {
  const dir = mkdtempSync(path.join(tmpdir(), 'quality-meta-canary-'));
  try {
    const canary = plantCanary();
    mkdirSync(path.join(dir, 'results'));
    await writeZip(path.join(dir, 'results', 'trace.zip'), [
      {
        name: 'trace.network',
        bytes: Buffer.from(
          JSON.stringify({ headers: [{ name: 'authorization', value: `Bearer ${canary}` }] }),
        ),
        mtime: new Date(0),
      },
    ]);
    writeFileSync(path.join(dir, 'server.log'), `cookie: quality_canary=${canary}\n`);
    if (scrubbed) await scrubArtifacts(dir, [canary]);
    const after = await scanArtifacts(dir, [{ label: 'the run canary', value: canary }]);
    return verdictOutcome({ canary: { before: [], after } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SKIPPED = { outcome: 'skipped', status: 'skipped' } as const;
const PROBE = cellTest({ cell: undefined, target: undefined, canaryProbe: true });

export const RUNNER_CASES: readonly MetaCase[] = [
  // zero collected tests. With no target planned, nothing else catches it.
  verdictCase(
    'zero-tests',
    'none',
    'a run that collected no test, with no target to miss',
    'fail',
    {
      plan: { ...PLAN, targets: [] },
      summary: summary([]),
    },
  ),
  verdictCase('zero-tests', 'one', 'a run that collected one passing cell test', 'pass', {}),

  // a skip without a declared reason
  verdictCase('undeclared-skip', 'no-reason', 'a cell test skipped with no reason', 'fail', {
    summary: summary([cellTest(), cellTest({ ...SKIPPED, skipReason: null })]),
  }),
  verdictCase(
    'undeclared-skip',
    'undeclared-reason',
    'a cell test skipped with a reason neither the plan nor the harness declares',
    'fail',
    { summary: summary([cellTest(), cellTest({ ...SKIPPED, skipReason: 'Flaky today.' })]) },
  ),
  verdictCase(
    'undeclared-skip',
    'declared-reason',
    "a cell test skipped with the plan's declared reason",
    'pass',
    { summary: summary([cellTest(), cellTest({ ...SKIPPED, skipReason: PLAN.reasons[0]! })]) },
  ),

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
    { summary: summary([cellTest({ target: 'surface:login' })]) },
  ),
  verdictCase(
    'target-without-results',
    'surface-uncollected',
    'a registered surface none of whose tests was collected',
    'fail',
    {
      plan: { ...PLAN, targets: [...PLAN.targets, { kind: 'surface', id: 'login' }] },
    },
  ),
  verdictCase(
    'target-without-results',
    'all-skipped',
    'a registered composition whose every test skipped, each with a declared reason',
    'fail',
    { summary: summary([cellTest({ ...SKIPPED, skipReason: PLAN.reasons[0]! })]) },
  ),
  verdictCase(
    'target-without-results',
    'with-result',
    'a registered composition with a passing test',
    'pass',
    {},
  ),

  // a cell test that passed without every check
  verdictCase(
    'unchecked-cell',
    'no-axe',
    'a passing cell test that never ran its axe check',
    'fail',
    { summary: summary([cellTest({ checks: CELL_CHECKS.filter((check) => check !== 'axe') })]) },
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
    summary: summary([cellTest(), cellTest({ outcome: 'unexpected', status: 'failed' })]),
  }),
  verdictCase('tests-failed', 'none-failed', 'every cell test passed', 'pass', {}),
  verdictCase(
    'run-errors',
    'late-egress',
    "a worker's late server egress, outside any test",
    'fail',
    {
      summary: summary([cellTest()], {
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
    run: () => browserEgressOutcome(true),
  },
  {
    id: `${GATE}/browser-egress-app-only`,
    gate: GATE,
    input: 'a page that asks only for the app',
    expect: 'pass',
    browser: true,
    run: () => browserEgressOutcome(false),
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
    input: 'a trace and a server log that keep the canary, unscrubbed',
    expect: 'fail',
    reason: /^canary-leaked: .* holds the run canary after the scrub\.$/,
    run: () => canaryOutcome(false),
  },
  {
    id: `${GATE}/canary-leaked-scrubbed`,
    gate: GATE,
    input: 'the same trace and log, scrubbed',
    expect: 'pass',
    run: () => canaryOutcome(true),
  },
  verdictCase(
    'canary-unproven',
    'never-held',
    'a canary probe that ran, with no artifact holding the canary before the scrub',
    'fail',
    { summary: summary([cellTest(), PROBE]), canary: { before: [], after: [] } },
  ),
  verdictCase(
    'canary-unproven',
    'held',
    'a canary probe whose trace held the canary until the scrub',
    'pass',
    {
      summary: summary([cellTest(), PROBE]),
      canary: {
        before: [
          { file: 'results/canary/trace.zip', entry: 'trace.network', canary: 'the run canary' },
        ],
        after: [],
      },
    },
  ),
];
