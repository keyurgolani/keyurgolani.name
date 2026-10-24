import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'esbuild';

// A client module renders Markdown with the renderer alone: the post-pass
// (markdown-sanitize.ts) runs only where React Server Components render. So
// no client module may reach the renderer, directly or through anything it
// imports, unless it's listed here on purpose. Each listed one is a decision
// docs/threat-model.md's script-1 row stands behind.

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const RENDERER = 'packages/kit/src/markdown.ts';

/**
 * The client modules that reach the renderer, and why each may.
 * host-modules-client.tsx isn't one: it imports the kit's host-modules
 * subpath, not the sections barrel (#6, Slice 2), so the browser registry
 * carries no renderer. Demo Studio's local frame (#9) is the one that does,
 * through the server's own post-pass, which markdown-local.ts installs
 * first: the renderer renders nothing until it's in.
 */
const CLIENT_CALLERS: Readonly<Record<string, string>> = {
  'apps/web/src/app/(preview)/_local/local-document.tsx':
    "Demo Studio's local frame renders the visitor's document in the browser, through markdown-local.ts's post-pass (#9)",
  'apps/web/src/app/(preview)/_local/local-preview.tsx':
    "the local frame's shell, which loads local-document.tsx on demand in the browser alone (#9)",
};

/** Every module under the workspace's sources whose first statement is 'use client', tests aside. */
function clientModules(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'test-support', 'generated', '.next'].includes(entry.name))
          walk(file);
      } else if (/\.[jt]sx?$/.test(entry.name) && !/\.test\.[jt]sx?$/.test(entry.name)) {
        if (
          /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*['"]use client['"]/.test(
            readFileSync(path.join(ROOT, file), 'utf8'),
          )
        ) {
          found.push(file);
        }
      }
    }
  };
  walk('apps/web/src');
  for (const pkg of readdirSync(path.join(ROOT, 'packages'))) {
    if (existsSync(path.join(ROOT, 'packages', pkg, 'src')))
      walk(path.join('packages', pkg, 'src'));
  }
  return found.sort();
}

/** Every bare import but the workspace's own, and the generated registry, stays out of the bundle. */
const externals: Plugin = {
  name: 'externals',
  setup(builder) {
    builder.onResolve({ filter: /^[^./~]|^\.\/generated\// }, (args) =>
      args.path.startsWith('@portfolio/') ? undefined : { path: args.path, external: true },
    );
  },
};

test('no client module reaches the Markdown renderer but the ones listed on purpose', async () => {
  const entries = clientModules();
  assert.ok(entries.length > 30, `${entries.length} client modules`);
  const result = await build({
    entryPoints: entries.map((file) => path.join(ROOT, file)),
    absWorkingDir: ROOT,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    jsx: 'automatic',
    outdir: path.join(ROOT, '.client-graph'),
    write: false,
    metafile: true,
    logLevel: 'silent',
    loader: { '.css': 'empty', '.png': 'empty', '.svg': 'empty', '.woff2': 'empty' },
    plugins: [externals],
  });
  assert.deepEqual(result.errors, []);
  const reaching = Object.values(result.metafile.outputs)
    .filter((output) => output.entryPoint && Object.hasOwn(output.inputs, RENDERER))
    .map((output) => output.entryPoint!)
    .sort();
  assert.deepEqual(reaching, Object.keys(CLIENT_CALLERS).sort());
});
