import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { MetaPack } from '../../packages/appearance/src/index';
import { changePairs, planCells, readBuildMeta, type BuildMeta } from './cells';
import { tupleKey } from './coverage';
import {
  changedFiles,
  keysButVersion,
  mapChanges,
  METADATA_KEYS,
  readChanges,
  renderedKeys,
} from './lib/changes';
import { PREFERENCE_ROWS, VIEWPORTS } from './lib/matrix';
import { loadRegistrations, type Registrations } from './lib/registration';
import { changeDiagnostic, changeFields } from './lib/records';
import { fallbackPacks } from './plan-fixtures';
import { chooseBase, FIRST_PARENT, gitIn, planBase, stepFiles } from '../../ci/quality-base.mjs';

// The owner's [37] change-directed rule (#11, 11-4): a changed variant runs
// against every stable design language, a changed language against every
// stable variant, and their failures name the axis with the tokens it
// resolved.

const WEB = fileURLToPath(new URL('../../apps/web/', import.meta.url));

// Every git this file spawns, its fixtures' and the code's under test, runs in a temp repo of its
// own with a clean environment: no GIT_* variable from the caller (a hook's GIT_DIR or
// GIT_INDEX_FILE would point a fixture's git init or add at the checkout's own .git), and no
// system or global config (whose hooks path or settings a fixture repo must not take).
/** `env` with every GIT_* variable taken out, in place, and only the two config ones set. */
export function stripGitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  for (const name of Object.keys(env)) if (name.startsWith('GIT_')) delete env[name];
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  return env;
}
stripGitEnv(process.env);

/** git, the user named, in `cwd`, under this file's clean environment, its output trimmed. */
const gitAt =
  (cwd: string) =>
  (...args: string[]): string =>
    execFileSync(
      'git',
      ['-c', 'user.name=Quality Test', '-c', 'user.email=quality@example.test', ...args],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();

/** A temp repo with one commit, for a read that needs a git base and no history. */
function oneCommitRepo(): string {
  const repo = mkdtempSync(path.join(tmpdir(), 'quality-changes-one-'));
  const git = gitAt(repo);
  git('init', '-q', '-b', 'main');
  writeFileSync(path.join(repo, 'README.md'), 'one\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'one');
  return repo;
}

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
  // A package file maps to every language the package ships.
  assert.deepEqual(
    map('packages/appearance-languages/package.json'),
    (meta.PACKS ?? [])
      .filter((pack) => pack.kind === 'design-language' && !pack.fixture)
      .map(
        (pack) => `designLanguage ${pack.manifest.id} packages/appearance-languages/package.json`,
      )
      .sort(),
  );
  // A held pack (#20) never registers, so it maps to nothing.
  assert.deepEqual(map('packages/appearance-languages/held/glassmorphism/manifest.json'), []);
  // Nor does a retired one (LANG-1): its record is an alias, which renders no pack of its own.
  assert.deepEqual(map('packages/appearance-languages/retired/ant-inspired/retired.json'), []);
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

test("a pack manifest whose change is metadata alone directs nothing, and any other key's change still does (#20)", () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'quality-changes-metadata-'));
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=Quality Test', '-c', 'user.email=quality@example.test', ...args],
      { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  const write = (file: string, value: unknown) => {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), typeof value === 'string' ? value : JSON.stringify(value));
  };
  const scheme = (extra: Record<string, unknown>) => ({
    id: 'a-scheme',
    tier: 'stable',
    budgets: { css: 3072, js: 0 },
    anchors: { light: { accent: '#aa3300' } },
    ...extra,
  });
  const files = {
    metadata: 'packages/appearance-schemes/packs/metadata/manifest.json',
    reordered: 'packages/appearance-schemes/packs/reordered/manifest.json',
    anchors: 'packages/appearance-schemes/packs/anchors/manifest.json',
    tier: 'packages/appearance-schemes/packs/tier/manifest.json',
    fresh: 'packages/appearance-schemes/packs/fresh/manifest.json',
    broken: 'packages/appearance-schemes/packs/broken/manifest.json',
    unreadable: 'packages/appearance-schemes/packs/unreadable/manifest.json',
    css: 'packages/appearance-languages/packs/lang/language.css',
  };
  try {
    git('init', '-q', '-b', 'base');
    write(files.metadata, scheme({ name: 'Old' }));
    write(files.reordered, scheme({}));
    write(files.anchors, scheme({}));
    write(files.tier, scheme({}));
    write(files.broken, scheme({}));
    write(files.unreadable, '{ not json');
    write(files.css, '.a{}');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    git('switch', '-q', '-c', 'branch');
    // Every metadata key changes at once, and nothing else.
    write(
      files.metadata,
      scheme(Object.fromEntries([...METADATA_KEYS].map((key) => [key, `new ${key}`]))),
    );
    // The same keys in another order, and budgets' keys reordered too.
    write(files.reordered, {
      anchors: { light: { accent: '#aa3300' } },
      budgets: { js: 0, css: 3072 },
      tier: 'stable',
      id: 'a-scheme',
    });
    write(files.anchors, scheme({ anchors: { light: { accent: '#aa3301' } } }));
    write(files.tier, scheme({ tier: 'extended' }));
    write(files.fresh, scheme({}));
    write(files.broken, '{ not json');
    // Unreadable on both sides is never taken for metadata alone.
    write(files.unreadable, '{ still not json');
    write(files.css, '.a{color:red}');
    git('add', '-A');
    git('commit', '-q', '-m', 'branch');

    const changed = changedFiles({ QUALITY_CHANGED_BASE: 'base' }, repo);
    assert.deepEqual(
      [...changed!.files].sort(),
      [files.anchors, files.broken, files.css, files.fresh, files.tier, files.unreadable].sort(),
    );
    assert.equal(
      changed!.source,
      'git diff base...HEAD, less 2 manifest(s) whose change is metadata alone',
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
  // The keys that stay are the ones the cells and the registry read.
  for (const key of [
    'id',
    'tier',
    'budgets',
    'anchors',
    'derivation',
    'tokens',
    'stylesheet',
    'lockedMode',
    'tokenContract',
  ]) {
    assert.equal(METADATA_KEYS.has(key), false, key);
  }
  assert.equal(renderedKeys('[]'), null);
  assert.equal(renderedKeys('{"name":"a","id":"x"}'), renderedKeys('{"id":"x","name":"b"}'));
});

test("a workspace package.json whose change is the version alone directs nothing, and any other key's change still does (#12, v1.0.0)", () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'quality-changes-version-'));
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=Quality Test', '-c', 'user.email=quality@example.test', ...args],
      { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  const write = (file: string, value: unknown) => {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), typeof value === 'string' ? value : JSON.stringify(value));
  };
  const pkg = (extra: Record<string, unknown>) => ({
    name: '@portfolio/a',
    version: '0.1.0',
    exports: { '.': './src/index.ts' },
    dependencies: { '@portfolio/kit': 'workspace:*' },
    ...extra,
  });
  const files = {
    version: 'packages/appearance-languages/package.json',
    nested: 'packages/budget-fixtures/one/package.json',
    dependency: 'packages/variant-a/package.json',
    exports: 'packages/appearance-schemes/package.json',
    outside: 'apps/web/package.json',
    broken: 'packages/broken/package.json',
  };
  try {
    git('init', '-q', '-b', 'base');
    for (const file of Object.values(files)) write(file, pkg({}));
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    git('switch', '-q', '-c', 'branch');
    write(files.version, pkg({ version: '1.0.0' }));
    write(files.nested, pkg({ version: '1.0.0' }));
    write(
      files.dependency,
      pkg({ version: '1.0.0', dependencies: { '@portfolio/kit': '^1.0.0' } }),
    );
    write(files.exports, pkg({ version: '1.0.0', exports: { '.': './src/other.ts' } }));
    // A package.json outside packages/ isn't a pack's or a variant's package, and stays as it was.
    write(files.outside, pkg({ version: '1.0.0' }));
    write(files.broken, '{ not json');
    git('add', '-A');
    git('commit', '-q', '-m', 'branch');

    const changed = changedFiles({ QUALITY_CHANGED_BASE: 'base' }, repo);
    assert.deepEqual(
      [...changed!.files].sort(),
      [files.broken, files.dependency, files.exports, files.outside].sort(),
    );
    assert.equal(
      changed!.source,
      'git diff base...HEAD, less 2 package.json(s) whose change is the version alone',
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
  assert.equal(keysButVersion('[]'), null);
  assert.equal(
    keysButVersion('{"version":"0.1.0","a":1}'),
    keysButVersion('{"a":1,"version":"1.0.0"}'),
  );
  assert.notEqual(keysButVersion('{"version":"1","a":1}'), keysButVersion('{"version":"1","a":2}'));
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
  // A git base read in a fixture repo of its own, never the checkout.
  const repo = oneCommitRepo();
  try {
    assert.deepEqual(changedFiles({ QUALITY_CHANGED_BASE: 'HEAD' }, repo)?.files, []);
    assert.throws(
      () => changedFiles({ QUALITY_CHANGED_BASE: 'refs/heads/no-such-base-for-quality' }, repo),
      /QUALITY_CHANGED_BASE is refs\/heads\/no-such-base-for-quality, and git can't diff it against HEAD/,
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
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
  // A package file maps to every pack the package holds.
  assert.deepEqual(
    map('packages/appearance-typography/package.json'),
    (meta.PACKS ?? [])
      .filter((pack) => pack.kind === 'typography' && !pack.fixture)
      .map((pack) => `typography ${pack.manifest.id}`)
      .sort(),
  );
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
  const meta = wider(fallbackPacks(checkoutMeta()));
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
  const meta = wider(fallbackPacks(checkoutMeta()));
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
  const meta = wider(fallbackPacks(checkoutMeta()));
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
  const meta = wider(fallbackPacks(checkoutMeta()));
  const plan = planCells({
    meta,
    registrations,
    mode: 'pr',
    changes: [{ axis: 'designLanguage', id: 'second-language', paths: [] }],
  });
  // The platform default's cell, as the record's text names it, whichever composition sorts first.
  const cell = plan.cells.find((each) => each.changed && each.target === 'editorial-evidence')!;
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
  // The first composition, the platform default (#13), is the one it runs.
  assert.match(text, /editorial-evidence\/second-language\/warm-parchment\/humanist-ui\/system/);
  assert.match(text, /\/ rendered no presentation boundary \(results\/a\/resolved-tokens\.json\)/);
  assert.match(text, /data-design-language=second-language\) resolved 8 token\(s\)/);
  assert.match(text, /--token-0: #000000.*and 2 more/);
  assert.match(text, /primitives-resolved-tokens\.json/);
  assert.equal(changeDiagnostic({ ...cell, changed: undefined }, []), null);
});

// Push CI's base (ci/quality-base.mjs): on a push, the branch's tip before it, fetched alone into
// the two-commit checkout and diffed tree to tree, so every commit the push brings directs its
// cells; HEAD^1 for a pull request, a new branch, or a before that can't be fetched.

const QUALITY_BASE = fileURLToPath(new URL('../../ci/quality-base.mjs', import.meta.url));
interface WorkflowStep {
  readonly id?: string;
  readonly run?: string;
  readonly env?: Record<string, string>;
}
const WORKFLOW = parse(
  readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'),
) as { jobs: Record<string, { steps: readonly WorkflowStep[] }> };
const PACK = 'packages/appearance-schemes/packs/arctic-aurora/manifest.json';
const PACK_TEXT = readFileSync(new URL(`../../${PACK}`, import.meta.url), 'utf8');

/**
 * A remote whose history is a seed, `before` (the branch's tip before the push), a composition
 * change and a docs-only head, in a temp root of its own. With `filters`, before also holds the
 * variant's package.json and a real pack manifest, and the composition commit changes the version
 * alone and the manifest's name alone. With `amend`, origin's tip is then amended with its tree
 * kept, and `before` is the tip before the amend.
 */
function pushRepos({ filters = false, amend = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'quality-push-base-'));
  const origin = path.join(root, 'origin');
  mkdirSync(origin);
  const git = gitAt(origin);
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(origin, file)), { recursive: true });
    writeFileSync(path.join(origin, file), text);
  };
  git('init', '-q', '-b', 'main');
  // GitHub serves any commit by its id; a local remote does once it's allowed to.
  git('config', 'uploadpack.allowAnySHA1InWant', 'true');
  // A seed under before, so a two-deep clone is cut short of it, as CI's checkout is.
  write('README.md', 'the seed\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'a seed');
  write('docs/guide.md', 'one\n');
  write('packages/fallback-composition/src/x.ts', 'export const x = 1;\n');
  if (filters) {
    write('packages/fallback-composition/package.json', '{"name":"x","version":"1.0.0"}\n');
    write(PACK, PACK_TEXT);
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'before the push');
  let before = git('rev-parse', 'HEAD');
  write('packages/fallback-composition/src/x.ts', 'export const x = 2;\n');
  if (filters) {
    write('packages/fallback-composition/package.json', '{"name":"x","version":"1.0.1"}\n');
    write(PACK, JSON.stringify({ ...JSON.parse(PACK_TEXT), name: 'Arctic Aurora, renamed' }));
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'the push: a composition change');
  write('docs/guide.md', 'two\n');
  git('commit', '-q', '-am', 'the push: docs alone');
  if (amend) {
    before = git('rev-parse', 'HEAD');
    git('commit', '-q', '--amend', '-m', 'the push: docs alone, reworded');
  }
  return { root, origin, before };
}

/** A fresh two-deep clone of `origin` at `root/name`, as CI's checkout is. */
function shallowClone(root: string, origin: string, name: string): string {
  const clone = path.join(root, name);
  execFileSync('git', ['clone', '-q', '--depth', '2', `file://${origin}`, clone], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return clone;
}

/** Whether `sha` is a commit `clone` holds. */
function holds(clone: string, sha: string): boolean {
  try {
    gitAt(clone)('cat-file', '-e', `${sha}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

test("a two-commit push whose last commit is docs alone still directs the first commit's composition, from a before chooseBase fetches", () => {
  const { root, origin, before } = pushRepos();
  try {
    const clone = shallowClone(root, origin, 'plan');
    assert.equal(gitAt(clone)('rev-parse', '--is-shallow-repository'), 'true');
    // HEAD^1, main's base on a push until now, sees the docs alone, and directs nothing.
    const last = changedFiles({ QUALITY_CHANGED_BASE: 'HEAD^1' }, clone);
    assert.deepEqual(last?.files, ['docs/guide.md']);
    assert.deepEqual(mapChanges(last!.files, checkoutMeta()), []);
    // before isn't in the two-deep checkout until chooseBase fetches it.
    assert.equal(holds(clone, before), false, 'before, before chooseBase');
    const chosen = chooseBase({ event: 'push', before }, gitIn(clone));
    assert.equal(holds(clone, before), true, 'before, after chooseBase');
    assert.deepEqual(
      { base: chosen.base, diff: chosen.diff, fallback: chosen.fallback },
      { base: before, diff: 'tree', fallback: false },
      chosen.reason,
    );
    assert.match(
      chosen.reason,
      /^push: github\.event\.before [0-9a-f]{40}, the branch's tip before the push, diffed tree to tree$/,
    );
    // From before there's no merge base in a two-commit checkout: hence the tree diff.
    assert.throws(() => changedFiles({ QUALITY_CHANGED_BASE: before }, clone), /no merge base/);
    const pushed = changedFiles(
      { QUALITY_CHANGED_BASE: chosen.base, QUALITY_CHANGED_DIFF: chosen.diff },
      clone,
    );
    assert.deepEqual(pushed, {
      source: `git diff ${before} HEAD`,
      files: ['docs/guide.md', 'packages/fallback-composition/src/x.ts'],
    });
    assert.deepEqual(
      mapChanges(pushed!.files, checkoutMeta()).map(({ axis, id }) => `${axis} ${id}`),
      ['variant fallback'],
    );
    // A shard, in a fresh clone of its own, fetches the plan's base too.
    const shard = shallowClone(root, origin, 'shard');
    assert.equal(holds(shard, before), false, 'before, before planBase');
    assert.equal(planBase({ base: chosen.base, diff: chosen.diff }, gitIn(shard)).base, before);
    assert.equal(holds(shard, before), true, 'before, after planBase');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('chooseBase and planBase fetch before alone, then confirm it, and chooseBase tries the fetch twice', () => {
  const sha = 'b'.repeat(40);
  const calls: string[][] = [];
  const recording = (...args: string[]) => {
    calls.push(args);
    return '';
  };
  const fetched = [
    ['fetch', '--no-tags', '--depth=1', 'origin', sha],
    ['cat-file', '-e', `${sha}^{commit}`],
  ];
  assert.equal(chooseBase({ event: 'push', before: sha }, recording).base, sha);
  assert.deepEqual(calls, fetched);
  calls.length = 0;
  assert.equal(planBase({ base: sha, diff: 'tree' }, recording).base, sha);
  assert.deepEqual(calls, fetched);
  // A forced push says so, and its base is the same.
  const forced = chooseBase({ event: 'push', before: sha, forced: true }, recording);
  assert.deepEqual({ base: forced.base, diff: forced.diff }, { base: sha, diff: 'tree' });
  assert.equal(
    forced.reason,
    `push (forced): github.event.before ${sha}, the old tip, diffed tree to tree from it`,
  );
  // A first fetch that fails is tried once more, and a second that works takes before.
  calls.length = 0;
  let fails = 1;
  const flaky = (...args: string[]) => {
    calls.push(args);
    if (args[0] === 'fetch' && fails-- > 0) throw new Error('the network blinked');
    return '';
  };
  assert.equal(chooseBase({ event: 'push', before: sha }, flaky).base, sha);
  assert.deepEqual(calls, [fetched[0], ...fetched]);
});

test('a push whose before is all zeros, a new branch, falls back to HEAD^1 and says so', () => {
  const calls: string[][] = [];
  const chosen = chooseBase({ event: 'push', before: '0'.repeat(40) }, (...args: string[]) => {
    calls.push(args);
    return '';
  });
  assert.deepEqual(
    { base: chosen.base, diff: chosen.diff, fallback: chosen.fallback },
    { base: FIRST_PARENT, diff: 'merge-base', fallback: true },
  );
  assert.match(chosen.reason, /all zeros \(a new branch\)/);
  assert.deepEqual(calls, [], 'nothing fetched');
  assert.match(
    stepFiles(chosen).summary,
    /\*\*quality-pr base:\*\* `HEAD\^1` \(merge-base diff\)\. push: /,
  );
});

test("a push whose before can't be fetched falls back to HEAD^1 and says why; a shard refuses the plan's base it can't fetch", () => {
  const { root, origin } = pushRepos();
  try {
    const clone = shallowClone(root, origin, 'plan');
    const missing = 'f'.repeat(40);
    const chosen = chooseBase({ event: 'push', before: missing }, gitIn(clone));
    assert.deepEqual(
      { base: chosen.base, diff: chosen.diff, fallback: chosen.fallback },
      { base: FIRST_PARENT, diff: 'merge-base', fallback: true },
    );
    assert.match(
      chosen.reason,
      new RegExp(
        `github\\.event\\.before ${missing} couldn't be fetched in 2 tries \\(.+\\), so HEAD\\^1`,
      ),
    );
    // And the fallback plans: HEAD^1 is in the two-commit checkout.
    assert.deepEqual(
      changedFiles({ QUALITY_CHANGED_BASE: chosen.base, QUALITY_CHANGED_DIFF: chosen.diff }, clone)
        ?.files,
      ['docs/guide.md'],
    );
    assert.throws(
      () => planBase({ base: missing, diff: 'tree' }, gitIn(clone)),
      /couldn't be fetched here .*so this shard can't plan its set/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the base refuses an empty event and a before that is no commit id, a pull request keeps HEAD^1, and an unknown diff fails the plan', () => {
  const never = () => {
    throw new Error('git ran');
  };
  for (const event of ['', undefined]) {
    assert.throws(
      () => chooseBase({ event, before: 'a'.repeat(40) }, never),
      /EVENT_NAME is empty, so the event is unknown: refusing to choose a base/,
    );
  }
  for (const before of [
    '',
    'HEAD',
    'f'.repeat(39),
    'F'.repeat(40),
    `${'a'.repeat(40)}\n`,
    '$(id)',
    'a'.repeat(41),
  ]) {
    assert.throws(
      () => chooseBase({ event: 'push', before }, never),
      /not a commit's 40 hex digits: refusing it/,
      JSON.stringify(before),
    );
  }
  // A pull request doesn't read before at all, and never fetches.
  for (const event of ['pull_request', 'workflow_dispatch']) {
    const chosen = chooseBase({ event, before: 'anything' }, never);
    assert.deepEqual(
      { base: chosen.base, diff: chosen.diff, fallback: chosen.fallback },
      { base: FIRST_PARENT, diff: 'merge-base', fallback: false },
    );
    assert.match(chosen.reason, /HEAD\^1, the merge commit's first parent/);
  }
  for (const plan of [
    { base: 'HEAD^1', diff: 'tree' },
    { base: 'HEAD', diff: 'merge-base' },
    { base: '0'.repeat(40), diff: 'tree' },
    { base: 'a'.repeat(40), diff: 'merge-base' },
    { base: undefined, diff: undefined },
  ]) {
    assert.throws(() => planBase(plan, never), /refusing it/, JSON.stringify(plan));
  }
  assert.equal(planBase({ base: 'HEAD^1', diff: 'merge-base' }, never).base, 'HEAD^1');
  const repo = oneCommitRepo();
  try {
    assert.throws(
      () => changedFiles({ QUALITY_CHANGED_BASE: 'HEAD', QUALITY_CHANGED_DIFF: 'two-dot' }, repo),
      /QUALITY_CHANGED_DIFF is two-dot, not merge-base or tree/,
    );
    assert.deepEqual(
      changedFiles({ QUALITY_CHANGED_BASE: 'HEAD', QUALITY_CHANGED_DIFF: 'tree' }, repo)?.files,
      [],
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a push's tree diff leaves out a version-only package.json and a metadata-only pack manifest, compared with before itself", () => {
  const { root, origin, before } = pushRepos({ filters: true });
  try {
    const clone = shallowClone(root, origin, 'plan');
    const chosen = chooseBase({ event: 'push', before }, gitIn(clone));
    const pushed = changedFiles(
      { QUALITY_CHANGED_BASE: chosen.base, QUALITY_CHANGED_DIFF: chosen.diff },
      clone,
    );
    assert.deepEqual(pushed, {
      source: `git diff ${before} HEAD, less 1 manifest(s) whose change is metadata alone and 1 package.json(s) whose change is the version alone`,
      files: ['docs/guide.md', 'packages/fallback-composition/src/x.ts'],
    });
    assert.deepEqual(
      mapChanges(pushed!.files, checkoutMeta()).map(({ axis, id }) => `${axis} ${id}`),
      ['variant fallback'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a forced push that keeps the tree names nothing from the old tip, which its own push run covered; HEAD^1 would name the amended commit's paths", () => {
  // Documenting, not red: push runs are never cancelled, so the old tip's tree had a run of its own.
  const { root, origin, before } = pushRepos({ amend: true });
  try {
    const clone = shallowClone(root, origin, 'plan');
    const chosen = chooseBase({ event: 'push', before, forced: true }, gitIn(clone));
    assert.equal(chosen.base, before);
    assert.match(chosen.reason, /^push \(forced\): /);
    assert.deepEqual(
      changedFiles({ QUALITY_CHANGED_BASE: chosen.base, QUALITY_CHANGED_DIFF: chosen.diff }, clone)
        ?.files,
      [],
    );
    assert.deepEqual(changedFiles({ QUALITY_CHANGED_BASE: 'HEAD^1' }, clone)?.files, [
      'docs/guide.md',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** The env key whose value in `step` is `value`, as ci.yml writes it. */
function keyOf(step: WorkflowStep | undefined, value: string): string {
  const key = Object.entries(step?.env ?? {}).find(([, each]) => each === value)?.[0];
  assert.ok(key, `ci.yml sets ${value}`);
  return key;
}

test('ci/quality-base.mjs runs as ci.yml runs it, with the env names ci.yml sets, and writes, prints and refuses what it should', () => {
  const plan = WORKFLOW.jobs['quality-pr-plan']!.steps.find((step) => step.id === 'base');
  const shard = WORKFLOW.jobs['quality-pr']!.steps.find((step) =>
    step.run?.startsWith('node ci/quality-base.mjs --from-plan'),
  );
  assert.equal(plan?.run, 'node ci/quality-base.mjs');
  assert.equal(shard?.run, 'node ci/quality-base.mjs --from-plan');
  const EVENT = keyOf(plan, '${{ github.event_name }}');
  const BEFORE = keyOf(plan, '${{ github.event.before }}');
  const FORCED = keyOf(plan, '${{ github.event.forced }}');
  const PLAN_BASE = keyOf(shard, '${{ needs.quality-pr-plan.outputs.base }}');
  const PLAN_DIFF = keyOf(shard, '${{ needs.quality-pr-plan.outputs.diff }}');
  const { root, origin, before } = pushRepos();
  // The parent's env, less anything the script reads, and outside Actions, so a refusal goes to stderr.
  const parent = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        ![EVENT, BEFORE, FORCED, PLAN_BASE, PLAN_DIFF].includes(name) &&
        !/^(?:GITHUB_|CI$)/.test(name),
    ),
  );
  let runs = 0;
  const run = (clone: string, env: Record<string, string>, args: string[] = []) => {
    runs += 1;
    const output = path.join(root, `output-${runs}`);
    const summary = path.join(root, `summary-${runs}`);
    writeFileSync(output, '');
    writeFileSync(summary, '');
    const result = spawnSync(process.execPath, [QUALITY_BASE, ...args], {
      cwd: clone,
      env: { ...parent, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, ...env },
      encoding: 'utf8',
    });
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      output: readFileSync(output, 'utf8'),
      summary: readFileSync(summary, 'utf8'),
    };
  };
  try {
    // A push: before, fetched, diffed tree to tree, said in the log and the summary.
    const pushClone = shallowClone(root, origin, 'push');
    const push = run(pushClone, { [EVENT]: 'push', [BEFORE]: before, [FORCED]: 'false' });
    assert.equal(push.status, 0, push.stderr);
    assert.equal(push.output, `base=${before}\ndiff=tree\n`);
    assert.ok(
      push.stdout.includes(
        `[quality-base] ${before} (tree diff): push: github.event.before ${before}, the branch's tip before the push`,
      ),
      push.stdout,
    );
    assert.doesNotMatch(push.stdout, /::warning/);
    assert.equal(
      push.summary,
      `**quality-pr base:** \`${before}\` (tree diff). push: github.event.before ${before}, the branch's tip before the push, diffed tree to tree.\n`,
    );
    // A pull request with a real before: HEAD^1, and before is never fetched.
    const prClone = shallowClone(root, origin, 'pull-request');
    const pr = run(prClone, { [EVENT]: 'pull_request', [BEFORE]: before });
    assert.equal(pr.status, 0, pr.stderr);
    assert.equal(pr.output, 'base=HEAD^1\ndiff=merge-base\n');
    assert.equal(holds(prClone, before), false, 'a pull request never fetches before');
    // A new branch: the fallback, said, with a warning.
    const zero = run(prClone, { [EVENT]: 'push', [BEFORE]: '0'.repeat(40) });
    assert.equal(zero.status, 0, zero.stderr);
    assert.equal(zero.output, 'base=HEAD^1\ndiff=merge-base\n');
    assert.match(zero.stdout, /all zeros \(a new branch\)/);
    assert.match(
      zero.stdout,
      /^::warning title=quality-pr base::push: github\.event\.before is all zeros/m,
    );
    // An unfetchable before: two tries, the fallback, and the warning.
    const missing = run(prClone, { [EVENT]: 'push', [BEFORE]: 'f'.repeat(40) });
    assert.equal(missing.status, 0, missing.stderr);
    assert.equal(missing.output, 'base=HEAD^1\ndiff=merge-base\n');
    assert.match(
      missing.stdout,
      /^::warning title=quality-pr base::push: github\.event\.before f{40} couldn't be fetched in 2 tries/m,
    );
    // A before that's no commit id: exit 1, the refusal on stderr, nothing written.
    const injected = run(prClone, { [EVENT]: 'push', [BEFORE]: '$(id)' });
    assert.equal(injected.status, 1);
    assert.match(
      injected.stderr,
      /\[quality-base\] github\.event\.before is "\$\(id\)", not a commit's 40 hex digits: refusing it/,
    );
    assert.equal(injected.output, '');
    // An unset event: exit 1, never taken for a pull request.
    const unset = run(prClone, { [BEFORE]: before });
    assert.equal(unset.status, 1);
    assert.match(unset.stderr, /EVENT_NAME is empty/);
    assert.equal(unset.output, '');
    // A shard, in a fresh clone: the plan's base fetched, nothing written to the outputs.
    const shardClone = shallowClone(root, origin, 'shard');
    const fromPlan = run(shardClone, { [PLAN_BASE]: before, [PLAN_DIFF]: 'tree' }, ['--from-plan']);
    assert.equal(fromPlan.status, 0, fromPlan.stderr);
    assert.equal(holds(shardClone, before), true, "the shard fetched the plan's base");
    assert.equal(fromPlan.output, '');
    const empty = run(shardClone, { [PLAN_BASE]: '', [PLAN_DIFF]: '' }, ['--from-plan']);
    assert.equal(empty.status, 1);
    assert.match(empty.stderr, /refusing it/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("this file's git runs with no caller GIT_* variable, and no system or global config", () => {
  // The strip, on a made-up map: every GIT_* goes, the rest stays, and only the two config ones are set.
  assert.deepEqual(
    stripGitEnv({
      GIT_DIR: '/made/up/.git',
      GIT_WORK_TREE: '/made/up',
      GIT_INDEX_FILE: '/made/up/index',
      GIT_EDITOR: 'true',
      PATH: '/usr/bin',
      HOME: '/made/up/home',
    }),
    {
      PATH: '/usr/bin',
      HOME: '/made/up/home',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
    },
  );
  // And this process's own environment, stripped at load.
  assert.deepEqual(
    Object.keys(process.env)
      .filter((name) => name.startsWith('GIT_'))
      .sort(),
    ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'],
  );
  assert.equal(process.env.GIT_CONFIG_GLOBAL, '/dev/null');
  const { root, origin } = pushRepos();
  try {
    const clone = shallowClone(root, origin, 'plan');
    const git = gitAt(clone);
    // A fixture repo is its own: its git dir is its own .git, which --show-toplevel can't tell.
    assert.equal(git('rev-parse', '--absolute-git-dir'), path.join(realpathSync(clone), '.git'));
    assert.equal(git('rev-parse', '--show-toplevel'), realpathSync(clone));
    assert.throws(() => git('config', '--get', 'core.hooksPath'), { status: 1 }, 'no hooks path');
    // Why --absolute-git-dir: a child told another git dir by `--git-dir`, a temp repo of this
    // test's, still reports the clone as its top level, and only its git dir shows the difference.
    const other = path.join(root, 'other');
    mkdirSync(other);
    gitAt(other)('init', '-q');
    const peek = (flag: string) =>
      execFileSync('git', ['--git-dir', path.join(other, '.git'), 'rev-parse', flag], {
        cwd: clone,
        encoding: 'utf8',
      }).trim();
    assert.equal(peek('--show-toplevel'), realpathSync(clone));
    assert.notEqual(peek('--absolute-git-dir'), path.join(realpathSync(clone), '.git'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
