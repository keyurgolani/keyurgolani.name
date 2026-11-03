import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PresentationBoundary } from '@portfolio/appearance/react';
import { PLATFORM_DEFAULTS } from '@portfolio/appearance';
import { pageOutline, sectionRenders, shownPlace, worksOf } from '@portfolio/kit/sections';
import { resolvePortfolioView, type ParsedPair } from '@portfolio/schema';
import { readPair } from '@portfolio/schema/node';
import {
  buildRenderInput,
  validateManifest,
  type RouteTarget,
  type VariantManifest,
  type VariantRenderInput,
} from '@portfolio/variant-contract';
import {
  checkOutline,
  CONTRACT_FIXTURES,
  contractFixture,
  HIDDEN_CANARY,
} from '@portfolio/variant-contract/node';
import SpatialBento, { sections as SECTIONS } from '.';
import { closesSheet } from './case-focus';
import { DECISION_HEADS, tileAnchor } from './case';
import { cameFrom, openerOf } from './return-focus';
import { holdsTarget, RECORD } from './record-folds';
import { fragmentId } from './fragment';
import { recordSpans } from './record';
import { echoes } from './home';
import { replyPromise } from './chrome';
import { handleOf } from './parts';
import { durationMs, settles, SETTLE } from './settle';
import { TALLY_LABEL, TALLY_MOST, tallyOf, tallyWords } from './renderers/evidence';
import { TRACKS_SHOWN, tracksWords } from './renderers/works';
import {
  boardOf,
  boardsOf,
  DISPLAY_MOST,
  statementClass,
  boardTarget,
  archived,
  laterRole,
  overviewOf,
  overviewPlane,
  pack,
  packByHeight,
  showcaseOrder,
  tileSize,
  SHOWCASE_MOST,
  type Overview,
  type TileSize,
} from './model';
import { decideStage, exitedAfterPress, staticPressed } from './policy';
import { Runtime } from './runtime';
import { boxEdges, buildScene, FOOTPRINT, MAX_BLOCKS, MAX_PLANES, onDemand } from './scene';

// Spatial Bento (#16; the redesign's stream E): its manifest renders every
// core kind bespoke and owns the work route, and every contract fixture and
// the bundled sample render as one composed field: one main, one h1, one
// visitor control slot, every section framed with its anchor and none
// through the kit's shared renderers, the outline check clean on home and
// on every case study, nothing hidden reaching it, and every id under a
// plate's prefix. The field's model fills every cell: each board's rows
// fill their columns, and the overview's areas cover its grid once. The
// stage is one lazily loaded module, off the static path, run by a pure
// capability policy over a bounded scene.

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const RAW = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const CEILINGS = JSON.parse(
  readFileSync(new URL('../../../runtime-budgets.json', import.meta.url), 'utf8'),
).budgets.tiers;
const CORE_KINDS = [
  'hero',
  'lede',
  'now',
  'focus',
  'fun-facts',
  'quote',
  'contact',
  'cta',
  'works',
  'evidence',
  'chronology',
  'practice',
  'github',
  'custom',
];

test('its manifest validates, renders every core kind bespoke, owns home, and declares the stage’s heavy budgets', () => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name, exports: PACKAGE.exports });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, []);
  const { manifest } = result;
  assert.equal(manifest.id, 'spatial-bento');
  assert.deepEqual(
    [manifest.compositionFamily, manifest.motionIntent, manifest.performanceTier],
    ['bento', 'adaptive', 'heavy'],
  );
  assert.deepEqual([...manifest.renderedKinds].sort(), [...CORE_KINDS].sort());
  assert.deepEqual(manifest.unsupportedKinds, []);
  // Both of its routes are its own: home's field and the work's sheet.
  assert.deepEqual(manifest.routes, { home: 'bespoke', work: 'bespoke', views: [] });
  assert.deepEqual(manifest.textDirection, ['ltr', 'rtl']);
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
  assert.ok(budgets.enhancement! <= 250 * 1024);
  assert.deepEqual(manifest.enhancements, [
    { id: 'stage', export: './enhancements/stage', requires: ['webgl2', 'min-width:768'] },
  ]);
  assert.equal(PACKAGE.exports['./enhancements/stage'], './src/stage-canvas.tsx');
  assert.deepEqual(PACKAGE.portfolio, { kind: 'variant', manifest: './manifest.json' });
  assert.match(PACKAGE.scripts.test, /tsx --test/);
});

const MANIFEST = (() => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name });
  assert.ok(result.ok);
  return result.manifest as VariantManifest;
})();

const REPO = new URL('../../../', import.meta.url).pathname;

/** Every pair the composition is held on: the contract fixtures and the bundled sample. */
const PAIRS = [
  ...CONTRACT_FIXTURES.map(({ name }) => ({ name, files: contractFixture(name).files })),
  {
    name: 'sample',
    files: { portfolio: `${REPO}portfolio.example.yml`, site: `${REPO}site.example.yml` },
  },
];

function pairOf(name: string): ParsedPair {
  const files = PAIRS.find((pair) => pair.name === name)!.files;
  const read = readPair(files);
  assert.ok(read.ok, JSON.stringify(read));
  return read.pair;
}

function inputOf(pair: ParsedPair, idPrefix = '', route: RouteTarget = { route: 'home' }) {
  return buildRenderInput({
    view: resolvePortfolioView(pair, {}, { mediaBase: '/media' }),
    manifest: MANIFEST,
    route,
    basePath: '',
    origin: 'https://rowan.test',
    requestTime: '2026-10-23T12:00:00Z',
    idPrefix,
  });
}

const fixtureInput = (name: string, idPrefix = '') => inputOf(pairOf(name), idPrefix);

const html = (input: VariantRenderInput) => renderToStaticMarkup(<SpatialBento input={input} />);
const count = (markup: string, pattern: RegExp) => markup.match(pattern)?.length ?? 0;
const ids = (markup: string) => [...markup.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id!);
/** `markup` as the text it reads as: no tags, spaces folded. */
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The slugs of the works with their own page. */
const slugsOf = (input: VariantRenderInput) =>
  input.portfolio.works.flatMap((work) =>
    work.caseStudy !== undefined && work.slug !== undefined ? [work.slug] : [],
  );

test('every pair renders one main, one h1, one visitor control slot, and no section through the shared renderers', () => {
  for (const { name } of PAIRS) {
    const input = fixtureInput(name);
    const markup = html(input);
    assert.equal(count(markup, /<main\b/g), 1, name);
    assert.equal(count(markup, /<h1\b/g), 1, name);
    assert.equal(count(markup, /data-visitor-control-slot/g), 1, name);
    assert.equal(count(markup, /data-renderer="shared"/g), 0, name);
    const rendered = input.portfolio.sections.filter((section) => sectionRenders(section, input));
    assert.equal(
      count(markup, /data-section-id="/g),
      rendered.length,
      `${name}: one frame a section`,
    );
  }
});

test('the outline check finds nothing on home or on any case study, with no prefix and with one', () => {
  let pages = 0;
  for (const { name } of PAIRS) {
    for (const idPrefix of ['', 'pv-']) {
      const home = fixtureInput(name, idPrefix);
      const sections = pageOutline(home, SECTIONS).sections.map(({ id, anchor }) =>
        anchor === undefined ? { id } : { id, anchor },
      );
      assert.deepEqual(checkOutline(html(home), home.ids, { sections }), [], `${name} home`);
      pages += 1;
      for (const slug of slugsOf(home)) {
        const input = inputOf(pairOf(name), idPrefix, { route: 'work', slug });
        const markup = html(input);
        assert.deepEqual(checkOutline(markup, input.ids), [], `${name} /work/${slug}`);
        assert.equal(count(markup, /<h1\b/g), 1, `${name} /work/${slug}`);
        pages += 1;
      }
    }
  }
  assert.ok(pages > 20, `${pages} pages`);
});

test('the overview reads in one band: the hero plate with the thesis, Selected work, Contents, Now and the ledger, and the reach tile', () => {
  const input = fixtureInput('sample');
  const markup = html(input);
  const overview = markup.slice(
    markup.indexOf('class="sb-overview"'),
    markup.indexOf('class="sb-board"'),
  );
  const order = [
    'data-section-id="top"',
    'data-section-id="thesis"',
    'data-section-id="work-showcase"',
    'class="sb-tile sb-tile--large sb-contents"',
    'data-section-id="now"',
    'data-section-id="at-a-glance"',
    'class="sb-tile sb-tile--dense sb-tile--accent sb-reach"',
  ].map((needle) => overview.indexOf(needle));
  assert.ok(
    order.every((at) => at >= 0),
    JSON.stringify(order),
  );
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
  );
  // Wider, the works sit from the line named works, under the hero's row; on a phone they follow the hero.
  assert.match(
    CSS,
    /\.sb-band \{\s*grid-template-columns: repeat\(24, minmax\(0, 1fr\)\);\s*grid-template-rows: auto auto \[works\] auto 1fr;/,
  );
  assert.match(
    CSS,
    /\.sb-band \[data-area='lead'\] \{\s*grid-column: 1 \/ span 10;\s*grid-row: works \/ -1;/,
  );
  assert.match(
    CSS,
    /\.sb-band\[data-works\] \[data-area='reach'\] \{\s*grid-column: 4 \/ -1;\s*grid-row: 3 works;/,
  );
  // The thesis's first sentence is the display line, set inside the hero's frame.
  assert.match(overview, /<p class="sb-hero__display">I make failure legible\.<\/p>/);
  // The Contents tile: the overview and each board, each beside its plane, the still decoration.
  const still = /<div class="sb-still" aria-hidden="true">([\s\S]*?)<\/div><\/div>/.exec(markup);
  assert.ok(still);
  assert.equal(text(still[1]!), '');
  const boards = boardsOf(
    input.portfolio.sections.filter((section) => sectionRenders(section, input)),
    overviewOf(input.portfolio.sections, input),
    input,
  );
  assert.deepEqual(
    boards.map((board) => board.id),
    ['work', 'writing', 'record', 'about', 'contact'],
  );
  assert.equal(count(still[1]!, /class="sb-still__plane/g), boards.length + 1);
  assert.equal(count(markup, /sb-still__plane--near/g), 1);
  assert.equal(count(markup, /class="sb-contents__row"/g), boards.length + 1);
});

test('a hidden section never reaches the page: none of its words, ids, or links', () => {
  const markup = html(fixtureInput('hidden-canary'));
  assert.doesNotMatch(markup, new RegExp(HIDDEN_CANARY));
});

test('in a plate it renders the same, every id under the plate prefix and none repeated, and no runtime hook runs', () => {
  const input = fixtureInput('complete', 'pl-');
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
    assert.deepEqual(calls, [], 'runtime hooks called in a plate');
    html(fixtureInput('complete'));
    documentCalls = calls.length;
  } finally {
    Runtime.useEnhancementRuntime = hook;
  }
  assert.equal(documentCalls, 1, 'runtime hooks outside a plate');
  assert.doesNotMatch(plate, /data-stage-reason|<canvas|class="sb-dock"/);
  assert.match(
    plate,
    /<span class="sb-stage__exit"><button(?=[^>]*\saria-pressed="true")(?=[^>]*\saria-disabled="true")(?![^>]*\sdisabled="")[^>]*>[\s\S]*?Static view/,
  );
  const all = ids(plate);
  assert.ok(all.length > 10);
  assert.deepEqual(
    all.filter((id) => !id.startsWith('pl-')),
    [],
  );
  assert.equal(new Set(all).size, all.length, 'no id repeats');
});

test('a portfolio with only a contact section still has its h1, its index, and its visitor control', async () => {
  const { composeSchemas } = await import('@portfolio/schema');
  const { PortfolioSchema } = composeSchemas();
  const portfolio = PortfolioSchema.parse({
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Bento', tagline: 'Builds calm software.' },
    contact: { message: 'Write any time.' },
    sections: [{ kind: 'contact', id: 'contact' }],
  });
  const site = pairOf('complete').site;
  const input = inputOf({ portfolio, site } as ParsedPair);
  const markup = html(input);
  assert.equal(count(markup, /<h1 class="sb-hero__name">Rowan Bento<\/h1>/g), 1);
  assert.equal(count(markup, /data-visitor-control-slot/g), 1);
  assert.deepEqual(checkOutline(markup, input.ids), []);
});

test('every board fills its field exactly once, rows in order, a wide tile alone, the label in its corner', () => {
  for (const { name } of PAIRS) {
    const input = fixtureInput(name);
    const rendering = input.portfolio.sections.filter((section) => sectionRenders(section, input));
    for (const board of boardsOf(rendering, overviewOf(rendering, input), input)) {
      const where = `${name} ${board.id}`;
      // A board of the full record alone sets only the Record's own tiles: nothing to pack.
      if (board.tiles.length === 0) continue;
      const cells = new Map<string, string>();
      const take = (row: number, col: number, who: string) => {
        const key = `${row}:${col}`;
        assert.equal(
          cells.get(key),
          undefined,
          `${where}: ${who} over ${cells.get(key)} at ${key}`,
        );
        cells.set(key, who);
      };
      for (let row = 0; row < (board.tallFirst ? 2 : 1); row += 1) {
        for (let col = 0; col < 3; col += 1) take(row, col, 'label');
      }
      for (const tile of board.tiles) {
        for (let row = tile.row; row < tile.row + tile.rows; row += 1) {
          for (let col = tile.col; col < tile.col + tile.span; col += 1)
            take(row, col, tile.section.id);
        }
        if (tile.span === 12) assert.equal(tile.col, 0, where);
      }
      assert.equal(cells.size, board.rows * 12, `${where}: every cell, once`);
      // DOM order is row order: each tile starts no higher than the one before it, a stack's lower half just after its upper.
      board.tiles.forEach((tile, i) => {
        const before = board.tiles[i - 1];
        if (before)
          assert.ok(
            tile.row >= before.row,
            `${where}: ${tile.section.id} after ${before.section.id}`,
          );
        if (tile.fixed)
          assert.equal(before?.col, tile.col, `${where}: ${tile.section.id} under its pair`);
      });
      // A tile that must be alone is.
      for (const tile of board.tiles) {
        if (!tileSize(tile.section, input).wide) continue;
        assert.equal(board.tiles.filter((other) => other.row === tile.row).length, 1, where);
      }
    }
  }
  // By height: three tiles that come out level at four columns each share a row.
  const level = { height: () => 300, least: 3, prefer: 4, wide: false };
  const even = packByHeight([level, level, level], 12, 12);
  assert.deepEqual(
    even.places.map((place) => place.span),
    [4, 4, 4],
  );
  // A tall tile beside two short ones takes two rows, the short ones stacked beside it.
  const tall = { height: () => 620, least: 4, prefer: 6, wide: false };
  const short = { height: () => 300, least: 4, prefer: 6, wide: false };
  const stacked = packByHeight([tall, short, short], 12, 12);
  assert.deepEqual(
    stacked.places.map(({ col, row, rows, fixed }) => [col, row, rows, fixed]),
    [
      [0, 0, 2, false],
      [stacked.places[0]!.span, 0, 1, false],
      [stacked.places[0]!.span, 1, 1, true],
    ],
  );
  assert.equal(stacked.rows, 2);
  // Packing by hand: a wide tile takes its own row, and a lone last tile takes a neighbour.
  const sizes: TileSize[] = [
    { prefer: 4, least: 3, wide: false },
    { prefer: 12, least: 12, wide: true },
    { prefer: 4, least: 3, wide: false },
    { prefer: 4, least: 3, wide: false },
    { prefer: 4, least: 3, wide: false },
    { prefer: 4, least: 3, wide: false },
  ];
  const { spans, rows } = pack(sizes, 12, 9);
  assert.deepEqual(rows, [0, 1, 2, 2, 3, 3]);
  assert.deepEqual(spans, [9, 12, 6, 6, 6, 6]);
});

test('the overview’s areas cover its grid of 24 half columns by 9 exactly once, whatever it holds', () => {
  const tops: Overview['top'][] = ['both', 'now', 'glance', 'none'];
  const works: Overview['works'][] = [0, 1, 2, 3];
  for (const top of tops) {
    for (const n of works) {
      const plane = overviewPlane({ top, works: n });
      const cells = new Map<string, number>();
      for (const block of plane.blocks) {
        for (let c = block.c0; c <= block.c1; c++) {
          for (let r = block.r0; r <= block.r1; r++) {
            cells.set(`${c},${r}`, (cells.get(`${c},${r}`) ?? 0) + 1);
          }
        }
      }
      assert.equal(cells.size, 24 * 9, `${top} ${n}`);
      assert.ok(
        [...cells.values()].every((times) => times === 1),
        `${top} ${n}`,
      );
    }
  }
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

const RUNNING: Parameters<typeof decideStage>[0] = {
  state: 'active',
  reason: 'running',
  eligible: true,
  forcedColors: false,
  moreContrast: false,
  highContrast: false,
  enhancement: 'on',
  wide: true,
  framed: false,
  lifecycle: 'none',
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
    [{ wide: false }, 'narrow', false],
    [{ deviceMemory: 2 }, 'low-memory', false],
    [{ cores: 2 }, 'low-power', false],
    [{ saveData: true }, 'save-data', false],
    [{ claimed: false }, 'another-stage', false],
    [{ exited: true }, 'exited', true],
    [{ state: 'paused', reason: 'lifecycle' }, 'lifecycle', true],
    // A frame with no lifecycle yet is inactive, and so is one hidden or out of focus.
    [{ framed: true, lifecycle: 'none' }, 'lifecycle', true],
    [{ framed: true, lifecycle: 'inactive' }, 'lifecycle', true],
    [{ state: 'paused', reason: 'offscreen' }, 'waiting', true],
  ];
  for (const [change, reason, offered] of off) {
    const decision = decideStage({ ...RUNNING, ...change });
    assert.deepEqual(decision, { mount: false, offered, reason }, JSON.stringify(change));
    // Offered or not, Static view is pressed while nothing is mounted: waiting for #7's
    // lifecycle or the runtime included, the still is what shows.
    assert.equal(staticPressed(decision), true, JSON.stringify(change));
  }
  assert.equal(staticPressed(decideStage(RUNNING)), false);
  // A press acts on what the exit reads: pressed while it waits, a press asks for the stage, so
  // once the lifecycle says active it runs, unpressed; unpressed, a press leaves it, and again comes back.
  const press = (change: Partial<typeof RUNNING>, exited: boolean) =>
    exitedAfterPress(decideStage({ ...RUNNING, ...change, exited }));
  const waited = press({ framed: true, lifecycle: 'none' }, false);
  assert.equal(waited, false, 'a press while it waits never opts out');
  const active = decideStage({ ...RUNNING, framed: true, lifecycle: 'active', exited: waited });
  assert.deepEqual(active, { mount: true, offered: true, reason: 'running' });
  assert.equal(staticPressed(active), false);
  assert.equal(press({ state: 'paused', reason: 'offscreen' }, false), false);
  const left = press({}, false);
  assert.equal(left, true, 'a press on the running stage leaves it');
  assert.equal(decideStage({ ...RUNNING, exited: left }).reason, 'exited');
  assert.equal(press({}, left), false, 'and a press on the exit it left brings it back');
  // A stage that started holds still while paused, and a static runtime ends it.
  const paused = decideStage({ ...RUNNING, state: 'paused', reason: 'hidden', started: true });
  assert.deepEqual(paused, { mount: true, offered: true, reason: 'paused' });
  assert.equal(staticPressed(paused), false);
  assert.equal(
    decideStage({ ...RUNNING, state: 'static', reason: 'reduced', started: true }).mount,
    false,
  );
  // A frame's lifecycle pause ends a stage that started, so its WebGL context goes, and so does a
  // width under 768px; a framed document whose lifecycle says visible and focused runs it.
  for (const change of [
    { state: 'paused', reason: 'lifecycle' },
    { framed: true, lifecycle: 'inactive' },
    { wide: false },
  ] as const) {
    assert.equal(
      decideStage({ ...RUNNING, ...change, started: true }).mount,
      false,
      JSON.stringify(change),
    );
  }
  assert.deepEqual(decideStage({ ...RUNNING, framed: true, lifecycle: 'active' }), {
    mount: true,
    offered: true,
    reason: 'running',
  });
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

test('the scene is bounded and particle-free: at most six planes and 48 blocks, whatever the portfolio holds', async () => {
  const { stageModels } = await import('./stage-canvas');
  for (const { name } of PAIRS) {
    const models = stageModels(fixtureInput(name));
    const scene = buildScene(models);
    assert.ok(scene.planes.length <= MAX_PLANES, name);
    assert.equal(scene.planes.length, Math.min(models.length, MAX_PLANES), name);
    const blocks = scene.planes.reduce((sum, plane) => sum + plane.blocks.length, 0);
    assert.ok(blocks <= MAX_BLOCKS, `${name}: ${blocks} blocks`);
    assert.equal(scene.planes[0]?.raised, true, `${name}: the overview's plane stands raised`);
    assert.ok(!('particles' in scene));
  }
  // A portfolio of far more boards and tiles than the stage draws is cut at its bounds.
  const many = Array.from({ length: 20 }, () => ({
    columns: 12,
    rows: 4,
    blocks: Array.from({ length: 12 }, (_, c) => ({
      c0: c,
      c1: c,
      r0: 0,
      r1: 0,
      tone: 'plain' as const,
    })),
  }));
  const bounded = buildScene(many);
  assert.equal(bounded.planes.length, MAX_PLANES);
  assert.equal(
    bounded.planes.reduce((sum, plane) => sum + plane.blocks.length, 0),
    MAX_BLOCKS,
  );
});

test('the stage draws the still: the same planes, the overview first, each block in its board’s place', async () => {
  const { stageModels } = await import('./stage-canvas');
  const input = fixtureInput('sample');
  const models = stageModels(input);
  const markup = html(input);
  assert.equal(models.length, count(markup, /class="sb-still__plane/g));
  const scene = buildScene(models);
  scene.planes.forEach((plane, index) => {
    for (const block of plane.blocks) {
      assert.ok(block.x >= 0 && block.x + block.width <= FOOTPRINT.width, `plane ${index}`);
      assert.ok(block.z >= 0 && block.z + block.depth <= FOOTPRINT.depth, `plane ${index}`);
      assert.ok(block.height > 0);
    }
  });
});

/** The stylesheet, comments gone. */
const CSS = readFileSync(new URL('./styles.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

test('the stylesheet never reorders what the DOM sets: no dense packing, no order, no reversed flow', () => {
  assert.doesNotMatch(CSS, /grid-auto-flow\s*:[^;]*\bdense\b/);
  assert.doesNotMatch(CSS, /(?<![\w-])order\s*:/);
  assert.doesNotMatch(CSS, /(?:row|column)-reverse/);
});

test('every duration and curve is the platform’s, and nothing animates on its own', () => {
  assert.doesNotMatch(CSS, /@keyframes|\banimation\s*:/);
  for (const [declaration] of CSS.matchAll(/transition(?:-[a-z]+)?\s*:[^;]+;/g)) {
    const times = declaration.match(/\b\d+(?:\.\d+)?m?s\b/g) ?? [];
    // A visibility switch at 0s is the only literal time.
    assert.deepEqual(
      times.filter((time) => time !== '0s'),
      [],
      declaration,
    );
    if (!/:\s*(?:none|0s);/.test(declaration)) {
      assert.match(declaration, /var\(--motion-/, declaration);
    }
  }
});

test('the root rule alone sets the grid and the motion slots, and spacing reads the shared scale', () => {
  const root = /\[data-variant='spatial-bento'\]\s*\{([^}]*)\}/.exec(CSS)![1]!;
  for (const slot of [
    '--layout-grid-columns',
    '--layout-motion-curve',
    '--layout-motion-feedback',
  ]) {
    assert.match(root, new RegExp(`${slot}:`), slot);
  }
  for (const [, property, value] of CSS.matchAll(
    /(?<![\w-])((?:padding|margin|gap|row-gap|column-gap)(?:-[a-z-]+)?)\s*:([^;]+);/g,
  )) {
    assert.doesNotMatch(value!, /\d(?:px|rem|vw)\b/, `${property}: ${value}`);
  }
});

/** The dock's markup on the server: the nav, from its open tag to its close. */
const dockOf = (markup: string) => {
  const start = markup.indexOf('<nav class="sb-dock"');
  return start < 0 ? '' : markup.slice(start, markup.indexOf('</nav>', start) + 6);
};

test('the dock comes before main, hidden and inert on the server with no board current, and lists every board', () => {
  for (const { name } of PAIRS) {
    const input = fixtureInput(name);
    const markup = html(input);
    const dock = dockOf(markup);
    const boards = boardsOf(
      input.portfolio.sections.filter((section) => sectionRenders(section, input)),
      overviewOf(input.portfolio.sections, input),
      input,
    );
    if (boards.length === 0) {
      assert.equal(dock, '', name);
      continue;
    }
    assert.ok(dock, name);
    // DOM order, tab order and the top edge agree: the dock is first, the skip link still jumps past it.
    assert.ok(markup.indexOf('<nav class="sb-dock"') < markup.indexOf('<main'), name);
    assert.match(dock, /data-state="hidden"/, name);
    assert.match(dock, /\sinert=""/, name);
    assert.doesNotMatch(dock, /aria-current/, name);
    // Named by a hidden label in the composition's own language.
    const label = /aria-labelledby="([^"]+)"/.exec(dock)?.[1];
    assert.ok(label && dock.includes(`id="${label}"`), name);
    assert.deepEqual(
      [
        ...dock
          .slice(dock.indexOf('class="sb-dock__boards"'), dock.indexOf('</ol>'))
          .matchAll(/<li><a href="#([^"]+)"/g),
      ].map(([, href]) => href),
      // A board with no field of its own lands on its first part in the full record.
      boards.map((board) => boardTarget(input, board)),
      name,
    );
  }
});

test('the phone menu holds Close first, then Selected work and every board with its sections, in the order the boards set them', () => {
  for (const { name } of PAIRS) {
    const input = fixtureInput(name);
    const markup = html(input);
    const start = markup.indexOf('<dialog');
    if (start < 0) continue;
    const dialog = markup.slice(start, markup.indexOf('</dialog>', start));
    const body = dialog.slice(dialog.indexOf('class="sb-menu__body"'));
    // Close, before any link, and closing the same dialog with no script.
    const close = body.indexOf('commandfor=');
    assert.ok(close >= 0 && close < body.indexOf('<a '), `${name}: Close first`);
    const id = /<dialog[^>]*\sid="([^"]+)"/.exec(dialog)?.[1];
    assert.match(
      body,
      new RegExp(`commandfor="${id}"[^>]*command="close"|command="close"[^>]*commandfor="${id}"`),
    );
    const sections = input.portfolio.sections.filter((section) => sectionRenders(section, input));
    const boards = boardsOf(sections, overviewOf(sections, input), input);
    const outline = pageOutline(input, SECTIONS);
    const overview = overviewOf(sections, input);
    const expected = [
      overview.showcase
        ? `#${input.ids.prefix}${overview.showcase.id}`
        : `#${input.ids.prefix}sb--overview`,
      ...boards.flatMap((board) => [
        `#${boardTarget(input, board)}`,
        ...board.members
          .flatMap((section) => outline.sections.filter((entry) => entry.id === section.id))
          .filter(
            (entry) =>
              entry.href !== undefined &&
              entry.title !== undefined &&
              entry.title.trim() !== '' &&
              entry.title.trim().toLocaleLowerCase() !== board.name.toLocaleLowerCase(),
          )
          .map((entry) => entry.href!),
      ]),
    ];
    assert.deepEqual(
      [...body.matchAll(/<a [^>]*href="([^"]+)"/g)].map(([, href]) => href),
      expected,
      name,
    );
  }
});

test('the showcase leads with the signature work, wherever its section lists it', () => {
  const pair = pairOf('sample');
  const portfolio = pair.portfolio as unknown as Record<string, unknown>;
  const featured = (portfolio.featured as string[]).filter((id) => id !== 'small-traces');
  const swapped = {
    ...pair,
    portfolio: {
      ...portfolio,
      signature: 'small-traces',
      featured: [...featured, 'postmortem-template-kit'],
    },
  } as unknown as ParsedPair;
  for (const [input, lead] of [
    [inputOf(pair), 'postmortem-template-kit'],
    [inputOf(swapped), 'small-traces'],
  ] as const) {
    const markup = html(input);
    const plate = /<article[^>]*class="[^"]*sb-work--plate[^"]*"[^>]*>/.exec(markup)?.[0] ?? '';
    assert.match(plate, new RegExp(`data-work-id="${lead}"`));
  }
  assert.deepEqual(
    showcaseOrder([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'b').map(({ id }) => id),
    ['b', 'a', 'c'],
  );
  assert.deepEqual(
    showcaseOrder([{ id: 'a' }, { id: 'b' }], undefined).map(({ id }) => id),
    ['a', 'b'],
  );
});

test('the overview field holds four works at most: a longer section stays whole on the Work board', () => {
  for (const { name } of PAIRS) {
    const input = fixtureInput(name);
    const sections = input.portfolio.sections.filter((section) => sectionRenders(section, input));
    const overview = overviewOf(sections, input);
    if (overview.showcase) {
      assert.ok(worksOf(overview.showcase, input).length <= SHOWCASE_MOST, name);
    }
    // Whatever the overview leaves goes on a board, each section exactly once.
    const boards = boardsOf(sections, overview, input);
    const placed = boards.flatMap((board) => board.tiles.map((tile) => tile.section.id));
    assert.equal(new Set(placed).size, placed.length, name);
  }
});

test('the stage renders on demand: active for a picture not yet drawn, paused once it is, and the runtime’s word otherwise', () => {
  assert.equal(onDemand('active', 1, 0), 'active');
  assert.equal(onDemand('active', 1, 1), 'paused');
  assert.equal(onDemand('active', 2, 1), 'active');
  for (const state of ['paused', 'static'] as const) {
    assert.equal(onDemand(state, 2, 1), state);
    assert.equal(onDemand(state, 1, 1), state);
  }
  // Each block's outline is its twelve edges, as the still strokes it.
  assert.equal(boxEdges([2, 2, 2]).length, 12 * 2 * 3);
  // The source keeps it so: the canvas is handed onDemand(), never the runtime's state alone.
  const source = readFileSync(new URL('./stage-canvas.tsx', import.meta.url), 'utf8');
  assert.match(source, /state=\{onDemand\(state, version, drawn\)\}/);
  assert.doesNotMatch(source, /maxDpr=/);
});

test('every move is a choice: transitions, travel and scale only under no-preference, and never under a reduced site', () => {
  const blocks: { query: string; body: string }[] = [];
  const rest = CSS.replace(
    /@media([^{]*)\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g,
    (_, query: string, body: string) => {
      blocks.push({ query, body });
      return '';
    },
  );
  const moves =
    /(?<![\w-])(?:transition(?:-[a-z]+)?|translate|scale|transform)\s*:\s*(?!none)[^;]+;/;
  const rules = (css: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  for (const [, selector, body] of rules(rest)) {
    if (moves.test(body!)) {
      // The static ones, which move nothing: the rings' marker centred on its line, and a case
      // figure's drawing mirrored right to left (SPA-1).
      assert.match(
        selector!,
        /\.sb-rings > li::before|\.sb-fig div svg:dir\(rtl\)/,
        `${selector!.trim()} moves outside the motion block`,
      );
    }
  }
  let gated = 0;
  for (const { query, body } of blocks) {
    for (const [, selector, declarations] of rules(body)) {
      if (!moves.test(declarations!)) continue;
      assert.match(query, /prefers-reduced-motion:\s*no-preference/, selector!.trim());
      for (const part of selector!.split(/,(?![^()]*\))/)) {
        assert.match(
          part,
          /:not\(\[data-motion='reduced'\], \[data-motion='static'\]\)/,
          part.trim(),
        );
      }
      gated += 1;
    }
  }
  assert.ok(gated >= 8, `${gated} gated rules`);
});

test('the skip link keeps the kit’s colours and floats on focus, so the field under it never moves', () => {
  assert.match(CSS, /\[data-variant='spatial-bento'\] a:where\(:not\(\[data-ui-slot\]\)\) \{/);
  assert.doesNotMatch(CSS, /\[data-variant='spatial-bento'\] a \{/);
  const skip = /\[data-ui-slot='skip-link'\]:focus \{([^}]*)\}/.exec(CSS)?.[1] ?? '';
  assert.match(skip, /position:\s*fixed/);
  assert.match(skip, /color:\s*var\(--color-on-accent\)/);
  assert.match(skip, /background-color:\s*var\(--color-accent\)/);
});

test('on a phone the dock is three cells, the works, Contact and the Menu, sharing the row (M1)', () => {
  // The phone block that re-spans the field, the one that sets the grid to one column.
  const phone = CSS.slice(
    CSS.indexOf("@media (max-width: 47.99rem) {\n  [data-variant='spatial-bento'] {"),
  );
  const block = phone.slice(0, phone.indexOf('\n}\n'));
  assert.match(block, /\.sb-dock \.sb-dock__name \{\s*display: none;/);
  assert.match(block, /\.sb-dock__boards \{\s*display: none;/);
  assert.match(block, /\.sb-dock__phone > li > \* \{[^}]*min-inline-size: 0;/);
  assert.match(CSS, /^\[data-variant='spatial-bento'\] \.sb-dock__phone \{\s*display: none;/m);
  const markup = html(fixtureInput('sample'));
  const dock = markup.slice(markup.indexOf('<nav class="sb-dock"'), markup.indexOf('</nav>'));
  const cells = dock.slice(dock.indexOf('<ul class="sb-dock__phone"'));
  assert.match(
    cells,
    /<a href="#work-showcase">Work<\/a>[\s\S]*<a href="#sb--contact">Contact<\/a>[\s\S]*commandfor="[^"]*sb-menu"[^>]*command="show-modal"|command="show-modal"[^>]*commandfor="[^"]*sb-menu"/,
  );
  // Nothing focused or jumped to stops under the dock (SB-S13).
  assert.match(
    block,
    /:is\(\.sb-page, \.sb-footer\) :is\(a\[href\], button, summary, \[id\]\) \{\s*scroll-margin-block-end: calc\(var\(--ui-control-height\) \+ var\(--space-xl\)\);/,
  );
  // And the talks list can't take a max-content column wider than its tile at 320.
  assert.match(CSS, /\.sb-ev--talk \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
});

test('the showcase’s frame is a box on the band’s own tracks: its anchor lands on it, and the settle moves its works', () => {
  const input = fixtureInput('sample');
  const markup = html(input);
  assert.match(markup, /<section id="[^"]*work-showcase"[^>]*class="sb-group">/);
  const group = /'\] \.sb-group \{([^}]*)\}/.exec(CSS)?.[1] ?? '';
  assert.match(group, /grid-template-columns: subgrid;/);
  assert.match(group, /grid-template-rows: subgrid;/);
  assert.doesNotMatch(CSS, /\.sb-group \{[^}]*display: contents/);
  // A phone's one column stacks the works; print sets the frame as a block, like the band.
  const phone = CSS.slice(
    CSS.indexOf("@media (max-width: 47.99rem) {\n  [data-variant='spatial-bento'] {"),
  );
  assert.match(
    phone.slice(0, phone.indexOf('\n}\n')),
    /\.sb-group \{[^}]*grid-template-rows: none;/,
  );
  assert.match(
    CSS,
    /@media print \{[\s\S]*:is\(\.sb-overview, \.sb-band, \.sb-group, \.sb-field\)/,
  );
  const settle = readFileSync(new URL('./settle.tsx', import.meta.url), 'utf8');
  assert.match(
    settle,
    /:scope > \.sb-band > :not\(\.sb-group\), :scope > \.sb-band > \.sb-group > \*/,
  );
});

test('from 1024 to 1280 Contents sits beside the hero, Now and the ledger two up under them, and on a phone main carries the field’s margin', () => {
  const md = CSS.slice(CSS.indexOf('@media (min-width: 64rem) and (max-width: 79.99rem) {'));
  const block = md.slice(0, md.indexOf('\n}\n'));
  // S1: the mock's 1024. The rows are the reading order, so nothing there reorders it.
  assert.match(
    block,
    /'hero hero hero hero contents contents'\s*'now now now glance glance glance'/,
  );
  assert.doesNotMatch(block, /reading-order/);
  // From 768 to 1024 the hero's display line and lede sit side by side: the lede follows the display directly.
  assert.match(
    html(fixtureInput('sample')),
    /<p class="sb-hero__display">I make failure legible\.<\/p><[a-z]+ class="[^"]*\bsb-hero__lede\b/,
  );
  assert.match(
    CSS,
    /@media \(min-width: 48rem\) and \(max-width: 63\.99rem\) \{\s*\[data-variant='spatial-bento'\] \.sb-hero__thesis:has\(> \.sb-hero__display \+ \.sb-hero__lede\) \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
  );
  // A field with only one of Now and the ledger sets it across under the two; with neither, the
  // two are the row.
  assert.match(
    block,
    /\.sb-band\[data-layout\]\[data-works\] \{\s*grid-template-rows: auto auto \[works\];\s*grid-template-areas:\s*'hero hero hero hero contents contents'\s*'now now now now now now';/,
  );
  assert.match(
    block,
    /\.sb-band\[data-layout='none'\]\[data-works\] \{\s*grid-template-rows: auto \[works\];\s*grid-template-areas: 'hero hero hero hero contents contents';/,
  );
  const phone = CSS.slice(
    CSS.indexOf("@media (max-width: 47.99rem) {\n  [data-variant='spatial-bento'] {"),
  );
  const small = phone.slice(0, phone.indexOf('\n}\n'));
  assert.match(
    small,
    /\.sb-page:not\(\.sb-case\) \{\s*margin-inline: var\(--layout-grid-margin\);/,
  );
  assert.match(
    small,
    /\.sb-page:not\(\.sb-case\) :is\(\.sb-overview, \.sb-field\) \{\s*padding-inline: 0;/,
  );
});

test('back on the field from a case sheet, focus returns to the tile’s link that opened it, and only from this site', () => {
  const origin = 'https://rowan.test';
  assert.equal(cameFrom('https://rowan.test/work/kit?variant=x', origin), '/work/kit');
  assert.equal(cameFrom('https://elsewhere.test/work/kit', origin), null);
  assert.equal(cameFrom('', origin), null);
  assert.equal(cameFrom('not a url', origin), null);
  const links = [
    { href: 'https://github.com/anamika/kit' },
    { href: 'https://rowan.test/work/kit?variant=spatial-bento' },
  ];
  assert.equal(openerOf(links, '/work/kit', origin), links[1]);
  assert.equal(openerOf(links, '/work/other', origin), undefined);
  // The tile the way back names holds that link.
  const input = fixtureInput('sample');
  const markup = html(input);
  const work = input.portfolio.works.find((each) => each.slug === 'postmortem-template-kit')!;
  const tile = tileAnchor(input, work.id);
  assert.ok(tile);
  const at = markup.indexOf(` id="${tile}"`);
  assert.ok(at >= 0);
  const close = markup.indexOf('</article>', at);
  assert.match(markup.slice(at, close), /href="[^"]*\/work\/postmortem-template-kit/);
});

test('home keeps the thesis, the works and one Record summary; the full record is closed disclosures at the end of Record', () => {
  const input = fixtureInput('sample');
  const sections = input.portfolio.sections.filter((section) => sectionRenders(section, input));
  const overview = overviewOf(sections, input);
  const boards = boardsOf(sections, overview, input);
  const record = boards.find((board) => board.id === 'record')!;
  const titles = (record.archive ?? []).map((section) => section.title).sort();
  assert.deepEqual(
    titles,
    [
      'Awards',
      'Education',
      'Elsewhere',
      'Experience',
      'On GitHub',
      'Patents',
      'Publications',
      'Skills',
      'Stack I currently reach for',
      'Talks',
      'Press',
    ].sort(),
  );
  // Each stays its own board's for navigation: Publications is Writing's, in its index and count.
  const writing = boards.find((board) => board.id === 'writing')!;
  assert.ok(writing.members.some((section) => section.title === 'Publications'));
  assert.ok(!writing.tiles.some((tile) => tile.section.title === 'Publications'));
  // Nothing shown is archived, and every archived section is some board's member.
  for (const board of boards) {
    for (const tile of board.tiles) assert.ok(!archived(tile.section, input), tile.section.id);
  }
  const members = new Set(boards.flatMap((board) => board.members.map((section) => section.id)));
  for (const section of record.archive ?? []) assert.ok(members.has(section.id), section.id);
  // The summary: Words from collaborators on the board, the latest role the full record's head (M2).
  assert.ok(record.tiles.some((tile) => tile.section.title === 'Words from collaborators'));
  assert.equal(record.latest?.entry.title, 'Principal Engineer, Reliability');
  const markup = html(input);
  assert.match(
    markup,
    /<section class="sb-tile sb-archive" data-span="12"[^>]*><h3 class="sb-title" id="sb--full-record">The full record<\/h3><section class="sb-latest" aria-labelledby="sb--latest-role"[^>]*><h4 class="sb-label" id="sb--latest-role">Latest role<\/h4>/,
  );
  assert.doesNotMatch(markup, /class="sb-tile[^"]*sb-latest/);
  // Each part is a closed native disclosure holding the section's own frame and id.
  for (const section of record.archive ?? []) {
    const fold = new RegExp(
      `<details class="sb-archive__item" data-record=""><summary class="sb-archive__summary"><span class="sb-archive__name">[^<]+</span><span class="sb-archive__board">[^<]*</span></summary><section id="${section.id}" data-section-id="${section.id}"`,
    );
    assert.match(markup, fold, section.id);
  }
  assert.doesNotMatch(markup, /<details class="sb-archive__item"[^>]* open/);
  // A part from another board names it; Record's own don't.
  assert.match(
    markup,
    /<span class="sb-archive__name">Publications<\/span><span class="sb-archive__board">Writing<\/span>/,
  );
  assert.match(
    markup,
    /<span class="sb-archive__name">Education<\/span><span class="sb-archive__board"><\/span>/,
  );
  // It prints open, and the script opens a fragment's part.
  assert.match(
    CSS,
    /@media print \{[\s\S]*\.sb-archive__item::details-content \{\s*content-visibility: visible;/,
  );
  assert.equal(RECORD, 'details[data-record]');
  const section = { id: 'x' };
  assert.equal(
    holdsTarget({ contains: (node: never) => node === (section as never) }, section),
    true,
  );
  assert.equal(holdsTarget({ contains: () => false }, section), false);
  assert.equal(holdsTarget({ contains: () => true }, null), false);
  // It takes the field's row after the board's own tiles, whole, so no short tile leaves a hole beside it.
  assert.deepEqual(recordSpans(record), { archive: 12 });
  assert.deepEqual(recordSpans({ tiles: [] }), { archive: 9 });
});

test('on a phone the hero is the thesis and one action, its standfirst sets in Now under its head, and Contents and Now each take the column (E1, S2)', () => {
  const markup = html(fixtureInput('sample'));
  const now = markup.slice(markup.indexOf('data-section-id="now"'));
  // Under Now's own head, before its words: in the outline it's Now's, not the tile before it.
  assert.match(
    now.slice(0, 2400),
    /<\/h2>[\s\S]*?<\/div><div class="sb-lead"><[a-z]+ class="[^"]*\bsb-lead__words\b[^"]*">[\s\S]*The systems I build[\s\S]*<p class="sb-lead__now">Currently leading reliability[\s\S]*?class="[^"]*\bsb-now__body\b/,
  );
  const glance = markup.slice(markup.indexOf('data-section-id="at-a-glance"'));
  assert.doesNotMatch(glance.slice(0, 2000), /sb-lead/);
  // Wider, the copy is out of the page; on a phone the hero's own are.
  assert.match(CSS, /^\[data-variant='spatial-bento'\] \.sb-lead \{\s*display: none;/m);
  const phone = CSS.slice(
    CSS.indexOf("@media (max-width: 47.99rem) {\n  [data-variant='spatial-bento'] {"),
  );
  const block = phone.slice(0, phone.indexOf('\n}\n'));
  assert.match(
    block,
    /\.sb-band:has\(\.sb-lead\) :is\(\.sb-hero__lede, \.sb-hero__now\),\s*\[data-variant='spatial-bento'\] \.sb-hero__role,\s*\[data-variant='spatial-bento'\] \.sb-tile--hero \.sb-hero__actions > li \+ li \{\s*display: none;/,
  );
  // S2: no 2-up of Contents and Now; Contents' keys three across; a work's link follows its words.
  assert.doesNotMatch(block, /\.sb-band:is\(\[data-layout='both'\]/);
  assert.match(
    block,
    /\.sb-stage__body \{\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/,
  );
  assert.match(block, /\.sb-group > \[data-area='rest'\] \{\s*align-self: start;/);
  // With no Now there's no copy, so the phone's hero keeps its standfirst.
  const noNow = { ...fixtureInput('sample') };
  const sections = noNow.portfolio.sections.filter((section) => section.kind !== 'now');
  const without = html({ ...noNow, portfolio: { ...noNow.portfolio, sections } });
  assert.doesNotMatch(without, /class="sb-lead"/);
});

test('the review’s first-view and minor fixes: the tally’s short label, the bled band, one quote treatment, the player, the colophon', () => {
  // E3: a long statement splits at its first comma into what it counts and its note.
  assert.deepEqual(
    tallyWords(
      'Years engineering, from research code to production systems handling ten billion requests a day.',
      undefined,
    ),
    {
      label: 'Years engineering',
      note: 'from research code to production systems handling ten billion requests a day.',
    },
  );
  assert.deepEqual(tallyWords('Services owned', 'Across three platform teams'), {
    label: 'Services owned',
    note: 'Across three platform teams',
  });
  assert.deepEqual(tallyWords('A long statement with no comma that runs on and on', undefined), {
    label: 'A long statement with no comma that runs on and on',
  });
  assert.equal(TALLY_LABEL, 32);
  assert.match(CSS, /\.sb-tally__row \{[^}]*font-size: var\(--type-body-compact-font-size\);/);
  assert.match(CSS, /\.sb-work__band img \{[^}]*object-fit: cover;/);
  // A crop keeps the graph's root bars, at its foot, and takes the leaf tips (S3).
  assert.match(CSS, /\.sb-work__band img \{[^}]*object-position: 50% 100%;/);
  const markup = html(fixtureInput('sample'));
  assert.match(
    markup,
    /<dt class="sb-tally__what">(?:<[^>]+>)?Years engineering(?:<\/[^>]+>)?<\/dt>/,
  );
  // No quote carries a picture the others don't.
  assert.doesNotMatch(markup, /sb-quote__avatar/);
  // The player: its count and length, three tracks, the rest folded.
  assert.equal(tracksWords([{ durationSeconds: 312 }, { durationSeconds: 254 }]), '2 tracks, 9:26');
  assert.equal(tracksWords([{ durationSeconds: 312 }, {}]), '2 tracks');
  assert.equal(TRACKS_SHOWN, 3);
  assert.match(markup, /<p class="sb-label">6 tracks, 29:37<\/p>/);
  assert.match(
    markup,
    /<details class="sb-album__more"><summary class="sb-label">3 more<\/summary><ol class="sb-tracks" start="4">/,
  );
  // The colophon speaks to the visitor, not about the build.
  assert.doesNotMatch(markup, /an extra the page never needs/);
  assert.match(markup, /Every board here is a tile on one field/);
  // The board's tiles are as tall as their words; the timeline's last year ends on its plot.
  assert.match(CSS, /\.sb-field > \[data-span\] \{\s*align-self: start;/);
  assert.match(markup, /<span style="inset-inline-end:[0-9.]+%">2026<\/span>/);
});

test('Contents lands on sections, as the shared destinations do: its Contact is #contact, and the dock keeps the boards', () => {
  const markup = html(fixtureInput('sample'));
  const list = /<ol class="sb-contents__list"[^>]*>([\s\S]*?)<\/ol>/.exec(markup)?.[1] ?? '';
  assert.match(list, /<li class="sb-contents__row" data-board="contact"><a href="#contact"/);
  // The motion contract clicks the first nav link to #contact: the dock, hidden while Contents shows, has none.
  const dock = markup.slice(markup.indexOf('<nav class="sb-dock"'), markup.indexOf('</nav>'));
  assert.doesNotMatch(dock, /href="#contact"/);
  assert.match(dock, /href="#sb--contact"/);
  // On the motion contract's own fixture (a hero, two chronologies in the full record, and a
  // contact): the first nav link to #contact is Contents', which shows on arrival, not the dock's.
  const motion = readPair({
    portfolio: `${REPO}tests/fixtures/motion/portfolio.yml`,
    site: `${REPO}tests/fixtures/motion/site.yml`,
  });
  assert.ok(motion.ok, JSON.stringify(motion));
  const home = html(inputOf(motion.pair));
  assert.match(home, /<section id="contact"/);
  const navs = [...home.matchAll(/<nav\b[^>]*>[\s\S]*?<\/nav>/g)].map((each) => each[0]);
  const first = navs.find((nav) => /href="#contact"/.test(nav));
  assert.ok(first, 'a nav link to #contact');
  assert.match(first, /^<nav class="sb-tile[^"]*" data-area="contents"/);
  assert.doesNotMatch(/^<nav[^>]*>/.exec(first)![0], /\bhidden\b|inert/);
  assert.match(first, /<li class="sb-contents__row" data-board="contact"><a href="#contact">/);
});

test('a tile titled as its board says so once: the label shows the name, the tile keeps it for assistive technology', () => {
  assert.equal(echoes({ title: ' About ' }, { name: 'About' }), true);
  assert.equal(echoes({ title: 'about' }, { name: 'About' }), true);
  assert.equal(echoes({ title: 'Looking' }, { name: 'About' }), false);
  assert.equal(echoes({}, { name: 'About' }), false);
  const markup = html(fixtureInput('sample'));
  const about = /<section [^>]*data-section-id="about"[^>]*>/.exec(markup)?.[0] ?? '';
  assert.match(about, /data-echo=""/);
  assert.match(markup, /data-section-id="about"[^>]*>[\s\S]{0,200}<h3 class="sb-title">/);
  assert.match(
    CSS,
    /\.sb-hidden,\s*\[data-variant='spatial-bento'\] \.sb-tile\[data-echo\] > \.sb-tile__head > \.sb-title,/,
  );
  // The Menu lists the About board once, not again as its About section.
  const dialog = markup.slice(markup.indexOf('<dialog'), markup.indexOf('</dialog>'));
  assert.equal(count(dialog, /href="#about"/g), 0);
  assert.equal(count(dialog, /href="#sb--about"/g), 1);
});

test('Elsewhere keeps the owner’s place and kinds: every entry’s location worth showing and categories reach the page', () => {
  for (const name of ['complete', 'sample']) {
    const input = fixtureInput(name);
    const markup = html(input);
    const entries = input.portfolio.evidence.filter((entry) => entry.type === 'external-work');
    assert.ok(entries.length > 0, name);
    for (const entry of entries) {
      // A place of online says nothing, so it doesn't show (A4).
      if (shownPlace(entry.locationLabel) !== undefined) {
        assert.match(
          text(markup),
          new RegExp(entry.locationLabel!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
          `${name}: ${entry.locationLabel}`,
        );
      }
      // Its kinds are in its meta line, as words, not chips.
      for (const category of entry.categories ?? []) {
        assert.match(
          text(markup),
          new RegExp(category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
          `${name}: ${category}`,
        );
      }
      assert.doesNotMatch(markup, /class="sb-elsewhere__where"/);
    }
  }
});

test('the reach tile quotes the owner’s last sentence whole, never a fragment an abbreviation left', () => {
  assert.equal(
    replyPromise(
      "Best route is email, with a note about what you're working on. I read everything; I reply within a week.",
    ),
    'I read everything; I reply within a week.',
  );
  assert.equal(
    replyPromise('Write any time. Dr. Smith replies within a week.'),
    'Dr. Smith replies within a week.',
  );
  assert.equal(
    replyPromise('Email me. Response time is approx. 2 days.'),
    'Response time is approx. 2 days.',
  );
  // One sentence is the Contact tile's alone, and a long one doesn't fit the tile.
  assert.equal(replyPromise('Dr. Smith replies within a week.'), undefined);
  assert.equal(
    replyPromise(`Hello. ${'A very long sentence that goes on '.repeat(3)}.`),
    undefined,
  );
  assert.equal(replyPromise(undefined), undefined);
});

test('a contact handle is where the link goes, shortened only where that stays true', () => {
  assert.equal(handleOf('https://github.com/anamika'), 'anamika');
  assert.equal(handleOf('https://www.linkedin.com/in/anamika/'), 'in/anamika');
  assert.equal(handleOf('https://hachyderm.io/@anamika'), '@anamika@hachyderm.io');
  assert.equal(handleOf('https://anamika.example.com/cv.pdf'), 'PDF');
  // A page, not a profile: its address, its query kept.
  assert.equal(handleOf('https://www.youtube.com/watch?v=abc123'), 'youtube.com/watch?v=abc123');
  assert.equal(handleOf('https://x.com/home?x=1'), 'x.com/home?x=1');
  // A platform's own @handle is the handle, not a fediverse address.
  assert.equal(handleOf('https://www.youtube.com/@chan'), '@chan');
});

test('the case page is one sheet over the receded field: no tiles in it, the stops in its own words, focus on its h1, the way back to the tile', () => {
  const STOP_WORDS = [
    'What was wrong',
    'The setting',
    'My part',
    'Within limits',
    'Calls made',
    'What it showed',
    'What it changed',
    'Looking back',
  ];
  let pages = 0;
  for (const { name } of PAIRS) {
    const home = fixtureInput(name);
    const homeMarkup = html(home);
    for (const slug of slugsOf(home)) {
      const input = inputOf(pairOf(name), '', { route: 'work', slug });
      const markup = html(input);
      const open = markup.indexOf('<article class="sb-case__open"');
      assert.ok(open >= 0, `${name} /work/${slug}: the opened tile`);
      const opened = markup.slice(open, markup.indexOf('</article>', open));
      const at = opened.indexOf('<div class="sb-sheet">');
      assert.ok(at >= 0, `${name} /work/${slug}: a sheet`);
      const sheet = opened.slice(at);
      // One surface: no tile, no card, inside it.
      assert.doesNotMatch(sheet, /class="sb-tile\b/, `${name} /work/${slug}: no tile inside`);
      // The head is tiles on the field: the title tile and its facts, never label/value rows inside a card.
      const head = opened.slice(0, at);
      assert.match(head, /<div class="sb-tile sb-tile--large sb-case__title">/);
      assert.doesNotMatch(head, /class="sb-spec/);
      for (const tile of head.matchAll(
        /<dl class="sb-tile sb-tile--dense sb-fact">([\s\S]*?)<\/dl>/g,
      )) {
        assert.doesNotMatch(tile[1]!, /class="sb-tile\b/);
      }
      // The field behind is decoration, out of reach.
      assert.match(markup, /<div class="sb-case__field" aria-hidden="true" inert="">/);
      // Its h1 is the work's title and takes focus on arrival.
      assert.match(markup, /<h1 class="sb-case__name" id="[^"]+" tabindex="-1">/, name);
      // Every stop's heading is the composition's own words.
      for (const [, heading] of sheet.matchAll(/<h2 class="sb-title"[^>]*>([^<]+)<\/h2>/g)) {
        assert.ok(STOP_WORDS.includes(heading!), `${name}: ${heading}`);
      }
      // The way back goes to the work's tile on home, when home shows it.
      const work = input.portfolio.works.find((each) => each.slug === slug)!;
      const back = /<a class="sb-btn sb-btn--ghost sb-case__back" id="[^"]+" href="([^"]+)"/.exec(
        head,
      )?.[1];
      assert.ok(back, `${name}: the way back opens the page`);
      assert.match(head, /<p class="sb-case__esc"(?: dir="ltr")?>Press <kbd>Esc<\/kbd> to close\./);
      if (homeMarkup.includes(` id="${work.id}"`)) {
        assert.ok(back.endsWith(`#${work.id}`), `${name}: ${back}`);
      }
      // The sheet ends on a way on: the next work, or, at the last, the way back (S4).
      const end = /<a class="sb-sheet__next" href="([^"]+)"/.exec(sheet)?.[1];
      assert.ok(end, `${name} /work/${slug}: a way on at the sheet's end`);
      if (!/sb-case__next-title" lang=/.test(sheet)) assert.equal(end, back);
      // A decision's cells carry their column's head, which a phone's rows show (S7); an empty one, none (N2).
      for (const [, label, body] of sheet.matchAll(/<td( data-label="[^"]*")?>([\s\S]*?)<\/td>/g)) {
        assert.equal(
          Boolean(label),
          body !== '',
          `${name} /work/${slug}: a cell's head and its words`,
        );
      }
      pages += 1;
    }
  }
  assert.ok(pages > 5, `${pages} case pages`);
  // Escape closes the sheet, unless it was meant for a field, a dialog, or another handler.
  const key = (extra: Partial<KeyboardEvent> = {}) => ({
    key: 'Escape',
    defaultPrevented: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...extra,
  });
  const at = (field: boolean) => ({ closest: () => (field ? {} : null) });
  assert.equal(closesSheet(key(), at(false), false), true);
  assert.equal(closesSheet(key(), null, false), true);
  assert.equal(closesSheet(key({ key: 'Enter' }), at(false), false), false);
  assert.equal(closesSheet(key({ defaultPrevented: true }), at(false), false), false);
  assert.equal(closesSheet(key({ metaKey: true }), at(false), false), false);
  assert.equal(closesSheet(key(), at(true), false), false);
  assert.equal(closesSheet(key(), at(false), true), false);
  assert.deepEqual([...DECISION_HEADS], ['The call', 'Why', 'What else was on the table']);
  assert.match(CSS, /\.sb-table td\[data-label\]::before \{\s*content: attr\(data-label\);/);
  assert.match(CSS, /\.sb-table td:empty \{\s*display: none;/);
  // A quote across a whole row is a two-track plate at the wide layout: words left, its source
  // right against the plate's edge (N1). Only a quote with a caption: with none, there's nothing
  // for the right track to hold, and the words keep their own measure.
  assert.match(
    CSS,
    /@media \(min-width: 80rem\) \{\s*\[data-variant='spatial-bento'\] \.sb-field > \[data-span='12'\] \.sb-pull:has\(figcaption\) \{\s*grid-template-columns: repeat\(12, minmax\(0, 1fr\)\);[\s\S]*?\.sb-pull:has\(figcaption\) blockquote \{\s*grid-column: 1 \/ span 7;[\s\S]*?\.sb-pull figcaption \{\s*grid-column: 9 \/ -1;\s*text-align: end;/,
  );
  // The hint shows only where a script hears the key (it marks the hint) and a keyboard can press
  // it; no scripting media query, which the quality runner's axe pass would flip.
  assert.match(
    CSS,
    /@media \(pointer: fine\) \{\s*\[data-variant='spatial-bento'\] \.sb-case__esc\[data-listening\] \{\s*display: block;/,
  );
  assert.doesNotMatch(CSS, /@media[^{]*\bscripting\b/);
  assert.match(
    readFileSync(new URL('./case-focus.tsx', import.meta.url), 'utf8'),
    /hint\?\.setAttribute\('data-listening', ''\)/,
  );
});

test('the load settle runs only where motion is welcome: not under the system’s reduce, a reducing site, a page already scrolled, or a late hydration', () => {
  const source = () => readFileSync(new URL('./settle.tsx', import.meta.url), 'utf8');
  const root = (motion: string | null) =>
    ({
      closest: () => (motion === null ? null : { getAttribute: () => motion }),
      animate: () => ({}),
    }) as unknown as Element;
  const view = (reduce: boolean, scrollY = 0, elapsed = 200) => ({ reduce, scrollY, elapsed });
  assert.equal(settles(root('full'), view(false)), true);
  assert.equal(settles(root(null), view(false)), true);
  assert.equal(settles(root('reduced'), view(false)), false);
  assert.equal(settles(root('static'), view(false)), false);
  assert.equal(settles(root('full'), view(true)), false);
  assert.equal(settles(root('full'), view(false, 400)), false);
  // A field already on screen a while when hydration comes doesn't blink out to rise (F5).
  assert.equal(settles(root('full'), view(false, 0, SETTLE.late)), true);
  assert.equal(settles(root('full'), view(false, 0, SETTLE.late + 1)), false);
  // Its length is the scene slot's, as the browser resolves it; the concept's 400 when that won't read (F4).
  assert.equal(durationMs('0.64s'), 640);
  assert.equal(durationMs('320ms'), 320);
  assert.equal(durationMs('0.64s, 1s'), 640);
  assert.equal(durationMs('0s'), 0);
  assert.match(source(), /if \(duration === 0\) return;/);
  assert.equal(durationMs('min(640ms, 15s)'), null);
  assert.equal(durationMs(''), null);
  // The concept's numbers, and a finite animation: no loop for the budget to count.
  assert.deepEqual(SETTLE, { duration: 400, stagger: 35, late: 600 });
  assert.match(source(), /probe\.style\.transitionDuration = 'var\(--motion-scene\)'/);
  assert.match(source(), /fill: 'backwards'/);
  assert.doesNotMatch(source(), /iterations|requestAnimationFrame/);
  // While it runs the field is aria-busy, so a reader (or the quality runner) waits for the tiles to land.
  assert.match(source(), /root\.setAttribute\('aria-busy', 'true'\)/);
  assert.match(source(), /root\.removeAttribute\('aria-busy'\)/);
});

test('Contents leads with Selected work, the field\u2019s own row and its only current location', () => {
  for (const { name } of PAIRS) {
    const input = fixtureInput(name);
    const markup = html(input);
    const sections = input.portfolio.sections.filter((section) => sectionRenders(section, input));
    const showcase = overviewOf(sections, input).showcase;
    const list = /<ol class="sb-contents__list"[^>]*>([\s\S]*?)<\/ol>/.exec(markup)?.[1] ?? '';
    // A field of the hero alone has nothing to index, so no Contents (P3).
    if (/data-index="none"/.test(markup)) {
      assert.equal(list, '', name);
      continue;
    }
    const current = [...list.matchAll(/<a href="#([^"]+)"([^>]*)>/g)].filter(([, , rest]) =>
      /aria-current="location"/.test(rest!),
    );
    assert.equal(current.length, 1, name);
    assert.equal(
      current[0]![1]!,
      showcase ? `${input.ids.prefix}${showcase.id}` : `${input.ids.prefix}sb--overview`,
      name,
    );
    assert.equal(/<a href="#([^"]+)"/.exec(list)?.[1], current[0]![1], `${name}: first`);
    if (showcase) assert.match(list, /<span class="sb-contents__name">Selected work<\/span>/);
  }
});

test('a tally counts out a whole count up to its bound, and draws nothing for anything else', () => {
  assert.equal(tallyOf(12), 12);
  assert.equal(tallyOf(TALLY_MOST), TALLY_MOST);
  assert.equal(tallyOf(TALLY_MOST + 1), 0);
  assert.equal(tallyOf(2.5), 0);
  assert.equal(tallyOf(0), 0);
  assert.equal(tallyOf(undefined), 0);
  // The strip sits inside its figure's dd, so the number and its squares stay one value.
  const markup = html(fixtureInput('sample'));
  assert.match(
    markup,
    /<dd class="sb-tally__figure"><span class="sb-tally__value"><data value="12">[^<]*<\/data><span class="sb-tally__unit"> years<\/span><\/span><span class="sb-tally__marks" aria-hidden="true" data-count="12">/,
  );
  assert.doesNotMatch(markup, /<dd class="sb-tally__marks"/);
  // S6: one chart. Every row sets on the tally's three tracks, what it counts, the figure and
  // the strip, so the strips start on one line; the squares are in the secondary ink, not the accent.
  assert.match(
    CSS,
    /\.sb-tally \{[^}]*grid-template-columns: minmax\(0, max-content\) max-content/,
  );
  assert.match(
    CSS,
    /\.sb-tally__row,\s*\[data-variant='spatial-bento'\] \.sb-tally__figure \{[^}]*grid-template-columns: subgrid;/,
  );
  assert.match(CSS, /\.sb-tally__marks > span \{\s*background: var\(--color-text-secondary\);/);
});

test('the review’s order and width fixes: Tab follows the rows from 1024, a phone sets the works one column, titles break at their own hyphens, About sits beside Looking', () => {
  // M3: from 1024 the overview's rows set Contents beside the hero, ahead of the works the DOM puts first.
  // Given as an order: grid-rows skips the subgrid's works in Chromium.
  assert.doesNotMatch(CSS, /reading-flow: grid-rows/);
  assert.match(
    CSS,
    /@media \(min-width: 48rem\) \{\s*\[data-variant='spatial-bento'\] \.sb-band \{\s*reading-flow: source-order;\s*\}\s*\[data-variant='spatial-bento'\] \.sb-band > \.sb-group \{\s*reading-order: 2;\s*\}\s*\[data-variant='spatial-bento'\] \.sb-band > \[data-area='reach'\] \{\s*reading-order: 3;/,
  );
  // SPA-2: under 40rem the works are one column, since a half column there sets about 17
  // characters a line (M4 was 22rem); no title breaks mid-word at a hyphenation point. The
  // rule comes after the phone's 2-up, at the same specificity, so it's the one that holds.
  const oneColumn = CSS.search(
    /@media \(max-width: 39\.99rem\) \{\s*\[data-variant='spatial-bento'\] \.sb-group \{\s*grid-template-columns: minmax\(0, 1fr\);/,
  );
  const pair = CSS.search(
    /\[data-variant='spatial-bento'\] \.sb-group \{\s*grid-column: 1 \/ -1;\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
  );
  assert.ok(pair > -1 && oneColumn > pair, 'the 40rem column follows the phone’s 2-up');
  // Under 80rem a tall-first board's label (data-rows) still runs the field's width: its rule
  // follows the data-rows reset at the same specificity (long-text went 141 px sideways at 768).
  const reset = CSS.indexOf(
    "[data-variant='spatial-bento'] .sb-field > :is([data-rows], [data-col]) {",
  );
  const across = CSS.search(
    /\[data-variant='spatial-bento'\] \.sb-label\[data-area='label'\] \{\s*grid-column: 1 \/ -1;/,
  );
  assert.ok(reset > -1 && across > reset, 'the label goes across after the data-rows reset');
  assert.match(CSS, /:is\(h1, h2, h3, h4, \.sb-title\) \{\s*hyphens: manual;/);
  // M2: About is narrow enough to share its row; on the sample, Looking sits beside it.
  const input = fixtureInput('sample');
  const sections = input.portfolio.sections;
  const lede = sections.find((section) => section.kind === 'lede')!;
  assert.deepEqual(tileSize(lede, input), { prefer: 5, least: 4, wide: false });
  const about = boardsOf(sections, overviewOf(sections, input), input).find(
    (board) => board.id === 'about',
  )!;
  // The mock's About row: About and Looking, the rest below; the quote closes the board as its own band.
  const first = about.tiles.filter((tile) => tile.row === 0);
  assert.deepEqual(
    first.map((tile) => [tile.section.kind, tile.section.title ?? '', tile.span]),
    [
      ['lede', 'About', 5],
      ['works', 'Looking', 4],
    ],
  );
  const quote = about.tiles.find((tile) => tile.section.kind === 'quote')!;
  assert.equal(quote.span, 12);
});

test('a fragment that won\u2019t decode is no target, never a throw: the record, the way back and the Menu all read it so (F1)', () => {
  assert.equal(fragmentId('#%'), null);
  assert.equal(fragmentId('#%E0%A4%A'), null);
  assert.equal(fragmentId('#100%'), null);
  assert.equal(fragmentId('#'), null);
  assert.equal(fragmentId(''), null);
  assert.equal(fragmentId('#contact'), 'contact');
  assert.equal(fragmentId('#caf%C3%A9'), 'caf\u00e9');
  assert.equal(fragmentId('contact'), 'contact');
  // No reader of a fragment decodes it on its own.
  for (const file of ['record-folds.tsx', 'return-focus.tsx', 'menu.tsx', 'case-focus.tsx']) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /decodeURIComponent/, file);
  }
  for (const file of ['record-folds.tsx', 'return-focus.tsx', 'menu.tsx']) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.match(source, /fragmentId\(/, file);
  }
});

test('the latest role is the open one, else the latest end, else the latest start, whatever each date\u2019s precision', () => {
  type Entry = Parameters<typeof laterRole>[0];
  const role = (start: string, end?: string) =>
    ({ kind: 'role', period: end === undefined ? { start } : { start, end } }) as unknown as Entry;
  // A month end is later than its year alone.
  assert.ok(laterRole(role('2019', '2023-05'), role('2021', '2023')) > 0);
  assert.ok(laterRole(role('2021', '2023'), role('2019', '2023-05')) < 0);
  // Open beats any end; then ends; then starts.
  assert.ok(laterRole(role('2010'), role('2020', '2026-01')) > 0);
  assert.ok(laterRole(role('2020', '2024'), role('2018', '2023-12')) > 0);
  assert.ok(laterRole(role('2021-03', '2024'), role('2021', '2024')) > 0);
  assert.equal(laterRole(role('2021', '2024'), role('2021', '2024')), 0);
});

test('a board whose every section sits in the full record sets no field of its own: the dock, the Menu and Contents land on its first part there', () => {
  const base = fixtureInput('sample');
  const sections = base.portfolio.sections.filter(
    (section) => boardOf(section, base) !== 'writing' || archived(section, base),
  );
  const input = { ...base, portfolio: { ...base.portfolio, sections } };
  const shown = sections.filter((section) => sectionRenders(section, input));
  const writing = boardsOf(shown, overviewOf(shown, input), input).find(
    (board) => board.id === 'writing',
  );
  assert.ok(writing, 'the board is still named');
  assert.equal(writing.tiles.length, 0);
  const target = boardTarget(input, writing);
  assert.equal(target, `${input.ids.prefix}${writing.members[0]!.id}`);
  const markup = html(input);
  // No label over an empty field.
  assert.doesNotMatch(markup, /<section class="sb-board" data-board="writing"/);
  // Its part is in the full record, and every way to the board goes there.
  assert.match(
    markup,
    new RegExp(`<details class="sb-archive__item"[^>]*>[\\s\\S]*?id="${target}"`),
  );
  const links = markup.match(new RegExp(`href="#${target}"`, 'g')) ?? [];
  assert.ok(links.length >= 3, `the dock, the Menu and Contents: ${links.length}`);
  // A board with tiles keeps its own field.
  assert.match(markup, /<section class="sb-board" data-board="about"/);
});

test('P3 fixture shapes: the least portfolio is a statement, not an empty field', () => {
  const input = fixtureInput('identity-only');
  const markup = html(input);
  // Thesis first: with no thesis and no hero tagline, the identity's tagline is the plate's statement.
  assert.match(markup, /<p class="sb-hero__display">Says just enough<\/p>/);
  assert.doesNotMatch(markup, /class="sb-hero__role"/);
  // Nothing to index: no Contents, no Menu, the hero across; no reach tile with no way to reach;
  // no board, so the colophon promises none.
  assert.match(markup, /<div class="sb-band" data-layout="none" data-works="0" data-index="none">/);
  assert.doesNotMatch(markup, /class="sb-tile sb-tile--large sb-contents"|<dialog/);
  assert.doesNotMatch(markup, /class="sb-tile sb-tile--dense sb-tile--accent sb-reach"/);
  assert.match(markup, /Everything here is a tile on one field\./);
  // Only a full field is the window's height; a thinner one is as tall as its tiles.
  assert.match(
    CSS,
    /\.sb-overview:not\(:has\(> \.sb-band\[data-layout='both'\]\[data-works='3'\]\)\) \{\s*min-block-size: 0;/,
  );
  // And with no way to reach the owner, no reach tile, and the works take its place.
  assert.match(
    CSS,
    /\.sb-band\[data-works='2'\]:not\(:has\(> \.sb-reach\)\)\s*\[data-area='second'\] \{\s*grid-column: 11 \/ -1;/,
  );
  assert.match(
    CSS,
    /\.sb-band\[data-index='none'\] > \[data-area='hero'\] \{\s*grid-column: 1 \/ -1;/,
  );
});

test('P3 fixture shapes: a long statement is the standfirst, a reach tile names no one, an empty board index draws no rule', () => {
  const long = html(fixtureInput('long-text'));
  // The hero's long tagline sets as its standfirst, not eleven display lines.
  assert.match(long, /<p class="sb-hero__standfirst">A tagline long enough to wrap/);
  assert.equal(statementClass('Says just enough'), 'sb-hero__display');
  assert.equal(statementClass('x'.repeat(DISPLAY_MOST + 1)), 'sb-hero__standfirst');
  // No place, no where line: the hero already says who.
  const reach =
    /<aside class="sb-tile sb-tile--dense sb-tile--accent sb-reach"[\s\S]*?<\/aside>/.exec(
      long,
    )?.[0];
  assert.ok(reach);
  assert.doesNotMatch(reach, /sb-reach__where/);
  // Record holds only the full record here: Contents names its tile, and its label has no index.
  assert.match(
    long,
    /<span class="sb-contents__name">Record<\/span><span class="sb-contents__meta">The full record<\/span>/,
  );
  const record = /<section class="sb-board" data-board="record"[\s\S]*?<\/header>/.exec(long)?.[0];
  assert.ok(record);
  assert.doesNotMatch(record, /sb-label__index/);
  // The sparse pair's way to reach is its Contact tile, in its own words; with no statement at
  // all, its name is the plate's display line.
  const sparse = html(fixtureInput('sparse'));
  assert.match(sparse, /<h1 class="sb-hero__name sb-hero__display">Jo Sparse<\/h1>/);
  // A right-to-left page sets the composition's English sentences left to right.
  assert.match(html(fixtureInput('rtl')), /<p class="sb-footer__colophon" lang="en" dir="ltr">/);
  assert.match(sparse, /<p class="sb-reach__mail"><a href="#contact">Say hello\.<\/a><\/p>/);
});

/** `pair`'s view with every image asset ready: one webp rendition each, as derivation leaves it. */
function readyInput(pair: ParsedPair): VariantRenderInput {
  const sha = 'a'.repeat(64);
  const media = {
    assets: (pair.portfolio.media ?? [])
      .filter(({ kind }) => kind === 'image')
      .map(({ id, source }) => ({
        assetId: id,
        sha256: sha,
        mime: 'image/png',
        bytes: 4096,
        width: 1200,
        height: 800,
        aspectRatio: 1.5,
        dominantColor: '#806040',
        renditions: [
          {
            name: 'w480-a1',
            ext: 'webp',
            mime: 'image/webp',
            bytes: 1024,
            width: 480,
            height: 320,
            sha256: 'b'.repeat(64),
          },
        ],
        derivedAt: '2026-11-02T09:00:00Z',
        algorithmVersion: 1,
        source: { kind: 'local', path: typeof source === 'string' ? source : 'image.png' },
        availability: { state: 'available' },
      })),
  };
  return buildRenderInput({
    view: resolvePortfolioView(pair, { media }, { mediaBase: '/media' }),
    manifest: MANIFEST,
    route: { route: 'home' },
    basePath: '',
    origin: 'https://rowan.test',
    requestTime: '2026-10-23T12:00:00Z',
  });
}

test("the two covers a rounded tile clips, the plate's and the band's, load at once and decode before first paint; every other image is lazy and async", () => {
  const markup = html(readyInput(pairOf('sample')));
  const coverIn = (kind: string) => {
    const at = markup.search(new RegExp(`<article[^>]*class="[^"]*${kind}[^"]*"`));
    assert.ok(at >= 0, `the sample has a ${kind} tile`);
    return /<img\b[^>]*>/.exec(markup.slice(at))![0];
  };
  const rounded = [coverIn('sb-work--plate'), coverIn('sb-work--band')];
  for (const img of rounded) {
    assert.doesNotMatch(img, /loading=/, img);
    assert.match(img, /\sdecoding="sync"/, img);
  }
  const others = [...markup.matchAll(/<img\b[^>]*>/g)]
    .map(([img]) => img)
    .filter((img) => !rounded.includes(img));
  assert.ok(others.length > 0, 'the sample has other images');
  for (const img of others) assert.match(img, /\sdecoding="async"/, img);
  assert.ok(others.some((img) => /\sloading="lazy"/.test(img)));
});
