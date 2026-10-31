import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUDGET_KINDS,
  FAMILIES,
  lockfileDrift,
  MOTIONS,
  nameRefusal,
  register,
  RegisterError,
  REGISTRATION_FILES,
  SOURCE_FILES,
  TIERS,
} from './register-variant.mjs';

// `pnpm register-variant` (K-9), up to the step that runs pnpm: one id into
// every registration list, in a scratch copy of the files it reads and edits.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const skip = (source) => !/node_modules|tsbuildinfo/.test(source);

/** A scratch repository: the registration files, the fallback composition, and every package manifest. */
function repository(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'register-variant-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of [
    ...REGISTRATION_FILES,
    ...SOURCE_FILES,
    'tests/external-variant/manifest.json',
  ]) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    cpSync(path.join(REPO, file), path.join(root, file));
  }
  cpSync(path.join(REPO, 'quality', 'surfaces'), path.join(root, 'quality', 'surfaces'), {
    recursive: true,
  });
  cpSync(
    path.join(REPO, 'packages', 'fallback-composition'),
    path.join(root, 'packages', 'fallback-composition'),
    { recursive: true, filter: skip },
  );
  for (const dir of readdirSync(path.join(REPO, 'packages'))) {
    for (const file of ['manifest.json', 'package.json']) {
      const from = path.join(REPO, 'packages', dir, file);
      if (!dir.startsWith('variant-') || !existsSync(from)) continue;
      mkdirSync(path.join(root, 'packages', dir), { recursive: true });
      cpSync(from, path.join(root, 'packages', dir, file));
    }
  }
  return root;
}

/** Every file under `root` with its content's digest. */
function snapshot(root) {
  const out = {};
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const at = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(at);
      else
        out[path.relative(root, at).split(path.sep).join('/')] = createHash('sha256')
          .update(readFileSync(at))
          .digest('hex');
    }
  };
  walk(root);
  return out;
}

const changed = (before, after) =>
  Object.keys({ ...before, ...after })
    .filter((file) => before[file] !== after[file])
    .sort();

const OCEAN = {
  id: 'acme-ocean',
  family: 'document',
  motion: 'subtle',
  tier: 'light',
  budgets: { css: 9216, js: 1024, enhancement: 4096, animation: 0 },
  promise: 'The portfolio as a tide chart, read from low water to high.',
  description: 'Each section a reading on the chart, in the order the tide reaches it.',
};

const EXPECTED = [
  'apps/web/package.json',
  'apps/web/scripts/config.test.mjs',
  'apps/web/scripts/variant-css-budgets.test.ts',
  'ci/shard-durations.json',
  'docs/configuration.md',
  'docs/variants.md',
  'packages/variant-acme-ocean/manifest.json',
  'packages/variant-acme-ocean/package.json',
  'packages/variant-acme-ocean/src/index.tsx',
  'packages/variant-acme-ocean/src/studio-thumbnail.tsx',
  'packages/variant-acme-ocean/src/styles.css',
  'packages/variant-acme-ocean/stills/1440.webp',
  'packages/variant-acme-ocean/stills/720.webp',
  'packages/variant-acme-ocean/tsconfig.json',
  'packages/variant-contract/src/ids.ts',
  'packages/variant-contract/src/status.ts',
  'quality/manual-runs/templates/acme-ocean.voiceover-safari-macos.yml',
  'quality/units/acme-ocean.ts',
  'skills/portfolio-author/scripts/validate.test.mjs',
  'skills/variant-developer/SKILL.md',
  'skills/variant-developer/references/manifest-contract.md',
  'tests/quality/cells.test.ts',
  'tests/quality/checklist.test.ts',
];

test('registering a new id touches exactly the registration files and the new package', (t) => {
  const root = repository(t);
  const before = snapshot(root);
  const { touched, scaffolded } = register({ root, ...OCEAN });
  assert.equal(scaffolded, true);
  assert.deepEqual(touched, EXPECTED);
  assert.deepEqual(changed(before, snapshot(root)), EXPECTED);
  const read = (file) => readFileSync(path.join(root, file), 'utf8');

  const manifest = JSON.parse(read('packages/variant-acme-ocean/manifest.json'));
  assert.equal(manifest.id, 'acme-ocean');
  assert.equal(manifest.name, 'Acme Ocean');
  assert.equal(manifest.compositionFamily, 'document');
  assert.equal(manifest.motionIntent, 'subtle');
  assert.equal(manifest.performanceTier, 'light');
  assert.deepEqual(manifest.budgets, {
    js: 1024,
    css: 9216,
    image: 61440,
    font: 0,
    animation: 0,
    enhancement: 4096,
  });

  const ids = read('packages/variant-contract/src/ids.ts');
  // Appended in the order compositions register, after every one before it.
  assert.match(ids, /  'horizontal-cinema',\n(?:  '[a-z0-9-]+',\n)*  'acme-ocean',\n\] as const;/);
  assert.match(ids, /  'acme-ocean': \{ performanceTier: 'light', motionIntent: 'subtle' \},\n\};/);
  // A new composition is pending until its lane flips it (A2).
  assert.match(read('packages/variant-contract/src/status.ts'), /  'acme-ocean': 'pending',\n\};/);
  // Its manifest carries the copy it was given, never the scaffold's placeholder.
  assert.equal(manifest.promise, OCEAN.promise);
  assert.equal(manifest.description, OCEAN.description);
  const web = JSON.parse(read('apps/web/package.json'));
  assert.equal(web.dependencies['@portfolio/variant-acme-ocean'], 'workspace:*');
  const deps = Object.keys(web.dependencies);
  assert.deepEqual(deps, [...deps].sort());
  assert.equal(
    JSON.parse(read('ci/shard-durations.json')).unit['pkg:packages/variant-acme-ocean'],
    3,
  );
  assert.match(
    read('tests/quality/cells.test.ts'),
    // Sorted in at its place, right before the next id; what follows moves as compositions register.
    /'acme-ocean complete \/ system',\n    'aurora-glass complete \/ system',\n/,
  );
  assert.match(
    read('tests/quality/cells.test.ts'),
    /\[\n    \{ kind: 'composition', id: 'acme-ocean' \},\n    \{ kind: 'composition', id: 'aurora-glass' \},\n/,
  );
  const checklist = read('tests/quality/checklist.test.ts');
  assert.match(checklist, /compositions, \[\n    'acme-ocean',\n    'aurora-glass',\n/);
  assert.match(checklist, /Registered: demo-studio, login, studio, acme-ocean, aurora-glass,/);
  assert.match(
    read('apps/web/scripts/variant-css-budgets.test.ts'),
    /\[\n    'fallback',\n    'acme-ocean',\n    'aurora-glass',\n/,
  );
  for (const file of [
    'apps/web/scripts/config.test.mjs',
    'skills/portfolio-author/scripts/validate.test.mjs',
  ]) {
    assert.match(read(file), /registers: acme-ocean, aurora-glass, /, file);
    assert.doesNotMatch(read(file), /registers: editorial-evidence/, file);
  }
  assert.match(
    read('docs/configuration.md'),
    /This build registers `acme-ocean`, `aurora-glass`, /,
  );
  assert.match(
    read('docs/variants.md'),
    /\n- \*\*Acme Ocean\*\* \(`packages\/variant-acme-ocean`\): `document`, `subtle`, and `light`/,
  );
  assert.match(
    read('skills/variant-developer/SKILL.md'),
    /\n- \*\*`packages\/variant-acme-ocean`\*\*: Acme Ocean, a first-party composition/,
  );
  const contract = read('skills/variant-developer/references/manifest-contract.md');
  assert.match(
    contract,
    /`horizontal-cinema`, (?:`[a-z0-9-]+`, )*`acme-ocean`\), and `missing-variant`/,
  );
  assert.match(
    contract,
    /- `horizontal-cinema`: medium and directed\n(?:- `[a-z0-9-]+`: [a-z]+ and [a-z]+\n)*- `acme-ocean`: light and subtle\n\n/,
  );
  const unit = read('quality/units/acme-ocean.ts');
  assert.match(unit, /^export const distinct = 'pending';$/m);
  assert.match(unit, /^export const coverage = 'pending';$/m);
  const template = read('quality/manual-runs/templates/acme-ocean.voiceover-safari-macos.yml');
  assert.match(template, /^surface: acme-ocean$/m);
  assert.doesNotMatch(template, /fallback/);
});

test('a second run changes nothing, and two runs from the same tree write the same bytes', (t) => {
  const root = repository(t);
  register({ root, ...OCEAN });
  const once = snapshot(root);
  const again = register({ root, ...OCEAN });
  assert.deepEqual(again, { touched: [], scaffolded: false });
  assert.deepEqual(snapshot(root), once);
  const other = repository(t);
  register({ root: other, ...OCEAN });
  assert.deepEqual(snapshot(other), once);
});

test('a name, and an id that sorts last, land where they belong', (t) => {
  const root = repository(t);
  register({ root, ...OCEAN, id: 'zz-top', name: 'ZZ Top' });
  const read = (file) => readFileSync(path.join(root, file), 'utf8');
  assert.equal(JSON.parse(read('packages/variant-zz-top/manifest.json')).name, 'ZZ Top');
  assert.match(
    read('docs/configuration.md'),
    /`spatial-bento` \(#16\), (?:`[a-z0-9-]+`, )*`zz-top`, and the fallback composition/,
  );
  assert.match(
    read('tests/quality/cells.test.ts'),
    /'studio appearance \/studio system',\n(?:    '[^'\n]+',\n)*    'zz-top complete \/ system',\n  \]\);/,
  );
  assert.match(
    read('tests/quality/checklist.test.ts'),
    /spatial-bento, (?:[a-z0-9-]+, )*zz-top\\\./,
  );
});

test('it refuses reserved, taken, and malformed ids, and unknown options, writing nothing', (t) => {
  const root = repository(t);
  const before = snapshot(root);
  for (const id of [
    'Acme',
    'a',
    'acme_ocean',
    'fallback',
    'missing-variant',
    'login',
    'studio',
    'acme-reference',
  ]) {
    assert.throws(() => register({ root, ...OCEAN, id }), RegisterError, id);
  }
  // Another package's manifest id.
  writeFileSync(
    path.join(root, 'packages', 'fallback-composition', 'manifest.json'),
    readFileSync(
      path.join(root, 'packages', 'fallback-composition', 'manifest.json'),
      'utf8',
    ).replace('"id": "fallback"', '"id": "acme-ocean"'),
  );
  assert.throws(() => register({ root, ...OCEAN }), /packages\/fallback-composition's manifest/);
  cpSync(
    path.join(REPO, 'packages', 'fallback-composition', 'manifest.json'),
    path.join(root, 'packages', 'fallback-composition', 'manifest.json'),
  );
  for (const bad of [
    { family: 'brutalist' },
    { motion: 'wild' },
    { tier: 'huge' },
    { budgets: { css: 9216, js: 1024, enhancement: 4096 } },
    { budgets: { ...OCEAN.budgets, css: -1 } },
    { budgets: { ...OCEAN.budgets, css: 999999 } },
    { budgets: { ...OCEAN.budgets, sparkle: 1 } },
  ]) {
    assert.throws(() => register({ root, ...OCEAN, ...bad }), RegisterError, JSON.stringify(bad));
  }
  assert.deepEqual(snapshot(root), before);
});

test('pins that disagree with the arguments stop it before it writes', (t) => {
  const root = repository(t);
  const before = snapshot(root);
  assert.throws(
    () => register({ root, ...OCEAN, id: 'editorial-evidence', motion: 'still', tier: 'heavy' }),
    /doesn't match: .*its performanceTier is "light", not "heavy"/,
  );
  // A pin with no package yet, as for an id registered by hand.
  const pkg = path.join(root, 'packages', 'variant-editorial-evidence');
  const kept = mkdtempSync(path.join(tmpdir(), 'register-variant-kept-'));
  t.after(() => rmSync(kept, { recursive: true, force: true }));
  cpSync(pkg, kept, { recursive: true });
  rmSync(pkg, { recursive: true });
  const unpackaged = snapshot(root);
  assert.throws(
    () => register({ root, ...OCEAN, id: 'editorial-evidence', motion: 'still', tier: 'heavy' }),
    /ids\.ts pins editorial-evidence to light and still, not heavy and still/,
  );
  assert.deepEqual(snapshot(root), unpackaged);
  cpSync(kept, pkg, { recursive: true });
  assert.deepEqual(snapshot(root), before);
  register({ root, ...OCEAN });
  const registered = snapshot(root);
  assert.throws(
    () => register({ root, ...OCEAN, motion: 'still' }),
    /its motionIntent is "subtle", not "still"/,
  );
  assert.deepEqual(snapshot(root), registered);
});

test('an existing package whose family, name, or budgets disagree is refused, naming each field', (t) => {
  const root = repository(t);
  register({ root, ...OCEAN });
  const registered = snapshot(root);
  const refusal = (args) => {
    try {
      register({ root, ...OCEAN, ...args });
    } catch (error) {
      assert.ok(error instanceof RegisterError, String(error));
      return error.message;
    }
    assert.fail(`${JSON.stringify(args)} was accepted`);
  };
  assert.equal(
    refusal({ family: 'custom', budgets: { ...OCEAN.budgets, css: 10240, enhancement: 0 } }),
    'packages/variant-acme-ocean doesn\'t match: its compositionFamily is "document", not "custom", its budgets.css is 9216, not 10240, its budgets.enhancement is 4096, not 0.',
  );
  assert.match(
    refusal({ budgets: { ...OCEAN.budgets, image: 1024 } }),
    /budgets\.image is 61440, not 1024/,
  );
  assert.match(refusal({ name: 'Acme Sea' }), /its name is "Acme Ocean", not "Acme Sea"/);
  // A scaffold from `pnpm new-variant` keeps the fallback's family and budgets until they're set.
  const manifest = path.join(root, 'packages', 'variant-acme-ocean', 'manifest.json');
  const text = readFileSync(manifest, 'utf8');
  const scaffolded = JSON.parse(text);
  delete scaffolded.budgets.enhancement;
  writeFileSync(manifest, `${JSON.stringify(scaffolded, null, 2)}\n`);
  assert.match(refusal({}), /its budgets\.enhancement is unset, not 4096\.$/);
  writeFileSync(manifest, text);
  assert.deepEqual(snapshot(root), registered, 'nothing written');
  // With the matching arguments, it's a second run: nothing to do.
  assert.deepEqual(register({ root, ...OCEAN, name: 'Acme Ocean' }).touched, []);
});

test('a name the manifest or the docs would refuse is refused before anything is written', (t) => {
  const root = repository(t);
  const before = snapshot(root);
  for (const name of [
    '',
    ' Acme',
    'Acme Ocean Acme Ocean Acme Ocean Acme Ocean Acme Ocean Acme Ocean',
    'Acme\nOcean',
    'Acme <Ocean>',
    'Aurora *Glass*',
    'Acme `Ocean`',
  ]) {
    assert.equal(nameRefusal(name) === null, false, JSON.stringify(name));
    assert.throws(() => register({ root, ...OCEAN, name }), RegisterError, JSON.stringify(name));
  }
  assert.equal(nameRefusal('Swiss Signal'), null);
  assert.equal(nameRefusal('ZZ Top'), null);
  assert.deepEqual(snapshot(root), before);
});

test('the install accepts only the new link and importer in the lockfile', () => {
  const before = {
    lockfileVersion: '9.0',
    importers: {
      'apps/web': { dependencies: { next: { specifier: '16.4.1', version: '16.4.1' } } },
    },
    packages: { 'react@19.2.5': { resolution: { integrity: 'sha512-a' } } },
    snapshots: { 'react@19.2.5': {} },
  };
  const registered = structuredClone(before);
  registered.importers['apps/web'].dependencies['@portfolio/variant-acme-ocean'] = {
    specifier: 'workspace:*',
    version: 'link:../../packages/variant-acme-ocean',
  };
  registered.importers['packages/variant-acme-ocean'] = {
    devDependencies: { react: { specifier: '^19.0.0', version: '19.2.5' } },
  };
  assert.deepEqual(lockfileDrift(before, registered, 'acme-ocean'), []);
  assert.deepEqual(lockfileDrift(before, before, 'acme-ocean'), []);

  const drifted = structuredClone(registered);
  drifted.packages['react@19.2.6'] = { resolution: { integrity: 'sha512-b' } };
  drifted.importers['apps/web'].dependencies.next.version = '16.4.2';
  drifted.importers['packages/kit'] = {};
  assert.deepEqual(lockfileDrift(before, drifted, 'acme-ocean'), [
    'importers/apps/web',
    'importers/packages/kit',
    'packages/react@19.2.6',
  ]);
  // Another id's link and importer are drift, not this registration's.
  assert.deepEqual(lockfileDrift(before, registered, 'acme-sea'), [
    'importers/apps/web',
    'importers/packages/variant-acme-ocean',
  ]);
  // A link that isn't the workspace's is drift too.
  const pinned = structuredClone(registered);
  pinned.importers['apps/web'].dependencies['@portfolio/variant-acme-ocean'].specifier = '1.0.0';
  assert.deepEqual(lockfileDrift(before, pinned, 'acme-ocean'), ['importers/apps/web']);
});

test('a list it can no longer find stops it with nothing written', (t) => {
  const root = repository(t);
  const file = path.join(root, 'docs', 'variants.md');
  writeFileSync(
    file,
    readFileSync(file, 'utf8').replace('## The first-party compositions', '## Ours'),
  );
  const before = snapshot(root);
  assert.throws(() => register({ root, ...OCEAN }), /docs\/variants\.md no longer has/);
  assert.deepEqual(snapshot(root), before);
});

test("its families, motions, tiers, and budget kinds are the manifest schema's", () => {
  const schema = readFileSync(
    path.join(REPO, 'packages', 'variant-contract', 'src', 'manifest-schema.ts'),
    'utf8',
  );
  const list = (name) =>
    [
      ...new RegExp(`export const ${name} = \\[([^\\]]*)\\]`)
        .exec(schema)[1]
        .matchAll(/'([a-z]+)'/g),
    ].map((each) => each[1]);
  assert.deepEqual(FAMILIES, list('COMPOSITION_FAMILIES'));
  assert.deepEqual(MOTIONS, list('MOTION_INTENTS'));
  assert.deepEqual(TIERS, list('PERFORMANCE_TIERS'));
  const budgets = readFileSync(
    path.join(REPO, 'packages', 'variant-contract', 'src', 'budgets.ts'),
    'utf8',
  );
  assert.deepEqual(
    BUDGET_KINDS,
    [...budgets.match(/BUDGET_KINDS = \[([^\]]*)\]/)[1].matchAll(/'([a-z]+)'/g)].map(
      (each) => each[1],
    ),
  );
});

test("a promise and a description are required, the composition's own, and plain one-line text (A2)", (t) => {
  const root = repository(t);
  const before = snapshot(root);
  for (const [bad, message] of [
    [{ promise: undefined }, /--promise is required/],
    [{ description: '' }, /--description is required/],
    [
      { promise: 'Replace this with the composition idea from DESIGN.md, in one sentence.' },
      /--promise is the composition's own, not the scaffold's placeholder/,
    ],
    [{ description: 'Two\nlines.' }, /--description is one line/],
    [{ promise: 'x'.repeat(141) }, /--promise is 141 characters, over 140/],
    [{ promise: 'A <b>bold</b> idea.' }, /--promise has no < or >/],
  ]) {
    assert.throws(() => register({ root, ...OCEAN, ...bad }), message, JSON.stringify(bad));
  }
  assert.deepEqual(snapshot(root), before, 'nothing written');
  // An existing package keeps its own copy: a different one is refused.
  register({ root, ...OCEAN });
  assert.throws(
    () => register({ root, ...OCEAN, promise: 'Another idea.' }),
    /its promise is "The portfolio as a tide chart, read from low water to high\.", not "Another idea\."/,
  );
});

test("an id already in COMPOSITION_STATUS keeps its lane's status (A2)", (t) => {
  const root = repository(t);
  const file = path.join(root, 'packages/variant-contract/src/status.ts');
  writeFileSync(
    file,
    readFileSync(file, 'utf8').replace(/\n\};/, "\n  'acme-ocean': 'ready',\n};"),
  );
  register({ root, ...OCEAN });
  const text = readFileSync(file, 'utf8');
  assert.match(text, /'acme-ocean': 'ready',/);
  assert.doesNotMatch(text, /'acme-ocean': 'pending'/);
});
