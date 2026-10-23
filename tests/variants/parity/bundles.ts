// Builds render parity's two halves with esbuild (#5, Slice 6), once per
// worker: server-entry.tsx for Node, as an ES module the spec imports, and
// client-entry.tsx for the browser, as a script the test page runs. Both
// read the build under test's apps/web: its source, its generated registry,
// and its node_modules, where React and the workspace packages resolve.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, type BuildOptions } from 'esbuild';
import type { RenderInputArgs } from '../../../packages/variant-contract/src/render-input';
import { WEB } from '../target';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export interface ParityBundles {
  readonly renderArgs: (
    files: { readonly portfolio: string; readonly site: string },
    id: string,
    origin: string,
    requestTime: string,
  ) => RenderInputArgs;
  readonly renderBoundary: (args: RenderInputArgs) => Promise<string>;
  /** The browser half, as a script's text. */
  readonly client: string;
}

let built: Promise<ParityBundles> | undefined;

function options(entry: string): BuildOptions {
  return {
    entryPoints: [path.join(HERE, entry)],
    bundle: true,
    write: true,
    jsx: 'automatic',
    alias: {
      '@host': path.join(WEB, 'src', 'lib'),
      '@host-server': path.join(WEB, 'src', 'server'),
      // The server half reads the server-only variant registry (#6): it
      // resolves server-only as Next's server bundles do, to its empty module.
      'server-only': path.join(WEB, 'node_modules', 'server-only', 'empty.js'),
    },
    nodePaths: [path.join(WEB, 'node_modules')],
    // The variants' stylesheets are no part of what parity compares.
    loader: { '.css': 'empty' },
    logLevel: 'error',
    legalComments: 'none',
  };
}

/** Both halves, built the first time a test asks. */
export function parityBundles(): Promise<ParityBundles> {
  built ??= (async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'portfolio-parity-'));
    process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(dir, { recursive: true });
    const server = path.join(dir, 'server.mjs');
    const client = path.join(dir, 'client.js');
    await build({
      ...options('server-entry.tsx'),
      platform: 'node',
      format: 'esm',
      outfile: server,
      // The server half's own dependencies need require() in an ES module.
      banner: {
        js: "import { createRequire as __parityRequire } from 'node:module'; const require = __parityRequire(import.meta.url);",
      },
      define: { 'process.env.NODE_ENV': '"production"' },
    });
    await build({
      ...options('client-entry.tsx'),
      platform: 'browser',
      format: 'iife',
      outfile: client,
      define: { 'process.env.NODE_ENV': '"production"' },
      minify: true,
    });
    const halves = (await import(pathToFileURL(server).href)) as Pick<
      ParityBundles,
      'renderArgs' | 'renderBoundary'
    >;
    return { ...halves, client: readFileSync(client, 'utf8') };
  })();
  return built;
}
