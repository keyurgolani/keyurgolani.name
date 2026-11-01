import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  asyncGroups,
  buildChunks,
  enhancementEntries,
  checkedLine,
  sampleLine,
  staticChunks,
  studioAssets,
} from './check-budgets.mjs';
import { OVER_BUDGET_METRICS, overBudgetProblems } from './budgets.mjs';
import {
  BUDGET_KINDS,
  checkBudgets,
  checkStudio,
  failureFields,
  fontFaces,
  infiniteDeclarations,
  limitsFor,
  remoteReferences,
  reportRecord,
  reproCommand,
} from './lib/budgets.mjs';
import { REPO_ROOT } from './lib/reports.mjs';
import { loadValidator } from './summarize.mjs';

// pnpm check:budgets (#6, items 3 and 4). The fixtures below stand in for a
// build, its ASSET_MANIFEST, and a trace report; CI's trace job runs the
// check on real ones (ci/budgets.mjs).

const RUNTIME = JSON.parse(readFileSync(path.join(REPO_ROOT, 'runtime-budgets.json'), 'utf8'));
const CEILINGS = RUNTIME.budgets;
const ORIGIN = 'http://127.0.0.1:4000';

/** A variant as ASSET_MANIFEST lists one. */
function variant(id, fields = {}) {
  return {
    kind: 'variant',
    id,
    packageName: `@acme/${id}`,
    version: '1.0.0',
    fixture: false,
    performanceTier: 'light',
    stylesheet: {
      url: `/_portfolio/variant/${id}.0123456789ab.css`,
      bytes: 4000,
      gzipBytes: 1000,
      sha256: 'x',
    },
    fonts: [],
    images: [],
    stills: [],
    enhancements: [],
    budgets: {},
    ...fields,
  };
}

/** A pack as ASSET_MANIFEST lists one. */
function pack(kind, id, fields = {}) {
  return {
    kind,
    id,
    packageName: `@acme/${kind}s`,
    version: '1.0.0',
    fixture: false,
    stylesheet: {
      url: `/_portfolio/pack/${id}.0123456789ab.css`,
      bytes: 2000,
      gzipBytes: 600,
      sha256: 'x',
    },
    fonts: [],
    images: [],
    stills: [],
    enhancements: [],
    budgets: {},
    ...fields,
  };
}

/** A JS chunk as the trace attributes one: `packages` maps a package to its gzip bytes. */
function chunk(name, packages) {
  return {
    kind: 'js',
    url: `${ORIGIN}/_next/static/chunks/${name}.js`,
    packages: Object.entries(packages).map(([pkg, gzipBytes]) => ({
      package: pkg,
      bytes: gzipBytes * 3,
      gzipBytes,
    })),
  };
}

const quietProbe = () => ({
  frames: { loops: [], loopCount: 0 },
  timers: { intervals: [], timeouts: [], recurring: 0 },
  animations: { infinite: [] },
});

/** A trace case that renders `composition`. */
function traceCase(composition, fields = {}) {
  return {
    route: '/',
    viewport: '1440x900',
    profile: 'read-only',
    composition,
    origin: ORIGIN,
    requests: [],
    probe: quietProbe(),
    attribution: { chunks: [], withoutMap: [] },
    ...fields,
  };
}

/** checkBudgets over `units` and `cases`, with every stylesheet a clean one unless `css` says. */
function check(units, cases, { css = {}, chunks = [], entries = {}, statics = {} } = {}) {
  return checkBudgets({
    units,
    platform: { url: '/_portfolio/pack/_platform.0123456789ab.css' },
    ceilings: CEILINGS,
    trace: { cases },
    chunks,
    entries: (unit) => entries[unit.id] ?? {},
    statics: (unit) => (unit.id in statics ? statics[unit.id] : new Set()),
    stylesheet: (url) => css[url] ?? '[data-variant] { color: red; }',
  });
}

const metrics = (records) => records.map((record) => record.metric).sort();

test('runtime-budgets.json sets a ceiling of every kind for every tier and pack axis, each with its basis', () => {
  assert.deepEqual(CEILINGS.kinds && Object.keys(CEILINGS.kinds), BUDGET_KINDS);
  assert.deepEqual(Object.keys(CEILINGS.tiers), ['light', 'medium', 'heavy']);
  assert.deepEqual(Object.keys(CEILINGS.packs).sort(), [
    'color-scheme',
    'design-language',
    'typography',
  ]);
  for (const row of [...Object.values(CEILINGS.tiers), ...Object.values(CEILINGS.packs)]) {
    assert.deepEqual(Object.keys(row), BUDGET_KINDS);
    for (const value of Object.values(row)) assert.ok(Number.isInteger(value) && value >= 0);
  }
  assert.deepEqual(Object.keys(CEILINGS.basis), BUDGET_KINDS);
  for (const [kind, basis] of Object.entries(CEILINGS.basis)) {
    assert.ok(basis.why.length > 0, `${kind} says why`);
    assert.ok(basis.restsOn.length > 0, `${kind} cites a measurement`);
    for (const pointer of basis.restsOn) {
      const value = pointer
        .split('/')
        .slice(1)
        .reduce((node, key) => node?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], RUNTIME);
      assert.equal(
        typeof value === 'number' || typeof value === 'string',
        true,
        `${kind}: ${pointer}`,
      );
    }
  }
});

/** Every bundled unit's manifest: variants by their package's portfolio.kind, packs by their package's. */
function bundledUnits() {
  const units = [];
  const packages = path.join(REPO_ROOT, 'packages');
  const dirs = readdirSync(packages).flatMap((name) =>
    name === 'budget-fixtures'
      ? readdirSync(path.join(packages, name)).map((child) => path.join(name, child))
      : [name],
  );
  for (const dir of dirs) {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(path.join(packages, dir, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    const kind = pkg.portfolio?.kind;
    if (kind === 'variant') {
      const manifest = JSON.parse(readFileSync(path.join(packages, dir, 'manifest.json'), 'utf8'));
      units.push({
        kind,
        id: manifest.id,
        performanceTier: manifest.performanceTier,
        budgets: manifest.budgets ?? {},
      });
    } else if (['color-scheme', 'design-language', 'typography'].includes(kind)) {
      for (const id of readdirSync(path.join(packages, dir, 'packs'))) {
        const manifest = JSON.parse(
          readFileSync(path.join(packages, dir, 'packs', id, 'manifest.json'), 'utf8'),
        );
        units.push({ kind, id: manifest.id, budgets: manifest.budgets ?? {} });
      }
    }
  }
  return units;
}

/** The bundled units no budget of #6's declares yet, each another issue's to declare. */
const UNDECLARED = [];

test('every bundled variant and pack declares budgets within its ceilings', () => {
  const units = bundledUnits();
  for (const id of ['fallback', 'fixture-over-budget', 'warm-parchment', 'fixture-font']) {
    assert.ok(
      units.some((one) => one.id === id),
      `${id} is bundled`,
    );
  }
  for (const unit of units) {
    // A unit declares all six or none: a package another issue owns takes its
    // tier's ceilings until it declares.
    if (Object.keys(unit.budgets).length > 0 || !UNDECLARED.includes(unit.id)) {
      assert.deepEqual(Object.keys(unit.budgets), BUDGET_KINDS, `${unit.id} declares all six`);
    }
    for (const [kind, { declared, ceiling }] of Object.entries(limitsFor(unit, CEILINGS))) {
      assert.notEqual(ceiling, null, `${unit.kind} ${unit.id} has a ${kind} ceiling`);
      if (declared !== null)
        assert.ok(declared <= ceiling, `${unit.id} ${kind}: ${declared} <= ${ceiling}`);
    }
  }
});

test('a unit within its budgets has no record, and the report lists each kind it checked', () => {
  const light = variant('light', { budgets: { js: 2048, css: 2048 } });
  const scheme = pack('color-scheme', 'warm');
  const { records, checked } = check(
    [light, scheme],
    [
      traceCase('light', {
        attribution: { chunks: [chunk('a', { '@acme/light': 900, react: 40000 })], withoutMap: [] },
      }),
    ],
  );
  assert.deepEqual(records, []);
  assert.deepEqual(
    checked.filter((row) => row.id === 'light').map((row) => row.metric),
    ['js', 'css', 'image', 'font', 'animation'],
  );
  const js = checked.find((row) => row.id === 'light' && row.metric === 'js');
  assert.equal(js.actual, 900, "only the unit's own package counts, not React beside it");
  assert.equal(js.limit, 2048);
  assert.equal(js.limitFrom, 'declared');
  assert.equal(
    checked.find((row) => row.id === 'light' && row.metric === 'image').limitFrom,
    'ceiling',
  );
  assert.equal(
    checked.find((row) => row.id === 'warm' && row.metric === 'css').limit,
    CEILINGS.packs['color-scheme'].css,
  );
});

test('an over-budget unit gets one record per metric it breaks, each naming the asset that carries the most', () => {
  const over = variant('over', {
    budgets: { js: 30720, css: 10240 },
    stylesheet: {
      url: '/_portfolio/variant/over.0123456789ab.css',
      bytes: 60000,
      gzipBytes: 16000,
      sha256: 'x',
    },
  });
  const chunks = [
    chunk('big', { '@acme/over': 30000 }),
    chunk('small', { '@acme/over': 10000, next: 5000 }),
  ];
  const cases = ['read-only', 'owner'].flatMap((profile) =>
    ['1440x900', '390x844'].map((viewport) =>
      traceCase('over', { profile, viewport, attribution: { chunks, withoutMap: [] } }),
    ),
  );
  const { records, checked } = check([over], cases, {
    css: {
      [over.stylesheet.url]:
        "@import url('https://fonts.example.invalid/a.css') layer(x);\n.a { color: red }",
    },
  });
  assert.deepEqual(metrics(records), ['css', 'js', 'remote']);
  const js = records.find((record) => record.metric === 'js');
  assert.equal(js.route, '/');
  assert.equal(js.actual, 40000);
  assert.equal(js.threshold, 30720);
  assert.equal(js.asset, '/_next/static/chunks/big.js');
  assert.deepEqual(
    js.assets.map((asset) => [asset.asset, asset.amount]),
    [
      ['/_next/static/chunks/big.js', 30000],
      ['/_next/static/chunks/small.js', 10000],
    ],
  );
  assert.equal(
    checked.find((row) => row.metric === 'js').cases.length,
    4,
    'every case is in the report',
  );
  const css = records.find((record) => record.metric === 'css');
  assert.equal(css.asset, over.stylesheet.url);
  assert.equal(css.actual, 16000);
  assert.equal(css.threshold, 10240);
  const remote = records.find((record) => record.metric === 'remote');
  assert.equal(remote.asset, over.stylesheet.url);
  assert.match(remote.test, /https:\/\/fonts\.example\.invalid\/a\.css/);
});

test('the check never sums units, cases, or metrics into one total', () => {
  // Two light variants at 20 KB each: 40 KB together, over one light ceiling, but each fits.
  const a = variant('a');
  const b = variant('b');
  const cases = ['a', 'b'].flatMap((id) =>
    ['read-only', 'owner', 'read-only'].map((profile) =>
      traceCase(id, {
        profile,
        attribution: { chunks: [chunk(`${id}-main`, { [`@acme/${id}`]: 20000 })], withoutMap: [] },
      }),
    ),
  );
  const { records, checked } = check([a, b], cases);
  assert.deepEqual(records, []);
  for (const id of ['a', 'b']) {
    const js = checked.filter((row) => row.id === id && row.metric === 'js');
    assert.equal(js.length, 1, 'one row per route');
    assert.equal(js[0].actual, 20000, "a route's measure is its worst case, not their sum");
  }
  // A variant's CSS is its own stylesheet, never the platform's or a pack's beside it.
  const css = checked.find((row) => row.id === 'a' && row.metric === 'css');
  assert.deepEqual(css.assets, [{ asset: a.stylesheet.url, amount: 1000 }]);
  // Each of two routes is measured on its own.
  const routes = check(
    [a],
    [
      traceCase('a', {
        route: '/',
        attribution: { chunks: [chunk('x', { '@acme/a': 20000 })], withoutMap: [] },
      }),
      traceCase('a', {
        route: '/work',
        attribution: { chunks: [chunk('y', { '@acme/a': 20000 })], withoutMap: [] },
      }),
    ],
  );
  assert.deepEqual(routes.records, []);
  assert.deepEqual(
    routes.checked.filter((row) => row.metric === 'js').map((row) => [row.route, row.actual]),
    [
      ['/', 20000],
      ['/work', 20000],
    ],
  );
});

test('a declared budget over its ceiling is a record of its own', () => {
  const greedy = variant('greedy', { budgets: { js: CEILINGS.tiers.light.js + 1 } });
  const { records } = check([greedy], [traceCase('greedy')]);
  assert.equal(records.length, 1);
  assert.equal(records[0].metric, 'js');
  assert.equal(records[0].actual, CEILINGS.tiers.light.js + 1);
  assert.equal(records[0].threshold, CEILINGS.tiers.light.js);
  assert.match(records[0].test, /declares a js budget of \d+, over the light tier's ceiling/);
  const scheme = pack('color-scheme', 'loud', {
    budgets: { css: CEILINGS.packs['color-scheme'].css * 2 },
  });
  assert.match(check([scheme], []).records[0].test, /over the color-scheme axis's ceiling/);
});

/**
 * Each way a unit's stylesheet can name another host, written as CSS
 * source: what the check must find in it, raw and once registry generation
 * has compiled it. They resolve as a browser resolves them.
 */
const REMOTE_SPELLINGS = {
  'a backslash the URL parser reads as a slash': [
    '.a { background: url("/\\\\evil.example/a.png") }',
  ],
  'a tab, written as an escape, the URL parser strips': [
    '.a { background: url("/\\9/evil.example/a.png") }',
  ],
  'a newline, written as an escape, the URL parser strips': [
    '.a { background: url("/\\a/evil.example/a.png") }',
  ],
  'a raw tab the URL parser strips': ['.a { background: url("/\t/evil.example/a.png") }'],
  'a backslash, written as an escape': ['.a { background: url("/\\5c evil.example/a.png") }'],
  'an unquoted url() with an escaped scheme': [
    '.a { background: url(\\68ttps://evil.example/a.png) }',
  ],
  'the second URL in image-set(), after a url()': [
    '.a { background: image-set(url(./a.png) 1x, "https://evil.example/b.png" 2x) }',
  ],
  'the second URL in -webkit-image-set()': [
    '.a { background: -webkit-image-set("./a.png" 1x, "//evil.example/b.png" 2x) }',
  ],
  'a url() nested in image-set()': [
    '.a { background: image-set("./a.png" 1x, url(https://evil.example/c.png) 2x) }',
  ],
  'src()': ['.a { background: src("https://evil.example/d.png") }'],
  'an escaped function name': ['.a { background: u\\72l(https://evil.example/e.png) }'],
};

/** What a unit's stylesheet may name: its own files, a data: URL, a fragment. */
const LOCAL_CSS = [
  '.a { background: url(./local.png) }',
  '.b { background: url("/_portfolio/asset/x.png") }',
  '.c { background: url(data:image/png;base64,AA==) }',
  '.d { background: url( "data:image/svg+xml,%3Csvg%3E" ) }',
  '.e { mask: url(#clip) }',
  '.f { background: image-set("./a.png" 1x, url(./b.png) 2x) }',
  '/* @import url(https://commented.example/out.css); */',
].join('\n');

/** `css` as registry generation compiles it into a variant's stylesheet, or its problems. */
function compiledStylesheet(t, css) {
  const dir = mkdtempSync(path.join(tmpdir(), 'budgets-css-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, 'styles.css'), css);
  for (const file of ['local.png', 'a.png', 'b.png']) writeFileSync(path.join(dir, file), 'png');
  const compiler = pathToFileURL(
    path.join(REPO_ROOT, 'packages', 'variant-contract', 'src', 'node', 'variant-stylesheet.ts'),
  ).href;
  const run = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `const { compileVariantStylesheet } = await import(${JSON.stringify(compiler)});
       const dir = ${JSON.stringify(dir)};
       const result = compileVariantStylesheet({ id: 'acme', source: { dir, file: dir + '/styles.css' }, layerOrder: '@layer variant-layout;', layer: 'variant-layout' });
       process.stdout.write(JSON.stringify(result.ok ? { css: new TextDecoder().decode(result.stylesheet.bytes) } : { problems: result.problems.map((problem) => problem.message) }));`,
    ],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test("a unit stylesheet that reaches another host fails, however it spells the URL, raw and compiled; its own files and data: URLs don't", (t) => {
  for (const [spelling, [css]] of Object.entries(REMOTE_SPELLINGS)) {
    const found = remoteReferences(css);
    assert.equal(found.length, 1, `${spelling}: ${JSON.stringify(found)}`);
    assert.equal(new URL(found[0], 'https://unit.invalid/').hostname, 'evil.example', spelling);
    const compiled = compiledStylesheet(t, `[data-variant='acme'] ${css}`);
    if (compiled.css !== undefined) {
      assert.equal(remoteReferences(compiled.css).length, 1, `${spelling}, compiled`);
    } else {
      assert.ok(compiled.problems.length > 0, `${spelling}: compiles or is refused`);
    }
  }
  assert.deepEqual(remoteReferences(LOCAL_CSS), []);
  const local = compiledStylesheet(
    t,
    `[data-variant='acme'] { }\n${LOCAL_CSS.replace(/^\./gm, "[data-variant='acme'] .")}`,
  );
  assert.ok(local.css, JSON.stringify(local.problems));
  assert.deepEqual(remoteReferences(local.css), []);
  // @import, with and without url(), and every remote reference in a file, once each.
  assert.deepEqual(
    remoteReferences(
      [
        "@import url('https://a.example/x.css');",
        '@import "//b.example/y.css" layer(v);',
        '.a { background: url(http://c.example/z.png), url(http://c.example/z.png) }',
      ].join('\n'),
    ),
    ['https://a.example/x.css', '//b.example/y.css', 'http://c.example/z.png'],
  );
  const scheme = pack('color-scheme', 'warm');
  const { records } = check([scheme], [], {
    css: { [scheme.stylesheet.url]: '.x { background: url(https://cdn.example/t.png) }' },
  });
  assert.deepEqual(metrics(records), ['remote']);
  assert.equal(records[0].unit, scheme);
});

test('a /_portfolio/ file a traced page loads that ASSET_MANIFEST omits is a record', () => {
  const a = variant('a', {
    images: [{ url: '/_portfolio/asset/listed.png', bytes: 10, sha256: 'x' }],
  });
  const request = (pathname) => ({ url: `${ORIGIN}${pathname}` });
  const { records } = check(
    [a],
    [
      traceCase('a', {
        requests: [
          request(a.stylesheet.url),
          request('/_portfolio/asset/listed.png'),
          request('/_portfolio/pack/_platform.0123456789ab.css'),
          request('/_portfolio/asset/omitted.png'),
          request('/_next/static/chunks/main.js'),
          { url: 'https://elsewhere.example/_portfolio/asset/remote.png' },
        ],
      }),
    ],
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].metric, 'unlisted');
  assert.equal(records[0].asset, '/_portfolio/asset/omitted.png');
  assert.equal(records[0].unit, a);
});

test('a new unit is checked by its tier or axis with no change to the check', () => {
  const heavy = variant('newcomer', { performanceTier: 'heavy' });
  const big = 60000;
  const { records, checked } = check(
    [heavy],
    [
      traceCase('newcomer', {
        attribution: { chunks: [chunk('n', { '@acme/newcomer': big })], withoutMap: [] },
      }),
    ],
  );
  assert.deepEqual(records, [], 'heavy allows what light would not');
  assert.equal(checked.find((row) => row.metric === 'js').limit, CEILINGS.tiers.heavy.js);
  const light = check(
    [variant('newcomer')],
    [
      traceCase('newcomer', {
        attribution: { chunks: [chunk('n', { '@acme/newcomer': big })], withoutMap: [] },
      }),
    ],
  );
  assert.deepEqual(metrics(light.records), ['js']);
  // An axis runtime-budgets.json has no row for can't pass unnoticed.
  const odd = pack('motion-profile', 'odd');
  assert.deepEqual(metrics(check([odd], []).records), ['ceiling']);
});

test("a variant the trace didn't render, or rendered without source maps, is a record", () => {
  const a = variant('a');
  const untraced = check([a], []).records;
  assert.deepEqual(metrics(untraced), ['trace']);
  assert.match(untraced[0].test, /no trace case renders variant a/);
  // Stylesheets ship without maps, and ASSET_MANIFEST has their bytes; a script without one is unknown JS.
  const stylesheets = [
    `${ORIGIN}${a.stylesheet.url}`,
    `${ORIGIN}/_portfolio/pack/_platform.0123456789ab.css`,
  ];
  assert.deepEqual(
    check([a], [traceCase('a', { attribution: { chunks: [], withoutMap: stylesheets } })]).records,
    [],
  );
  const { records } = check(
    [a],
    [
      traceCase('a', {
        attribution: {
          chunks: [],
          withoutMap: [...stylesheets, `${ORIGIN}/_next/static/chunks/x.js`],
        },
      }),
    ],
  );
  assert.deepEqual(metrics(records), ['trace']);
  assert.match(records[0].test, /1 script\(s\) had no source map/);
  assert.equal(records[0].asset, '/_next/static/chunks/x.js');
});

test("an enhancement's chunks count against enhancement, not js, with everything in them, and one no chunk holds is a record", () => {
  const medium = variant('medium', {
    performanceTier: 'medium',
    budgets: { js: 4096, enhancement: 16384 },
    enhancements: [{ id: 'glint', export: './enhancements/glint', requires: [] }],
  });
  const glint = {
    path: '/_next/static/chunks/glint.js',
    modules: [
      {
        source: 'packages/acme/medium/src/enhancements/glint.tsx',
        package: '@acme/medium',
        gzipBytes: 3000,
      },
      { source: 'packages/acme/medium/src/shared.ts', package: '@acme/medium', gzipBytes: 2000 },
      { source: 'packages/kit/src/enhancement.ts', package: '@portfolio/kit', gzipBytes: 9000 },
      {
        source: 'node_modules/three/build/three.module.js',
        package: 'three',
        gzipBytes: 150000,
      },
    ],
  };
  const entries = { medium: { glint: './src/enhancements/glint.tsx' } };
  const cases = [
    traceCase('medium', {
      attribution: {
        chunks: [chunk('main', { '@acme/medium': 1000 }), chunk('glint', { '@acme/medium': 5000 })],
        withoutMap: [],
      },
    }),
  ];
  const { records, checked } = check([medium], cases, { chunks: [glint], entries });
  assert.equal(
    checked.find((row) => row.metric === 'js').actual,
    1000,
    'its chunk is left out of js',
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].metric, 'enhancement');
  // Its own 5000, the kit's 9000, and three.js's 150000: the whole chunk it loads, not its package alone.
  assert.equal(records[0].actual, 164000);
  assert.equal(records[0].asset, '/_next/static/chunks/glint.js');
  assert.match(
    records[0].test,
    /in enhancement glint is 164000, over its declared budget of 16384/,
  );
  const missing = check([medium], cases, { chunks: [], entries });
  assert.ok(
    missing.records.some((record) =>
      /no chunk of the build holds variant medium's enhancement glint/.test(record.test),
    ),
  );
});

test("animation counts each loop, timer, and infinite animation, and a pack's from its stylesheet", () => {
  const light = variant('light');
  const probe = {
    frames: { loops: [{ site: 'shader.tsx:10', concurrent: 1 }], loopCount: 1 },
    timers: { intervals: [{ site: 'clock.ts:3' }], timeouts: [], recurring: 1 },
    animations: { infinite: [{ kind: 'css spin', target: 'div.spinner' }] },
  };
  const { records } = check([light], [traceCase('light', { probe })]);
  assert.equal(records.length, 1);
  assert.equal(records[0].metric, 'animation');
  assert.equal(records[0].actual, 3);
  assert.equal(records[0].threshold, 0);
  assert.deepEqual(records[0].assets.map((asset) => asset.asset).sort(), [
    'css spin on div.spinner',
    'frame loop at shader.tsx:10',
    'interval at clock.ts:3',
  ]);
  assert.deepEqual(
    infiniteDeclarations(
      '.a { animation: spin 1s linear infinite } .b { animation-iteration-count: 3 } .c{animation-iteration-count:infinite}',
    ),
    ['animation: spin 1s linear infinite', 'animation-iteration-count:infinite'],
  );
  const language = pack('design-language', 'busy');
  const busy = check([language], [], {
    css: {
      [language.stylesheet.url]: '.a { animation: a 1s infinite } .b { animation: b 2s infinite }',
    },
  });
  assert.deepEqual(metrics(busy.records), ['animation']);
  assert.equal(busy.records[0].actual, 2);
  assert.equal(busy.records[0].threshold, CEILINGS.packs['design-language'].animation);
});

test('R3: an infinite loop counts in a stylesheet, and a finite reveal or a scroll-driven animation never does', () => {
  const count = (css) => infiniteDeclarations(css).length;
  // A loop counts, inside an at-rule or a nested rule too.
  assert.deepEqual(
    infiniteDeclarations(
      '.sky { animation: drift var(--motion-ambient) linear infinite; animation-play-state: var(--motion-ambient-state) }',
    ),
    ['animation: drift var(--motion-ambient) linear infinite'],
  );
  assert.equal(
    count(
      '@media (min-width: 40em) { .bead { animation-name: travel; animation-iteration-count: infinite } }',
    ),
    1,
  );
  assert.equal(count('.a { animation: spin 1s linear infinite; &:hover { color: red } }'), 1);
  assert.equal(count('.a { color: red; & .b { animation: spin 1s infinite } }'), 1);
  // A reveal plays once or a few times, and ends; over 1000 times it doesn't (K-4 M3).
  assert.equal(count('.card { animation: reveal 800ms both }'), 0);
  assert.equal(count('.note { animation: reveal 800ms 3 }'), 0);
  assert.equal(count('.ticker { animation: slide 2s linear 100000 }'), 1);
  assert.equal(count('.ticker { animation-iteration-count: 1001 }'), 1);
  // Any timeline but a scroll's, a view's, a named one, or none runs on the clock (the review's M1).
  for (const timeline of ['auto', 'initial', 'unset', 'revert', 'var(--t)'])
    assert.equal(
      count(`.a { animation: spin 1s infinite; animation-timeline: ${timeline} }`),
      1,
      timeline,
    );
  // A list counts the items left on the clock.
  assert.equal(
    count(
      '@supports (animation-timeline: scroll()) { .a { animation: spin 1s infinite, glow 2s infinite; animation-timeline: auto, scroll() } }',
    ),
    1,
  );
  // Scroll-driven, under the guard: off the clock (the review's L2).
  const guarded = (rule) => `@supports (animation-timeline: scroll()) { ${rule} }`;
  assert.equal(
    count(guarded('.bar { animation: grow linear infinite; animation-timeline: scroll() }')),
    0,
  );
  assert.equal(
    count(guarded('.figure { animation-iteration-count: infinite; animation-timeline: view() }')),
    0,
  );
  assert.equal(
    count(guarded('.named { animation-timeline: --gallery; animation-iteration-count: infinite }')),
    0,
  );
  assert.equal(count(guarded('.off { animation: spin 1s infinite; animation-timeline: none }')), 0);
  // A guard that holds where the timeline doesn't, or everywhere, is no guard (K-4 round 2).
  const loop = '.a { animation: spin 1s infinite; animation-timeline: scroll() }';
  assert.equal(count(`@supports not (animation-timeline: scroll()) { ${loop} }`), 1);
  assert.equal(count(`@supports (animation-timeline: scroll()) or (display: grid) { ${loop} }`), 1);
  assert.equal(
    count(`@supports (animation-timeline: scroll()) { @supports not (display: grid) { ${loop} } }`),
    1,
  );
  assert.equal(
    count(`@supports (animation-timeline: scroll()) and (display: grid) { ${loop} }`),
    0,
  );
  assert.equal(
    count(`@supports (animation-timeline: scroll()) { @media (min-width: 1px) { ${loop} } }`),
    0,
  );
  // Unguarded, a browser without scroll timelines drops the timeline and runs it on the clock.
  assert.equal(count('.bar { animation: grow linear infinite; animation-timeline: scroll() }'), 1);
  // A shorthand after the timeline resets it to auto, so this loop runs on the clock.
  assert.equal(
    count(guarded('.reset { animation-timeline: scroll(); animation: spin 1s infinite }')),
    1,
  );
  assert.equal(count('@keyframes drift { from { opacity: 1 } to { opacity: 0.6 } }'), 0);
  // The trace's count for a variant comes from what ran: the probe leaves
  // finite and scroll-driven animations out (tests/harness/trace/probe.test.mjs),
  // and recurring timers and frame loops count.
  const probe = {
    frames: { loops: [], loopCount: 0 },
    timers: {
      intervals: [{ site: 'clock.ts:3' }],
      timeouts: [],
      // K-4 M3: idle callbacks and scheduler tasks that recur count as timers.
      idle: [{ site: 'idle.ts:4', concurrent: 1 }],
      tasks: [{ site: 'task.ts:5', concurrent: 1 }],
      recurring: 3,
    },
    animations: {
      infinite: [{ kind: 'css drift', target: 'div.sky' }],
      // And an animation that restarts itself on finish.
      restarting: [{ site: 'loop.ts:6', concurrent: 1 }],
      // And a CSS animation a handler starts again, by its recurring start events.
      cssRestarts: [{ type: 'animationstart', target: 'div.ticker', events: 3 }],
    },
  };
  const counted = check([variant('ambient')], [traceCase('ambient', { probe })]);
  assert.equal(counted.records[0].actual, 6);
  assert.deepEqual(counted.records[0].assets.map((asset) => asset.asset).sort(), [
    'css drift on div.sky',
    'interval at clock.ts:3',
    'recurring idle callback at idle.ts:4',
    'recurring scheduler task at task.ts:5',
    'restarting animation at loop.ts:6',
    'restarting css (animationstart) on div.ticker',
  ]);
});

test('each record is a valid 1.1 failure record with a repro command and its artifacts', async () => {
  const validate = await loadValidator();
  const over = variant('over', { budgets: { css: 10 } });
  const scheme = pack('typography', 'big', { budgets: { css: 10 } });
  const { records } = check(
    [over, scheme],
    [
      traceCase('over', {
        attribution: { chunks: [chunk('x', { '@acme/over': 40000 })], withoutMap: [] },
      }),
    ],
  );
  assert.deepEqual(metrics(records), ['css', 'css', 'js']);
  for (const fixtures of [undefined, '1', 'over']) {
    for (const record of records) {
      const fields = failureFields(record, {
        gate: 'budgets',
        reproCommand: reproCommand(fixtures),
        artifacts: ['budgets/budget-report.json', 'trace/trace-report.json'],
      });
      const clean = Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value !== undefined),
      );
      assert.equal(validate(clean), true, JSON.stringify(validate.errors));
      assert.equal(clean.metric, record.metric);
      assert.ok(clean.asset && clean.reproCommand);
    }
  }
  const js = failureFields(
    records.find((record) => record.metric === 'js'),
    { gate: 'budgets', reproCommand: reproCommand('over'), artifacts: [] },
  );
  assert.equal(js.variant, 'over');
  assert.equal(js.route, '/');
  assert.equal(js.viewport, '1440x900');
  assert.equal(js.profile, 'read-only');
  const big = failureFields(
    records.find((record) => record.unit === scheme),
    { gate: 'budgets', reproCommand: 'pnpm check:budgets', artifacts: [] },
  );
  assert.equal(big.pack, 'big');
  assert.equal(big.axis, 'typography');
  assert.equal(big.variant, undefined);
  assert.match(
    reproCommand('over'),
    /^BUDGET_FIXTURES=over [A-Z_]+=1 pnpm build && BUDGET_FIXTURES=over pnpm test:trace && pnpm check:budgets$/,
  );
  assert.deepEqual(reportRecord(records[0]).unit, {
    kind: records[0].unit.kind,
    id: records[0].unit.id,
    package: records[0].unit.packageName,
  });
});

test("CI's proof of the over-budget fixture wants one record per metric, each naming its asset, and each a valid failure record with its route", async () => {
  const validate = await loadValidator();
  const id = 'fixture-over-budget';
  const over = variant(id, {
    budgets: { js: 30720, css: 10240 },
    stylesheet: {
      url: `/_portfolio/variant/${id}.0123456789ab.css`,
      bytes: 60000,
      gzipBytes: 18000,
      sha256: 'x',
    },
  });
  const fallback = variant('fallback');
  const cases = [
    traceCase(id, {
      requests: [{ url: `${ORIGIN}${over.stylesheet.url}` }],
      attribution: { chunks: [chunk('0abc~x', { [over.packageName]: 41000 })], withoutMap: [] },
    }),
    traceCase('fallback'),
  ];
  const { records } = check([over, fallback], cases, {
    css: {
      [over.stylesheet.url]:
        "@import url('https://fonts.example.invalid/fixture-over-budget.css') layer(variant-layout);",
    },
  });
  const report = (list) => ({ records: list.map(reportRecord) });
  assert.deepEqual(Object.keys(OVER_BUDGET_METRICS), ['js', 'css', 'remote']);
  assert.deepEqual(metrics(records), ['css', 'js', 'remote']);
  assert.deepEqual(overBudgetProblems(report(records), validate), []);
  // Every record has its route: the stylesheet's from the case that requested it.
  for (const record of records) assert.equal(record.route, '/', record.metric);
  const css = records.find((record) => record.metric === 'css');
  assert.deepEqual(css.requestedOn, [{ route: '/', profile: 'read-only', viewport: '1440x900' }]);

  const without = (metric) => records.filter((record) => record.metric !== metric);
  assert.deepEqual(overBudgetProblems(report(without('css')), validate), [
    '0 css record(s) for fixture-over-budget, not 1',
  ]);
  const js = records.find((record) => record.metric === 'js');
  assert.deepEqual(overBudgetProblems(report([...records, js]), validate), [
    '2 js record(s) for fixture-over-budget, not 1',
  ]);
  assert.match(
    overBudgetProblems(report([...without('js'), { ...js, asset: 'total' }]), validate)[0],
    /names total, not the asset/,
  );
  assert.match(
    overBudgetProblems(
      report([...records, { ...js, metric: 'unlisted', asset: '/_portfolio/asset/x.png' }]),
      validate,
    )[0],
    /unexpected unlisted record/,
  );
  // A CSS record with no route, as a check that dropped it would write, fails the proof.
  const routeless = { ...css, route: undefined, profile: undefined, viewport: undefined };
  assert.deepEqual(overBudgetProblems(report([...without('css'), routeless]), validate), [
    'the css record has no route',
  ]);
  // So does one the schema refuses.
  assert.match(
    overBudgetProblems(report([...without('css'), { ...css, viewport: '' }]), validate).join(),
    /the css record isn't a valid failure record/,
  );
});

/** A temporary directory, removed after the test. */
function scratch(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'budgets-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("an enhancement's import counts with every chunk its async group loads, a split library's included", () => {
  const medium = variant('medium', {
    performanceTier: 'medium',
    budgets: { js: 4096, enhancement: 16384 },
    enhancements: [{ id: 'glint', export: './enhancements/glint', requires: [] }],
  });
  const entry = {
    path: '/_next/static/chunks/glint.js',
    loadedWith: ['/_next/static/chunks/three.js'],
    modules: [
      {
        source: 'packages/acme/medium/src/enhancements/glint.tsx',
        package: '@acme/medium',
        gzipBytes: 5000,
      },
    ],
  };
  // The library the entry imports, split by the bundler into a chunk of its own.
  const three = {
    path: '/_next/static/chunks/three.js',
    modules: [
      { source: 'node_modules/three/build/three.module.js', package: 'three', gzipBytes: 150000 },
    ],
  };
  // A chunk nothing loads with it counts for nothing.
  const unrelated = {
    path: '/_next/static/chunks/other.js',
    modules: [{ source: 'node_modules/other/index.js', package: 'other', gzipBytes: 70000 }],
  };
  const entries = { medium: { glint: './src/enhancements/glint.tsx' } };
  const { records } = check([medium], [traceCase('medium')], {
    chunks: [entry, three, unrelated],
    entries,
  });
  const [record] = records.filter((one) => one.metric === 'enhancement');
  assert.equal(record.actual, 155000);
  assert.equal(record.asset, '/_next/static/chunks/three.js', 'the chunk carrying the most');
});

test("the build's loaders name each async group, and a group's chunk with no map counts whole", (t) => {
  assert.deepEqual(
    asyncGroups(
      'e.v(t=>Promise.all(["static/chunks/a.js","static/chunks/b.js"].map(t=>e.l(t))).then(()=>t(1)))' +
        'x.v(t=>Promise.all([ "static/chunks/c.js" ].map(t=>e.l(t))))',
    ),
    [['/_next/static/chunks/a.js', '/_next/static/chunks/b.js'], ['/_next/static/chunks/c.js']],
  );
  const web = scratch(t);
  const staticDir = path.join(web, '.next', 'static');
  mkdirSync(path.join(staticDir, 'chunks'), { recursive: true });
  const write = (name, code, sources) => {
    writeFileSync(
      path.join(staticDir, 'chunks', name),
      sources ? `${code}\n//# sourceMappingURL=${name}.map` : code,
    );
    if (sources) {
      writeFileSync(
        path.join(staticDir, 'chunks', `${name}.map`),
        JSON.stringify({ version: 3, sources, mappings: 'AAAA' }),
      );
    }
  };
  write(
    'route.js',
    'e.v(t=>Promise.all(["static/chunks/glint.js","static/chunks/shared.js","static/chunks/raw.js"].map(t=>e.l(t))))',
    ['turbopack:///[project]/node_modules/@acme/medium/src/index.tsx'],
  );
  write('glint.js', 'console.log("glint");', [
    'turbopack:///[project]/node_modules/@acme/medium/src/enhancements/glint.tsx',
  ]);
  write('shared.js', 'console.log("three");', [
    'turbopack:///[project]/node_modules/three/build/three.module.js',
  ]);
  write('raw.js', 'console.log("no map at all, so the check can only count it whole");');
  write('lonely.js', 'console.log("lonely");', [
    'turbopack:///[project]/node_modules/lonely/index.js',
  ]);
  const chunks = buildChunks(['./src/enhancements/glint.tsx'], staticDir);
  assert.deepEqual(chunks.map((one) => one.path).sort(), [
    '/_next/static/chunks/glint.js',
    '/_next/static/chunks/raw.js',
    '/_next/static/chunks/shared.js',
  ]);
  const glint = chunks.find((one) => one.path.endsWith('/glint.js'));
  assert.deepEqual(glint.loadedWith.sort(), [
    '/_next/static/chunks/raw.js',
    '/_next/static/chunks/shared.js',
  ]);
  const raw = chunks.find((one) => one.path.endsWith('/raw.js'));
  assert.equal(raw.modules.length, 1);
  assert.equal(raw.modules[0].package, null);
  assert.ok(raw.gzipBytes > 0);
});

test("the check finds an enhancement's chunk in the build through its source map, by its package's export", (t) => {
  const web = scratch(t);
  const unit = variant('medium', {
    packageName: '@acme/medium',
    enhancements: [
      { id: 'glint', export: './enhancements/glint', requires: [] },
      { id: 'gone', export: './enhancements/gone', requires: [] },
    ],
  });
  mkdirSync(path.join(web, 'node_modules', '@acme', 'medium'), { recursive: true });
  writeFileSync(
    path.join(web, 'node_modules', '@acme', 'medium', 'package.json'),
    JSON.stringify({
      exports: { './enhancements/glint': { import: './src/enhancements/glint.tsx' } },
    }),
  );
  const entries = enhancementEntries(unit, web);
  assert.deepEqual(entries, { glint: './src/enhancements/glint.tsx', gone: null });

  const staticDir = path.join(web, '.next', 'static');
  mkdirSync(path.join(staticDir, 'chunks'), { recursive: true });
  const source = 'turbopack:///[project]/node_modules/@acme/medium/src/enhancements/glint.tsx';
  writeFileSync(
    path.join(staticDir, 'chunks', 'glint.js'),
    'console.log("glint");\n//# sourceMappingURL=glint.js.map',
  );
  writeFileSync(
    path.join(staticDir, 'chunks', 'glint.js.map'),
    JSON.stringify({ version: 3, sources: [source], mappings: 'AAAA' }),
  );
  writeFileSync(
    path.join(staticDir, 'chunks', 'other.js'),
    'console.log("other");\n//# sourceMappingURL=other.js.map',
  );
  writeFileSync(
    path.join(staticDir, 'chunks', 'other.js.map'),
    JSON.stringify({
      version: 3,
      sources: ['turbopack:///[project]/node_modules/@acme/medium/src/index.tsx'],
      mappings: 'AAAA',
    }),
  );
  writeFileSync(path.join(staticDir, 'chunks', 'nomap.js'), 'console.log("glint");');
  const chunks = buildChunks(Object.values(entries), staticDir);
  assert.deepEqual(
    chunks.map((one) => one.path),
    ['/_next/static/chunks/glint.js'],
  );
  assert.equal(chunks[0].modules[0].package, '@acme/medium');
  const [glint] = check([unit], [traceCase('medium')], {
    chunks,
    entries: { medium: entries },
  }).checked.filter((row) => row.metric === 'enhancement');
  assert.equal(glint.enhancement, 'glint');
  assert.ok(glint.actual > 0);
});

test("a chunk holding an enhancement that no loader's group names is a record: a changed loader fails closed", (t) => {
  const web = scratch(t);
  const staticDir = path.join(web, '.next', 'static');
  mkdirSync(path.join(staticDir, 'chunks'), { recursive: true });
  writeFileSync(
    path.join(staticDir, 'chunks', 'glint.js'),
    'console.log("glint");\n//# sourceMappingURL=glint.js.map',
  );
  writeFileSync(
    path.join(staticDir, 'chunks', 'glint.js.map'),
    JSON.stringify({
      version: 3,
      sources: ['turbopack:///[project]/node_modules/@acme/medium/src/enhancements/glint.tsx'],
      mappings: 'AAAA',
    }),
  );
  // The loader, in a spelling asyncGroups() doesn't read.
  writeFileSync(
    path.join(staticDir, 'chunks', 'route.js'),
    'e.v(t=>loadAll(["static/chunks/glint.js","static/chunks/three.js"]))',
  );
  const chunks = buildChunks(['./src/enhancements/glint.tsx'], staticDir);
  assert.equal(chunks.find((one) => one.path.endsWith('/glint.js'))?.ungrouped, true);
  const medium = variant('medium', {
    enhancements: [{ id: 'glint', export: './enhancements/glint', requires: [] }],
  });
  const { records } = check([medium], [traceCase('medium')], {
    chunks,
    entries: { medium: { glint: './src/enhancements/glint.tsx' } },
  });
  const ungrouped = records.filter((record) => /no async group/.test(record.test));
  assert.equal(ungrouped.length, 1);
  assert.equal(ungrouped[0].asset, '/_next/static/chunks/glint.js');
  assert.match(ungrouped[0].test, /variant medium's enhancement glint/);
  // A loader it reads names the group, and there's no such record.
  writeFileSync(
    path.join(staticDir, 'chunks', 'route.js'),
    'e.v(t=>Promise.all(["static/chunks/glint.js"].map(t=>e.l(t))))',
  );
  const grouped = buildChunks(['./src/enhancements/glint.tsx'], staticDir);
  assert.equal(grouped[0].ungrouped, undefined);
  assert.ok(
    !check([medium], [traceCase('medium')], {
      chunks: grouped,
      entries: { medium: { glint: './src/enhancements/glint.tsx' } },
    }).records.some((record) => /no async group/.test(record.test)),
  );
});

test("a chunk an enhancement's group shares with the page's static chunks counts in the route's js, once, and not in the enhancement", () => {
  const medium = variant('medium', {
    performanceTier: 'medium',
    enhancements: [{ id: 'glint', export: './enhancements/glint', requires: [] }],
  });
  const glint = {
    path: '/_next/static/chunks/glint.js',
    loadedWith: ['/_next/static/chunks/three.js', '/_next/static/chunks/main.js'],
    modules: [
      {
        source: 'packages/acme/medium/src/enhancements/glint.tsx',
        package: '@acme/medium',
        gzipBytes: 5000,
      },
    ],
  };
  const three = {
    path: '/_next/static/chunks/three.js',
    modules: [
      { source: 'node_modules/three/three.module.js', package: 'three', gzipBytes: 150000 },
    ],
  };
  // The page's own chunk, which its HTML loads, and the group lists too.
  const main = {
    path: '/_next/static/chunks/main.js',
    modules: [
      { source: 'packages/acme/medium/src/index.tsx', package: '@acme/medium', gzipBytes: 2000 },
    ],
  };
  const cases = [
    traceCase('medium', {
      attribution: {
        chunks: [chunk('main', { '@acme/medium': 2000 }), chunk('glint', { '@acme/medium': 5000 })],
        withoutMap: [],
      },
    }),
  ];
  const run = (statics) =>
    check([medium], cases, {
      chunks: [glint, three, main],
      entries: { medium: { glint: './src/enhancements/glint.tsx' } },
      statics: { medium: statics },
    }).checked;
  const shared = run(new Set(['/_next/static/chunks/main.js']));
  // The page's own 2000 stay in its js, and the enhancement is its entry and three.js alone.
  assert.equal(shared.find((row) => row.metric === 'js').actual, 2000);
  assert.equal(shared.find((row) => row.metric === 'enhancement').actual, 155000);
  // Unknown statics, as before: the group's main.js is the enhancement's, and drops out of js.
  const none = run(new Set());
  assert.equal(none.find((row) => row.metric === 'js').actual, 0);
  assert.equal(none.find((row) => row.metric === 'enhancement').actual, 157000);
  // The build without a manifest for the page is a record of its own.
  const { records } = check([medium], cases, {
    chunks: [glint, three, main],
    entries: { medium: { glint: './src/enhancements/glint.tsx' } },
    statics: { medium: null },
  });
  assert.ok(records.some((record) => /names no client reference manifest/.test(record.test)));
});

test("a variant's static chunks are its experience segment's entries in the build's client reference manifest, and the root's", (t) => {
  const web = scratch(t);
  const segment = path.join(
    web,
    '.next',
    'server',
    'app',
    '(site)',
    '_experience',
    'medium',
    '[[...route]]',
  );
  mkdirSync(segment, { recursive: true });
  const manifest = {
    moduleLoading: { prefix: '' },
    entryJSFiles: {
      '[project]/apps/web/src/app/(site)/layout': ['static/chunks/layout.js'],
      '[project]/apps/web/src/app/(site)/%5Fexperience/medium/[[...route]]/page': [
        'static/chunks/layout.js',
        'static/chunks/page.js',
      ],
    },
  };
  writeFileSync(
    path.join(segment, 'page_client-reference-manifest.js'),
    `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\nglobalThis.__RSC_MANIFEST["/(site)/_experience/medium/[[...route]]/page"] = ${JSON.stringify(manifest)};`,
  );
  writeFileSync(
    path.join(web, '.next', 'build-manifest.json'),
    JSON.stringify({ rootMainFiles: ['static/chunks/turbopack.js'], polyfillFiles: [] }),
  );
  assert.deepEqual([...staticChunks('medium', web)].sort(), [
    '/_next/static/chunks/layout.js',
    '/_next/static/chunks/page.js',
    '/_next/static/chunks/turbopack.js',
  ]);
  assert.equal(staticChunks('other', web), null);
});

test("a variant's catalog stills count toward its image budget, so stills alone can break it (#6)", () => {
  const still = (width, bytes) => ({
    url: `/_portfolio/still/stilled.${String(width).padStart(12, '0')}.webp`,
    bytes,
    width,
    height: Math.round(width * 0.625),
  });
  const stilled = variant('stilled', {
    budgets: { image: 100000 },
    images: [],
    stills: [still(1440, 70000), still(720, 40000)],
  });
  const { records, checked } = check([stilled], [traceCase('stilled')]);
  assert.deepEqual(metrics(records), ['image']);
  const [image] = records;
  assert.equal(image.actual, 110000);
  assert.equal(image.threshold, 100000);
  assert.equal(image.asset, stilled.stills[0].url);
  assert.equal(checked.find((row) => row.metric === 'image').actual, 110000);
});

/** A typography that ships a Latin and a Cyrillic face, and the stylesheet the compiler writes for it. */
function fontTypography(fields = {}) {
  const font = (subset, bytes) => ({
    url: `/_portfolio/font/acme-type.${subset.padEnd(12, '0').slice(0, 12)}.woff2`,
    bytes,
    sha256: 'x',
  });
  const latin = font('a1a1a1', 30000);
  const cyrillic = font('c2c2c2', 20000);
  const unit = pack('typography', 'acme-type', { fonts: [latin, cyrillic], ...fields });
  const css = [
    '@layer typography {',
    '  @font-face {',
    '    font-family: "acme-type Text";',
    `    src: url("${latin.url}") format("woff2");`,
    '    font-weight: 400;',
    '    unicode-range: U+0000-00FF, U+0131, U+2000-206F;',
    '  }',
    '  @font-face {',
    '    font-family: "acme-type Text";',
    `    src: url("${cyrillic.url}") format("woff2");`,
    '    font-weight: 400;',
    '    unicode-range: U+0301, U+0400-045F, U+0490-0491;',
    '  }',
    '  @font-face {',
    '    font-family: "acme-type Text fallback";',
    '    src: local("Arial");',
    '    size-adjust: 104.00%;',
    '  }',
    '}',
  ].join('\n');
  return { unit, css: { [unit.stylesheet.url]: css }, latin, cyrillic };
}

test("fontFaces reads each webfont face's URL and unicode-range, and skips a local() fallback", () => {
  const { css, unit, latin, cyrillic } = fontTypography();
  assert.deepEqual(fontFaces(css[unit.stylesheet.url]), [
    {
      url: latin.url,
      ranges: [
        [0, 0xff],
        [0x131, 0x131],
        [0x2000, 0x206f],
      ],
    },
    {
      url: cyrillic.url,
      ranges: [
        [0x301, 0x301],
        [0x400, 0x45f],
        [0x490, 0x491],
      ],
    },
  ]);
  assert.deepEqual(fontFaces('@font-face { src: url(/f.woff2); }'), [
    { url: '/f.woff2', ranges: null },
  ]);
});

test("a typography's sample page counts its Latin faces when the trace has no text under it", () => {
  const { unit, css, latin } = fontTypography();
  const { records, samples, checked } = check([unit], [], { css });
  assert.deepEqual(records, []);
  assert.deepEqual(samples, [
    {
      kind: 'typography',
      id: 'acme-type',
      metric: 'font',
      basis: 'latin',
      route: null,
      actual: 30000,
      limit: CEILINGS.packs.typography.font,
      limitFrom: 'ceiling',
      assets: [{ asset: latin.url, amount: 30000 }],
    },
  ]);
  // The unit's own font line still counts every file it ships, reported and not gated (R4).
  const total = checked.find((row) => row.metric === 'font');
  assert.equal(total.actual, 50000);
  assert.equal(total.gated, false);
  assert.match(
    checkedLine(total),
    /^\[budgets\] info typography acme-type font shipped in all, reported: 48\.8 KB of 100\.0 KB/,
  );
  assert.match(
    sampleLine(samples[0]),
    /^\[budgets\] ok {3}typography acme-type font on a sample page \(estimated as its Latin faces, 1 file\): 29\.3 KB of 100\.0 KB \(ceiling\)$/,
  );
});

test("a traced page under the typography counts the faces its text's code points fall in, the worst page's", () => {
  const { unit, css, latin, cyrillic } = fontTypography();
  const under = (route, text) =>
    traceCase('light', {
      route,
      text,
      requests: [{ url: `${ORIGIN}${unit.stylesheet.url}`, kind: 'stylesheet' }],
    });
  const { samples } = check(
    [unit],
    [
      under('/', 'Hello, world'),
      under('/ru', 'Привет, мир'),
      // A page that didn't render under it, and one that recorded no text, don't count.
      traceCase('light', { route: '/other', text: 'Привет' }),
      traceCase('light', { route: '/untexted', requests: under('/', '').requests }),
    ],
    { css },
  );
  assert.equal(samples.length, 1);
  assert.equal(samples[0].basis, 'text');
  assert.equal(samples[0].route, '/ru');
  assert.equal(samples[0].actual, 50000, 'Cyrillic letters and the Latin comma and space');
  assert.deepEqual(
    samples[0].assets.map(({ asset }) => asset),
    [latin.url, cyrillic.url],
  );
  assert.match(
    sampleLine(samples[0]),
    /\(estimated by the text of \/ru, 2 files\): 48\.8 KB of 100\.0 KB/,
  );
  // Latin text alone loads the Latin face alone.
  const latinOnly = check([unit], [under('/', 'Hello, world')], { css }).samples[0];
  assert.equal(latinOnly.actual, 30000);
});

/** A typography that ships `subsets` faces of `bytes` each: latin first, then others a Latin page never loads. */
function multiSubset(subsets, bytes) {
  const ranges = {
    latin: 'U+0000-00FF',
    'latin-ext': 'U+0100-02AF',
    cyrillic: 'U+0400-045F',
    greek: 'U+0370-03FF',
    vietnamese: 'U+0102-0103, U+1EA0-1EF9',
    caps: 'U+0020-005A',
    'skips-a': 'U+0000-0060, U+0062-00FF',
    quotes: 'U+2018-201D',
    'google-latin-ext':
      'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
  };
  const fonts = subsets.map((subset, i) => ({
    url: `/_portfolio/font/multi.${String(i).padStart(12, '0')}.woff2`,
    bytes,
    sha256: 'x',
  }));
  const unit = pack('typography', 'multi', { fonts });
  const css = subsets
    .map(
      (subset, i) =>
        `@font-face { font-family: "multi Text"; src: url("${fonts[i].url}") format("woff2"); unicode-range: ${ranges[subset]}; }`,
    )
    .join('\n');
  return { unit, css: { [unit.stylesheet.url]: css } };
}

test('a multi-subset typography whose page fits passes, however much it ships in all (R4)', () => {
  // Five 40 KB subsets: 200 KB shipped, twice the 100 KB ceiling; a Latin page loads 40 KB.
  const { unit, css } = multiSubset(
    ['latin', 'latin-ext', 'cyrillic', 'greek', 'vietnamese'],
    40000,
  );
  const { records, samples, checked } = check([unit], [], { css });
  assert.deepEqual(records, [], JSON.stringify(records.map(({ test }) => test)));
  assert.equal(samples[0].actual, 40000);
  const total = checked.find((row) => row.metric === 'font');
  assert.equal(total.actual, 200000);
  assert.ok(total.actual > total.limit, 'the total is over the limit, and no record says so');
  assert.equal(total.gated, false);
});

test('with no text traced, a caps-only face and a range that skips "a" count, as any face meeting Basic Latin does (review R2-M1)', () => {
  // And so does a face of curly quotes alone (review R3-L1); Google's latin-ext, dagger and all, doesn't.
  for (const subset of ['caps', 'skips-a', 'quotes']) {
    const { unit, css } = multiSubset([subset, 'cyrillic', 'google-latin-ext'], 60000);
    const { samples, records } = check([unit], [], { css });
    assert.equal(samples[0].actual, 60000, subset);
    assert.deepEqual(records, [], subset);
  }
  // Two such faces beside a Latin one: 180 KB a Latin page may load, over the ceiling.
  const { unit, css } = multiSubset(['latin', 'caps', 'skips-a', 'cyrillic'], 60000);
  const { samples, records } = check([unit], [], { css });
  assert.equal(samples[0].actual, 180000);
  assert.deepEqual(
    records.map(({ metric, actual }) => [metric, actual]),
    [['font', 180000]],
  );
});

test('a page over 100 KB of fonts fails, and a system-font typography has no sample line', () => {
  // A 110 KB Latin face: the page alone is over the ceiling.
  const { unit, css } = multiSubset(['latin', 'cyrillic'], 110000);
  const { records, samples } = check([unit, pack('typography', 'system-type')], [], { css });
  assert.deepEqual(
    samples.map(({ id }) => id),
    ['multi'],
  );
  assert.deepEqual(
    records.map(({ metric, test }) => [metric, test.split(';')[0]]),
    [
      [
        'font',
        `a sample page under typography multi loads an estimated 110000 bytes of fonts (its Latin faces), over the typography axis's ceiling of ${CEILINGS.packs.typography.font}`,
      ],
    ],
    'one record, the page, and none for the 220 KB total',
  );
  assert.equal(records[0].actual, 110000);
  assert.equal(records[0].threshold, CEILINGS.packs.typography.font);
  assert.equal(records[0].asset, unit.fonts[0].url);
  assert.match(sampleLine(samples[0]), /^\[budgets\] OVER /);
  // With no face to read from its stylesheet, there's no sample, and the total gates, failing closed.
  const blind = check([unit], [], { css: { [unit.stylesheet.url]: '[data-typography] {}' } });
  assert.deepEqual(blind.samples, []);
  assert.deepEqual(
    blind.records.map(({ metric, actual }) => [metric, actual]),
    [['font', 220000]],
  );
});

// Studio's own image line (P-5): the typography picker's stills, a
// Studio-only row, never a pack's.

/** A Studio still the build serves, `bytes` long, or missing from the build at null. */
const studioStill = (name, bytes) => ({
  url: `/_portfolio/studio/${name}.0123456789ab.png`,
  bytes,
});

test("runtime-budgets.json's Studio line is 96 KB in all and 4 KB a still, with its owner, date and reason, and the typography packs' image ceiling stays 0", () => {
  const row = CEILINGS.studio;
  assert.equal(row.image, 98304);
  assert.equal(row.imagePerFile, 4096);
  assert.equal(row.date, '2026-10-28');
  assert.ok(row.owner, 'it names its owner');
  assert.match(row.why, /Studio assets/);
  assert.equal(CEILINGS.packs.typography.image, 0);
});

test("Studio's stills inside both ceilings pass, each one checked and their total", () => {
  const studio = [studioStill('a-aa', 2000), studioStill('a-line', 3000)];
  const { records, checked } = checkBudgets({
    units: [],
    ceilings: CEILINGS,
    trace: { cases: [] },
    chunks: [],
    entries: () => ({}),
    stylesheet: () => null,
    studio,
  });
  assert.deepEqual(records, []);
  const rows = checked.filter((row) => row.kind === 'studio');
  assert.deepEqual(
    rows.map((row) => [row.actual, row.limit, row.total ?? false]),
    [
      [2000, 4096, false],
      [3000, 4096, false],
      [5000, 98304, true],
    ],
  );
  assert.match(
    checkedLine(rows[2]),
    /^\[budgets\] ok {3}studio type-stills image in all: 4\.9 KB of 96\.0 KB/,
  );
  assert.match(checkedLine(rows[0]), /studio type-stills image \/_portfolio\/studio\/a-aa\./);
});

test('a still over 4 KB fails on its own, and the stills over 96 KB fail in all, never by raising a ceiling', () => {
  const big = studioStill('big-aa', 4097);
  const one = checkStudio({
    files: [big, studioStill('ok-line', 4096)],
    ceilings: CEILINGS,
    cases: [],
  });
  assert.deepEqual(
    one.records.map((record) => [record.metric, record.asset, record.actual, record.threshold]),
    [['image', big.url, 4097, 4096]],
  );
  assert.match(one.records[0].test, /goes back to the budget owner/);
  // 25 stills of 4,000 B each: none over 4 KB, 100,000 B in all.
  const many = Array.from({ length: 25 }, (_, at) => studioStill(`p${at}-aa`, 4000));
  const all = checkStudio({ files: many, ceilings: CEILINGS, cases: [] });
  assert.deepEqual(
    all.records.map((record) => [record.metric, record.actual, record.threshold]),
    [['image', 100000, 98304]],
  );
});

test('a still the record lists and the build lacks fails, and so does a build with stills and no Studio row', () => {
  const missing = checkStudio({
    files: [studioStill('gone-aa', null)],
    ceilings: CEILINGS,
    cases: [],
  });
  assert.equal(missing.records.length, 1);
  assert.match(missing.records[0].test, /not in the build output/);
  const { studio, ...rest } = CEILINGS;
  assert.ok(studio);
  const rowless = checkStudio({ files: [studioStill('a-aa', 10)], ceilings: rest, cases: [] });
  assert.deepEqual(
    rowless.records.map((record) => record.metric),
    ['ceiling'],
  );
  // With no still served, no row is needed.
  assert.deepEqual(checkStudio({ files: [], ceilings: rest, cases: [] }).records, []);
});

test('a public page that requests a Studio still fails, once per route and file, and never as an unlisted file too', () => {
  const still = studioStill('a-aa', 2000);
  const unit = variant('plain');
  const request = { url: `${ORIGIN}${still.url}`, kind: 'image', thirdParty: false };
  const cases = [
    traceCase('plain', { requests: [request, request] }),
    traceCase('plain', { viewport: '390x844', requests: [request] }),
  ];
  const { records } = checkBudgets({
    units: [unit],
    platform: null,
    ceilings: CEILINGS,
    trace: { cases },
    chunks: [],
    entries: () => ({}),
    statics: () => new Set(),
    stylesheet: () => '[data-variant] { color: red; }',
    studio: [still],
  });
  const studioRecords = records.filter((record) => record.asset === still.url);
  assert.deepEqual(
    studioRecords.map((record) => [record.metric, record.route]),
    [['unlisted', '/']],
  );
  assert.match(studioRecords[0].test, /a public page, loaded .*Studio's own assets/);
  // Its failure record names the host's package, neither a variant nor a pack.
  const fields = failureFields(studioRecords[0], {
    gate: 'budgets',
    reproCommand: 'x',
    artifacts: [],
  });
  assert.equal(fields.package, '@portfolio/web');
  assert.equal(fields.pack, undefined);
  assert.equal(fields.variant, undefined);
});

test("check:budgets reads Studio's stills from the committed record and measures each as the build serves it", () => {
  const sha = 'abcdef0123456789'.repeat(4);
  const record = {
    stills: [
      { pack: 'swiss-grotesque', role: 'aa', sha256: sha },
      { pack: 'swiss-grotesque', role: 'line', sha256: sha },
    ],
  };
  const served = { 'swiss-grotesque-aa.abcdef012345.png': 1234 };
  assert.deepEqual(
    studioAssets(record, (name) => served[name] ?? null),
    [
      { url: '/_portfolio/studio/swiss-grotesque-aa.abcdef012345.png', bytes: 1234 },
      { url: '/_portfolio/studio/swiss-grotesque-line.abcdef012345.png', bytes: null },
    ],
  );
  assert.deepEqual(studioAssets(null), []);
});
