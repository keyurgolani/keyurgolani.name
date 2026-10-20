import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLED_SAMPLE_NAMES } from './catalog-documents';
import { openSampleCatalog } from './catalog-sample';

// The sample adapter for `demo` (#1, item 16): the bundled example, read
// once and frozen.

const EXAMPLE = fileURLToPath(new URL('../../../../portfolio.example.yml', import.meta.url));

function scratch(t: TestContext): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'catalog-sample-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('it serves the bundled sample, frozen', async () => {
  const opened = openSampleCatalog({ examplePath: EXAMPLE });
  assert.ok(opened.ok, JSON.stringify(opened.issues));
  assert.deepEqual(opened.issues, []);
  const live = await opened.reader.getLive();
  assert.ok(BUNDLED_SAMPLE_NAMES.includes(live.unit.portfolio.identity.name));
  assert.match(live.revisionId, /^sample-[0-9a-f]{12}$/);
  assert.ok(Object.isFrozen(live));
  assert.ok(Object.isFrozen(live.unit.portfolio.identity));
  assert.equal(await opened.reader.getLive(), live);
});

test('a build without its sample refuses to start demo', (t) => {
  const opened = openSampleCatalog({ examplePath: path.join(scratch(t), 'portfolio.example.yml') });
  assert.equal(opened.ok, false);
  assert.deepEqual(
    opened.issues.map((issue) => `${issue.severity} ${issue.key}:${issue.code} ${issue.file}`),
    ['fatal PORTFOLIO_PROFILE:sample_missing portfolio.example.yml'],
  );
});

test('a sample that fails the schema refuses to start demo, without quoting it', (t) => {
  const file = path.join(scratch(t), 'portfolio.example.yml');
  writeFileSync(file, 'schemaVersion: 2\nidentity:\n  name: canary-name\n  canary-field: x\n');
  const opened = openSampleCatalog({ examplePath: file });
  assert.equal(opened.ok, false);
  assert.deepEqual(
    opened.issues.map((issue) => `${issue.key}:${issue.code}`),
    ['PORTFOLIO_PROFILE:sample_invalid'],
  );
  assert.ok(!JSON.stringify(opened.issues).includes('canary'));
});
