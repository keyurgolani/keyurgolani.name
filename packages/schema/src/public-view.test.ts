import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { acmePortfolioPhotography } from './__fixtures__/acme-portfolio-photography';
import { parsePortfolio, parseSite } from './load';
import {
  publicSectionIndexes,
  toPublicView,
  type ParsedPair,
  type PublicPortfolio,
} from './public-view';

const SITE = [
  'schemaVersion: 2',
  'appearance:',
  '  variant: editorial',
  '  designLanguage: platform-neutral',
  '  colorScheme: warm',
  '  typography: classic',
  '  displayMode: system',
  '  extensions:',
  "    '@acme/portfolio-photography': { camera: Leica }",
  "    '@other/portfolio-music': { tempo: 90 }",
  'visitorControls:',
  '  variant: locked',
  '  designLanguage: locked',
  '  colorScheme: selectable',
  '  typography: locked',
  '  displayMode: selectable',
  'motionPolicy: respect-os',
  'features:',
  '  feed: true',
  'variantControls:',
  '  editorial:',
  '    version: 1',
  "    values: { extensions: { '@other/portfolio-music': kept } }",
  'sections:',
  '  plates: { hidden: true }',
  '',
].join('\n');

function pair(extensions = [acmePortfolioPhotography]): ParsedPair {
  const text = readFileSync(
    new URL('./__fixtures__/extensions/portfolio.yml', import.meta.url),
    'utf8',
  );
  const portfolio = parsePortfolio(text, 'yaml', { extensions });
  const site = parseSite(SITE, 'yaml', { extensions });
  assert.ok(portfolio.ok && site.ok);
  return { portfolio: portfolio.value, site: site.value };
}

test('hidden sections and unregistered extension data stay out of the public view', () => {
  const input = pair();
  const before = JSON.stringify(input);
  const view = toPublicView(input, { extensions: [acmePortfolioPhotography] });
  // plates is hidden, and nothing registers @other/portfolio-music.
  assert.deepEqual(
    view.portfolio.sections.map(({ id }) => id),
    ['exhibitions'],
  );
  assert.deepEqual(view.portfolio.identity.extensions, {
    '@acme/portfolio-photography': { camera: 'Leica M6', film: true },
  });
  assert.deepEqual(view.site.appearance.extensions, {
    '@acme/portfolio-photography': { camera: 'Leica' },
  });
  // Control values hold any keys, so nothing is taken out of them.
  assert.deepEqual(view.site.variantControls?.editorial?.values, {
    extensions: { '@other/portfolio-music': 'kept' },
  });
  // The pair itself is left as it was.
  assert.equal(JSON.stringify(input), before);
});

test('with nothing registered, every extension section and extensions entry is dropped', () => {
  const view = toPublicView(pair([]));
  assert.deepEqual(
    view.portfolio.sections.map(({ id }) => id),
    [],
  );
  assert.equal('extensions' in view.portfolio.identity, false);
  assert.equal('extensions' in view.site.appearance, false);
  assert.ok(!JSON.stringify(view.portfolio).includes('@other/portfolio-music'));
});

test("publicSectionIndexes says where each of the view's sections sits in the document", () => {
  const input = pair();
  const extensions = [acmePortfolioPhotography];
  // plates (0) is hidden and releases (2) is unregistered, so the view keeps exhibitions alone.
  assert.deepEqual(publicSectionIndexes(input, { extensions }), [1]);
  assert.deepEqual(publicSectionIndexes(input), []);
  // Matched by position, not by id: the repeat of a dropped section's id is still its own section.
  const [plates, exhibitions, releases] = input.portfolio.sections;
  const repeated: ParsedPair = {
    ...input,
    portfolio: {
      ...input.portfolio,
      sections: [releases!, { ...exhibitions!, id: releases!.id }, plates!],
    },
  };
  const indexes = publicSectionIndexes(repeated, { extensions });
  assert.deepEqual(indexes, [1]);
  const view = toPublicView(repeated, { extensions });
  assert.deepEqual(
    view.portfolio.sections.map(({ kind }) => kind),
    indexes.map((index) => repeated.portfolio.sections[index]!.kind),
  );
});

test('only toPublicView makes the portfolio a renderer takes', () => {
  const input = pair();
  const render = (portfolio: PublicPortfolio) => portfolio.identity.name;
  // @ts-expect-error A parsed portfolio isn't the public view's.
  assert.ok(render(input.portfolio));
  assert.ok(render(toPublicView(input).portfolio));
});
