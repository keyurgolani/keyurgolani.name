import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { composeSchemas, resolvePortfolioView, type ParsedPair } from '@portfolio/schema';
import {
  buildRenderInput,
  validateManifest,
  type VariantManifest,
} from '@portfolio/variant-contract';
import Composition from '.';

// The sample-data lines the Wednesday review quoted (A4), in Obsidian Atelier: a
// publication whose citation is written whole shows it at most once, and
// never under its structured authors; and a location of "online" isn't
// shown, on a podcast or a talk.

Object.assign(globalThis, { React });

const read = (file: string) =>
  JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
const PACKAGE = read('package.json');
const MANIFEST = (() => {
  const result = validateManifest(read('manifest.json'), {
    packageName: PACKAGE.name,
    exports: PACKAGE.exports,
  });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return result.manifest as VariantManifest;
})();

const CITATION =
  'Devi, A. (2021). A Survey of Anti-Entropy Mechanisms in Production Systems. ACM Computing Surveys, 54(2), 1–34.';

const { PortfolioSchema, SiteSchema } = composeSchemas();
const pair = {
  portfolio: PortfolioSchema.parse({
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Vale' },
    evidence: [
      {
        id: 'survey',
        type: 'publication',
        title: 'A Survey of Anti-Entropy Mechanisms in Production Systems',
        authors: ['Anamika Devi'],
        venue: 'ACM Computing Surveys',
        publishedAt: '2021-03',
        citation: CITATION,
      },
      {
        id: 'podcast',
        type: 'external-work',
        title: 'Incident History',
        description: 'Monthly podcast about famous software incidents.',
        url: 'https://incidenthistory.test',
        locationLabel: 'online',
        categories: ['Podcast', 'History'],
      },
      {
        id: 'talk',
        type: 'talk',
        title: 'When Latency Lies',
        venue: 'QCon London',
        location: 'online',
        presentedAt: '2025-04-10',
      },
    ],
    sections: [
      { id: 'publications', kind: 'evidence', title: 'Publications', items: ['survey'] },
      { id: 'talks', kind: 'evidence', title: 'Talks', items: ['talk'] },
      { id: 'elsewhere', kind: 'evidence', title: 'Elsewhere', items: ['podcast'] },
    ],
  }),
  site: SiteSchema.parse({
    schemaVersion: 2,
    appearance: {
      variant: 'obsidian-atelier',
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
  }),
} as unknown as ParsedPair;

const page = () => {
  const input = buildRenderInput({
    view: resolvePortfolioView(pair, {}, { mediaBase: '/media' }),
    manifest: MANIFEST,
    route: { route: 'home' },
    basePath: '',
    origin: 'https://rowan.test',
    requestTime: '2026-01-01T00:00:00Z',
  });
  return renderToStaticMarkup(<Composition input={input} />)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ');
};

test('a whole citation shows at most once, and never beside its structured authors (A4)', () => {
  const text = page();
  const cited = text.split(CITATION.slice(0, -1)).length - 1;
  assert.ok(cited <= 1, `the citation ${cited} times`);
  // The citation says Devi, A.: the structured author's name is the doubling.
  if (cited === 1) assert.doesNotMatch(text, /Anamika Devi/);
  assert.match(text, /A Survey of Anti-Entropy Mechanisms/);
});

test('a location of "online" is not shown, on the podcast or the talk (A4)', () => {
  const text = page();
  assert.match(text, /Incident History/);
  assert.match(text, /When Latency Lies/);
  assert.doesNotMatch(text, /\bonline\b/i);
});
