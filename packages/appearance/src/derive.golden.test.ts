// Goldens for the color derivations: warm-parchment's light and dark sets
// from anchor-v1 and its light set from high-contrast-v1, byte for byte, as
// the refined body's rules give them today. A reviewer's independent
// recompute matched these. Slice 2 changes them on purpose, when it gives
// warm-parchment back the prototype's distinct muted text and accent states
// with the contrast gates still winning, and updates this file with it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { contrast } from './color';
import { anchorV1, highContrastV1 } from './derive';
import type { ColorTokens } from './tokens';
import { WARM_PARCHMENT } from './test-support/packs';
import { anchorStops, assertStops, highContrastStops } from './test-support/stops';

const LIGHT_ANCHORS = WARM_PARCHMENT.anchors!.light!;
const DARK_ANCHORS = WARM_PARCHMENT.anchors!.dark!;

const LIGHT_GOLDEN: ColorTokens = {
  canvas: '#f6eddc',
  'surface-subtle': '#f0e7d6',
  'surface-default': '#eae1d0',
  'surface-prominent': '#e2d9c9',
  'surface-overlay': '#f2e9d8',
  'text-primary': '#2b241c',
  'text-secondary': '#645c52',
  'text-muted': '#645c52',
  'text-inverse': '#f6eddc',
  'border-subtle': '#ded5c5',
  'border-default': '#c5bdae',
  'border-strong': '#7e766a',
  accent: '#b95f32',
  'accent-hover': '#b5643b',
  'accent-active': '#ad643f',
  'accent-text': '#8e4d2b',
  'on-accent': '#000000',
  focus: '#b95f32',
  selection: '#e1bda2',
  positive: '#268551',
  warning: '#9b5700',
  danger: '#b53143',
  information: '#5f7653',
  'on-status': '#ffffff',
  'data-categorical-1': '#b95f32',
  'data-categorical-2': '#5f7653',
  'data-categorical-3': '#268551',
  'data-categorical-4': '#9b5700',
  'data-categorical-5': '#b53143',
  'data-categorical-6': '#645c52',
  'data-sequential-start': '#e5c5ac',
  'data-sequential-middle': '#d39b79',
  'data-sequential-end': '#c07046',
  'signature-start': '#b95f32',
  'signature-end': '#5f7653',
  emphasis: '#b95f32',
  scrim: '#000000',
  'on-scrim': '#ffffff',
  shadow: '#000000',
};

const DARK_GOLDEN: ColorTokens = {
  canvas: '#251f19',
  'surface-subtle': '#312b24',
  'surface-default': '#3a332c',
  'surface-prominent': '#463f37',
  'surface-overlay': '#3e372f',
  'text-primary': '#f4e8d2',
  'text-secondary': '#bab09e',
  'text-muted': '#b6ac9b',
  'text-inverse': '#251f19',
  'border-subtle': '#4a433a',
  'border-default': '#635b51',
  'border-strong': '#958c7e',
  accent: '#f09d70',
  'accent-hover': '#f0a67c',
  'accent-active': '#f1ae86',
  'accent-text': '#f09d70',
  'on-accent': '#000000',
  focus: '#f09d70',
  selection: '#6a4a37',
  positive: '#78d39b',
  warning: '#ffc264',
  danger: '#ff8e9c',
  information: '#9db38d',
  'on-status': '#000000',
  'data-categorical-1': '#f09d70',
  'data-categorical-2': '#9db38d',
  'data-categorical-3': '#78d39b',
  'data-categorical-4': '#ffc264',
  'data-categorical-5': '#ff8e9c',
  'data-categorical-6': '#bab09e',
  'data-sequential-start': '#5e4231',
  'data-sequential-middle': '#9b684b',
  'data-sequential-end': '#d88e66',
  'signature-start': '#f09d70',
  'signature-end': '#9db38d',
  emphasis: '#f09d70',
  scrim: '#000000',
  'on-scrim': '#ffffff',
  shadow: '#000000',
};

const HIGH_CONTRAST_LIGHT_GOLDEN: ColorTokens = {
  canvas: '#ffffff',
  'surface-subtle': '#f5f5f5',
  'surface-default': '#ebebeb',
  'surface-prominent': '#e0e0e0',
  'surface-overlay': '#ffffff',
  'text-primary': '#000000',
  'text-secondary': '#000000',
  'text-muted': '#000000',
  'text-inverse': '#ffffff',
  'border-subtle': '#000000',
  'border-default': '#000000',
  'border-strong': '#000000',
  accent: '#66341c',
  'accent-hover': '#5a2e19',
  'accent-active': '#502916',
  'accent-text': '#66341c',
  'on-accent': '#ffffff',
  focus: '#000000',
  selection: '#cbbab2',
  positive: '#175031',
  warning: '#653900',
  danger: '#7f222f',
  information: '#394732',
  'on-status': '#ffffff',
  'data-categorical-1': '#66341c',
  'data-categorical-2': '#394732',
  'data-categorical-3': '#175031',
  'data-categorical-4': '#653900',
  'data-categorical-5': '#7f222f',
  'data-categorical-6': '#000000',
  'data-sequential-start': '#d4c6bf',
  'data-sequential-middle': '#a6897b',
  'data-sequential-end': '#784c37',
  'signature-start': '#66341c',
  'signature-end': '#394732',
  emphasis: '#66341c',
  scrim: '#000000',
  'on-scrim': '#ffffff',
  shadow: '#000000',
};

test("anchor-v1 gives warm-parchment's light and dark sets byte for byte", () => {
  assert.deepEqual(anchorV1(LIGHT_ANCHORS, 'light'), LIGHT_GOLDEN);
  assert.deepEqual(anchorV1(DARK_ANCHORS, 'dark'), DARK_GOLDEN);
});

test("high-contrast-v1 gives warm-parchment's light set byte for byte", () => {
  const sets = { light: anchorV1(LIGHT_ANCHORS, 'light'), dark: anchorV1(DARK_ANCHORS, 'dark') };
  assert.deepEqual(highContrastV1(sets, 'light'), HIGH_CONTRAST_LIGHT_GOLDEN);
});

test('every role the goldens move stopped at the first step past its limit plus 0.1', () => {
  assertStops(LIGHT_GOLDEN, anchorStops(LIGHT_ANCHORS, 'light', LIGHT_GOLDEN), 'light');
  assertStops(DARK_GOLDEN, anchorStops(DARK_ANCHORS, 'dark', DARK_GOLDEN), 'dark');
  assertStops(
    HIGH_CONTRAST_LIGHT_GOLDEN,
    highContrastStops(LIGHT_GOLDEN, 'light', HIGH_CONTRAST_LIGHT_GOLDEN),
    'high-contrast light',
  );
  // on-accent is black or white, whichever contrasts more with the accent.
  for (const [golden, accent] of [
    [LIGHT_GOLDEN, LIGHT_ANCHORS.accent],
    [DARK_GOLDEN, DARK_ANCHORS.accent],
  ] as const) {
    const black = contrast('#000000', accent) >= contrast('#ffffff', accent);
    assert.equal(golden['on-accent'], black ? '#000000' : '#ffffff');
  }
  // The roles that moved in light, so the checks above had something to hold.
  for (const role of [
    'text-muted',
    'border-strong',
    'accent-text',
    'accent-hover',
    'accent-active',
    'positive',
  ] as const) {
    assert.notEqual(
      LIGHT_GOLDEN[role],
      anchorStops(LIGHT_ANCHORS, 'light', LIGHT_GOLDEN).find((stop) => stop.role === role)!.start,
      role,
    );
  }
});
