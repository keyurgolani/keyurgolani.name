import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  composeSchemas,
  resolvePortfolioView,
  type AppearanceCatalog,
  type ParsedPair,
  type UnitInput,
} from '@portfolio/schema';
import { loadPair, readUnitFiles } from '@portfolio/schema/node';
import {
  buildRenderInput,
  validateManifest,
  type RouteTarget,
  type VariantManifest,
  type VariantRenderInput,
} from '@portfolio/variant-contract';
import { FIXTURES_DIR } from '@portfolio/variant-contract/node';
import EditorialEvidence from '..';

// What the package's tests share (#13): the manifest, the package's own
// fixtures as parsed pairs, the contract fixtures as a host loads them, and
// a render of any of them to static markup, as the server sends it to a page
// with no JavaScript. Nothing here registers the package: it's checked the
// way tests/external-variant checks one no host installs, from its own files.

// tsx compiles JSX to React.createElement calls, so the tests supply React.
Object.assign(globalThis, { React });

export const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPO_ROOT = path.resolve(PACKAGE_DIR, '..', '..');

export const PACKAGE = JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8'));
export const RAW_MANIFEST = JSON.parse(
  readFileSync(path.join(PACKAGE_DIR, 'manifest.json'), 'utf8'),
);

export const MANIFEST = (() => {
  const result = validateManifest(RAW_MANIFEST, {
    packageName: PACKAGE.name,
    exports: PACKAGE.exports,
  });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return result.manifest as VariantManifest;
})();

const { PortfolioSchema, SiteSchema } = composeSchemas();

/** A site selecting this composition, every axis locked. */
export const SITE = SiteSchema.parse({
  schemaVersion: 2,
  appearance: {
    variant: 'editorial-evidence',
    designLanguage: 'platform-neutral',
    colorScheme: 'warm',
    typography: 'classic',
    displayMode: 'system',
  },
  visitorControls: {
    variant: 'locked',
    designLanguage: 'locked',
    colorScheme: 'locked',
    typography: 'locked',
    displayMode: 'locked',
  },
  motionPolicy: 'respect-os',
  features: { feed: true },
});

/** A pair from a portfolio document written in a test, on SITE. */
export function pairOf(portfolio: unknown): ParsedPair {
  return { portfolio: PortfolioSchema.parse(portfolio), site: SITE } as unknown as ParsedPair;
}

/** The color schemes and typography presets the contract fixtures name, as their own test lists them. */
const IDS = {
  colorScheme: ['warm', 'noir', 'ink-and-paper', 'nebula', 'aurora', 'solar'],
  typography: ['classic', 'modernist', 'geometric', 'humanist'],
  displayMode: ['system', 'light', 'dark', 'high-contrast'],
} as const;
const CATALOG: AppearanceCatalog = {
  ids: (axis) => (axis in IDS ? IDS[axis as keyof typeof IDS] : null),
  generatorInput: () => undefined,
};

/** A contract fixture's pair and unit files, as a host reads them from its source directory. */
export function contractUnit(name: string): { pair: ParsedPair; unit: UnitInput } {
  const dir = path.join(FIXTURES_DIR, name);
  const result = loadPair(dir, { catalog: CATALOG });
  assert.ok(result.ok, `${name}: ${JSON.stringify(result.diagnostics, null, 2)}`);
  const { snapshots, media } = readUnitFiles(dir);
  return { pair: result.pair, unit: { snapshots, ...(media ? { media } : {}) } };
}

export interface RenderOptions {
  readonly route?: RouteTarget;
  readonly basePath?: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly idPrefix?: string;
  readonly unit?: UnitInput;
}

/** The render input a host builds for the pair. */
export function inputFor(pair: ParsedPair, options: RenderOptions = {}): VariantRenderInput {
  return buildRenderInput({
    view: resolvePortfolioView(pair, options.unit ?? {}, { mediaBase: '/media' }),
    manifest: MANIFEST,
    route: options.route ?? { route: 'home' },
    basePath: options.basePath ?? '',
    query: options.query,
    origin: 'https://rowan.test',
    requestTime: '2026-01-01T00:00:00Z',
    idPrefix: options.idPrefix,
  });
}

/** The composition's markup for the pair, as the server renders it. */
export function render(pair: ParsedPair, options: RenderOptions = {}): string {
  return renderToStaticMarkup(<EditorialEvidence input={inputFor(pair, options)} />);
}

export const count = (html: string, pattern: RegExp) => html.match(pattern)?.length ?? 0;

/** Every id in the markup, in order. */
export const idsIn = (html: string) => [...html.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id!);

/** Every fragment a link in the markup points at on the same page. */
export const fragmentLinks = (html: string) =>
  [...html.matchAll(/\shref="#([^"]+)"/g)].map(([, id]) => decodeURIComponent(id!));

/** Where `needle` first appears in the markup, which must hold it. */
export function at(html: string, needle: string | RegExp): number {
  const index = typeof needle === 'string' ? html.indexOf(needle) : html.search(needle);
  assert.ok(index >= 0, `the markup holds ${needle}`);
  return index;
}
