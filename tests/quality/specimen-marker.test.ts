import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The busy-specimen marker (#11): settle() waits on no aria-busy inside an
// element marked data-quality-specimen="busy", so only a fixture may carry
// it, the primitives fixture's loading Actions above all. On a real page it
// would let a stuck Save or Load settle.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MARKER = 'data-quality-specimen';

/** Where the marker may be: the fixture route group, a fixture package, and the harness itself. */
export function markerAllowed(file: string): boolean {
  return (
    file.startsWith('apps/web/src/app/(fixtures)/') ||
    /^packages\/[^/]*fixtures[^/]*\//.test(file) ||
    file.startsWith('tests/quality/')
  );
}

/** Every tracked file that names the marker. */
function filesNamingTheMarker(): string[] {
  const listed = execFileSync('git', ['grep', '-l', '-F', MARKER], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return listed.split('\n').filter(Boolean);
}

test('only a fixture, or the harness, names the busy-specimen marker', () => {
  const outside = filesNamingTheMarker().filter((file) => !markerAllowed(file));
  assert.deepEqual(outside, []);
});

test("the primitives fixture marks its loading Actions, so the check isn't empty", () => {
  const specimen = readFileSync(
    path.join(ROOT, 'apps/web/src/app/(fixtures)/_components/specimen.tsx'),
    'utf8',
  );
  assert.ok(specimen.includes(`${MARKER}="busy"`));
  assert.ok(
    filesNamingTheMarker().includes('apps/web/src/app/(fixtures)/_components/specimen.tsx'),
  );
});

test('a file outside the fixtures and the harness is no place for it', () => {
  for (const file of [
    'apps/web/src/app/(studio)/_components/shell/studio-shell.tsx',
    'apps/web/src/app/(site)/layout.tsx',
    'packages/appearance/src/primitives/action-markup.tsx',
    'packages/variant-spatial-bento/src/stage-slot.tsx',
  ]) {
    assert.equal(markerAllowed(file), false, file);
  }
  for (const file of [
    'apps/web/src/app/(fixtures)/_components/specimen.tsx',
    'packages/appearance-fixtures-languages/src/index.ts',
    'tests/quality/fixtures/a11y/busy-specimen.html',
  ]) {
    assert.equal(markerAllowed(file), true, file);
  }
});
