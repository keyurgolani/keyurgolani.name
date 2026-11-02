import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sectionRenders } from '@portfolio/kit/sections';
import { resolvePortfolioView, type ParsedPair } from '@portfolio/schema';
import { readPair } from '@portfolio/schema/node';
import {
  buildRenderInput,
  validateManifest,
  type VariantManifest,
  type VariantRenderInput,
} from '@portfolio/variant-contract';
import {
  CONTRACT_FIXTURES,
  contractFixture,
  HIDDEN_CANARY,
} from '@portfolio/variant-contract/node';
import Schematic from '.';
import { countOf, dimensionLabels, sheetSet, signatureOf } from './model';

// Schematic's manifest, and over every contract fixture and the
// repository's sample, the home page: one h1 naming the owner, one main,
// every section that renders in exactly one Schematic frame (never the
// kit's shared renderer), unique ids under the prefix, every fragment
// landing, the cover's title block and the footer's drawing index present.

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const RAW = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const ROOT = new URL('../../../', import.meta.url);

const MANIFEST = (() => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name, exports: PACKAGE.exports });
  assert.ok(result.ok, JSON.stringify(result.ok ? [] : result.diagnostics));
  return result.manifest as VariantManifest;
})();

/** The name the cover draws: the hero's own, as the kit's hero takes it, else the identity's. */
function ownerName(input: VariantRenderInput): string {
  const hero = input.portfolio.sections.find((section) => section.kind === 'hero') as
    { name?: string } | undefined;
  return (hero?.name?.trim() || input.portfolio.identity.name).trim();
}

function inputOf(
  pair: ParsedPair,
  idPrefix = '',
  snapshots: Readonly<Record<string, unknown>> = {},
): VariantRenderInput {
  return buildRenderInput({
    view: resolvePortfolioView(pair, { snapshots }, { mediaBase: '/media' }),
    manifest: MANIFEST,
    route: { route: 'home' },
    basePath: '',
    origin: 'https://rowan.test',
    requestTime: '2026-10-26T12:00:00Z',
    idPrefix,
  });
}

function pairOf(name: string): ParsedPair {
  const read = readPair(contractFixture(name).files);
  assert.ok(read.ok, `${name}: ${JSON.stringify(read)}`);
  return read.pair;
}

export function samplePair(): ParsedPair {
  const read = readPair({
    portfolio: new URL('portfolio.example.yml', ROOT).pathname,
    site: new URL('site.example.yml', ROOT).pathname,
  });
  assert.ok(read.ok, JSON.stringify(read));
  return read.pair;
}

const SAMPLE_SNAPSHOTS = {
  github: JSON.parse(readFileSync(new URL('snapshots/github.json', ROOT), 'utf8')) as unknown,
};

const html = (input: VariantRenderInput) => renderToStaticMarkup(<Schematic input={input} />);
const ids = (markup: string) => [...markup.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id!);
const fragments = (markup: string) =>
  [...markup.matchAll(/\shref="[^"#]*#([^"]+)"/g)].map(([, id]) => decodeURIComponent(id!));

test('its manifest renders every core kind itself, without the kit layout, and owns home', () => {
  assert.equal(MANIFEST.renderedKinds.length, 14);
  assert.equal(MANIFEST.kitLayout, false);
  assert.equal(MANIFEST.routes.home, 'bespoke');
  assert.equal(MANIFEST.compositionFamily, 'document');
  assert.equal(MANIFEST.performanceTier, 'light');
  assert.equal(MANIFEST.budgets?.animation, 0);
  assert.equal(MANIFEST.budgets?.css, 10240);
  assert.equal(MANIFEST.visitorControl.placement, 'footer');
  // No dangling recipe until B's `schematic` recipe lands (lead A's rule).
  assert.equal((MANIFEST as { recommendedAppearance?: unknown }).recommendedAppearance, undefined);
});

const cases: { name: string; input: (prefix: string) => VariantRenderInput }[] = [
  ...CONTRACT_FIXTURES.map(({ name }) => ({
    name,
    input: (prefix: string) => inputOf(pairOf(name), prefix),
  })),
  { name: 'sample', input: (prefix: string) => inputOf(samplePair(), prefix, SAMPLE_SNAPSHOTS) },
];

for (const { name, input: build } of cases) {
  test(`${name}: one h1 naming the owner, one main, every section in one Schematic frame`, () => {
    for (const prefix of ['', 'pv-']) {
      const input = build(prefix);
      const markup = html(input);
      assert.equal(markup.match(/<h1[\s>]/g)?.length, 1, name);
      assert.equal(markup.match(/<main[\s>]/g)?.length, 1, name);
      const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(markup)![1]!.replace(/<[^>]+>/g, '');
      assert.ok(
        h1
          .replace(/&amp;/g, '&')
          .replace(/&#x27;/g, "'")
          .includes(ownerName(input)),
        `${name}: ${h1}`,
      );
      assert.doesNotMatch(markup, new RegExp(HIDDEN_CANARY), name);
      assert.doesNotMatch(markup, /data-renderer="shared"/);
      for (const section of input.portfolio.sections.filter((s) => sectionRenders(s, input))) {
        const frames =
          markup.match(new RegExp(`data-section-id="${section.id}"`, 'g'))?.length ?? 0;
        assert.equal(frames, 1, `${name}: ${section.id} is framed once`);
      }
      const all = ids(markup);
      assert.equal(
        new Set(all).size,
        all.length,
        `duplicate ids: ${all.filter((id, i) => all.indexOf(id) !== i)}`,
      );
      if (prefix) for (const id of all) assert.ok(id.startsWith(prefix), id);
      const known = new Set(all);
      for (const fragment of fragments(markup))
        assert.ok(known.has(fragment), `${name}: #${fragment} lands`);
      // SC-M1: the title block is on the cover, the drawing index in the footer, the dialog closed.
      assert.match(markup, /class="sx-tb" data-at="cover"/);
      assert.match(markup, /<footer class="sx-foot"><nav class="sx-foot__index"/);
      assert.match(markup, /<dialog class="sx-dialog"/);
      assert.doesNotMatch(markup, /<dialog[^>]* open/);
      // No hyphen in a year range.
      assert.doesNotMatch(
        markup.replace(/<[^>]+>/g, ' '),
        /\b(19|20)\d\d-(?:\s|now|(19|20)\d\d\b)/,
      );
      // No block inside a paragraph: the HTML parser would close the <p> and hydration would fail.
      for (const [para] of markup.matchAll(/<p[\s>](?:(?!<\/p>)[\s\S])*?<\/p>/g)) {
        assert.doesNotMatch(
          para.slice(2),
          /<(?:p|div|ul|ol|dl|section|figure|table|blockquote|details|h[1-6])[\s>]/,
          `${name}: ${para.slice(0, 120)}`,
        );
      }
      // Every Index control is one link to the footer's index, in every state: no
      // button waits hidden for the enhancement, and nothing hides a link for it.
      assert.doesNotMatch(markup, /<button[^>]*data-sx-open/, name);
      assert.doesNotMatch(markup, /data-sx-plain/, name);
      for (const [link] of markup.matchAll(/<a[^>]*data-sx-open[^>]*>/g))
        assert.match(
          link,
          new RegExp(`href="#${prefix}sx-index"|href="[^"]*#${prefix}sx-index"`),
          name,
        );
    }
  });
}

test('the sample: the thesis is the dimension label, Figure 1 is the signature, five sheets', () => {
  const input = inputOf(samplePair(), '', SAMPLE_SNAPSHOTS);
  const labels = dimensionLabels(input);
  assert.deepEqual(labels.width, { text: 'I make failure legible.', source: 'thesis' });
  assert.equal(labels.height, 'Principal Engineer, Reliability');
  assert.equal(signatureOf(input)?.id, 'postmortem-template-kit');
  const set = sheetSet(input);
  assert.deepEqual(
    set.sheets.map((sheet) => [sheet.no, sheet.id]),
    [
      ['S-01', 'about'],
      ['S-02', 'work'],
      ['S-03', 'writing'],
      ['S-04', 'record'],
      ['S-05', 'contact'],
    ],
  );
  const markup = html(input);
  // SC-M3: the thesis sits in the dimension over the name, read, in the headline role.
  assert.match(
    markup,
    /class="sx-dim sx-dim--h sx-elev__w"[^>]*><span class="sx-dim__label"><span data-type-role="headline" data-source="thesis">I make failure legible\.<\/span>/,
  );
  // The signature appears once as a figure; its works section refers back to it (N6).
  assert.equal(markup.match(/>Postmortem Template Kit<\/a><\/h2>/g)?.length, 1);
  assert.match(markup, /class="sx-backref"/);
  // SC-M5: no prose is set in a mono role.
  assert.doesNotMatch(markup, /data-type-role="(code|numeric)"[^>]*><p/);
});

test("home's outline (N3): Work keeps the signature's section, Record its glance and its words, the rest close", () => {
  const input = inputOf(samplePair(), '', SAMPLE_SNAPSHOTS);
  const set = sheetSet(input);
  const sheet = (id: string) => set.sheets.find((s) => s.id === id)!;
  const open = (id: string) => sheet(id).views.filter((v) => !v.closed);
  const work = open('work');
  assert.equal(work.length, 1);
  assert.ok(
    work[0]!.section.kind === 'works' && work[0]!.section.items.includes(set.signature!.id),
    'the open works section draws the signature',
  );
  for (const view of open('record')) {
    assert.equal(view.section.kind, 'evidence', view.title);
  }
  assert.ok(open('record').length >= 1);
  assert.ok(sheet('record').views.some((v) => v.closed));
  // About keeps the person and closes what follows, Skills and Stack included, so its
  // closed views run as one schedule at every width; Contact closes nothing; a closed
  // view never also folds on phones, and a closed practice view counts its rows.
  for (const v of sheet('about').views)
    assert.equal(
      v.closed,
      ['focus', 'fun-facts', 'quote'].includes(v.section.kind) ||
        (v.section.kind === 'practice' && ['services', 'skills', 'tools'].includes(v.section.part)),
      v.title,
    );
  for (const v of sheet('about').views.filter((v) => v.section.kind === 'practice' && v.closed))
    assert.ok((countOf(v.section, input) ?? 0) > 0, `${v.title} has a count`);
  // Skills and Stack count their groups, a quotation one, GitHub its repositories; the other lists their entries.
  const counted = html(input);
  assert.match(counted, />\s*\d+ groups?\s*</);
  assert.match(counted, />\s*1 quotation\s*</);
  assert.match(counted, />\s*\d+ repositor(y|ies)\s*</);
  assert.equal(
    sheet('about').views.filter((v) => v.folds).length,
    0,
    'no About view folds on its own beside the schedule',
  );
  assert.equal(sheet('contact').views.filter((v) => v.closed).length, 0);
  for (const s of set.sheets) for (const v of s.views) assert.ok(!(v.closed && v.folds), v.title);
  // Consecutive closed views run together: one schedule per run of them.
  const runs = set.sheets.reduce(
    (n, s) => n + s.views.filter((v, i) => v.closed && !s.views[i - 1]?.closed).length,
    0,
  );
  assert.equal(html(input).match(/class="sx-schedule"/g)?.length ?? 0, runs);
  // In the markup a closed view is a closed disclosure, with its id and heading.
  const markup = html(input);
  for (const s of set.sheets)
    for (const v of s.views.filter((v) => v.closed))
      assert.match(
        markup,
        new RegExp(
          `data-section-id="${v.section.id}"[^>]*>\\s*<details class="sx-fold" data-sx-outline="">`,
        ),
      );
});

test('every content link goes through hrefFor: /#id in evidence, the interface and About keeps the render’s prefix', () => {
  const pair = structuredClone(samplePair()) as ParsedPair & {
    portfolio: {
      evidence?: { url?: string }[];
      works?: { links?: { url: string }[]; url?: string }[];
      sections: { kind: string; primaryAction?: { url: string } }[];
    };
  };
  const here = '/#contact';
  for (const entry of pair.portfolio.evidence ?? []) entry.url = here;
  for (const work of pair.portfolio.works ?? [])
    if (work.links?.length) work.links = work.links.map((link) => ({ ...link, url: here }));
  for (const section of pair.portfolio.sections)
    if (section.kind === 'cta' && section.primaryAction)
      section.primaryAction = { ...section.primaryAction, url: here };
  const markup = html(inputOf(pair, 'pv-', SAMPLE_SNAPSHOTS));
  // The interface (Fig. 1's ports), an evidence list, and About's call to action each carry the prefixed link.
  const region = (pattern: RegExp) => markup.match(pattern)?.[0] ?? '';
  const regions = {
    interface: region(/<figure[^>]*data-cover[\s\S]*?<\/figure>/),
    evidence: [...markup.matchAll(/<section[^>]*data-kind="evidence"[\s\S]*?<\/section>/g)]
      .map(([s]) => s)
      .join(''),
    about: [...markup.matchAll(/<section[^>]*data-kind="cta"[\s\S]*?<\/section>/g)]
      .map(([s]) => s)
      .join(''),
  };
  for (const [name, part] of Object.entries(regions)) {
    assert.ok(part.length > 0, `${name} renders`);
    assert.match(part, /href="\/#pv-contact"/, `${name} routes /#id through hrefFor`);
    assert.doesNotMatch(part, /href="\/#contact"/, `${name} keeps no bare /#id`);
  }
});

test("every fixture's section titles render, the hero's included (network-off's complete check, through Schematic)", () => {
  for (const { name } of CONTRACT_FIXTURES) {
    const input = inputOf(pairOf(name), 'pv-');
    const markup = html(input);
    const text = markup.replace(/<[^>]+>/g, '');
    const escape = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    for (const section of input.portfolio.sections) {
      const title = (section as { title?: unknown }).title;
      if (section.kind === 'works' || typeof title !== 'string' || title.trim() === '') continue;
      assert.ok(
        markup.includes(escape(title)) || text.includes(title),
        `${name}: ${section.kind} ${section.id} shows its title "${title}"`,
      );
    }
  }
});

// E's content sweep (79d9ef47d) counted 71 of the owner's strings the fallback shows and
// Schematic dropped; these are the complete fixture's, each now on the drawing (the hero's
// greeting is the kit's, E's fix). The routed signature's description is its own page's
// (case-study.test.tsx).
const RENDERED = [
  ['identity.pronouns', 'they/them'],
  ['the hero name', 'Hero name'],
  ['the hero subtitle', 'Hero subtitle'],
  ['a service group', 'Service group'],
  ["a role's skills", 'Experience skill'],
  ["a role's location", 'Experience location'],
  ["an event's location", 'Event location'],
  ["an essay's summary beside its excerpt", 'Writing summary.'],
  ["an essay's tags", 'Writing tag'],
  ["a photograph's location", 'Gallery location'],
  ["a photograph's tags", 'Gallery tag'],
  ["an episode's guests", 'Guest One'],
  ["an episode's series", 'Episodes show name'],
  ["an episode's show notes", 'Episode show notes.'],
  ["an episode's links", 'Episode link'],
  ["a record's artist", 'Release artist'],
  ["a record's links", 'Release link'],
  ["a publication's citation", 'Publication citation'],
  ["a publication's awards", 'Publication award'],
  ["a talk's abstract", 'Talk abstract.'],
  ["a talk's links", 'Talk link'],
  ["a metric's source", 'Stat source'],
  ["an exhibition's statement", 'Exhibition statement.'],
  ["an exhibition's location", 'Exhibition location'],
  ["a recording's statement", 'Recording statement.'],
  ["a repository's statement", 'Repository statement.'],
  ["work elsewhere's categories", 'External category'],
  ["work elsewhere's button text", 'External button'],
  ["work elsewhere's link label", 'photos.rowan.test'],
  ["work elsewhere's location label", 'External location'],
  ["a custom item's media caption", 'Custom item caption'],
] as const;

test('the complete fixture: every field the content sweep found dropped is on the drawing', () => {
  const markup = html(inputOf(pairOf('complete')));
  const text = markup.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'");
  for (const [what, words] of RENDERED) assert.ok(text.includes(words), `${what}: "${words}"`);
});

/** The complete fixture with its portfolio text changed by `edit`, as a pair. */
function editedComplete(edit: (text: string) => string): ParsedPair {
  const files = contractFixture('complete').files;
  const copy = path.join(mkdtempSync(path.join(tmpdir(), 'sx-unit-')), 'portfolio.yml');
  writeFileSync(copy, edit(readFileSync(files.portfolio, 'utf8')));
  const read = readPair({ ...files, portfolio: copy });
  assert.ok(read.ok, JSON.stringify(read));
  return read.pair;
}

test('an episode\'s "Guests" is Schematic\'s English, marked so in a portfolio in another language (P2 review)', () => {
  const markup = html(inputOf(pairOf('mixed')));
  assert.match(markup, /<span lang="en">Guests<\/span>/);
});

test("GitHub's count is its table's rows once the snapshot is ready, and its one profile before (P2 review)", () => {
  // The sample, with its snapshot: the count names as many repositories as the parts table lists.
  const markup = html(inputOf(samplePair(), '', SAMPLE_SNAPSHOTS));
  const view = /id="on-github"[\s\S]*?<\/section>/.exec(markup)?.[0] ?? '';
  const rows =
    /<table class="sx-table sx-parts">[\s\S]*?<tbody[^>]*>([\s\S]*?)<\/tbody>/.exec(view)?.[1] ??
    '';
  const listed = rows.match(/<tr[\s>]/g)?.length ?? 0;
  assert.ok(listed > 0, 'the parts table lists repositories');
  assert.match(view, new RegExp(`>\\s*${listed} repositor(y|ies)\\s*<`));
  // The complete fixture names an account with no snapshot: the count is its one profile.
  const bare = html(inputOf(pairOf('complete')));
  const gh = /id="github"[\s\S]*?<\/section>/.exec(bare)?.[0] ?? '';
  assert.match(gh, />\s*1 profile\s*</);
  assert.doesNotMatch(gh, />\s*1 entry\s*</);
});

test("a talk's links stand on lines of their own, with slides and video or without them (P2 review)", () => {
  const pair = editedComplete((text) =>
    text
      .replace('    slidesUrl: https://talks.rowan.test/slides\n', '')
      .replace('    videoUrl: https://talks.rowan.test/video\n', '')
      .replace(
        '        label: Talk link\n',
        '        label: Talk link\n      - platform: web\n        url: https://talks.rowan.test/other\n        label: Other link\n',
      ),
  );
  const text = html(inputOf(pair))
    .replace(/<br\/?>/g, '\n')
    .replace(/<[^>]+>/g, '');
  assert.match(text, /Talk link\s*\nOther link/);
  assert.doesNotMatch(text, /Talk linkOther link/);
});

test('a lede of more than one paragraph keeps its first and folds the rest on a phone; one paragraph folds nothing', () => {
  const markup = html(inputOf(samplePair(), '', SAMPLE_SNAPSHOTS));
  const lede = markup.match(/<section[^>]*data-kind="lede"[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.match(lede, /<details class="sx-run-on" open="" data-sx-fold="lede">/);
  assert.match(lede, /<summary class="sx-run-on__sum"[^>]*>(<span[^>]*>)?\d+ more paragraphs?/);
  // The first paragraph stands before the fold, the rest inside it.
  assert.ok(lede.indexOf('<p>') < lede.indexOf('<details'), 'the first paragraph comes first');
  const one = html(inputOf(pairOf('complete'), ''));
  const single = one.match(/<section[^>]*data-kind="lede"[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.ok(single.length > 0);
  assert.doesNotMatch(single, /data-sx-fold="lede"/);
});

test('sheetOrder authored orders sheets by their first section', () => {
  const pair = samplePair();
  const site = {
    ...pair.site,
    variantControls: { schematic: { version: 1, values: { sheetOrder: 'authored' } } },
  };
  const input = inputOf({ ...pair, site } as ParsedPair, '', SAMPLE_SNAPSHOTS);
  const order = sheetSet(input).sheets.map((sheet) => sheet.id);
  assert.equal(order[0], 'about');
  assert.equal(new Set(order).size, order.length);
});

test('hostile text renders as text: metacharacters in a unit, the name, titles and the thesis (K-10)', () => {
  const HOSTILE = `+ ( [ * ? \\ $ < & ${'x'.repeat(60)} 🙂 مرحبا`;
  const pair = samplePair();
  const portfolio = {
    ...pair.portfolio,
    identity: { ...pair.portfolio.identity, name: `${HOSTILE} name`, tagline: HOSTILE },
    practice: { ...pair.portfolio.practice, thesis: `${HOSTILE}. Second.` },
    evidence: (pair.portfolio.evidence ?? []).map((entry) =>
      entry.metric ? { ...entry, metric: { ...entry.metric, unit: HOSTILE } } : entry,
    ),
    works: (pair.portfolio.works ?? []).map((work) => ({
      ...work,
      title: `${work.title} ${HOSTILE}`,
    })),
  };
  const markup = html(inputOf({ ...pair, portfolio } as ParsedPair, '', SAMPLE_SNAPSHOTS));
  assert.doesNotMatch(markup, /< &/);
  assert.match(markup, /&lt; &amp;/);
});
