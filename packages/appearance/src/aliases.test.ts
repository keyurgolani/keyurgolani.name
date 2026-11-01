// LANG-1: a retired pack's id is an alias of its survivor. Every reader
// that takes a stored or linked id reads it as the survivor, the validator
// warns and never blocks, and nothing lists an alias as a pack of its own.

import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicationUnit, type AppearanceSelection } from '@portfolio/schema';
import { contractValidators } from '@portfolio/variant-contract';
import {
  aliasNotice,
  aliasOf,
  aliasSentence,
  APPEARANCE_CODES,
  canonicalId,
  createAppearanceRegistry,
  DEFAULT_VISITOR_CONTROLS,
  modeFits,
  PLATFORM_DEFAULTS,
  resolveAppearance,
  resolveTokens,
  selectableIds,
  setAxis,
  validateAppearance,
  valueProblem,
  type PackAlias,
  type ResolveInput,
} from './index';
import { DARK_ONLY, MULTILINGUAL, PACKS, TRANSLUCENT, VARIANTS } from './test-support/packs';

/** A retired language that looked the same as its survivor. */
const TWIN: PackAlias = {
  kind: 'design-language',
  id: 'retired-twin',
  aliasOf: 'platform-neutral',
  packageName: '@portfolio/appearance-languages',
  change: null,
};
/** A retired language whose survivor looks slightly different. */
const NEAR: PackAlias = {
  kind: 'design-language',
  id: 'retired-near',
  aliasOf: TRANSLUCENT.id,
  packageName: '@portfolio/appearance-fixtures-languages',
  change: 'its icon strokes are slightly thinner',
};
/** A retired scheme, so the rule holds on every pack axis. */
const DARK: PackAlias = {
  kind: 'color-scheme',
  id: 'retired-dark',
  aliasOf: DARK_ONLY.id,
  packageName: '@portfolio/appearance-fixtures-schemes',
  change: null,
};
/** A retired typography profile, whose survivor covers more scripts than the fallback (LANG-5a). */
const SCRIPT: PackAlias = {
  kind: 'typography',
  id: 'retired-script',
  aliasOf: MULTILINGUAL.id,
  packageName: '@portfolio/appearance-typography',
  change: null,
};
const ALIASES = [TWIN, NEAR, DARK, SCRIPT];

const registry = createAppearanceRegistry({ VARIANTS, PACKS, PACK_ALIASES: ALIASES });
const PUBLISHED: AppearanceSelection = { ...PLATFORM_DEFAULTS, variant: 'acme-gallery' };

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

test('the registry reads each retired id as its survivor, through aliasOf() and canonicalId() alone', () => {
  assert.equal(aliasOf(registry, 'designLanguage', 'retired-twin'), TWIN);
  assert.equal(canonicalId(registry, 'designLanguage', 'retired-near'), TRANSLUCENT.id);
  assert.equal(canonicalId(registry, 'colorScheme', 'retired-dark'), DARK_ONLY.id);
  assert.equal(canonicalId(registry, 'typography', 'retired-script'), MULTILINGUAL.id);
  // An alias is its own axis's: a language alias is nothing on the scheme axis.
  assert.equal(canonicalId(registry, 'colorScheme', 'retired-twin'), 'retired-twin');
  assert.equal(canonicalId(registry, 'variant', 'retired-twin'), 'retired-twin');
  assert.equal(canonicalId(registry, 'designLanguage', 'platform-neutral'), 'platform-neutral');
});

test('no alias is selectable, so no picker, count, or visitor control lists one', () => {
  for (const axis of ['designLanguage', 'colorScheme', 'typography'] as const) {
    const ids = selectableIds(registry, axis);
    for (const alias of ALIASES) assert.ok(!ids.includes(alias.id), `${axis} lists ${alias.id}`);
  }
  assert.equal(
    selectableIds(registry, 'designLanguage').length,
    PACKS.filter(({ kind }) => kind === 'design-language').length,
  );
});

test('the registry refuses an alias that is registered, excluded, or retired twice', () => {
  const build =
    (aliases: readonly PackAlias[], excluded = false) =>
    () =>
      createAppearanceRegistry({
        VARIANTS,
        PACKS,
        PACK_ALIASES: aliases,
        ...(excluded
          ? {
              EXCLUDED_PACKS: [
                {
                  kind: 'design-language' as const,
                  id: 'left-out',
                  packageName: '@portfolio/appearance-languages',
                  reason: 'Its license is off the allowlist.',
                },
              ],
            }
          : {}),
      });
  assert.throws(build([{ ...TWIN, id: TRANSLUCENT.id }]), /both retired and registered/);
  assert.throws(build([{ ...TWIN, id: 'acme-gallery' }]), /both retired and registered/);
  assert.throws(build([{ ...TWIN, id: 'left-out' }], true), /both retired and excluded/);
  assert.throws(build([TWIN, { ...TWIN, aliasOf: TRANSLUCENT.id }]), /retired twice/);
});

test('an alias whose survivor this registry lacks, on its axis, or as another alias, reads as nothing', () => {
  // Registry generation refuses each of these; a registry built from fewer packs leaves them out.
  const partial = createAppearanceRegistry({
    VARIANTS,
    PACKS,
    PACK_ALIASES: [
      { ...TWIN, id: 'to-nothing', aliasOf: 'nothing-here' },
      { ...TWIN, id: 'to-a-scheme', aliasOf: DARK_ONLY.id },
      TWIN,
      { ...NEAR, id: 'to-an-alias', aliasOf: 'retired-twin' },
    ],
  });
  for (const id of ['to-nothing', 'to-a-scheme', 'to-an-alias']) {
    assert.equal(aliasOf(partial, 'designLanguage', id), undefined, id);
    assert.equal(canonicalId(partial, 'designLanguage', id), id, id);
  }
  assert.equal(canonicalId(partial, 'designLanguage', 'retired-twin'), 'platform-neutral');
  const resolved = resolveAppearance({
    published: { ...PUBLISHED, designLanguage: 'to-nothing' },
    visitorControls: DEFAULT_VISITOR_CONTROLS,
    motionPolicy: 'respect-os',
    profile: 'owner',
    registry: partial,
  });
  assert.deepEqual(resolved.fallbackAxes, ['designLanguage']);
});

test('a published alias renders its survivor, never as a fallback, with the alias warning', () => {
  const resolved = resolve({
    published: { ...PUBLISHED, designLanguage: 'retired-near', colorScheme: 'retired-dark' },
  });
  assert.equal(resolved.selection.designLanguage, TRANSLUCENT.id);
  assert.equal(resolved.selection.colorScheme, DARK_ONLY.id);
  assert.equal(resolved.requested.designLanguage, TRANSLUCENT.id);
  assert.deepEqual(resolved.fallbackAxes, []);
  assert.deepEqual(
    resolved.diagnostics.map(({ code, axis }) => [code, axis]),
    [
      ['appearance.alias', 'designLanguage'],
      ['appearance.alias', 'colorScheme'],
    ],
  );
  // A dark-only survivor pins system to dark, as it would published under its own id.
  assert.equal(resolved.resolvedMode, 'dark');
});

test('the alias warning names the survivor and what differs, or says it looks the same', () => {
  assert.deepEqual(aliasNotice(registry, 'designLanguage', 'retired-near'), {
    code: 'appearance.alias',
    axis: 'designLanguage',
    message: `retired-near is now ${TRANSLUCENT.id}; its icon strokes are slightly thinner.`,
    remediation: `Nothing breaks: ${TRANSLUCENT.id} renders. Select ${TRANSLUCENT.id} or another design language to clear this.`,
  });
  assert.equal(
    aliasNotice(registry, 'designLanguage', 'retired-twin')?.message,
    'retired-twin is now platform-neutral; it looks the same.',
  );
  assert.equal(aliasNotice(registry, 'designLanguage', 'platform-neutral'), null);
  assert.equal(aliasNotice(registry, 'displayMode', 'retired-twin'), null);
  assert.equal(APPEARANCE_CODES['appearance.alias'], 'warning');
});

test('once a survivor has evolved since the merge, the notice says the alias follows its updates and claims no sameness (LANG-2)', () => {
  const evolved = createAppearanceRegistry({
    VARIANTS,
    PACKS,
    PACK_ALIASES: [
      { ...TWIN, changedSinceMerge: true },
      { ...NEAR, changedSinceMerge: true },
      { ...DARK, changedSinceMerge: false },
    ],
  });
  const twin = aliasNotice(evolved, 'designLanguage', 'retired-twin')!;
  assert.equal(
    twin.message,
    'retired-twin was merged into platform-neutral and follows its updates.',
  );
  assert.doesNotMatch(twin.message, /looks the same/);
  assert.equal(
    aliasNotice(evolved, 'designLanguage', 'retired-near')?.message,
    `retired-near was merged into ${TRANSLUCENT.id} and follows its updates; its icon strokes are slightly thinner.`,
  );
  // An unchanged survivor, said as false or left out, still looks the same.
  assert.equal(
    aliasNotice(evolved, 'colorScheme', 'retired-dark')?.message,
    `retired-dark is now ${DARK_ONLY.id}; it looks the same.`,
  );
  assert.equal(aliasSentence(TWIN), 'retired-twin is now platform-neutral; it looks the same.');
  // It stays a warning, so nothing blocks.
  assert.equal(twin.code, 'appearance.alias');
});

test('a visitor value that names an alias, by cookie or demo query, applies its survivor', () => {
  const cookie = resolve({
    visitorControls: { ...DEFAULT_VISITOR_CONTROLS, designLanguage: 'selectable' },
    visitor: { cookie: 'language=retired-near' },
  });
  assert.equal(cookie.selection.designLanguage, TRANSLUCENT.id);
  assert.deepEqual(cookie.visitorAxes, ['designLanguage']);
  // The visitor's own value is never an owner diagnostic.
  assert.deepEqual(cookie.diagnostics, []);
  const query = resolve({
    profile: 'demo',
    visitor: { query: new URLSearchParams('language=retired-twin&scheme=retired-dark') },
  });
  assert.equal(query.selection.designLanguage, 'platform-neutral');
  assert.equal(query.selection.colorScheme, DARK_ONLY.id);
  assert.equal(query.requested.colorScheme, DARK_ONLY.id);
});

test('an alias is no problem for a value check, and a change to it writes the survivor', () => {
  const current = { ...PUBLISHED };
  assert.equal(valueProblem(registry, 'designLanguage', 'retired-near', current), null);
  assert.equal(
    setAxis(PUBLISHED, 'designLanguage', 'retired-near', registry).selection.designLanguage,
    TRANSLUCENT.id,
  );
  // The alias's survivor's modes hold: a dark-only scheme's alias has no light mode.
  assert.equal(modeFits(registry, 'retired-dark', 'light'), false);
  assert.equal(
    valueProblem(registry, 'colorScheme', 'retired-dark', { ...current, displayMode: 'light' })
      ?.code,
    'appearance.mode-incompatible',
  );
});

test("an alias's tokens are its survivor's, with no fallback", () => {
  const request = {
    designLanguage: 'retired-near',
    colorScheme: PLATFORM_DEFAULTS.colorScheme,
    typography: PLATFORM_DEFAULTS.typography,
    polarity: 'light' as const,
    contrast: 'system' as const,
  };
  const aliased = resolveTokens(registry, request);
  const survivor = resolveTokens(registry, { ...request, designLanguage: TRANSLUCENT.id });
  assert.deepEqual(aliased.fallbackAxes, []);
  assert.deepEqual(aliased, survivor);
});

test("a retired scheme's and typography profile's tokens are their survivors', with no fallback (LANG-5a)", () => {
  const request = {
    designLanguage: PLATFORM_DEFAULTS.designLanguage,
    colorScheme: 'retired-dark',
    typography: 'retired-script',
    polarity: 'dark' as const,
    contrast: 'system' as const,
  };
  const aliased = resolveTokens(registry, request);
  assert.deepEqual(aliased.fallbackAxes, []);
  assert.equal(aliased.packs.colorScheme, DARK_ONLY.id);
  assert.equal(aliased.packs.typography, MULTILINGUAL.id);
  assert.deepEqual(
    aliased,
    resolveTokens(registry, {
      ...request,
      colorScheme: DARK_ONLY.id,
      typography: MULTILINGUAL.id,
    }),
  );
});

test('a change to a retired scheme or typography profile writes its survivor (LANG-5a)', () => {
  const selection = { ...PUBLISHED, displayMode: 'dark' as const };
  assert.equal(
    setAxis(selection, 'colorScheme', 'retired-dark', registry).selection.colorScheme,
    DARK_ONLY.id,
  );
  assert.equal(
    setAxis(selection, 'typography', 'retired-script', registry).selection.typography,
    MULTILINGUAL.id,
  );
});

/** The pair checked as the host checks it: live at startup, not live at import and publish. */
function check(
  appearance: Record<string, unknown>,
  live: boolean,
  extra: { site?: Record<string, unknown>; locale?: string } = {},
) {
  const site = {
    schemaVersion: 2,
    appearance: { ...PUBLISHED, ...appearance },
    visitorControls: DEFAULT_VISITOR_CONTROLS,
    motionPolicy: 'respect-os',
    features: { feed: true },
    ...extra.site,
  };
  const portfolio = {
    schemaVersion: 3,
    locale: extra.locale ?? 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Fixture' },
    sections: [{ kind: 'lede', id: 'about', title: 'About', body: 'Builds calm software.' }],
  };
  return validatePublicationUnit(
    {
      portfolio: { text: JSON.stringify(portfolio), format: 'json', name: 'portfolio.json' },
      site: { text: JSON.stringify(site), format: 'json', name: 'site.json' },
    },
    {
      validators: [
        ...contractValidators(VARIANTS, { live }),
        validateAppearance(registry, { live }),
      ],
    },
  );
}

test('validation reports an alias as a warning, never an error, live and at import and publish', () => {
  for (const live of [true, false]) {
    const result = check({ designLanguage: 'retired-near', colorScheme: 'retired-dark' }, live);
    assert.ok(result.pair, 'the pair parses, so preview renders it');
    assert.deepEqual(
      result.diagnostics.map(({ code, severity, pointer, message }) => [
        code,
        severity,
        pointer,
        message,
      ]),
      [
        [
          'appearance.alias',
          'warning',
          '/appearance/colorScheme',
          `/appearance/colorScheme retired-dark is now ${DARK_ONLY.id}; it looks the same.`,
        ],
        [
          'appearance.alias',
          'warning',
          '/appearance/designLanguage',
          `/appearance/designLanguage retired-near is now ${TRANSLUCENT.id}; its icon strokes are slightly thinner.`,
        ],
      ],
      `live: ${live}`,
    );
  }
});

test('an explicit mode the aliased scheme lacks is still the mode check, against the survivor', () => {
  const result = check({ colorScheme: 'retired-dark', displayMode: 'light' }, false);
  assert.deepEqual(
    result.diagnostics.map(({ code, pointer }) => [code, pointer]),
    [
      ['appearance.alias', '/appearance/colorScheme'],
      ['appearance.mode-incompatible', '/appearance/displayMode'],
    ],
  );
});

test('an appearanceInputs key that names a retired scheme is checked as its survivor, as it was before the merge (LANG-5a)', () => {
  const keyed = (key: string) =>
    check({}, false, { site: { appearanceInputs: { [key]: { seedColor: '#336699' } } } })
      .diagnostics.filter(({ pointer }) => pointer.startsWith('/appearanceInputs'))
      .map(({ code, severity, pointer, message }) => [code, severity, pointer, message]);
  // The survivor takes no input, so neither does its alias: the same error, at the alias's own key.
  assert.deepEqual(keyed(DARK_ONLY.id), [
    [
      'schema.invalid',
      'blocks-preview',
      `/appearanceInputs/${DARK_ONLY.id}`,
      `/appearanceInputs/${DARK_ONLY.id} is for a color scheme that takes no input.`,
    ],
  ]);
  assert.deepEqual(keyed('retired-dark'), [
    [
      'schema.invalid',
      'blocks-preview',
      '/appearanceInputs/retired-dark',
      '/appearanceInputs/retired-dark is for a color scheme that takes no input.',
    ],
  ]);
  // A key no axis knows is still left unchecked, and another axis's alias is no scheme's.
  assert.deepEqual(keyed('nothing-here'), []);
  assert.deepEqual(keyed('retired-script'), []);
});

test("a retired typography profile's script coverage is its survivor's (LANG-5a)", () => {
  const coverage = (typography: string) =>
    check({ typography }, false, { locale: 'ru' })
      .diagnostics.filter(({ code }) => code === 'appearance.script-coverage')
      .map(({ pointer }) => pointer);
  // The fallback covers Latin alone, so Cyrillic text is a warning under it.
  assert.deepEqual(coverage(PLATFORM_DEFAULTS.typography), ['/locale']);
  // The alias renders its survivor, which covers Cyrillic, so nothing falls back.
  assert.deepEqual(coverage(MULTILINGUAL.id), []);
  assert.deepEqual(coverage('retired-script'), []);
  assert.deepEqual(
    check({ typography: 'retired-script' }, false).diagnostics.map(({ code, pointer, message }) => [
      code,
      pointer,
      message,
    ]),
    [
      [
        'appearance.alias',
        '/appearance/typography',
        `/appearance/typography retired-script is now ${MULTILINGUAL.id}; it looks the same.`,
      ],
    ],
  );
});
