import test from 'node:test';
import assert from 'node:assert/strict';
import {
  boundaryAttributes,
  DEFAULT_VISITOR_CONTROLS,
  PLATFORM_DEFAULTS,
  type Profile,
} from '@portfolio/appearance';
import type { DisplayMode, MotionPolicy, VisitorControls } from '@portfolio/schema';
import { FALLBACK_ID } from '@portfolio/variant-contract';
import {
  documentAppearance,
  FALLBACK_APPEARANCE,
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
  const resolved = documentAppearance({ site: SITE, variant: FALLBACK_ID, profile: 'read-only' });
  assert.equal(resolved.selection.variant, FALLBACK_ID);
  assert.deepEqual(
    resolved.diagnostics.map(({ code, axis }) => [code, axis]),
    [['variant.unavailable', 'variant']],
  );
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
  // Each choice names the stylesheet it needs, so the control loads it before it applies it.
  const scheme = visitorControlModel(SITE, 'read-only', appearance).controls[0]!;
  const choice = scheme.groups
    .flatMap((group) => group.choices)
    .find(({ value }) => value === 'warm-parchment')!;
  assert.match(choice.stylesheet ?? '', /^\/_portfolio\/pack\/warm-parchment\.[0-9a-f]+\.css$/);
});
