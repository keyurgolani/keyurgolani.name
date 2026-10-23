// pnpm quality:meta's cases (#11, Slice 1): a known-bad and a known-good
// input for each automated gate that exists so far, each run through the
// real gate. A known-bad case passes only when its gate fails and every
// finding names the case's reason, so an input that fails for some other
// reason doesn't count. A known-good case passes only when its gate passes
// with no finding.
//
// The gates so far: the static workflow check, the exceptions validator,
// check:appearance over the tier fixture packs and the low-contrast scheme,
// the fixture gate's leak check, and the quality runner's fail-closed
// rules (runner-cases.ts).

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { FIXTURE_FLAG } from '../../../ci/lib/fixture-flags.mjs';
import { REPO_ROOT } from '../../../quality/thresholds';
import { readRegistry } from '../../../packages/variant-contract/src/node/index';
import {
  repositoryContext,
  repositoryInputs,
  validateExceptions,
  type ExceptionsResult,
} from '../lib/exceptions';
import {
  fixtureContext,
  fixtureInputs,
  KNOWN_BAD_EXCEPTIONS,
  KNOWN_GOOD_EXCEPTIONS,
} from '../lib/exception-fixtures';
import { checkWorkflows, type WorkflowProblem } from '../lib/workflows';
import {
  fixtureProblems,
  KNOWN_BAD_WORKFLOWS,
  KNOWN_GOOD_WORKFLOWS,
} from '../lib/workflow-fixtures';
import { RUNNER_CASES } from './runner-cases';

/** What a gate said about one input. */
export interface MetaOutcome {
  /** The gate passed the input. */
  readonly passed: boolean;
  /** What it reported, one line per problem, failure, or finding. */
  readonly findings: readonly string[];
}

export interface MetaCase {
  /** Unique: the gate, a slash, and the input. */
  readonly id: string;
  /** The gate under test. */
  readonly gate: string;
  /** What the case feeds the gate, for the report. */
  readonly input: string;
  readonly expect: 'pass' | 'fail';
  /** For a known-bad case: what every finding must say. */
  readonly reason?: RegExp;
  /** It launches Chromium, so `pnpm quality:meta --no-browser` leaves it out. */
  readonly browser?: boolean;
  readonly run: () => MetaOutcome | Promise<MetaOutcome>;
}

/** Why `outcome` isn't what `metaCase` expects, or null when it is. */
export function judge(metaCase: MetaCase, outcome: MetaOutcome): string | null {
  if (metaCase.expect === 'pass') {
    if (!outcome.passed)
      return `it should pass, and the gate failed it: ${outcome.findings.join(' | ') || 'no finding'}`;
    if (outcome.findings.length > 0)
      return `it passed with findings: ${outcome.findings.join(' | ')}`;
    return null;
  }
  if (!metaCase.reason) return 'a known-bad case names the reason it must fail for.';
  if (outcome.passed) return 'it should fail, and the gate passed it.';
  if (outcome.findings.length === 0)
    return 'the gate failed it without a finding, so no reason shows.';
  const off = outcome.findings.filter((finding) => !metaCase.reason!.test(finding));
  if (off.length > 0)
    return `it failed for another reason than ${metaCase.reason}: ${off.join(' | ')}`;
  return null;
}

/**
 * Why `cases` can't be run as the meta table, one line each, or none: it's
 * empty, an id repeats, or a gate lacks a known-bad or a known-good case. A
 * table with no known-bad case for a gate would pass a gate that passes
 * everything.
 */
export function tableProblems(cases: readonly MetaCase[]): string[] {
  if (cases.length === 0) return ['The table has no case, so nothing was checked.'];
  const problems: string[] = [];
  const ids = cases.map(({ id }) => id);
  const repeated = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (repeated.length > 0) problems.push(`Case ids repeat: ${repeated.join(', ')}.`);
  for (const gate of new Set(cases.map(({ gate: name }) => name))) {
    const own = cases.filter((metaCase) => metaCase.gate === gate);
    if (!own.some(({ expect }) => expect === 'fail')) {
      problems.push(
        `The ${gate} gate has no known-bad case, so a gate that passes everything would pass.`,
      );
    }
    if (!own.some(({ expect }) => expect === 'pass')) {
      problems.push(
        `The ${gate} gate has no known-good case, so a gate that fails everything would pass.`,
      );
    }
  }
  return problems;
}

// ---- the static workflow check ---------------------------------------------

const workflowOutcome = (problems: readonly WorkflowProblem[]): MetaOutcome => ({
  passed: problems.length === 0,
  findings: problems.map(({ rule, message }) => `${rule}: ${message}`),
});

export const WORKFLOW_CASES: readonly MetaCase[] = [
  {
    id: 'workflows/repository',
    gate: 'workflows',
    input: '.github/workflows/*.yml',
    expect: 'pass',
    run: () => workflowOutcome(checkWorkflows().problems),
  },
  ...KNOWN_GOOD_WORKFLOWS.map((file): MetaCase => ({
    id: `workflows/${file.replace(/\.ya?ml$/, '')}`,
    gate: 'workflows',
    input: `tests/quality/fixtures/workflows/${file}`,
    expect: 'pass',
    run: () => workflowOutcome(fixtureProblems(file)),
  })),
  ...KNOWN_BAD_WORKFLOWS.map(({ file, rule, reason }): MetaCase => ({
    id: `workflows/${file.replace(/\.ya?ml$/, '')}`,
    gate: 'workflows',
    input: `tests/quality/fixtures/workflows/${file}`,
    expect: 'fail',
    reason: new RegExp(`^${rule}: ${reason.source.replace(/^\^/, '')}`),
    run: () => workflowOutcome(fixtureProblems(file)),
  })),
];

// ---- the exceptions validator ----------------------------------------------

const exceptionOutcome = (result: ExceptionsResult): MetaOutcome => ({
  passed: result.problems.length === 0,
  findings: result.problems.map(({ file, message }) => `${file}: ${message}`),
});

const VALID_IDS = new Set([
  'login-primary-target',
  'fallback-decorative-watermark',
  'fallback-lcp-ceiling',
  'login-dialog-escape-flake',
]);

export const EXCEPTION_CASES: readonly MetaCase[] = [
  {
    id: 'exceptions/repository',
    gate: 'exceptions',
    input: "quality/exceptions.yml and runtime-budgets.json, on the run's UTC date",
    expect: 'pass',
    run: async () =>
      exceptionOutcome(validateExceptions(repositoryInputs(), await repositoryContext())),
  },
  ...KNOWN_GOOD_EXCEPTIONS.map(({ name, ...files }): MetaCase => ({
    id: `exceptions/${name}`,
    gate: 'exceptions',
    input: `tests/quality/fixtures/exceptions/${files.quality ?? files.budgets}`,
    expect: 'pass',
    run: () => exceptionOutcome(validateExceptions(fixtureInputs(files), fixtureContext())),
  })),
  ...KNOWN_BAD_EXCEPTIONS.map(({ name, reason, ...files }): MetaCase => ({
    id: `exceptions/${name}`,
    gate: 'exceptions',
    input: `tests/quality/fixtures/exceptions/${files.quality ?? files.budgets}`,
    expect: 'fail',
    reason,
    run: () => exceptionOutcome(validateExceptions(fixtureInputs(files), fixtureContext())),
  })),
  {
    id: 'exceptions/scheduled-matched',
    gate: 'exceptions',
    input: 'tests/quality/fixtures/exceptions/valid.yml, scheduled, every exception matched',
    expect: 'pass',
    run: () =>
      exceptionOutcome(
        validateExceptions(
          fixtureInputs({ quality: 'valid.yml' }),
          fixtureContext({ mode: 'scheduled', matched: VALID_IDS }),
        ),
      ),
  },
  {
    id: 'exceptions/scheduled-unmatched',
    gate: 'exceptions',
    input: 'tests/quality/fixtures/exceptions/valid.yml, scheduled, nothing matched',
    expect: 'fail',
    reason: /id: matched no failure in this scheduled run, so it waives nothing: remove it\.$/,
    run: () =>
      exceptionOutcome(
        validateExceptions(
          fixtureInputs({ quality: 'valid.yml' }),
          fixtureContext({ mode: 'scheduled', matched: new Set() }),
        ),
      ),
  },
];

// ---- check:appearance over the tier fixture packs --------------------------

const TSX = createRequire(import.meta.url).resolve('tsx/cli');
const CHECK_APPEARANCE = path.join(REPO_ROOT, 'apps', 'web', 'scripts', 'check-appearance.ts');
const TAG = '[check:appearance] ';
const TIER_PACK = /^fixture-(?:language|scheme|typography)-(?:stable|extended|experimental)$/;

/** pnpm check:appearance under `flags` and no other fixture flag, as the command runs. */
function checkAppearance(flags: Record<string, string>): MetaOutcome {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(env)) if (FIXTURE_FLAG.test(name)) delete env[name];
  const run = spawnSync(process.execPath, [TSX, CHECK_APPEARANCE], {
    cwd: path.join(REPO_ROOT, 'apps', 'web'),
    encoding: 'utf8',
    env: { ...env, ...flags },
  });
  const findings = (run.stderr ?? '')
    .split('\n')
    .filter((line) => line.startsWith(TAG) && !/ \d+ findings?\.$/.test(line))
    .map((line) => line.slice(TAG.length));
  // A tier pack it skipped wasn't gated, so a pass over it would be empty.
  for (const line of (run.stdout ?? '').split('\n')) {
    const skipped = /^\[check:appearance\] Skipped \w+ ([a-z0-9-]+):/.exec(line)?.[1];
    if (skipped && TIER_PACK.test(skipped)) findings.push(`it skipped the tier pack ${skipped}`);
  }
  if (run.status !== 0 && findings.length === 0) {
    findings.push(
      `it exited ${run.status ?? run.signal}: ${(run.stderr ?? '').trim().split('\n').at(-1) ?? ''}`,
    );
  }
  return { passed: run.status === 0 && findings.length === 0, findings };
}

export const APPEARANCE_CASES: readonly MetaCase[] = [
  {
    id: 'appearance/production',
    gate: 'appearance',
    input: 'pnpm check:appearance on the production registry, its own known-bad inputs among it',
    expect: 'pass',
    run: () => checkAppearance({}),
  },
  {
    id: 'appearance/tier-packs',
    gate: 'appearance',
    input:
      'pnpm check:appearance with QUALITY_FIXTURES=1: the nine tier packs, gated as shipping packs',
    expect: 'pass',
    run: () => checkAppearance({ QUALITY_FIXTURES: '1' }),
  },
  {
    id: 'appearance/low-contrast',
    gate: 'appearance',
    input:
      'pnpm check:appearance with QUALITY_FIXTURES=meta: fixture-scheme-experimental-low-contrast',
    expect: 'fail',
    // Its light text-muted under 4.5:1, on the canvas or a surface, in every tuple.
    reason:
      /^[a-z-]+ \+ fixture-scheme-experimental-low-contrast \+ [a-z-]+ \(system, light, dark\), light: text-muted on (?:canvas|surface-[a-z]+) is \d\.\d+:1, under 4\.5:1 \(text\)\.$/,
    run: () => checkAppearance({ QUALITY_FIXTURES: 'meta' }),
  },
];

// ---- the fixture gate's leak check -----------------------------------------

type RegistryOptions = typeof import('../../../apps/web/scripts/registry-options');
type FixtureGate = typeof import('../../../apps/web/scripts/fixture-gate');
// apps/web isn't an ES module package, so its scripts load as CommonJS.
const requireHost = createRequire(import.meta.url);
const host = () => ({
  options: requireHost('../../../apps/web/scripts/registry-options.ts') as RegistryOptions,
  gate: requireHost('../../../apps/web/scripts/fixture-gate.ts') as FixtureGate,
});

const QUALITY_PACKAGES = [
  'quality-fixtures-languages',
  'quality-fixtures-schemes',
  'quality-fixtures-schemes-meta',
  'quality-fixtures-typography',
];

/** Every quality fixture pack id, read from the packages. */
function qualityFixtureIds(): string[] {
  return QUALITY_PACKAGES.flatMap((dir) =>
    fs.readdirSync(path.join(REPO_ROOT, 'packages', dir, 'packs')),
  ).sort();
}

/** A build without a fixture flag: no quality fixture id reaches its registry or its generated modules. */
async function productionRegistry(): Promise<MetaOutcome> {
  const { options } = host();
  const { result, files } = await options.generateRegistry({}, { write: false });
  const findings = result.diagnostics
    .filter(({ severity }) => severity === 'error')
    .map(({ code, message }) => `${code}: ${message}`);
  const ids = qualityFixtureIds();
  for (const { manifest } of result.packs) {
    if (ids.includes(manifest.id)) findings.push(`the registry holds ${manifest.id}`);
  }
  for (const [name, text] of files ?? new Map<string, string>()) {
    for (const id of ids) if (text.includes(id)) findings.push(`the generated ${name} names ${id}`);
  }
  if (!files) findings.push('registry generation wrote nothing');
  return { passed: result.ok && findings.length === 0, findings };
}

/**
 * A build without QUALITY_FIXTURES where another package carries a quality
 * fixture's id: a scratch workspace whose host depends on the real
 * quality-fixtures-schemes and on a copy of its stable pack under a package
 * no fixture row maps. Generation must fail on the leak.
 */
async function leakedRegistry(): Promise<MetaOutcome> {
  const { options, gate } = host();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-meta-leak-'));
  try {
    fs.writeFileSync(
      path.join(scratch, 'pnpm-workspace.yaml'),
      "packages: ['apps/*', 'packages/*']\n",
    );
    const leak = path.join(scratch, 'packages', 'leak-schemes');
    fs.mkdirSync(path.join(leak, 'packs'), { recursive: true });
    fs.cpSync(
      path.join(
        REPO_ROOT,
        'packages',
        'quality-fixtures-schemes',
        'packs',
        'fixture-scheme-stable',
      ),
      path.join(leak, 'packs', 'fixture-scheme-stable'),
      { recursive: true },
    );
    fs.writeFileSync(
      path.join(leak, 'package.json'),
      JSON.stringify({
        name: '@portfolio/leak-schemes',
        version: '0.1.0',
        private: true,
        portfolio: { kind: 'color-scheme', packs: './packs' },
      }),
    );
    const hostDir = path.join(scratch, 'apps', 'web');
    const modules = path.join(hostDir, 'node_modules', '@portfolio');
    fs.mkdirSync(modules, { recursive: true });
    fs.symlinkSync(
      path.join(REPO_ROOT, 'packages', 'quality-fixtures-schemes'),
      path.join(modules, 'quality-fixtures-schemes'),
      'dir',
    );
    fs.symlinkSync(leak, path.join(modules, 'leak-schemes'), 'dir');
    fs.writeFileSync(
      path.join(hostDir, 'package.json'),
      JSON.stringify({
        name: '@portfolio/web',
        dependencies: {
          '@portfolio/quality-fixtures-schemes': 'workspace:*',
          '@portfolio/leak-schemes': 'workspace:*',
        },
      }),
    );
    const result = await readRegistry({
      hostDir,
      packs: options.packHooks(),
      fixtures: gate.fixtureGate({}),
    });
    // The scratch host registers no fallback pack or variant; the fixture codes are what's under test.
    const findings = result.diagnostics
      .filter(({ code }) => code.startsWith('registry.fixture-'))
      .map(({ code, package: name, message }) => `${code}: ${name} ${message}`);
    return { passed: findings.length === 0, findings };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

export const FIXTURE_GATE_CASES: readonly MetaCase[] = [
  {
    id: 'fixture-gate/production',
    gate: 'fixture-gate',
    input: 'registry generation with no fixture flag set',
    expect: 'pass',
    run: productionRegistry,
  },
  {
    id: 'fixture-gate/leak',
    gate: 'fixture-gate',
    input: 'a package outside the fixture rows carrying fixture-scheme-stable, with no flag set',
    expect: 'fail',
    // The registry's message starts with the manifest pointer, /id.
    reason:
      /^registry\.fixture-leak: @portfolio\/leak-schemes \/id registers fixture-scheme-stable, the id of the fixture @portfolio\/quality-fixtures-schemes, in a build without QUALITY_FIXTURES/,
    run: leakedRegistry,
  },
];

/** Every case pnpm quality:meta runs. */
export const META_CASES: readonly MetaCase[] = [
  ...WORKFLOW_CASES,
  ...EXCEPTION_CASES,
  ...APPEARANCE_CASES,
  ...FIXTURE_GATE_CASES,
  ...RUNNER_CASES,
];
