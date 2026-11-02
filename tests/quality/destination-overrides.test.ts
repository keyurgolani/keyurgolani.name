import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// K-1 (brief §1 N7): a composition moves a section away from the canonical
// destination map only by declaring overrides, and only with a test.
// navigationModel() takes overrides made by the kit's
// defineNavigationOverrides() alone (any other map throws, and fails the
// type), so every declaration is a call to it. This holds every workspace
// package to the rule: each call is a named constant, and a test in the
// same package checks that constant with checkDestinationOverrides(). A
// package with a grouping hook has a checkGrouping() test too, since
// grouping never moves a section and reports what it refused.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * The package folders pnpm-workspace.yaml lists, by their path from the
 * repo root: each `packages:` entry, a folder or a folder's `/*`.
 */
export function workspaceGlobs(yaml: string): string[] {
  const globs: string[] = [];
  let inPackages = false;
  for (const line of yaml.split('\n')) {
    if (/^\S/.test(line)) inPackages = /^packages:\s*$/.test(line);
    const entry = inPackages ? /^\s+-\s+['"]?([^'"#\s]+)['"]?/.exec(line) : null;
    if (entry) globs.push(entry[1]!);
  }
  return globs;
}

/** Each workspace package, by its path from the repo root. */
function workspacePackages(): string[] {
  const globs = workspaceGlobs(readFileSync(path.join(ROOT, 'pnpm-workspace.yaml'), 'utf8'));
  return globs.flatMap((glob) => {
    if (!glob.endsWith('/*')) return [glob];
    const parent = glob.slice(0, -2);
    let names: string[];
    try {
      names = readdirSync(path.join(ROOT, parent));
    } catch {
      return [];
    }
    return names
      .map((name) => path.join(parent, name))
      .filter((dir) => statSync(path.join(ROOT, dir)).isDirectory());
  });
}

/** Every .ts and .tsx file under `dir`, node_modules and build output left out. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) return [];
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return sources(file);
    return /\.tsx?$/.test(name) ? [file] : [];
  });
}

const isTest = (file: string) => /\.test\.tsx?$/.test(file);

/**
 * Source text's uses of defineNavigationOverrides, its plain imports left
 * out: the constant each call is declared as, `const X =
 * [namespace.]defineNavigationOverrides(`, or null for any other use. That
 * covers an inline call, an import under another name (`as declare`), and
 * a bare reference (`const make = defineNavigationOverrides`), which would
 * otherwise hide calls from the guard.
 */
export function declaredOverrides(text: string): (string | null)[] {
  const uses = [...text.matchAll(/\bdefineNavigationOverrides\b/g)];
  return uses.flatMap(({ index }) => {
    const before = text.slice(0, index);
    const after = text.slice(index + 'defineNavigationOverrides'.length);
    // `import { defineNavigationOverrides } from …`, under its own name.
    if (/\bimport\s+\{[^}]*$/.test(before) && /^\s*[,}]/.test(after)) return [];
    const named =
      /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)?$/.exec(before);
    return [named && /^\s*\(/.test(after) ? named[1]! : null];
  });
}

/**
 * Whether source text declares a grouping hook's groupOf(), which the model
 * refuses to let move a section and reports in `diagnostics`, so a test
 * checks it with checkGrouping(): a `groupOf` in a module that names the
 * kit's navigationModel or GroupingOptions, so a composition's own
 * function of that name, such as Cinema's scene groups, isn't one. It's
 * textual, and a hook declared untyped away from its navigationModel()
 * call gets past it; the model's refusal holds there all the same.
 */
export function declaresGrouping(text: string): boolean {
  return /\b(?:navigationModel|GroupingOptions)\b/.test(text) && /\bgroupOf\s*[:(]/.test(text);
}

/** Whether test text checks the constant `name` with checkDestinationOverrides(). */
export function checksOverrides(text: string, name: string): boolean {
  return new RegExp(`\\bcheckDestinationOverrides\\s*\\(\\s*${name.replace(/\$/g, '\\$')}\\b`).test(
    text,
  );
}

test('the declaration reading finds each defineNavigationOverrides() call and the constant it makes', () => {
  assert.deepEqual(
    declaredOverrides("export const PLACE = defineNavigationOverrides({ github: 'work' });"),
    ['PLACE'],
  );
  assert.deepEqual(
    declaredOverrides(
      "const SHEETS: DestinationOverrides =\n  defineNavigationOverrides({ github: 'work' });",
    ),
    ['SHEETS'],
  );
  // Inline, it has no name a test could check.
  assert.deepEqual(
    declaredOverrides(
      "navigationModel(outline, { overrides: defineNavigationOverrides({ github: 'work' }) });",
    ),
    [null],
  );
  assert.deepEqual(
    declaredOverrides(
      'const a = defineNavigationOverrides({});\nconst b = defineNavigationOverrides({});',
    ),
    ['a', 'b'],
  );
  assert.deepEqual(declaredOverrides('navigationModel(outline, { primary: 4 });'), []);
  // A plain import is no use; a namespace call is a named constant's.
  assert.deepEqual(
    declaredOverrides(
      "import { checkDestinationOverrides, defineNavigationOverrides } from '@portfolio/kit/sections';\nconst PLACE = kit.defineNavigationOverrides({ github: 'work' });",
    ),
    ['PLACE'],
  );
  // The round 2 review's evasions (R2-L1): an import alias, and a bare reference.
  assert.deepEqual(
    declaredOverrides(
      "import { defineNavigationOverrides as declare } from '@portfolio/kit/sections';\nconst PLACE = declare({ github: 'work' });",
    ),
    [null],
  );
  assert.deepEqual(
    declaredOverrides('const make = defineNavigationOverrides;\nconst PLACE = make({});'),
    [null],
  );
  assert.ok(
    declaresGrouping(
      "navigationModel(outline, { grouping: { groups, groupOf: (section) => 'overview' } });",
    ),
  );
  assert.ok(
    declaresGrouping(
      'const boards: GroupingOptions<Board> = { groups, groupOf };\nfunction groupOf(section) {}',
    ),
  );
  assert.ok(!declaresGrouping('navigationModel(outline, { grouping: { groups } });'));
  // A composition's own function of the name, with no navigation model in sight.
  assert.ok(!declaresGrouping('function groupOf(section: ViewSection): string | undefined {}'));
  assert.ok(
    checksOverrides('assert.deepEqual(checkDestinationOverrides(PLACE, outlines), []);', 'PLACE'),
  );
  assert.ok(!checksOverrides('checkDestinationOverrides(PLACES, outlines)', 'PLACE'));
  assert.ok(!checksOverrides('checkDestinationOverrides({ github: "work" }, outlines)', 'PLACE'));
});

test('the workspace reading lists pnpm-workspace.yaml’s packages, and nothing after them', () => {
  assert.deepEqual(
    workspaceGlobs(
      'packages:\n  - \'apps/*\'\n  - "packages/*"\n  # a comment\n  - experiments/*\n\nstrictDepBuilds: true\nonlyBuiltDependencies:\n  - esbuild\n',
    ),
    ['apps/*', 'packages/*', 'experiments/*'],
  );
});

test('every defineNavigationOverrides() call is a named constant that a test in its package checks, and every grouping hook has a checkGrouping() test', () => {
  const packages = workspacePackages();
  // The walk sees the workspace, so an empty one can't pass.
  for (const known of ['apps/web', 'packages/fallback-composition']) {
    assert.ok(packages.includes(path.normalize(known)), known);
  }
  const offenders: string[] = [];
  for (const name of packages) {
    // The kit defines the helper and its check, and tests both itself.
    if (name === path.join('packages', 'kit')) continue;
    const src = path.join(ROOT, name, 'src');
    let files: string[];
    try {
      files = sources(src);
    } catch {
      continue;
    }
    const tests = files.filter(isTest).map((file) => readFileSync(file, 'utf8'));
    for (const file of files.filter((file) => !isTest(file))) {
      const text = readFileSync(file, 'utf8');
      if (declaresGrouping(text) && !tests.some((test) => /\bcheckGrouping\s*\(/.test(test))) {
        offenders.push(
          `${name}/${path.relative(src, file)}: a grouping hook no checkGrouping() test checks`,
        );
      }
      for (const constant of declaredOverrides(text)) {
        const where = `${name}/${path.relative(src, file)}`;
        if (constant === null) {
          offenders.push(
            `${where}: a defineNavigationOverrides use that's no \`const X = defineNavigationOverrides(…)\` (an inline call, an alias, or a bare reference)`,
          );
        } else if (!tests.some((text) => checksOverrides(text, constant))) {
          offenders.push(`${where}: ${constant}, which no checkDestinationOverrides() test checks`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], 'destination overrides without their test');
});
