import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { MetaPack } from '../../packages/appearance/src/index';
import { changePairs, planCells, readBuildMeta, type BuildMeta } from './cells';
import { tupleKey } from './coverage';
import { changedFiles, mapChanges, readChanges } from './lib/changes';
import { PREFERENCE_ROWS, VIEWPORTS } from './lib/matrix';
import { loadRegistrations, type Registrations } from './lib/registration';
import { changeDiagnostic, changeFields } from './lib/records';

// The owner's [37] change-directed rule (#11, 11-4): a changed variant runs
// against every stable design language, a changed language against every
// stable variant, and their failures name the axis with the tokens it
// resolved.

const WEB = fileURLToPath(new URL('../../apps/web/', import.meta.url));

function checkoutMeta(): BuildMeta {
  const file = path.join(WEB, 'src', 'lib', 'generated', 'registry.meta.ts');
  assert.ok(existsSync(file), 'run pnpm --filter @portfolio/web build:registry first');
  return readBuildMeta(WEB);
}

/** A pack like the checkout's first of `kind`, renamed `id`, in `tier`. */
function packLike(meta: BuildMeta, kind: string, id: string, tier: string, fixture = false) {
  const base = (meta.PACKS ?? []).find((pack) => pack.kind === kind && !pack.fixture)!;
  return { ...base, fixture, manifest: { ...base.manifest, id, name: id, tier } } as MetaPack;
}

/**
 * The checkout's metadata with a second stable language, an extended one,
 * a stable fixture language, and a second variant, so "every stable" has
 * more than one of each to mean.
 */
function wider(meta: BuildMeta): BuildMeta {
  const [variant] = meta.VARIANTS;
  return {
    ...meta,
    VARIANTS: [
      ...meta.VARIANTS,
      { ...variant!, manifest: { ...variant!.manifest, id: 'second-variant' } },
    ] as BuildMeta['VARIANTS'],
    PACKS: [
      ...(meta.PACKS ?? []),
      packLike(meta, 'design-language', 'second-language', 'stable'),
      packLike(meta, 'design-language', 'extended-language', 'extended'),
      packLike(meta, 'design-language', 'fixture-language-stable', 'stable', true),
    ],
  };
}

let registrations: Registrations;
test.before(async () => {
  registrations = await loadRegistrations();
});

test("a changed path maps to its variant's package, its language's pack, or its pack package's every language", () => {
  const meta = checkoutMeta();
  const map = (...files: string[]) =>
    mapChanges(files, meta).map(({ axis, id, paths }) => `${axis} ${id} ${paths.join(',')}`);
  assert.deepEqual(map('packages/fallback-composition/src/composition.tsx'), [
    'variant fallback packages/fallback-composition/src/composition.tsx',
  ]);
  assert.deepEqual(map('packages/appearance-languages/packs/platform-neutral/manifest.json'), [
    'designLanguage platform-neutral packages/appearance-languages/packs/platform-neutral/manifest.json',
  ]);
  assert.deepEqual(map('packages/appearance-languages/package.json'), [
    'designLanguage platform-neutral packages/appearance-languages/package.json',
  ]);
  // Shared code, a scheme, a pack this build doesn't register, and a lookalike directory map to nothing here.
  assert.deepEqual(
    map(
      'packages/kit/src/index.ts',
      'packages/appearance/src/resolve.ts',
      'packages/appearance-schemes/packs/warm-parchment/manifest.json',
      'packages/appearance-languages/packs/not-registered/manifest.json',
      'packages/fallback-composition-notes.md',
      'docs/variants.md',
    ),
    [],
  );
  // Variants first, then languages, each with every path that changed it.
  assert.deepEqual(
    map(
      'packages/appearance-languages/packs/platform-neutral/tokens.json',
      'packages/fallback-composition/src/a.ts',
      'packages/fallback-composition/src/b.ts',
    ),
    [
      'variant fallback packages/fallback-composition/src/a.ts,packages/fallback-composition/src/b.ts',
      'designLanguage platform-neutral packages/appearance-languages/packs/platform-neutral/tokens.json',
    ],
  );
});

test('the changed paths come from QUALITY_CHANGED_FILES, else a git base, else none, and a base git cannot read fails', () => {
  assert.equal(changedFiles({}), null);
  assert.deepEqual(changedFiles({ QUALITY_CHANGED_FILES: '["a/b.ts"]' }), {
    source: 'QUALITY_CHANGED_FILES',
    files: ['a/b.ts'],
  });
  for (const bad of ['{"a":1}', 'not json', '[1]']) {
    assert.throws(() => changedFiles({ QUALITY_CHANGED_FILES: bad }), /JSON array of paths/);
  }
  assert.deepEqual(changedFiles({ QUALITY_CHANGED_BASE: 'HEAD' })?.files, []);
  assert.throws(
    () => changedFiles({ QUALITY_CHANGED_BASE: 'refs/heads/no-such-base-for-quality' }),
    /QUALITY_CHANGED_BASE is refs\/heads\/no-such-base-for-quality, and git can't diff it against HEAD/,
  );
  const set = readChanges(checkoutMeta(), {
    QUALITY_CHANGED_FILES: JSON.stringify(['packages/fallback-composition/src/x.ts']),
  });
  assert.deepEqual(
    set.changes.map(({ axis, id }) => `${axis} ${id}`),
    ['variant fallback'],
  );
});

test('the [37] pairs: a changed variant with each stable language, a changed language with each stable variant', () => {
  const stable = { variants: ['a', 'b'], designLanguages: ['x', 'y'] };
  assert.deepEqual(
    changePairs(
      [
        { axis: 'variant', id: 'a' },
        { axis: 'designLanguage', id: 'z' },
      ],
      stable,
    ).map(({ variant, designLanguage, by }) => `${variant}/${designLanguage} by ${by.id}`),
    ['a/x by a', 'a/y by a', 'a/z by z', 'b/z by z'],
  );
});

test('a PR that changes a variant runs it against every stable language, and one that changes a language against every stable variant', () => {
  const meta = wider(checkoutMeta());
  const plan = (changes: Parameters<typeof planCells>[0]['changes']) =>
    planCells({ meta, registrations, mode: 'pr', changes });
  const none = plan([]);
  assert.ok(!none.cells.some((cell) => cell.changed), 'nothing changed, nothing directed');

  const variant = plan([{ axis: 'variant', id: 'fallback', paths: ['packages/x'] }]);
  const directed = variant.cells.filter((cell) => cell.changed);
  // The shipping stable languages, not the extended one or the stable fixture pack.
  assert.deepEqual(directed.map((cell) => cell.tuple.designLanguage).sort(), [
    'platform-neutral',
    'second-language',
  ]);
  for (const cell of directed) {
    assert.equal(cell.target, 'fallback');
    assert.equal(cell.state, 'complete');
    assert.equal(cell.path, '/');
    assert.deepEqual(cell.changed, [{ axis: 'variant', id: 'fallback' }]);
    // Every viewport in the default row, and every row at the first viewport.
    const tests = variant.tests.filter((each) => each.cell === cell);
    assert.deepEqual(
      tests.filter((each) => each.row.id === 'default').map((each) => each.viewport.id),
      VIEWPORTS.map((each) => each.id),
    );
    assert.deepEqual(
      tests.filter((each) => each.viewport === VIEWPORTS[0]).map((each) => each.row.id),
      PREFERENCE_ROWS.map((row) => row.id),
    );
  }
  // The platform default's pair is the sentinel already, and keeps being one.
  assert.ok(directed.find((cell) => cell.tuple.designLanguage === 'platform-neutral')!.sentinel);
  assert.deepEqual(variant.changes, [{ axis: 'variant', id: 'fallback', paths: ['packages/x'] }]);

  const language = plan([{ axis: 'designLanguage', id: 'extended-language', paths: [] }]);
  const byLanguage = language.cells.filter((cell) => cell.changed);
  assert.deepEqual(byLanguage.map((cell) => cell.target).sort(), ['fallback', 'second-variant']);
  for (const cell of byLanguage) {
    assert.equal(cell.tuple.designLanguage, 'extended-language');
    assert.deepEqual(cell.changed, [{ axis: 'designLanguage', id: 'extended-language' }]);
    assert.ok(!cell.sentinel);
  }

  // A change to something this build doesn't register directs nothing.
  assert.ok(
    !plan([{ axis: 'designLanguage', id: 'not-registered', paths: [] }]).cells.some(
      (cell) => cell.changed,
    ),
  );
});

test('the full plan holds every pair a PR could direct', () => {
  const meta = wider(checkoutMeta());
  const full = planCells({ meta, registrations, mode: 'full' });
  const keys = new Set(full.cells.map((cell) => tupleKey(cell.tuple)));
  for (const changes of [
    [{ axis: 'variant' as const, id: 'fallback', paths: [] }],
    [{ axis: 'variant' as const, id: 'second-variant', paths: [] }],
    [{ axis: 'designLanguage' as const, id: 'second-language', paths: [] }],
    [{ axis: 'designLanguage' as const, id: 'extended-language', paths: [] }],
  ]) {
    const pr = planCells({ meta, registrations, mode: 'pr', changes });
    for (const cell of pr.cells.filter((each) => each.changed)) {
      assert.ok(keys.has(tupleKey(cell.tuple)), tupleKey(cell.tuple));
    }
  }
  assert.ok(full.changes.some((change) => change.id === 'extended-language'));
});

test("a change-directed cell's failures name the axis, and its diagnostic the tokens each page resolved", () => {
  const meta = wider(checkoutMeta());
  const plan = planCells({
    meta,
    registrations,
    mode: 'pr',
    changes: [{ axis: 'designLanguage', id: 'second-language', paths: [] }],
  });
  const cell = plan.cells.find((each) => each.changed)!;
  assert.deepEqual(changeFields(cell), { axis: 'designLanguage', pack: 'second-language' });
  assert.deepEqual(changeFields({ changed: [{ axis: 'variant', id: 'fallback' }] }), {
    axis: 'variant',
  });
  assert.deepEqual(changeFields({}), {});

  const tokens = {
    boundaries: [
      {
        kind: 'site',
        attributes: { 'data-design-language': 'second-language' },
        tokens: Object.fromEntries(
          Array.from({ length: 8 }, (_, index) => [`--token-${index}`, `#00000${index}`]),
        ),
      },
    ],
  };
  const text = changeDiagnostic(cell, [
    { route: '/', tokens: { boundaries: [] }, file: 'results/a/resolved-tokens.json' },
    { route: '/_fixtures/appearance', tokens, file: 'results/a/primitives-resolved-tokens.json' },
  ])!;
  assert.match(text, /the designLanguage second-language changed/);
  assert.match(text, /fallback\/second-language\/warm-parchment\/humanist-ui\/system/);
  assert.match(text, /\/ rendered no presentation boundary \(results\/a\/resolved-tokens\.json\)/);
  assert.match(text, /data-design-language=second-language\) resolved 8 token\(s\)/);
  assert.match(text, /--token-0: #000000.*and 2 more/);
  assert.match(text, /primitives-resolved-tokens\.json/);
  assert.equal(changeDiagnostic({ ...cell, changed: undefined }, []), null);
});
