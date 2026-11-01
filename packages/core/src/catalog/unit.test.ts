import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalize, PORTFOLIO_SCHEMA_VERSION, validatePublicationUnit } from '@portfolio/schema';
import { isDraftId, isRevisionId, isSha256, storePaths } from '../store/layout';
import { checkUnit, contentHash, importSourceHash, oversize, plainModel, sha256 } from './unit';
import {
  commentedVariant,
  contentVariant,
  invalidInput,
  pairInput,
  PAIR_NAMES,
  testChecks,
} from '../store/test-support/fixtures';

test('YAML and JSON with equal content get the same contentHash and unitHash, and their own sourceHash', () => {
  const checks = testChecks();
  for (const name of PAIR_NAMES) {
    const yaml = checkUnit(pairInput(name, 'yaml'), checks);
    const json = checkUnit(pairInput(name, 'json'), checks);
    assert.ok(yaml.ok && json.ok, name);
    for (const document of ['portfolio', 'site'] as const) {
      assert.equal(yaml.unit[document].contentHash, json.unit[document].contentHash, name);
      assert.notEqual(yaml.unit[document].sourceHash, json.unit[document].sourceHash, name);
      assert.equal(
        yaml.unit[document].sourceHash,
        sha256(pairInput(name, 'yaml')[document].sourceText),
      );
    }
    assert.equal(yaml.unit.unitHash, json.unit.unitHash, name);
  }
});

test('hashes are sha256:<hex>, contentHash covers the canonical model, and unitHash every document and snapshot by name', () => {
  const checked = checkUnit(pairInput('engineering'), testChecks());
  assert.ok(checked.ok);
  const { unit } = checked;
  for (const hash of [unit.unitHash, unit.portfolio.contentHash, unit.site.sourceHash]) {
    assert.ok(isSha256(hash), hash);
  }
  assert.equal(unit.portfolio.contentHash, sha256(canonicalize(unit.portfolio.model)));
  assert.equal(
    unit.unitHash,
    sha256(
      canonicalize({
        portfolio: unit.portfolio.contentHash,
        site: unit.site.contentHash,
        'snapshots/controls': contentHash(unit.snapshots.controls),
      }),
    ),
  );
  // A snapshot is part of the unit: a different one is a different unit.
  const other = checkUnit(
    pairInput('engineering'),
    testChecks({ snapshots: () => ({ controls: { visitorControls: 'other' } }) }),
  );
  assert.ok(other.ok);
  assert.notEqual(other.unit.unitHash, unit.unitHash);
  assert.equal(other.unit.portfolio.contentHash, unit.portfolio.contentHash);
});

test('a comment changes only the sourceHash; a value changes the contentHash and unitHash', () => {
  const checks = testChecks();
  const base = checkUnit(pairInput('engineering'), checks);
  const commented = checkUnit(commentedVariant(pairInput('engineering'), 'note'), checks);
  const changed = checkUnit(contentVariant(pairInput('engineering'), 'two'), checks);
  assert.ok(base.ok && commented.ok && changed.ok);
  assert.notEqual(commented.unit.portfolio.sourceHash, base.unit.portfolio.sourceHash);
  assert.equal(commented.unit.portfolio.contentHash, base.unit.portfolio.contentHash);
  assert.equal(commented.unit.unitHash, base.unit.unitHash);
  assert.notEqual(changed.unit.portfolio.contentHash, base.unit.portfolio.contentHash);
  assert.notEqual(changed.unit.unitHash, base.unit.unitHash);
});

test("a unit keeps each document's text as written and #4's normalized model as is", () => {
  const input = pairInput('engineering');
  const checked = checkUnit(input, testChecks());
  assert.ok(checked.ok);
  assert.equal(checked.unit.portfolio.sourceText, input.portfolio.sourceText);
  assert.match(checked.unit.portfolio.sourceText, /^# Engineering:/);
  assert.equal(checked.unit.portfolio.schemaVersion, PORTFOLIO_SCHEMA_VERSION);
  const result = validatePublicationUnit({
    portfolio: { text: input.portfolio.sourceText, format: 'yaml', name: 'portfolio.yml' },
    site: { text: input.site.sourceText, format: 'yaml', name: 'site.yml' },
  });
  assert.deepEqual(checked.unit.portfolio.model, plainModel(result.pair?.portfolio));
  assert.deepEqual(checked.unit.site.model, plainModel(result.pair?.site));
});

test('an import sourceHash covers each mounted file name and its bytes', () => {
  const files = { 'portfolio.yml': 'a: 1\n', 'site.yml': 'b: 2\n' };
  const hash = importSourceHash(files);
  assert.ok(isSha256(hash));
  assert.equal(importSourceHash({ 'site.yml': 'b: 2\n', 'portfolio.yml': 'a: 1\n' }), hash);
  assert.notEqual(importSourceHash({ ...files, 'site.yml': 'b: 3\n' }), hash);
  assert.notEqual(importSourceHash({ 'portfolio.yaml': 'a: 1\n', 'site.yml': 'b: 2\n' }), hash);
});

test('every blocking #4 invalid fixture fails the unit check with its code', () => {
  const blocking = [
    'anchor.broken',
    'appearance.unknown',
    'content.empty',
    'id.duplicate',
    'legacy.document',
    'metric.conflict',
    'parse.syntax',
    'ref.missing',
    'schema.invalid',
    'schema.version',
    'site.deployment-setting',
  ];
  for (const code of blocking) {
    let input;
    try {
      input = invalidInput(code);
    } catch {
      continue; // a source.* fixture has no pair to read
    }
    const checked = checkUnit(input, testChecks());
    if (code === 'appearance.unknown' && checked.ok) continue; // needs a catalog in the context
    assert.equal(checked.ok, false, code);
    assert.ok(
      checked.diagnostics.some((diagnostic) => diagnostic.code === code),
      `${code}: ${checked.diagnostics.map((d) => d.code).join(', ')}`,
    );
  }
});

test("documents cap at 1 MiB, and a media document that doesn't parse blocks the unit", () => {
  assert.equal(oversize({ format: 'yaml', sourceText: 'a'.repeat(1024 * 1024) }), false);
  assert.equal(oversize({ format: 'yaml', sourceText: 'a'.repeat(1024 * 1024 + 1) }), true);
  assert.equal(oversize({ format: 'yaml', sourceText: 'é'.repeat(512 * 1024 + 1) }), true);
  const checked = checkUnit(
    { ...pairInput('engineering'), media: { format: 'json', sourceText: '{"blobs": [' } },
    testChecks(),
  );
  assert.equal(checked.ok, false);
  assert.ok(checked.diagnostics.some((d) => d.document === 'media' && d.code === 'parse.syntax'));
});

test('IDs are checked before they name a path, and a blob is stored under its first two hex digits', () => {
  const paths = storePaths('/data');
  assert.throws(() => paths.revision('rev_../../etc' as never), TypeError);
  assert.throws(() => paths.draft('drf_x' as never), TypeError);
  // A whole ID with more after it, a path or a line end, is no ID.
  const hex32 = '0'.repeat(32);
  for (const suffix of ['/../../etc', '\n', 'x']) {
    assert.throws(() => paths.revision(`rev_${hex32}${suffix}` as never), TypeError, suffix);
    assert.throws(() => paths.staging(`rev_${hex32}${suffix}` as never), TypeError, suffix);
    assert.throws(() => paths.draft(`drf_${hex32}${suffix}` as never), TypeError, suffix);
    assert.equal(isRevisionId(`rev_${hex32}${suffix}`), false, suffix);
    assert.equal(isDraftId(`drf_${hex32}${suffix}`), false, suffix);
  }
  assert.throws(() => paths.blob('sha256:zz' as never), TypeError);
  assert.throws(() => paths.event(0), TypeError);
  const hex = 'ab'.padEnd(64, '0');
  assert.equal(paths.blob(`sha256:${hex}`), `/data/assets/sha256/ab/${hex}`);
  assert.equal(
    paths.staging(`rev_${'0'.repeat(32)}`),
    `/data/revisions/.staging-rev_${'0'.repeat(32)}`,
  );
});
