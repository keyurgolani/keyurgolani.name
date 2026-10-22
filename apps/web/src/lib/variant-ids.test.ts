import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MISSING_VARIANT_ID, RESERVED_IDS } from '@portfolio/variant-contract';

// Nothing in the host's source names a variant (#5, Slice 3): neither an id
// the contract reserves for the platform's own packages nor the one fixtures
// select to reach the fallback composition. The host reaches the fallback
// through FALLBACK_VARIANT_ID, as lib/sample.ts and lib/variants.ts do, and
// every other variant through the generated registry, which the scan leaves
// out, as it does the tests.

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GENERATED = path.join(SRC, 'lib', 'generated');
const IDS = [...RESERVED_IDS, MISSING_VARIANT_ID];

/** An id written as a string in source: quoted, in any of the three quotes. */
const literal = () =>
  new RegExp(`(['"\`])(${IDS.map((id) => id.replace(/[-]/g, '\\-')).join('|')})\\1`, 'g');

/** Every source file under `dir`, but the tests and the generated registry. */
function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (file !== GENERATED) yield* sourceFiles(file);
    } else if (/\.(ts|tsx|mts|mjs|js|css)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      yield file;
    }
  }
}

test('no host source file names a variant id', () => {
  const files = [...sourceFiles(SRC)];
  assert.ok(files.length > 50, `the host's source, not ${files.length} files`);
  const named = files.flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(literal())].map(
      ([written]) => `${path.relative(SRC, file)}: ${written}`,
    ),
  );
  assert.deepEqual(named, []);
});

test('the scan finds each id written in any quote', () => {
  for (const id of IDS) {
    for (const quote of ["'", '"', '`']) {
      const text = `const selected = ${quote}${id}${quote};`;
      assert.equal([...text.matchAll(literal())].length, 1, text);
    }
    // A longer id that only starts with one is no match.
    assert.equal([...`'${id}-2'`.matchAll(literal())].length, 0, id);
  }
});
