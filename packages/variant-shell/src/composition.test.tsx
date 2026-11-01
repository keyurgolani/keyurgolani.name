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
  type VariantRenderInput,
} from '@portfolio/variant-contract';
import {
  CONTRACT_FIXTURES,
  contractFixture,
  HIDDEN_CANARY,
} from '@portfolio/variant-contract/node';
import { CORE_SECTION_KINDS } from '@portfolio/schema';
import { chronologyOf, evidenceOf, worksOf } from '@portfolio/kit/sections';
import Shell from '.';
import { RENDERERS } from './home';
import { plainInline } from './model';

// Shell's home over every contract fixture: one h1 that leads with the
// thesis, every section in the shell frame, unique ids under the prefix,
// every fragment link landing, the shell idiom hidden from assistive tech,
// and the index a plain nav of real links without a script.

Object.assign(globalThis, { React });

const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const CSS = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const RAW = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

const MANIFEST = (() => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name, exports: PACKAGE.exports });
  assert.ok(result.ok, JSON.stringify(result.ok ? [] : result.diagnostics));
  return result.manifest as VariantManifest;
})();

function inputOf(
  pair: ParsedPair,
  idPrefix = '',
  controls?: VariantRenderInput['controls'],
): VariantRenderInput {
  const input = buildRenderInput({
    view: resolvePortfolioView(pair, {}, { mediaBase: '/media' }),
    manifest: MANIFEST,
    route: { route: 'home' } as never,
    basePath: '',
    origin: 'https://rowan.test',
    requestTime: '2026-10-28T12:00:00Z',
    idPrefix,
  });
  return controls ? { ...input, controls: { ...input.controls, ...controls } } : input;
}

function pairOf(name: string): ParsedPair {
  const read = readPair(contractFixture(name).files);
  assert.ok(read.ok, `${name}: ${JSON.stringify(read)}`);
  return read.pair;
}

const html = (input: VariantRenderInput) => renderToStaticMarkup(<Shell input={input} />);
const ids = (markup: string) => [...markup.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id!);
const fragments = (markup: string) =>
  [...markup.matchAll(/\shref="#([^"]+)"/g)].map(([, id]) => decodeURIComponent(id!));
const count = (markup: string, pattern: RegExp) => markup.match(pattern)?.length ?? 0;

test('the manifest: every core kind bespoke, custom included, the palette, the document binding, the shell recipe', () => {
  assert.deepEqual([...MANIFEST.renderedKinds].sort(), [...CORE_SECTION_KINDS].sort());
  assert.deepEqual(Object.keys(RENDERERS).sort(), [...MANIFEST.renderedKinds].sort());
  assert.equal(MANIFEST.routes.home, 'bespoke');
  assert.equal(MANIFEST.compositionFamily, 'document');
  assert.equal(MANIFEST.performanceTier, 'light');
  assert.equal(MANIFEST.budgets?.animation, 0);
  assert.equal(MANIFEST.budgets?.enhancement, 6144);
  assert.equal(MANIFEST.recommendedAppearance, 'shell');
  assert.deepEqual(
    MANIFEST.enhancements?.map(({ id, requires }) => [id, requires]),
    [['palette', []]],
  );
  assert.deepEqual(MANIFEST.keyBindings, [
    { region: 'document', keys: ['mod+k', '/'], action: 'palette.open' },
  ]);
  assert.equal(MANIFEST.visitorControl.placement, 'footer');
});

for (const { name } of CONTRACT_FIXTURES) {
  test(`${name}: one h1, one main, unique ids, every fragment lands, nothing hidden leaks`, () => {
    for (const prefix of ['', 'p-']) {
      const markup = html(inputOf(pairOf(name), prefix));
      assert.equal(count(markup, /<h1[\s>]/g), 1, `${name} h1`);
      assert.equal(count(markup, /<main[\s>]/g), 1, `${name} main`);
      const all = ids(markup);
      assert.equal(new Set(all).size, all.length, `${name} duplicate ids`);
      const known = new Set(all);
      for (const fragment of fragments(markup))
        assert.ok(known.has(fragment), `${name} #${fragment}`);
      assert.doesNotMatch(markup, new RegExp(HIDDEN_CANARY), name);
      // Every command line and hash is shell idiom, never read aloud.
      assert.equal(count(markup, /class="sh-cmd"(?! aria-hidden="true")/g), 0, `${name} sh-cmd`);
      assert.equal(count(markup, /class="sh-gl__hash"(?! aria-hidden="true")/g), 0, `${name} hash`);
    }
  });
}

test('the sample: the h1 leads with the thesis, the name its visible prefix, and no greeting comment', () => {
  const markup = html(inputOf(pairOf('complete')));
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(markup)![1]!;
  assert.match(h1, /sh-who__name/);
  assert.match(h1, /sh-who__thesis/);
  assert.doesNotMatch(markup, /Hello, I/);
  // The h1 comes before every h2.
  assert.ok(markup.indexOf('<h1') < markup.indexOf('<h2'));
});

test('the transcript runs by directory, as the index does (SH-M2)', () => {
  const markup = html(inputOf(pairOf('complete')));
  const blocks = [...markup.matchAll(/class="sh-block" data-gap="(\d)" data-cwd="([^"]+)"/g)].map(
    ([, gap, cwd]) => ({ gap: Number(gap), cwd: cwd! }),
  );
  assert.ok(blocks.length > 5);
  const runs = blocks.map(({ cwd }) => cwd).filter((cwd, i, all) => cwd !== all[i - 1]);
  assert.equal(
    new Set(runs.filter((cwd) => cwd !== '~')).size,
    runs.filter((cwd) => cwd !== '~').length,
    `directories once each: ${runs}`,
  );
  blocks
    .slice(1)
    .forEach((block, i) => assert.equal(block.gap, block.cwd === blocks[i]!.cwd ? 1 : 2));
  // The index lists the directories in the same order.
  const pane = /<nav class="sh-pane"[\s\S]*?<\/nav>/.exec(markup)![0];
  const dirs = [...pane.matchAll(/class="sh-grp__dn sh-dir" aria-hidden="true">([^<]+):</g)].map(
    ([, d]) => d,
  );
  assert.deepEqual(dirs, runs);
});

test('without a script the index is a nav of real links, and the jump is a link to it', () => {
  const markup = html(inputOf(pairOf('complete')));
  const pane = /<nav class="sh-pane" id="([^"]+)"[\s\S]*?<\/nav>/.exec(markup)!;
  assert.ok(count(pane[0], /<a class="sh-row" href="#/g) > 5);
  assert.match(markup, new RegExp(`class="sh-tmux__jump" href="#${pane[1]}"`));
  // The palette's button waits for the enhancement.
  assert.match(markup, /<button class="sh-tmux__jump"[^>]*hidden=""/);
});

test("the session's first child is the no-script mark, an empty <i> in <noscript>, with no style", () => {
  const markup = html(inputOf(pairOf('complete')));
  // The parser makes the mark an element only with scripting off, and the no-script layout keys
  // on it (styles.css), never on a scripting query, which the quality run's axe pass would flip.
  assert.match(
    markup,
    /<div class="sh-session" data-sh-session=""[^>]*><noscript><i data-sh-nojs="" hidden=""><\/i><\/noscript><main /,
  );
  assert.equal(count(markup, /<noscript>/g), 1);
  const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(markup)![1]!;
  assert.equal(noscript, '<i data-sh-nojs="" hidden=""></i>');
  assert.doesNotMatch(noscript, /style/);
  // The stylesheet styles by no scripting query.
  assert.doesNotMatch(CSS, /@media[^{]*scripting/);
});

test('the status line names at most five destinations, each a real link', () => {
  const markup = html(inputOf(pairOf('complete')));
  const bar = /<nav class="sh-tmux"[\s\S]*?<\/nav>/.exec(markup)![0];
  const wins = count(bar, /class="sh-tmux__win"/g);
  assert.ok(wins >= 1 && wins <= 5, `${wins} windows`);
});

test('controls: titles drops the command lines, bare the user@host', () => {
  const pair = pairOf('complete');
  assert.equal(count(html(inputOf(pair, '', { commands: 'titles' })), /class="sh-cmd"/g), 0);
  assert.equal(count(html(inputOf(pair, '', { prompt: 'bare' })), /sh-ps1__who/g), 0);
  assert.ok(count(html(inputOf(pair)), /sh-ps1__who/g) > 0);
});

test('a custom section is cat <id> in the shell frame: its own heading as a comment, each item a file banner', () => {
  for (const name of ['complete', 'mixed']) {
    const input = inputOf(pairOf(name));
    const custom = input.portfolio.sections.find((section) => section.kind === 'custom');
    assert.ok(custom, `${name} has a custom section`);
    const markup = html(input);
    const at = markup.indexOf(`data-section-id="${custom.id}"`);
    assert.ok(at > 0, `${name}: the custom section renders`);
    const open = markup.lastIndexOf('<section', at);
    const block = markup.slice(open, markup.indexOf('</section>', at));
    assert.match(block, /data-renderer="bespoke"/, name);
    assert.match(block, /class="sh-block"/, name);
    assert.match(block, /class="sh-cmd" aria-hidden="true"/, name);
    assert.match(block, new RegExp(`sh-cmd__verb">cat</span>`), name);
    // The frame writes its title as the comment h2; each item is an h3 under its hidden banner.
    assert.match(block, /<h2 class="sh-cmt"/, name);
    for (const item of (custom as { items?: { title: string }[] }).items ?? []) {
      assert.match(block, /<h3 class="sh-cat__h"><span aria-hidden="true">==&gt; <\/span>/, name);
      assert.ok(block.includes(item.title.replace(/&/g, '&amp;')), `${name}: ${item.title}`);
    }
  }
});

test('gate item 8: the minor Record and About parts fold, closed, each summary its comment, command and first line', () => {
  const input = inputOf(pairOf('complete'));
  const markup = html(input);
  const folds = [
    ...markup.matchAll(
      /<details class="sh-fold" data-sh-fold="">([\s\S]*?)<\/summary><section[^>]*id="([^"]+)"[^>]*data-section-id="([^"]+)"[^>]*data-dest="([^"]+)"/g,
    ),
  ].map(([, summary, id, section, dest]) => ({ summary: summary!, id, section, dest }));
  assert.ok(folds.length >= 3, `only ${folds.length} folds`);
  const byId = new Map(input.portfolio.sections.map((section) => [section.id, section]));
  for (const fold of folds) {
    // Record and About only, closed, the section and its id inside.
    assert.ok(['record', 'about'].includes(fold.dest!), `${fold.section} in ${fold.dest}`);
    assert.match(fold.summary, /^<summary class="sh-fold__sum">/);
    // The comment is read, the command isn't, and the first line says how many or what.
    assert.match(fold.summary, /<span class="sh-fold__cmt">/);
    assert.match(fold.summary, /<span class="sh-cmd sh-fold__cmd" aria-hidden="true">/);
    assert.match(fold.summary, /<span class="sh-fold__meta">.+<\/span>/);
    const section = byId.get(fold.section!)!;
    if (section.title) assert.ok(fold.summary.includes(section.title.replace(/&/g, '&amp;')));
  }
  assert.doesNotMatch(markup, /<details class="sh-fold"[^>]* open/);
  // What stays open: the figures, the words from collaborators, the roles, Now and the focus.
  const folded = new Set(folds.map(({ section }) => section));
  for (const section of input.portfolio.sections) {
    if (!folded.has(section.id)) continue;
    assert.ok(
      !['now', 'focus', 'lede', 'quote', 'hero', 'works', 'contact', 'cta'].includes(section.kind),
      section.id,
    );
    if (section.kind === 'practice') assert.notEqual(section.part, 'thesis', section.id);
  }
  // Every fragment still lands, a folded section's included, and the index lists them.
  const known = new Set(ids(markup));
  for (const fragment of fragments(markup)) assert.ok(known.has(fragment), `#${fragment}`);
  for (const fold of folds) assert.match(markup, new RegExp(`data-sh-target="${fold.id}"`));
});

// The content sweep's fields (apps/web/src/server/content-sweep.test.tsx), on home: what a
// row prints past its record line, in its fold, and what a record, a group or the hero carries
// in the owner's words. Matched as the sweep matches: visible text and alt, aria-label and
// title, lower case, without white space or punctuation, a long text by its head and tail.
const REPO = new URL('../../../', import.meta.url);

function samplePair(): ParsedPair {
  const read = readPair({
    portfolio: new URL('portfolio.example.yml', REPO).pathname,
    site: new URL('site.example.yml', REPO).pathname,
  });
  assert.ok(read.ok, JSON.stringify(read));
  return read.pair;
}

const decode = (text: string) =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
const normOf = (text: string) =>
  plainInline(text)
    .toLocaleLowerCase()
    .replace(/[\s\p{P}]+/gu, '');
function corpusOf(markup: string): string {
  const text = decode(markup.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' '));
  const attrs = decode(
    [...markup.matchAll(/\s(?:alt|aria-label|title)="([^"]*)"/g)].map((m) => m[1]).join(' | '),
  );
  return `${normOf(text)}\u0000${normOf(attrs)}`;
}
function shows(corpus: string, text: string): boolean {
  const words = normOf(text);
  const parts = words.length > 80 ? [words.slice(0, 50), words.slice(-30)] : [words];
  return parts.every((part) => corpus.includes(part));
}

/** The swept fields home lists, each with where it came from. */
function sweptOf(input: VariantRenderInput): [string, string][] {
  const fields: [string, string | undefined][] = [];
  const { portfolio } = input;
  for (const section of portfolio.sections) {
    if (section.kind === 'hero') fields.push([`${section.id}.subtitle`, section.subtitle]);
    for (const work of worksOf(section, input)) {
      const at = `works[${work.id}]`;
      fields.push(
        [`${at}.excerpt`, work.excerpt],
        [`${at}.description`, work.description],
        [`${at}.showNotes`, work.showNotes],
        [`${at}.series`, work.series],
        [`${at}.artist`, work.artist],
        [`${at}.label`, work.label],
        ...(work.guests ?? []).map((guest): [string, string] => [`${at}.guests`, guest]),
        ...(work.tracks ?? []).map((track): [string, string] => [`${at}.tracks`, track.title]),
      );
    }
    for (const entry of evidenceOf(section, input)) {
      const at = `evidence[${entry.id}]`;
      fields.push(
        [`${at}.abstract`, entry.abstract],
        [`${at}.citation`, entry.citation],
        [`${at}.statement`, entry.statement],
        [`${at}.description`, entry.description],
        [`${at}.source.name`, entry.source?.name],
        [`${at}.locationLabel`, entry.locationLabel],
        [`${at}.buttonText`, entry.url ? entry.buttonText : undefined],
        ...(entry.awards ?? []).map((award): [string, string] => [`${at}.awards`, award]),
        ...(entry.categories ?? []).map((tag): [string, string] => [`${at}.categories`, tag]),
        ...(entry.links ?? []).map((link): [string, string | undefined] => [
          `${at}.links.label`,
          link.label,
        ]),
        ...(entry.highlights ?? []).flatMap((highlight): [string, string][] => [
          [`${at}.highlights.label`, highlight.label],
          [`${at}.highlights.sub`, highlight.sub],
        ]),
      );
    }
    for (const entry of chronologyOf(section, input))
      fields.push([`chronology[${entry.id}].location`, entry.location]);
  }
  const practice = portfolio.practice;
  for (const group of practice?.tools ?? []) fields.push(['practice.tools', group.description]);
  for (const group of practice?.services ?? []) fields.push(['practice.services', group.name]);
  return fields.filter((field): field is [string, string] => plainInline(field[1] ?? '') !== '');
}

for (const [name, pair] of [
  ['sample', () => samplePair()],
  ['complete', () => pairOf('complete')],
] as const) {
  test(`${name}: home prints what the content sweep reads, the row's longer text in its fold`, () => {
    const input = inputOf(pair());
    const markup = html(input);
    const corpus = corpusOf(markup);
    const fields = sweptOf(input);
    assert.ok(fields.length >= 10, `${name}: only ${fields.length} fields`);
    const missing = fields.filter(([, text]) => !shows(corpus, text));
    assert.deepEqual(missing, [], name);
    // The longer text sits in folds, closed, each summary naming what it holds.
    const more = [...markup.matchAll(/<details class="sh-more" data-sh-more="">(.*?)<\/summary>/g)];
    assert.ok(more.length > 0, `${name}: no row folds`);
    const part = String.raw`(?:excerpt|description|show notes|tracks \(\d+\)|statement|abstract)`;
    const named = new RegExp(
      String.raw`^<summary class="sh-more__sum">(?:<span lang="en">)?${part}(?:, ${part})*(?:</span>)?(?:<span class="sh-sr">: [^<]+</span>)?$`,
    );
    for (const [, summary] of more) assert.match(summary!, named);
    assert.doesNotMatch(markup, /<details class="sh-more"[^>]* open/);
    // Each is named for its row too, after its visible words: no two share a name.
    const names = more.map(([, summary]) => decode(summary!.replace(/<[^>]+>/g, '')));
    const twice = names.filter((name, i) => names.indexOf(name) !== i);
    assert.deepEqual(twice, [], `${name}: summaries that share a name`);
    for (const label of names) assert.match(label, /^[a-z (),0-9]+: \S/, label);
  });
}

test("whoami prints the hero's tagline, subtitle and subtagline as # comment lines under the thesis, not as free paragraphs", () => {
  const markup = html(inputOf(pairOf('complete')));
  const notes = /<div class="sh-who__notes">([\s\S]*?)<\/div>/.exec(markup)![1]!;
  const lines = [
    ...notes.matchAll(
      /<p class="sh-sub"><span class="sh-cmt__hash" aria-hidden="true"># <\/span>([^<]+)<\/p>/g,
    ),
  ].map(([, text]) => text);
  assert.deepEqual(lines, ['Hero tagline', 'Hero subtitle', 'Hero subtagline']);
  // Under the h1, before the rule and the facts; the pitch holds the actions alone.
  assert.ok(markup.indexOf('</h1>') < markup.indexOf('sh-who__notes'));
  assert.ok(markup.indexOf('sh-who__notes') < markup.indexOf('sh-who__rule'));
  const pitch = /<div class="sh-who__pitch">([\s\S]*?)<\/section>/.exec(markup)![1]!;
  assert.doesNotMatch(pitch, /class="sh-prose/);
});

test('cat <id> shows every picture an item has, each with its caption, date, place and tags', () => {
  const base = inputOf(pairOf('complete'));
  const images = Object.values(base.media)
    .filter((asset) => asset.kind === 'image')
    .map((asset) => asset.id);
  assert.ok(images.length >= 3, 'the fixture has three images');
  const custom = base.portfolio.sections.find((section) => section.kind === 'custom')!;
  const item = {
    title: 'Three pictures',
    media: [
      { asset: images[0]!, caption: 'First caption' },
      { asset: images[1]!, takenAt: '2024-05', location: 'Second place' },
      { asset: images[2]!, tags: ['third-tag'] },
      { asset: 'no-such-asset', caption: 'Never shown' },
    ],
  };
  const input = {
    ...base,
    portfolio: {
      ...base.portfolio,
      sections: base.portfolio.sections.map((section) =>
        section === custom
          ? { ...section, items: [...((section as { items?: unknown[] }).items ?? []), item] }
          : section,
      ),
    },
  } as VariantRenderInput;
  const markup = html(input);
  const at = markup.indexOf(`data-section-id="${custom.id}"`);
  const block = markup.slice(markup.lastIndexOf('<section', at), markup.indexOf('</section>', at));
  const items = block.split('<li class="sh-cat__item">').slice(1);
  const owned = (custom as { items?: { media?: unknown[] }[] }).items ?? [];
  // The fixture's own items: every picture, the caption under it.
  owned.forEach((own, i) => {
    assert.equal(count(items[i]!, /data-media-asset=/g), own.media?.length ?? 0, `item ${i}`);
  });
  assert.match(block, /Custom item caption/);
  // Three pictures that show, the one with no asset left out, each with what it says.
  const three = items[items.length - 1]!;
  assert.equal(count(three, /data-media-asset=/g), 3);
  for (const text of ['First caption', '2024-05', 'Second place', 'third-tag'])
    assert.ok(three.includes(text), text);
  assert.doesNotMatch(three, /Never shown/);
});

test('cat <id> prints a cited record home lacks whole, never its id, and links one home lists', () => {
  const base = inputOf(pairOf('complete'));
  const custom = base.portfolio.sections.find((section) => section.kind === 'custom')!;
  const listed = base.portfolio.sections.find(
    (section) => section.kind === 'evidence' && (section.items ?? []).length > 0,
  ) as { id: string; items: string[] };
  const said = {
    id: 'said-in-passing',
    type: 'testimonial',
    statement: 'It held under load.',
    source: { name: 'Ada Quinn', role: 'Staff engineer', url: 'https://ada.test/' },
    slidesUrl: 'https://slides.test/said',
  };
  const item = { title: 'Cited', evidence: [said.id, listed.items[0]!] };
  const input = {
    ...base,
    portfolio: {
      ...base.portfolio,
      evidence: [...base.portfolio.evidence, said],
      sections: base.portfolio.sections.map((section) =>
        section === custom
          ? { ...section, items: [...((section as { items?: unknown[] }).items ?? []), item] }
          : section,
      ),
    },
  } as VariantRenderInput;
  const markup = html(input);
  const at = markup.indexOf(`data-section-id="${custom.id}"`);
  const block = markup.slice(markup.lastIndexOf('<section', at), markup.indexOf('</section>', at));
  const cited = block.split('<li class="sh-cat__item">').pop()!;
  // The testimonial home doesn't list: its source as its name, linked; what was said; the slides.
  assert.match(cited, /<dt><a[^>]*href="https:\/\/ada\.test\/"[^>]*>Ada Quinn<\/a><\/dt>/);
  assert.match(cited, /Staff engineer/);
  assert.match(cited, /It held under load\./);
  assert.match(cited, /href="https:\/\/slides\.test\/said"/);
  assert.doesNotMatch(cited, new RegExp(said.id));
  // The record home lists links to its place there.
  const href = markup.match(new RegExp(`id="([^"]*${listed.id})"`))?.[1];
  assert.ok(href, 'the evidence section has its anchor');
  assert.match(cited, new RegExp(`<a href="#${href}">`));
  const known = new Set(ids(markup));
  for (const fragment of fragments(cited)) assert.ok(known.has(fragment), `#${fragment}`);
});

test('the hero leads with the h1 even when a lede comes first in the owner order', () => {
  const input = inputOf(pairOf('complete'));
  const sections = input.portfolio.sections;
  const hero = sections.find((section) => section.kind === 'hero')!;
  const reordered = {
    ...input,
    portfolio: {
      ...input.portfolio,
      sections: [
        ...sections.filter((section) => section.kind === 'lede'),
        ...sections.filter((section) => section.kind !== 'lede'),
      ],
    },
  } as VariantRenderInput;
  const markup = html(reordered);
  assert.equal(count(markup, /<h1[\s>]/g), 1);
  assert.ok(markup.indexOf('<h1') < markup.indexOf('<h2'), 'no h2 before the h1');
  assert.ok(markup.indexOf(`data-section-id="${hero.id}"`) < markup.indexOf('<h2'));
});
