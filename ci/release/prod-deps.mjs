#!/usr/bin/env node
// The production dependency inventory Grype scans (docs/releasing.md): every
// package the app depends on at run time, read from pnpm-lock.yaml alone, so
// it needs no install and reads any commit's lockfile (`git show`).
//
//   node ci/release/prod-deps.mjs <pnpm-lock.yaml> <out.cdx.json>
//
// It starts at apps/web's dependencies and optionalDependencies, follows
// workspace links into the linked packages' own, and walks the lockfile's
// snapshots from there. devDependencies never join, at any level, and nor
// does an optional peer the shipped tree doesn't itself depend on. The output
// is a CycloneDX 1.5 SBOM of npm components, which `grype sbom:<file>` reads.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

/** The importer the image ships. */
export const APP_IMPORTER = 'apps/web';
const PROD_FIELDS = ['dependencies', 'optionalDependencies'];

/** A snapshot key's package name and version, without its peer suffix: `next@16.2.4(react@19)` is next 16.2.4. */
export function splitKey(key) {
  const bare = String(key).replace(/\(.*$/, '');
  const at = bare.lastIndexOf('@');
  if (at <= 0) return null;
  return { name: bare.slice(0, at), version: bare.slice(at + 1) };
}

/**
 * The snapshot key a dependency entry points at. An entry is `name: version`,
 * where version may carry a peer suffix, or `alias: realname@version` for an
 * npm alias.
 */
export function snapshotKey(name, version) {
  const value = String(version);
  if (/^[^(]+@/.test(value) && !/^\d/.test(value)) return value;
  return `${name}@${value}`;
}

/**
 * The production packages in a lockfile, sorted by name and version, as
 * [{ name, version }]. Throws on a lockfile it can't read.
 */
export function productionPackages(lockfileText, importer = APP_IMPORTER) {
  const lock = parse(lockfileText);
  if (!lock || typeof lock !== 'object') throw new Error('pnpm-lock.yaml is empty');
  if (!String(lock.lockfileVersion ?? '').startsWith('9.')) {
    throw new Error(`pnpm-lock.yaml is lockfileVersion ${lock.lockfileVersion}, not 9.x`);
  }
  const importers = lock.importers ?? {};
  const snapshots = lock.snapshots ?? {};
  const packages = lock.packages ?? {};
  if (!importers[importer]) throw new Error(`pnpm-lock.yaml has no importer ${importer}`);

  const found = new Map();
  const seenImporters = new Set();
  const queue = [];
  const visitImporter = (id) => {
    const key = path.posix.normalize(id);
    if (seenImporters.has(key)) return;
    seenImporters.add(key);
    const entry = importers[key];
    if (!entry) throw new Error(`pnpm-lock.yaml links to ${key}, which has no importer`);
    for (const field of PROD_FIELDS) {
      for (const [name, spec] of Object.entries(entry[field] ?? {})) {
        const version = String(spec?.version ?? '');
        if (version.startsWith('link:')) {
          visitImporter(path.posix.join(key, version.slice('link:'.length)));
        } else if (version) {
          queue.push(snapshotKey(name, version));
        }
      }
    }
  };
  visitImporter(importer);

  while (queue.length > 0) {
    const key = queue.pop();
    if (found.has(key)) continue;
    const pkg = splitKey(key);
    if (!pkg) throw new Error(`pnpm-lock.yaml names a package it can't read: ${key}`);
    found.set(key, pkg);
    const snapshot = snapshots[key];
    if (!snapshot) continue;
    // An optional peer is the dependent's to ship. The lockfile lists one
    // the workspace met anywhere, so next's optional @playwright/test, met
    // only by a dev dependency, stays out. A required peer is always
    // installed, so it stays in.
    const meta = packages[`${pkg.name}@${pkg.version}`]?.peerDependenciesMeta ?? {};
    const optionalPeers = new Set(
      Object.entries(meta)
        .filter(([, value]) => value?.optional === true)
        .map(([name]) => name),
    );
    for (const field of PROD_FIELDS) {
      for (const [name, version] of Object.entries(snapshot[field] ?? {})) {
        if (optionalPeers.has(name) || String(version).startsWith('link:')) continue;
        queue.push(snapshotKey(name, version));
      }
    }
  }

  const unique = new Map();
  for (const pkg of found.values()) unique.set(`${pkg.name}@${pkg.version}`, pkg);
  return [...unique.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
}

/** The npm purl for a package: the scope's @ is percent-encoded. */
export function purl({ name, version }) {
  const encoded = name.startsWith('@') ? `%40${name.slice(1)}` : name;
  return `pkg:npm/${encoded}@${encodeURIComponent(version)}`;
}

/** A CycloneDX 1.5 SBOM with one library component per package. */
export function cyclonedx(packages, { name = 'portfolio-production-dependencies' } = {}) {
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: { component: { type: 'application', name } },
    components: packages.map((pkg) => ({
      type: 'library',
      'bom-ref': purl(pkg),
      name: pkg.name,
      version: pkg.version,
      purl: purl(pkg),
    })),
  };
}

function main(argv) {
  const [lockfile, out] = argv;
  if (!lockfile || !out) {
    console.error('usage: node ci/release/prod-deps.mjs <pnpm-lock.yaml> <out.cdx.json>');
    return 2;
  }
  const packages = productionPackages(readFileSync(lockfile, 'utf8'));
  writeFileSync(out, `${JSON.stringify(cyclonedx(packages), null, 2)}\n`);
  console.log(`[prod-deps] ${packages.length} production packages from ${lockfile} -> ${out}`);
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
