import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildChunks, enhancementEntries } from './check-budgets.mjs';
import { OVER_BUDGET_METRICS, overBudgetProblems } from './budgets.mjs';
import {
  BUDGET_KINDS,
  checkBudgets,
  failureFields,
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
function check(units, cases, { css = {}, chunks = [], entries = {} } = {}) {
  return checkBudgets({
    units,
    platform: { url: '/_portfolio/pack/_platform.0123456789ab.css' },
    ceilings: CEILINGS,
    trace: { cases },
    chunks,
    entries: (unit) => entries[unit.id] ?? {},
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

test('every bundled variant and pack declares budgets within its ceilings', () => {
  const units = bundledUnits();
  for (const id of ['fallback', 'fixture-over-budget', 'warm-parchment', 'fixture-font']) {
    assert.ok(
      units.some((one) => one.id === id),
      `${id} is bundled`,
    );
  }
  for (const unit of units) {
    assert.deepEqual(Object.keys(unit.budgets), BUDGET_KINDS, `${unit.id} declares all six`);
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

test("a remote @import, url(), or image-set() in a unit's CSS fails; its own files and data: URLs don't", () => {
  assert.deepEqual(
    remoteReferences(
      [
        "@import url('https://a.example/x.css');",
        '@import "//b.example/y.css" layer(v);',
        '.a { background: url(http://c.example/z.png) }',
        '.b { background: image-set("https://d.example/1.png" 1x, "./2.png" 2x) }',
        '.c { background: url(\\68ttps://e.example/escaped.png) }',
        '/* @import url(https://commented.example/out.css); */',
        '.d { background: url(./local.png), url("/_portfolio/asset/x.png"), url(data:image/png;base64,AA==) }',
        '.e { mask: url(#clip) }',
      ].join('\n'),
    ).sort(),
    [
      'https://a.example/x.css',
      '//b.example/y.css',
      'http://c.example/z.png',
      'https://e.example/escaped.png',
      'https://d.example/1.png',
    ].sort(),
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

test("an enhancement's chunks count against enhancement, not js, and one no chunk holds is a record", () => {
  const medium = variant('medium', {
    performanceTier: 'medium',
    budgets: { js: 4096, enhancement: 4096 },
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
  assert.equal(records[0].actual, 5000);
  assert.equal(records[0].asset, '/_next/static/chunks/glint.js');
  assert.match(records[0].test, /in enhancement glint is 5000, over its declared budget of 4096/);
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

test("CI's proof of the over-budget fixture wants one record per metric, each naming its asset", () => {
  const record = (metric, asset, test = metric) => ({
    unit: { kind: 'variant', id: 'fixture-over-budget' },
    metric,
    asset,
    test,
  });
  const css = '/_portfolio/variant/fixture-over-budget.0123456789ab.css';
  const good = [
    record('js', '/_next/static/chunks/0abc~x.js'),
    record('css', css),
    record(
      'remote',
      css,
      'reaches another host: https://fonts.example.invalid/fixture-over-budget.css',
    ),
    { unit: { kind: 'variant', id: 'fallback' }, metric: 'js', asset: 'x', test: 'x' },
  ];
  assert.deepEqual(Object.keys(OVER_BUDGET_METRICS), ['js', 'css', 'remote']);
  assert.deepEqual(overBudgetProblems({ records: good }), []);
  assert.deepEqual(overBudgetProblems({ records: good.filter((one) => one.metric !== 'css') }), [
    '0 css record(s) for fixture-over-budget, not 1',
  ]);
  assert.deepEqual(
    overBudgetProblems({ records: [...good, record('js', '/_next/static/chunks/b.js')] }),
    ['2 js record(s) for fixture-over-budget, not 1'],
  );
  assert.match(
    overBudgetProblems({ records: [...good.slice(1), record('js', 'total')] })[0],
    /names total, not the asset/,
  );
  assert.match(
    overBudgetProblems({ records: [...good, record('unlisted', '/_portfolio/asset/x.png')] })[0],
    /unexpected unlisted record/,
  );
});

/** A temporary directory, removed after the test. */
function scratch(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'budgets-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

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
