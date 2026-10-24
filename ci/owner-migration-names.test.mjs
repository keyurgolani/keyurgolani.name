// #18's owner migration prompt uses only names this checkout ships
// (ci/lib/owner-migration-names.mjs): every environment variable,
// portfolio-store command, Studio operation, route, flag, code, Compose
// name, boundary attribute, and profile it names is defined in the code or
// the docs. The last rebase before a merge runs this, so a rename anywhere
// fails until the prompt follows it. Each kind is proved by renaming one of
// its names in a copy of the prompt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  missingNames,
  promptNames,
  promptText,
  readSources,
} from './lib/owner-migration-names.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC = readFileSync(path.join(ROOT, 'docs/operations/owner-migration.md'), 'utf8');
const PROMPT = promptText(DOC);
const SOURCES = readSources(ROOT);

test('every name the owner migration prompt uses is defined in the code or docs this checkout ships (#18)', () => {
  assert.deepEqual(missingNames(PROMPT, SOURCES), []);
  const names = promptNames(PROMPT);
  // The kinds the prompt leans on, so the check can't pass by reading nothing.
  for (const name of [
    'PORTFOLIO_PROFILE',
    'PORTFOLIO_ORIGIN',
    'PORTFOLIO_SOURCE_DIR',
    'PORTFOLIO_DATA_DIR',
    'PORTFOLIO_AUTH_PASSWORD_HASH_FILE',
    'PORTFOLIO_TRUSTED_PROXY_HOPS',
  ]) {
    assert.ok(names.env.includes(name), name);
  }
  for (const command of [
    'status',
    'history',
    'verify',
    'import',
    'rollback',
    'backup',
    'restore',
  ]) {
    assert.ok(names.storeCommands.includes(command), command);
  }
  assert.deepEqual(names.scripts.sort(), ['config:migrate', 'config:validate']);
  assert.ok(names.operations.includes('config.status'));
  assert.ok(names.routes.includes('/api/ready'));
  assert.ok(names.codes.includes('authentication_required'));
  assert.ok(names.composeNames.includes('portfolio-data'));
  assert.ok(names.attributes.includes('data-variant'));
  assert.ok(names.profiles.includes('owner'));
});

/** The prompt with `from` replaced by `to`, once, which must be in it. */
function renamed(from, to) {
  assert.ok(PROMPT.includes(from), from);
  return PROMPT.replace(from, to);
}

test('a name the release no longer ships fails the check, for every kind of name (#18)', () => {
  for (const [from, to, problem] of [
    [
      'PORTFOLIO_TRUSTED_PROXY_HOPS',
      'PORTFOLIO_TRUSTED_PROXY_HOP',
      'environment variable: PORTFOLIO_TRUSTED_PROXY_HOP',
    ],
    ['m18_store rollback --to', 'm18_store revert --to', 'portfolio-store command: revert'],
    [
      '/api/studio/draft.getWorking',
      '/api/studio/draft.working',
      'Studio operation: draft.working',
    ],
    ['`--drop-unknown`', '`--drop-unknowns`', 'flag: --drop-unknowns'],
    ['`/api/ready`', '`/api/readiness`', 'route or path: /api/readiness'],
    ['`authentication_required`', '`auth_required`', 'code or event: auth_required'],
    ['`portfolio-data`', '`portfolio-state`', 'Compose or package name: portfolio-state'],
    ['`data-color-scheme`', '`data-colour-scheme`', 'boundary attribute: data-colour-scheme'],
    ['m18_tools proxy-lines', 'm18_tools proxy-line', 'containment tool: proxy-line'],
    ['pnpm config:validate', 'pnpm config:check', 'pnpm script: config:check'],
    ['the `owner` profile', 'the `owners` profile', 'profile: owners'],
  ]) {
    assert.ok(missingNames(renamed(from, to), SOURCES).includes(problem), `${from} -> ${to}`);
  }
});

test("a placeholder, a helper the prompt defines, and anything outside the prompt's markers aren't names to look up (#18)", () => {
  const extra = [
    'Run `m18_extra` after `m18_extra() { true; }` with `<PORTFOLIO_NOT_A_NAME>` in place.',
  ].join('\n');
  assert.deepEqual(missingNames(`${PROMPT}\n${extra}`, SOURCES), []);
  const outside = `${DOC}\nAfter the prompt: \`PORTFOLIO_GONE\` and \`gone_code\`.\n`;
  assert.deepEqual(missingNames(promptText(outside), SOURCES), []);
  assert.throws(() => promptText('no markers here'), /No prompt markers/);
});
