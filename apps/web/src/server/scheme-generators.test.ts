import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createAppearanceRegistry,
  DERIVED_ROLES,
  findPack,
  readDerivedSchemes,
  resolveTokens,
  schemeSets,
  storedTokens,
  validatePackManifest,
  GENERATOR_V1_FOCUS_TARGETS,
  withDerivedRoles,
  type AppearanceRegistry,
} from '@portfolio/appearance';
import { derivedChanges } from '@portfolio/schema';
import { runGenerator, strictestReport } from '@portfolio/appearance/generators';
import { PACKS, VARIANTS } from '~/lib/generated/registry.meta';
import { storedSchemes } from '~/lib/document-appearance-core';
import { buildUnitChecks } from './unit-checks';
import { schemeGenerators } from './scheme-generators';

// The build's scheme generators and the read side (#10, 10h): the store
// runs the generator a registered scheme's manifest declares, through
// runGenerator(), and checks what it made against DerivedSchemeSchema; a
// page reads the revision's frozen tokens, checked the same way, and never
// runs a generator, so a missing or broken entry renders the fallback.

/** This build's registry with fixture-seed, the generated test scheme, registered too. */
function withFixtureSeed(): AppearanceRegistry {
  const raw: unknown = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          '../../../../packages/appearance-fixtures-schemes/packs/fixture-seed/manifest.json',
          import.meta.url,
        ),
      ),
      'utf8',
    ),
  );
  const checked = validatePackManifest(raw, {
    kind: 'color-scheme',
    packageName: '@portfolio/appearance-fixtures-schemes',
  });
  assert.ok(checked.ok, JSON.stringify(checked));
  const others = PACKS.filter((pack) => pack.manifest.id !== 'fixture-seed');
  return createAppearanceRegistry({
    VARIANTS,
    PACKS: [
      ...others,
      {
        kind: 'color-scheme',
        manifest: checked.manifest,
        packageName: '@portfolio/appearance-fixtures-schemes',
        version: '1.0.0',
        fixture: true,
      },
    ] as typeof PACKS,
  });
}

const request = {
  designLanguage: 'platform-neutral',
  colorScheme: 'fixture-seed',
  typography: 'humanist-ui',
  polarity: 'light',
} as const;

test("the build's checks carry the generators each registered scheme declares, run through runGenerator, and check what they make", () => {
  const registry = withFixtureSeed();
  const checks = buildUnitChecks({ registry: VARIANTS, appearance: registry, appVersion: 'test' });
  const generators = checks.schemes;
  assert.ok(generators, 'the build hands the store its generators');
  assert.deepEqual(generators.declared('fixture-seed'), {
    id: 'fixture-seed',
    version: 1,
    input: 'seed-color',
  });
  assert.equal(generators.declared('warm-parchment'), undefined, 'an authored scheme has none');
  assert.equal(generators.declared('no-such-scheme'), undefined);

  const run = generators.run(
    { id: 'fixture-seed', version: 1, input: 'seed-color' },
    { seedColor: '#3366ff' },
  );
  assert.ok(run.ok);
  const expected = runGenerator(
    { id: 'fixture-seed', version: 1, input: 'seed-color' },
    { seedColor: '#3366ff' },
  );
  assert.ok(expected.ok);
  // Stored without the roles K-2 added, which rendering works out again.
  assert.deepEqual(run.ok ? run.tokens : null, storedTokens(expected.result.tokens));
  assert.equal(
    generators.check({
      generator: run.generator,
      inputsHash: 'a'.repeat(64),
      tokens: run.ok ? run.tokens : null,
    }),
    true,
  );
  // Another version, or an asset this generator doesn't take, is a problem, never a throw.
  const later = generators.run(
    { id: 'fixture-seed', version: 2, input: 'seed-color' },
    { seedColor: '#3366ff' },
  );
  assert.equal(later.ok, false);
  assert.match(later.ok ? '' : later.problem, /version 2, and this build has version 1/);
  const asset = generators.run(
    { id: 'fixture-seed', version: 1, input: 'asset' },
    { sourceAsset: 'portrait', bytes: new Uint8Array([1, 2, 3]) },
  );
  assert.equal(asset.ok, false);
  // An incomplete set doesn't check.
  assert.equal(
    generators.check({
      generator: run.generator,
      inputsHash: 'a'.repeat(64),
      tokens: { light: {} },
    }),
    false,
  );
});

/** What resolveTokens() takes in `generated`: each read entry's tokens. */
const generatedOf = (value: unknown) =>
  Object.fromEntries(
    Object.entries(readDerivedSchemes(value).schemes).map(([id, entry]) => [id, entry.tokens]),
  );

test("a page renders the revision's frozen tokens as they are, never generating them again, and an entry missing or broken falls back on the scheme axis", () => {
  const registry = withFixtureSeed();
  // Tokens fixture-seed would never make from the site's seed: what the
  // owner accepted is what renders, whatever the generator says now.
  const made = runGenerator(
    { id: 'fixture-seed', version: 1, input: 'seed-color' },
    { seedColor: '#aa5500' },
  );
  assert.ok(made.ok);
  const entry = {
    generator: { id: 'fixture-seed', version: 1 },
    inputsHash: 'b'.repeat(64),
    tokens: made.result.tokens,
  };
  const resolved = resolveTokens(registry, request, {
    generated: generatedOf({ 'fixture-seed': entry }),
  });
  assert.deepEqual(resolved.fallbackAxes, []);
  assert.deepEqual(resolved.color, made.result.tokens.light);

  const broken = readDerivedSchemes({
    'fixture-seed': { ...entry, tokens: { light: made.result.tokens.light } },
  });
  assert.deepEqual(broken.schemes, {});
  assert.deepEqual(
    broken.problems.map(({ code, schemeId }) => [code, schemeId]),
    [['scheme.invalid', 'fixture-seed']],
  );
  assert.deepEqual(
    resolveTokens(registry, request, { generated: generatedOf(broken.schemes) }).fallbackAxes,
    ['colorScheme'],
  );
  // None at all: the same fallback.
  assert.deepEqual(
    resolveTokens(registry, request, { generated: generatedOf(undefined) }).fallbackAxes,
    ['colorScheme'],
  );
});

test('a scheme a revision froze before K-2, and a draft save of the same seed now, are one entry: no scheme-regenerated change (K-2 review M1)', () => {
  const checks = buildUnitChecks({
    registry: VARIANTS,
    appearance: withFixtureSeed(),
    appVersion: 'test',
  });
  const generators = checks.schemes!;
  const declared = generators.declared('brand-seed')!;
  // brand-seed's reference record was written before K-2: its sets have none of the three roles.
  const record = JSON.parse(
    readFileSync(
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
      generator: { id: string; version: number };
      input: { seedColor: string };
      tokens: Record<string, Record<string, string>>;
    };
  };
  const live = record.result.tokens;
  assert.ok(
    DERIVED_ROLES.every((role) => !(role in live.light!)),
    'a pre-K-2 record',
  );
  const fresh = generators.run(declared, { seedColor: record.result.input.seedColor });
  assert.ok(fresh.ok);
  const entry = (tokens: unknown) => ({
    generator: record.result.generator,
    inputsHash: 'c'.repeat(64),
    tokens,
  });
  const side = (tokens: unknown) => ({ snapshots: { schemes: { 'brand-seed': entry(tokens) } } });
  assert.deepEqual(derivedChanges(side(live), side(fresh.ok ? fresh.tokens : null)), []);
  // Stored with the three, the same save would raise one, which publish waits on.
  const whole = runGenerator(declared, { seedColor: record.result.input.seedColor });
  assert.ok(whole.ok);
  assert.deepEqual(
    derivedChanges(side(live), side(whole.result.tokens)).map(({ cause }) => cause),
    ['scheme-regenerated'],
  );
  // What renders from the stored entry is the generator's whole set, the three worked out again.
  const [read] = Object.values(
    readDerivedSchemes({ 'brand-seed': entry(fresh.ok ? fresh.tokens : null) }).schemes,
  );
  assert.deepEqual(read!.tokens.light, whole.result.tokens.light);
  assert.deepEqual(read!.tokens.highContrast?.dark, whole.result.tokens.highContrast?.dark);
  // As its generator, at version 1, works them out (focus-inverse at 3.5:1, not a scheme pack's 4.5:1).
  assert.deepEqual(
    withDerivedRoles(live.light as never, false, GENERATOR_V1_FOCUS_TARGETS),
    whole.result.tokens.light,
  );
});

test('a run whose own contrast report fails is a problem naming its first failing pair, and nothing is stored (K-2 delta review N3)', () => {
  const declared = { id: 'fixture-seed', version: 1, input: 'seed-color' } as const;
  const made = runGenerator(declared, { seedColor: '#3366ff' });
  assert.ok(made.ok);
  // As if no lighter step could light the dark set's surface-lit.
  const unlit: typeof runGenerator = () => ({
    ok: true,
    result: {
      ...made.result,
      contrastReport: {
        passes: false,
        pairs: [
          ...made.result.contrastReport.pairs,
          {
            set: 'dark',
            kind: 'surface-lit',
            foreground: 'surface-lit',
            ground: 'surface-prominent',
            ratio: 1,
            target: 1,
            passes: false,
          },
        ],
      },
    },
  });
  const run = schemeGenerators(withFixtureSeed(), unlit).run(declared, { seedColor: '#3366ff' });
  assert.equal(run.ok, false);
  assert.match(
    run.ok ? '' : run.problem,
    /fixture-seed made a scheme that fails its own contrast report, first surface-lit on surface-prominent in dark, so it isn't stored/,
  );
  // Its advice is to pick another seed, not to give an input the generator takes (K-2 delta review K2-L2).
  assert.equal(
    run.ok ? '' : run.remediation,
    'Pick another seed color, then save the draft, or select another color scheme.',
  );
  assert.doesNotMatch(run.ok ? '' : run.problem, /Try another input/);
  // A passing one stores as before.
  assert.equal(
    schemeGenerators(withFixtureSeed()).run(declared, { seedColor: '#3366ff' }).ok,
    true,
  );
});

/**
 * A brand-seed run whose dark set reads on every bare surface but not under
 * a 4% accent wash: a white accent (black on it, its states near white)
 * and a grey text-muted, which no seed gives (LANG-5c r2b's sweep),
 * planted so the wash is all that's new. Its
 * report is the strictest report of the planted sets, as runGenerator()
 * would give them, so it fails on the wash pair and nothing else.
 */
function washedOut(): typeof runGenerator {
  const declared = { id: 'brand-seed', version: 1, input: 'seed-color' } as const;
  const made = runGenerator(declared, { seedColor: '#5b5bd6' });
  assert.ok(made.ok);
  const { tokens } = made.result;
  const planted = {
    ...tokens,
    dark: {
      ...tokens.dark,
      accent: '#ffffff',
      'accent-hover': '#e0e0e0',
      'accent-active': '#d0d0d0',
      'on-accent': '#000000',
      'text-muted': '#a7a7a7',
    },
  };
  const contrastReport = strictestReport(schemeSets(planted, planted.highContrast));
  assert.equal(contrastReport.passes, false);
  assert.deepEqual(
    contrastReport.pairs
      .filter(({ passes }) => !passes)
      .map(({ foreground, ground, set, wash }) => [foreground, ground, set, wash]),
    [['text-muted', 'surface-prominent', 'dark', 'the 4% accent wash']],
  );
  return () => ({ ok: true, result: { ...made.result, tokens: planted, contrastReport } });
}

/** This build's registry with fixture-seed, with `edit` applied to each design language's tokens, and `aliases` retired. */
function withLanguages(
  edit: (id: string, tokens: Record<string, string>) => Record<string, string>,
  aliases: readonly { readonly id: string; readonly aliasOf: string }[] = [],
): AppearanceRegistry {
  const base = withFixtureSeed();
  const packs = PACKS.map((pack) =>
    pack.kind === 'design-language'
      ? {
          ...pack,
          manifest: {
            ...pack.manifest,
            tokens: edit(pack.manifest.id, pack.manifest.tokens as Record<string, string>),
          },
        }
      : pack,
  );
  const fixture = [...base.packs.colorScheme.values()].find(
    ({ manifest }) => manifest.id === 'fixture-seed',
  )!;
  return createAppearanceRegistry({
    VARIANTS,
    PACKS: [
      ...packs.filter(({ manifest }) => manifest.id !== 'fixture-seed'),
      {
        kind: 'color-scheme',
        manifest: fixture.manifest,
        packageName: '@portfolio/appearance-fixtures-schemes',
        version: '1.0.0',
        fixture: true,
      },
    ] as typeof PACKS,
    PACK_ALIASES: aliases.map(({ id, aliasOf }) => ({
      kind: 'design-language' as const,
      id,
      aliasOf,
      packageName: '@portfolio/appearance-languages',
      change: null,
    })),
  });
}

test("a save refuses a generated scheme for a wash only when a language the site renders with lays it: material-3-inspired's, chosen or offered, never platform-neutral's alone (LANG-5c r2b)", () => {
  const generators = schemeGenerators(withFixtureSeed(), washedOut());
  const declared = generators.declared('brand-seed')!;
  const input = { seedColor: '#5b5bd6' };
  const run = (designLanguage: string | null, languageSelectable: boolean) =>
    generators.run(declared, input, { designLanguage, languageSelectable });
  // Washed: refused, whether the site names material-3-inspired or offers it to visitors.
  const own = run('material-3-inspired', false);
  assert.equal(own.ok, false);
  assert.match(own.ok ? '' : own.problem, /this site renders with\. Under material-3-inspired's/);
  const offered = run('platform-neutral', true);
  assert.equal(offered.ok, false);
  // Unwashed and locked: the same scheme, whose own report fails on the wash pair, is stored.
  const plain = run('platform-neutral', false);
  assert.ok(plain.ok, plain.ok ? '' : plain.problem);
  // A site naming no language, or one this build doesn't have, renders the fallback, unwashed.
  assert.equal(run(null, false).ok, true);
  assert.equal(run('no-such-language', false).ok, true);
  // Without a site, every language this build has counts.
  assert.equal(generators.run(declared, input).ok, false);
  // fixture-seed reports at the neutral reading alone, so no wash refuses it.
  assert.equal(
    schemeGenerators(withFixtureSeed()).run(
      { id: 'fixture-seed', version: 1, input: 'seed-color' },
      { seedColor: '#3366ff' },
      { designLanguage: 'material-3-inspired', languageSelectable: true },
    ).ok,
    true,
  );
});

test('a wash refusal names the language, its wash, the role, the ground, and both ratios in plain words (LANG-5c r2b)', () => {
  const generators = schemeGenerators(withFixtureSeed(), washedOut());
  const run = generators.run(
    generators.declared('brand-seed')!,
    { seedColor: '#5b5bd6' },
    { designLanguage: 'material-3-inspired', languageSelectable: false },
  );
  assert.equal(run.ok, false);
  assert.equal(
    run.ok ? '' : run.problem,
    "brand-seed made a scheme that doesn't read under a design language this site renders with. Under material-3-inspired's 4% accent wash, text-muted on surface-prominent in dark is 4.41:1, under 4.5:1, so it isn't stored.",
  );
  assert.equal(
    run.ok ? '' : run.remediation,
    'Pick another seed color, then save the draft, or select another color scheme or design language.',
  );
  // A language visitors may choose, not the site's own: locking the control is what helps.
  const offered = generators.run(
    generators.declared('brand-seed')!,
    { seedColor: '#5b5bd6' },
    { designLanguage: 'platform-neutral', languageSelectable: true },
  );
  assert.equal(
    offered.ok ? '' : offered.problem,
    "brand-seed made a scheme that doesn't read under a design language this site's visitors may choose. Under material-3-inspired's 4% accent wash, text-muted on surface-prominent in dark is 4.41:1, under 4.5:1, so it isn't stored.",
  );
  assert.equal(
    offered.ok ? '' : offered.remediation,
    "Pick another seed color, then save the draft, or select another color scheme, or lock the design language so visitors can't choose material-3-inspired.",
  );
});

test("the save reads a retired language's survivor, the fallback a site renders without one, and a language the gate can't read as laying every shipping wash (LANG-5c r2b)", () => {
  const M3 = (
    PACKS.find(
      ({ kind, manifest }) => kind === 'design-language' && manifest.id === 'material-3-inspired',
    )!.manifest as unknown as { tokens: Record<string, string> }
  ).tokens;
  const input = { seedColor: '#5b5bd6' };
  const run = (registry: AppearanceRegistry, designLanguage: string | null) => {
    const generators = schemeGenerators(registry, washedOut());
    return generators.run(generators.declared('brand-seed')!, input, {
      designLanguage,
      languageSelectable: false,
    }).ok;
  };
  // A retired id renders its survivor, whose wash counts.
  assert.equal(
    run(
      withLanguages(
        (_, tokens) => tokens,
        [{ id: 'retired-tint', aliasOf: 'material-3-inspired' }],
      ),
      'retired-tint',
    ),
    false,
  );
  // With the fallback washing, a site that names none, or one this build lacks, is refused.
  const washedFallback = withLanguages((id, tokens) =>
    id === 'platform-neutral' ? { ...tokens, texture: M3.texture! } : tokens,
  );
  assert.equal(run(washedFallback, null), false);
  assert.equal(run(washedFallback, 'no-such-language'), false);
  // An unreadable texture fails closed.
  const unreadable = withLanguages((id, tokens) =>
    id === 'platform-neutral' ? { ...tokens, texture: 'url(grain.png)' } : tokens,
  );
  assert.equal(run(unreadable, 'platform-neutral'), false);
  // The site's own language is read first, so a refusal names it ahead of one earlier in the build.
  const two = schemeGenerators(
    withLanguages((id, tokens) =>
      id === 'bauhaus-geometric' ? { ...tokens, texture: M3.texture! } : tokens,
    ),
    washedOut(),
  );
  const both = two.run(two.declared('brand-seed')!, input, {
    designLanguage: 'material-3-inspired',
    languageSelectable: true,
  });
  assert.match(
    both.ok ? '' : both.problem,
    /a design language this site renders with\. Under material-3-inspired's 4% accent wash/,
  );
  // And the build's own platform-neutral stores it.
  assert.equal(run(withFixtureSeed(), 'platform-neutral'), true);
});

test("every generator scheme's committed record pins the version its manifest declares, still 1, and a saved draft's entry from it renders (LANG-5c r2b)", () => {
  const registry = withFixtureSeed();
  const read = (file: string) =>
    JSON.parse(
      readFileSync(
        fileURLToPath(new URL(`../../../../packages/appearance-schemes/${file}`, import.meta.url)),
        'utf8',
      ),
    );
  for (const id of ['brand-seed', 'hct-tonal', 'portfolio-artwork', 'profile-image']) {
    const record = read(`generated/${id}.json`);
    const manifest = read(`packs/${id}/manifest.json`);
    assert.deepEqual(record.result.generator, { id, version: 1 }, id);
    assert.equal(manifest.generator.version, 1, id);
    // A registered one renders a saved draft's entry that pins it; an unaccepted image one isn't registered.
    if (!findPack(registry, 'colorScheme', id)) continue;
    const entry = {
      generator: record.result.generator,
      inputsHash: 'd'.repeat(64),
      tokens: record.result.tokens,
    };
    assert.deepEqual(Object.keys(storedSchemes({ [id]: entry }, registry)), [id], id);
  }
});
