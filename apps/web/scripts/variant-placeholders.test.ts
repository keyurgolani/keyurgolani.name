import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLACEHOLDER, placeholderFields } from './variant-placeholders';

// check:variants refuses a scaffold's placeholder copy in a manifest's
// promise or description (A2), and no package here still has one.

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

test('the placeholder at the start of the promise or the description is refused, in either field or both', () => {
  const promise = `${PLACEHOLDER} the composition idea from DESIGN.md, in one sentence.`;
  const description = `${PLACEHOLDER} what the composition does with the portfolio, from DESIGN.md.`;
  assert.deepEqual(placeholderFields({ promise, description: 'Real words.' }), ['promise']);
  assert.deepEqual(placeholderFields({ promise: 'Real words.', description }), ['description']);
  assert.deepEqual(placeholderFields({ promise, description }), ['promise', 'description']);
  assert.deepEqual(placeholderFields({ promise: `  ${promise}`, description: 'Real.' }), [
    'promise',
  ]);
  // Real copy passes, the phrase later in a sentence included.
  assert.deepEqual(
    placeholderFields({
      promise: 'Each work as a page of its own.',
      description: 'It never says "Replace this with" anywhere a reader starts.',
    }),
    [],
  );
});

test("new-variant.mjs's scaffold copy is what the rule refuses", () => {
  const scaffold = readFileSync(
    path.join(REPO_ROOT, 'skills/variant-developer/scripts/new-variant.mjs'),
    'utf8',
  );
  const written = [...scaffold.matchAll(/manifest\.(promise|description) =\s*'([^']+)'/g)];
  assert.equal(written.length, 2);
  for (const [, field, value] of written) {
    assert.deepEqual(placeholderFields({ [field!]: value }), [field], field);
  }
});

test("no composition in packages/ still has the scaffold's copy", () => {
  const packages = path.join(REPO_ROOT, 'packages');
  const found = readdirSync(packages)
    .map((name) => path.join(packages, name, 'manifest.json'))
    .filter((file) => existsSync(file))
    .flatMap((file) =>
      placeholderFields(JSON.parse(readFileSync(file, 'utf8'))).map(
        (field) => `${path.relative(REPO_ROOT, file)}: ${field}`,
      ),
    );
  assert.deepEqual(found, []);
});
