import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  // Shared code, a pack this build doesn't register, and a lookalike directory map to nothing here.
  assert.deepEqual(
    map(
      'packages/kit/src/index.ts',
      'packages/appearance/src/resolve.ts',
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

test("a git base's changes are from the merge base, and a rename counts as both its paths", () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'quality-changes-git-'));
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=Quality Test', '-c', 'user.email=quality@example.test', ...args],
      { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), text);
  };
  try {
    git('init', '-q', '-b', 'base');
    write('packages/fallback-composition/src/moved.ts', 'export const moved = 1;\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    git('switch', '-q', '-c', 'branch');
    // A file moved out of the variant, whole, which git would read as a rename.
    mkdirSync(path.join(repo, 'packages', 'kit', 'src'), { recursive: true });
    git('mv', 'packages/fallback-composition/src/moved.ts', 'packages/kit/src/moved.ts');
    git('commit', '-q', '-m', 'move');
    // The base moves on: a three-dot diff from the merge base leaves its change out.
    git('switch', '-q', 'base');
    write('packages/appearance-languages/package.json', '{}\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'base moves on');
    git('switch', '-q', 'branch');

    const changed = changedFiles({ QUALITY_CHANGED_BASE: 'base' }, repo);
    assert.deepEqual(changed, {
      source: 'git diff base...HEAD',
      files: ['packages/fallback-composition/src/moved.ts', 'packages/kit/src/moved.ts'],
    });
    // The old path still directs the variant it left.
    assert.deepEqual(
      mapChanges(changed!.files, checkoutMeta()).map(({ axis, id }) => `${axis} ${id}`),
      ['variant fallback'],
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
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

test('the [37] pairs: a changed variant with each stable language, a changed pack on any axis with each variant (#20)', () => {
  const targets = { variants: ['a', 'b'], languages: ['x', 'y'] };
  assert.deepEqual(
    changePairs(
      [
        { axis: 'variant', id: 'a' },
        { axis: 'designLanguage', id: 'z' },
        { axis: 'colorScheme', id: 'q' },
        { axis: 'typography', id: 'r' },
      ],
      targets,
    ).map(({ variant, axis, pack, by }) => `${variant}/${axis}:${pack} by ${by.id}`),
    [
      'a/designLanguage:x by a',
      'a/designLanguage:y by a',
      'a/designLanguage:z by z',
      'b/designLanguage:z by z',
      'a/colorScheme:q by q',
      'b/colorScheme:q by q',
      'a/typography:r by r',
      'b/typography:r by r',
    ],
  );
  // A variant's pair names the language it meets.
  assert.deepEqual(changePairs([{ axis: 'variant', id: 'a' }], targets)[1]!.by, {
    axis: 'variant',
    id: 'a',
    pack: { axis: 'designLanguage', id: 'y' },
  });
});

test('a changed scheme or profile maps to its pack, and a Research record to nothing (#20)', () => {
  const meta = checkoutMeta();
  const map = (...files: string[]) =>
    mapChanges(files, meta).map(({ axis, id }) => `${axis} ${id}`);
  assert.deepEqual(map('packages/appearance-schemes/packs/warm-parchment/manifest.json'), [
    'colorScheme warm-parchment',
  ]);
  assert.deepEqual(map('packages/appearance-typography/package.json'), ['typography humanist-ui']);
  assert.deepEqual(map('packages/appearance-schemes/research/nord.json'), []);
  // Variants first, then the pack axes in axis order.
  assert.deepEqual(
    map(
      'packages/appearance-typography/packs/humanist-ui/manifest.json',
      'packages/appearance-schemes/packs/warm-parchment/manifest.json',
      'packages/appearance-languages/packs/platform-neutral/manifest.json',
      'packages/fallback-composition/src/a.ts',
    ),
    [
      'variant fallback',
      'designLanguage platform-neutral',
      'colorScheme warm-parchment',
      'typography humanist-ui',
    ],
  );
});

/**
 * Every composition the plan meets, as the registry lists it: the
 * checkout's variants, less the fixture ones, and what the test adds. Read
 * from the registry, so a variant `next` brings in doesn't change a count.
 */
const registeredVariants = (meta: BuildMeta) =>
  meta.VARIANTS.map(({ manifest }) => manifest.id)
    .filter((id) => !id.startsWith('fixture-'))
    .sort();

test('a PR that changes a scheme runs it against every variant, and a changed variant meets only the stable languages (#20)', () => {
  const meta = wider(checkoutMeta());
  const plan = (changes: Parameters<typeof planCells>[0]['changes']) =>
    planCells({ meta, registrations, mode: 'pr', changes });
  const scheme = plan([{ axis: 'colorScheme', id: 'warm-parchment', paths: [] }]);
  const byScheme = scheme.cells.filter((cell) =>
    cell.changed?.some((by) => by.axis === 'colorScheme'),
  );
  assert.deepEqual(byScheme.map((cell) => cell.target).sort(), registeredVariants(meta));
  for (const cell of byScheme) assert.equal(cell.tuple.colorScheme, 'warm-parchment');
  assert.deepEqual(changeFields(byScheme[0]!), { axis: 'colorScheme', pack: 'warm-parchment' });

  const variant = plan([{ axis: 'variant', id: 'fallback', paths: [] }]);
  const met = variant.cells
    .filter((cell) => cell.changed)
    .flatMap((cell) => cell.changed!.map((by) => `${by.pack?.axis}:${by.pack?.id}`))
    .sort();
  // One cell per stable shipping language: no scheme or profile pairs, no
  // extended tier, no fixture pack.
  assert.deepEqual(met, ['designLanguage:platform-neutral', 'designLanguage:second-language']);
  assert.equal(byScheme.length, registeredVariants(meta).length);
  // A changed profile runs against every variant too.
  const profile = plan([{ axis: 'typography', id: 'humanist-ui', paths: [] }]);
  assert.equal(
    profile.cells.filter((cell) => cell.changed).length,
    registeredVariants(meta).length,
  );
});

test('a PR that changes a variant runs it against every stable language, and one that changes a language against every variant', () => {
  const meta = wider(checkoutMeta());
  const plan = (changes: Parameters<typeof planCells>[0]['changes']) =>
    planCells({ meta, registrations, mode: 'pr', changes });
  const none = plan([]);
  assert.ok(!none.cells.some((cell) => cell.changed), 'nothing changed, nothing directed');

  const variant = plan([{ axis: 'variant', id: 'fallback', paths: ['packages/x'] }]);
  const directed = variant.cells.filter((cell) => cell.changed);
  // One cell per stable shipping language: not the extended one, nor the stable fixture pack.
  assert.equal(directed.length, 2);
  assert.deepEqual(directed.map((cell) => cell.tuple.designLanguage).sort(), [
    'platform-neutral',
    'second-language',
  ]);
  // Each on the default scheme and typography.
  for (const cell of directed) {
    assert.equal(cell.tuple.colorScheme, 'warm-parchment');
    assert.equal(cell.tuple.typography, 'humanist-ui');
  }
  for (const cell of directed) {
    assert.equal(cell.target, 'fallback');
    assert.equal(cell.state, 'complete');
    assert.equal(cell.path, '/');
    assert.ok(
      cell.changed!.every((by) => by.axis === 'variant' && by.id === 'fallback' && by.pack),
    );
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
  assert.deepEqual(byLanguage.map((cell) => cell.target).sort(), registeredVariants(meta));
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
