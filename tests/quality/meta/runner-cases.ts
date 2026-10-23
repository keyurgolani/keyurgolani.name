// The quality runner's proving cases for `pnpm quality:meta` (#11, Slice 1,
// items 7, 8, and 11): each fail-closed rule of the runner, fed a known-bad
// input it must fail and a known-good one it must pass. Each case runs the
// check the runs use, not a copy of it: the verdict (lib/verdict.ts), the
// marker check, the emulation check, the browser policy, the socket guard
// beside the egress trap, the missing-browser check, and the artifact scan.
// The ones marked `browser` launch Chromium, so quality:meta runs them and
// pnpm test, which has no browser in CI, leaves them out.

import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Summary, SummaryTest } from '../reporter';
import { plantCanary, scanArtifacts, scrubArtifacts, writeZip } from '../lib/artifacts.mjs';
import { CELL_CHECKS } from '../lib/checks';
import { checkEmulation } from '../lib/emulation';
import { egressFailure, installBrowserPolicy } from '../lib/egress';
import {
  documentMarkerScript,
  MARKER_ATTRIBUTE,
  markerProblems,
  standInMarkers,
  type MarkedResponse,
} from '../lib/markers';
import { PREFERENCE_ROWS } from '../lib/matrix';
import { judge, type VerdictInput } from '../lib/verdict';
import { startEgressTrap } from '../../harness/egress-trap.mjs';

export interface MetaCase {
  /** The rule it proves, and which input it feeds it. */
  readonly id: string;
  readonly rule: string;
  readonly expect: 'fail' | 'pass';
  /** Launches Chromium. */
  readonly browser?: boolean;
  /** Runs the rule's check on the case's input: true when the check failed it. */
  run(): Promise<boolean>;
}

const QUALITY = fileURLToPath(new URL('../', import.meta.url));

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
    markers: 'stand-in',
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
    markers: 'stand-in',
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

/** A verdict case: true when the verdict failed the input on `rule`. */
function verdictCase(
  id: string,
  rule: string,
  expect: MetaCase['expect'],
  input: Partial<VerdictInput>,
): MetaCase {
  return {
    id,
    rule,
    expect,
    run: async () => {
      const verdict = judge({
        plan: PLAN,
        summary: summary([cellTest()]),
        missingBrowsers: [],
        canary: null,
        ...input,
      });
      return verdict.failures.some((failure) => failure.rule === rule);
    },
  };
}

/** Runs the missing-browser check in a child, with `env` added, and says whether it found one missing. */
function browsersMissing(env: Record<string, string>): boolean {
  const result = spawnSync(
    process.execPath,
    [path.join(QUALITY, 'lib', 'browsers.mjs'), 'chromium'],
    {
      env: { ...process.env, ...env },
      encoding: 'utf8',
      timeout: 120_000,
    },
  );
  const report = JSON.parse(result.stdout || '{"missing":[]}') as { missing: unknown[] };
  return result.status !== 0 || report.missing.length > 0;
}

/** A page the test answers itself at `origin`: `html` at /, with markers or without. */
async function standInPage(html: string, { marked }: { readonly marked: boolean }) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const origin = 'http://127.0.0.1:9';
  await context.route(`${origin}/**`, async (route) => {
    const headers = { 'content-type': 'text/html; charset=utf-8' };
    const body = Buffer.from(html);
    if (!marked) return route.fulfill({ status: 200, headers, body });
    const stand = standInMarkers(headers, body);
    return route.fulfill({ status: 200, headers: stand.headers, body: stand.body });
  });
  return { browser, context, origin };
}

/** The marker check on a page from a stand-in host that marks its responses, or doesn't. */
async function markersMissing(marked: boolean): Promise<boolean> {
  const { browser, context, origin } = await standInPage(
    '<!doctype html><html lang="en"><body><main><h1>Stand-in</h1></main></body></html>',
    {
      marked,
    },
  );
  try {
    const page = await context.newPage();
    const seen: MarkedResponse[] = [];
    page.on('response', (response) =>
      seen.push({ url: response.url(), status: response.status(), headers: response.headers() }),
    );
    await page.goto(`${origin}/`);
    const document = await page.evaluate(documentMarkerScript, MARKER_ATTRIBUTE);
    return markerProblems(seen, document).length > 0;
  } finally {
    await browser.close();
  }
}

/** The emulation check on the reduced-motion row, with the context emulating it or not. */
async function emulationIgnored(emulated: boolean): Promise<boolean> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext(emulated ? { reducedMotion: 'reduce' } : {});
    const page = await context.newPage();
    await page.setContent(
      '<!doctype html><html lang="en"><body><main>Stand-in</main></body></html>',
    );
    const row = PREFERENCE_ROWS.find((each) => each.id === 'reduced-motion')!;
    return (await checkEmulation(page, row)).length > 0;
  } finally {
    await browser.close();
  }
}

/** The browser policy on a stand-in app page that asks for an outside URL, or doesn't. */
async function browserEgress(outside: boolean): Promise<boolean> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
  });
  const origin = 'http://127.0.0.1:9';
  try {
    const context = await browser.newContext();
    const blocked = await installBrowserPolicy(context, origin, { markers: 'host' });
    // Only the app's own document is answered here; the policy runs first for everything else.
    await context.route(`${origin}/`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><body>${outside ? '<img src="https://fonts.example.test/x.png" alt="">' : ''}</body></html>`,
      }),
    );
    const page = await context.newPage();
    await page.goto(`${origin}/`);
    await page.waitForLoadState('load');
    return egressFailure(blocked) !== null;
  } finally {
    await browser.close();
  }
}

/**
 * The socket guard and the trap on a child that opens a socket to an
 * outside host, or doesn't. The child runs while this process keeps
 * serving the trap, which it reports the refused socket to.
 */
async function serverEgress(outside: boolean): Promise<boolean> {
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
          : 'void 0;',
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
  return trap.attempts().length > 0;
}

/** The artifact scan on a trace that holds the canary, scrubbed first or not. */
async function canaryInArtifacts(scrubbed: boolean): Promise<boolean> {
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
    const verdict = judge({
      plan: PLAN,
      summary: summary([cellTest()]),
      missingBrowsers: [],
      canary: { before: [], after },
    });
    return verdict.failures.some((failure) => failure.rule === 'canary-leaked');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SKIPPED = { outcome: 'skipped', status: 'skipped' } as const;
const PROBE = cellTest({ cell: undefined, target: undefined, canaryProbe: true });

export const RUNNER_META_CASES: readonly MetaCase[] = [
  verdictCase('zero collected tests', 'zero-tests', 'fail', { summary: summary([]) }),
  verdictCase('one collected test', 'zero-tests', 'pass', {}),
  verdictCase('a skip with no reason', 'undeclared-skip', 'fail', {
    summary: summary([cellTest(), cellTest({ ...SKIPPED, skipReason: null })]),
  }),
  verdictCase('a skip with a reason nothing declares', 'undeclared-skip', 'fail', {
    summary: summary([cellTest(), cellTest({ ...SKIPPED, skipReason: 'Flaky today.' })]),
  }),
  verdictCase("a skip with the plan's declared reason", 'undeclared-skip', 'pass', {
    summary: summary([cellTest(), cellTest({ ...SKIPPED, skipReason: PLAN.reasons[0]! })]),
  }),
  verdictCase('an engine that does not launch', 'missing-browser', 'fail', {
    missingBrowsers: [
      { engine: 'chromium', error: "browserType.launch: Executable doesn't exist" },
    ],
    summary: null,
  }),
  verdictCase("a launch error inside a test's result", 'missing-browser', 'fail', {
    summary: summary([
      cellTest({
        outcome: 'unexpected',
        status: 'failed',
        errors: ["browserType.launch: Executable doesn't exist at /x"],
      }),
    ]),
  }),
  verdictCase('every engine launches', 'missing-browser', 'pass', {}),
  {
    id: 'no browser installed where Playwright looks',
    rule: 'missing-browser',
    expect: 'fail',
    browser: true,
    run: async () => {
      const empty = mkdtempSync(path.join(tmpdir(), 'quality-meta-browsers-'));
      try {
        return browsersMissing({ PLAYWRIGHT_BROWSERS_PATH: empty });
      } finally {
        rmSync(empty, { recursive: true, force: true });
      }
    },
  },
  {
    id: 'the installed Chromium',
    rule: 'missing-browser',
    expect: 'pass',
    browser: true,
    run: async () => browsersMissing({}),
  },
  verdictCase('a registered composition with no test collected', 'target-without-results', 'fail', {
    summary: summary([cellTest({ target: 'surface:login' })]),
  }),
  verdictCase(
    'a registered composition whose every test skipped',
    'target-without-results',
    'fail',
    {
      summary: summary([cellTest({ ...SKIPPED, skipReason: PLAN.reasons[0]! })]),
    },
  ),
  verdictCase('a registered composition with a result', 'target-without-results', 'pass', {}),
  verdictCase('a passing cell test that skipped its axe check', 'unchecked-cell', 'fail', {
    summary: summary([cellTest({ checks: CELL_CHECKS.filter((check) => check !== 'axe') })]),
  }),
  verdictCase('a passing cell test that ran every check', 'unchecked-cell', 'pass', {}),
  {
    id: 'a page whose host sends no fixture marker',
    rule: 'missing-fixture-marker',
    expect: 'fail',
    browser: true,
    run: () => markersMissing(false),
  },
  {
    id: 'a page whose host marks every response and <html>',
    rule: 'missing-fixture-marker',
    expect: 'pass',
    browser: true,
    run: () => markersMissing(true),
  },
  {
    id: 'the reduced-motion row in a context that ignores it',
    rule: 'ignored-media-emulation',
    expect: 'fail',
    browser: true,
    run: () => emulationIgnored(false),
  },
  {
    id: 'the reduced-motion row in a context that emulates it',
    rule: 'ignored-media-emulation',
    expect: 'pass',
    browser: true,
    run: () => emulationIgnored(true),
  },
  {
    id: 'a page that asks for an outside image',
    rule: 'browser-egress',
    expect: 'fail',
    browser: true,
    run: () => browserEgress(true),
  },
  {
    id: 'a page that asks only for the app',
    rule: 'browser-egress',
    expect: 'pass',
    browser: true,
    run: () => browserEgress(false),
  },
  {
    id: 'a server that opens a socket to an outside host',
    rule: 'server-egress',
    expect: 'fail',
    run: () => serverEgress(true),
  },
  {
    id: 'a server that opens none',
    rule: 'server-egress',
    expect: 'pass',
    run: () => serverEgress(false),
  },
  {
    id: 'a trace and a log that keep the canary',
    rule: 'canary-leaked',
    expect: 'fail',
    run: () => canaryInArtifacts(false),
  },
  {
    id: 'the same, scrubbed',
    rule: 'canary-leaked',
    expect: 'pass',
    run: () => canaryInArtifacts(true),
  },
  verdictCase('a canary probe whose trace never held the canary', 'canary-unproven', 'fail', {
    summary: summary([cellTest(), PROBE]),
    canary: { before: [], after: [] },
  }),
  verdictCase('a canary probe whose trace held it until the scrub', 'canary-unproven', 'pass', {
    summary: summary([cellTest(), PROBE]),
    canary: {
      before: [
        { file: 'results/canary/trace.zip', entry: 'trace.network', canary: 'the run canary' },
      ],
      after: [],
    },
  }),
  verdictCase('a run that wrote no summary', 'no-summary', 'fail', { summary: null }),
  verdictCase('a run with an error outside its tests', 'run-errors', 'fail', {
    summary: summary([cellTest()], {
      errors: [
        'The app under test tried to reach 1 host(s) outside the machine: tcp://192.0.2.9:443',
      ],
    }),
  }),
];

/** Runs every case, or those `include` keeps, and returns each with whether it held. */
export async function runRunnerCases(
  include: (meta: MetaCase) => boolean = () => true,
): Promise<{ meta: MetaCase; failed: boolean; held: boolean; error?: string }[]> {
  const results = [];
  for (const meta of RUNNER_META_CASES.filter(include)) {
    try {
      const failed = await meta.run();
      results.push({ meta, failed, held: failed === (meta.expect === 'fail') });
    } catch (error) {
      results.push({ meta, failed: false, held: false, error: (error as Error).message });
    }
  }
  return results;
}
