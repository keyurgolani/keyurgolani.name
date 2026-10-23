import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import { FONTS_HEADER } from './lib/visual';

// #11's docs (11-4): the four gate docs point at the quality commands, and
// CONTRIBUTING.md holds the owner's steps, the fork-safe PR check and the
// font list's bootstrap, in the words the workflows and scripts use. The
// docs check (ci/docs-check.mjs) proves every `pnpm` script they name
// exists; this proves they name the right ones.

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

const GATE_DOCS = {
  'docs/variants.md': [
    'pnpm quality:pr',
    'QUALITY_CHANGED_BASE=origin/next',
    'pnpm quality:checklist',
    'pnpm quality:full',
    'pnpm quality:release',
  ],
  'skills/variant-developer/references/quality-gates.md': [
    'QUALITY_CHANGED_BASE=origin/next pnpm quality:pr',
    'pnpm quality:checklist -- <id>',
    'quality/manual-runs/',
  ],
  'skills/variant-developer/references/audit-checklist.md': [
    'QUALITY_CHANGED_BASE=origin/next pnpm quality:pr',
    'pnpm quality:checklist -- <id> --record',
    'pnpm quality:meta',
  ],
  'CONTRIBUTING.md': [
    'pnpm quality:pr',
    'pnpm quality:full -- --shard=1/6',
    'pnpm quality:merge',
    'pnpm quality:release',
    'pnpm quality:checklist',
    'pnpm ci:quality-release',
    'quality/manual-runs/',
  ],
} as const;

test('the four gate docs point at the quality commands', () => {
  for (const [file, phrases] of Object.entries(GATE_DOCS)) {
    const text = read(file);
    for (const phrase of phrases) assert.ok(text.includes(phrase), `${file} names ${phrase}`);
  }
});

test('the fork-safe PR check names what the workflows upload and what the owner looks for', () => {
  const text = read('CONTRIBUTING.md');
  const section = text.slice(text.indexOf('**Fork-safe PR check.**'), text.indexOf('**Timings.**'));
  assert.ok(section.length > 0, 'CONTRIBUTING.md has the fork-safe PR check');
  const ci = parse(read('.github/workflows/ci.yml')) as {
    jobs: Record<string, { steps: { uses?: string; with?: { name?: string } }[] }>;
  };
  for (const job of ['quality-pr', 'quality-meta']) {
    const upload = ci.jobs[job]!.steps.find((step) =>
      /^actions\/upload-artifact@/.test(step.uses ?? ''),
    );
    assert.ok(section.includes(`\`${upload!.with!.name}\``), `it names ${upload!.with!.name}`);
  }
  for (const phrase of [
    'second GitHub account',
    'tests/quality/lib/state-fixtures.ts',
    'GITHUB_TOKEN Permissions',
    '`Contents: read`',
    '`static` and `quality-meta` pass',
    'pnpm check:workflows',
    'Scrub reports',
    '14 days',
    'new, empty directory',
    'quality/verdict.json',
    'resolved-tokens.json',
    '`failures/`',
    '[scrubbed]',
    'canary-leaked',
    'Close the PR unmerged',
  ]) {
    assert.ok(section.includes(phrase), `the check names ${phrase}`);
  }
  // The PR runs' retention, as ci.yml sets it.
  assert.match(
    read('.github/workflows/ci.yml'),
    /REPORT_RETENTION_DAYS: \$\{\{ github\.event_name == 'pull_request' && 14/,
  );
});

test("the font list's bootstrap is the scripts' own: a new directory, a check, and a byte-for-byte copy", () => {
  const text = read('CONTRIBUTING.md');
  for (const phrase of [
    'reports-quality-full-1',
    'new, empty directory',
    'pnpm quality:fonts -- <that directory>/quality/fonts.observed.txt',
    'pnpm quality:fonts -- <that file> --write',
    'byte for byte',
    'starts once this reaches `main`',
  ]) {
    assert.ok(text.includes(phrase), phrase);
  }
  assert.ok(FONTS_HEADER.includes('"The nightly quality matrix"'));
  assert.ok(text.includes('**The nightly quality matrix.**'));
  // The owner's first pass, named and not faked: no record yet, only the templates.
  assert.match(text, /The first pass is the owner's: VoiceOver with Safari on macOS/);
});
