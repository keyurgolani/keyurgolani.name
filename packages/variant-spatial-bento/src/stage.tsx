'use client';

import { lazy } from 'react';
import { Slot } from './stage-slot';

// The opening's stage (#16): the slot, with the stage's module, three.js in
// it, loaded through import() only once the policy says the stage runs.

const StageCanvas = lazy(() =>
  import('./stage-canvas').then((stage) => ({ default: stage.StageCanvas })),
);

export function StageSlot({
  seed,
  idPrefix,
}: {
  readonly seed: number;
  readonly idPrefix: string;
}) {
  return <Slot seed={seed} idPrefix={idPrefix} Canvas={StageCanvas} />;
}
