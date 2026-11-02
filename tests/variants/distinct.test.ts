import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PNG } from 'pngjs';
import {
  boundaryShapes,
  BOX_LEFT_OUT,
  BOX_SELECTOR,
  boxSimilarity,
  calibrate,
  collapseRuns,
  describeOutcome,
  designPass,
  downscale,
  edgeGrid,
  iou,
  judge,
  luminanceGrid,
  matchBoxes,
  noiseFloor,
  normalizeGrid,
  pairs,
  pixelDistance,
  sharedFrameSelector,
  sharedMarkupFindings,
  sharedShingles,
  SHARED_MARKUP_CODE,
  SHARED_MARKUP_ENFORCED,
  SHARED_MARKUP_REMEDY,
  signature,
  skeleton,
  sobel,
  ssim,
  tokenOf,
  withNames,
  weightedJaccard,
  wrapInDivs,
  type Box,
  type Grid,
  type PairOutcome,
  type PairScore,
  type Shape,
  type StructureNode,
  type Thresholds,
} from './distinct';

// The distinct guards' arithmetic (distinct.ts), without a browser.

const el = (tag: string, children: StructureNode['children'] = [], role?: string): StructureNode =>
  role === undefined ? { tag, children } : { tag, role, children };

/** A boundary like a composition's home: a header with navigation, a main of sections, a footer. */
function home(sections: StructureNode[], { nav = true }: { nav?: boolean } = {}): StructureNode {
  return el('div', [
    el('header', [nav ? el('nav', [el('ul', [el('li', [el('a', ['Work'])])])]) : el('p', ['Hi'])]),
    el('main', [el('h1', ['Jane Doe']), ...sections]),
    el('footer', [el('p', ['Made by hand'])]),
  ]);
}

const section = (heading: string, ...body: StructureNode[]) =>
  el('section', [el('h2', [heading]), ...body]);

test('a token is the tag and its explicit or landmark-implied role; generic containers have none', () => {
  assert.deepEqual(tokenOf({ tag: 'nav' }), { token: 'nav[navigation]', role: 'navigation' });
  assert.deepEqual(tokenOf({ tag: 'ul' }), { token: 'ul[list]', role: 'list' });
  assert.deepEqual(tokenOf({ tag: 'h2' }), { token: 'h2' });
  assert.deepEqual(tokenOf({ tag: 'li', role: 'listitem' }), {
    token: 'li[listitem]',
    role: 'listitem',
  });
  assert.deepEqual(tokenOf({ tag: 'div', role: 'list' }), { token: 'div[list]', role: 'list' });
  // An explicit role beats the implied one, first token only.
  assert.deepEqual(tokenOf({ tag: 'ul', role: 'tablist extra' }), {
    token: 'ul[tablist]',
    role: 'tablist',
  });
  assert.equal(tokenOf({ tag: 'div' }), null);
  assert.equal(tokenOf({ tag: 'span' }), null);
  assert.equal(tokenOf({ tag: 'div', role: 'presentation' }), null);
  assert.equal(tokenOf({ tag: 'span', role: 'none' }), null);
});

// ---- Implicit roles, as HTML-AAM maps them

/** The tokens of `boundary`'s shapes, depth first, so a test reads which elements stayed. */
function tokens(boundary: StructureNode): string[] {
  const out: string[] = [];
  const walk = (shapes: readonly Shape[]) => {
    for (const shape of shapes) {
      out.push(shape.token);
      walk(shape.children);
    }
  };
  walk(boundaryShapes(boundary));
  return out;
}

test('a header is banner and a footer contentinfo only outside sectioning content', () => {
  assert.deepEqual(tokens(el('div', [el('header', [el('p')]), el('footer', [el('p')])])), [
    'header[banner]',
    'p',
    'footer[contentinfo]',
    'p',
  ]);
  // A header inside a section is generic, so it drops like a div and its children lift.
  for (const scope of ['article', 'aside', 'main', 'nav', 'section']) {
    const inside = el('div', [
      { tag: scope, named: true, children: [el('header', [el('h2')]), el('footer', [el('p')])] },
    ]);
    const scoped = tokens(inside);
    assert.ok(
      !scoped.some((token) => token.startsWith('header') || token.startsWith('footer')),
      `${scope}: ${scoped}`,
    );
    assert.ok(scoped.includes('h2') && scoped.includes('p'), `${scope}: ${scoped}`);
  }
  // A nested footer, deep in an article inside a div inside main, is still scoped.
  const nested = el('div', [
    el('main', [el('div', [el('article', [el('div', [el('footer', [el('small')])])])])]),
  ]);
  assert.deepEqual(tokens(nested), ['main[main]', 'article[article]', 'small']);
  // Only sectioning content scopes: a header in a plain div, or in a figure, is still banner.
  assert.deepEqual(tokens(el('div', [el('div', [el('figure', [el('header')])])])), [
    'figure[figure]',
    'header[banner]',
  ]);
});

test('a section is region only with an accessible name', () => {
  const unnamed = el('div', [el('main', [section('About', el('p'))])]);
  assert.deepEqual(tokens(unnamed), ['main[main]', 'h2', 'p']);
  const named = el('div', [
    el('main', [{ tag: 'section', named: true, children: [el('h2'), el('p')] }]),
  ]);
  assert.deepEqual(tokens(named), ['main[main]', 'section[region]', 'h2', 'p']);
  assert.equal(tokenOf({ tag: 'section' }), null);
  assert.equal(tokenOf({ tag: 'section', named: false }), null);
  assert.deepEqual(tokenOf({ tag: 'section', named: true }), {
    token: 'section[region]',
    role: 'region',
  });
});

test('an aside is complementary unless it sits in sectioning content without a name', () => {
  assert.deepEqual(tokenOf({ tag: 'aside' }), {
    token: 'aside[complementary]',
    role: 'complementary',
  });
  assert.equal(tokenOf({ tag: 'aside' }, true), null);
  assert.deepEqual(tokenOf({ tag: 'aside', named: true }, true), {
    token: 'aside[complementary]',
    role: 'complementary',
  });
  assert.deepEqual(tokens(el('div', [el('article', [el('aside', [el('p')])])])), [
    'article[article]',
    'p',
  ]);
});

test('an explicit role always wins, and an explicit generic role makes any element generic', () => {
  assert.deepEqual(tokenOf({ tag: 'header', role: 'banner' }, true), {
    token: 'header[banner]',
    role: 'banner',
  });
  assert.deepEqual(tokenOf({ tag: 'section', role: 'region' }), {
    token: 'section[region]',
    role: 'region',
  });
  assert.deepEqual(tokenOf({ tag: 'footer', role: 'contentinfo' }, true), {
    token: 'footer[contentinfo]',
    role: 'contentinfo',
  });
  assert.deepEqual(tokenOf({ tag: 'section', role: 'tabpanel' }), {
    token: 'section[tabpanel]',
    role: 'tabpanel',
  });
  assert.equal(tokenOf({ tag: 'header', role: 'presentation' }), null);
  assert.equal(tokenOf({ tag: 'ul', role: 'none' }), null);
});

test('names join the boundary in the order the snapshot walks it, as booleans', () => {
  const tree = el('div', [el('main', [el('section', [el('h2')]), el('section')])]);
  const named = withNames(tree, [false, false, true, false, false]);
  const main = named.children[0] as StructureNode;
  assert.deepEqual(
    main.children.map((child) => (child as StructureNode).named),
    [true, false],
  );
  assert.throws(() => withNames(tree, [false, false]), /Fewer names/);
  assert.throws(() => withNames(tree, [false, false, false, false, false, true]), /6 names for 5/);
});

test('generic containers are transparent: their children lift to their parent', () => {
  const wrapped = el('div', [
    el('main', [el('div', [el('div', [el('h1', ['Hi'])]), el('span', [el('p')])])]),
  ]);
  assert.deepEqual(boundaryShapes(wrapped), [
    {
      token: 'main[main]',
      role: 'main',
      children: [
        { token: 'h1', children: [] },
        { token: 'p', children: [] },
      ],
    },
  ]);
});

test('text and attributes drop: only tags and roles reach the signature', () => {
  const a = home([section('About', el('p', ['One']))]);
  const b = home([section('Elsewhere', el('p', ['Something else entirely']))]);
  const withIds: StructureNode = {
    ...b,
    children: b.children.map((child) =>
      typeof child === 'string' ? child : { ...child, id: 'x', href: '/y' },
    ),
  };
  assert.equal(weightedJaccard(signature(a), signature(withIds)), 1);
});

test('a run of more than 3 identical siblings collapses to 3, and different ones stay', () => {
  const li = { token: 'li', children: [] };
  const other = { token: 'li', children: [{ token: 'a', children: [] }] };
  assert.equal(collapseRuns([li, li, li, li, li]).length, 3);
  assert.equal(collapseRuns([li, li, li, other, li, li, li, li]).length, 7);
  // So a list of 3 and a list of 50 look the same.
  const list = (n: number) =>
    el('div', [
      el(
        'ul',
        Array.from({ length: n }, () => el('li', [el('a')])),
      ),
    ]);
  assert.equal(weightedJaccard(signature(list(3)), signature(list(50))), 1);
  assert.ok(weightedJaccard(signature(list(1)), signature(list(3))) < 1);
});

test("an svg's or a canvas's contents don't count, but the element does", () => {
  const icon = (paths: number) =>
    el('div', [
      el(
        'svg',
        Array.from({ length: paths }, (_, i) => el(i % 2 ? 'path' : 'circle')),
      ),
    ]);
  assert.equal(weightedJaccard(signature(icon(1)), signature(icon(9))), 1);
  assert.deepEqual(boundaryShapes(el('div', [el('canvas', [el('p', ['Fallback'])])])), [
    { token: 'canvas', children: [] },
  ]);
});

test('shingles are the last 3 tokens of each path, and the skeleton adds its pairs at weight 4', () => {
  const named: StructureNode = {
    tag: 'section',
    named: true,
    children: [el('ul', [el('li', [el('a')])])],
  };
  const page = el('div', [el('main', [named])]);
  const shingles = signature(page);
  assert.equal(shingles.get('main[main]'), 1);
  assert.equal(shingles.get('main[main]>section[region]'), 1);
  assert.equal(shingles.get('main[main]>section[region]>ul[list]'), 1);
  assert.equal(shingles.get('section[region]>ul[list]>li'), 1);
  assert.equal(shingles.get('ul[list]>li>a'), 1);
  assert.deepEqual(skeleton(boundaryShapes(page)), ['0:main[main]', '1:section[region]']);
  assert.equal(shingles.get('skeleton ^ 0:main[main]'), 4);
  assert.equal(shingles.get('skeleton 0:main[main] 1:section[region]'), 4);
  assert.equal(shingles.get('skeleton 1:section[region] $'), 4);
});

test('weighted Jaccard runs from 0, nothing shared, to 1, the same multiset', () => {
  const a = new Map([
    ['x', 2],
    ['y', 1],
  ]);
  assert.equal(weightedJaccard(a, a), 1);
  assert.equal(weightedJaccard(a, new Map([['z', 3]])), 0);
  assert.equal(weightedJaccard(a, new Map([['x', 1]])), 1 / 3);
  assert.equal(weightedJaccard(new Map(), new Map()), 1);
});

test('the same composition wrapped in 3 extra divs scores the same; another composition scores lower', () => {
  const editorial = home([
    section('About', el('p')),
    section('Work', el('ol', [el('li', [el('article')])])),
  ]);
  assert.equal(weightedJaccard(signature(editorial), signature(wrapInDivs(editorial))), 1);
  const wrapped = wrapInDivs(editorial);
  assert.equal(((wrapped.children[0] as StructureNode).children[0] as StructureNode).tag, 'div');
  const cinema = el('div', [
    el('main', [
      el('h1'),
      el('div', [el('figure', [el('img')]), el('figure', [el('img')])], 'list'),
    ]),
    el('nav', [el('button'), el('button')]),
  ]);
  const similarity = weightedJaccard(signature(editorial), signature(cinema));
  assert.ok(similarity < 0.3, String(similarity));
});

test('the shared shingles a failure prints are the heaviest first', () => {
  const a = signature(home([section('A', el('p'))]));
  const b = signature(home([section('B', el('p'))], { nav: false }));
  const shared = sharedShingles(a, b, 3);
  assert.equal(shared.length, 3);
  assert.equal(shared[0]!.weight, 4);
  assert.ok(shared.every(({ shingle }) => a.has(shingle) && b.has(shingle)));
});

// ---- Pixels

/** A PNG of `width` by `height`, white, with dark rectangles at `boxes` ([x, y, w, h]). */
function png(
  width: number,
  height: number,
  boxes: [number, number, number, number][],
  ink = 20,
  paper = 250,
): Uint8Array {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = boxes.some(
        ([bx, by, bw, bh]) => x >= bx && x < bx + bw && y >= by && y < by + bh,
      );
      const value = inside ? ink : paper;
      const i = (y * width + x) * 4;
      image.data[i] = value;
      image.data[i + 1] = value;
      image.data[i + 2] = value;
      image.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(image);
}

const grid = (width: number, height: number, values: number[]): Grid => ({
  width,
  height,
  data: Float64Array.from(values),
});

test("luminance is each pixel's luma from 0 to 1, and Sobel finds its edges", () => {
  const image = {
    width: 4,
    height: 1,
    data: Uint8Array.from([0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255]),
  };
  const luma = luminanceGrid(image);
  assert.deepEqual(
    [...luma.data].map((v) => Number(v.toFixed(4))),
    [0, 1, 0.2126, 0.7152],
  );
  const flat = sobel(grid(3, 3, [5, 5, 5, 5, 5, 5, 5, 5, 5]));
  assert.ok(flat.data.every((value) => value === 0));
  const step = sobel(grid(4, 3, [0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1]));
  // The step between columns 1 and 2: |gx| = 4 there, nothing at the far edges.
  assert.equal(step.data[1 * 4 + 1], 4);
  assert.equal(step.data[1 * 4 + 2], 4);
  assert.equal(step.data[1 * 4 + 0], 0);
});

test('the grid averages edge strength per cell, and normalizes to its 99th percentile', () => {
  const small = downscale(grid(4, 2, [1, 3, 0, 0, 5, 7, 2, 2]), 2, 1);
  assert.deepEqual([...small.data], [4, 1]);
  // A size that doesn't divide evenly still covers every pixel once.
  const uneven = downscale(grid(5, 1, [1, 1, 1, 1, 1]), 2, 1);
  assert.deepEqual([...uneven.data], [1, 1]);
  assert.deepEqual([...normalizeGrid(grid(2, 1, [0, 0])).data], [0, 0]);
  const scaled = normalizeGrid(grid(4, 1, [0, 1, 2, 4]));
  assert.deepEqual([...scaled.data], [0, 0.25, 0.5, 1]);
});

test('SSIM is 1 for the same grid, and 1 - SSIM is the distance', () => {
  const a = grid(
    8,
    8,
    Array.from({ length: 64 }, (_, i) => (i % 3) / 2),
  );
  assert.ok(Math.abs(ssim(a, a) - 1) < 1e-9);
  assert.equal(pixelDistance(a, a), 0);
  const b = grid(
    8,
    8,
    Array.from({ length: 64 }, (_, i) => ((i + 1) % 3) / 2),
  );
  assert.ok(pixelDistance(a, b) > 0.5);
  assert.throws(() => ssim(a, grid(4, 4, Array(16).fill(0))), /one size/);
});

test('a recolor of the same layout is near 0; a different layout is far', () => {
  const layout: [number, number, number, number][] = [
    [40, 40, 400, 60],
    [40, 140, 250, 300],
    [340, 140, 240, 120],
  ];
  const light = edgeGrid(png(640, 400, layout), 96, 60);
  const dark = edgeGrid(png(640, 400, layout, 230, 30), 96, 60);
  const soft = edgeGrid(png(640, 400, layout, 120, 200), 96, 60);
  const moved = edgeGrid(
    png(640, 400, [
      [0, 0, 640, 120],
      [200, 160, 240, 60],
      [200, 240, 240, 60],
      [200, 320, 240, 60],
    ]),
    96,
    60,
  );
  assert.ok(pixelDistance(light, dark) < 0.02, String(pixelDistance(light, dark)));
  assert.ok(pixelDistance(light, soft) < 0.02, String(pixelDistance(light, soft)));
  assert.ok(pixelDistance(light, moved) > 0.3, String(pixelDistance(light, moved)));
});

// ---- Layout boxes

const box = (x: number, y: number, width: number, height: number, kind = 'section'): Box => ({
  kind,
  x,
  y,
  width,
  height,
});

test('IoU is the intersection over the union: 1 the same box, 0 apart', () => {
  assert.equal(iou(box(0, 0, 1, 1), box(0, 0, 1, 1)), 1);
  assert.equal(iou(box(0, 0, 1, 1), box(2, 2, 1, 1)), 0);
  assert.equal(iou(box(0, 0, 1, 1), box(1, 0, 1, 1)), 0);
  // Half of one over the other: 0.5 / 1.5.
  assert.equal(iou(box(0, 0, 1, 1), box(0.5, 0, 1, 1)), 0.5 / 1.5);
  assert.equal(iou(box(0, 0, 0, 0), box(0, 0, 0, 0)), 0);
});

test('matching is greedy by IoU, each box once, and the kind plays no part', () => {
  const a = [box(0, 0, 1, 0.2, 'header'), box(0, 0.2, 1, 0.8, 'main')];
  const b = [box(0, 0.25, 1, 0.75, 'section'), box(0, 0, 1, 0.25, 'nav')];
  assert.deepEqual(
    matchBoxes(a, b).map(({ a: i, b: j }) => [i, j]),
    [
      [1, 0],
      [0, 1],
    ],
  );
  // A box that overlaps two takes the better one, and the other stays unmatched.
  const one = [box(0, 0, 1, 1)];
  const two = [box(0, 0, 1, 0.9), box(0, 0.9, 1, 0.1)];
  assert.deepEqual(
    matchBoxes(one, two).map(({ a: i, b: j }) => [i, j]),
    [[0, 0]],
  );
  assert.deepEqual(matchBoxes([box(0, 0, 0.1, 0.1)], [box(0.5, 0.5, 0.1, 0.1)]), []);
});

test('box similarity weights each match by area: the same blocks score 1, a rearrangement low', () => {
  const column = [box(0.2, 0, 0.6, 0.1, 'header'), box(0.2, 0.1, 0.6, 1.9, 'main')];
  assert.equal(boxSimilarity(column, column), 1);
  assert.equal(boxSimilarity([], []), 1);
  assert.equal(boxSimilarity(column, []), 0);
  // The same column moved a little still scores high.
  const nudged = column.map((each) => ({ ...each, y: each.y + 0.02 }));
  assert.ok(boxSimilarity(column, nudged) > 0.9, String(boxSimilarity(column, nudged)));
  // A sidebar beside a wide main, or a strip of panels, scores low against the column.
  const sidebar = [box(0, 0, 0.2, 2, 'aside'), box(0.2, 0, 0.8, 2, 'main')];
  const strip = [0, 1, 2, 3].map((i) => box(i * 0.3, 0.2, 0.28, 0.7, 'article'));
  assert.ok(boxSimilarity(column, sidebar) < 0.7, String(boxSimilarity(column, sidebar)));
  assert.ok(boxSimilarity(column, strip) < 0.3, String(boxSimilarity(column, strip)));
  // A small box mismatched costs little; a large one a lot.
  const extraIcon = [...column, box(0.9, 0, 0.02, 0.02, 'svg')];
  assert.ok(boxSimilarity(column, extraIcon) > 0.99);
});

test('the box guard leaves the main landmark out, by tag and by role', () => {
  // The selector is one :is() of the blocks, less BOX_LEFT_OUT.
  const match = /^:is\((.*)\):not\((.*)\)$/.exec(BOX_SELECTOR);
  assert.ok(match, BOX_SELECTOR);
  const blocks = match[1]!.split(', ');
  assert.equal(match[2], BOX_LEFT_OUT);
  assert.deepEqual(BOX_LEFT_OUT.split(', '), ['main', '[role="main"]']);
  for (const leftOut of ['main', '[role="main"]']) assert.ok(!blocks.includes(leftOut), leftOut);
  for (const kept of ['header', 'nav', 'footer', 'section', 'h1', '[role="region"]']) {
    assert.ok(blocks.includes(kept), kept);
  }
  // Why: a full-width main past both viewports matches any other page's at
  // an IoU near 1 and, as the largest box, decides the score. Two pages whose
  // blocks share no place score high with it and 0 without it.
  const left = [box(0, 0.1, 0.5, 0.4), box(0, 0.6, 0.5, 0.4)];
  const right = [box(0.55, 0.1, 0.45, 0.4), box(0.55, 0.6, 0.45, 0.4)];
  const main = box(0, 0.07, 1, 1.93, 'main');
  assert.equal(boxSimilarity(left, right), 0);
  assert.ok(
    boxSimilarity([main, ...left], [main, ...right]) > 0.6,
    String(boxSimilarity([main, ...left], [main, ...right])),
  );
});

// ---- Rules

const IDS = ['a', 'b', 'c'];
const THRESHOLDS: Thresholds = {
  dom: { desktop: 0.5, mobile: 0.5 },
  box: { desktop: 0.6, mobile: 0.6 },
  px: { desktop: 0.2, mobile: 0.2 },
};

/** Every pair of IDS at both viewports, passing unless `override` says otherwise. */
function scores(override: Partial<Record<string, Partial<PairScore>>> = {}): PairScore[] {
  return (['desktop', 'mobile'] as const).flatMap((viewport) =>
    pairs(IDS).map(([a, b]) => ({
      a,
      b,
      viewport,
      dom: 0.2,
      box: 0.3,
      px: 0.6,
      ...override[`${a}-${b}`],
      ...override[`${a}-${b}@${viewport}`],
    })),
  );
}

const brief = (outcomes: readonly PairOutcome[]) =>
  outcomes.map(({ a, b, viewport }) => `${a}-${b}@${viewport}`);

test('pairs are each unordered pair once', () => {
  assert.deepEqual(pairs(['a', 'b', 'c']), [
    ['a', 'b'],
    ['a', 'c'],
    ['b', 'c'],
  ]);
  assert.equal(pairs(['1', '2', '3', '4', '5']).length, 10);
});

test('a pair needs structure at most T_dom and boxes at most T_box, at each viewport', () => {
  const clean = judge({ ids: IDS, pending: [], scores: scores(), thresholds: THRESHOLDS });
  assert.equal(clean.outcomes.length, 6);
  assert.deepEqual(
    [clean.failures, clean.clones, clean.reports, clean.stale, clean.problems],
    [[], [], [], [], []],
  );
  // Desktop's margin can't hide a mobile clone of the layout, and either design guard alone fails a pair.
  const verdict = judge({
    ids: IDS,
    pending: [],
    scores: scores({ 'a-b@mobile': { dom: 0.9 }, 'b-c@desktop': { box: 0.8 } }),
    thresholds: THRESHOLDS,
  });
  assert.deepEqual(
    verdict.failures.map(({ a, b, viewport, domPass, boxPass }) => [
      a,
      b,
      viewport,
      domPass,
      boxPass,
    ]),
    [
      ['b', 'c', 'desktop', true, false],
      ['a', 'b', 'mobile', false, true],
    ],
  );
  // The thresholds themselves pass: at most, and at least.
  const edge = judge({
    ids: IDS,
    pending: [],
    scores: scores({ 'a-b': { dom: 0.5, box: 0.6, px: 0.2 } }),
    thresholds: THRESHOLDS,
  });
  assert.deepEqual([edge.failures, edge.clones], [[], []]);
});

test("a recorded box acceptance passes its pair's boxes up to its own cap, only while structure and pixels pass, and a stale one is a problem", () => {
  const acceptance = {
    a: 'b',
    b: 'a',
    viewport: 'mobile' as const,
    box: 0.65,
    reason: 'boxes alone',
    by: 'lead A',
    until: 'media',
  };
  // Within the cap, with structure and pixels clear: the pair passes, and says why.
  const within = judge({
    ids: IDS,
    pending: [],
    scores: scores({ 'a-b@mobile': { box: 0.64 } }),
    thresholds: THRESHOLDS,
    accepted: [acceptance],
  });
  assert.deepEqual([within.failures, within.problems], [[], []]);
  const passed = within.outcomes.find(
    ({ a, b, viewport }) => `${a}-${b}@${viewport}` === 'a-b@mobile',
  );
  assert.equal(passed?.accepted, acceptance);
  // Over the cap, or with structure failing too, or at the other viewport: it fails as before.
  for (const override of [{ box: 0.66 }, { box: 0.64, dom: 0.9 }]) {
    const verdict = judge({
      ids: IDS,
      pending: [],
      scores: scores({ 'a-b@mobile': override }),
      thresholds: THRESHOLDS,
      accepted: [acceptance],
    });
    assert.deepEqual(brief(verdict.failures), ['a-b@mobile'], JSON.stringify(override));
  }
  const elsewhere = judge({
    ids: IDS,
    pending: [],
    scores: scores({ 'a-b@desktop': { box: 0.64 } }),
    thresholds: THRESHOLDS,
    accepted: [acceptance],
  });
  assert.deepEqual(brief(elsewhere.failures), ['a-b@desktop']);
  // A pair that passes without it, or no scored pair at all: the acceptance is a problem to remove.
  const unneeded = judge({
    ids: IDS,
    pending: [],
    scores: scores(),
    thresholds: THRESHOLDS,
    accepted: [acceptance],
  });
  assert.equal(unneeded.problems.length, 1);
  assert.match(unneeded.problems[0]!, /no longer needed/);
  const unmatched = judge({
    ids: IDS,
    pending: [],
    scores: scores(),
    thresholds: THRESHOLDS,
    accepted: [{ ...acceptance, a: 'x' }],
  });
  assert.match(unmatched.problems.join('\n'), /matches no pair/);
});

test('a design guard with no threshold does not gate', () => {
  const verdict = judge({
    ids: IDS,
    pending: [],
    scores: scores({ 'a-b': { box: 0.99 } }),
    thresholds: { ...THRESHOLDS, box: null },
  });
  assert.deepEqual(verdict.failures, []);
  assert.equal(verdict.outcomes[0]!.boxPass, null);
  assert.equal(designPass({ domPass: null, boxPass: null }), null);
  assert.equal(designPass({ domPass: true, boxPass: null }), true);
  assert.equal(designPass({ domPass: true, boxPass: false }), false);
});

test('the clone guard gates every pair, pending or not', () => {
  const verdict = judge({
    ids: IDS,
    pending: IDS,
    scores: scores({ 'a-b@desktop': { px: 0.05 } }),
    thresholds: THRESHOLDS,
  });
  assert.deepEqual(brief(verdict.clones), ['a-b@desktop']);
  assert.deepEqual(verdict.failures, []);
});

test('a pair of two pending compositions only reports; a pair with one enforced must pass', () => {
  const verdict = judge({
    ids: IDS,
    pending: ['a', 'b'],
    scores: scores({ 'a-b': { dom: 0.95 }, 'a-c': { dom: 0.95 } }),
    thresholds: THRESHOLDS,
  });
  assert.deepEqual(brief(verdict.reports), ['a-b@desktop', 'a-b@mobile']);
  assert.ok(verdict.reports.every(({ mode }) => mode === 'report'));
  assert.deepEqual(brief(verdict.failures), ['a-c@desktop', 'a-c@mobile']);
  assert.ok(verdict.failures.every(({ mode }) => mode === 'enforced'));
  assert.deepEqual(verdict.stale, []);
});

test('today: every composition pending and alike, every pair a report and no failure', () => {
  const verdict = judge({
    ids: IDS,
    pending: IDS,
    scores: scores({ 'a-b': { dom: 0.9 }, 'a-c': { dom: 0.9 }, 'b-c': { dom: 0.9 } }),
    thresholds: THRESHOLDS,
  });
  assert.equal(verdict.reports.length, 6);
  assert.deepEqual(
    [verdict.failures, verdict.clones, verdict.stale, verdict.problems],
    [[], [], [], []],
  );
});

test('a pending composition that already passes the design guards against every other fails as stale pending', () => {
  // c differs from a and b at both viewports; a and b are still alike.
  const verdict = judge({
    ids: IDS,
    pending: IDS,
    scores: scores({ 'a-b': { dom: 0.9 } }),
    thresholds: THRESHOLDS,
  });
  assert.deepEqual(verdict.stale, ['c']);
  assert.deepEqual(verdict.failures, []);
  // Alike in boxes at one viewport keeps it pending honestly.
  const half = judge({
    ids: IDS,
    pending: IDS,
    scores: scores({ 'a-b': { dom: 0.9 }, 'a-c@mobile': { box: 0.9 } }),
    thresholds: THRESHOLDS,
  });
  assert.deepEqual(half.stale, []);
  // With no design guard gating, nothing can be stale.
  const none = judge({
    ids: IDS,
    pending: IDS,
    scores: scores(),
    thresholds: { ...THRESHOLDS, dom: null, box: null },
  });
  assert.deepEqual(none.stale, []);
});

test('a pending id the guard covers no composition for, or a missing score, is a problem', () => {
  const verdict = judge({
    ids: IDS,
    pending: ['a', 'zeta'],
    scores: scores().filter(
      (score) => !(score.a === 'b' && score.b === 'c' && score.viewport === 'mobile'),
    ),
    thresholds: THRESHOLDS,
  });
  assert.deepEqual(verdict.problems, [
    'zeta is pending, and the guard covers no such composition',
    'no score for b and c at mobile',
  ]);
});

test('an outcome reads as one line, with each guard and its threshold', () => {
  const [outcome] = judge({
    ids: IDS,
    pending: [],
    scores: scores(),
    thresholds: { ...THRESHOLDS, box: null },
  }).outcomes;
  assert.equal(
    describeOutcome(outcome!, { ...THRESHOLDS, box: null }),
    'a and b at desktop: structure 0.200 <= 0.5, boxes 0.300 ~ not gating, pixels 0.600 >= 0.2',
  );
});

// ---- Calibration

test("a threshold sits halfway into the gap between the controls, from the 'same' side", () => {
  // Similarity: "same" high, "different" low; a pair passes at or under it.
  assert.deepEqual(calibrate([1, 0.97], [0.4, 0.55], 'similarity'), {
    same: 0.97,
    different: 0.55,
    gap: 0.42,
    threshold: 0.76,
  });
  // Distance: "same" low, "different" high; a pair passes at or over it.
  assert.deepEqual(calibrate([0.01, 0.12], [0.5, 0.42], 'distance'), {
    same: 0.12,
    different: 0.42,
    gap: 0.3,
    threshold: 0.27,
  });
  // Within the brief's ceiling: at most max(same) + 0.6 x gap.
  const { same, gap, threshold } = calibrate([0.12], [0.42], 'distance');
  assert.ok(threshold! <= same + 0.6 * gap);
});

test('a gap under 0.1 sets no threshold: the signature needs work first', () => {
  assert.equal(calibrate([0.9], [0.85], 'similarity').threshold, null);
  assert.equal(calibrate([0.2], [0.1], 'distance').threshold, null);
  assert.equal(calibrate([0.2], [0.1], 'distance').gap, -0.1);
  assert.throws(() => calibrate([], [0.5], 'distance'), /at least one/);
});

test("the clone guard's threshold is twice its 'same' controls' noise floor", () => {
  assert.deepEqual(noiseFloor([0.004, 0.1, 0.03]), { floor: 0.1, threshold: 0.2 });
  assert.deepEqual(noiseFloor([0.7]), { floor: 0.7, threshold: 1 });
  assert.deepEqual(noiseFloor([0.05], 3), { floor: 0.05, threshold: 0.15 });
  assert.throws(() => noiseFloor([]), /at least one/);
});

// ---- Shared markup

test("each shared frame in a first-party boundary is an audit.shared-markup finding, in E's shape", () => {
  const findings = sharedMarkupFindings({
    packageName: '@portfolio/variant-spatial-bento',
    file: '/',
    frames: [
      { tag: 'section', sectionId: 'about', kind: 'prose' },
      { tag: 'article', sectionId: null, kind: null },
    ],
  });
  assert.deepEqual(findings[0], {
    code: 'audit.shared-markup',
    package: '@portfolio/variant-spatial-bento',
    file: '/',
    line: 0,
    column: 0,
    message:
      'Section about, a prose section, renders in the shared renderer: its <section> has data-renderer="shared".',
    remedy:
      "Render this kind in the composition's own renderer; the shared one is the fallback's and third parties'.",
  });
  assert.match(findings[1]!.message, /^Section \(no id\), a \(no kind\) section/);
  assert.deepEqual(sharedMarkupFindings({ packageName: 'x', file: '/', frames: [] }), []);
  assert.equal(SHARED_MARKUP_CODE, 'audit.shared-markup');
  assert.equal(SHARED_MARKUP_REMEDY.endsWith("third parties'."), true);
  assert.equal(
    sharedFrameSelector('spatial-bento'),
    '[data-variant="spatial-bento"] :is(section, article)[data-renderer="shared"]',
  );
});

test("the shared-markup check stays off until E's PR 3 pins land, and the code is not yet an AuditCode", () => {
  // Today every first-party frame is shared, so the spec only attaches the
  // findings. When E's PR 3 adds the code to AUDIT_CODES, turn the gate on
  // in the same PR, and this test with it.
  assert.equal(SHARED_MARKUP_ENFORCED, false);
  const audit = readFileSync(
    new URL('../../packages/variant-contract/src/node/audit.ts', import.meta.url),
    'utf8',
  );
  assert.equal(audit.includes(`'${SHARED_MARKUP_CODE}'`), false);
});
