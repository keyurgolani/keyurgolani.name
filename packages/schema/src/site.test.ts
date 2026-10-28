import test from 'node:test';
import assert from 'node:assert/strict';
import { SiteSchema } from './compose';
import { DisplayModeSchema, MotionPolicySchema } from './site';

// The shape from the issue: every top-level key, optional ones included.
const FULL = {
  schemaVersion: 2,
  appearance: {
    variant: 'editorial',
    designLanguage: 'platform-neutral',
    colorScheme: 'warm',
    typography: 'classic',
    displayMode: 'system',
  },
  visitorControls: {
    variant: 'locked',
    designLanguage: 'locked',
    colorScheme: 'selectable',
    typography: 'locked',
    displayMode: 'selectable',
  },
  appearanceInputs: { 'brand-seed': { seedColor: '#3366ff' } },
  motionPolicy: 'respect-os',
  features: { feed: true, productAttribution: false },
  routes: { work: { enabled: true } },
  variantControls: { editorial: { version: 1, values: {} } },
  sections: { github: { hidden: true } },
};

const { appearanceInputs, routes, variantControls, sections, ...MINIMAL } = FULL;
void [appearanceInputs, routes, variantControls, sections];

function codes(input: unknown): string[] {
  const result = SiteSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('/')}:${i.code}`);
}

test('the full site document parses', () => {
  assert.deepEqual(codes(FULL), []);
});

test('the optional keys are optional', () => {
  assert.deepEqual(codes(MINIMAL), []);
});

test('schemaVersion, appearance, visitorControls, motionPolicy, and features are required', () => {
  assert.deepEqual(codes({}), [
    'schemaVersion:invalid_literal',
    'appearance:invalid_type',
    'visitorControls:invalid_type',
    'motionPolicy:invalid_type',
    'features:invalid_type',
  ]);
});

test('every appearance field is required', () => {
  for (const field of Object.keys(FULL.appearance)) {
    const appearance = { ...FULL.appearance, [field]: undefined };
    assert.deepEqual(codes({ ...MINIMAL, appearance }), [`appearance/${field}:invalid_type`]);
  }
});

test('all five visitor controls are required, each locked or selectable', () => {
  for (const field of Object.keys(FULL.visitorControls)) {
    const visitorControls = { ...FULL.visitorControls, [field]: undefined };
    assert.deepEqual(codes({ ...MINIMAL, visitorControls }), [
      `visitorControls/${field}:invalid_type`,
    ]);
  }
  const visitorControls = { ...FULL.visitorControls, colorScheme: 'hidden' };
  assert.deepEqual(codes({ ...MINIMAL, visitorControls }), [
    'visitorControls/colorScheme:invalid_enum_value',
  ]);
});

test('displayMode is system, light, dark, or high-contrast', () => {
  assert.deepEqual(DisplayModeSchema.options, ['system', 'light', 'dark', 'high-contrast']);
  for (const mode of ['bright', 'black', 'auto']) {
    const appearance = { ...FULL.appearance, displayMode: mode };
    assert.deepEqual(codes({ ...MINIMAL, appearance }), [
      'appearance/displayMode:invalid_enum_value',
    ]);
  }
});

test('motionPolicy is respect-os or reduce; nothing forces motion on', () => {
  assert.deepEqual(MotionPolicySchema.options, ['respect-os', 'reduce']);
  assert.deepEqual(codes({ ...MINIMAL, motionPolicy: 'full' }), [
    'motionPolicy:invalid_enum_value',
  ]);
});

test('appearance ids follow the registry grammar', () => {
  for (const id of ['editorial', 'kinetic-cosmos', 'acme-ocean', 'ab']) {
    const appearance = { ...FULL.appearance, variant: id };
    assert.deepEqual(codes({ ...MINIMAL, appearance }), [], id);
  }
  for (const id of ['Editorial', '1editorial', 'a', '@acme/ocean', 'a'.repeat(49), '']) {
    const appearance = { ...FULL.appearance, colorScheme: id };
    assert.deepEqual(
      codes({ ...MINIMAL, appearance }),
      ['appearance/colorScheme:invalid_string'],
      id,
    );
  }
});

test("the fallback composition can't be selected, though other axes may use the id", () => {
  const result = SiteSchema.safeParse({
    ...MINIMAL,
    appearance: { ...FULL.appearance, variant: 'fallback' },
  });
  assert.ok(!result.success);
  assert.deepEqual(
    result.error.issues.map(({ path, code, message }) => [path.join('/'), code, message]),
    [
      [
        'appearance/variant',
        'custom',
        "names the fallback composition, which renders in place of a variant this build doesn't register and can't be selected. Select a variant.",
      ],
    ],
  );
  const scheme = { ...FULL.appearance, colorScheme: 'fallback' };
  assert.deepEqual(codes({ ...MINIMAL, appearance: scheme }), []);
  assert.deepEqual(
    codes({ ...MINIMAL, variantControls: { fallback: { version: 1, values: {} } } }),
    [],
  );
});

test('features.feed is required and productAttribution defaults to false', () => {
  assert.deepEqual(codes({ ...MINIMAL, features: {} }), ['features/feed:invalid_type']);
  const out = SiteSchema.parse({ ...MINIMAL, features: { feed: false } });
  assert.deepEqual(out.features, { feed: false, productAttribution: false });
});

test('an appearance input is a seed color or a source asset', () => {
  const site = (input: unknown) => ({ ...MINIMAL, appearanceInputs: { 'brand-seed': input } });
  assert.deepEqual(codes(site({ seedColor: '#AABBCC' })), []);
  assert.deepEqual(codes(site({ sourceAsset: 'studio-portrait' })), []);
  // A near miss reports the field; a shape that matches neither reports the union.
  for (const bad of [{ seedColor: 'blue' }, { seedColor: '#abc' }]) {
    assert.deepEqual(codes(site(bad)), ['appearanceInputs/brand-seed/seedColor:invalid_string']);
  }
  assert.deepEqual(codes(site({ sourceAsset: 'Bad Id' })), [
    'appearanceInputs/brand-seed/sourceAsset:invalid_string',
  ]);
  assert.deepEqual(codes(site({})), ['appearanceInputs/brand-seed:invalid_union']);
  assert.deepEqual(
    codes({ ...MINIMAL, appearanceInputs: { 'Brand Seed': { seedColor: '#3366ff' } } }),
    ['appearanceInputs/Brand Seed:invalid_string'],
  );
});

test('routes, variant controls, and sections are keyed by well-formed ids', () => {
  assert.deepEqual(codes({ ...MINIMAL, routes: { work: { enabled: 'yes' } } }), [
    'routes/work/enabled:invalid_type',
  ]);
  assert.deepEqual(
    codes({ ...MINIMAL, variantControls: { editorial: { version: 0, values: {} } } }),
    ['variantControls/editorial/version:too_small'],
  );
  assert.deepEqual(
    codes({ ...MINIMAL, variantControls: { editorial: { version: 1, values: [] } } }),
    ['variantControls/editorial/values:invalid_type'],
  );
  assert.deepEqual(codes({ ...MINIMAL, sections: { main: { hidden: true } } }), [
    'sections/main:custom',
  ]);
  assert.deepEqual(codes({ ...MINIMAL, sections: { github: { hidden: 'no' } } }), [
    'sections/github/hidden:invalid_type',
  ]);
});

test('variant control values hold any plain data', () => {
  const values = { featured: ['a', 'b'], columns: 3, nested: { on: true } };
  const out = SiteSchema.parse({
    ...MINIMAL,
    variantControls: { editorial: { version: 2, values } },
  });
  assert.deepEqual(out.variantControls?.editorial?.values, values);
});

test('variant control values are plain JSON: no .inf or .nan, at most 8 levels deep', () => {
  const entry = (values: Record<string, unknown>) =>
    codes({ ...MINIMAL, variantControls: { editorial: { version: 1, values } } });
  assert.deepEqual(entry({ columns: Number.POSITIVE_INFINITY }), [
    'variantControls/editorial/values/columns:custom',
  ]);
  assert.deepEqual(entry({ featured: ['a', Number.NaN] }), [
    'variantControls/editorial/values/featured:custom',
  ]);
  const deep = (depth: number): unknown => (depth === 0 ? 1 : [deep(depth - 1)]);
  assert.deepEqual(entry({ ok: deep(8) }), []);
  assert.deepEqual(entry({ nested: deep(9) }), ['variantControls/editorial/values/nested:custom']);
  assert.deepEqual(
    codes({ ...MINIMAL, variantControls: { editorial: { version: Infinity, values: {} } } }),
    [
      'variantControls/editorial/version:not_finite',
      'variantControls/editorial/version:invalid_type',
    ],
  );
});
