import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// pnpm check:deps sees every import in the web app's source (#7): the ~/
// alias resolves through apps/web/tsconfig.json's baseUrl, an import the
// cruise can't resolve fails it, and the preview rule follows a shared
// module to what it imports. Each test cruises a small tree, at the paths
// the rules name, with the repository's own .dependency-cruiser.cjs,
// apps/web/tsconfig.json, and tsconfig.base.json.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CRUISER = path.join(
  ROOT,
  'node_modules',
  'dependency-cruiser',
  'bin',
  'dependency-cruiser.mjs',
);

/** What every tree holds: the rules' targets, and owner code loaded as the composition root does. */
const BASE = {
  'apps/web/src/app/host-chrome.css': '.host-chrome {}\n',
  'apps/web/src/app/(studio)/layout.tsx':
    'export default function StudioLayout() {\n  return null;\n}\n',
  'apps/web/src/server/owner/auth.ts': 'export const auth = 1;\n',
  'apps/web/src/server/composition.ts':
    "export const loadOwner = () => import('~/server/owner/auth');\n",
  'apps/web/src/lib/experience-head.ts': 'export const head = 1;\n',
  'apps/web/src/app/(preview)/document.tsx':
    "import { head } from '~/lib/experience-head';\nexport const document = head;\n",
};

/**
 * The violations check:deps' config finds in a tree of BASE and `files`,
 * each { rule, from, to }. `tsconfig` rewrites apps/web/tsconfig.json.
 */
function cruise(t, files, { tsconfig = (text) => text } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'deps-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // The config lists the variant packages under its own directory's packages/.
  mkdirSync(path.join(dir, 'packages'));
  for (const file of ['.dependency-cruiser.cjs', 'tsconfig.base.json']) {
    cpSync(path.join(ROOT, file), path.join(dir, file));
  }
  const tree = {
    'apps/web/tsconfig.json': tsconfig(
      readFileSync(path.join(ROOT, 'apps', 'web', 'tsconfig.json'), 'utf8'),
    ),
    ...BASE,
    ...files,
  };
  for (const [file, text] of Object.entries(tree)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  }
  const result = spawnSync(
    process.execPath,
    [CRUISER, 'apps', '--config', '.dependency-cruiser.cjs', '--output-type', 'json'],
    { cwd: dir, encoding: 'utf8' },
  );
  assert.ok(result.stdout, `dependency-cruiser printed nothing: ${result.stderr}`);
  return JSON.parse(result.stdout).summary.violations.map(({ rule, from, to }) => ({
    rule: rule.name,
    from,
    to,
  }));
}

/** The violations of the rules named, sorted. */
function of(violations, ...rules) {
  return violations
    .filter(({ rule }) => rules.includes(rule))
    .sort((a, b) => `${a.from} ${a.to}`.localeCompare(`${b.from} ${b.to}`));
}

const RULES = [
  'not-to-unresolvable',
  'preview-imports-no-studio',
  'owner-code-only-from-composition',
];

test('check:deps passes the tree these tests start from', (t) => {
  assert.deepEqual(of(cruise(t, {}), ...RULES), []);
});

test("check:deps fails a preview module that imports Studio's route group or host-chrome.css, by its ~/ alias too (#7)", (t) => {
  const violations = cruise(t, {
    'apps/web/src/app/(preview)/document.tsx':
      "import '~/app/host-chrome.css';\nexport const document = 1;\n",
    'apps/web/src/preview/agent.tsx': "import '~/app/(studio)/layout';\nexport const agent = 1;\n",
    'apps/web/src/preview/status.ts':
      "import '../app/(studio)/layout';\nexport const status = 1;\n",
  });
  assert.deepEqual(of(violations, 'preview-imports-no-studio'), [
    {
      rule: 'preview-imports-no-studio',
      from: 'apps/web/src/app/(preview)/document.tsx',
      to: 'apps/web/src/app/host-chrome.css',
    },
    {
      rule: 'preview-imports-no-studio',
      from: 'apps/web/src/preview/agent.tsx',
      to: 'apps/web/src/app/(studio)/layout.tsx',
    },
    {
      rule: 'preview-imports-no-studio',
      from: 'apps/web/src/preview/status.ts',
      to: 'apps/web/src/app/(studio)/layout.tsx',
    },
  ]);
});

test('check:deps fails a preview module that reaches host-chrome.css through a shared module (#7)', (t) => {
  const violations = cruise(t, {
    'apps/web/src/lib/experience-head.ts':
      "import '../app/host-chrome.css';\nexport const head = 1;\n",
  });
  // The shared module itself is no preview module, so only the document fails.
  assert.deepEqual(of(violations, 'preview-imports-no-studio'), [
    {
      rule: 'preview-imports-no-studio',
      from: 'apps/web/src/app/(preview)/document.tsx',
      to: 'apps/web/src/app/host-chrome.css',
    },
  ]);
});

test('check:deps fails owner code imported outside the composition root, by its ~/ alias too (#1, #7)', (t) => {
  const violations = cruise(t, {
    'apps/web/src/server/routes.ts': "import '~/server/owner/auth';\nexport const routes = 1;\n",
    'apps/web/src/server/capabilities.ts':
      "import { auth } from './owner/auth';\nexport const capabilities = auth;\n",
  });
  assert.deepEqual(of(violations, 'owner-code-only-from-composition'), [
    {
      rule: 'owner-code-only-from-composition',
      from: 'apps/web/src/server/capabilities.ts',
      to: 'apps/web/src/server/owner/auth.ts',
    },
    {
      rule: 'owner-code-only-from-composition',
      from: 'apps/web/src/server/routes.ts',
      to: 'apps/web/src/server/owner/auth.ts',
    },
  ]);
});

test("check:deps fails an import in the web app's source it can't resolve, so no alias goes unchecked (#7)", (t) => {
  const violations = cruise(t, {
    'apps/web/src/lib/typo.ts': "import '~/lib/no-such-module';\nexport const typo = 1;\n",
  });
  assert.deepEqual(of(violations, 'not-to-unresolvable'), [
    { rule: 'not-to-unresolvable', from: 'apps/web/src/lib/typo.ts', to: '~/lib/no-such-module' },
  ]);
  // Without the tsconfig's baseUrl every alias is one, and fails the same way.
  const withoutBaseUrl = (text) => {
    const config = JSON.parse(text);
    assert.equal(config.compilerOptions.baseUrl, '.');
    delete config.compilerOptions.baseUrl;
    return JSON.stringify(config);
  };
  assert.deepEqual(of(cruise(t, {}, { tsconfig: withoutBaseUrl }), ...RULES), [
    {
      rule: 'not-to-unresolvable',
      from: 'apps/web/src/app/(preview)/document.tsx',
      to: '~/lib/experience-head',
    },
    {
      rule: 'not-to-unresolvable',
      from: 'apps/web/src/server/composition.ts',
      to: '~/server/owner/auth',
    },
  ]);
});
