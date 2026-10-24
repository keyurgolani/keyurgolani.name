import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BASE_STYLESHEET,
  documentReferences,
  flightPayload,
  forbiddenRules,
  globRegExp,
  purityProblems,
  selectedUnits,
  sourceFiles,
  unrenderedPayloadPacks,
} from './purity.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const APP = 'http://127.0.0.1:4100';

const file = (url, bytes = 100) => ({ url, bytes, sha256: '0'.repeat(64) });
const sheet = (url) => ({ ...file(url), gzipBytes: 50 });
const unit = (kind, id, packageName, fields = {}) => ({
  kind,
  id,
  packageName,
  version: '0.1.0',
  fixture: false,
  stylesheet: null,
  fonts: [],
  images: [],
  stills: [],
  enhancements: [],
  ...fields,
});

const MANIFEST = {
  version: 1,
  units: [
    unit('variant', 'fallback', '@portfolio/fallback-composition', {
      performanceTier: 'light',
      stylesheet: sheet('/_portfolio/variant/fallback.aaaaaaaaaaaa.css'),
    }),
    unit('variant', 'fixture-variant-light', '@portfolio/fixture-variant-light', {
      fixture: true,
      performanceTier: 'light',
      stylesheet: sheet('/_portfolio/variant/fixture-variant-light.bbbbbbbbbbbb.css'),
    }),
    unit('variant', 'fixture-variant-medium', '@portfolio/fixture-variant-medium', {
      fixture: true,
      performanceTier: 'medium',
      stylesheet: sheet('/_portfolio/variant/fixture-variant-medium.cccccccccccc.css'),
      images: [file('/_portfolio/asset/dddddddddddd.svg')],
    }),
    unit('color-scheme', 'warm-parchment', '@portfolio/appearance-schemes', {
      stylesheet: sheet('/_portfolio/pack/warm-parchment.eeeeeeeeeeee.css'),
    }),
    unit('color-scheme', 'night-ink', '@portfolio/appearance-schemes', {
      stylesheet: sheet('/_portfolio/pack/night-ink.ffffffffffff.css'),
    }),
  ],
  platform: sheet('/_portfolio/pack/_platform.111111111111.css'),
};

const RULES = [
  { glob: 'apps/web/src/app/(studio)/**', pattern: globRegExp('apps/web/src/app/(studio)/**') },
  {
    glob: 'apps/web/src/app/host-chrome.css',
    pattern: globRegExp('apps/web/src/app/host-chrome.css'),
  },
];

const LIGHT_SHEET = `${APP}/_portfolio/variant/fixture-variant-light.bbbbbbbbbbbb.css`;
const BASE_CHUNK = `${APP}/_next/static/chunks/base.css`;
const APP_CHUNK = `${APP}/_next/static/chunks/app.js`;

const request = (url, kind, thirdParty = false) => ({ url, kind, thirdParty });

/** A light page with nothing wrong with it: purityProblems() finds nothing. */
function lightPage(overrides = {}) {
  return {
    manifest: MANIFEST,
    composition: 'fixture-variant-light',
    appOrigin: APP,
    requests: [
      request(`${APP}/`, 'document'),
      request(BASE_CHUNK, 'stylesheet'),
      request(LIGHT_SHEET, 'stylesheet'),
      request(APP_CHUNK, 'script'),
    ],
    chunks: [
      {
        url: BASE_CHUNK,
        kind: 'css',
        modules: [{ source: BASE_STYLESHEET, package: 'apps/web' }],
      },
      {
        url: APP_CHUNK,
        kind: 'js',
        modules: [
          { source: 'packages/kit/src/enhancements/load.tsx', package: '@portfolio/kit' },
          {
            source: 'packages/budget-fixtures/fixture-variant-light/src/spotlight.tsx',
            package: '@portfolio/fixture-variant-light',
          },
          { source: 'apps/web/src/lib/host-modules-client.tsx', package: 'apps/web' },
        ],
      },
    ],
    withoutMap: [LIGHT_SHEET],
    references: {
      chunks: [APP_CHUNK, BASE_CHUNK],
      unitFiles: [LIGHT_SHEET],
      links: [`${APP}/`, `${APP}/work/tide-tables`],
      flight: { pushes: 3, unreadable: 0, bytes: 900 },
    },
    dom: {
      boundary: { 'data-variant': 'fixture-variant-light' },
      links: [`${APP}/`, `${APP}/work/tide-tables`, 'https://example.org/studio'],
      stylesheets: [BASE_CHUNK, LIGHT_SHEET],
      scripts: [APP_CHUNK],
      styleElements: [],
    },
    forbidden: RULES,
    ...overrides,
  };
}

test('globs match paths under the repository root as written, ** across directories and * within one', () => {
  const studio = globRegExp('apps/web/src/app/(studio)/**');
  assert.ok(studio.test('apps/web/src/app/(studio)/layout.tsx'));
  assert.ok(studio.test('apps/web/src/app/(studio)/studio/sign-in/page.tsx'));
  assert.ok(!studio.test('apps/web/src/app/studio/layout.tsx'), 'parentheses are literal');
  assert.ok(!studio.test('apps/web/src/app/(studio)x/layout.tsx'));
  const css = globRegExp('apps/web/src/app/*.css');
  assert.ok(css.test('apps/web/src/app/host-chrome.css'));
  assert.ok(!css.test('apps/web/src/app/(studio)/studio.css'), '* stays within one directory');
  const deep = globRegExp('packages/**/research/**');
  assert.ok(deep.test('packages/appearance-schemes/research/a.css'));
  assert.ok(deep.test('packages/a/b/research/c/d.ts'));
  assert.ok(globRegExp('packages/**/x.ts').test('packages/x.ts'), '**/ may match no directory');
  assert.ok(globRegExp('apps/web/src/a?.ts').test('apps/web/src/ab.ts'));
  assert.ok(!globRegExp('apps/web/src/a?.ts').test('apps/web/src/a/.ts'));
  assert.ok(!globRegExp('apps/web/src/a.ts').test('apps/web/src/aXts'), 'a dot is a dot');
});

test("the forbidden block's globs each match a file, and a malformed or empty rule is a problem", () => {
  const files = ['apps/web/src/app/(studio)/layout.tsx', 'apps/web/src/app/host-chrome.css'];
  const good = {
    forbidden: {
      modules: [
        { glob: 'apps/web/src/app/(studio)/**', rationale: 'Studio' },
        { glob: 'apps/web/src/app/host-chrome.css', rationale: 'Host chrome' },
      ],
    },
  };
  const checked = forbiddenRules(good, files);
  assert.deepEqual(checked.problems, []);
  assert.deepEqual(
    checked.rules.map((rule) => rule.glob),
    ['apps/web/src/app/(studio)/**', 'apps/web/src/app/host-chrome.css'],
  );

  const stale = forbiddenRules(
    { forbidden: { modules: [{ glob: 'apps/web/src/lib/studio/**', rationale: 'Slice 6' }] } },
    files,
  );
  assert.equal(stale.problems.length, 1);
  assert.match(stale.problems[0], /apps\/web\/src\/lib\/studio\/\*\*, matches no file/);

  const bad = forbiddenRules(
    {
      forbidden: {
        modules: [
          { glob: 'apps/web/src/app/(studio)/**' },
          { glob: '/etc/passwd', rationale: 'outside' },
          { glob: 'apps/../secret', rationale: 'climbs' },
          { glob: 'tests/x.ts', rationale: 'not app or package code' },
          { glob: 'apps/web/src/app/host-chrome.css', rationale: 'once' },
          { glob: 'apps/web/src/app/host-chrome.css', rationale: 'twice' },
        ],
      },
    },
    files,
  );
  assert.deepEqual(
    bad.problems.map((problem) => problem.replace(/,.*$/, '').replace(/ needs.*$/, '')),
    [
      'forbidden.modules[0]',
      'forbidden.modules[1]',
      'forbidden.modules[2]',
      'forbidden.modules[3]',
      'forbidden.modules[5]',
    ],
  );
  assert.deepEqual(forbiddenRules({}, files).problems, [
    'runtime-budgets.json has no forbidden.modules list.',
  ]);
});

test("runtime-budgets.json's forbidden block holds Studio's, the preview's, and the demo's code, and each glob matches a file here", () => {
  const budgets = JSON.parse(readFileSync(path.join(REPO_ROOT, 'runtime-budgets.json'), 'utf8'));
  const { rules, problems } = forbiddenRules(budgets, sourceFiles(REPO_ROOT));
  assert.deepEqual(problems, []);
  assert.deepEqual(
    rules.map((rule) => rule.glob),
    [
      'apps/web/src/app/(studio)/**',
      'apps/web/src/app/(preview)/**',
      'apps/web/src/preview/**',
      'apps/web/src/server/demo/**',
      'apps/web/src/lib/demo/**',
    ],
  );
});

test('the source walk lists apps/ and packages/ files, and skips dependencies, build output, and links', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'purity-walk-'));
  try {
    for (const dir of [
      'apps/web/src/app',
      'apps/web/node_modules/x',
      'apps/web/.next/server',
      'packages/kit/src',
      'tests',
    ]) {
      mkdirSync(path.join(root, dir), { recursive: true });
    }
    writeFileSync(path.join(root, 'apps/web/src/app/page.tsx'), '');
    writeFileSync(path.join(root, 'apps/web/node_modules/x/index.js'), '');
    writeFileSync(path.join(root, 'apps/web/.next/server/page.js'), '');
    writeFileSync(path.join(root, 'packages/kit/src/index.ts'), '');
    writeFileSync(path.join(root, 'tests/a.ts'), '');
    symlinkSync(path.join(root, 'tests'), path.join(root, 'packages/kit/src/linked'));
    assert.deepEqual(sourceFiles(root), ['apps/web/src/app/page.tsx', 'packages/kit/src/index.ts']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the RSC payload reads back from every self.__next_f.push([1, ...]) in order', () => {
  const html = [
    '<script>(self.__next_f=self.__next_f||[]).push([0])</script>',
    `<script>self.__next_f.push([1,${JSON.stringify('1:I["x",["/_next/static/chunks/a.js"],"default"]\n')}])</script>`,
    `<script>self.__next_f.push([1,${JSON.stringify('2:{"href":"/work/a"}\u003c')}])</script>`,
    '<script>self.__next_f.push([1,"broken \\x"])</script>',
  ].join('');
  const flight = flightPayload(html);
  assert.equal(flight.pushes, 2);
  assert.equal(flight.unreadable, 1);
  assert.equal(
    flight.text,
    '1:I["x",["/_next/static/chunks/a.js"],"default"]\n2:{"href":"/work/a"}<',
  );
});

test("a document's references: its chunks and stylesheets, unit files, and link targets, the RSC payload's too", () => {
  const flight = [
    '1:I[1234,["/_next/static/chunks/client-a.js","static/chunks/client-b.js"],"default"]\n',
    ':HL["/_next/static/chunks/style.css","style"]\n',
    '2:["$","a",null,{"href":"/studio","children":"x"}]\n',
    '3:["$","link",null,{"rel":"stylesheet","href":"/_portfolio/pack/night-ink.ffffffffffff.css","precedence":"appearance"}]\n',
  ].join('');
  const html = [
    '<!doctype html><html><head>',
    '<link rel="stylesheet" href="/_next/static/chunks/base.css" data-precedence="next"/>',
    '<link rel="stylesheet" href="/_portfolio/variant/fixture-variant-light.bbbbbbbbbbbb.css" data-precedence="variant"/>',
    '<link rel="preload" as="script" href="/_next/static/chunks/pre.js"/>',
    '<link rel="icon" href="/favicon.ico"/>',
    '<link rel="canonical" href="https://jane.test/"/>',
    '<script src="/_next/static/chunks/main.js" async=""></script>',
    '</head><body>',
    '<a href="/work/tide-tables?x=1&amp;y=2">Tide</a>',
    '<a href="https://example.org/">Out</a>',
    '<form action="/Admin/login"><button formaction="/studio/sign-in">Go</button></form>',
    `<script>self.__next_f.push([1,${JSON.stringify(flight)}])</script>`,
    '</body></html>',
  ].join('');
  const references = documentReferences(html, `${APP}/`);
  assert.deepEqual(references.chunks, [
    `${APP}/_next/static/chunks/base.css`,
    `${APP}/_next/static/chunks/client-a.js`,
    `${APP}/_next/static/chunks/client-b.js`,
    `${APP}/_next/static/chunks/main.js`,
    `${APP}/_next/static/chunks/pre.js`,
    `${APP}/_next/static/chunks/style.css`,
  ]);
  assert.deepEqual(references.unitFiles, [
    `${APP}/_portfolio/pack/night-ink.ffffffffffff.css`,
    `${APP}/_portfolio/variant/fixture-variant-light.bbbbbbbbbbbb.css`,
  ]);
  assert.deepEqual(references.links, [
    `${APP}/Admin/login`,
    `${APP}/studio`,
    `${APP}/studio/sign-in`,
    `${APP}/work/tide-tables?x=1&y=2`,
    'https://example.org/',
  ]);
  assert.deepEqual(references.flight, { pushes: 1, unreadable: 0, bytes: flight.length });
});

test('the selected units: the variant that renders, and only once the boundary is an appearance one, its packs and the platform stylesheet', () => {
  assert.deepEqual(
    selectedUnits(MANIFEST, 'fixture-variant-light', { 'data-variant': 'fixture-variant-light' }),
    { units: [MANIFEST.units[1]], platform: null },
  );
  const appearance = {
    'data-appearance-boundary': 'document',
    'data-variant': 'fixture-variant-light',
    'data-color-scheme': 'warm-parchment',
  };
  assert.deepEqual(selectedUnits(MANIFEST, 'fixture-variant-light', appearance), {
    units: [MANIFEST.units[1], MANIFEST.units[3]],
    platform: MANIFEST.platform,
  });
});

test('a page with nothing wrong with it has no problem, and names what it rendered', () => {
  assert.deepEqual(purityProblems(lightPage()), {
    selected: { units: ['variant fixture-variant-light'], platform: null },
    problems: [],
  });
});

test("another unit's stylesheet, linked, requested, or named anywhere, is a problem, and so is a file no unit ships", () => {
  const medium = `${APP}/_portfolio/variant/fixture-variant-medium.cccccccccccc.css`;
  const linked = purityProblems(
    lightPage({
      dom: { ...lightPage().dom, stylesheets: [BASE_CHUNK, LIGHT_SHEET, medium] },
    }),
  );
  assert.deepEqual(linked.problems, [
    "/_portfolio/variant/fixture-variant-medium.cccccccccccc.css is variant fixture-variant-medium's, which the page doesn't render.",
  ]);
  const page = lightPage();
  const named = purityProblems({
    ...page,
    requests: [...page.requests, request(`${APP}/_portfolio/asset/dddddddddddd.svg`, 'image')],
    references: {
      ...page.references,
      unitFiles: [
        ...page.references.unitFiles,
        `${APP}/_portfolio/pack/night-ink.ffffffffffff.css`,
        `${APP}/_portfolio/variant/gone.000000000000.css`,
      ],
    },
  });
  assert.deepEqual(named.problems, [
    "/_portfolio/asset/dddddddddddd.svg is variant fixture-variant-medium's, which the page doesn't render.",
    "/_portfolio/pack/night-ink.ffffffffffff.css is color-scheme night-ink's, which the page doesn't render.",
    "/_portfolio/variant/gone.000000000000.css is no registered unit's file in ASSET_MANIFEST.",
  ]);
});

test("a shared variant's work page, which the fallback composition renders, may load the fallback's units and none of the selected variant's (#10b)", () => {
  const fallbackSheet = `${APP}/_portfolio/variant/fallback.aaaaaaaaaaaa.css`;
  const work = `${APP}/work/tide-tables`;
  const base = lightPage();
  /** The work page as the fallback composition renders it, plus `extra` stylesheets. */
  const workPage = (extra = [], variant = 'fallback') =>
    lightPage({
      composition: 'fallback',
      requests: [
        request(work, 'document'),
        request(BASE_CHUNK, 'stylesheet'),
        request(fallbackSheet, 'stylesheet'),
        ...extra.map((url) => request(url, 'stylesheet')),
        request(APP_CHUNK, 'script'),
      ],
      chunks: [
        base.chunks[0],
        {
          url: APP_CHUNK,
          kind: 'js',
          modules: [
            { source: 'packages/kit/src/enhancements/load.tsx', package: '@portfolio/kit' },
            { source: 'apps/web/src/lib/host-modules-client.tsx', package: 'apps/web' },
          ],
        },
      ],
      withoutMap: [fallbackSheet, ...extra],
      references: { ...base.references, unitFiles: [fallbackSheet, ...extra] },
      dom: {
        ...base.dom,
        boundary: { 'data-variant': variant },
        stylesheets: [BASE_CHUNK, fallbackSheet, ...extra],
      },
    });
  assert.deepEqual(purityProblems(workPage()), {
    selected: { units: ['variant fallback'], platform: null },
    problems: [],
  });
  // Both sets of units on the one page: the selected variant's is a problem.
  assert.deepEqual(purityProblems(workPage([LIGHT_SHEET])).problems, [
    "/_portfolio/variant/fixture-variant-light.bbbbbbbbbbbb.css is variant fixture-variant-light's, which the page doesn't render.",
  ]);
  // The selected variant's boundary on the fallback's page is one too.
  assert.ok(
    purityProblems(workPage([], 'fixture-variant-light')).problems.includes(
      "The page's boundary renders fixture-variant-light, not fallback.",
    ),
  );
});

test("a selected pack's stylesheet and the platform's are allowed once the boundary says so, and another pack's still isn't", () => {
  const page = lightPage();
  const parchment = `${APP}/_portfolio/pack/warm-parchment.eeeeeeeeeeee.css`;
  const platform = `${APP}/_portfolio/pack/_platform.111111111111.css`;
  const night = `${APP}/_portfolio/pack/night-ink.ffffffffffff.css`;
  const withPacks = (boundary) =>
    purityProblems({
      ...page,
      requests: [
        ...page.requests,
        request(parchment, 'stylesheet'),
        request(platform, 'stylesheet'),
        request(night, 'stylesheet'),
      ],
      dom: { ...page.dom, boundary },
    }).problems;
  assert.deepEqual(
    withPacks({
      'data-appearance-boundary': 'document',
      'data-variant': 'fixture-variant-light',
      'data-color-scheme': 'warm-parchment',
    }),
    [
      "/_portfolio/pack/night-ink.ffffffffffff.css is color-scheme night-ink's, which the page doesn't render.",
    ],
  );
  assert.deepEqual(withPacks({ 'data-variant': 'fixture-variant-light' }), [
    "/_portfolio/pack/warm-parchment.eeeeeeeeeeee.css is color-scheme warm-parchment's, which the page doesn't render.",
    "/_portfolio/pack/_platform.111111111111.css is no registered unit's file in ASSET_MANIFEST.",
    "/_portfolio/pack/night-ink.ffffffffffff.css is color-scheme night-ink's, which the page doesn't render.",
  ]);
});

test("the error page's fallback packs may be named in a document boundary's payload, and never loaded, linked, or named elsewhere", () => {
  const page = lightPage();
  const parchment = `${APP}/_portfolio/pack/warm-parchment.eeeeeeeeeeee.css`;
  const platform = `${APP}/_portfolio/pack/_platform.111111111111.css`;
  const boundary = {
    'data-appearance-boundary': 'document',
    'data-variant': 'fixture-variant-light',
    'data-color-scheme': 'night-ink',
  };
  const named = (overrides = {}) =>
    purityProblems({
      ...page,
      requests: [...page.requests, request(platform, 'stylesheet')],
      references: { ...page.references, unitFiles: [...page.references.unitFiles, parchment] },
      dom: { ...page.dom, boundary },
      errorPacks: { 'color-scheme': 'warm-parchment' },
      ...overrides,
    }).problems;
  const notRendered =
    "/_portfolio/pack/warm-parchment.eeeeeeeeeeee.css is color-scheme warm-parchment's, which the page doesn't render.";
  assert.deepEqual(named(), []);
  // Loaded, or linked, it renders on a page that doesn't render it.
  assert.deepEqual(
    named({
      requests: [
        ...page.requests,
        request(platform, 'stylesheet'),
        request(parchment, 'stylesheet'),
      ],
    }),
    [notRendered],
  );
  assert.deepEqual(
    named({ dom: { ...page.dom, boundary, stylesheets: [...page.dom.stylesheets, parchment] } }),
    [notRendered],
  );
  // Another pack on the same kind, named but never loaded, is no error pack.
  const night = `${APP}/_portfolio/pack/night-ink.ffffffffffff.css`;
  assert.deepEqual(
    named({
      references: { ...page.references, unitFiles: [...page.references.unitFiles, night] },
      dom: { ...page.dom, boundary: { ...boundary, 'data-color-scheme': 'warm-parchment' } },
    }),
    [
      "/_portfolio/pack/night-ink.ffffffffffff.css is color-scheme night-ink's, which the page doesn't render.",
    ],
  );
  // Without errorPacks, or outside a document boundary, it's any other unit's.
  assert.deepEqual(named({ errorPacks: undefined }), [notRendered]);
  assert.ok(
    named({ dom: { ...page.dom, boundary: { 'data-variant': 'fixture-variant-light' } } }).includes(
      notRendered,
    ),
  );
});

test("another unit's code, or a forbidden module, in any chunk the page references or loads is a problem", () => {
  const page = lightPage();
  const chunk = {
    url: `${APP}/_next/static/chunks/shared.js`,
    kind: 'js',
    modules: [
      {
        source: 'packages/budget-fixtures/fixture-variant-medium/src/shader-stage.tsx',
        package: '@portfolio/fixture-variant-medium',
      },
      { source: 'apps/web/src/app/(studio)/studio/page.tsx', package: 'apps/web' },
      {
        source: 'packages/appearance-schemes/src/night-ink.ts',
        package: '@portfolio/appearance-schemes',
      },
    ],
  };
  const { problems } = purityProblems({ ...page, chunks: [...page.chunks, chunk] });
  assert.deepEqual(problems, [
    "/_next/static/chunks/shared.js holds packages/budget-fixtures/fixture-variant-medium/src/shader-stage.tsx, from variant fixture-variant-medium, which the page doesn't render.",
    '/_next/static/chunks/shared.js holds apps/web/src/app/(studio)/studio/page.tsx, which apps/web/src/app/(studio)/** forbids on a public page.',
    "/_next/static/chunks/shared.js holds packages/appearance-schemes/src/night-ink.ts, from color-scheme warm-parchment, color-scheme night-ink, which the page doesn't render.",
  ]);
});

test('CSS from anything but experience-base.css and the selected units is a problem, an inline <style> included', () => {
  const page = lightPage();
  const { problems } = purityProblems({
    ...page,
    requests: [...page.requests, request(`${APP}/fonts.css`, 'stylesheet')],
    chunks: page.chunks.map((chunk) =>
      chunk.kind === 'css'
        ? {
            ...chunk,
            modules: [
              ...chunk.modules,
              { source: 'apps/web/src/app/host-chrome.css', package: 'apps/web' },
            ],
          }
        : chunk,
    ),
    dom: { ...page.dom, styleElements: [0, 120] },
  });
  assert.deepEqual(problems, [
    'A stylesheet from neither experience-base.css nor a selected unit: /fonts.css',
    "/_next/static/chunks/base.css holds CSS from apps/web/src/app/host-chrome.css (apps/web): a public page's CSS comes only from experience-base.css and the selected units.",
    "The page has 1 <style> element(s) with CSS in them: a public page's CSS comes only from experience-base.css and the selected units.",
    '/_next/static/chunks/base.css holds apps/web/src/app/host-chrome.css, which apps/web/src/app/host-chrome.css forbids on a public page.',
  ]);
});

test('a third-party request and a link to Studio or /admin, in any case or encoding, are problems; a look-alike path is not', () => {
  const page = lightPage();
  const { problems } = purityProblems({
    ...page,
    requests: [...page.requests, request('https://fonts.googleapis.com/css2', 'stylesheet', true)],
    references: {
      ...page.references,
      links: [`${APP}/studios`, `${APP}/administer`, `${APP}/%73tudio/sign-in`],
    },
    dom: { ...page.dom, links: [`${APP}/Studio`, `${APP}/admin/`, 'https://other.example/studio'] },
  });
  assert.deepEqual(problems, [
    'A third-party request: https://fonts.googleapis.com/css2',
    'A link to /Studio: no public page links to Studio or /admin.',
    'A link to /admin/: no public page links to Studio or /admin.',
    'A link to /%73tudio/sign-in: no public page links to Studio or /admin.',
  ]);
});

test('a page with no attributed JS chunk fails, since nothing checked its code', () => {
  const page = lightPage();
  const NO_JS =
    "No JS chunk was attributed, so none of the page's code was checked: trace a PORTFOLIO_ANALYZE=1 build.";
  const cssOnly = page.chunks.filter((chunk) => chunk.kind === 'css');
  assert.deepEqual(
    purityProblems({
      ...page,
      chunks: cssOnly,
      requests: page.requests.filter((entry) => entry.kind !== 'script'),
      references: { ...page.references, chunks: [BASE_CHUNK] },
      dom: { ...page.dom, scripts: [] },
    }).problems,
    [NO_JS],
  );
  // A JS chunk whose map placed no module is no evidence either.
  assert.deepEqual(
    purityProblems({
      ...page,
      chunks: [...cssOnly, { url: APP_CHUNK, kind: 'js', modules: [] }],
    }).problems,
    [NO_JS],
  );
});

test('a script the settled DOM runs or preloads has to be among the attributed chunks', () => {
  const page = lightPage();
  const late = `${APP}/_next/static/chunks/late.js`;
  assert.deepEqual(
    purityProblems({ ...page, dom: { ...page.dom, scripts: [APP_CHUNK, late] } }).problems,
    [
      "/_next/static/chunks/late.js has no source map, so its modules can't be checked: build with PORTFOLIO_ANALYZE=1.",
    ],
  );
  assert.deepEqual(
    purityProblems({
      ...page,
      chunks: [...page.chunks, { url: late, kind: 'js', modules: page.chunks[1].modules }],
      dom: { ...page.dom, scripts: [APP_CHUNK, late] },
    }).problems,
    [],
  );
});

test("a chunk with no source map fails the page, since its modules can't be checked, but a unit file is matched by its URL", () => {
  const page = lightPage();
  const unmapped = `${APP}/_next/static/chunks/unmapped.js`;
  const { problems } = purityProblems({
    ...page,
    withoutMap: [...page.withoutMap, unmapped],
    references: {
      ...page.references,
      chunks: [...page.references.chunks, `${APP}/_next/static/chunks/named.css`],
    },
  });
  assert.deepEqual(problems, [
    "/_next/static/chunks/unmapped.js has no source map, so its modules can't be checked: build with PORTFOLIO_ANALYZE=1.",
    "/_next/static/chunks/named.css has no source map, so its modules can't be checked: build with PORTFOLIO_ANALYZE=1.",
  ]);
});

test("the boundary has to render the trace's variant, which has to be registered, and its stylesheet has to load", () => {
  const page = lightPage();
  assert.deepEqual(
    purityProblems({
      ...page,
      requests: page.requests.filter((entry) => entry.url !== LIGHT_SHEET),
      dom: { ...page.dom, boundary: { 'data-variant': 'fallback' } },
    }).problems,
    [
      "The page's boundary renders fallback, not fixture-variant-light.",
      "/_portfolio/variant/fixture-variant-light.bbbbbbbbbbbb.css, variant fixture-variant-light's stylesheet, never loaded: is ASSET_MANIFEST this build's?",
    ],
  );
  assert.deepEqual(
    purityProblems({
      ...page,
      composition: 'nowhere',
      dom: { ...page.dom, boundary: null },
    }).problems.slice(0, 2),
    [
      'ASSET_MANIFEST lists no variant nowhere.',
      "The page's boundary renders no variant, not nowhere.",
    ],
  );
});

test("the forbidden block's own problems fail every page", () => {
  const { problems } = purityProblems(
    lightPage({
      forbiddenProblems: ['forbidden.modules[0], x, matches no file in the repository.'],
    }),
  );
  assert.deepEqual(problems, ['forbidden.modules[0], x, matches no file in the repository.']);
});

test("a page's RSC payload names no pack stylesheet but those it renders, the platform's, and the error page's fallbacks (#19)", () => {
  const push = (text) => `<script>self.__next_f.push([1,${JSON.stringify(text)}])</script>`;
  const boundary = {
    'data-appearance-boundary': 'document',
    'data-color-scheme': 'night-ink',
  };
  const errorPacks = { 'color-scheme': 'warm-parchment' };
  const rendered = push(
    '3:{"href":"/_portfolio/pack/_platform.111111111111.css"}\n4:{"href":"/_portfolio/pack/night-ink.ffffffffffff.css"}\n5:{"href":"/_portfolio/pack/warm-parchment.eeeeeeeeeeee.css"}\n',
  );
  assert.deepEqual(unrenderedPayloadPacks(rendered, MANIFEST, boundary, errorPacks), []);
  // The visitor control's model once named every choice's stylesheet.
  const catalog = push(
    '6:{"value":"night-ink","stylesheet":"/_portfolio/pack/night-ink.ffffffffffff.css"},{"value":"warm-parchment","stylesheet":"/_portfolio/pack/warm-parchment.eeeeeeeeeeee.css"},{"value":"zinc","stylesheet":"/_portfolio/pack/zinc.222222222222.css"}\n',
  );
  assert.deepEqual(unrenderedPayloadPacks(catalog, MANIFEST, boundary, errorPacks), [
    '/_portfolio/pack/zinc.222222222222.css',
  ]);
  // Without the error page's packs, the fallback scheme counts too.
  assert.deepEqual(unrenderedPayloadPacks(rendered, MANIFEST, boundary), [
    '/_portfolio/pack/warm-parchment.eeeeeeeeeeee.css',
  ]);
  // Outside a document boundary, not even the platform stylesheet.
  assert.deepEqual(unrenderedPayloadPacks(rendered, MANIFEST, null), [
    '/_portfolio/pack/_platform.111111111111.css',
    '/_portfolio/pack/night-ink.ffffffffffff.css',
    '/_portfolio/pack/warm-parchment.eeeeeeeeeeee.css',
  ]);
  // Nor the error page's packs, as purityProblems() allows them only in a document boundary.
  assert.deepEqual(
    unrenderedPayloadPacks(rendered, MANIFEST, { 'data-color-scheme': 'night-ink' }, errorPacks),
    [
      '/_portfolio/pack/_platform.111111111111.css',
      '/_portfolio/pack/warm-parchment.eeeeeeeeeeee.css',
    ],
  );
});
