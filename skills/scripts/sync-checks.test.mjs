import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// __dirname is skills/scripts; up 2 = repo root.
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(__dirname, 'sync-checks.mjs');

function run() {
  return spawnSync('node', [SCRIPT], { encoding: 'utf8', cwd: REPO_ROOT });
}

test('sync-checks passes on the live tree', () => {
  const r = run();
  assert.equal(r.status, 0, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
});

test('sync-checks detects when section-kinds.md files differ', () => {
  const filePath = path.join(REPO_ROOT, 'skills/variant-developer/references/section-kinds.md');
  const original = readFileSync(filePath, 'utf8');
  try {
    writeFileSync(filePath, original + '\n<!-- drift -->\n');
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /section-kinds|differ|identical/i);
  } finally {
    writeFileSync(filePath, original);
  }
});

test('sync-checks detects missing kit export in catalog', () => {
  // Add a fake export to kit and verify the catalog drift is caught.
  const indexPath = path.join(REPO_ROOT, 'packages/kit/src/index.ts');
  const original = readFileSync(indexPath, 'utf8');
  try {
    writeFileSync(indexPath, original + '\nexport function fakeDriftHelper() {}\n');
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /fakeDriftHelper|kit-catalog/i);
  } finally {
    writeFileSync(indexPath, original);
  }
});

test('sync-checks detects schema.md missing a kind', () => {
  const schemaMd = path.join(REPO_ROOT, 'skills/portfolio-author/references/schema.md');
  const original = readFileSync(schemaMd, 'utf8');
  try {
    // Remove every mention of "kind: hero" so schema.md no longer covers it
    const tampered = original.replace(/kind:\s*hero/gi, 'kind: HEROO_RENAMED');
    writeFileSync(schemaMd, tampered);
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /hero|schema\.md/i);
  } finally {
    writeFileSync(schemaMd, original);
  }
});

test('sync-checks detects malformed SKILL.md frontmatter', () => {
  const skillPath = path.join(REPO_ROOT, 'skills/portfolio-author/SKILL.md');
  const original = readFileSync(skillPath, 'utf8');
  try {
    // Replace 'name: portfolio-author' with an invalid uppercase name
    const tampered = original.replace(/^name: portfolio-author$/m, 'name: Portfolio-Author');
    writeFileSync(skillPath, tampered);
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /name|Portfolio-Author/);
  } finally {
    writeFileSync(skillPath, original);
  }
});
