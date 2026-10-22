import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPOSITION_IDS, FALLBACK_ID, MISSING_VARIANT_ID } from '@portfolio/variant-contract';

// Nothing in the host's source names a variant (#5, Slice 3): neither an id
// the contract reserves for the platform's own packages nor the one fixtures
// select to reach the fallback composition. The host reaches the fallback
// through FALLBACK_VARIANT_ID, as lib/sample.ts and lib/variants.ts do, and
// every other variant through the generated registry, which the scan leaves
// out, as it does the tests.

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GENERATED = path.join(SRC, 'lib', 'generated');
const escape = (id: string) => id.replace(/[-]/g, '\\-');

/**
 * A composition id or MISSING_VARIANT_ID anywhere, as a whole token: on its
 * own, in a path or query, in a selector, in a comment.
 */
const token = () =>
  new RegExp(
    `(?<![\\w-])(${[...COMPOSITION_IDS, MISSING_VARIANT_ID].map(escape).join('|')})(?![\\w-])`,
    'g',
  );

/** The fallback's id as a string, quoted in any of the three quotes: the word alone is common. */
const fallback = () => new RegExp(`(['"\`])${escape(FALLBACK_ID)}\\1`, 'g');

/** Every id `text` names, as written. */
const named = (text: string) =>
  [...text.matchAll(token()), ...text.matchAll(fallback())].map(([written]) => written);

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
  const found = files.flatMap((file) =>
    named(readFileSync(file, 'utf8')).map((written) => `${path.relative(SRC, file)}: ${written}`),
  );
  assert.deepEqual(found, []);
});

test('the scan finds a composition id or missing-variant wherever it is written', () => {
  for (const id of [...COMPOSITION_IDS, MISSING_VARIANT_ID]) {
    for (const text of [
      `const selected = '${id}';`,
      `const selected = "${id}";`,
      `const selected = \`${id}\`;`,
      `redirect('/sample?variant=${id}');`,
      `const main = '[data-variant=${id}] main';`,
      `[data-variant='${id}'] main { display: grid; }`,
      `// Until #13, ${id} renders as the fallback.`,
    ]) {
      assert.deepEqual(named(text), [id], text);
    }
    // A longer id that only starts or ends with one is another id.
    for (const text of [`'${id}-2'`, `'old-${id}'`, `${id}_draft`]) {
      assert.deepEqual(named(text), [], text);
    }
  }
});

test('the scan finds fallback written as a string, and not the word', () => {
  for (const quote of ["'", '"', '`']) {
    const text = `const selected = ${quote}${FALLBACK_ID}${quote};`;
    assert.deepEqual(named(text), [`${quote}${FALLBACK_ID}${quote}`], text);
  }
  for (const text of [
    '// The fallback composition stands in.',
    'const id = FALLBACK_VARIANT_ID;',
    "import { Fallback } from '@portfolio/fallback-composition';",
    'loading={fallbackAlt}',
  ]) {
    assert.deepEqual(named(text), [], text);
  }
});
