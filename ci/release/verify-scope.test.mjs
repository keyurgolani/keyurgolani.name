// rc-verify's quality scope check (verify-scope.mjs): a candidate tag is judged against its own
// scope file and records list, never another release's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCOPE_FILE, scopeMismatch } from './verify-scope.mjs';

const scope = (release) => ({ release, scope: 'default-packs', records: 'records.json' });

test("a candidate tag whose scope file is its own passes, and the checked-in file is RC1's", () => {
  assert.equal(scopeMismatch('v1.0.0-rc.1', scope('1.0.0-rc.1')), null);
  const checkedIn = JSON.parse(
    readFileSync(new URL(`../../${SCOPE_FILE}`, import.meta.url), 'utf8'),
  );
  assert.equal(scopeMismatch('v1.0.0-rc.1', checkedIn), null);
});

test("a candidate tag whose scope file is another release's, or names none, is refused", () => {
  assert.equal(
    scopeMismatch('v1.0.0-rc.2', scope('1.0.0-rc.1')),
    `${SCOPE_FILE} is for 1.0.0-rc.1, and this tag is 1.0.0-rc.2: commit 1.0.0-rc.2's scope and records list first`,
  );
  assert.match(scopeMismatch('v1.1.0-rc.1', scope('1.0.0-rc.1')), /is for 1\.0\.0-rc\.1/);
  assert.equal(
    scopeMismatch('v1.0.0-rc.1', {}),
    `${SCOPE_FILE} names no release, so nothing says it is 1.0.0-rc.1's`,
  );
  assert.match(scopeMismatch('v1.0.0-rc.1', null), /names no release/);
});

test('a tag that is not a release candidate is refused', () => {
  for (const tag of ['v1.0.0', '1.0.0-rc.1', 'v1.0.0-rc.0', 'main', '']) {
    assert.match(scopeMismatch(tag, scope('1.0.0-rc.1')), /is not a release candidate tag$/, tag);
  }
});

test("rc-verify's scripts import only what its sparse checkout holds: ci/release/, and node:", async () => {
  const { readFileSync: read } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const release = fileURLToPath(new URL('./', import.meta.url));
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = read(file, 'utf8');
    for (const [, spec] of text.matchAll(
      /^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm,
    )) {
      if (spec.startsWith('node:')) continue;
      assert.ok(spec.startsWith('./'), `${path.relative(root, file)} imports ${spec}`);
      const next = path.resolve(path.dirname(file), spec);
      assert.ok(
        next.startsWith(release),
        `${path.relative(root, file)} reaches ${path.relative(root, next)}`,
      );
      walk(next);
    }
    for (const [, spec] of text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      assert.ok(
        spec.startsWith('node:'),
        `${path.relative(root, file)} imports ${spec} at run time`,
      );
    }
  };
  walk(path.join(release, 'verify-rc.mjs'));
  walk(path.join(release, 'verify-scope.mjs'));
  assert.ok(seen.size >= 5, [...seen].join(', '));
  // And release.yml's rc-verify checks out exactly those two directories.
  const { parse } = await import('yaml');
  const workflow = parse(read(path.join(root, '.github/workflows/release.yml'), 'utf8'));
  const checkout = workflow.jobs['rc-verify'].steps.find((each) =>
    (each.uses ?? '').startsWith('actions/checkout@'),
  );
  assert.deepEqual(checkout.with['sparse-checkout'].trim().split('\n'), [
    'ci/release/',
    'quality/release/',
  ]);
});
