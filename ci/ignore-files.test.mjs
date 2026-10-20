import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The owner's documents never reach a commit or the image (#4, item 9), and
// the bundled examples and the schema's fixtures always do.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAMES = ['portfolio', 'site'].flatMap((document) =>
  ['yml', 'yaml', 'json'].map((extension) => `${document}.${extension}`),
);
const EXAMPLES = ['portfolio.example.yml', 'site.example.yml'];
const FIXTURES = [
  'packages/schema/src/__fixtures__/pairs/writing/yaml/portfolio.yml',
  'packages/schema/src/__fixtures__/pairs/writing/json/site.json',
  'skills/portfolio-author/scripts/__fixtures__/valid/site.yml',
];

/** Which of `files` git ignores, by the rules alone, tracked or not. */
function gitIgnored(files) {
  const run = spawnSync(
    'git',
    ['check-ignore', '--no-index', '--verbose', '--non-matching', ...files],
    {
      cwd: ROOT,
      encoding: 'utf8',
    },
  );
  assert.ok(run.status === 0 || run.status === 1, run.stderr);
  return run.stdout
    .split('\n')
    .filter((line) => line && !line.startsWith('::\t'))
    .map((line) => line.split('\t')[1]);
}

test('git ignores the six document names in config/ and at the root, and nothing deeper', () => {
  // config/portfolio.yml and config/site.yml among them.
  const documents = [...NAMES.map((name) => `config/${name}`), ...NAMES];
  assert.deepEqual(gitIgnored([...documents, ...EXAMPLES, ...FIXTURES]), documents);
  const lines = readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split('\n');
  for (const name of NAMES) assert.ok(lines.includes(`/${name}`), name);
});

test('the image build context leaves the documents out and keeps both examples', () => {
  const rules = readFileSync(path.join(ROOT, '.dockerignore'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  for (const name of NAMES) assert.ok(rules.includes(name), name);
  // Docker's rules, as far as this file uses them: `*` within a name, `**/`
  // for any directories, a match on a directory covers what's in it, and the
  // last rule that matches decides.
  const glob = (pattern) => {
    const source = pattern
      .split('**/')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
      .join('(?:.*/)?');
    return new RegExp(`^${source}(?:/.*)?$`);
  };
  const ignored = (file) => {
    let result = false;
    for (const rule of rules) {
      const negated = rule.startsWith('!');
      if (glob(negated ? rule.slice(1) : rule).test(file)) result = !negated;
    }
    return result;
  };
  assert.ok(ignored('apps/web/.next/cache/x') && !ignored('apps/web/src/app/page.tsx'));
  for (const file of [...NAMES, 'portfolio.toml', 'config/portfolio.yml', 'config/site.yml']) {
    assert.ok(ignored(file), file);
  }
  for (const file of EXAMPLES) assert.equal(ignored(file), false, file);
});
