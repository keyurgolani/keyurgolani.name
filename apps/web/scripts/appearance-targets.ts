// The targets `pnpm check:appearance` hands #19's computed gate (#11, AC5):
// read from quality/thresholds.json, so the gate's limits live in one file.
// @portfolio/appearance keeps GATE_TARGETS as the default for callers that
// can't read the file, such as a browser, and appearance-targets.test.ts
// fails when the two differ.

import type { GateTargets } from '@portfolio/appearance';
import { loadThresholds, type Thresholds } from '../../../quality/thresholds';

/** #19's gate targets, as `thresholds` gives them: quality/thresholds.json's unless a test passes its own. */
export function appearanceTargets(thresholds: Thresholds = loadThresholds()): GateTargets {
  const { contrast, focus } = thresholds;
  return {
    text: contrast.text,
    largeText: contrast.largeText,
    nonText: contrast.nonText,
    highContrastText: contrast.highContrast.text,
    highContrastLargeText: contrast.highContrast.largeText,
    highContrastNonText: contrast.highContrast.nonText,
    textureRaise: contrast.textureRaise,
    focusWidth: focus.perimeterPx,
    largeTextPt: contrast.largeTextPt,
    largeBoldTextPt: contrast.largeBoldTextPt,
    largeBoldWeight: contrast.largeBoldWeight,
  };
}
