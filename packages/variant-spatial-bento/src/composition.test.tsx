import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PresentationBoundary } from '@portfolio/appearance/react';
import { PLATFORM_DEFAULTS } from '@portfolio/appearance';
import { renderSection, SHARED_RENDERERS } from '@portfolio/kit/sections';
import { composeSchemas, resolvePortfolioView, type ParsedPair } from '@portfolio/schema';
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
import SpatialBento from '.';
import { decideStage } from './policy';
import { Runtime } from './runtime';
import { buildScene, PARTICLE_COUNT, PLANES } from './scene';

// Spatial Bento (#16): its manifest holds the catalog's pins and declares
// the stage's heavy budgets, and it renders every contract fixture as one
// main, one h1, one visitor control slot, its section links, and a tile a
// section in content order, each section with every word, link, and action
// the shared renderers write, beside a still of the stage that holds none
// of them. Nothing hidden reaches it, and in a plate every id is under the
// prefix. The stage is one lazily loaded module, off the static path, run
// by a pure capability policy over a bounded scene.

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const RAW = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const CEILINGS = JSON.parse(
  readFileSync(new URL('../../../runtime-budgets.json', import.meta.url), 'utf8'),
).budgets.tiers;
const { PortfolioSchema } = composeSchemas();

test("its manifest validates with nothing to report, holds the catalog's pins, and declares the stage's heavy budgets", () => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name, exports: PACKAGE.exports });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, []);
  const { manifest } = result;
  assert.equal(manifest.id, 'spatial-bento');
  assert.deepEqual(
    [manifest.compositionFamily, manifest.motionIntent, manifest.performanceTier],
    ['bento', 'adaptive', 'heavy'],
  );
  assert.deepEqual(manifest.renderedKinds, ['hero']);
  assert.deepEqual(manifest.unsupportedKinds, []);
  assert.deepEqual(manifest.textDirection, ['ltr', 'rtl']);
  // The heavy tier, for the stage: its chunk, three.js and R3F in it, is the enhancement's budget,
  // and the static path's JavaScript stays inside the medium tier's.
  const budgets: Record<string, number> = { ...manifest.budgets };
  assert.equal(Object.keys(budgets).length, 6);
  for (const [kind, declared] of Object.entries(budgets)) {
    assert.ok(
      declared <= CEILINGS.heavy[kind],
      `${kind}: ${declared} over heavy's ${CEILINGS.heavy[kind]}`,
    );
  }
  assert.ok(budgets.js! <= CEILINGS.medium.js);
  assert.ok(
    budgets.enhancement! > CEILINGS.medium.enhancement,
    'the stage is why the tier is heavy',
  );
  // The stage's chunk, three.js and R3F in it, at most 250 KB gzipped.
  assert.ok(budgets.enhancement! <= 250 * 1024);
  // The stage is the one enhancement: WebGL2 and the width it needs, its export the lazily loaded module.
  assert.deepEqual(manifest.enhancements, [
    { id: 'stage', export: './enhancements/stage', requires: ['webgl2', 'min-width:768'] },
  ]);
  assert.equal(PACKAGE.exports['./enhancements/stage'], './src/stage-canvas.tsx');
  assert.deepEqual(PACKAGE.portfolio, { kind: 'variant', manifest: './manifest.json' });
  // Its tests run under the root's pnpm test.
  assert.match(PACKAGE.scripts.test, /tsx --test/);
});

const MANIFEST = (() => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name });
  assert.ok(result.ok);
  return result.manifest as VariantManifest;
})();

/** The render input of a contract fixture, as the host builds it. */
function fixtureInput(name: string, idPrefix = ''): VariantRenderInput {
  const fixture = contractFixture(name);
  const read = readPair(fixture.files);
  assert.ok(read.ok, JSON.stringify(read));
  return inputOf(read.pair, idPrefix);
}

function inputOf(pair: ParsedPair, idPrefix = ''): VariantRenderInput {
  return buildRenderInput({
    view: resolvePortfolioView(pair, {}, { mediaBase: '/media' }),
    manifest: MANIFEST,
    route: { route: 'home' },
    basePath: '',
    origin: 'https://rowan.test',
    requestTime: '2026-10-23T12:00:00Z',
    idPrefix,
  });
}

/** The shared renderer for the one kind the manifest renders itself, so a section renders as the kit alone writes it. */
const SHARED_HERO = { hero: SHARED_RENDERERS.hero };

const html = (input: VariantRenderInput) => renderToStaticMarkup(<SpatialBento input={input} />);
const count = (markup: string, pattern: RegExp) => markup.match(pattern)?.length ?? 0;
const ids = (markup: string) => [...markup.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id!);
const hrefs = (markup: string) =>
  [...markup.matchAll(/\shref="([^"]+)"/g)].map(([, href]) => href!);
/** `markup` as the text it reads as: no tags, entities decoded, spaces folded. */
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** One rendered section's markup, by its id: its own <section> element, whole. */
function sectionMarkup(markup: string, id: string): string {
  const start = markup.indexOf(`<section id="${id}"`);
  assert.ok(start >= 0, `section ${id}`);
  let depth = 0;
  for (const match of markup.slice(start).matchAll(/<(\/?)section\b[^>]*>/g)) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return markup.slice(start, start + match.index + match[0].length);
  }
  throw new Error(`section ${id} never closes`);
}

/** The stage's exit, the one control the bento adds to a section. */
/** With, while the stage can't run, the hidden line that describes it. */
const EXIT =
  /<span class="sb-stage__exit"><button\b[^>]*>[\s\S]*?<\/button>(?:<span id="[^"]+" hidden="">[^<]*<\/span>)?<\/span>/g;
const withoutExit = (markup: string) => markup.replace(EXIT, '');

test('the complete fixture renders one main, one h1, one visitor control slot, and its section links before the main', () => {
  const input = fixtureInput('complete');
  const markup = html(input);
  assert.equal(count(markup, /<main\b/g), 1);
  assert.equal(count(markup, /<h1\b/g), 1);
  assert.equal(count(markup, /data-visitor-control-slot/g), 1);
  assert.equal(count(markup, /<nav\b/g), 1);
  assert.ok(markup.indexOf('<header class="sb-header"') < markup.indexOf('<main'));
  const titled = input.portfolio.sections.filter(
    (section) => section.kind !== 'hero' && section.kind !== 'cta' && section.title?.trim(),
  );
  assert.ok(titled.length > 8);
  const nav = markup.slice(markup.indexOf('<nav'), markup.indexOf('</nav>'));
  assert.deepEqual(
    hrefs(nav),
    titled.map((section) => `#${section.id}`),
  );
  // Nothing is hidden in the server's markup but the navigation's name, which names it, and the
  // line that describes the exit, disabled until a browser says the stage can run.
  assert.deepEqual(
    [...markup.matchAll(/<[^>]*\shidden=""[^>]*>[^<]*/g)].map(([tag]) => tag),
    [
      '<span id="sb--sections" hidden="">Sections',
      '<span id="sb--stage-unavailable" hidden="">The 3D stage isn&#x27;t available here.',
    ],
  );
  assert.match(
    markup,
    /<button(?=[^>]*\saria-describedby="sb--stage-unavailable")(?=[^>]*\sdisabled="")/,
  );
});

test('every section is a tile of the bento, in content order, the opening first with the still beside it', () => {
  const input = fixtureInput('complete');
  const markup = html(input);
  const main = markup.slice(markup.indexOf('<main'));
  const tiles = [...main.matchAll(/<section id="([^"]+)"[^>]*data-section-id/g)].map(
    ([, id]) => id,
  );
  const rendered = input.portfolio.sections
    .filter((section) => renderSection(section, input, SHARED_HERO, { level: 2 }) !== null)
    .map((section) => section.id);
  assert.deepEqual(tiles, rendered);
  // The still is decoration: hidden from assistive technology, with no word, link, or control.
  const still = /<div class="sb-still" aria-hidden="true">([\s\S]*?)<\/div>/.exec(markup);
  assert.ok(still);
  assert.equal(text(still[1]!), '');
  assert.doesNotMatch(still[1]!, /<(?:a|button|input|img|svg|canvas)\b/);
  assert.equal(count(still[1]!, /class="sb-still__plane /g), 4);
  assert.equal(count(markup, /sb-still__plane--signature/g), 1);
  // The bento's one control of its own: the stage's exit, in the opening's tile, after the still.
  const exits = [...markup.matchAll(EXIT)].map(([exit]) => exit);
  assert.equal(exits.length, 1);
  assert.equal(text(/<button\b[\s\S]*?<\/button>/.exec(exits[0]!)![0]), 'Spatial stage');
  const opening = sectionMarkup(markup, 'top');
  assert.ok(opening.indexOf(exits[0]!) > opening.indexOf('class="sb-still"'));
});

test('every section holds every word, link, and action the shared renderers write for it, in every contract fixture', () => {
  let compared = 0;
  for (const { name } of CONTRACT_FIXTURES) {
    const input = fixtureInput(name);
    const markup = html(input);
    let leads = true;
    for (const section of input.portfolio.sections) {
      const level = leads && section.kind === 'hero' ? 1 : 2;
      const shared = renderSection(section, input, SHARED_HERO, { level });
      if (shared === null) continue;
      leads = false;
      const expected = renderToStaticMarkup(shared);
      // The stage's exit is the bento's own control, beside what the shared renderers write.
      const actual = withoutExit(sectionMarkup(markup, `${input.ids.prefix}${section.id}`));
      assert.equal(text(actual), text(expected), `${name} ${section.id}: its words`);
      assert.deepEqual(hrefs(actual), hrefs(expected), `${name} ${section.id}: its links`);
      assert.equal(
        count(actual, /<(?:a|button|img|details)\b/g),
        count(expected, /<(?:a|button|img|details)\b/g),
        `${name} ${section.id}: its links, actions, images, and disclosures`,
      );
      compared += 1;
    }
  }
  assert.ok(compared > 100, `${compared} sections compared`);
});

test('a hidden section never reaches the page: none of its words, ids, or links', () => {
  const markup = html(fixtureInput('hidden-canary'));
  assert.doesNotMatch(markup, new RegExp(HIDDEN_CANARY));
});

test('in a plate it renders the same, every id under the plate prefix and none repeated', () => {
  const input = fixtureInput('complete', 'pl-');
  // What resolveAppearance() gives a plate in the platform's own packs.
  const { displayMode, ...packs } = PLATFORM_DEFAULTS;
  const selection = { ...packs, variant: 'spatial-bento', displayMode };
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
  // Every call of the runtime's hook, which subscribes to the document,
  // observes the stage, and writes data-activity once mounted.
  const calls: string[] = [];
  const hook = Runtime.useEnhancementRuntime;
  Runtime.useEnhancementRuntime = (options) => {
    calls.push('runtime');
    return hook(options);
  };
  let plate: string;
  let documentCalls: number;
  try {
    plate = renderToStaticMarkup(
      <PresentationBoundary
        kind="plate"
        appearance={appearance}
        ids={{ prefix: 'pl-', main: input.ids.main }}
      >
        <SpatialBento input={input} />
      </PresentationBoundary>,
    );
    // A plate renders the still before any runtime hook: none is called, and the stage never enhances.
    assert.deepEqual(calls, [], 'runtime hooks called in a plate');
    // The control: outside a plate, the stage's slot calls it once.
    html(fixtureInput('complete'));
    documentCalls = calls.length;
  } finally {
    Runtime.useEnhancementRuntime = hook;
  }
  assert.equal(documentCalls, 1, 'runtime hooks outside a plate');
  assert.doesNotMatch(plate, /data-stage-reason|<canvas/);
  // The exit is there, disabled and unpressed, as the page has it, so a plate's controls are the page's.
  assert.match(
    plate,
    /<span class="sb-stage__exit"><button(?=[^>]*\saria-pressed="false")(?=[^>]*\sdisabled="")[^>]*>[\s\S]*?Spatial stage/,
  );
  const all = ids(plate);
  assert.ok(all.length > 10);
  assert.deepEqual(
    all.filter((id) => !id.startsWith('pl-')),
    [],
  );
  assert.equal(new Set(all).size, all.length, 'no id repeats');
});

test('a portfolio with no titled section has no section links, and still its h1 and visitor control', () => {
  const portfolio = PortfolioSchema.parse({
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Bento', tagline: 'Builds calm software.' },
    contact: { message: 'Write any time.' },
    sections: [{ kind: 'contact', id: 'contact' }],
  });
  const site = readPair(contractFixture('complete').files);
  assert.ok(site.ok);
  const markup = html(inputOf({ portfolio, site: site.pair.site } as ParsedPair));
  assert.doesNotMatch(markup, /<nav\b/);
  assert.equal(count(markup, /<h1 class="sb-name">Rowan Bento<\/h1>/g), 1);
  assert.equal(count(markup, /data-visitor-control-slot/g), 1);
});

/** Every module under src/, however deep, but the tests, its comments gone: a module may say what it never reads. */
const SOURCES = (readdirSync(new URL('.', import.meta.url), { recursive: true }) as string[])
  .filter((file) => /\.[cm]?[jt]sx?$/.test(file) && !/\.test\./.test(file))
  .map(
    (file) =>
      [
        file,
        readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, ''),
      ] as const,
  );

/** A 3D library or the kit's spatial, R3F, canvas, or enhancement modules, however a module reaches it. */
const STAGE_IMPORT =
  /(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)['"](?:three(?:\/[^'"]*)?|@react-three\/[^'"]+|postprocessing(?:\/[^'"]*)?|@portfolio\/kit\/(?:spatial|spatial-r3f|spatial-canvas|enhancements)(?:\/[^'"]*)?)['"]/;

/** A module's source without its type-only imports, which ship nothing. */
const runtimeSource = (source: string) => source.replace(/^import\s+type\b[^;]*;/gm, '');

test('the static path holds no stage code: the stage and three.js are one lazily loaded module', () => {
  const STAGE = 'stage-canvas.tsx';
  assert.ok(SOURCES.some(([file]) => file === STAGE));
  for (const [file, source] of SOURCES) {
    if (file === STAGE) {
      // The stage reaches three.js through the kit's canvas subpath alone, and no other spatial effect.
      assert.match(source, /from '@portfolio\/kit\/spatial-canvas'/, file);
      assert.doesNotMatch(
        source.replace(/'@portfolio\/kit\/spatial-canvas'/g, "''"),
        STAGE_IMPORT,
        file,
      );
      continue;
    }
    assert.doesNotMatch(runtimeSource(source), STAGE_IMPORT, file);
    // The stage's module only through import(), once the policy says it runs.
    assert.doesNotMatch(source, /from\s+['"]\.\/stage-canvas['"]/, file);
  }
  // One import() in the package, stage.tsx's, of the stage's module.
  assert.deepEqual(
    SOURCES.filter(([file]) => !file.endsWith('.test.tsx')).flatMap(([file, source]) =>
      [...source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map(
        ([, from]) => `${file} ${from}`,
      ),
    ),
    ['stage.tsx ./stage-canvas'],
  );
  // The matcher sees every way in: a bare import, a dynamic one, a require, and a subpath.
  for (const reach of [
    "import '@portfolio/kit/spatial';",
    "const stage = import('@portfolio/kit/spatial-r3f');",
    "import { x } from '@portfolio/kit/spatial-r3f/spatial-canvas';",
    "import { SpatialCanvas } from '@portfolio/kit/spatial-canvas';",
    "const three = require('three');",
    "import('three/examples/jsm/controls/OrbitControls.js')",
    "export { Canvas } from '@react-three/fiber';",
  ]) {
    assert.match(reach, STAGE_IMPORT, reach);
  }
  assert.doesNotMatch("import { renderSection } from '@portfolio/kit/sections';", STAGE_IMPORT);
  // No CDN-backed helper, and none of the reads the policy rules out.
  for (const [file, source] of SOURCES) {
    assert.doesNotMatch(
      source,
      /@react-three\/drei|userAgent|WEBGL_debug_renderer_info|getBattery|localStorage|sessionStorage/,
      file,
    );
  }
  // No 3D library of its own: the kit's are the only copies.
  const dependencies = { ...PACKAGE.dependencies, ...PACKAGE.peerDependencies };
  for (const name of Object.keys(dependencies)) {
    assert.doesNotMatch(name, /^(?:three|@react-three\/|postprocessing)/, name);
  }
});

test("the server draws the still, and the stage's slot adds nothing to it until a browser runs it", () => {
  const markup = html(fixtureInput('complete'));
  assert.match(
    markup,
    /<div class="sb-stage" data-stage-reason="pending"><div class="sb-still" aria-hidden="true">/,
  );
  assert.doesNotMatch(markup, /<canvas|data-stage=|data-activity/);
  // The slot's first render is pending, so the server's markup carries the reason the stage waits,
  // and the exit, disabled until a browser says the stage can run.
  assert.match(markup, /data-stage-reason="pending"/);
  assert.equal(count(markup, /class="sb-stage__exit"/g), 1);
  assert.match(
    markup,
    /<span class="sb-stage__exit"><button(?=[^>]*\saria-pressed="false")(?=[^>]*\sdisabled="")[^>]*>[\s\S]*?Spatial stage/,
  );
});

const RUNNING: Parameters<typeof decideStage>[0] = {
  state: 'active',
  reason: 'running',
  eligible: true,
  forcedColors: false,
  moreContrast: false,
  highContrast: false,
  enhancement: 'on',
  deviceMemory: 8,
  cores: 8,
  saveData: false,
  failed: false,
  exited: false,
  claimed: true,
  started: false,
};

test('the declared enhancement is the whole slot, so however it loads, the policy decides', async () => {
  const { default: StageEnhancement } = await import('./stage-canvas');
  const { StageSlot } = await import('./stage');
  const input = fixtureInput('complete');
  const enhancement = renderToStaticMarkup(<StageEnhancement input={input} />);
  assert.equal(
    enhancement,
    renderToStaticMarkup(<StageSlot seed={input.env.seed} idPrefix={input.ids.prefix} />),
  );
  assert.match(enhancement, /^<div class="sb-stage" data-stage-reason="pending">/);
  assert.doesNotMatch(enhancement, /<canvas/);
});

test('the capability policy: a supported device runs the stage, and every reason it stays off does', () => {
  assert.deepEqual(decideStage(RUNNING), { mount: true, offered: true, reason: 'running' });
  // Hints the browser doesn't give count for nothing either way.
  assert.equal(decideStage({ ...RUNNING, deviceMemory: null, cores: null }).mount, true);
  const off: [Partial<typeof RUNNING>, string, boolean][] = [
    [{ state: 'static', reason: 'reduced' }, 'reduced', false],
    [{ state: 'static', reason: 'pending' }, 'pending', false],
    [{ state: 'static', reason: 'failed' }, 'failed', false],
    [{ failed: true }, 'failed', false],
    [{ forcedColors: true }, 'forced-colors', false],
    [{ moreContrast: true }, 'contrast', false],
    [{ highContrast: true }, 'contrast', false],
    [{ enhancement: 'off' }, 'preview-off', false],
    [{ eligible: false }, 'unsupported', false],
    [{ deviceMemory: 2 }, 'low-memory', false],
    [{ cores: 2 }, 'low-power', false],
    [{ saveData: true }, 'save-data', false],
    [{ claimed: false }, 'another-stage', false],
    [{ exited: true }, 'exited', true],
    [{ state: 'paused', reason: 'lifecycle' }, 'lifecycle', true],
    [{ state: 'paused', reason: 'offscreen' }, 'waiting', true],
  ];
  for (const [change, reason, offered] of off) {
    assert.deepEqual(
      decideStage({ ...RUNNING, ...change }),
      { mount: false, offered, reason },
      JSON.stringify(change),
    );
  }
  // A stage that started holds still while paused, and a static runtime ends it.
  assert.deepEqual(decideStage({ ...RUNNING, state: 'paused', reason: 'hidden', started: true }), {
    mount: true,
    offered: true,
    reason: 'paused',
  });
  assert.equal(
    decideStage({ ...RUNNING, state: 'static', reason: 'reduced', started: true }).mount,
    false,
  );
  // Nothing turns it on against reduced motion, forced colors, or more contrast, whatever else holds.
  for (const against of [
    { state: 'static', reason: 'reduced' },
    { forcedColors: true },
    { moreContrast: true },
    { highContrast: true },
  ] as const) {
    assert.equal(decideStage({ ...RUNNING, ...against, started: true }).mount, false);
  }
});

test('the scene is bounded: the same planes and particles whatever the portfolio holds, placed in one pass', () => {
  const scene = buildScene(42);
  assert.equal(scene.planes.length, PLANES.length);
  assert.equal(PLANES.length, 4);
  assert.equal(scene.particles.length, PARTICLE_COUNT * 3);
  assert.ok(PARTICLE_COUNT <= 2000);
  // Seeded: the same seed, the same field.
  assert.deepEqual([...buildScene(42).particles], [...scene.particles]);
  assert.notDeepEqual([...buildScene(43).particles.slice(0, 6)], [...scene.particles.slice(0, 6)]);
  // The scene's size never depends on the content: the largest fixture's seed builds the same count.
  const large = fixtureInput('large');
  assert.equal(buildScene(large.env.seed).particles.length, PARTICLE_COUNT * 3);
  // Linear in the particles, and no pointer at all: no nested loop over them.
  const source = readFileSync(new URL('./scene.ts', import.meta.url), 'utf8');
  assert.equal(count(source, /for \(let /g), 2);
  for (const [file, text] of SOURCES)
    assert.doesNotMatch(text, /onPointer|pointermove|raycast/i, file);
});

/** The stylesheet, comments gone. */
const CSS = readFileSync(new URL('./styles.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

test('each border token is used whole, as the border it is, never as a width', () => {
  // The design language's --ui-border-* is a whole border, or none: `1px solid var(--color-border-default)`.
  const uses = [...CSS.matchAll(/([a-z-]+)\s*:([^;{}]*var\(--ui-border-[^;{}]*)/g)];
  assert.ok(uses.length >= 3, `${uses.length} uses`);
  for (const [declaration, property, value] of uses) {
    assert.match(property!, /^border(?:-(?:block|inline)(?:-(?:start|end))?)?$/, declaration);
    assert.match(value!.trim(), /^var\(--ui-border-[a-z]+\)$/, declaration);
  }
});

test('the bento keeps content order: no dense packing, no reordering, and nothing that moves', () => {
  assert.doesNotMatch(CSS, /\bdense\b/);
  assert.doesNotMatch(CSS, /(?<![\w-])order\s*:/);
  assert.doesNotMatch(CSS, /\b(?:animation|transition)\b|@keyframes/);
});
