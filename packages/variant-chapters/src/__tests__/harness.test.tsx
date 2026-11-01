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
import Chapters from '..';

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
    variant: 'chapters',
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
        variantControls: { chapters: { version: 1, values: controls } },
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

/** A pair with Chapters' stored control values, as an owner's site.yml sets them. */
function withControls(pair: ParsedPair, controls?: Record<string, unknown>): ParsedPair {
  if (!controls) return pair;
  const site = pair.site as unknown as Record<string, unknown>;
  const stored = (site.variantControls ?? {}) as Record<string, unknown>;
  return {
    ...pair,
    site: { ...site, variantControls: { ...stored, chapters: { version: 1, values: controls } } },
  } as unknown as ParsedPair;
}

/** The bundled sample as the demo renders it, with its frozen GitHub snapshot, and controls if given. */
export function sampleInput(
  idPrefix?: string,
  controls?: Record<string, unknown>,
  route?: RouteTarget,
): VariantRenderInput {
  const read = readPair({
    portfolio: path.join(REPO_ROOT, 'portfolio.example.yml'),
    site: path.join(REPO_ROOT, 'site.example.yml'),
  });
  assert.ok(read.ok, JSON.stringify(read.diagnostics));
  const unit = readUnitFiles(REPO_ROOT);
  return inputFor(withControls(read.pair, controls), {
    ...(route ? { route } : {}),
    unit: { snapshots: unit.snapshots },
    ...(idPrefix ? { idPrefix } : {}),
  });
}

/** A contract fixture, as the host loads it. */
export function fixtureInput(name: string, controls?: Record<string, unknown>): VariantRenderInput {
  const dir = path.join(FIXTURES_DIR, name);
  const loaded = loadPair(dir, {
    catalog: { ids: () => null, generatorInput: () => undefined },
  });
  assert.ok(loaded.ok, `${name}: ${JSON.stringify(loaded.diagnostics)}`);
  const { snapshots, media } = readUnitFiles(dir);
  return inputFor(withControls(loaded.pair, controls), {
    unit: { snapshots, ...(media ? { media } : {}) },
  });
}

export const FIXTURE_NAMES: readonly string[] = CONTRACT_FIXTURES.map((fixture) =>
  typeof fixture === 'string' ? fixture : (fixture as { name: string }).name,
);

/** The composition's markup for the input, as the server renders it. */
export const renderInput = (input: VariantRenderInput) =>
  renderToStaticMarkup(<Chapters input={input} />);

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

/**
 * Five roles three years apart, the last one open, with two essays and a talk dated in each:
 * five chapters, so all five inks show (review question 2), and the owner's overrides have
 * boundaries to move.
 */
export const fiveErasDoc = (): Record<string, unknown> => ({
  schemaVersion: 3,
  locale: 'en',
  direction: 'ltr',
  identity: { name: 'Rowan Vale', tagline: 'Systems engineer' },
  chronology: ['Acme', 'Birch', 'Cedar', 'Dune', 'Elm'].map((org, i) => ({
    id: `role-${i}`,
    kind: 'role',
    title: 'Engineer',
    organization: org,
    period:
      i === 4
        ? { start: `${2010 + i * 3}-01` }
        : { start: `${2010 + i * 3}-01`, end: `${2011 + i * 3}-12` },
  })),
  works: Array.from({ length: 10 }, (_, i) => ({
    id: `essay-${i}`,
    title: `Essay ${i}`,
    medium: 'writing',
    publishedAt: `${2010 + Math.floor(i / 2) * 3}-0${(i % 2) + 3}`,
    summary: 'A short piece. '.repeat(12),
  })),
  evidence: Array.from({ length: 5 }, (_, i) => ({
    id: `talk-${i}`,
    type: 'talk',
    title: `Talk ${i}`,
    presentedAt: `${2010 + i * 3}-06`,
    description: 'A talk about the work. '.repeat(10),
  })),
  sections: [
    { kind: 'hero', id: 'top' },
    { kind: 'chronology', id: 'experience', title: 'Experience' },
    {
      kind: 'works',
      id: 'essays',
      title: 'Essays',
      items: Array.from({ length: 10 }, (_, i) => `essay-${i}`),
    },
    {
      kind: 'evidence',
      id: 'talks',
      title: 'Talks',
      items: Array.from({ length: 5 }, (_, i) => `talk-${i}`),
    },
  ],
});

/** The five-era portfolio's render input, with controls if given. */
export const fiveEras = (controls?: Record<string, unknown>, route?: RouteTarget) =>
  inputFor(pairOf(fiveErasDoc(), controls), route ? { route } : {});
