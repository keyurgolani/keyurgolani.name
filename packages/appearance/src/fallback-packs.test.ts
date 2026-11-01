import test from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGE_KEYS } from './tokens';
import { PLATFORM_NEUTRAL } from './test-support/packs';

// platform-neutral against the reviewed prototype's neutral recipe
// (keyurgolani.name-review/visual-review/src/data/appearance-catalog.js:
// soft, hairline, solid, normal, low, precise, none, outline-175), with its
// --appearance-<role> colors read as --color-<role>.

const SHADOW = {
  low: '0 2px 8px color-mix(in srgb, var(--color-text-primary) 12%, transparent)',
  medium: '0 10px 28px color-mix(in srgb, var(--color-text-primary) 16%, transparent)',
  inset: 'inset 2px 2px 5px color-mix(in srgb, var(--color-text-primary) 16%, transparent)',
};

const NEUTRAL_RECIPE: Readonly<Record<string, string>> = {
  'surface-material': 'linear-gradient(var(--color-surface-default), var(--color-surface-default))',
  'surface-opacity': '100%',
  'radius-control': '10px',
  'radius-card': '18px',
  'radius-overlay': '24px',
  'radius-media': '16px',
  'radius-badge': '999px',
  'shadow-card': SHADOW.low,
  'shadow-overlay': SHADOW.medium,
  'shadow-raised': SHADOW.medium,
  'shadow-inset': SHADOW.inset,
  'backdrop-blur': '0px',
  'control-height': '2.5rem',
  'space-control-inline': '0.875rem',
  'space-control-block': '0.625rem',
  'space-surface-inline': '1rem',
  'space-surface-block': '1rem',
  'focus-width': '2px',
  'focus-offset': '2px',
  'focus-style': 'solid',
  'state-hover-transform': 'translateY(-1px)',
  'state-active-transform': 'scale(0.98)',
  'state-selected-emphasis': '2px',
  'state-disabled-opacity': '0.45',
  'state-loading-opacity': '0.65',
  'state-validation-emphasis': '2px',
  'icon-stroke-width': '1.75',
  'icon-fill': 'none',
  'motion-fast': '100ms',
  'motion-standard': '160ms',
  'motion-slow': '220ms',
  'motion-easing': 'cubic-bezier(0.2, 0, 0, 1)',
  'motion-enter': 'fade-rise',
  'motion-exit': 'fade',
  'motion-emphasis': 'pulse-once',
  texture: 'none',
};

test("platform-neutral is the prototype's neutral recipe, its shadows tinted with text-primary", () => {
  for (const [key, value] of Object.entries(NEUTRAL_RECIPE)) {
    assert.equal(PLATFORM_NEUTRAL.tokens[key as keyof typeof PLATFORM_NEUTRAL.tokens], value, key);
  }
  // The recipe's borders are 1px solid hairlines. The refined body draws each in a border
  // role, with border-strong on controls for their 3:1 boundary.
  assert.deepEqual(
    [
      PLATFORM_NEUTRAL.tokens['border-control'],
      PLATFORM_NEUTRAL.tokens['border-card'],
      PLATFORM_NEUTRAL.tokens['border-divider'],
    ],
    [
      '1px solid var(--color-border-strong)',
      '1px solid var(--color-border-default)',
      '1px solid var(--color-border-subtle)',
    ],
  );
  // Token contract 1 adds two keys the prototype doesn't have.
  assert.deepEqual(
    LANGUAGE_KEYS.filter((key) => !(key in NEUTRAL_RECIPE) && !key.startsWith('border-')),
    ['signature-fill', 'emphasis-glow'],
  );
});
