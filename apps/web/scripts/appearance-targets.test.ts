import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GATE_TARGETS, validatePackManifest } from '@portfolio/appearance';
import { loadThresholds } from '../../../quality/thresholds';
import { appearanceTargets } from './appearance-targets';
import { REPO_ROOT } from './registry-options';

// #19's computed gate reads its limits from quality/thresholds.json (#11,
// AC5): pnpm check:appearance passes appearanceTargets() in, and
// GATE_TARGETS, the default for callers that can't read the file, is held
// to it here, with the registry's focus-ring floor built on it.

test("GATE_TARGETS, #19's browser default, holds the values quality/thresholds.json gives", () => {
  assert.deepEqual({ ...GATE_TARGETS }, appearanceTargets());
});

test('appearanceTargets maps every threshold the gate reads, and nothing else', () => {
  const thresholds = loadThresholds();
  const moved = structuredClone(thresholds);
  moved.contrast.text = 5;
  moved.contrast.largeText = 3.5;
  moved.contrast.nonText = 3.25;
  moved.contrast.highContrast = { text: 7.5, largeText: 5, nonText: 5.5 };
  moved.contrast.textureRaise = 1.2;
  moved.contrast.largeTextPt = 20;
  moved.contrast.largeBoldTextPt = 15;
  moved.contrast.largeBoldWeight = 600;
  moved.focus.perimeterPx = 3;
  assert.deepEqual(appearanceTargets(moved), {
    text: 5,
    largeText: 3.5,
    nonText: 3.25,
    highContrastText: 7.5,
    highContrastLargeText: 5,
    highContrastNonText: 5.5,
    textureRaise: 1.2,
    focusWidth: 3,
    largeTextPt: 20,
    largeBoldTextPt: 15,
    largeBoldWeight: 600,
  });
  assert.deepEqual(Object.keys(appearanceTargets()).sort(), Object.keys(GATE_TARGETS).sort());
});

test("the registry refuses a focus ring under the file's perimeter, and takes one at it", () => {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(REPO_ROOT, 'packages/appearance-languages/packs/platform-neutral/manifest.json'),
      'utf8',
    ),
  ) as { tokens: Record<string, string> };
  const perimeter = loadThresholds().focus.perimeterPx;
  const validate = (width: string) =>
    validatePackManifest(
      { ...manifest, tokens: { ...manifest.tokens, 'focus-width': width } },
      { kind: 'design-language', packageName: '@portfolio/appearance-languages' },
    );
  assert.equal(validate(`${perimeter}px`).ok, true);
  const thin = validate(`${perimeter - 0.5}px`);
  assert.equal(thin.ok, false);
  assert.match(
    JSON.stringify(thin.ok ? [] : thin.diagnostics),
    new RegExp(`from ${perimeter}px or ${perimeter / 16}rem`),
  );
});
