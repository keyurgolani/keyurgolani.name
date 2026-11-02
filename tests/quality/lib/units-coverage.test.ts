import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { unitSaysCoveragePending } from '../../../packages/variant-contract/src/node/coverage';
import { loadRegistrations, QUALITY_DIR } from './registration';

// check:variants reads each unit's coverage flag from its text
// (unitSaysCoveragePending), so it needn't import() a unit by a computed
// path. This holds that reading to every unit's real export.

test("check:variants' text reading of each unit's coverage flag agrees with the unit's export", async () => {
  const { units } = await loadRegistrations();
  assert.ok(units.length > 0);
  for (const unit of units) {
    const source = readFileSync(path.join(QUALITY_DIR, 'units', `${unit.id}.ts`), 'utf8');
    assert.equal(
      unitSaysCoveragePending(source),
      unit.coverage === 'pending',
      `${unit.id}: the text says ${unitSaysCoveragePending(source)}, the export ${unit.coverage}`,
    );
  }
});
