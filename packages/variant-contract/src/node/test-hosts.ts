// For the ./node tests: hosts built in a temporary directory, each with a
// package.json naming its dependencies and a node_modules holding them, so
// registry generation reads them as it reads apps/web.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface PackageSpec {
  readonly name: string;
  /** package.json, as written. `name` defaults to the spec's. */
  readonly packageJson?: Record<string, unknown>;
  /** Raw package.json text, in place of `packageJson`. */
  readonly packageText?: string;
  /** Other files, by path in the package. */
  readonly files?: Readonly<Record<string, string>>;
}

const made: string[] = [];

/** Removes every host testHost() made. Each test file calls it once its tests are done. */
export function removeTestHosts(): void {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

/** A host whose dependencies are `dependencies`, defaulting to every package given. */
export function testHost(
  packages: readonly PackageSpec[],
  dependencies: readonly string[] = packages.map(({ name }) => name),
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-host-'));
  made.push(dir);
  write(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: '@portfolio/web',
      dependencies: Object.fromEntries(dependencies.map((name) => [name, '1.0.0'])),
    }),
  );
  for (const spec of packages) {
    const root = path.join(dir, 'node_modules', ...spec.name.split('/'));
    write(
      path.join(root, 'package.json'),
      spec.packageText ?? JSON.stringify({ name: spec.name, ...spec.packageJson }),
    );
    for (const [file, text] of Object.entries(spec.files ?? {})) write(path.join(root, file), text);
  }
  return dir;
}

function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** A manifest that validates, for `id`, with any field replaced. */
export function manifestFor(
  id: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    name: 'Test composition',
    promise: 'A composition for the tests.',
    description: 'It renders nothing of its own.',
    contract: '2.0',
    schemas: { portfolio: { min: 2, max: 2 }, site: { min: 2, max: 2 } },
    tokenContract: 1,
    compositionFamily: 'document',
    motionIntent: 'still',
    performanceTier: 'light',
    renderedKinds: [],
    unsupportedKinds: [],
    contentSlots: [],
    routes: { home: 'shared', work: 'shared', views: [] },
    controls: { version: 1, items: [], migrations: [] },
    visitorControl: { placement: 'header' },
    textDirection: ['ltr'],
    provenance: { provisional: false, sources: [] },
    ...extra,
  };
}

/** A variant package that registers, with any part replaced. */
export function variantPackage(
  name: string,
  id: string,
  {
    manifest = manifestFor(id),
    packageJson = {},
    files = {},
  }: {
    manifest?: unknown;
    packageJson?: Record<string, unknown>;
    files?: Record<string, string>;
  } = {},
): PackageSpec {
  return {
    name,
    packageJson: {
      version: '1.0.0',
      type: 'module',
      portfolio: { kind: 'variant', manifest: './manifest.json' },
      exports: { '.': './index.js', './styles.css': './styles.css' },
      ...packageJson,
    },
    files: {
      'manifest.json': JSON.stringify(manifest),
      'index.js': 'export default function Variant() { return null; }\n',
      'styles.css': `[data-variant='${id}'] { display: block; }\n`,
      ...files,
    },
  };
}

/** The fallback composition, which every host needs. */
export const FALLBACK = variantPackage('@portfolio/fallback-composition', 'fallback', {
  manifest: manifestFor('fallback', { textDirection: ['ltr', 'rtl'] }),
});

/** A content extension package that registers, with any part replaced. */
export function extensionPackage(
  name: string,
  {
    entry = `export default { namespace: ${JSON.stringify(name)} };\n`,
    packageJson = {},
    files = {},
  }: { entry?: string; packageJson?: Record<string, unknown>; files?: Record<string, string> } = {},
): PackageSpec {
  return {
    name,
    packageJson: {
      version: '2.0.0',
      type: 'module',
      portfolio: { kind: 'content-extension' },
      exports: { '.': './index.mjs' },
      ...packageJson,
    },
    files: { 'index.mjs': entry, ...files },
  };
}
