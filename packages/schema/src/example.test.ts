import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { detectFormat, parsePortfolio } from './load';

// The bundled example is what a fresh clone renders, and the harness fixtures
// are what the browser tests render. Both must stay schema-valid.
const repoFile = (relative: string) =>
  fileURLToPath(new URL(`../../../${relative}`, import.meta.url));

for (const relative of ['portfolio.example.yml', 'tests/fixtures/portfolio.yml']) {
  test(`${relative} passes the portfolio schema`, () => {
    const path = repoFile(relative);
    const portfolio = parsePortfolio(readFileSync(path, 'utf8'), detectFormat(path));
    assert.ok(portfolio.identity.name.length > 0);
    assert.ok(portfolio.sections.length > 0);
  });
}
