import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parsePortfolio } from './load';
import { detectFormat } from './source';

// The bundled example is what a fresh clone renders, and the harness fixtures
// are what the browser tests render. Both must stay valid documents.
const repoFile = (relative: string) =>
  fileURLToPath(new URL(`../../../${relative}`, import.meta.url));

function read(relative: string) {
  const path = repoFile(relative);
  const result = parsePortfolio(readFileSync(path, 'utf8'), detectFormat(path));
  assert.equal(result.ok, true, result.ok ? '' : JSON.stringify(result.problems, null, 2));
  if (!result.ok) throw new Error(`${relative} is invalid`);
  return result.value;
}

for (const relative of ['portfolio.example.yml', 'tests/fixtures/portfolio.yml']) {
  test(`${relative} is a valid portfolio document`, () => {
    const portfolio = read(relative);
    assert.ok(portfolio.identity.name.length > 0);
    assert.ok(portfolio.sections.length > 0);
  });
}

test("the example's section ids are the anchors the baseline rendered for it", () => {
  const baseline = JSON.parse(
    readFileSync(repoFile('tests/fixtures/baseline/example-home.json'), 'utf8'),
  ) as { sectionIds: string[] };
  assert.deepEqual(
    read('portfolio.example.yml').sections.map((section) => section.id),
    baseline.sectionIds,
  );
});
