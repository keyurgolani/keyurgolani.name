// For the ./node tests: hosts built in a temporary directory, each with a
// package.json naming its dependencies and a node_modules holding them, so
// registry generation reads them as it reads apps/web.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PackFile, PackHooks, PackKind } from './registry';

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
    schemas: { portfolio: { min: 3, max: 3 }, site: { min: 2, max: 2 } },
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

/**
 * An appearance pack package (#19): `portfolio.packs` names ./packs, which
 * holds a directory per pack id with its manifest.json. Other files, such as
 * a pack's stylesheet, by path in the package.
 */
export function packPackage(
  name: string,
  kind: PackKind,
  packs: Readonly<Record<string, unknown>>,
  {
    packageJson = {},
    files = {},
  }: { packageJson?: Record<string, unknown>; files?: Record<string, string> } = {},
): PackageSpec {
  return {
    name,
    packageJson: { version: '1.0.0', portfolio: { kind, packs: './packs' }, ...packageJson },
    files: {
      ...Object.fromEntries(
        Object.entries(packs).map(([id, manifest]) => [
          `packs/${id}/manifest.json`,
          JSON.stringify(manifest),
        ]),
      ),
      ...files,
    },
  };
}

/** A pack file named by its content, as #19's compiler names one. */
export function testPackFile(id: string, extension: 'css' | 'woff2', text: string): PackFile {
  const bytes = new TextEncoder().encode(text);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const name = `${id}.${sha256.slice(0, 12)}.${extension}`;
  return {
    name,
    url: `/_portfolio/${extension === 'woff2' ? 'font' : 'pack'}/${name}`,
    sha256,
    bytes,
  };
}

/** Each pack kind's fallback in the tests' hosts. */
export const TEST_FALLBACKS = {
  'design-language': { id: 'test-language', packageName: '@portfolio/test-languages' },
  'color-scheme': { id: 'test-scheme', packageName: '@portfolio/test-schemes' },
  typography: { id: 'test-type', packageName: '@portfolio/test-typography' },
} as const satisfies PackHooks['fallbacks'];

/** The three fallback pack packages a host with pack checks needs. */
export const TEST_FALLBACK_PACKS: readonly PackageSpec[] = (
  ['design-language', 'color-scheme', 'typography'] as const
).map((kind) => {
  const { id, packageName } = TEST_FALLBACKS[kind];
  return packPackage(packageName, kind, { [id]: { id } });
});

/**
 * Stand-ins for #19's pack checks. A manifest validates when its id is a
 * string and it has no `invalid`. It compiles to a stylesheet naming its id,
 * with a font file when it has `font`, unless it has `broken`, the file it
 * names and can't read.
 */
export const TEST_PACK_HOOKS: PackHooks = {
  validate(manifest) {
    const value = manifest as { id?: unknown; invalid?: unknown } | null;
    if (typeof value?.id !== 'string' || value.invalid !== undefined) {
      return {
        ok: false,
        diagnostics: [
          {
            code: 'manifest.invalid',
            severity: 'error',
            pointer: typeof value?.id === 'string' ? '/invalid' : '/id',
            message: "isn't what a pack manifest holds.",
            remedy: 'Fix the manifest.',
          },
        ],
      };
    }
    return { ok: true, manifest: value as { id: string }, diagnostics: [] };
  },
  compile({ manifest }) {
    const value = manifest as { id: string; broken?: string; font?: boolean };
    if (value.broken) {
      return {
        ok: false,
        problems: [
          {
            file: value.broken,
            pointer: '/stylesheet',
            message: `names ${value.broken}, which can't be read.`,
            remedy: 'Ship the file.',
          },
        ],
      };
    }
    return {
      ok: true,
      stylesheet: testPackFile(value.id, 'css', `[data-pack="${value.id}"] {}\n`),
      assets: value.font ? [testPackFile(value.id, 'woff2', `font ${value.id}`)] : [],
    };
  },
  platform: () => testPackFile('_platform', 'css', '[data-appearance-boundary] {}\n'),
  fallbacks: TEST_FALLBACKS,
};
