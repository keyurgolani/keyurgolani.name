import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  composeSchemas,
  resolvePortfolioView,
  type ParsedPair,
  type UnitInput,
} from '@portfolio/schema';
import { loadPair, readPair, readUnitFiles } from '@portfolio/schema/node';
import {
  buildRenderInput,
  validateManifest,
  type RouteTarget,
  type VariantManifest,
  type VariantRenderInput,
} from '@portfolio/variant-contract';
import { CONTRACT_FIXTURES, FIXTURES_DIR } from '@portfolio/variant-contract/node';
import RawGrid from '..';

// (Named .test so the pair loader, server-only, may be imported here; it registers no test.)
// What the package's tests share: the manifest, the bundled sample and the
// contract fixtures as a host loads them, pairs written in a test, and a
// render of any of them to static markup, as the server sends it to a page
// with no JavaScript. Nothing here registers the package.

// tsx compiles JSX to React.createElement calls, so the tests supply React.
Object.assign(globalThis, { React });

export const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPO_ROOT = path.resolve(PACKAGE_DIR, '..', '..');

const PACKAGE = JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8'));
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
    variant: 'raw-grid',
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

/** A pair from a portfolio document written in a test, on SITE, with controls if given. */
export function pairOf(portfolio: unknown, controls?: Record<string, unknown>): ParsedPair {
  const site = controls
    ? SiteSchema.parse({
        ...SITE,
        variantControls: { 'raw-grid': { version: 1, values: controls } },
      })
    : SITE;
  return { portfolio: PortfolioSchema.parse(portfolio), site } as unknown as ParsedPair;
}

export interface RenderOptions {
  readonly route?: RouteTarget;
  readonly idPrefix?: string;
  readonly unit?: UnitInput;
}

/** The render input a host builds for the pair. */
export function inputFor(pair: ParsedPair, options: RenderOptions = {}): VariantRenderInput {
  return buildRenderInput({
    view: resolvePortfolioView(pair, options.unit ?? {}, { mediaBase: '/media' }),
    manifest: MANIFEST,
    route: options.route ?? { route: 'home' },
    basePath: '/sample',
    origin: 'https://rowan.test',
    requestTime: '2026-01-01T00:00:00Z',
    idPrefix: options.idPrefix,
  });
}

/** The bundled sample as the demo renders it, with its frozen GitHub snapshot. */
export function sampleInput(idPrefix?: string): VariantRenderInput {
  const read = readPair({
    portfolio: path.join(REPO_ROOT, 'portfolio.example.yml'),
    site: path.join(REPO_ROOT, 'site.example.yml'),
  });
  assert.ok(read.ok, JSON.stringify(read.diagnostics));
  const unit = readUnitFiles(REPO_ROOT);
  return inputFor(read.pair, {
    unit: { snapshots: unit.snapshots },
    ...(idPrefix ? { idPrefix } : {}),
  });
}

/** A contract fixture, as the host loads it. */
export function fixtureInput(name: string): VariantRenderInput {
  const dir = path.join(FIXTURES_DIR, name);
  const loaded = loadPair(dir, {
    catalog: { ids: () => null, generatorInput: () => undefined },
  });
  assert.ok(loaded.ok, `${name}: ${JSON.stringify(loaded.diagnostics)}`);
  const { snapshots, media } = readUnitFiles(dir);
  return inputFor(loaded.pair, { unit: { snapshots, ...(media ? { media } : {}) } });
}

export const FIXTURE_NAMES: readonly string[] = CONTRACT_FIXTURES.map((fixture) =>
  typeof fixture === 'string' ? fixture : (fixture as { name: string }).name,
);

/** The composition's markup for the input, as the server renders it. */
export const renderInput = (input: VariantRenderInput) =>
  renderToStaticMarkup(<RawGrid input={input} />);

/** The composition's markup for a pair. */
export const render = (pair: ParsedPair, options: RenderOptions = {}) =>
  renderInput(inputFor(pair, options));

export const count = (html: string, pattern: RegExp) => html.match(pattern)?.length ?? 0;

/** `text` as react-dom writes it into markup. */
export const escaped = (text: string) => renderToStaticMarkup(<>{text}</>);

/** Every id in the markup, in order. */
export const idsIn = (html: string) => [...html.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id!);

/** Every fragment a link in the markup points at on the same page. */
export const fragmentLinks = (html: string) =>
  [...html.matchAll(/\shref="#([^"]+)"/g)].map(([, id]) => decodeURIComponent(id!));
