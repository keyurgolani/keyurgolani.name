import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FALLBACK_ID, MISSING_VARIANT_ID, RESERVED_IDS } from '@portfolio/variant-contract';

// Nothing in the host's source names a variant (#5, Slice 3): neither an id
// the contract reserves for the platform's own packages nor the one fixtures
// select to reach the fallback composition. The host reaches the fallback
// through FALLBACK_VARIANT_ID, as lib/sample.ts and lib/variants.ts do, and
// every other variant through the generated registry and the experience
// segments registry generation writes beside it (#6, Slice 2), which the
// scan leaves out, as it does the tests.

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GENERATED = new Set([
  path.join(SRC, 'lib', 'generated'),
  path.join(SRC, 'app', '(site)', '%5Fexperience'),
]);
const escape = (id: string) => id.replace(/[-]/g, '\\-');

/**
 * A reserved id that's one plain word (fallback, shell, and the like) is a
 * common word in host source: in prose, identifiers, and paths. It counts
 * only where it names a variant: as a whole string, after `variant=`, or in a
 * `data-variant` selector. A hyphenated id is never a word, so it counts
 * anywhere as a whole token. MISSING_VARIANT_ID is hyphenated.
 */
const ALL = [...RESERVED_IDS, MISSING_VARIANT_ID];
const WORDS = ALL.filter((id) => !id.includes('-'));
const TOKENS = ALL.filter((id) => id.includes('-'));

/**
 * One of TOKENS anywhere, as a whole token: on its own, in a path or query,
 * in a selector, in a comment.
 */
const token = () => new RegExp(`(?<![\\w-])(${TOKENS.map(escape).join('|')})(?![\\w-])`, 'g');

/** One of WORDS as a whole string, quoted in any of the three quotes. */
const wordString = () => new RegExp(`(['"\`])(${WORDS.map(escape).join('|')})\\1`, 'g');

/** One of WORDS unquoted as a variant, `variant=<id>` or `data-variant=<id>` (quoted, it's a whole string). */
const wordVariant = () => new RegExp(`variant=(${WORDS.map(escape).join('|')})(?![\\w-])`, 'g');

/** Every id `text` names, as written. */
const named = (text: string) =>
  [...text.matchAll(token()), ...text.matchAll(wordString()), ...text.matchAll(wordVariant())].map(
    ([written]) => written,
  );

/** Every source file under `dir`, but the tests and what registry generation writes. */
function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!GENERATED.has(file)) yield* sourceFiles(file);
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

test('the scan finds a hyphenated reserved id, or missing-variant, wherever it is written', () => {
  for (const id of TOKENS) {
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

test('the scan finds a one-word id written as a variant, and not the word', () => {
  assert.ok(WORDS.includes(FALLBACK_ID), 'fallback is one of the one-word ids');
  for (const id of WORDS) {
    for (const quote of ["'", '"', '`']) {
      const text = `const selected = ${quote}${id}${quote};`;
      assert.deepEqual(named(text), [`${quote}${id}${quote}`], text);
    }
    for (const text of [
      `redirect('/sample?variant=${id}');`,
      `[data-variant='${id}'] main { display: grid; }`,
      `const main = '[data-variant=${id}] main';`,
    ]) {
      assert.equal(named(text).length, 1, text);
    }
    for (const text of [
      `// The ${id} composition stands in.`,
      `const ${id}Width = 3;`,
      `import { Panel } from '../${id}/panel';`,
      `import { Demo } from './demo-${id}';`,
      `'${id}-2'`,
      `'old-${id}'`,
    ]) {
      assert.deepEqual(named(text), [], text);
    }
  }
  for (const text of [
    'const id = FALLBACK_VARIANT_ID;',
    "import { Fallback } from '@portfolio/fallback-composition';",
    'loading={fallbackAlt}',
  ]) {
    assert.deepEqual(named(text), [], text);
  }
});
