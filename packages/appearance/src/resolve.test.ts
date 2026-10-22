import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppearanceAxis, AppearanceSelection, VisitorControls } from '@portfolio/schema';
import {
  anchorV1,
  APPEARANCE_AXES,
  DEFAULT_VISITOR_CONTROLS,
  PLATFORM_DEFAULTS,
  resolveAppearance,
  serializeSelection,
  type ResolveInput,
} from './index';
import { DARK_ONLY, pick, seeded, testRegistry, WARM_PARCHMENT } from './test-support/packs';

const registry = testRegistry();
const PUBLISHED: AppearanceSelection = { ...PLATFORM_DEFAULTS, variant: 'acme-gallery' };
const ALL_SELECTABLE: VisitorControls = {
  variant: 'selectable',
  designLanguage: 'selectable',
  colorScheme: 'selectable',
  typography: 'selectable',
  displayMode: 'selectable',
};

function resolve(extra: Partial<ResolveInput> = {}) {
  return resolveAppearance({
    published: PUBLISHED,
    visitorControls: DEFAULT_VISITOR_CONTROLS,
    motionPolicy: 'respect-os',
    profile: 'owner',
    registry,
    ...extra,
  });
}

test('a registered selection renders as published', () => {
  const resolved = resolve();
  assert.deepEqual(resolved.selection, PUBLISHED);
  assert.deepEqual(resolved.requested, PUBLISHED);
  assert.equal(resolved.resolvedMode, 'system');
  assert.equal(resolved.modeLocked, false);
  assert.equal(resolved.contrast, 'system');
  assert.equal(resolved.motion, 'full');
  assert.equal(resolved.enhancement, 'on');
  assert.deepEqual(resolved.fallbackAxes, []);
  assert.deepEqual(resolved.visitorAxes, []);
  assert.deepEqual(resolved.diagnostics, []);
});

test('an unregistered pack falls back on its axis alone, and a missing variant to the fallback composition', () => {
  const published = {
    variant: 'missing-variant',
    designLanguage: 'fixture-translucent',
    colorScheme: 'missing-pack',
    typography: 'multilingual-system',
    displayMode: 'dark',
  } as const;
  const resolved = resolve({ published });
  assert.deepEqual(resolved.selection, {
    variant: 'fallback',
    designLanguage: 'fixture-translucent',
    colorScheme: 'warm-parchment',
    typography: 'multilingual-system',
    displayMode: 'dark',
  });
  assert.deepEqual(resolved.requested, published);
  assert.deepEqual(resolved.fallbackAxes, ['variant', 'colorScheme']);
  assert.deepEqual(
    resolved.diagnostics.map(({ code, axis }) => [code, axis]),
    [
      ['variant.unavailable', 'variant'],
      ['appearance.unavailable', 'colorScheme'],
    ],
  );
  assert.match(resolved.diagnostics[1]!.message, /first-party warm-parchment renders in its place/);
  // It never claims the requested pack is active, and never repeats an id the build doesn't register.
  for (const { message } of resolved.diagnostics) assert.ok(!message.includes('missing-'), message);
  // editorial-evidence registers with #13; until then it renders the fallback composition.
  const editorial = resolve({
    published: PLATFORM_DEFAULTS,
    registry: testRegistry(undefined, [registry.variants[0]!]),
  });
  assert.equal(editorial.selection.variant, 'fallback');
  assert.deepEqual(editorial.fallbackAxes, ['variant']);
});

test('system on a single-mode scheme renders its native mode, locked', () => {
  const resolved = resolve({ published: { ...PUBLISHED, colorScheme: 'fixture-dark-only' } });
  assert.equal(resolved.resolvedMode, 'dark');
  assert.equal(resolved.modeLocked, true);
  assert.equal(resolved.selection.displayMode, 'system');
  assert.deepEqual(resolved.diagnostics, []);
  const light = resolve({ published: { ...PUBLISHED, colorScheme: 'fixture-light-only' } });
  assert.equal(light.resolvedMode, 'light');
});

test('an explicit mode the scheme lacks renders the native mode with a diagnostic; high contrast never conflicts', () => {
  const resolved = resolve({
    published: { ...PUBLISHED, colorScheme: 'fixture-dark-only', displayMode: 'light' },
  });
  assert.equal(resolved.resolvedMode, 'dark');
  assert.equal(resolved.modeLocked, true);
  assert.equal(resolved.selection.colorScheme, 'fixture-dark-only');
  assert.equal(resolved.selection.displayMode, 'light');
  assert.deepEqual(
    resolved.diagnostics.map(({ code, axis }) => [code, axis]),
    [['appearance.mode-incompatible', 'displayMode']],
  );
  const contrast = resolve({
    published: { ...PUBLISHED, colorScheme: 'fixture-dark-only', displayMode: 'high-contrast' },
  });
  assert.equal(contrast.resolvedMode, 'high-contrast');
  assert.equal(contrast.modeLocked, false);
  assert.deepEqual(contrast.diagnostics, []);
  const matching = resolve({
    published: { ...PUBLISHED, colorScheme: 'fixture-dark-only', displayMode: 'dark' },
  });
  assert.deepEqual([matching.resolvedMode, matching.modeLocked], ['dark', false]);
});

test('a published Research pack renders, with the owner told it can not be published', () => {
  const resolved = resolve({ published: { ...PUBLISHED, colorScheme: 'fixture-research' } });
  assert.equal(resolved.selection.colorScheme, 'fixture-research');
  assert.deepEqual(
    resolved.diagnostics.map(({ code }) => code),
    ['appearance.not-publishable'],
  );
});

test('a generator scheme renders only with its generated sets', () => {
  const published = { ...PUBLISHED, colorScheme: 'fixture-seed' };
  const missing = resolve({ published });
  assert.equal(missing.selection.colorScheme, 'warm-parchment');
  assert.deepEqual(missing.fallbackAxes, ['colorScheme']);
  assert.deepEqual(
    missing.diagnostics.map(({ code }) => code),
    ['appearance.input-missing'],
  );
  const light = anchorV1(WARM_PARCHMENT.anchors!.light!, 'light');
  const dark = anchorV1(DARK_ONLY.anchors!.dark!, 'dark');
  const generated = resolve({ published, generated: { 'fixture-seed': { light, dark } } });
  assert.equal(generated.selection.colorScheme, 'fixture-seed');
  assert.deepEqual(generated.diagnostics, []);
  assert.equal(generated.resolvedMode, 'system');
  const broken = resolve({
    published,
    generated: { 'fixture-seed': { light, dark: { ...dark, canvas: 'red' } } },
  });
  assert.equal(broken.selection.colorScheme, 'warm-parchment');
});

test('owner and read-only read the cookie on selectable axes only, and never the query', () => {
  const cookie = serializeSelection({
    variant: 'editorial-evidence',
    designLanguage: 'fixture-translucent',
    colorScheme: 'fixture-light-only',
    typography: 'multilingual-system',
    displayMode: 'light',
  });
  for (const profile of ['owner', 'read-only'] as const) {
    const resolved = resolve({
      profile,
      visitor: { cookie, query: 'scheme=fixture-dark-only&mode=dark' },
    });
    // The defaults leave the color scheme and the display mode selectable.
    assert.deepEqual(resolved.selection, {
      ...PUBLISHED,
      colorScheme: 'fixture-light-only',
      displayMode: 'light',
    });
    assert.deepEqual(resolved.visitorAxes, ['colorScheme', 'displayMode']);
    const queryOnly = resolve({ profile, visitor: { query: 'scheme=fixture-dark-only' } });
    assert.deepEqual(queryOnly.selection, PUBLISHED);
  }
});

test('demo makes every axis selectable and reads the query, never the cookie', () => {
  const query =
    'variant=editorial-evidence&language=fixture-translucent&scheme=fixture-dark-only&type=multilingual-system&mode=dark';
  const resolved = resolve({
    profile: 'demo',
    visitor: { query, cookie: 'scheme=fixture-light-only' },
  });
  assert.deepEqual(resolved.selection, {
    variant: 'editorial-evidence',
    designLanguage: 'fixture-translucent',
    colorScheme: 'fixture-dark-only',
    typography: 'multilingual-system',
    displayMode: 'dark',
  });
  assert.deepEqual(resolved.visitorAxes, [...APPEARANCE_AXES]);
  const cookieOnly = resolve({ profile: 'demo', visitor: { cookie: 'scheme=fixture-light-only' } });
  assert.deepEqual(cookieOnly.selection, PUBLISHED);
  // Next's search params work as the query too.
  const record = resolve({ profile: 'demo', visitor: { query: { scheme: 'fixture-light-only' } } });
  assert.equal(record.selection.colorScheme, 'fixture-light-only');
});

test('visitor values that are unregistered, Research, the fallback, or unrenderable do nothing', () => {
  const query =
    'variant=fallback&language=missing-pack&scheme=fixture-research&type=Bad&mode=sepia';
  assert.deepEqual(resolve({ profile: 'demo', visitor: { query } }).selection, PUBLISHED);
  assert.deepEqual(
    resolve({ profile: 'demo', visitor: { query: 'scheme=fixture-seed' } }).selection,
    PUBLISHED,
  );
  assert.deepEqual(
    resolve({ profile: 'demo', visitor: { query: 'variant=humanist-ui' } }).selection,
    PUBLISHED,
  );
  const generated = {
    'fixture-seed': {
      light: anchorV1(WARM_PARCHMENT.anchors!.light!, 'light'),
      dark: anchorV1(WARM_PARCHMENT.anchors!.dark!, 'dark'),
    },
  };
  assert.equal(
    resolve({ profile: 'demo', visitor: { query: 'scheme=fixture-seed' }, generated }).selection
      .colorScheme,
    'fixture-seed',
  );
});

test('visitor values apply in axis order, and one that does not fit what is applied drops', () => {
  const lightPublished = { ...PUBLISHED, displayMode: 'light' as const };
  // The scheme comes before the mode, so a dark-only scheme meets the published light mode and drops.
  const dropped = resolve({
    profile: 'demo',
    published: lightPublished,
    visitor: { query: 'scheme=fixture-dark-only&mode=dark' },
  });
  assert.deepEqual(dropped.selection, { ...lightPublished, displayMode: 'dark' });
  assert.deepEqual(dropped.visitorAxes, ['displayMode']);
  // Under system, the dark-only scheme fits, and then the dark mode fits it.
  const applied = resolve({
    profile: 'demo',
    visitor: { query: 'scheme=fixture-dark-only&mode=dark' },
  });
  assert.deepEqual(applied.selection, {
    ...PUBLISHED,
    colorScheme: 'fixture-dark-only',
    displayMode: 'dark',
  });
  // A mode the applied scheme lacks drops, and the scheme stays.
  const mode = resolve({
    profile: 'demo',
    visitor: { query: 'scheme=fixture-dark-only&mode=light' },
  });
  assert.deepEqual(mode.selection, { ...PUBLISHED, colorScheme: 'fixture-dark-only' });
  assert.equal(mode.resolvedMode, 'dark');
  assert.equal(mode.modeLocked, true);
  assert.deepEqual(mode.diagnostics, []);
});

test('a visitor value on an axis whose published pack fell back still applies', () => {
  const published = { ...PUBLISHED, colorScheme: 'missing-pack' };
  const resolved = resolve({ published, visitor: { cookie: 'scheme=fixture-light-only' } });
  assert.equal(resolved.selection.colorScheme, 'fixture-light-only');
  assert.equal(resolved.requested.colorScheme, 'fixture-light-only');
  assert.deepEqual(resolved.fallbackAxes, []);
  assert.deepEqual(
    resolved.diagnostics.map(({ code }) => code),
    ['appearance.unavailable'],
  );
});

test('motion follows the policy, and the environment only lowers it', () => {
  assert.equal(resolve({ motionPolicy: 'reduce' }).motion, 'reduced');
  assert.equal(resolve({ environment: { motion: 'reduced' } }).motion, 'reduced');
  assert.equal(resolve({ environment: { motion: 'static' } }).motion, 'static');
  assert.equal(
    resolve({ motionPolicy: 'reduce', environment: { motion: 'full' } }).motion,
    'reduced',
  );
  assert.equal(
    resolve({ motionPolicy: 'reduce', environment: { motion: 'static' } }).motion,
    'static',
  );
  const environment = resolve({ environment: { contrast: 'more', enhancement: 'off' } });
  assert.deepEqual([environment.contrast, environment.enhancement], ['more', 'off']);
});

test('property: a visitor value changes its own axis or nothing, through the cookie and the demo query', () => {
  const random = seeded(19_003);
  const values: Readonly<Record<AppearanceAxis, readonly string[]>> = {
    variant: ['editorial-evidence', 'acme-gallery', 'fallback', 'missing-variant'],
    designLanguage: ['platform-neutral', 'fixture-translucent', 'missing-pack'],
    colorScheme: [
      'warm-parchment',
      'fixture-dark-only',
      'fixture-light-only',
      'fixture-seed',
      'fixture-research',
    ],
    typography: ['humanist-ui', 'multilingual-system', 'missing-pack'],
    displayMode: ['system', 'light', 'dark', 'high-contrast', 'sepia'],
  };
  for (let index = 0; index < 3000; index += 1) {
    const published = {
      variant: pick(random, ['editorial-evidence', 'acme-gallery']),
      designLanguage: pick(random, ['platform-neutral', 'fixture-translucent']),
      colorScheme: pick(random, ['warm-parchment', 'fixture-dark-only', 'fixture-light-only']),
      typography: pick(random, ['humanist-ui', 'multilingual-system']),
      displayMode: pick(random, ['system', 'high-contrast'] as const),
    };
    const axis = pick(random, APPEARANCE_AXES);
    const text = `${{ variant: 'variant', designLanguage: 'language', colorScheme: 'scheme', typography: 'type', displayMode: 'mode' }[axis]}=${pick(random, values[axis])}`;
    const profile = pick(random, ['owner', 'read-only', 'demo'] as const);
    const resolved = resolve({
      profile,
      published,
      visitorControls: ALL_SELECTABLE,
      visitor: profile === 'demo' ? { query: text } : { cookie: text },
    });
    for (const other of APPEARANCE_AXES.filter((each) => each !== axis)) {
      assert.equal(
        resolved.requested[other],
        published[other],
        `${profile} ${text} moved ${other}`,
      );
    }
  }
});
