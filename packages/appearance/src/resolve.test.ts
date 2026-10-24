import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppearanceAxis, AppearanceSelection, VisitorControls } from '@portfolio/schema';
import {
  anchorV1,
  APPEARANCE_AXES,
  DEFAULT_VISITOR_CONTROLS,
  modeFits,
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
  // A registry without editorial-evidence, as a build that doesn't register the platform default, renders the fallback composition.
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

type Mode = 'system' | 'light' | 'dark' | 'high-contrast';

/** The scheme and mode that render for a published pair and a cookie, and what set them. */
function pair(
  published: { colorScheme: string; displayMode: Mode },
  cookie: string,
  visitorControls: VisitorControls = DEFAULT_VISITOR_CONTROLS,
) {
  const resolved = resolve({
    published: { ...PUBLISHED, ...published },
    visitorControls,
    visitor: { cookie },
  });
  return {
    scheme: resolved.selection.colorScheme,
    mode: resolved.selection.displayMode,
    visitor: resolved.visitorAxes,
    resolvedMode: resolved.resolvedMode,
    modeLocked: resolved.modeLocked,
    codes: resolved.diagnostics.map(({ code }) => code),
  };
}

const WARM_LIGHT = { colorScheme: 'warm-parchment', displayMode: 'light' } as const;
const DARK_SYSTEM = { colorScheme: 'fixture-dark-only', displayMode: 'system' } as const;

test('a visitor scheme and mode that fit each other apply together, whatever the published pair', () => {
  const both = {
    scheme: 'fixture-dark-only',
    mode: 'dark',
    visitor: ['colorScheme', 'displayMode'],
    resolvedMode: 'dark',
    modeLocked: false,
    codes: [],
  };
  // Each half alone would meet the other published half and not fit; the pair still applies.
  assert.deepEqual(pair(WARM_LIGHT, 'scheme=fixture-dark-only&mode=dark'), both);
  assert.deepEqual(
    pair(
      { colorScheme: 'fixture-light-only', displayMode: 'light' },
      'scheme=fixture-dark-only&mode=dark',
    ),
    both,
  );
  // High contrast fits every scheme.
  assert.deepEqual(pair(WARM_LIGHT, 'scheme=fixture-dark-only&mode=high-contrast'), {
    ...both,
    mode: 'high-contrast',
    resolvedMode: 'high-contrast',
  });
});

test('a visitor scheme that fits the published mode applies, and a mode it lacks drops', () => {
  assert.deepEqual(
    pair(
      { colorScheme: 'warm-parchment', displayMode: 'system' },
      'scheme=fixture-dark-only&mode=light',
    ),
    {
      scheme: 'fixture-dark-only',
      mode: 'system',
      visitor: ['colorScheme'],
      resolvedMode: 'dark',
      modeLocked: true,
      codes: [],
    },
  );
  assert.deepEqual(
    pair({ colorScheme: 'warm-parchment', displayMode: 'dark' }, 'scheme=fixture-dark-only'),
    {
      scheme: 'fixture-dark-only',
      mode: 'dark',
      visitor: ['colorScheme'],
      resolvedMode: 'dark',
      modeLocked: false,
      codes: [],
    },
  );
});

test('a visitor scheme that fits neither drops, and the mode applies when it fits the published scheme', () => {
  const kept = {
    scheme: 'warm-parchment',
    mode: 'light',
    resolvedMode: 'light',
    modeLocked: false,
    codes: [],
  };
  assert.deepEqual(pair(WARM_LIGHT, 'scheme=fixture-dark-only&mode=light'), {
    ...kept,
    visitor: ['displayMode'],
  });
  assert.deepEqual(pair(WARM_LIGHT, 'scheme=fixture-dark-only'), { ...kept, visitor: [] });
});

test('with no visitor scheme, a mode applies only when it fits the published scheme', () => {
  assert.deepEqual(pair(DARK_SYSTEM, 'mode=light'), {
    scheme: 'fixture-dark-only',
    mode: 'system',
    visitor: [],
    resolvedMode: 'dark',
    modeLocked: true,
    codes: [],
  });
  assert.deepEqual(pair(DARK_SYSTEM, 'mode=dark'), {
    scheme: 'fixture-dark-only',
    mode: 'dark',
    visitor: ['displayMode'],
    resolvedMode: 'dark',
    modeLocked: false,
    codes: [],
  });
  assert.equal(pair(DARK_SYSTEM, 'mode=high-contrast').mode, 'high-contrast');
  // A locked scheme axis, a Research scheme, and an unregistered one count as no scheme.
  assert.deepEqual(
    pair(WARM_LIGHT, 'scheme=fixture-dark-only&mode=dark', {
      ...DEFAULT_VISITOR_CONTROLS,
      colorScheme: 'locked',
    }),
    { ...pair(WARM_LIGHT, ''), mode: 'dark', resolvedMode: 'dark', visitor: ['displayMode'] },
  );
  for (const scheme of ['fixture-research', 'missing-pack', 'fixture-seed']) {
    assert.deepEqual(
      pair(DARK_SYSTEM, `scheme=${scheme}&mode=light`),
      pair(DARK_SYSTEM, ''),
      scheme,
    );
  }
});

test('a published mode the scheme lacks is the owner diagnostic whatever the cookie says, and the final pair renders', () => {
  const published = { colorScheme: 'fixture-dark-only', displayMode: 'light' } as const;
  const codes = ['appearance.mode-incompatible'];
  assert.deepEqual(pair(published, ''), {
    scheme: 'fixture-dark-only',
    mode: 'light',
    visitor: [],
    resolvedMode: 'dark',
    modeLocked: true,
    codes,
  });
  assert.deepEqual(pair(published, 'mode=dark'), {
    scheme: 'fixture-dark-only',
    mode: 'dark',
    visitor: ['displayMode'],
    resolvedMode: 'dark',
    modeLocked: false,
    codes,
  });
  assert.deepEqual(pair(published, 'scheme=warm-parchment'), {
    scheme: 'warm-parchment',
    mode: 'light',
    visitor: ['colorScheme'],
    resolvedMode: 'light',
    modeLocked: false,
    codes,
  });
  assert.deepEqual(pair(published, 'mode=high-contrast'), {
    scheme: 'fixture-dark-only',
    mode: 'high-contrast',
    visitor: ['displayMode'],
    resolvedMode: 'high-contrast',
    modeLocked: false,
    codes,
  });
});

test('property: no visitor value leaves a scheme on a mode it lacks, and the owner sees the published pair alone', () => {
  const random = seeded(19_004);
  const schemes = ['warm-parchment', 'fixture-dark-only', 'fixture-light-only', 'missing-pack'];
  const cookieSchemes = [...schemes, 'fixture-research', 'fixture-seed', 'platform-neutral'];
  const modes = ['system', 'light', 'dark', 'high-contrast'] as const;
  const controls = ['locked', 'selectable'] as const;
  for (let index = 0; index < 4000; index += 1) {
    const published = { colorScheme: pick(random, schemes), displayMode: pick(random, modes) };
    const parts = [
      ...(random() < 0.7 ? [`scheme=${pick(random, cookieSchemes)}`] : []),
      ...(random() < 0.7 ? [`mode=${pick(random, [...modes, 'sepia'])}`] : []),
    ];
    const visitorControls = {
      ...DEFAULT_VISITOR_CONTROLS,
      colorScheme: pick(random, controls),
      displayMode: pick(random, controls),
    };
    const result = pair(published, parts.join('&'), visitorControls);
    const shown =
      published.colorScheme === 'missing-pack' ? 'warm-parchment' : published.colorScheme;
    const label = `${JSON.stringify(published)} ${parts.join('&')} ${JSON.stringify(visitorControls)}`;
    assert.equal(
      result.codes.includes('appearance.mode-incompatible'),
      !modeFits(registry, shown, published.displayMode),
      label,
    );
    if (result.visitor.length > 0) {
      assert.ok(modeFits(registry, result.scheme, result.mode), `left a misfit: ${label}`);
    }
    if (!modeFits(registry, result.scheme, result.mode)) {
      assert.deepEqual([result.scheme, result.mode], [shown, published.displayMode], label);
    }
  }
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
