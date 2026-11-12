import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// A journal an e2e spec seeds must read as one (row 88c-RC2's first proof, 14c88446e, 2026-11-10).
// Studio's journal is an array of entries (apps/web/src/lib/studio/journal.ts), and readJournal
// removes any value that isn't one the moment it reads: the live /studio shell, and the sign-in
// page's PruneJournal, each read it. So a stand-in like '{"kept":true}', set on a page where Studio
// runs, can be gone before a test snapshots it (the no-JS discard's storage read, which raced the
// shell), and a check that it was cleared can pass on the prune alone, not on what the test means.
// A seed is an array, as a real tab's entry is.

const E2E = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'e2e');

test("no e2e spec seeds Studio's journal with a value the journal drops as it reads", () => {
  const found = readdirSync(E2E)
    .filter((name) => name.endsWith('.spec.ts'))
    .flatMap((name) => {
      const text = readFileSync(path.join(E2E, name), 'utf8');
      if (!text.includes('portfolio-studio:journal')) return [];
      // localStorage.setItem(key, '<value>') where the spec passes the journal key as `key`.
      return [...text.matchAll(/localStorage\.setItem\(\s*key\s*,\s*'([^']*)'\s*\)/g)]
        .map((match) => match[1])
        .filter((value) => !value.startsWith('['))
        .map((value) => `${name}: ${value}`);
    });
  assert.deepEqual(found, []);
});
