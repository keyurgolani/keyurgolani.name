import 'server-only';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cache } from 'react';
import { resolvePortfolioView, validatePublicationUnit, type PublicView } from '@portfolio/schema';
import { readUnitFiles } from '@portfolio/schema/node';
import { fixtureSiteSelecting, isContractFixtureName } from '@portfolio/variant-contract';
import { compositionFor, CONTENT_EXTENSIONS, liveContext, type Composition } from '~/lib/variants';
import { MEDIA_BASE } from './public-view';

// The preview's dev fixture route (#7, Slice 1, item 8): one of #5's
// contract fixtures, read from this checkout's
// packages/variant-contract/fixtures/, with the snapshots and media document
// beside it and its site selecting the variant the route names, as pnpm
// test:variants renders it. Only `next dev` serves the route
// (server/routes.ts PREVIEW_DEV), so a build never reads a fixture, and none
// is in its output.

/** Where the fixtures are, from apps/web, where `next dev` runs. */
const FIXTURES_DIR = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  '..',
  '..',
  'packages',
  'variant-contract',
  'fixtures',
);

/** What the dev route renders: the fixture's public view, and the composition for it. */
export interface DevFixture {
  readonly view: PublicView;
  readonly composition: Composition;
}

/**
 * The contract fixture `fixture`, its site selecting `variant`. The route
 * table has checked both names; a fixture that doesn't validate throws,
 * which `next dev` shows. The page and its layout share one read per request.
 */
export const devFixture = cache((variant: string, fixture: string): DevFixture => {
  if (!isContractFixtureName(fixture)) throw new Error(`No contract fixture is named ${fixture}.`);
  const dir = path.join(/*turbopackIgnore: true*/ FIXTURES_DIR, fixture);
  const read = (name: string) => ({
    name,
    format: 'yaml' as const,
    text: readFileSync(path.join(/*turbopackIgnore: true*/ dir, name), 'utf8'),
  });
  const site = read('site.yml');
  const result = validatePublicationUnit(
    {
      portfolio: read('portfolio.yml'),
      site: { ...site, text: fixtureSiteSelecting(site.text, variant) },
    },
    liveContext(),
  );
  const unit = readUnitFiles(dir);
  const blocking = [...result.diagnostics, ...unit.diagnostics].filter(
    ({ severity }) => severity !== 'warning',
  );
  if (!result.pair || blocking.length > 0) {
    const findings = blocking.map(
      ({ document, code, message }) => `${document} ${code}: ${message}`,
    );
    throw new Error(`The ${fixture} fixture doesn't validate in ${variant}. ${findings.join(' ')}`);
  }
  // Where the site's renditions serve. No fixture has one yet, so each image
  // renders as unavailable, as it does on the site.
  const view = resolvePortfolioView(
    result.pair,
    { media: unit.media, snapshots: unit.snapshots },
    { mediaBase: MEDIA_BASE, extensions: CONTENT_EXTENSIONS },
  );
  return { view, composition: compositionFor(view.site.appearance.variant) };
});
