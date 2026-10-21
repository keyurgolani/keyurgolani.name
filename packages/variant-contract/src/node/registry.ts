// Registry generation (#5, Slice 3, item 1): which of the host's direct
// dependencies are variants and content extensions, whether each is one this
// build can register, and what it registers. Nothing is skipped quietly: a
// dependency that declares a portfolio kind is registered or reported.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineContentExtension, type ContentExtensionSpec } from '@portfolio/schema';
import { toPointer, type ManifestCode, type ManifestDiagnostic } from '../diagnostics';
import { FALLBACK_ID } from '../ids';
import type { VariantManifest } from '../manifest-schema';
import { validateManifest } from '../validate-manifest';
import {
  exportKeys,
  exportTarget,
  findInstalled,
  inside,
  isRecord,
  readJson,
  type PackageJson,
} from './packages';

/** The package kinds the registry reads, from `portfolio.kind` in package.json. */
export const REGISTRY_KINDS = [
  'variant',
  'design-language',
  'color-scheme',
  'typography',
  'content-extension',
] as const;
export type RegistryKind = (typeof REGISTRY_KINDS)[number];

/** #19's appearance pack kinds, which have no validator yet. */
export const PACK_KINDS: readonly RegistryKind[] = [
  'design-language',
  'color-scheme',
  'typography',
];

/** Every code generation raises besides the manifest's own, with its severity. */
export const REGISTRY_CODES = {
  'registry.host-unreadable': 'error',
  'registry.package-missing': 'error',
  'registry.package-invalid': 'error',
  'registry.kind-unknown': 'error',
  'registry.no-validator': 'error',
  'registry.manifest-missing': 'error',
  'registry.manifest-syntax': 'error',
  'registry.export-missing': 'error',
  'registry.file-missing': 'error',
  'registry.duplicate-id': 'error',
  'registry.fallback-missing': 'error',
  'registry.extension-invalid': 'error',
} as const satisfies Record<string, 'error' | 'warning'>;

export type RegistryCode = keyof typeof REGISTRY_CODES;

/** One reason generation can't register a package, or a warning about one. */
export interface RegistryDiagnostic {
  readonly code: RegistryCode | ManifestCode;
  readonly severity: 'error' | 'warning';
  /** The package it's about. The host's own problems name the host package. */
  readonly package: string;
  /** The package's version, once its package.json says. */
  readonly version?: string;
  /** The file the pointer points into, relative to the host: a manifest.json, or a package.json. */
  readonly manifestPath: string;
  /** JSON pointer into that file; '' is the whole file. */
  readonly pointer: string;
  readonly message: string;
  readonly expected?: string;
  readonly actual?: string;
  /** What fixes it: upgrading, pinning, or uninstalling the package, or a change to it. */
  readonly remedy: string;
}

/** A variant generation registers. */
export interface VariantEntry {
  readonly kind: 'variant';
  readonly packageName: string;
  readonly version: string;
  /** Where it's installed, through node_modules. */
  readonly dir: string;
  /** Its manifest.json. */
  readonly manifestFile: string;
  readonly manifest: VariantManifest;
  /** Each declared enhancement, with the specifier that loads it and its file in the package. */
  readonly enhancements: readonly {
    readonly id: string;
    readonly specifier: string;
    readonly file: string;
  }[];
}

/** A content extension generation registers. */
export interface ExtensionEntry {
  readonly kind: 'content-extension';
  readonly packageName: string;
  readonly version: string;
  readonly dir: string;
  readonly namespace: string;
  /** Whether it exports `./renderers`, the section renderers renderSection() tries. */
  readonly renderers: boolean;
}

export interface RegistryResult {
  /** No error diagnostics. */
  readonly ok: boolean;
  /** Sorted by id. */
  readonly variants: readonly VariantEntry[];
  /** Sorted by package name. */
  readonly extensions: readonly ExtensionEntry[];
  /** Sorted by package, file, and pointer. */
  readonly diagnostics: readonly RegistryDiagnostic[];
}

export interface RegistryOptions {
  /** The host package's directory, apps/web. */
  readonly hostDir: string;
}

/** The host's install command, which remedies name. */
export const HOST_PACKAGE = '@portfolio/web';
const remove = (name: string) => `pnpm --filter ${HOST_PACKAGE} remove ${name}`;
const FALLBACK_PACKAGE = '@portfolio/fallback-composition';

/** The exports every variant needs: its component and its stylesheet. */
const VARIANT_EXPORTS = ['.', './styles.css'] as const;

/**
 * Reads the host's direct dependencies and checks every one whose
 * package.json declares a `portfolio.kind`. It never throws for a package's
 * sake: whatever's wrong with one is a diagnostic naming it.
 */
export async function readRegistry({ hostDir }: RegistryOptions): Promise<RegistryResult> {
  const diagnostics: RegistryDiagnostic[] = [];
  const variants: VariantEntry[] = [];
  const extensions: ExtensionEntry[] = [];
  const done = () => finish(variants, extensions, diagnostics);

  const hostFile = path.join(hostDir, 'package.json');
  const host = readJson(hostFile);
  if (!host.ok || !isRecord(host.value)) {
    diagnostics.push({
      code: 'registry.host-unreadable',
      severity: REGISTRY_CODES['registry.host-unreadable'],
      package: HOST_PACKAGE,
      manifestPath: 'package.json',
      pointer: '',
      message: `The host's package.json ${host.ok ? "isn't an object" : host.reason === 'missing' ? "can't be read" : "isn't valid JSON"}.`,
      remedy: 'Restore apps/web/package.json.',
    });
    return done();
  }
  const dependencies = isRecord(host.value.dependencies) ? host.value.dependencies : {};
  for (const name of Object.keys(dependencies).sort()) {
    await readDependency(name, hostDir, { diagnostics, variants, extensions });
  }

  duplicateIds(variants, hostDir, diagnostics);
  if (!variants.some((entry) => entry.manifest.id === FALLBACK_ID)) {
    diagnostics.push({
      code: 'registry.fallback-missing',
      severity: REGISTRY_CODES['registry.fallback-missing'],
      package: HOST_PACKAGE,
      manifestPath: 'package.json',
      pointer: '/dependencies',
      message: `No dependency registers the fallback composition, which renders in place of an unavailable variant.`,
      expected: FALLBACK_PACKAGE,
      remedy: `Add it back: pnpm --filter ${HOST_PACKAGE} add ${FALLBACK_PACKAGE}@workspace:*.`,
    });
  }
  return done();
}

interface Found {
  readonly diagnostics: RegistryDiagnostic[];
  readonly variants: VariantEntry[];
  readonly extensions: ExtensionEntry[];
}

async function readDependency(name: string, hostDir: string, found: Found) {
  const at = (file: string) => posix(path.relative(hostDir, file));
  const dir = findInstalled(name, hostDir);
  if (!dir) {
    found.diagnostics.push({
      code: 'registry.package-missing',
      severity: REGISTRY_CODES['registry.package-missing'],
      package: name,
      manifestPath: 'package.json',
      pointer: toPointer(['dependencies', name]),
      message: `${name} is a dependency, and it isn't installed.`,
      remedy: `Run pnpm install, or uninstall it: ${remove(name)}.`,
    });
    return;
  }
  const packageFile = path.join(dir, 'package.json');
  const read = readJson(packageFile);
  const report = reporter(found.diagnostics, name, undefined, at(packageFile));
  if (!read.ok || !isRecord(read.value)) {
    report(
      'registry.package-invalid',
      [],
      `Its package.json ${read.ok ? "isn't an object" : "isn't valid JSON"}.`,
      'Reinstall it, or pin a release with a valid package.json.',
    );
    return;
  }
  const pkg = read.value as PackageJson;
  // Only packages that say what they are take part; next and react don't.
  if (pkg.portfolio === undefined) return;
  const kind = isRecord(pkg.portfolio) ? pkg.portfolio.kind : undefined;
  if (typeof kind !== 'string' || !(REGISTRY_KINDS as readonly string[]).includes(kind)) {
    report(
      'registry.kind-unknown',
      isRecord(pkg.portfolio) ? ['portfolio', 'kind'] : ['portfolio'],
      kind === undefined
        ? "has no kind, so the host can't tell what the package registers."
        : "names a kind of package this host doesn't register.",
      'Upgrade or pin a release built for this host.',
      {
        expected: REGISTRY_KINDS.join(' | '),
        ...(kind !== undefined ? { actual: String(kind) } : {}),
      },
    );
    return;
  }
  if (pkg.name !== name) {
    report(
      'registry.package-invalid',
      ['name'],
      "isn't the name the host depends on it by, as an npm: alias makes it.",
      'Depend on the package by its own name.',
      { expected: name, ...(typeof pkg.name === 'string' ? { actual: pkg.name } : {}) },
    );
    return;
  }
  if (typeof pkg.version !== 'string' || pkg.version === '') {
    report('registry.package-invalid', ['version'], 'is missing.', 'Pin a release with a version.');
    return;
  }
  const version = pkg.version;
  const fail = reporter(found.diagnostics, name, version, at(packageFile));
  if ((PACK_KINDS as readonly string[]).includes(kind)) {
    fail(
      'registry.no-validator',
      ['portfolio', 'kind'],
      `is ${kind}, a kind #19 adds validators for, and this host has none yet, so it can't register the package.`,
      'Wait for a host that checks it.',
      { actual: kind },
    );
    return;
  }
  if (kind === 'variant') {
    const entry = readVariant(name, version, dir, pkg, hostDir, found.diagnostics);
    if (entry) found.variants.push(entry);
  } else {
    const entry = await readExtension(name, version, dir, pkg, hostDir, found.diagnostics);
    if (entry) found.extensions.push(entry);
  }
}

type Report = (
  code: RegistryCode,
  pointer: readonly (string | number)[],
  message: string,
  remedy: string,
  extra?: { expected?: string; actual?: string },
) => void;

/** Records for one package's file. Each remedy also says how to uninstall it. */
function reporter(
  diagnostics: RegistryDiagnostic[],
  name: string,
  version: string | undefined,
  manifestPath: string,
): Report {
  return (code, pointer, message, remedy, extra = {}) => {
    const where = toPointer(pointer);
    diagnostics.push({
      code,
      severity: REGISTRY_CODES[code],
      package: name,
      ...(version !== undefined ? { version } : {}),
      manifestPath,
      pointer: where,
      message: where ? `${where} ${message}` : message,
      ...extra,
      remedy: `${remedy} Or uninstall it: ${remove(name)}.`,
    });
  };
}

function readVariant(
  name: string,
  version: string,
  dir: string,
  pkg: PackageJson,
  hostDir: string,
  diagnostics: RegistryDiagnostic[],
): VariantEntry | undefined {
  const at = (file: string) => posix(path.relative(hostDir, file));
  const packageFile = path.join(dir, 'package.json');
  const fail = reporter(diagnostics, name, version, at(packageFile));
  const declared = isRecord(pkg.portfolio) ? pkg.portfolio.manifest : undefined;
  if (typeof declared !== 'string' || declared === '') {
    fail(
      'registry.manifest-missing',
      ['portfolio', 'manifest'],
      'is missing, so the host has no manifest.json to read.',
      'Upgrade or pin a release that names its manifest, such as "manifest": "./manifest.json".',
      { expected: './manifest.json' },
    );
    return undefined;
  }
  const manifestFile = inside(dir, declared);
  if (!manifestFile) {
    fail(
      'registry.package-invalid',
      ['portfolio', 'manifest'],
      'names a file outside the package.',
      'Upgrade or pin a release whose manifest is in the package.',
      { actual: declared },
    );
    return undefined;
  }
  const raw = readJson(manifestFile);
  if (!raw.ok && raw.reason === 'missing') {
    fail(
      'registry.file-missing',
      ['portfolio', 'manifest'],
      "names a file the package doesn't have.",
      'Reinstall the package, or pin a release that ships its manifest.',
      { actual: declared },
    );
    return undefined;
  }
  const manifestPath = at(manifestFile);
  if (!raw.ok) {
    reporter(diagnostics, name, version, manifestPath)(
      'registry.manifest-syntax',
      [],
      "The manifest isn't valid JSON.",
      'Upgrade or pin a release whose manifest parses.',
    );
    return undefined;
  }

  const checked = validateManifest(raw.value, { packageName: name, exports: pkg.exports });
  for (const record of checked.diagnostics)
    diagnostics.push(fromManifest(record, name, version, manifestPath));

  let complete = checked.ok;
  const keys = exportKeys(pkg.exports);
  for (const key of VARIANT_EXPORTS) {
    if (!keys.includes(key)) {
      fail(
        'registry.export-missing',
        ['exports'],
        `has no "${key}", which every variant exports: ${key === '.' ? 'its component' : 'its stylesheet'}.`,
        `Upgrade or pin a release that exports "${key}".`,
        { expected: key },
      );
      complete = false;
    }
  }
  const subpaths = [
    ...VARIANT_EXPORTS.filter((key) => keys.includes(key)),
    ...(checked.ok ? (checked.manifest.enhancements ?? []).map((item) => item.export) : []),
  ];
  for (const key of subpaths) {
    if (!keys.includes(key)) continue; // validateManifest reported a missing enhancement export.
    if (!exportFile(dir, pkg, key)) {
      fail(
        'registry.file-missing',
        ['exports', key],
        "points at a file the package doesn't have.",
        'Reinstall the package, or pin a release that ships it.',
        { actual: String(exportTarget(pkg, key) ?? '') },
      );
      complete = false;
    }
  }
  if (!checked.ok || !complete) return undefined;
  const { manifest } = checked;
  return {
    kind: 'variant',
    packageName: name,
    version,
    dir,
    manifestFile,
    manifest,
    enhancements: (manifest.enhancements ?? []).map((item) => ({
      id: item.id,
      specifier: `${name}${item.export.slice(1)}`,
      file: posix(path.relative(dir, exportFile(dir, pkg, item.export)!)),
    })),
  };
}

/** The file an export points at, when it's in the package and exists. */
function exportFile(dir: string, pkg: PackageJson, key: string): string | undefined {
  const target = exportTarget(pkg, key);
  const file = target === undefined ? undefined : inside(dir, target);
  return file && fs.existsSync(file) && fs.statSync(file).isFile() ? file : undefined;
}

async function readExtension(
  name: string,
  version: string,
  dir: string,
  pkg: PackageJson,
  hostDir: string,
  diagnostics: RegistryDiagnostic[],
): Promise<ExtensionEntry | undefined> {
  const at = (file: string) => posix(path.relative(hostDir, file));
  const fail = reporter(diagnostics, name, version, at(path.join(dir, 'package.json')));
  const keys = exportKeys(pkg.exports);
  const entry = exportFile(dir, pkg, '.');
  if (!entry) {
    if (pkg.exports !== undefined && !keys.includes('.')) {
      fail(
        'registry.export-missing',
        ['exports'],
        'has no ".", which default-exports the content extension.',
        'Upgrade or pin a release that exports ".".',
        { expected: '.' },
      );
    } else {
      fail(
        'registry.file-missing',
        pkg.exports === undefined ? ['main'] : ['exports', '.'],
        "points at a file the package doesn't have.",
        'Reinstall the package, or pin a release that ships it.',
      );
    }
    return undefined;
  }
  const renderers = keys.includes('./renderers');
  if (renderers && !exportFile(dir, pkg, './renderers')) {
    fail(
      'registry.file-missing',
      ['exports', './renderers'],
      "points at a file the package doesn't have.",
      'Reinstall the package, or pin a release that ships it.',
    );
    return undefined;
  }
  const report = reporter(diagnostics, name, version, at(entry));
  let value: unknown;
  try {
    value = ((await import(pathToFileURL(entry).href)) as { default?: unknown }).default;
  } catch {
    report(
      'registry.extension-invalid',
      [],
      'Its "." export fails to load.',
      'Upgrade or pin a release that loads.',
    );
    return undefined;
  }
  if (!isRecord(value)) {
    report(
      'registry.extension-invalid',
      [],
      'Its "." export has no default export from defineContentExtension().',
      'Upgrade or pin a release that default-exports defineContentExtension(...).',
    );
    return undefined;
  }
  if (value.namespace !== name) {
    report(
      'registry.extension-invalid',
      ['namespace'],
      "isn't the package's name, which every content extension's namespace is.",
      'Upgrade or pin a release whose namespace is its package name.',
      {
        expected: name,
        ...(typeof value.namespace === 'string' ? { actual: value.namespace } : {}),
      },
    );
    return undefined;
  }
  try {
    defineContentExtension({ ...value } as unknown as ContentExtensionSpec);
  } catch (error) {
    report(
      'registry.extension-invalid',
      [],
      `defineContentExtension() refuses it: ${(error as Error).message}`,
      'Upgrade or pin a release whose definition is valid.',
    );
    return undefined;
  }
  return { kind: 'content-extension', packageName: name, version, dir, namespace: name, renderers };
}

/** A manifest record, located in its package. Errors also say how to uninstall it. */
function fromManifest(
  record: ManifestDiagnostic,
  name: string,
  version: string,
  manifestPath: string,
): RegistryDiagnostic {
  return {
    code: record.code,
    severity: record.severity,
    package: name,
    version,
    manifestPath,
    pointer: record.pointer,
    message: record.message,
    ...(record.expected !== undefined ? { expected: record.expected } : {}),
    ...(record.actual !== undefined ? { actual: record.actual } : {}),
    remedy:
      record.severity === 'error'
        ? `${record.remedy} Or uninstall it: ${remove(name)}.`
        : record.remedy,
  };
}

/** Two packages with one id: neither registers, and each record names the other. */
function duplicateIds(
  variants: VariantEntry[],
  hostDir: string,
  diagnostics: RegistryDiagnostic[],
) {
  const byId = new Map<string, VariantEntry[]>();
  for (const entry of variants) {
    byId.set(entry.manifest.id, [...(byId.get(entry.manifest.id) ?? []), entry]);
  }
  for (const [id, entries] of byId) {
    if (entries.length < 2) continue;
    for (const entry of entries) {
      const others = entries.filter((other) => other !== entry).map((other) => other.packageName);
      reporter(
        diagnostics,
        entry.packageName,
        entry.version,
        posix(path.relative(hostDir, entry.manifestFile)),
      )(
        'registry.duplicate-id',
        ['id'],
        `is ${id}, which ${others.join(' and ')} also registers, and ids are unique across the registry.`,
        `Uninstall one of them, or pin a release of one with another id.`,
        { actual: id },
      );
      variants.splice(variants.indexOf(entry), 1);
    }
  }
}

function finish(
  variants: VariantEntry[],
  extensions: ExtensionEntry[],
  diagnostics: RegistryDiagnostic[],
): RegistryResult {
  const sorted = [...diagnostics].sort(
    (a, b) =>
      compare(a.package, b.package) ||
      compare(a.manifestPath, b.manifestPath) ||
      compare(a.pointer, b.pointer) ||
      compare(a.code, b.code),
  );
  return {
    ok: !sorted.some(({ severity }) => severity === 'error'),
    variants: [...variants].sort((a, b) => compare(a.manifest.id, b.manifest.id)),
    extensions: [...extensions].sort((a, b) => compare(a.packageName, b.packageName)),
    diagnostics: sorted,
  };
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const posix = (file: string) => file.split(path.sep).join('/');
