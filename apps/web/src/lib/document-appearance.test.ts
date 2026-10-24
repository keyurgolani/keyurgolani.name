import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  boundaryAttributes,
  DEFAULT_VISITOR_CONTROLS,
  PLATFORM_DEFAULTS,
  resolveTokens,
  type GeneratedScheme,
  type Profile,
} from '@portfolio/appearance';
import type { DisplayMode, MotionPolicy, VisitorControls } from '@portfolio/schema';
import { FALLBACK_ID } from '@portfolio/variant-contract';
import { APPEARANCE_REGISTRY } from './appearance-registry';
import {
  documentAppearance,
  FALLBACK_APPEARANCE,
  storedSchemes,
  visitorControlModel,
} from './document-appearance';
import {
  ENVIRONMENT_ATTRIBUTES,
  environmentAttributes,
  type EnvironmentOverride,
} from './environment';

// Every page's document boundary (#19, Slice 4): resolveAppearance() for the
// site the page shows, the profile, the visitor's cookie or query, and a
// preview's environment, with the page's own composition rendering.

const SITE = {
  appearance: {
    ...PLATFORM_DEFAULTS,
    variant: 'editorial-evidence',
    displayMode: 'system' as const,
  },
  visitorControls: DEFAULT_VISITOR_CONTROLS,
  motionPolicy: 'respect-os' as MotionPolicy,
};

test('a page with no site renders the fallback packs, with no finding about the variant it never selected', () => {
  const resolved = documentAppearance({ site: null, variant: FALLBACK_ID, profile: 'read-only' });
  assert.deepEqual(resolved.selection, { ...FALLBACK_APPEARANCE, variant: FALLBACK_ID });
  assert.deepEqual(resolved.diagnostics, []);
  assert.deepEqual(resolved.fallbackAxes, []);
});

test("the page's composition renders, and a site's variant this build lacks is still the owner's finding", () => {
  const unknown = { ...SITE, appearance: { ...SITE.appearance, variant: 'missing-variant' } };
  const resolved = documentAppearance({
    site: unknown,
    variant: FALLBACK_ID,
    profile: 'read-only',
  });
  assert.equal(resolved.selection.variant, FALLBACK_ID);
  assert.deepEqual(
    resolved.diagnostics.map(({ code, axis }) => [code, axis]),
    [['variant.unavailable', 'variant']],
  );
});

test('the platform default, Editorial Evidence, is registered: it renders with no finding (#13)', () => {
  const resolved = documentAppearance({
    site: SITE,
    variant: 'editorial-evidence',
    profile: 'read-only',
  });
  assert.equal(resolved.selection.variant, 'editorial-evidence');
  assert.deepEqual(resolved.diagnostics, []);
  assert.deepEqual(resolved.fallbackAxes, []);
});

test('owner and read-only read the cookie, demo the query, each on the axes the site lets a visitor choose', () => {
  for (const profile of ['owner', 'read-only'] as const) {
    const resolved = documentAppearance({
      site: SITE,
      variant: FALLBACK_ID,
      profile,
      cookie: 'mode=dark&type=humanist-ui',
      query: { mode: 'light' },
    });
    assert.equal(resolved.selection.displayMode, 'dark', profile);
    assert.deepEqual(resolved.visitorAxes, ['displayMode'], profile);
  }
  const demo = documentAppearance({
    site: SITE,
    variant: FALLBACK_ID,
    profile: 'demo',
    cookie: 'mode=dark',
    query: { mode: 'light' },
  });
  assert.equal(demo.selection.displayMode, 'light');
  // The variant stays the page's whatever a visitor value says.
  const variant = documentAppearance({
    site: { ...SITE, visitorControls: { ...DEFAULT_VISITOR_CONTROLS, variant: 'selectable' } },
    variant: FALLBACK_ID,
    profile: 'read-only',
    cookie: 'variant=editorial-evidence',
  });
  assert.equal(variant.selection.variant, FALLBACK_ID);
  assert.ok(!variant.visitorAxes.includes('variant'));
});

test("a preview's environment reads no visitor value, and its motion only lowers", () => {
  const resolved = documentAppearance({
    site: SITE,
    variant: FALLBACK_ID,
    profile: 'owner',
    cookie: 'mode=dark',
    environment: { displayMode: 'light', motion: 'reduce', contrast: 'more', enhancement: 'off' },
  });
  assert.equal(resolved.selection.displayMode, 'light');
  assert.deepEqual(resolved.visitorAxes, []);
  assert.equal(resolved.motion, 'reduced');
  assert.equal(resolved.contrast, 'more');
  assert.equal(resolved.enhancement, 'off');
  // `system` keeps what the site publishes, and `system` motion raises nothing a reduce policy lowered.
  const kept = documentAppearance({
    site: {
      ...SITE,
      appearance: { ...SITE.appearance, displayMode: 'dark' },
      motionPolicy: 'reduce',
    },
    variant: FALLBACK_ID,
    profile: 'owner',
    environment: { displayMode: 'system', motion: 'system' },
  });
  assert.equal(kept.selection.displayMode, 'dark');
  assert.equal(kept.motion, 'reduced');
});

test("the agent's environmentAttributes() set what the server's boundary renders, for every environment Studio sends, on a scheme with both modes", () => {
  const modes: readonly (DisplayMode | undefined)[] = [
    undefined,
    'system',
    'light',
    'dark',
    'high-contrast',
  ];
  for (const published of ['system', 'light', 'dark'] as const) {
    for (const motionPolicy of ['respect-os', 'reduce'] as const) {
      for (const displayMode of modes) {
        for (const motion of [undefined, 'system', 'reduce'] as const) {
          for (const contrast of [undefined, 'system', 'more'] as const) {
            for (const enhancement of [undefined, 'on', 'off'] as const) {
              const environment: EnvironmentOverride = {
                ...(displayMode ? { displayMode } : {}),
                ...(motion ? { motion } : {}),
                ...(contrast ? { contrast } : {}),
                ...(enhancement ? { enhancement } : {}),
              };
              const site = {
                ...SITE,
                appearance: { ...SITE.appearance, displayMode: published },
                motionPolicy,
              };
              const server = boundaryAttributes(
                documentAppearance({ site, variant: FALLBACK_ID, profile: 'owner', environment }),
                'document',
              ) as Record<string, string>;
              const agent: Readonly<Record<string, string>> = {
                ...environmentAttributes({ displayMode: published, motionPolicy }, environment),
              };
              const what = JSON.stringify({ published, motionPolicy, environment });
              for (const name of ENVIRONMENT_ATTRIBUTES) {
                assert.equal(agent[name], server[name], `${name} ${what}`);
              }
            }
          }
        }
      }
    }
  }
});

test("the visitor control offers the site's selectable axes but the variant, and nothing under demo", () => {
  const appearance = documentAppearance({ site: SITE, variant: FALLBACK_ID, profile: 'read-only' });
  const axes = (profile: Profile, controls: VisitorControls = DEFAULT_VISITOR_CONTROLS) =>
    visitorControlModel({ visitorControls: controls }, profile, appearance).controls.map(
      ({ axis }) => axis,
    );
  assert.deepEqual(axes('read-only'), ['colorScheme', 'displayMode']);
  assert.deepEqual(axes('owner'), ['colorScheme', 'displayMode']);
  assert.deepEqual(axes('demo'), []);
  const everything = {
    variant: 'selectable',
    designLanguage: 'selectable',
    colorScheme: 'selectable',
    typography: 'selectable',
    displayMode: 'selectable',
  } as const;
  assert.deepEqual(axes('read-only', everything), [
    'designLanguage',
    'colorScheme',
    'typography',
    'displayMode',
  ]);
  // No choice names a stylesheet, so the model a public page carries names no pack's
  // stylesheet but those it renders (#6's purity check). The save's response does.
  const model = visitorControlModel({ visitorControls: everything }, 'read-only', appearance);
  for (const choice of model.controls.flatMap(({ groups }) => groups.flatMap((g) => g.choices)))
    assert.deepEqual(
      Object.keys(choice).filter((key) => key !== 'unavailable'),
      ['value', 'label'],
    );
  assert.doesNotMatch(JSON.stringify(model), /_portfolio\/pack\//);
});

/**
 * B's DerivedScheme (#10's 10h), mirrored until it lands in
 * @portfolio/appearance: what a draft's derived.schemes and a revision's
 * snapshots/schemes.json hold for one generated scheme.
 */
interface DerivedScheme {
  readonly generator: { readonly id: string; readonly version: number };
  readonly inputsHash: string;
  readonly tokens: GeneratedScheme;
}

/** brand-seed's reference record (#20 PR 3) as the draft save would store it. */
function brandSeed(): DerivedScheme {
  const record = JSON.parse(
    fs.readFileSync(
      fileURLToPath(
        new URL(
          '../../../../packages/appearance-schemes/generated/brand-seed.json',
          import.meta.url,
        ),
      ),
      'utf8',
    ),
  ) as {
    result: {
      generator: DerivedScheme['generator'];
      input: { seedColor: string };
      tokens: GeneratedScheme;
    };
  };
  return {
    generator: record.result.generator,
    inputsHash: createHash('sha256').update(record.result.input.seedColor).digest('hex'),
    tokens: record.result.tokens,
  };
}

const BRANDED = { ...SITE, appearance: { ...SITE.appearance, colorScheme: 'brand-seed' } };

test("a site's stored generated scheme renders its own sets, and render never runs a generator (#20 PR 3)", () => {
  const stored = brandSeed();
  const resolved = documentAppearance({
    site: BRANDED,
    variant: FALLBACK_ID,
    profile: 'read-only',
    schemes: { 'brand-seed': stored },
  });
  assert.equal(resolved.selection.colorScheme, 'brand-seed');
  assert.ok(!resolved.fallbackAxes.includes('colorScheme'));
  assert.deepEqual(
    resolved.diagnostics.filter(({ axis }) => axis === 'colorScheme'),
    [],
  );
  const tokens = resolveTokens(
    APPEARANCE_REGISTRY,
    { ...PLATFORM_DEFAULTS, colorScheme: 'brand-seed', polarity: 'light' },
    { generated: storedSchemes({ 'brand-seed': stored }) },
  );
  assert.deepEqual(tokens.color, stored.tokens.light);
  const high = resolveTokens(
    APPEARANCE_REGISTRY,
    { ...PLATFORM_DEFAULTS, colorScheme: 'brand-seed', polarity: 'dark', highContrast: true },
    { generated: storedSchemes({ 'brand-seed': stored }) },
  );
  assert.deepEqual(
    high.color,
    stored.tokens.highContrast!.dark,
    'its own high-contrast set, as solved',
  );
  // The visitor control offers it once it has sets.
  const selectable = (model: ReturnType<typeof visitorControlModel>) =>
    model.controls[0]!.groups.some(({ choices }) =>
      choices.some(({ value, unavailable }) => value === 'brand-seed' && !unavailable),
    );
  assert.ok(
    selectable(
      visitorControlModel(BRANDED, 'read-only', resolved, APPEARANCE_REGISTRY, {
        'brand-seed': stored,
      }),
    ),
  );
  // With nothing stored, a visitor can't pick it: it shows only as what's applied.
  assert.ok(!selectable(visitorControlModel(BRANDED, 'read-only', resolved)));
});

test('a stored scheme that is missing, malformed, from another generator or version, or waiting for review falls back on its axis, with a diagnostic', () => {
  const stored = brandSeed();
  const { light, ...noLight } = stored.tokens;
  void light;
  const cases: Record<string, unknown> = {
    missing: {},
    'not an object': 'brand-seed',
    'entry not an object': { 'brand-seed': 7 },
    'no inputs hash': { 'brand-seed': { ...stored, inputsHash: undefined } },
    'a short inputs hash': { 'brand-seed': { ...stored, inputsHash: 'abc' } },
    'an incomplete set': {
      'brand-seed': { ...stored, tokens: { ...stored.tokens, dark: { canvas: '#000000' } } },
    },
    'a missing set': { 'brand-seed': { ...stored, tokens: noLight } },
    'another generator': {
      'brand-seed': { ...stored, generator: { id: 'hct-tonal', version: 1 } },
    },
    'another version': {
      'brand-seed': { ...stored, generator: { id: 'brand-seed', version: 2 } },
    },
    'waiting for review': {
      'brand-seed': { ...stored, tokens: { ...stored.tokens, review: 'pending' } },
    },
  };
  for (const [what, schemes] of Object.entries(cases)) {
    const resolved = documentAppearance({
      site: BRANDED,
      variant: FALLBACK_ID,
      profile: 'read-only',
      schemes,
    });
    assert.equal(resolved.selection.colorScheme, PLATFORM_DEFAULTS.colorScheme, what);
    assert.deepEqual(
      resolved.diagnostics.filter(({ axis }) => axis === 'colorScheme').map(({ code }) => code),
      ['appearance.input-missing'],
      what,
    );
    assert.deepEqual(storedSchemes(schemes), {}, what);
  }
  // An entry for an id that isn't a generator scheme is left out too.
  assert.deepEqual(storedSchemes({ 'warm-parchment': stored }), {});
});
