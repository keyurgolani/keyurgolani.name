import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  caseStudyOutline,
  chronologyOf,
  routedWork,
  sectionRenders,
} from '@portfolio/kit/sections';
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
import { PLATFORM_DEFAULTS } from '@portfolio/appearance';
import { PresentationBoundary } from '@portfolio/appearance/react';
import { Runtime } from './runtime';
import HorizontalCinema from '.';
import { chapterSpan, framedSections, homeScenes } from './scenes';

// Horizontal Cinema (redesign): its manifest, and over every contract
// fixture, the scene model and both pages. Every section that renders is
// in exactly one scene, or one reel whose parts follow each other; every
// scene is one of the module's widths; home has one h1, one main, unique
// ids under the prefix, and every fragment link lands; a work's own page
// is the storyboard, with every part's anchor.

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const RAW = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

const MANIFEST = (() => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name, exports: PACKAGE.exports });
  assert.ok(result.ok, JSON.stringify(result.ok ? [] : result.diagnostics));
  return result.manifest as VariantManifest;
})();

function inputOf(
  pair: ParsedPair,
  route: VariantRenderInput['route'] | { route: 'home' } = { route: 'home' },
  idPrefix = '',
  mount: { basePath?: string; query?: Readonly<Record<string, string>> } = {},
): VariantRenderInput {
  return buildRenderInput({
    view: resolvePortfolioView(pair, {}, { mediaBase: '/media' }),
    manifest: MANIFEST,
    route: route as never,
    basePath: mount.basePath ?? '',
    query: mount.query,
    origin: 'https://rowan.test',
    requestTime: '2026-10-23T12:00:00Z',
    idPrefix,
  });
}

function pairOf(name: string): ParsedPair {
  const read = readPair(contractFixture(name).files);
  assert.ok(read.ok, `${name}: ${JSON.stringify(read)}`);
  return read.pair;
}

const html = (input: VariantRenderInput) =>
  renderToStaticMarkup(<HorizontalCinema input={input} />);
const ids = (markup: string) => [...markup.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id!);
const fragments = (markup: string) =>
  [...markup.matchAll(/\shref="[^"#]*#([^"]+)"/g)].map(([, id]) => decodeURIComponent(id!));

test('its manifest renders every core kind itself, owns both pages, and has a List view', () => {
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
  assert.equal(MANIFEST.routes.work, 'bespoke');
  assert.deepEqual(
    MANIFEST.routes.views.map((view) => view.id),
    ['list'],
  );
  assert.equal(MANIFEST.budgets?.animation, 0);
});

for (const { name } of CONTRACT_FIXTURES) {
  test(`${name}: every section that renders is in one scene, every scene one of the widths`, () => {
    const input = inputOf(pairOf(name));
    const { scenes, hero, record } = homeScenes(input);
    // Every section is in one scene, or in the full record after the film.
    const framed = [
      ...scenes.flatMap((scene) => framedSections(scene).map((section) => section.id)),
      ...record.map((section) => section.id),
    ];
    const shown = input.portfolio.sections
      .filter((section) => sectionRenders(section, input) && section !== hero)
      .map((section) => section.id);
    assert.deepEqual([...framed].sort(), [...shown].sort());
    assert.equal(new Set(framed).size, framed.length, 'no section is framed twice');
    for (const scene of scenes) assert.ok([4, 6, 8, 12].includes(scene.width), `${scene.title}`);
    assert.deepEqual(
      scenes.map((scene) => scene.number),
      scenes.map((_, index) => index + 1),
    );
    // A reel's parts follow each other, numbered from 0.
    const reels = new Map<string, number[]>();
    scenes.forEach((scene, index) => {
      if (scene.kind !== 'reel') return;
      const seen = reels.get(scene.section.id) ?? [];
      if (seen.length > 0) assert.equal(seen.at(-1), index - 1, `${scene.section.id} is unbroken`);
      assert.equal(scene.part, seen.length);
      seen.push(index);
      reels.set(scene.section.id, seen);
    });
    // The film shows the signature and the works authored first, at most six, unless its one
    // works section alone holds more; every later works section waits in the full record.
    const filmed = new Set(
      scenes.flatMap((scene) =>
        scene.kind === 'reel' && scene.section.kind === 'works' ? [scene.section.id] : [],
      ),
    );
    const works = new Set([
      ...scenes.flatMap((scene) => (scene.kind === 'lead' ? [scene.work.id] : [])),
      ...scenes.flatMap((scene) =>
        scene.kind === 'reel' && scene.section.kind === 'works'
          ? scene.items.map((item) => item.id)
          : [],
      ),
    ]);
    assert.ok(works.size <= 6 || filmed.size <= 1, `the film shows ${works.size} works`);
    const order = input.portfolio.sections.filter((section) => section.kind === 'works');
    const last = Math.max(
      -1,
      ...order.flatMap((section, at) => (filmed.has(section.id) ? [at] : [])),
    );
    for (const [at, section] of order.entries()) {
      if (!sectionRenders(section, input)) continue;
      assert.equal(filmed.has(section.id), at <= last, `${section.id} is in the film in order`);
    }
    // No timeline part holds more columns than a frame fits.
    for (const scene of scenes) {
      if (scene.kind !== 'reel' || scene.section.kind !== 'chronology') continue;
      const columns = scene.items.reduce((sum, item) => sum + (item.columns ?? 1), 0);
      assert.ok(columns <= 3, `${scene.title} holds ${columns} columns`);
    }
    // Every chapter opens on its intertitle, after the title card and the lead.
    const openings = scenes.filter((scene) => scene.kind === 'intertitle');
    assert.deepEqual(
      openings.map((scene) => scene.chapter),
      [1, 2, 3, 4],
    );
  });

  test(`${name}: home has one h1 and one main, unique ids under the prefix, and every fragment lands`, () => {
    for (const prefix of ['', 'pv-']) {
      const markup = html(inputOf(pairOf(name), { route: 'home' }, prefix));
      assert.equal(markup.match(/<h1[\s>]/g)?.length, 1);
      assert.equal(markup.match(/<main[\s>]/g)?.length, 1);
      // Nothing hidden reaches the page.
      assert.doesNotMatch(markup, new RegExp(HIDDEN_CANARY), name);
      // Every core kind is Cinema's own: nothing renders through the shared kit (F5).
      assert.doesNotMatch(markup, /data-renderer="shared"/);
      const all = ids(markup);
      assert.equal(
        new Set(all).size,
        all.length,
        `duplicate ids: ${all.filter((id, i) => all.indexOf(id) !== i)}`,
      );
      if (prefix) for (const id of all) assert.ok(id.startsWith(prefix), id);
      const known = new Set(all);
      for (const fragment of fragments(markup))
        assert.ok(known.has(fragment), `#${fragment} lands`);
    }
  });

  test(`${name}: a work's own page is the storyboard, with every part's anchor`, () => {
    const pair = pairOf(name);
    const home = inputOf(pair);
    const slugs = home.portfolio.works.flatMap((work) =>
      work.caseStudy && work.slug ? [work.slug] : [],
    );
    for (const slug of slugs) {
      const input = inputOf(pair, { route: 'work', slug } as never);
      if (!routedWork(input)) continue;
      const outline = caseStudyOutline(input)!;
      const markup = html(input);
      assert.match(markup, /class="hc hc-board"/);
      assert.equal(markup.match(/<h1[\s>]/g)?.length, 1);
      const all = new Set(ids(markup));
      for (const part of outline.parts) assert.ok(all.has(part.anchor), `${slug} ${part.key}`);
    }
  });
}

test('a section whose id is a chapter anchor gives the chapter its id', () => {
  const pair = pairOf('complete');
  const sections = pair.portfolio.sections ?? [];
  const first = sections.find((section) => section.kind === 'works');
  assert.ok(first);
  const renamed = {
    ...pair,
    portfolio: {
      ...pair.portfolio,
      sections: sections.map((section) =>
        section === first ? { ...section, id: 'chapter-journey' } : section,
      ),
    },
  } as ParsedPair;
  const markup = html(inputOf(renamed));
  assert.equal(markup.match(/\sid="chapter-journey"/g)?.length, 1);
  assert.match(markup, /<div id="chapter-journey" class="hc-scene"/);
});

test('internal links keep the mount: below /sample, with its variant query', () => {
  const markup = html(
    inputOf(pairOf('complete'), { route: 'home' }, '', {
      basePath: '/sample',
      query: { variant: 'horizontal-cinema' },
    }),
  );
  assert.match(markup, /<a class="hc-chrome__name" href="\/sample\?variant=horizontal-cinema"/);
  for (const [, href] of markup.matchAll(/\shref="(\/[^"]*)"/g)) {
    assert.ok(href!.startsWith('/sample'), href);
    if (!href!.startsWith('/sample/media')) assert.match(href!, /variant=horizontal-cinema/, href);
  }
});

test('in a plate it renders the scenes with no runtime hook, no control, no landmark of its own', () => {
  const input = inputOf(pairOf('complete'), { route: 'home' }, 'pl-');
  const { displayMode, ...packs } = PLATFORM_DEFAULTS;
  const selection = { ...packs, variant: 'horizontal-cinema', displayMode };
  const appearance = {
    selection,
    requested: selection,
    resolvedMode: 'light',
    modeLocked: false,
    contrast: 'system',
    motion: 'static',
    enhancement: 'off',
    fallbackAxes: [],
    diagnostics: [],
  } as never;
  const calls: string[] = [];
  const hook = Runtime.useEnhancementRuntime;
  Runtime.useEnhancementRuntime = (options) => {
    calls.push('runtime');
    return hook(options);
  };
  let plate: string;
  try {
    plate = renderToStaticMarkup(
      <PresentationBoundary
        kind="plate"
        appearance={appearance}
        ids={{ prefix: 'pl-', main: input.ids.main }}
      >
        <HorizontalCinema input={input} />
      </PresentationBoundary>,
    );
    assert.deepEqual(calls, [], 'runtime hooks called in a plate');
  } finally {
    Runtime.useEnhancementRuntime = hook;
  }
  const all = ids(plate);
  assert.deepEqual(
    all.filter((id) => !id.startsWith('pl-')),
    [],
  );
  assert.equal(new Set(all).size, all.length);
  // The stage's region, the scrubber's live status, its transport, and the chapter control are the live page's alone.
  const stage = plate.slice(plate.indexOf('class="hc-shell"'), plate.indexOf('class="hc-credits"'));
  assert.doesNotMatch(stage, /role="region"|role="status"|aria-live|data-runtime|<button|popover/);
  assert.match(stage, /class="hc-scrub"[^>]*inert/);
});

test('the words it adds are marked English in a portfolio in another language', () => {
  const markup = html(inputOf(pairOf('academic')));
  assert.notEqual(inputOf(pairOf('academic')).portfolio.locale.slice(0, 2), 'en');
  assert.match(markup, /<span lang="en" dir="ltr">A portfolio in five chapters<\/span>/);
  assert.match(markup, /<span lang="en" dir="ltr">Strip<\/span>/);
  assert.match(markup, /<span lang="en" dir="ltr">Credits and index<\/span>/);
});

test('the controller never takes over the wheel or a touch (it reads their way, passively), writes no history entry of its own, and none in a frame', () => {
  const source = readFileSync(new URL('./controller.tsx', import.meta.url), 'utf8');
  assert.match(source, /^'use client';/);
  assert.doesNotMatch(source, /['"`](?:mousewheel|touchend|pointermove)['"`]/);
  // No way in for the wheel or a touch but a listener: no JSX handler, no property handler, and
  // every 'wheel', 'touchstart' and 'touchmove' it names is one a listener call names, so none
  // comes in through a variable or a loop.
  assert.doesNotMatch(source, /\bon(?:Wheel|TouchStart|TouchMove|TouchEnd|PointerMove)=\{/);
  assert.doesNotMatch(source, /\.on(?:wheel|touchstart|touchmove|touchend|pointermove)\s*=[^=]/);
  const named = source.match(/['"`](?:wheel|touchstart|touchmove)['"`]/g)?.length ?? 0;
  const listened =
    source.match(/(?:add|remove)EventListener\(\s*['"`](?:wheel|touchstart|touchmove)['"`]/g)
      ?.length ?? 0;
  assert.equal(named, listened);
  // Every scroll, wheel and touch it listens to is passive, so none can be cancelled.
  for (const [line] of source.matchAll(
    /addEventListener\(\s*['"`](?:scroll|wheel|touchstart|touchmove)['"`][^\n]*/g,
  )) {
    assert.match(line, /passive: true/, line);
  }
  // The wheel and touch handlers only read which way the visitor went and tell it: they call
  // nothing but tell, rtl and Math's sign and abs, and nothing in them or in tell moves the page.
  const bodyOf = (name: string) => {
    const start = source.indexOf(`const ${name} = `);
    assert.notEqual(start, -1, name);
    return source.slice(start, source.indexOf('\n    };\n', start)).replace(/\/\/[^\n]*/g, '');
  };
  const writes = /scrollTo|scrollBy|scrollIntoView|preventDefault|setAlong|scroll(?:Top|Left)\s*=/;
  const handlers = [
    ...source.matchAll(/addEventListener\(\s*['"`](?:wheel|touchstart|touchmove)['"`],\s*(\w+)/g),
  ].map(([, name]) => name!);
  for (const name of handlers) {
    const body = bodyOf(name);
    assert.doesNotMatch(body, writes, name);
    for (const [, call] of body.slice(body.indexOf('=>')).matchAll(/([\w.]+)\s*\(/g))
      assert.ok(
        ['if', 'tell', 'rtl', 'Math.sign', 'Math.abs'].includes(call!),
        `${name} calls ${call}`,
      );
  }
  if (handlers.length > 0) assert.doesNotMatch(bodyOf('tell'), writes, 'tell');
  // It calls preventDefault for an arrow step and for Home or End alone, and in the open chapter
  // sheet for Tab at either end of its links, which goes round them.
  assert.equal(source.match(/preventDefault\(\)/g)?.length, 3);
  assert.match(
    source,
    /if \(event\.key !== 'Tab' \|\| event\.altKey \|\| event\.ctrlKey \|\| event\.metaKey\) return;[\s\S]{0,400}if \(!to\) return;\s*event\.preventDefault\(\);/,
  );
  assert.doesNotMatch(source, /pushState|location\.(?:assign|replace)\(|location\.hash\s*=/);
  assert.equal(source.match(/history\.replaceState/g)?.length, 1);
  // It names a scene in the URL only while one is being read, and never over a fragment inside that scene.
  assert.match(source, /if \(!framed && readsScene\(\) && !namesWithin\(position\)\)/);
  assert.match(source, /const framed = window\.self !== window\.top;/);
});

test('torn down, the controller refits nothing and leaves none of its attributes on the shell', () => {
  const source = readFileSync(new URL('./controller.tsx', import.meta.url), 'utf8');
  // A refit the text-size sentinel or a late frame calls after teardown does nothing.
  assert.match(source, /const refitNow = \([^)]*\) => \{\s*if \(disposed\) return;/);
  // Its cleanup takes off every attribute it sets on the shell: the pin, the rail's and the fit's.
  const cleanup = source.slice(source.indexOf('disposed = true;'));
  for (const name of ['pin', 'rail', 'fit'])
    assert.match(cleanup, new RegExp(`delete rootElement\\.dataset\\.${name};`), name);
});

test("a work whose title repeats its section's still links to its own address", () => {
  const pair = pairOf('complete');
  const works = pair.portfolio.works ?? [];
  const work = works.find((one) => one.url);
  assert.ok(work, 'the fixture has a work with an address');
  const sections = (pair.portfolio.sections ?? []).map((section) =>
    section.kind === 'works'
      ? ({ ...section, title: work.title, items: [work.id] } as typeof section)
      : section,
  );
  const markup = html(
    inputOf({
      ...pair,
      portfolio: { ...pair.portfolio, sections, signature: undefined },
    } as ParsedPair),
  );
  assert.ok(markup.includes(`href="${work.url}"`), 'its address is linked');
});

for (const { name } of CONTRACT_FIXTURES) {
  test(`${name}: the timeline plots only its chapter's years and names every entry it can't (HOR-3)`, () => {
    const input = inputOf(pairOf(name));
    const { scenes } = homeScenes(input);
    const scene = scenes.find((one) => one.kind === 'timeline');
    if (!scene || scene.kind !== 'timeline') return;
    const markup = html(input);
    const figure = markup.slice(
      markup.indexOf('class="hc-timeline-figure"'),
      markup.indexOf('</figure>', markup.indexOf('class="hc-timeline-figure"')),
    );
    const span = chapterSpan(scenes, scene.chapter, input);
    const ticks = [...figure.matchAll(/--layout-at:[^"]*">(\d{4})<\/li>/g)].map(([, year]) =>
      Number(year),
    );
    assert.ok(ticks.length > 0, 'the axis has ticks');
    if (span && !span.open) {
      // No tick past the years the chapter's card prints, and no line for now.
      assert.ok(Math.max(...ticks) <= span.last, `${Math.max(...ticks)} > ${span.last}`);
      assert.doesNotMatch(figure, /hc-timeline-figure__now/);
    }
    // Every dated entry is a bar or named in the caption: the crop hides none.
    const escape = (text: string) =>
      text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    for (const entry of scene.sections.flatMap((section) => chronologyOf(section, input))) {
      if (!entry.period) continue;
      assert.ok(figure.includes(escape(entry.title)), `${entry.title} is drawn or named`);
    }
  });
}
