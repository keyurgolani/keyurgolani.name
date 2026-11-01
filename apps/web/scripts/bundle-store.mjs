#!/usr/bin/env node
// Bundles portfolio-store (#3, item 26) into one file that needs Node and
// nothing else: scripts/portfolio-store.ts and every module it imports, the
// generated registry included, under the react-server condition the server
// builds with. The image's builder stage runs it after `pnpm build`, and the
// runner stage copies the result to /app/bin/portfolio-store.mjs.
//
//   node scripts/bundle-store.mjs [outfile]   (default dist/portfolio-store.mjs)
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const HOST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_OUT = path.join(HOST, 'dist', 'portfolio-store.mjs');

/** Writes the bundle to `outfile`, from the registry build:registry generated. */
export async function bundleStore(outfile = DEFAULT_OUT) {
  await build({
    entryPoints: [path.join(HOST, 'scripts', 'portfolio-store.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    conditions: ['react-server'],
    // sharp is native: import() finds it at run time, from the server's
    // build in the image (packages/core's loadSharp), never in the bundle.
    external: ['sharp'],
    // A CommonJS dependency's require() of a Node built-in, from ESM.
    banner: {
      js: "import { createRequire as __bundleRequire } from 'node:module';\nconst require = __bundleRequire(import.meta.url);",
    },
    // The bundled dependencies' license notices go at the end of the file.
    legalComments: 'eof',
    logLevel: 'warning',
  });
  return outfile;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const out = await bundleStore(process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_OUT);
  process.stdout.write(
    `[store] bundled portfolio-store into ${path.relative(process.cwd(), out)}\n`,
  );
}
