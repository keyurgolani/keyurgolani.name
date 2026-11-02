import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../../quality/thresholds';
import {
  DISPLAY_MODES,
  INPUT_MODES,
  parseTuple,
  PREFERENCE_MODES,
  TUPLE,
  tupleKey,
} from './lib/vocabulary';

// The quality vocabulary is the failure-record schema's (#11, Slice 1, item
// 10), so a record and the exception that covers it name a cell alike.

const SCHEMA = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'ci', 'failure-record.schema.json'), 'utf8'),
) as {
  properties: Record<string, { enum?: string[]; pattern?: string }>;
  allOf: { if: unknown; then: { properties: Record<string, { enum?: string[] }> } }[];
};

test("the input modes, preference rows, and tuple are the schema's 1.1 ones", () => {
  const v11 = SCHEMA.allOf.find(
    (branch) =>
      JSON.stringify(branch.if) ===
      JSON.stringify({ properties: { schemaVersion: { const: '1.1' } } }),
  );
  assert.deepEqual(v11?.then.properties.inputMode?.enum, [...INPUT_MODES]);
  assert.deepEqual(SCHEMA.properties.preferenceMode?.enum, [...PREFERENCE_MODES]);
  assert.deepEqual([...DISPLAY_MODES], ['system', 'light', 'dark', 'high-contrast']);
  // The schema's tuple pattern and TUPLE take and refuse the same strings.
  const schemaTuple = new RegExp(SCHEMA.properties.tuple!.pattern!);
  for (const sample of [
    'platform-neutral/warm-parchment/humanist-ui/light',
    'fixture-language-stable/fixture-scheme-experimental-low-contrast/humanist-ui/high-contrast',
    'platform-neutral/warm-parchment/humanist-ui/system',
    'platform-neutral/warm-parchment/humanist-ui',
    'platform-neutral/warm-parchment/humanist-ui/sepia',
    'a/warm-parchment/humanist-ui/dark',
    '*/warm-parchment/humanist-ui/dark',
    'fallback/platform-neutral/warm-parchment/humanist-ui/light',
  ]) {
    assert.equal(schemaTuple.test(sample), TUPLE.test(sample), sample);
  }
});

test("tupleKey and parseTuple round-trip, and refuse what isn't a tuple", () => {
  const tuple = {
    designLanguage: 'fixture-language-extended',
    colorScheme: 'fixture-scheme-stable',
    typography: 'fixture-typography-experimental',
    displayMode: 'high-contrast' as const,
  };
  const key = tupleKey(tuple);
  assert.equal(
    key,
    'fixture-language-extended/fixture-scheme-stable/fixture-typography-experimental/high-contrast',
  );
  assert.deepEqual(parseTuple(key), tuple);
  for (const bad of [
    'a/b/c/light',
    'platform-neutral/warm-parchment/humanist-ui',
    'platform-neutral/warm-parchment/humanist-ui/light/extra',
    '*/warm-parchment/humanist-ui/light',
    'Platform-Neutral/warm-parchment/humanist-ui/light',
  ]) {
    assert.equal(parseTuple(bad), null, bad);
  }
  assert.throws(
    () => tupleKey({ ...tuple, colorScheme: 'warm parchment' }),
    /isn't an appearance tuple/,
  );
});
