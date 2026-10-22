import test from 'node:test';
import assert from 'node:assert/strict';
import { DisplayModeSchema } from '@portfolio/schema';
import * as contract from '@portfolio/variant-contract';
import {
  APPEARANCE_AXES,
  COLOR_ROLES,
  DEFAULT_VISITOR_CONTROLS,
  DISPLAY_MODES,
  LANGUAGE_KEYS,
  PLATFORM_DEFAULTS,
  QUERY_KEYS,
  TOKEN_CONTRACT_VERSION,
  TOKEN_PROPERTIES,
  TYPOGRAPHY_FIELDS,
  TYPOGRAPHY_MEASURES,
  TYPOGRAPHY_ROLES,
} from './index';

test('token contract 1 has one home: the variant contract checks variants against the same constant', () => {
  assert.equal(TOKEN_CONTRACT_VERSION, 1);
  assert.equal(TOKEN_CONTRACT_VERSION, contract.TOKEN_CONTRACT_VERSION);
});

test('the color contract is the refined body list, 39 roles', () => {
  assert.deepEqual(
    [...COLOR_ROLES],
    [
      'canvas',
      ...['subtle', 'default', 'prominent', 'overlay'].map((part) => `surface-${part}`),
      ...['primary', 'secondary', 'muted', 'inverse'].map((part) => `text-${part}`),
      ...['subtle', 'default', 'strong'].map((part) => `border-${part}`),
      'accent',
      ...['hover', 'active', 'text'].map((part) => `accent-${part}`),
      'on-accent',
      'focus',
      'selection',
      'positive',
      'warning',
      'danger',
      'information',
      'on-status',
      ...[1, 2, 3, 4, 5, 6].map((index) => `data-categorical-${index}`),
      ...['start', 'middle', 'end'].map((part) => `data-sequential-${part}`),
      'signature-start',
      'signature-end',
      'emphasis',
      'scrim',
      'on-scrim',
      'shadow',
    ],
  );
});

test('the design-language contract is the refined body list, 41 keys', () => {
  const expected = [
    'surface-material',
    'surface-opacity',
    ...['control', 'card', 'overlay', 'media', 'badge'].map((part) => `radius-${part}`),
    ...['control', 'card', 'divider'].map((part) => `border-${part}`),
    ...['card', 'overlay', 'raised', 'inset'].map((part) => `shadow-${part}`),
    'backdrop-blur',
    'control-height',
    ...['control', 'surface'].flatMap((part) => [`space-${part}-inline`, `space-${part}-block`]),
    ...['width', 'offset', 'style'].map((part) => `focus-${part}`),
    ...[
      'hover-transform',
      'active-transform',
      'selected-emphasis',
      'disabled-opacity',
      'loading-opacity',
      'validation-emphasis',
    ].map((part) => `state-${part}`),
    'icon-stroke-width',
    'icon-fill',
    ...['fast', 'standard', 'slow', 'easing', 'enter', 'exit', 'emphasis'].map(
      (part) => `motion-${part}`,
    ),
    'texture',
    'signature-fill',
    'emphasis-glow',
  ];
  assert.deepEqual([...LANGUAGE_KEYS].sort(), expected.sort());
  assert.equal(LANGUAGE_KEYS.length, 41);
});

test('typography is ten roles of six fields, plus two measures', () => {
  assert.deepEqual(
    [...TYPOGRAPHY_ROLES],
    [
      'display',
      'headline',
      'title',
      'body',
      'body-compact',
      'label',
      'caption',
      'quote',
      'code',
      'numeric',
    ],
  );
  assert.deepEqual(
    [...TYPOGRAPHY_FIELDS],
    [
      'font-family',
      'font-size',
      'font-weight',
      'line-height',
      'letter-spacing',
      'font-variation-settings',
    ],
  );
  assert.deepEqual([...TYPOGRAPHY_MEASURES], ['body', 'compact']);
});

test('every custom property is unique and carries its axis prefix', () => {
  assert.equal(TOKEN_PROPERTIES.length, 39 + 41 + 60 + 2);
  assert.equal(new Set(TOKEN_PROPERTIES).size, TOKEN_PROPERTIES.length);
  for (const property of TOKEN_PROPERTIES)
    assert.match(property, /^--(?:color|ui|type)-[a-z0-9-]+$/);
  assert.ok(TOKEN_PROPERTIES.includes('--color-on-scrim'));
  assert.ok(TOKEN_PROPERTIES.includes('--ui-emphasis-glow'));
  assert.ok(TOKEN_PROPERTIES.includes('--type-body-compact-font-variation-settings'));
  assert.ok(TOKEN_PROPERTIES.includes('--type-measure-compact'));
});

test('the platform defaults, visitor controls, and query keys are the approved ones', () => {
  assert.deepEqual(PLATFORM_DEFAULTS, {
    variant: 'editorial-evidence',
    designLanguage: 'platform-neutral',
    colorScheme: 'warm-parchment',
    typography: 'humanist-ui',
    displayMode: 'system',
  });
  assert.deepEqual(DEFAULT_VISITOR_CONTROLS, {
    variant: 'locked',
    designLanguage: 'locked',
    colorScheme: 'selectable',
    typography: 'locked',
    displayMode: 'selectable',
  });
  assert.deepEqual(QUERY_KEYS, {
    variant: 'variant',
    designLanguage: 'language',
    colorScheme: 'scheme',
    typography: 'type',
    displayMode: 'mode',
  });
  assert.deepEqual(
    [...APPEARANCE_AXES],
    ['variant', 'designLanguage', 'colorScheme', 'typography', 'displayMode'],
  );
  assert.deepEqual([...DISPLAY_MODES], DisplayModeSchema.options);
});
