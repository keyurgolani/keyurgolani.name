import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolvePortfolioView, type ParsedPair } from '@portfolio/schema';
import { readPair } from '@portfolio/schema/node';
import {
  buildRenderInput,
  validateManifest,
  type VariantManifest,
} from '@portfolio/variant-contract';
import { contractFixture } from '@portfolio/variant-contract/node';
import SwissSignal from '.';

// What the owner wrote, on Swiss's own pages (the content sweep's drops,
// P3): each string the fallback composition shows, Swiss sets somewhere a
// reader sees it, in its own grid and type, on home or the work's own page.
// Each test reads the visible text of the pages, never an attribute, and
// never a line Swiss hides from assistive technology as a repeat.

Object.assign(globalThis, { React });

const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const RAW = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const ROOT = new URL('../../../', import.meta.url);

const MANIFEST = (() => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name, exports: PACKAGE.exports });
  assert.ok(result.ok, JSON.stringify(result.ok ? [] : result.diagnostics));
  return result.manifest as VariantManifest;
})();

function pairOf(name: string): ParsedPair {
  const files =
    name === 'sample'
      ? {
          portfolio: new URL('portfolio.example.yml', ROOT).pathname,
          site: new URL('site.example.yml', ROOT).pathname,
        }
      : contractFixture(name).files;
  const read = readPair(files);
  assert.ok(read.ok, `${name}: ${JSON.stringify(read)}`);
  return read.pair;
}

/** A page's markup: home, or a work's own page by its slug. */
function page(fixture: string, slug?: string): string {
  const input = buildRenderInput({
    view: resolvePortfolioView(pairOf(fixture), { snapshots: {} }, { mediaBase: '/media' }),
    manifest: MANIFEST,
    route: slug ? { route: 'work', slug } : { route: 'home' },
    basePath: '',
    origin: 'https://rowan.test',
    requestTime: '2026-11-01T12:00:00Z',
  });
  return renderToStaticMarkup(<SwissSignal input={input} />);
}

/** What a reader sees: the text outside elements hidden from assistive technology, decoded, one space apart. */
function seen(markup: string): string {
  let text = markup.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, ' ');
  // An element hidden as a repeat (aria-hidden) holds no nested element of its own name here.
  text = text.replace(/<(\w+)[^>]*\saria-hidden="true"[^>]*>[\s\S]*?<\/\1>/g, ' ');
  return (
    text
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      // Tags part words from their punctuation; the page doesn't.
      .replace(/\s+([,.;:”)])/g, '$1')
      .replace(/([“(])\s+/g, '$1')
  );
}

function shows(text: string, wanted: readonly string[], where: string) {
  const missing = wanted.filter((each) => !text.includes(each));
  assert.deepEqual(missing, [], `${where} sets every one`);
}

// ── Media: captions, where a frame was taken, its tags ──────────────────

test("an image series' contact sheet keeps every frame, ready or not, with its caption and where it was taken", () => {
  shows(seen(page('photography')), ['The 6:10 to Vinga', 'Nets, Fiskebäckskil'], 'photography');
  shows(seen(page('missing-media')), ['The harbor', 'The hills'], 'missing-media');
  const large = seen(page('large'));
  shows(
    large,
    Array.from({ length: 99 }, (_, index) => `Photo ${index + 2} `),
    'large, all hundred frames',
  );
  shows(
    seen(page('sample')),
    [
      '1,300 steps to the Sri Bhramaramba temple',
      'The last bus back from Mysore',
      'Hampi, India',
      'Srisailam, India',
      'Mysore, India',
    ],
    'the sample',
  );
  shows(seen(page('complete')), ['Gallery location', 'Gallery tag'], 'complete');
});

test("a sheet's frame with no image yet holds its place as the kit's unavailable box, inside the frame", () => {
  const markup = page('missing-media');
  const sheet = /<ol class="ss-sheet"[^>]*>([\s\S]*?)<\/ol>/.exec(markup)?.[1] ?? '';
  assert.equal(sheet.match(/<li>/g)?.length, 2, 'both frames');
  assert.equal(
    sheet.match(/data-media-state="unavailable"/g)?.length,
    2,
    'each an unavailable box',
  );
});

test("a work's page sets its own images after the cover as numbered figures, each with its caption", () => {
  const text = seen(page('complete', 'project-name'));
  shows(text, ['Fig. 1', 'Project shot caption'], 'the case page');
  assert.ok(text.indexOf('Fig. 1') < text.indexOf('Project shot caption'));
});

test("a custom item's images keep their captions", () => {
  shows(seen(page('complete')), ['Custom item caption'], 'complete');
});

// ── Links: each named in the owner's words ─────────────────────────────

/** Every link's text and address, in the order the page has them. */
const links = (markup: string) =>
  [...markup.matchAll(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(([, href, inner]) => ({
    href: href!,
    text: seen(inner!).trim(),
  }));

const linked = (markup: string, text: string, href: string) =>
  links(markup).some((link) => link.text.startsWith(text) && link.href === href);

test("a works index row links the work's own links, each by the owner's label", () => {
  const large = page('large');
  for (const n of [1, 50, 100]) {
    assert.ok(linked(large, 'Visit', `https://large.test/projects/${n}`), `project ${n}`);
  }
  assert.ok(
    linked(page('sample'), 'Read the curriculum', 'https://example.com/chaos-curriculum'),
    'the sample',
  );
  assert.ok(
    linked(page('music'), 'Listen', 'https://joana.bandcamp.test/album/mare-alta'),
    'music',
  );
});

test("an episode's row links its own links, by their labels", () => {
  assert.ok(linked(page('complete'), 'Episode link', 'https://pod.rowan.test/12/notes'));
});

test('a custom item links its links by their labels, its title in plain words', () => {
  const complete = page('complete');
  assert.ok(linked(complete, 'Custom item link', 'https://custom.rowan.test/item'));
  assert.ok(!linked(complete, 'Custom item title', 'https://custom.rowan.test/item'));
  assert.ok(linked(page('mixed'), 'التسجيل', 'https://haddad.test/workshop'));
});

test("work elsewhere names its address by the owner's button text", () => {
  assert.ok(linked(page('complete'), 'External button', 'https://photos.rowan.test'));
  assert.ok(linked(page('photography'), 'Visit the shop', 'https://prints.lindqvist.test'));
  assert.ok(linked(page('sample'), 'Visit gallery', 'https://anamika.photography'));
});

// ── Skills and tags: the owner's lists of words ────────────────────────

/** The text of the table row with `id`. */
const row = (markup: string, id: string) =>
  seen(new RegExp(`<tr id="${id}"[^>]*>([\\s\\S]*?)</tr>`).exec(markup)?.[1] ?? '');

test("a role's skills read in its row, after what it involved", () => {
  assert.match(
    row(page('complete'), 'experience-role-experience-organization'),
    /Skills: Experience skill\./,
  );
  assert.match(
    row(page('sample'), 'senior-engineer-mosaic-search'),
    /Skills: Information retrieval, Python, Go, Kafka, Postgres, and Mentorship\./,
  );
  assert.match(
    row(page('sample'), 'research-assistant-iit-bombay-formal-methods-lab'),
    /Skills: TLA\+, Coq, and Distributed protocols\./,
  );
});

test("a piece of writing's tags read under it in its row", () => {
  assert.match(row(page('complete'), 'writing-title'), /Writing tag/);
  assert.match(
    row(page('sample'), 'a-brief-history-of-the-phrase-cattle-not-pets'),
    /history, infrastructure/,
  );
});

// ── Works: their credits and their words ───────────────────────────────

/** The text of the works index row with `id`. */
const indexRow = (markup: string, id: string) =>
  seen(
    new RegExp(
      `<li class="ss-row[^"]*" id="${id}"[^>]*>([\\s\\S]*?)</li>\\s*(?=<li class="ss-row|</ol>)`,
    ).exec(markup)?.[1] ?? '',
  );

test("a piece of writing's excerpt reads in its row, in quotation marks", () => {
  assert.match(row(page('complete'), 'writing-title'), /“Writing excerpt”/);
  assert.match(row(page('writing'), 'the-weather-in-leith'), /“Rain is a kind of punctuation\.”/);
  const sample = page('sample');
  assert.match(
    row(sample, 'postmortems-are-an-editing-problem'),
    /“The first draft is always too long, too defensive, and too sure of itself\.”/,
  );
});

test("an episode's row credits its show and its guests, and keeps its show notes", () => {
  const episode = row(page('complete'), 'episode-title');
  assert.match(episode, /Episodes show name, with Guest One/);
  assert.match(episode, /Show notes Episode show notes\./);
  assert.match(row(page('mixed'), 'work-2'), /with سامي يوسف/);
});

test("a record's credits: its role beside its artist and label, on its own and in the index with its tracks", () => {
  const complete = page('complete');
  assert.match(seen(complete), /Release artist, Release label, [^(]*\(Release role\)/);
  assert.match(seen(page('sample')), /Anamika Devi, Self-released, [^(]*\(Producer, composer\)/);
  // A show the section's title names is said once, in the head, not again in each row.
  const incident = page('sample');
  assert.doesNotMatch(row(incident, 'knight-capital-twelve-years-on'), /Incident History/);
  assert.match(
    row(incident, 'the-2010-blackberry-outage-was-not-about-blackberry'),
    /with Mira Anand/,
  );
  const mare = indexRow(page('music'), 'mare-alta');
  assert.match(mare, /Joana Ribeiro Quarteto, Selo Capibaribe/);
  assert.match(mare, /Abertura .*Ponte Velha/);
});

test("a works index row keeps the work's description after its summary, and its organization", () => {
  assert.match(indexRow(page('sample'), 'small-traces'), /OpenTelemetry is a wonderful thing/);
  assert.match(
    indexRow(page('sample'), 'chaos-curriculum'),
    /Written for teams with no game-day tradition/,
  );
  assert.match(indexRow(page('complete'), 'project-name'), /Project role, Project organization/);
  assert.match(seen(page('complete', 'project-name')), /Organization Project organization/);
});

// ── Evidence: the owner's citation, abstracts, sources and statements ──

test("a publication keeps the owner's own citation, under Cite, beside its abstract", () => {
  const complete = seen(page('complete'));
  assert.match(complete, /Abstract Publication abstract\. Cite Publication citation/);
  assert.match(
    seen(page('sample')),
    /Cite Devi, A\. \(2021\)\. A Survey of Anti-Entropy Mechanisms in Production Systems\./,
  );
});

test("a talk's abstract reads in its row, under Abstract", () => {
  assert.match(row(page('complete'), 'talk-title'), /Talk description\. Abstract Talk abstract\./);
});

test("a figure's source is named, and linked, in its row", () => {
  const complete = page('complete');
  assert.match(row(complete, 'stat-label'), /Stat source/);
  assert.ok(linked(complete, 'Stat source', 'https://data.rowan.test/ships'));
});

test('a record a work cites keeps its statement On the record, under its title', () => {
  assert.match(
    seen(page('engineering', 'shipyard')),
    /shipyard on Code Thirty teams deploy with it\./,
  );
  assert.match(
    seen(page('photography', 'harbors')),
    /Harbors, Hasselblad Center Forty prints from the series, shown for three months\./,
  );
});

// ── Heads: the hero's name and subtitle, subtitles, a services group ───

test("the masthead keeps the identity's name; the hero's own name is the poster's first line, and its subtitle sits under the rule", () => {
  const markup = page('complete');
  const masthead = /<header class="ss-masthead">([\s\S]*?)<\/header>/.exec(markup)?.[1] ?? '';
  assert.match(seen(masthead), /Rowan Vale/);
  assert.doesNotMatch(seen(masthead), /Hero name/);
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(markup)?.[1] ?? '';
  assert.match(h1, /<span class="ss-poster__name" data-type-role="title">Hero name<\/span>/);
  assert.match(seen(h1), /^ ?Hero name/);
  // A hero with no name of its own, or the identity's, keeps the unseen prefix, as before.
  const sample = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(page('sample'))?.[1] ?? '';
  assert.doesNotMatch(sample, /ss-poster__name/);
  const left = /<div class="ss-poster__left">([\s\S]*?)<\/div>/.exec(markup)?.[1] ?? '';
  assert.match(seen(left), /Hero subtitle/);
  // The identity's name still signs the colophon.
  assert.match(
    seen(/<footer class="ss-colophon">([\s\S]*?)<\/footer>/.exec(markup)?.[1] ?? ''),
    /Rowan Vale/,
  );
});

test('a subtitle shows where its section head is the part opener, and on the figures band', () => {
  const text = seen(page('complete'));
  assert.match(text, /Contact subtitle/);
  assert.match(text, /Tenure title Tenure subtitle/);
});

test("services read under their group's name, a row group of the table", () => {
  const markup = page('complete');
  assert.match(markup, /<th scope="rowgroup"[^>]*>Service group<\/th>/);
});

// ── D's design check (P3): the line after a paragraph ──────────────────

test("a role's skills and work elsewhere's tags follow the owner's paragraph directly, where the shared gap rule reaches them", () => {
  const research = /<tr id="research-assistant-iit-bombay-formal-methods-lab"[\s\S]*?<\/tr>/.exec(
    page('sample'),
  )![0];
  assert.match(
    research,
    /<\/div><p class="ss-skills"/,
    'the skills line right after the paragraph',
  );
  const elsewhere = page('sample');
  assert.match(
    elsewhere,
    /class="ss-sheet-fact__main"[\s\S]*?<\/div><p class="ss-muted" data-type-role="body-compact">Photography, Travel/,
  );
});
