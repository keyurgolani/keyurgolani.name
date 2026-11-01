import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { pageOutline, sectionRenders } from '@portfolio/kit/sections';
import { resolvePortfolioView, type ParsedPair } from '@portfolio/schema';
import { readPair } from '@portfolio/schema/node';
import {
  buildRenderInput,
  keyVerdict,
  validateManifest,
  type VariantManifest,
  type VariantRenderInput,
} from '@portfolio/variant-contract';
import {
  checkOutline,
  CONTRACT_FIXTURES,
  contractFixture,
  HIDDEN_CANARY,
} from '@portfolio/variant-contract/node';
import Singular from '.';
import { planOf } from './model';
import { fragmentId, snapFor, stepFor, stillFor } from './enhancements/pager';

// Singular's manifest, and over every contract fixture and the repository's
// sample, the home page: one h1 that names the owner, one main, every
// section that renders in exactly one Singular frame (never the kit's
// shared renderer), unique ids under the prefix, every fragment landing,
// the panels in their fixed order on their grounds, every band one real
// link on the other ground, and no section lost between panels and record.

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

function inputOf(
  pair: ParsedPair,
  idPrefix = '',
  snapshots: Readonly<Record<string, unknown>> = {},
  query?: Readonly<Record<string, string>>,
): VariantRenderInput {
  return buildRenderInput({
    view: resolvePortfolioView(pair, { snapshots }, { mediaBase: '/media' }),
    manifest: MANIFEST,
    route: { route: 'home' },
    basePath: '',
    origin: 'https://rowan.test',
    requestTime: '2026-10-29T12:00:00Z',
    idPrefix,
    ...(query ? { query } : {}),
  });
}

function pairOf(name: string): ParsedPair {
  const read = readPair(contractFixture(name).files);
  assert.ok(read.ok, `${name}: ${JSON.stringify(read)}`);
  return read.pair;
}

function samplePair(): ParsedPair {
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

const html = (input: VariantRenderInput) => renderToStaticMarkup(<Singular input={input} />);
const ids = (markup: string) => [...markup.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id!);
const fragments = (markup: string) =>
  [...markup.matchAll(/\shref="[^"#]*#([^"]+)"/g)].map(([, id]) => decodeURIComponent(id!));
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"');

/** The Contents dialog's ids take the appearance boundary's prefix, which a unit render doesn't have. */
const DIALOG = /^sg-contents(?:--|$)/;

test('its manifest renders every core kind itself, pages with four keys, and owns home', () => {
  assert.deepEqual([...MANIFEST.renderedKinds].sort(), [
    'chronology',
    'contact',
    'cta',
    'custom',
    'evidence',
    'focus',
    'fun-facts',
    'github',
    'hero',
    'lede',
    'now',
    'practice',
    'quote',
    'works',
  ]);
  assert.equal(MANIFEST.routes.home, 'bespoke');
  assert.equal(MANIFEST.compositionFamily, 'sequence');
  assert.equal(MANIFEST.motionIntent, 'directed');
  assert.equal(MANIFEST.performanceTier, 'light');
  assert.equal(MANIFEST.budgets?.animation, 0);
  assert.equal(MANIFEST.budgets?.css, 8192);
  assert.equal(MANIFEST.visitorControl.placement, 'footer');
  // No dangling recipe: the singular recipe isn't on the tip yet (A's rule).
  assert.equal(MANIFEST.recommendedAppearance, undefined);
  // The pager's keys, in its own region, each one the contract allows today (brief §5.7, K-4 d).
  const [binding] = MANIFEST.keyBindings ?? [];
  assert.equal(binding?.region, 'panels');
  assert.deepEqual(binding?.keys, ['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp']);
  for (const key of binding!.keys) assert.equal(keyVerdict(key), 'allowed', key);
  assert.deepEqual(
    MANIFEST.controls.items.map((item) => item.id),
    [
      'snap',
      'bestWork',
      'numbersSection',
      'referencesSection',
      'introSource',
      'heroAction',
      'contactLabel',
    ],
  );
});

const cases: { name: string; input: (prefix: string) => VariantRenderInput }[] = [
  ...CONTRACT_FIXTURES.map(({ name }) => ({
    name,
    input: (prefix: string) => inputOf(pairOf(name), prefix),
  })),
  { name: 'sample', input: (prefix: string) => inputOf(samplePair(), prefix, SAMPLE_SNAPSHOTS) },
];

for (const { name, input: build } of cases) {
  test(`${name}: one h1 naming the owner, one main, every section in one Singular frame`, () => {
    for (const prefix of ['', 'pv-']) {
      const input = build(prefix);
      const markup = html(input);
      assert.equal(markup.match(/<h1[\s>]/g)?.length, 1, name);
      assert.equal(markup.match(/<main[\s>]/g)?.length, 1, name);
      const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(markup)![1]!;
      assert.ok(text(h1).includes(input.portfolio.identity.name.trim()), `${name}: ${text(h1)}`);
      assert.doesNotMatch(markup, new RegExp(HIDDEN_CANARY), name);
      assert.doesNotMatch(markup, /data-renderer="shared"/);
      // The contract's outline check: one h1, a focusable main, no skipped heading, every frame, every nav named.
      assert.deepEqual(
        checkOutline(markup, input.ids, { sections: pageOutline(input).sections }),
        [],
        name,
      );
      const shown = input.portfolio.sections.filter((section) => sectionRenders(section, input));
      for (const section of shown) {
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
      if (prefix) for (const id of all) assert.ok(id.startsWith(prefix) || DIALOG.test(id), id);
      const known = new Set(all);
      for (const fragment of fragments(markup))
        assert.ok(known.has(fragment), `${name}: #${fragment} lands`);
      // Nothing ships marked live: until the pager runs, the bar scrolls away and the rail sits on its plate.
      assert.doesNotMatch(markup, /data-sg-live|aria-current/);
      // No typed arrow and no middle-dot meta string (C3).
      assert.doesNotMatch(text(markup), /→|·/);
    }
  });

  test(`${name}: the panels in their fixed order, on alternating grounds, each ending on one band`, () => {
    const input = build('');
    const plan = planOf(input);
    const order = ['who', 'best', 'numbers', 'more', 'refs', 'contact'];
    const keys = plan.panels.map((panel) => panel.key);
    assert.deepEqual(
      keys,
      [...keys].sort((a, b) => order.indexOf(a) - order.indexOf(b)),
      name,
    );
    assert.equal(keys[0], 'who');
    plan.panels.forEach((panel, i) => {
      if (panel.key === 'contact') {
        assert.equal(panel.ground, 'accent');
        assert.equal(i, plan.panels.length - 1);
      } else assert.equal(panel.ground, i % 2 ? 'inverse' : 'canvas');
      // SG-M2: the band stands on the other of paper and ink.
      assert.equal(panel.band, panel.ground === 'inverse' ? 'canvas' : 'inverse');
    });
    const markup = html(input);
    const panels = markup.match(/<section[^>]*class="sg-panel"/g) ?? [];
    assert.equal(panels.length, plan.panels.length, name);
    const bands = [...markup.matchAll(/<footer class="sg-band" data-ground="(\w+)"/g)];
    assert.equal(bands.length, plan.panels.length, name);
    // The best work is one self-contained work: its panel's body is an article, and the only one among the panels.
    const articles = markup.match(/<article class="sg-grid sg-panel__body[^"]*"/g) ?? [];
    assert.equal(articles.length, plan.best ? 1 : 0, name);
    if (plan.best) assert.match(articles[0]!, /sg-best/, name);
    // Every action is a real link, at most one per band.
    for (const band of markup.split('<footer class="sg-band"').slice(1)) {
      const chunk = band.slice(0, band.indexOf('</div></footer>'));
      assert.ok((chunk.match(/<a /g)?.length ?? 0) <= 1, name);
    }
    // The counter reads the panel's place out of the total.
    assert.match(markup, new RegExp(`Panel 1 of ${plan.panels.length}`));
    // Every section is a panel's or the record's, never both and never neither.
    const shown = input.portfolio.sections.filter((section) => sectionRenders(section, input));
    for (const section of shown) {
      assert.notEqual(plan.consumed.has(section.id), plan.record.includes(section), section.id);
    }
  });
}

test('the sample: SG-M1, the thesis is panel 1’s one display line and the name is at title size', () => {
  const input = inputOf(samplePair(), '', SAMPLE_SNAPSHOTS);
  const markup = html(input);
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(markup)![1]!;
  assert.match(h1, /<span class="sg-who__name" data-type-role="title">Anamika Devi<\/span>/);
  assert.match(
    h1,
    /<span class="sg-who__line" data-type-role="display" data-length="short">I make failure legible\.<\/span>/,
  );
  // The lede under it is the hero's tagline, at title size; the greeting never leads (N5).
  assert.match(
    markup,
    /class="sg-who__lede" data-type-role="title"[^>]*>I build calm software at scale/,
  );
  assert.doesNotMatch(text(h1), /Hello/);
  // The only display-role text in panel 1 is the thesis.
  const panel1 = markup.slice(
    markup.indexOf('data-sg-panel="who"'),
    markup.indexOf('data-sg-panel="best"'),
  );
  assert.equal(panel1.match(/data-type-role="display"/g)?.length, 1);
  // Six panels, the sample's: who, best, numbers, more, refs, contact.
  assert.deepEqual(
    planOf(input).panels.map((panel) => [panel.key, panel.anchor]),
    [
      ['who', 'top'],
      ['best', 'sg-best-work'],
      ['numbers', 'at-a-glance'],
      ['more', 'sg-more-work'],
      ['refs', 'words-from-collaborators'],
      ['contact', 'contact'],
    ],
  );
  // The Work Showcase repeats panels 2 and 4: one back-pointer line.
  assert.match(
    markup,
    /Postmortem Template Kit, small-traces and chaos-curriculum are above, in <span><a href="#sg-best-work">Best work<\/a><\/span><span> and <a href="#sg-more-work">More work<\/a><\/span>\./,
  );
  // The contact panel nests the call to action, and its band emails the owner by name.
  assert.match(markup, /class="sg-contact__ctas"[\s\S]*?data-section-id="want-to-work-together"/);
  assert.match(
    markup,
    /href="mailto:anamika@example.com" data-dir="out" data-sg-go=""><span class="sg-band__label" data-type-role="title">Email me/,
  );
  // The record's index groups its sections by destination, Work first.
  assert.match(markup, /class="sg-index"><span class="sg-index__group"><b>Work<\/b>/);
});

test('the pager: keys only bare, snap off when it should be, a hash that won’t decode stays as written', () => {
  const key = (
    k: string,
    mods: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey', boolean>> = {},
  ) => stepFor({ key: k, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods });
  assert.equal(key('PageDown'), 1);
  assert.equal(key('ArrowUp'), -1);
  assert.equal(key('ArrowDown', { shiftKey: true }), undefined);
  assert.equal(key('ArrowLeft'), undefined);
  assert.equal(key(' '), undefined);
  assert.equal(
    snapFor({ setting: 'proximity', still: false, roomy: true, fits: true }),
    'y proximity',
  );
  assert.equal(
    snapFor({ setting: 'mandatory', still: false, roomy: true, fits: true }),
    'y mandatory',
  );
  // Mandatory downgrades itself when a panel is taller than the window.
  assert.equal(
    snapFor({ setting: 'mandatory', still: false, roomy: true, fits: false }),
    'y proximity',
  );
  assert.equal(snapFor({ setting: 'proximity', still: true, roomy: true, fits: true }), 'none');
  assert.equal(snapFor({ setting: 'proximity', still: false, roomy: false, fits: true }), 'none');
  assert.equal(snapFor({ setting: 'off', still: false, roomy: true, fits: true }), 'none');
  // Still, with no runtime of its own: the OS's reduced motion, or the boundary's reduced or static.
  assert.equal(stillFor({ reduce: false, motion: 'full' }), false);
  assert.equal(stillFor({ reduce: false, motion: null }), false);
  assert.equal(stillFor({ reduce: true, motion: 'full' }), true);
  assert.equal(stillFor({ reduce: false, motion: 'reduced' }), true);
  assert.equal(stillFor({ reduce: false, motion: 'static' }), true);
  assert.equal(fragmentId('#caf%C3%A9'), 'café');
  assert.equal(fragmentId('#100%'), '100%');
  assert.equal(fragmentId('#'), undefined);
});

test('an owner’s /#id link keeps the render’s id prefix and query, in an action band too (P1 review S4)', () => {
  const base = inputOf(samplePair(), 'pv-', SAMPLE_SNAPSHOTS, { variant: 'singular' });
  const sections = base.portfolio.sections.map((section) =>
    section.kind === 'hero'
      ? { ...section, ctas: [{ ...section.ctas![0]!, url: '/#essays' }, ...section.ctas!.slice(1)] }
      : section,
  );
  const input = {
    ...base,
    controls: { ...base.controls, heroAction: 'cta' },
    portfolio: { ...base.portfolio, sections },
  } as VariantRenderInput;
  const markup = html(input);
  const who = markup.slice(markup.indexOf('data-sg-panel="who"'));
  const band = who.slice(who.indexOf('<footer class="sg-band"'), who.indexOf('</footer>'));
  assert.match(band, /href="[^"#]*\?variant=singular#pv-essays"/);
  // It's this site's place, not another site: down the page, with no outward arrow, hint or raw URL (P1 delta S4).
  assert.match(band, /data-dir="down"/);
  assert.doesNotMatch(band, /opens another site|\/#essays</);
  assert.match(band, /<path d="M12 4v15/);
  // No owner link anywhere keeps a bare #id or /#id that skips the prefix.
  for (const [, href] of markup.matchAll(/\shref="([^"]*#[^"]*)"/g)) {
    const id = href!.slice(href!.indexOf('#') + 1);
    assert.ok(id.startsWith('pv-') || DIALOG.test(id), href);
  }
});

test('the strip counts what the counter counts, and a contact section that renders nothing gets no panel (P1 review S5)', () => {
  const sample = inputOf(samplePair(), '', SAMPLE_SNAPSHOTS);
  const silent = {
    ...sample,
    portfolio: {
      ...sample.portfolio,
      identity: { ...sample.portfolio.identity, email: undefined },
      links: [],
      contact: undefined,
    },
  } as VariantRenderInput;
  for (const [name, input, total] of [
    ['sample', sample, 6],
    ['contact renders nothing', silent, 5],
  ] as const) {
    const markup = html(input);
    assert.equal(markup.match(/class="sg-strip__seg"/g)?.length, total, name);
    assert.match(markup, new RegExp(`Panel 1 of ${total}<`), name);
    assert.equal(markup.match(/<section[^>]*class="sg-panel"/g)?.length, total, name);
    // The composition's own ways to move land on ids the page has: the rail, Contents and every band.
    const all = new Set(ids(markup));
    const own = [
      ...markup.matchAll(/<a class="sg-rail__stop[^"]*" href="#([^"]+)"/g),
      ...markup.matchAll(/<a class="sg-band__go" href="#([^"]+)"/g),
      ...markup.matchAll(/<li><a href="#([^"]+)"><span class="sg-num sg-contents__n"/g),
    ].map(([, id]) => id!);
    assert.ok(own.length > total, name);
    for (const id of own) assert.ok(all.has(id), `${name}: #${id}`);
  }
});

test('a band that leaves the site says so, as the contact links do (P1 review, cheap item 3)', () => {
  const base = inputOf(samplePair(), '', SAMPLE_SNAPSHOTS);
  const sections = base.portfolio.sections.map((section) =>
    section.kind === 'hero'
      ? { ...section, ctas: [{ ...section.ctas![0]!, url: 'https://anamika.example.com/cv.pdf' }] }
      : section,
  );
  const input = {
    ...base,
    controls: { ...base.controls, heroAction: 'cta' },
    portfolio: { ...base.portfolio, sections },
  } as VariantRenderInput;
  const markup = html(input);
  const who = markup.slice(markup.indexOf('data-sg-panel="who"'));
  const band = who.slice(who.indexOf('<footer class="sg-band"'), who.indexOf('</footer>'));
  assert.match(
    band,
    /href="https:\/\/anamika\.example\.com\/cv\.pdf"[\s\S]*\(opens another site\)<\/span><\/a>/,
  );
  // An in-page band doesn't.
  const sample = html(base);
  const first = sample.slice(
    sample.indexOf('<footer class="sg-band"'),
    sample.indexOf('</footer>'),
  );
  assert.doesNotMatch(first, /opens another site/);
});
