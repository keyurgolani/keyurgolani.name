import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  auditKitSections,
  auditSharedStylesheet,
  auditVariant,
  kitImports,
  type AuditFinding,
} from './audit';
import { parseCss, splitSelectors } from './css';

// The variant source audit (#5, Slice 3, item 5): each forbidden pattern is
// a finding at its line, and code that keeps to the contract has none.

const dirs: string[] = [];
test.after(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A package directory holding `files`, by path. */
function packageWith(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-audit-'));
  dirs.push(dir);
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
  return dir;
}

function audit(
  files: Record<string, string>,
  { rtl = false, enhancementEntries = [] as string[] } = {},
): AuditFinding[] {
  return auditVariant({
    packageName: '@acme/ocean',
    dir: packageWith(files),
    id: 'acme-ocean',
    rtl,
    enhancementEntries,
  });
}

/** Each finding as `<code> <file>:<line>`. */
const codes = (findings: readonly AuditFinding[]) =>
  findings.map(({ code, file, line }) => `${code} ${file}:${line}`);

const CLEAN = `import { renderSection, seededRandom } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';

export default function Ocean({ input }: { input: VariantRenderInput }) {
  const random = seededRandom(input.env.seed);
  const when = new Date(input.env.now);
  return (
    <main id={input.ids.main} data-when={when.getUTCFullYear()} data-tilt={random()}>
      {input.portfolio.sections.map((section) => renderSection(section, input, {}))}
    </main>
  );
}
`;

test('a variant that keeps to the contract has no finding', () => {
  assert.deepEqual(
    audit({
      'src/index.tsx': CLEAN,
      'src/styles.css': "[data-variant='acme-ocean'] main { margin-inline: auto; }\n",
    }),
    [],
  );
});

test('server modules, the environment, and GitHub fetches are findings', () => {
  const findings = audit({
    'src/server.ts': [
      "import fs from 'node:fs';",
      "import path from 'path';",
      "import 'server-only';",
      "import Link from 'next/link';",
      "import { owner } from '@portfolio/core/owner';",
      "export const read = () => require('fs');",
      'export const token = process.env.GITHUB_TOKEN;',
      "export const other = process['env'];",
      "import { fetchGitHubData } from '@portfolio/kit/github';",
      'export const data = fetchGitHubData;',
      'void [fs, path, Link, owner];',
    ].join('\n'),
  });
  assert.deepEqual(codes(findings), [
    'audit.server-module src/server.ts:1',
    'audit.server-module src/server.ts:2',
    'audit.server-module src/server.ts:3',
    'audit.server-module src/server.ts:4',
    'audit.server-module src/server.ts:5',
    'audit.server-module src/server.ts:6',
    'audit.environment src/server.ts:7',
    'audit.environment src/server.ts:8',
    'audit.github-fetch src/server.ts:9',
    'audit.github-fetch src/server.ts:10',
  ]);
  assert.match(findings[0]!.message, /imports node:fs, a Node module\./);
  assert.match(findings[0]!.remedy, /runs in browsers too/);
});

test('the network, cookies, and storage are findings, and so are their names on window', () => {
  const findings = audit({
    'src/fetch.ts': [
      "export const a = () => fetch('/x');",
      'export const b = () => new XMLHttpRequest();',
      'export const c = () => window.fetch;',
      "export const d = () => new WebSocket('wss://x.test');",
      "export const e = () => navigator.sendBeacon('/x');",
      'export const f = () => document.cookie;',
      "export const g = () => localStorage.getItem('k');",
      'export const h = () => globalThis.sessionStorage;',
      "export const i = () => indexedDB.open('x');",
      // A property of another object, or a binding of your own, is fine.
      'export const j = (api: { fetch(): void }) => api.fetch();',
      'export const k = { fetch: 1, localStorage: 2 };',
    ].join('\n'),
  });
  assert.deepEqual(codes(findings), [
    'audit.network src/fetch.ts:1',
    'audit.network src/fetch.ts:2',
    'audit.network src/fetch.ts:3',
    'audit.network src/fetch.ts:4',
    'audit.network src/fetch.ts:5',
    'audit.storage src/fetch.ts:6',
    'audit.storage src/fetch.ts:7',
    'audit.storage src/fetch.ts:8',
    'audit.storage src/fetch.ts:9',
  ]);
});

test('the clock and Math.random() are findings; a date from a value is not', () => {
  const findings = audit({
    'src/time.ts': [
      'export const a = Date.now();',
      'export const b = new Date();',
      'export const c = Math.random();',
      "export const d = new Date('2026-01-01');",
      'export const e = new Date(2026, 0, 1);',
    ].join('\n'),
  });
  assert.deepEqual(codes(findings), [
    'audit.clock src/time.ts:1',
    'audit.clock src/time.ts:2',
    'audit.random src/time.ts:3',
  ]);
});

test('async components, raw HTML, and CSS imports are findings', () => {
  const findings = audit({
    'src/index.tsx': [
      "import './styles.css';",
      'export default async function Ocean() { return <main />; }',
      'export const Card = async () => null;',
      'export const helper = async () => 1;',
      'export const Raw = () => <div dangerouslySetInnerHTML={{ __html: "x" }} />;',
      "export const props = { dangerouslySetInnerHTML: { __html: 'x' } };",
    ].join('\n'),
  });
  assert.deepEqual(codes(findings), [
    'audit.css-import src/index.tsx:1',
    'audit.async-component src/index.tsx:2',
    'audit.async-component src/index.tsx:3',
    'audit.inner-html src/index.tsx:5',
    'audit.inner-html src/index.tsx:6',
  ]);
});

test("a client module that takes the whole input is a finding, but a declared enhancement isn't", () => {
  const client = [
    "'use client';",
    "import type { VariantRenderInput } from '@portfolio/variant-contract';",
    'export function Card({ input }: { input: VariantRenderInput }) { return <p>{input.variant}</p>; }',
    'export function Name({ name }: { name: string }) { return <p>{name}</p>; }',
  ].join('\n');
  assert.deepEqual(codes(audit({ 'src/card.tsx': client })), ['audit.client-input src/card.tsx:3']);
  assert.deepEqual(
    audit({ 'src/orbit.tsx': client }, { enhancementEntries: ['src/orbit.tsx'] }),
    [],
  );
  // A server module may take it: it never reaches the page payload.
  assert.deepEqual(audit({ 'src/card.tsx': client.replace("'use client';", '') }), []);
});

test("tests, fixtures, declarations, and dependencies aren't audited", () => {
  const time = 'export const a = Date.now();\n';
  assert.deepEqual(
    audit({
      'src/time.test.ts': time,
      'src/__fixtures__/time.ts': time,
      'src/types.d.ts': 'export declare const a: number;\n',
      'node_modules/dep/index.js': time,
    }),
    [],
  );
});

test('CSS outside the variant scope, global at-rules, and remote imports are findings', () => {
  const findings = audit({
    'src/styles.css': [
      "[data-variant='acme-ocean'] .card { display: grid; }",
      '[data-variant="acme-ocean"], [data-variant="acme-ocean"] h1 { margin: 0; }',
      '.card { display: block; }',
      "body, [data-variant='acme-ocean'] p { margin: 0; }",
      '@media (min-width: 40rem) {',
      '  :root { --x: 1; }',
      "  [data-variant='acme-ocean'] .wide { display: flex; }",
      '}',
      "@import url('https://fonts.example.test/a.css');",
      "@import './local.css';",
      "@font-face { font-family: 'Ocean'; src: url(./ocean.woff2); }",
      '@keyframes drift { from { opacity: 0; } to { opacity: 1; } }',
      "[data-variant='acme-ocean'] .nested { & .child { display: block; } }",
      "[data-variant='acme-reef'] .other { display: none; }",
    ].join('\n'),
  });
  assert.deepEqual(codes(findings), [
    'audit.css-unscoped src/styles.css:3',
    'audit.css-unscoped src/styles.css:4',
    'audit.css-unscoped src/styles.css:6',
    'audit.css-remote-import src/styles.css:9',
    'audit.css-unscoped src/styles.css:11',
    'audit.css-keyframes src/styles.css:12',
    'audit.css-unscoped src/styles.css:14',
  ]);
  assert.match(
    findings[1]!.message,
    /has the selector body, which isn't under \[data-variant="acme-ocean"\]/,
  );
});

test('a variant that declares rtl may not use physical CSS, and one that does not may', () => {
  const css = [
    "[data-variant='acme-ocean'] .a { margin-left: 1rem; }",
    "[data-variant='acme-ocean'] .b { padding-right: 1rem; border-left: 1px solid; }",
    "[data-variant='acme-ocean'] .c { left: 0; text-align: right; float: left; }",
    "[data-variant='acme-ocean'] .d { border-top-right-radius: var(--ocean-radius); }",
    "[data-variant='acme-ocean'] .e { margin-inline-start: 1rem; text-align: start; inset-inline-end: 0; }",
    "@media print { [data-variant='acme-ocean'] .f { right: 0; } }",
  ].join('\n');
  assert.deepEqual(codes(audit({ 'src/styles.css': css }, { rtl: true })), [
    'audit.css-physical src/styles.css:1',
    'audit.css-physical src/styles.css:2',
    'audit.css-physical src/styles.css:2',
    'audit.css-physical src/styles.css:3',
    'audit.css-physical src/styles.css:3',
    'audit.css-physical src/styles.css:3',
    'audit.css-physical src/styles.css:4',
    'audit.css-physical src/styles.css:6',
  ]);
  assert.deepEqual(audit({ 'src/styles.css': css }), []);
});

test('the clock and randomness rules follow @portfolio/kit/sections through every kit module it imports', () => {
  const kit = packageWith({
    'src/sections/index.ts': "export { a } from './a';\nexport * from '../format';\n",
    'src/sections/a.tsx': "import { b } from './nested/b';\nexport const a = () => b;\n",
    'src/sections/nested/b.ts': 'export const b = Date.now();\n',
    'src/format.ts': 'export const c = () => Math.random();\nexport const d = new Date(1);\n',
    // Not imported from the sections entry, so not checked.
    'src/spatial/index.ts': 'export const e = Date.now();\n',
    // Fetching is a variant rule, not a determinism one.
    'src/sections/fetching.ts': "export const f = () => fetch('/x');\n",
  });
  assert.deepEqual(codes(auditKitSections(kit, 'src/sections/index.ts')), [
    'audit.random src/format.ts:1',
    'audit.clock src/sections/nested/b.ts:1',
  ]);
  assert.ok(
    auditKitSections(kit, 'src/sections/index.ts').every(
      (found) => found.package === '@portfolio/kit',
    ),
  );
});

// What the review of #42 tried, each a way around a rule that matched only
// its plainest spelling (#5, Slice 3, item 5). Each now has its finding, by
// code and line.
const BYPASSES: readonly [name: string, file: string, text: string, expected: string[]][] = [
  [
    'destructured process',
    'src/a.ts',
    'const { env } = process;\nexport const t = env.X;\n',
    ['audit.environment@1', 'audit.environment@2'],
  ],
  [
    'process through globalThis',
    'src/a.ts',
    'export const t = globalThis.process.env.X;\n',
    ['audit.environment@1'],
  ],
  [
    'process aliased',
    'src/a.ts',
    'const p = process;\nexport const t = p.env.X;\n',
    ['audit.environment@1', 'audit.environment@2'],
  ],
  [
    'process.getBuiltinModule',
    'src/a.ts',
    "export const fs = process.getBuiltinModule('node:fs');\n",
    ['audit.server-module@1'],
  ],
  [
    'a computed dynamic import',
    'src/a.ts',
    "export const load = () => import('node:' + 'fs');\n",
    ['audit.dynamic-import@1'],
  ],
  [
    'a variable dynamic import',
    'src/a.ts',
    "const name = 'node:fs';\nexport const load = () => import(name);\n",
    ['audit.dynamic-import@2'],
  ],
  [
    'a computed require',
    'src/a.ts',
    "const name = 'fs';\nexport const load = () => require(name);\n",
    ['audit.dynamic-import@2'],
  ],
  [
    'fetch by string key',
    'src/a.ts',
    "export const f = () => globalThis['fetch']('/x');\n",
    ['audit.network@1'],
  ],
  [
    'globalThis aliased',
    'src/a.ts',
    "const g = globalThis;\nexport const f = () => g.fetch('/x');\n",
    ['audit.network@2'],
  ],
  [
    'fetch destructured',
    'src/a.ts',
    "const { fetch: get } = globalThis;\nexport const f = () => get('/x');\n",
    ['audit.network@1'],
  ],
  [
    'fetch through Reflect.get',
    'src/a.ts',
    "export const f = () => Reflect.get(globalThis, 'fetch')('/x');\n",
    ['audit.network@1'],
  ],
  [
    'an import from a URL',
    'src/a.ts',
    "export const f = () => import('https://esm.example.test/x.js');\n",
    ['audit.network@1'],
  ],
  [
    'indirect eval',
    'src/a.ts',
    "export const f = () => (0, eval)('fe' + 'tch')('/x');\n",
    ['audit.dynamic-code@1'],
  ],
  [
    'the Function constructor',
    'src/a.ts',
    "export const f = new Function('return 1');\n",
    ['audit.dynamic-code@1'],
  ],
  [
    'a timer given a string',
    'src/a.ts',
    "export const t = setTimeout('go()', 10);\n",
    ['audit.dynamic-code@1'],
  ],
  [
    'localStorage by string key',
    'src/a.ts',
    "export const s = () => window['localStorage'].getItem('k');\n",
    ['audit.storage@1'],
  ],
  [
    'the cookie by string key',
    'src/a.ts',
    "export const c = () => document['cookie'];\n",
    ['audit.storage@1'],
  ],
  [
    'a global by a computed key',
    'src/a.ts',
    "const k = 'fe' + 'tch';\nexport const f = () => globalThis[k];\n",
    ['audit.global-access@2'],
  ],
  [
    'the global object passed along',
    'src/a.ts',
    'const keep = (o: object) => o;\nexport const g = keep(window);\n',
    ['audit.global-access@2'],
  ],
  [
    'the global object in a literal',
    'src/a.ts',
    'export const box = { window };\n',
    ['audit.global-access@1'],
  ],
  ['Date() called', 'src/a.ts', 'export const now = Date();\n', ['audit.clock@1']],
  ['performance.now()', 'src/a.ts', 'export const now = performance.now();\n', ['audit.clock@1']],
  [
    'a date format with no date',
    'src/a.ts',
    'export const today = new Intl.DateTimeFormat().format();\n',
    ['audit.clock@1'],
  ],
  [
    'a kept date format with no date',
    'src/a.ts',
    "const format = new Intl.DateTimeFormat('en');\nexport const today = format.format();\n",
    ['audit.clock@2'],
  ],
  [
    'Date.now through globalThis',
    'src/a.ts',
    'export const now = globalThis.Date.now();\n',
    ['audit.clock@1'],
  ],
  [
    'new Date through globalThis',
    'src/a.ts',
    'export const now = new globalThis.Date();\n',
    ['audit.clock@1'],
  ],
  [
    'crypto.getRandomValues()',
    'src/a.ts',
    'export const r = crypto.getRandomValues(new Uint32Array(1))[0];\n',
    ['audit.random@1'],
  ],
  [
    'crypto.randomUUID()',
    'src/a.ts',
    'export const r = crypto.randomUUID();\n',
    ['audit.random@1'],
  ],
  [
    'Math.random destructured',
    'src/a.ts',
    'const { random } = Math;\nexport const r = random();\n',
    ['audit.random@1'],
  ],
  [
    'Math.random aliased',
    'src/a.ts',
    'const r0 = Math.random;\nexport const r = r0();\n',
    ['audit.random@1'],
  ],
  [
    'Math.random passed along',
    'src/a.ts',
    'export const rs = [1, 2].map(Math.random);\n',
    ['audit.random@1'],
  ],
  [
    'dangerouslySetInnerHTML by computed key',
    'src/a.tsx',
    "import { createElement } from 'react';\nexport const X = () => createElement('div', { ['dangerouslySetInnerHTML']: { __html: 'x' } });\n",
    ['audit.inner-html@2'],
  ],
  [
    'innerHTML set',
    'src/a.ts',
    "export const set = (el: HTMLElement) => { el.innerHTML = '<b>x</b>'; };\n",
    ['audit.inner-html@1'],
  ],
  [
    'a <style> element',
    'src/a.tsx',
    "export const X = () => <style>{'body { display: none }'}</style>;\n",
    ['audit.raw-element@1'],
  ],
  [
    'a <link> stylesheet',
    'src/a.tsx',
    'export const X = () => <link rel="stylesheet" href="https://cdn.example.test/x.css" precedence="default" />;\n',
    ['audit.raw-element@1'],
  ],
  [
    'a <script> made by createElement',
    'src/a.ts',
    "export const s = () => document.createElement('script');\n",
    ['audit.raw-element@1'],
  ],
  [
    'an async unnamed default export without JSX',
    'src/index.ts',
    "import { createElement } from 'react';\nexport default async function ({ input }: { input: unknown }) { return createElement('main', null, String(input)); }\n",
    ['audit.async-component@2'],
  ],
  [
    'an async memo() component',
    'src/a.tsx',
    "import { memo } from 'react';\nexport const Card = memo(async function card() { return null; });\n",
    ['audit.async-component@2'],
  ],
  [
    'a client component taking input by an imported type',
    'src/card.tsx',
    "'use client';\nimport type { CardProps } from './types';\nexport function Card({ input }: CardProps) { return <p>{String(input)}</p>; }\n",
    ['audit.client-input@3'],
  ],
  [
    'a client component reading props.input',
    'src/card.tsx',
    "'use client';\nexport function Card(props: { input: unknown }) { return <p>{String(props.input)}</p>; }\n",
    ['audit.client-input@2'],
  ],
];

for (const [name, file, text, expected] of BYPASSES) {
  test(`the audit sees through ${name}`, () => {
    const findings = audit({ [file]: text });
    assert.deepEqual(
      findings.map(({ code, line }) => `${code}@${line}`),
      expected,
      findings.map(({ message }) => message).join(' | '),
    );
  });
}

const STYLE_BYPASSES: readonly [name: string, css: string, expected: string[], rtl?: boolean][] = [
  [
    'a sibling combinator after the scope',
    "[data-variant='acme-ocean'] ~ * { display: none; }\n[data-variant='acme-ocean']:hover + div { display: none; }\n",
    ['audit.css-unscoped@1', 'audit.css-unscoped@2'],
  ],
  [
    'a nested sibling',
    "[data-variant='acme-ocean'] {\n  & ~ * { display: none; }\n  + p { display: none; }\n}\n",
    ['audit.css-unscoped@2', 'audit.css-unscoped@3'],
  ],
  [
    'a nested rule outside the scope',
    "[data-variant='acme-ocean'] { .wrap & { display: none; } }\n",
    ['audit.css-unscoped@1'],
  ],
  [
    'a bare @import',
    "@import 'normalize.css';\n@import url(pkg/reset.css) screen;\n",
    ['audit.css-bare-import@1', 'audit.css-bare-import@2'],
  ],
  [
    'a remote url()',
    "[data-variant='acme-ocean'] { background: url(https://tracker.example.test/p.png); }\n@font-face { font-family: x; src: url('//cdn.example.test/x.woff2'); }\n",
    ['audit.css-remote-url@1', 'audit.css-unscoped@2', 'audit.css-remote-url@2'],
  ],
  [
    'a remote image-set() string',
    "[data-variant='acme-ocean'] { background-image: image-set('https://cdn.example.test/a.png' 1x); }\n",
    ['audit.css-remote-url@1'],
  ],
  [
    'keyframes named for anyone',
    '@keyframes spin { to { transform: rotate(1turn); } }\n@keyframes acme-ocean-spin { to { transform: rotate(1turn); } }\n',
    ['audit.css-keyframes@1'],
  ],
  [
    'physical properties inside keyframes',
    '@keyframes acme-ocean-slide { from { left: 0; } to { margin-right: 1rem; } }\n',
    ['audit.css-physical@1', 'audit.css-physical@1'],
    true,
  ],
  [
    'physical shorthands',
    "[data-variant='acme-ocean'] .x {\n  margin: 0 1rem 0 2rem;\n  inset: 0 auto 0 0;\n  border-radius: var(--ocean-radius) 0;\n  padding: 0 1rem;\n}\n",
    ['audit.css-physical@2', 'audit.css-physical@3', 'audit.css-physical@4'],
    true,
  ],
];

for (const [name, css, expected, rtl] of STYLE_BYPASSES) {
  test(`the stylesheet audit sees ${name}`, () => {
    const findings = audit({ 'src/styles.css': css }, { rtl: rtl ?? false });
    assert.deepEqual(
      findings.map(({ code, line }) => `${code}@${line}`),
      expected,
      findings.map(({ message }) => message).join(' | '),
    );
  });
}

test("appearance is the tokens' business: raw colors, fonts, radii, and shadows are findings", () => {
  const findings = audit({
    'src/styles.css': [
      "[data-variant='acme-ocean'] .a { color: #f00; }",
      "[data-variant='acme-ocean'] .b { background: rgb(0 0 0 / 50%); }",
      "[data-variant='acme-ocean'] .c { border: 1px solid tomato; }",
      "[data-variant='acme-ocean'] .d { font-family: 'Comic Sans MS'; }",
      "[data-variant='acme-ocean'] .e { font: 700 1rem Georgia; }",
      "[data-variant='acme-ocean'] .f { border-radius: 2rem; }",
      "[data-variant='acme-ocean'] .g { box-shadow: 0 0 2rem currentColor; }",
      "[data-variant='acme-ocean'] .h { filter: drop-shadow(0 0 1px); }",
      "[data-variant='acme-ocean'] .i { --ocean-accent: oklch(70% 0.1 200); }",
      // A token, the text's own color, a CSS-wide keyword, or nothing at all is fine.
      "[data-variant='acme-ocean'] .ok { color: var(--ink); border: 1px solid currentColor; font: inherit; border-radius: 0; box-shadow: none; background: transparent; outline-color: Highlight; grid-area: tan; }",
      "@font-face { font-family: 'Ocean'; src: url(./ocean.woff2); }",
    ].join('\n'),
  });
  assert.deepEqual(
    findings.filter(({ code }) => code === 'audit.css-appearance').map(({ line }) => line),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.match(findings[0]!.message, /sets color to #f00, a raw color/);
  assert.match(findings[0]!.remedy, /#19's appearance tokens: use var\(--\.\.\.\)/);
});

test("the fallback composition and the kit's shared stylesheet pass the appearance rule", () => {
  const packages = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
  assert.deepEqual(
    auditVariant({
      packageName: '@portfolio/fallback-composition',
      dir: path.join(packages, 'fallback-composition'),
      id: 'fallback',
      rtl: true,
    }),
    [],
  );
  assert.deepEqual(
    auditSharedStylesheet('@portfolio/kit', path.join(packages, 'kit'), 'src/sections/styles.css'),
    [],
  );
  // The check itself finds a raw value there.
  const kit = packageWith({ 'styles.css': ':where([data-variant] .x) { color: black; }\n' });
  assert.deepEqual(codes(auditSharedStylesheet('@portfolio/kit', kit, 'styles.css')), [
    'audit.css-appearance styles.css:1',
  ]);
});

test("what isn't a bypass stays quiet: a picked field, an indexed type, a handler, a local name", () => {
  const files = {
    'src/clock.tsx': [
      "'use client';",
      "import type { VariantRenderInput } from '@portfolio/variant-contract';",
      "export function Clock({ env }: { env: VariantRenderInput['env'] }) { return <p>{env.now}</p>; }",
      "export function Ids({ ids }: Pick<VariantRenderInput, 'ids'>) { return <p>{ids.main}</p>; }",
    ].join('\n'),
    'src/reveal.tsx': [
      "'use client';",
      "import { useState } from 'react';",
      'export function Reveal() {',
      '  const [node, setNode] = useState<JSX.Element | null>(null);',
      '  const onClick = async () => { await Promise.resolve(); setNode(<b>shown</b>); };',
      '  return <button onClick={onClick}>{node ?? "show"}</button>;',
      '}',
    ].join('\n'),
    'src/local.ts': [
      'const caches = new Map<string, number>();',
      "export const hit = () => caches.get('k');",
      "export const ssr = typeof window === 'undefined' || typeof process !== 'undefined';",
      'export const wide = () => window.matchMedia("(min-width: 40rem)").matches;',
      'export const day = (now: string) => new Intl.DateTimeFormat("en").format(new Date(now));',
      'export const later = (f: () => void) => setTimeout(f, 10);',
      'export const isDate = (value: unknown) => value instanceof Date;',
      'export type Handler = (event: Event) => Function;',
    ].join('\n'),
  };
  assert.deepEqual(audit(files), []);
});

test('the kit entries a variant imports are the ones its clock and randomness rules follow', () => {
  const dir = packageWith({
    'src/index.tsx': [
      "import { renderSection } from '@portfolio/kit/sections';",
      "import { ParticleField2D } from '@portfolio/kit/spatial';",
      "import { formatDate } from '@portfolio/kit';",
      'export { renderSection, ParticleField2D, formatDate };',
    ].join('\n'),
    'src/other.ts': "export { seededRandom } from '@portfolio/kit/sections';\n",
  });
  assert.deepEqual(kitImports(dir), ['.', './sections', './spatial']);
});

test('the CSS reader keeps positions, nesting, and strings', () => {
  const nodes = parseCss(
    "/* a } comment */\n.a { content: '}'; color: red }\n@media x { .b { margin: 0 } }\n",
  );
  assert.equal(nodes.length, 2);
  const [rule, media] = nodes;
  assert.ok(rule?.type === 'rule' && media?.type === 'at-rule');
  assert.deepEqual([rule.selector, rule.at], ['.a', { line: 2, column: 1 }]);
  assert.deepEqual(
    rule.children.map((child) =>
      child.type === 'declaration' ? [child.property, child.value] : [],
    ),
    [
      ['content', "'}'"],
      ['color', 'red'],
    ],
  );
  assert.deepEqual([media.name, media.prelude, media.at.line], ['@media', 'x', 3]);
  assert.deepEqual(splitSelectors(':is(.a, .b) > p, [data-x="a,b"] i'), [
    ':is(.a, .b) > p',
    '[data-x="a,b"] i',
  ]);
});
