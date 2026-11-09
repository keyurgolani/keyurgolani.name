import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TestCase } from '@playwright/test/reporter';
import { parse, stringify } from 'yaml';
import { readFailureRecords, REPO_ROOT } from '../../ci/lib/reports.mjs';
import type { CellFailure } from './lib/failure-records';
import { RECORDS_ATTACHMENT } from './lib/records';
import { writeTestRecords } from './reporter';
import {
  exceptionFor,
  failureTarget,
  EXCEPTION_GATES,
  falsePositiveFor,
  isWildcard,
  matchedExceptionIds,
  quarantineFor,
  repositoryContext,
  repositoryInputs,
  ruleLevel,
  validateExceptions,
  type ExceptionContext,
  type ExceptionInputs,
  type QualityException,
} from './lib/exceptions';
import {
  fixtureContext,
  fixtureInputs,
  KNOWN_BAD_EXCEPTIONS,
  KNOWN_GOOD_EXCEPTIONS,
} from './lib/exception-fixtures';

// Exceptions (#11, Slice 1, item 12): quality/exceptions.yml and #6's
// runtime-budgets.json exceptions block, one schema and one set of expiry
// rules. Every field and rule the refined body lists has a case here, and
// each known-bad input fails for the reason it names, and no other.

const VALID = parse(fixtureInputs({ quality: 'valid.yml' }).quality.text) as {
  version: number;
  exceptions: Record<string, unknown>[];
  falsePositives: Record<string, unknown>[];
};
const [TARGET, DECORATIVE, TIMING, QUARANTINE] = VALID.exceptions as [
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>,
];

/** quality/exceptions.yml holding `exceptions` and `falsePositives`, with the repository's budgets file. */
function quality(
  exceptions: readonly unknown[],
  falsePositives: readonly unknown[] = [],
): ExceptionInputs {
  return {
    quality: {
      file: 'quality/exceptions.yml',
      text: stringify({ version: 1, exceptions, falsePositives }),
    },
    budgets: fixtureInputs({}).budgets,
  };
}

/** runtime-budgets.json holding `block` as its exceptions, with an empty quality file. */
function budgets(block: unknown): ExceptionInputs {
  return {
    quality: fixtureInputs({}).quality,
    budgets: {
      file: 'runtime-budgets.json',
      text: JSON.stringify({ version: 1, exceptions: block }),
    },
  };
}

const messages = (inputs: ExceptionInputs, context: ExceptionContext = fixtureContext()) =>
  validateExceptions(inputs, context).problems.map(({ message }) => message);

/** `entry` with `change` applied, and fields set to undefined removed. */
function edit(
  entry: Record<string, unknown>,
  change: Record<string, unknown>,
): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...structuredClone(entry), ...change };
  for (const [key, value] of Object.entries(change)) if (value === undefined) delete copy[key];
  return copy;
}

const scoped = (entry: Record<string, unknown>, scope: Record<string, unknown>) =>
  edit(entry, { scope: { ...(entry.scope as object), ...scope } });

test("the repository's quality/exceptions.yml and runtime-budgets.json validate on today's UTC date", async () => {
  const context = await repositoryContext();
  assert.match(context.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(context.today, new Date().toISOString().slice(0, 10));
  const result = validateExceptions(repositoryInputs(), context);
  // Whatever it holds: a branch's own exceptions are its own, and only a valid entry waives.
  assert.deepEqual(result.problems, []);
});

test('each known-bad input fails for the reason it names, and for nothing else', () => {
  for (const { name, reason, ...files } of KNOWN_BAD_EXCEPTIONS) {
    const found = messages(fixtureInputs(files));
    assert.ok(found.length > 0, `${name} passed`);
    for (const message of found) assert.match(message, reason, name);
  }
});

test('the known-good inputs pass, with an entry of every kind among them', () => {
  const valid = validateExceptions(fixtureInputs(KNOWN_GOOD_EXCEPTIONS[0]!), fixtureContext());
  assert.deepEqual(valid.problems, []);
  assert.deepEqual(
    valid.exceptions.map(({ kind }) => kind),
    ['above-aa', 'decorative', 'timing', 'quarantine'],
  );
  assert.deepEqual(
    valid.falsePositives.map(({ id }) => id),
    ['login-badge-contrast'],
  );
  const block = validateExceptions(fixtureInputs(KNOWN_GOOD_EXCEPTIONS[1]!), fixtureContext());
  assert.deepEqual(block.problems, []);
  // The repository's own quality/exceptions.yml rides along; the budgets block is the fixture's.
  assert.deepEqual(
    block.exceptions
      .filter(({ source }) => source === 'budgets')
      .map(({ kind, source }) => [kind, source]),
    [['budget', 'budgets']],
  );
});

test('every field the body lists is required', () => {
  for (const field of [
    'id',
    'gate',
    'rule',
    'owner',
    'rationale',
    'affectedUsers',
    'fallback',
    'trackingIssue',
    'created',
    'expires',
    'scope',
    'kind',
  ]) {
    const found = messages(quality([edit(TARGET, { [field]: undefined })]));
    // zod 4 names the type a missing field needs, or the options of a missing enum.
    const missing = new RegExp(
      `${field}: Invalid (?:input: expected \\w+, received undefined|option: expected one of ")`,
    );
    assert.ok(
      found.some((message) => missing.test(message)),
      `${field}: ${found.join('; ')}`,
    );
  }
  // Nothing the schema doesn't name, so no tier can lower a floor.
  assert.ok(
    messages(quality([edit(TARGET, { tier: 'experimental' })])).some((message) =>
      message.includes('Unrecognized key: "tier"'),
    ),
  );
  assert.ok(
    messages(quality([scoped(TARGET, { fixture: 'complete' })])).some((message) =>
      message.includes('Unrecognized key: "fixture"'),
    ),
  );
  for (const [field, value] of [
    ['owner', 'Keyur Golani'],
    ['trackingIssue', '11'],
    ['trackingIssue', 'https://github.com/someone/else/issues/1'],
    ['created', '2026-13-01'],
    ['expires', 'next month'],
    ['rationale', '   '],
    ['id', 'X'],
  ] as const) {
    assert.ok(
      messages(quality([edit(TARGET, { [field]: value })])).some((message) =>
        message.includes(`${field}:`),
      ),
      `${field} ${value}`,
    );
  }
});

test("expires and created are compared with the run's UTC date", () => {
  const entry = edit(TARGET, { created: '2026-10-20', expires: '2026-11-02' });
  // It holds through the day before it expires...
  assert.deepEqual(messages(quality([entry]), fixtureContext({ today: '2026-11-01' })), []);
  // ...and fails from the day it does.
  for (const today of ['2026-11-02', '2026-11-03']) {
    assert.deepEqual(messages(quality([entry]), fixtureContext({ today })), [
      `exceptions[0] (login-primary-target) expires: expired on 2026-11-02, on or before the run's UTC date, ${today}. Fix the failure, or renew the exception with a new created date.`,
    ]);
  }
  // One created after the run's date fails, so no date in the future stretches the 90 days.
  assert.deepEqual(
    messages(quality([edit(TARGET, { created: '2026-11-10', expires: '2026-12-20' })])),
    ["exceptions[0] (login-primary-target) created: is after the run's UTC date, 2026-11-01."],
  );
  assert.ok(
    messages(quality([edit(TARGET, { created: '2026-11-01', expires: '2026-11-01' })])).some(
      (message) => message.includes('expires: must be after created.'),
    ),
  );
  // 90 days is the most, from quality/thresholds.json.
  assert.deepEqual(
    messages(quality([edit(TARGET, { created: '2026-10-20', expires: '2027-01-18' })])),
    [],
  );
  assert.deepEqual(
    messages(quality([edit(TARGET, { created: '2026-10-20', expires: '2027-01-19' })])),
    [
      'exceptions[0] (login-primary-target) expires: is 91 days after created, more than the 90 days an exception may run.',
    ],
  );
});

test('a scope names each field its gate varies on, and no other', () => {
  assert.deepEqual(EXCEPTION_GATES.targets.scope, [
    'surface',
    'route',
    'tuple',
    'viewport',
    'inputMode',
  ]);
  assert.deepEqual(EXCEPTION_GATES.axe.scope, [
    'surface',
    'route',
    'tuple',
    'viewport',
    'preferenceMode',
  ]);
  assert.deepEqual(EXCEPTION_GATES.budget.scope, ['unit', 'metric']);
  for (const field of ['surface', 'route', 'tuple', 'viewport', 'inputMode']) {
    const scope = { ...(TARGET.scope as Record<string, unknown>) };
    delete scope[field];
    assert.deepEqual(messages(quality([edit(TARGET, { scope })])), [
      `exceptions[0] (login-primary-target) scope.${field}: is missing: targets varies on ${field}, so the scope names it.`,
    ]);
  }
  assert.deepEqual(messages(quality([scoped(TARGET, { preferenceMode: 'default' })])), [
    "exceptions[0] (login-primary-target) scope.preferenceMode: targets doesn't vary on preferenceMode, so the scope omits it.",
  ]);
  assert.deepEqual(messages(quality([scoped(DECORATIVE, { inputMode: 'mouse' })])), [
    "exceptions[0] (fallback-decorative-watermark) scope.inputMode: axe doesn't vary on inputMode, so the scope omits it.",
  ]);
  // Each field has its grammar.
  for (const [field, value] of [
    ['surface', 'Login Page'],
    ['route', 'studio/login'],
    ['tuple', 'platform-neutral/warm-parchment'],
    ['viewport', '390 by 844'],
    ['inputMode', 'pointer'],
  ] as const) {
    assert.ok(
      messages(quality([scoped(TARGET, { [field]: value })])).some((message) =>
        message.includes(`scope.${field}: must be`),
      ),
      `${field} ${value}`,
    );
  }
});

test('a wildcard in a scope, a rule, or a selector fails', () => {
  for (const [field, value] of [
    ['surface', '*'],
    ['route', '/studio/*'],
    ['route', '/studio/[page]'],
    ['tuple', '*/warm-parchment/humanist-ui/light'],
    ['viewport', '*x844'],
    ['inputMode', 'any'],
    ['inputMode', 'all'],
  ] as const) {
    assert.deepEqual(
      messages(quality([scoped(TARGET, { [field]: value })])),
      [
        `exceptions[0] (login-primary-target) scope.${field}: is a wildcard. Name the exact ${field}: a scope is never wildcarded.`,
      ],
      `${field} ${value}`,
    );
  }
  assert.deepEqual(messages(quality([edit(TARGET, { rule: '*' })])), [
    'exceptions[0] (login-primary-target) rule: is a wildcard. Name the one targets rule the exception waives.',
  ]);
  assert.deepEqual(messages(quality([edit(DECORATIVE, { selector: 'main *' })])), [
    'exceptions[0] (fallback-decorative-watermark) selector: is a wildcard. Name the one element the exception waives.',
  ]);
  assert.equal(isWildcard('/studio/login'), false);
  assert.equal(isWildcard('platform-neutral/warm-parchment/humanist-ui/light'), false);
});

test("WCAG A and AA failures on essential content can't be excepted, in any tier, and the floors neither", () => {
  for (const [gate, rule, level] of [
    ['axe', 'color-contrast', 'AA'],
    ['axe', 'image-alt', 'AA'],
    ['contrast', 'text', 'AA'],
    ['targets', 'minimum', 'AA'],
    ['keyboard', 'trap', 'A'],
    ['reflow', 'reflow', 'AA'],
  ] as const) {
    const found = messages(quality([edit(TARGET, { gate, rule, scope: scopeFor(gate) })]));
    assert.deepEqual(
      found,
      [
        `exceptions[0] (login-primary-target) kind: ${gate} ${rule} is WCAG ${level}: a WCAG A or AA failure on essential content can't be excepted, in any tier. This exception is non-waivable.`,
      ],
      `${gate} ${rule}`,
    );
  }
  for (const [gate, rule] of [
    ['motion', 'animation'],
    ['vitals', 'lcp-element'],
    ['idle', 'layout-count'],
  ] as const) {
    assert.deepEqual(messages(quality([edit(TARGET, { gate, rule, scope: scopeFor(gate) })])), [
      `exceptions[0] (login-primary-target) kind: ${gate} ${rule} is a floor every pack is held to, in every tier, so it can't be excepted. This exception is non-waivable.`,
    ]);
  }
  // Decorative content waives only a contrast rule, and names its element.
  assert.deepEqual(
    messages(
      quality([edit(DECORATIVE, { gate: 'keyboard', rule: 'trap', scope: scopeFor('keyboard') })]),
    ),
    [
      "exceptions[0] (fallback-decorative-watermark) kind: keyboard trap is WCAG A, and it exempts no decorative content: a WCAG A or AA failure on essential content can't be excepted, in any tier.",
    ],
  );
  assert.deepEqual(messages(quality([edit(DECORATIVE, { selector: undefined })])), [
    'exceptions[0] (fallback-decorative-watermark) selector: a decorative exception names the element it waives, by selector.',
  ]);
  // Decorative never excuses text contrast, a pack's text roles being content; large text and non-text it may.
  const contrast = (rule: string) =>
    messages(
      quality([
        edit(DECORATIVE, {
          gate: 'contrast',
          rule,
          scope: {
            ...scopeFor('contrast'),
            tuple: 'platform-neutral/fixture-scheme-experimental-low-contrast/humanist-ui/light',
          },
        }),
      ]),
    );
  assert.deepEqual(contrast('text'), [
    "exceptions[0] (fallback-decorative-watermark) kind: contrast text measures a pack's text roles, which carry the page's content, so decorative can't excuse it. Text that really is incidental goes in as a falsePositive, with the quality/manual-runs/ record that proves it.",
  ]);
  // Large text is text under 1.4.3, so the same refusal holds.
  assert.deepEqual(contrast('large-text'), [
    "exceptions[0] (fallback-decorative-watermark) kind: contrast large-text measures a pack's text roles, which carry the page's content, so decorative can't excuse it. Text that really is incidental goes in as a falsePositive, with the quality/manual-runs/ record that proves it.",
  ]);
  assert.deepEqual(contrast('non-text'), []);
});

test('inventory script-only-text is a rule at A, so no exception waives it', () => {
  assert.equal(ruleLevel('inventory', 'script-only-text'), 'A');
  assert.deepEqual(
    messages(
      quality([
        edit(TARGET, {
          gate: 'inventory',
          rule: 'script-only-text',
          scope: scopeFor('inventory'),
        }),
      ]),
    ),
    [
      "exceptions[0] (login-primary-target) kind: inventory script-only-text is WCAG A: a WCAG A or AA failure on essential content can't be excepted, in any tier. This exception is non-waivable.",
    ],
  );
});

test('a gate or rule named for a prototype key is no gate or rule, reported and never thrown', () => {
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    assert.equal(ruleLevel(name, 'text'), undefined, name);
    assert.equal(ruleLevel('contrast', name), undefined, name);
    assert.equal(ruleLevel('targets', name), undefined, name);
    let found: string[] = [];
    assert.doesNotThrow(() => {
      found = messages(quality([edit(TARGET, { gate: name })]));
    }, `gate ${name}`);
    assert.ok(
      found.some((message) => message.includes('gate: names no gate: it must be one of axe,')),
      `gate ${name}: ${found.join(' | ')}`,
    );
    for (const gate of ['contrast', 'targets'] as const) {
      assert.doesNotThrow(() => {
        found = messages(quality([edit(TARGET, { gate, rule: name, scope: scopeFor(gate) })]));
      }, `${gate} rule ${name}`);
      assert.deepEqual(
        found,
        [
          `exceptions[0] (login-primary-target) rule: isn't a rule of ${gate}, so it can't be excepted.`,
        ],
        `${gate} rule ${name}`,
      );
    }
  }
});

/** A valid scope for `gate`'s fields. */
function scopeFor(gate: keyof typeof EXCEPTION_GATES): Record<string, string> {
  const values: Record<string, string> = {
    surface: 'fallback',
    route: '/',
    tuple: 'platform-neutral/warm-parchment/humanist-ui/light',
    viewport: '1440x900',
    inputMode: 'mouse',
    preferenceMode: 'default',
    unit: 'fallback',
    metric: 'jsBytes',
  };
  return Object.fromEntries(EXCEPTION_GATES[gate].scope.map((field) => [field, values[field]!]));
}

test('each kind waives only its own level, and any but a quarantine or a budget may name a selector', () => {
  assert.deepEqual(messages(quality([edit(TARGET, { kind: 'timing' })])), [
    'exceptions[0] (login-primary-target) kind: targets primary is a floor above AA, so its kind is above-aa.',
  ]);
  assert.deepEqual(messages(quality([edit(TIMING, { kind: 'above-aa' })])), [
    'exceptions[0] (fallback-lcp-ceiling) kind: vitals lcp is a timing ceiling, so its kind is timing.',
  ]);
  assert.deepEqual(messages(quality([edit(TARGET, { rule: 'giant' })])), [
    "exceptions[0] (login-primary-target) rule: isn't a rule of targets, so it can't be excepted.",
  ]);
  assert.ok(
    messages(quality([edit(TARGET, { gate: 'vibes' })])).some((message) =>
      message.includes('gate: names no gate: it must be one of axe, contrast,'),
    ),
  );
  // An above-AA exception may name its one element; a quarantine names a test, not an element.
  assert.deepEqual(messages(quality([edit(TARGET, { selector: 'main button' })])), []);
  assert.deepEqual(messages(quality([edit(QUARANTINE, { selector: 'main button' })])), [
    `exceptions[0] (${String(QUARANTINE.id)}) selector: a quarantine names a flaky test, not an element: it takes no selector.`,
  ]);
});

test("a budget exception lives in runtime-budgets.json's block, and nothing else does", () => {
  const budget = parse(
    JSON.stringify(
      (
        JSON.parse(fixtureInputs({ budgets: 'runtime-budgets.valid.json' }).budgets.text) as {
          exceptions: unknown[];
        }
      ).exceptions[0],
    ),
  ) as Record<string, unknown>;
  assert.deepEqual(messages(budgets([budget])), []);
  assert.deepEqual(messages(budgets([edit(budget, { selector: 'main img' })])), [
    "exceptions[0] (fallback-js-bytes) selector: a budget limit is a whole route's, not an element's: it takes no selector.",
  ]);
  assert.deepEqual(messages(quality([budget])), [
    "exceptions[0] (fallback-js-bytes) gate: a budget exception lives in runtime-budgets.json's exceptions block, with #6's budgets.",
  ]);
  assert.deepEqual(messages(budgets([TARGET])), [
    "exceptions[0] (login-primary-target) gate: runtime-budgets.json's exceptions block holds budget exceptions alone; quality/exceptions.yml holds the rest.",
  ]);
  assert.deepEqual(messages(budgets({ 'fallback-js-bytes': budget })), [
    'exceptions must be a list of budget exceptions.',
  ]);
  // The same expiry rules hold there.
  assert.ok(
    messages(budgets([edit(budget, { created: '2026-07-01', expires: '2026-09-01' })])).some(
      (message) => message.includes('expired on 2026-09-01'),
    ),
  );
  // The block's absence is no budget exceptions at all.
  const absent = validateExceptions(
    {
      quality: fixtureInputs({}).quality,
      budgets: { file: 'runtime-budgets.json', text: '{"version":1}' },
    },
    fixtureContext(),
  );
  assert.deepEqual(
    [absent.problems, absent.exceptions.filter(({ source }) => source === 'budgets')],
    [[], []],
  );
});

test("a flake quarantine runs at most 14 days, on a gate with interaction tests, owned by the surface's owner", () => {
  assert.deepEqual(messages(quality([QUARANTINE])), []);
  assert.deepEqual(messages(quality([edit(QUARANTINE, { expires: '2026-11-08' })])), []);
  assert.deepEqual(messages(quality([edit(QUARANTINE, { expires: '2026-11-14' })])), [
    'exceptions[0] (login-dialog-escape-flake) expires: is 15 days after created, more than the 14 days a flake quarantine may run.',
  ]);
  assert.deepEqual(messages(quality([edit(QUARANTINE, { owner: 'someone-else' })])), [
    "exceptions[0] (login-dialog-escape-flake) owner: a quarantine is owned by its surface's owner, keyurgolani, not someone-else.",
  ]);
  assert.deepEqual(messages(quality([QUARANTINE]), fixtureContext({ surfaceOwners: new Map() })), [
    "exceptions[0] (login-dialog-escape-flake) owner: a quarantine is owned by its surface's owner, and login registers none in quality/surfaces/.",
  ]);
  assert.deepEqual(messages(quality([edit(QUARANTINE, { gate: 'axe', scope: scopeFor('axe') })])), [
    'exceptions[0] (login-dialog-escape-flake) kind: axe runs no interaction tests, and its assertions never retry, so nothing of it flakes to quarantine.',
    "exceptions[0] (login-dialog-escape-flake) owner: a quarantine is owned by its surface's owner, and fallback registers none in quality/surfaces/.",
  ]);
});

test('a false positive names its manual run, and lapses on an axe upgrade', () => {
  const [positive] = VALID.falsePositives as [Record<string, unknown>];
  assert.deepEqual(messages(quality([], [positive])), []);
  assert.deepEqual(messages(quality([], [positive]), fixtureContext({ axeVersion: '4.12.0' })), [
    'falsePositives[0] (login-badge-contrast) axe: was confirmed under axe-core 4.11.0, and 4.12.0 is installed: a false positive lapses on an axe upgrade. Confirm it again under 4.12.0.',
  ]);
  assert.deepEqual(messages(quality([], [positive]), fixtureContext({ axeVersion: null })), [
    'falsePositives[0] (login-badge-contrast) axe: was confirmed under axe-core 4.11.0, and no axe-core is installed to hold it to.',
  ]);
  assert.deepEqual(messages(quality([], [positive]), fixtureContext({ manualRuns: new Set() })), [
    'falsePositives[0] (login-badge-contrast) manualRun: names no record in quality/manual-runs/: a false positive needs the manual run that proves the criterion passes.',
  ]);
  assert.deepEqual(messages(quality([], [edit(positive, { selector: '*' })])), [
    'falsePositives[0] (login-badge-contrast) selector: is a wildcard. Name the one element axe misreads.',
  ]);
  // It isn't an open exception: it carries no owner or expiry, and a scheduled run doesn't need it matched.
  assert.ok(
    messages(quality([], [edit(positive, { expires: '2027-01-01' })])).some((message) =>
      message.includes('Unrecognized key: "expires"'),
    ),
  );
  assert.deepEqual(
    messages(quality([], [positive]), fixtureContext({ mode: 'scheduled', matched: new Set() })),
    [],
  );
});

test('ids are unique across both files', () => {
  const budget = (
    JSON.parse(fixtureInputs({ budgets: 'runtime-budgets.valid.json' }).budgets.text) as {
      exceptions: Record<string, unknown>[];
    }
  ).exceptions[0]!;
  const inputs: ExceptionInputs = {
    quality: quality([edit(TARGET, { id: 'fallback-js-bytes' })]).quality,
    budgets: budgets([budget]).budgets,
  };
  const result = validateExceptions(inputs, fixtureContext());
  assert.deepEqual(
    result.problems.map(({ message }) => message),
    ["fallback-js-bytes is already an entry's id in quality/exceptions.yml."],
  );
  assert.deepEqual(result.exceptions, []);
});

test('a scheduled run fails an exception that matched nothing, and warns 14 days before one expires', () => {
  const inputs = fixtureInputs({ quality: 'valid.yml' });
  const ids = [
    'login-primary-target',
    'fallback-decorative-watermark',
    'fallback-lcp-ceiling',
    'login-dialog-escape-flake',
  ];
  const all = validateExceptions(
    inputs,
    fixtureContext({ mode: 'scheduled', matched: new Set(ids) }),
  );
  assert.deepEqual(all.problems, []);
  // The quarantine expires on 2026-11-05, 4 days from the run.
  assert.deepEqual(
    all.warnings.map(({ message }) => message),
    ['login-dialog-escape-flake expires on 2026-11-05, in 4 days.'],
  );
  const some = validateExceptions(
    inputs,
    fixtureContext({ mode: 'scheduled', matched: new Set(['login-primary-target']) }),
  );
  assert.deepEqual(
    some.problems.map(({ id }) => id),
    ['fallback-decorative-watermark', 'fallback-lcp-ceiling', 'login-dialog-escape-flake'],
  );
  for (const { message } of some.problems) {
    assert.match(
      message,
      /id: matched no failure in this scheduled run, so it waives nothing: remove it\.$/,
    );
  }
  // A pull request run neither requires a match nor warns.
  const pr = validateExceptions(inputs, fixtureContext());
  assert.deepEqual([pr.problems, pr.warnings], [[], []]);
});

test('a file that is no YAML, holds a key twice, or has a top-level key it should not, fails', () => {
  const broken = {
    quality: { file: 'quality/exceptions.yml', text: 'version: 1\nexceptions: [\n' },
    budgets: fixtureInputs({}).budgets,
  };
  assert.match(messages(broken)[0]!, /^isn't valid YAML: /);
  const twice = {
    quality: {
      file: 'quality/exceptions.yml',
      text: 'version: 1\nexceptions: []\nexceptions: []\nfalsePositives: []\n',
    },
    budgets: fixtureInputs({}).budgets,
  };
  assert.match(messages(twice)[0]!, /^isn't valid YAML: Map keys must be unique/);
  const extra = {
    quality: {
      file: 'quality/exceptions.yml',
      text: 'version: 1\nexceptions: []\nfalsePositives: []\nwaivers: []\n',
    },
    budgets: fixtureInputs({}).budgets,
  };
  assert.deepEqual(messages(extra), ['(file): Unrecognized key: "waivers"']);
  const json = {
    quality: fixtureInputs({}).quality,
    budgets: { file: 'runtime-budgets.json', text: '{' },
  };
  assert.match(messages(json)[0]!, /^isn't valid JSON: /);
});

/** quality/exceptions.yml holding `entries`, as validateExceptions() reads it. */
const qualityText = (entries: readonly Record<string, unknown>[]): ExceptionInputs => ({
  quality: {
    file: 'quality/exceptions.yml',
    text: stringify({ version: 1, exceptions: entries, falsePositives: [] }),
  },
  budgets: fixtureInputs({}).budgets,
});

/** A focus-perimeter exception for one Flux cell, scoped to one element when `selector` is given. */
const perimeterEntry = (id: string, selector?: string) => ({
  id,
  kind: 'above-aa',
  gate: 'focus',
  rule: 'perimeter',
  owner: 'keyurgolani',
  rationale: 'Pending the post-Sun platform focus target.',
  affectedUsers: 'Keyboard users meet a 2px ring at 3.7:1 whose antialiased edge reads under 3:1.',
  fallback: 'The ring is whole, 2px, and over 3:1 where it is drawn.',
  trackingIssue: '#11',
  created: '2026-10-31',
  expires: '2027-01-29',
  ...(selector ? { selector } : {}),
  scope: {
    surface: 'flux',
    route: '/',
    tuple: 'platform-neutral/warm-parchment/humanist-ui/system',
    viewport: '390x844',
    preferenceMode: 'default',
  },
});

/** A focus-perimeter failure in that Flux cell, on the element `selector` names. */
const perimeterFailure = (selector: string) => ({
  check: 'focus',
  rule: 'perimeter',
  surface: 'flux',
  route: '/',
  tuple: {
    designLanguage: 'platform-neutral',
    colorScheme: 'warm-parchment',
    typography: 'humanist-ui',
    displayMode: 'system' as const,
  },
  viewport: '390x844',
  inputMode: 'mouse',
  preferenceMode: 'default',
  element: { selector },
});

test('an exception may name one element by selector: it waives that element alone, the same rule on another element still fails, and one without a selector waives the scope as before', () => {
  const talks = '#talks > details:nth-child(1) > summary:nth-child(1)';
  const scoped = validateExceptions(
    qualityText([perimeterEntry('flux-talks-perimeter', talks)]),
    fixtureContext({ today: '2026-10-31' }),
  );
  assert.deepEqual(scoped.problems, []);
  // Its own element's finding is waived.
  assert.equal(
    exceptionFor(failureTarget(perimeterFailure(talks)), scoped.exceptions)?.id,
    'flux-talks-perimeter',
  );
  // The same rule in the same cell on another element still fails.
  assert.equal(
    exceptionFor(
      failureTarget(perimeterFailure('#fx--bar > div:nth-child(1) > nav > ul > li > a')),
      scoped.exceptions,
    ),
    undefined,
  );
  // A selector matches exactly: a prefix or a longer path is another element.
  assert.equal(
    exceptionFor(
      failureTarget(perimeterFailure('#talks > details:nth-child(1)')),
      scoped.exceptions,
    ),
    undefined,
  );
  // With no selector the exception waives the rule for every element in its scope, as before.
  const cellWide = validateExceptions(
    qualityText([perimeterEntry('flux-cell-perimeter')]),
    fixtureContext({ today: '2026-10-31' }),
  );
  assert.deepEqual(cellWide.problems, []);
  for (const selector of [talks, '#fx--bar a'])
    assert.equal(
      exceptionFor(failureTarget(perimeterFailure(selector)), cellWide.exceptions)?.id,
      'flux-cell-perimeter',
    );
  // Its scope still holds: another viewport isn't waived either way.
  assert.equal(
    exceptionFor(
      { ...failureTarget(perimeterFailure(talks)), viewport: '1024x768' },
      scoped.exceptions,
    ),
    undefined,
  );
});

test('a scoped exception that matched nothing is reported by a scheduled run, as any stale one is, and a quarantine or a budget takes no selector', () => {
  const talks = '#talks > details:nth-child(1) > summary:nth-child(1)';
  const inputs = qualityText([perimeterEntry('flux-talks-perimeter', talks)]);
  const stale = messages(
    inputs,
    fixtureContext({ today: '2026-10-31', mode: 'scheduled', matched: new Set() }),
  );
  assert.ok(
    stale.some((message) => /matched no failure in this scheduled run/.test(message)),
    stale.join('\n'),
  );
  assert.deepEqual(
    messages(
      inputs,
      fixtureContext({
        today: '2026-10-31',
        mode: 'scheduled',
        matched: new Set(['flux-talks-perimeter']),
      }),
    ).filter((message) => /matched no failure/.test(message)),
    [],
  );
  const quarantine = {
    ...perimeterEntry('flux-quarantine-selector', talks),
    kind: 'quarantine',
    gate: 'keyboard',
    rule: 'dialog-escape',
    expires: '2026-11-05',
  };
  assert.ok(
    messages(qualityText([quarantine]), fixtureContext({ today: '2026-10-31' })).some((message) =>
      /a quarantine names a flaky test, not an element: it takes no selector/.test(message),
    ),
  );
});

/** A finished cell test as the reporter sees it: its outcome, and its records attachment. */
const finishedCell = (outcome: 'expected' | 'unexpected', records: readonly CellFailure[]) =>
  ({
    title: 'composition:flux complete at 390x844 default',
    titlePath: () => [
      '',
      'chromium',
      'cells.spec.ts',
      'composition:flux complete at 390x844 default',
    ],
    location: { file: path.join(REPO_ROOT, 'tests/quality/cells.spec.ts'), line: 1 },
    annotations: [],
    outcome: () => outcome,
    results: [
      {
        status: outcome === 'expected' ? 'passed' : 'failed',
        annotations: [],
        errors: outcome === 'expected' ? [] : [{ message: 'axe, WCAG 2.2 AA' }],
        attachments: [{ name: RECORDS_ATTACHMENT, body: Buffer.from(JSON.stringify(records)) }],
      },
    ],
  }) as unknown as TestCase;

test('a passing cell whose findings were all waived writes their records with each exceptionId, so a scheduled run counts that exception live and the one that waived nothing stale', async (t) => {
  const talks = '#talks > details:nth-child(1) > summary:nth-child(1)';
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'waived-records-')), 'failures');
  t.after(() => fs.rmSync(path.dirname(dir), { recursive: true, force: true }));
  const waived = {
    ...perimeterFailure(talks),
    exceptionId: 'flux-talks-perimeter',
  } as CellFailure;
  // The cell passed: its one finding was waived. Its record is written, with the exception's id.
  await writeTestRecords(
    [finishedCell('expected', [waived])],
    { gate: 'quality-pr', reproCommand: 'pnpm quality:pr' },
    dir,
  );
  const entries = readFailureRecords(dir) as { record?: { exceptionId?: string } }[];
  assert.deepEqual(
    entries.map(({ record }) => record?.exceptionId),
    ['flux-talks-perimeter'],
  );
  const matched = matchedExceptionIds(entries);
  // So a scheduled run counts its exception live; one that waived nothing is still stale.
  const stale = messages(
    qualityText([
      perimeterEntry('flux-talks-perimeter', talks),
      perimeterEntry('flux-nothing-perimeter', '#contact a'),
    ]),
    fixtureContext({ today: '2026-10-31', mode: 'scheduled', matched }),
  ).filter((message) => /matched no failure/.test(message));
  assert.equal(stale.length, 1, stale.join('\n'));
  assert.match(stale[0]!, /flux-nothing-perimeter/);
  // A failed cell whose findings were all waived (it failed on something else) writes them, and
  // a record of its failure beside them, which names no exception.
  const failed = path.join(path.dirname(dir), 'failed');
  await writeTestRecords(
    [finishedCell('unexpected', [waived])],
    { gate: 'quality-pr', reproCommand: 'pnpm quality:pr' },
    failed,
  );
  assert.deepEqual(
    (readFailureRecords(failed) as { record?: { exceptionId?: string } }[])
      .map(({ record }) => record?.exceptionId ?? '-')
      .sort(),
    ['-', 'flux-talks-perimeter'],
  );
  // A passing cell with no waived finding writes nothing.
  const none = path.join(path.dirname(dir), 'none');
  await writeTestRecords(
    [finishedCell('expected', [])],
    { gate: 'quality-pr', reproCommand: 'pnpm quality:pr' },
    none,
  );
  assert.deepEqual(readFailureRecords(none), []);
});

test("exceptionFor matches a failure's exact scope, and a decorative exception only its element", () => {
  const { exceptions } = validateExceptions(
    fixtureInputs({ quality: 'valid.yml' }),
    fixtureContext(),
  );
  const target = {
    gate: 'targets',
    rule: 'primary',
    surface: 'login',
    route: '/studio/login',
    tuple: 'platform-neutral/warm-parchment/humanist-ui/light',
    viewport: '390x844',
    inputMode: 'touch',
    // A field the gate doesn't vary on doesn't keep it from matching.
    preferenceMode: 'forced-colors',
  };
  assert.equal(exceptionFor(target, exceptions)?.id, 'login-primary-target');
  for (const change of [
    { viewport: '844x390' },
    { inputMode: 'mouse' },
    { rule: 'narrow' },
    { route: '/' },
  ]) {
    assert.equal(
      exceptionFor({ ...target, ...change }, exceptions),
      undefined,
      JSON.stringify(change),
    );
  }
  const decorative = {
    gate: 'axe',
    rule: 'color-contrast',
    surface: 'fallback',
    route: '/',
    tuple: 'platform-neutral/warm-parchment/humanist-ui/light',
    viewport: '1440x900',
    preferenceMode: 'default',
  };
  assert.equal(
    exceptionFor({ ...decorative, selector: 'main .hero-watermark' }, exceptions)?.id,
    'fallback-decorative-watermark',
  );
  assert.equal(exceptionFor({ ...decorative, selector: 'main p' }, exceptions), undefined);
  // A quarantine waives no failure: it covers a flake, through quarantineFor().
  const flaky = {
    gate: 'keyboard',
    rule: 'dialog-escape',
    surface: 'login',
    route: '/studio/login',
    tuple: 'platform-neutral/warm-parchment/humanist-ui/light',
    viewport: '1440x900',
    preferenceMode: 'default',
  };
  assert.equal(exceptionFor(flaky, exceptions), undefined);
  assert.equal(quarantineFor(flaky, exceptions)?.id, 'login-dialog-escape-flake');
  assert.equal(quarantineFor({ ...flaky, viewport: '390x844' }, exceptions), undefined);
  const { falsePositives } = validateExceptions(
    fixtureInputs({ quality: 'valid.yml' }),
    fixtureContext(),
  );
  assert.equal(
    falsePositiveFor({ rule: 'color-contrast', selector: 'main .status-badge' }, falsePositives)
      ?.id,
    'login-badge-contrast',
  );
  assert.equal(
    falsePositiveFor({ rule: 'color-contrast', selector: 'main p' }, falsePositives),
    undefined,
  );
  assert.ok(exceptions.every((entry: QualityException) => entry.kind !== 'budget'));
});

test('pnpm quality:exceptions passes on the repository, and refuses an argument it does not take', () => {
  const tsx = createRequire(import.meta.url).resolve('tsx/cli');
  const script = fileURLToPath(new URL('./exceptions.ts', import.meta.url));
  const run = spawnSync(process.execPath, [tsx, script], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(
    run.stdout,
    /^\[quality:exceptions\] quality\/exceptions\.yml: \d+ exceptions? and \d+ false positives?; runtime-budgets\.json: \d+ budget exceptions?\./,
  );
  const usage = spawnSync(process.execPath, [tsx, script, '--scheduled'], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
  assert.match(
    usage.stderr,
    /^Usage: pnpm quality:exceptions \[--scheduled --matched <failure records dir>\]/,
  );
});
