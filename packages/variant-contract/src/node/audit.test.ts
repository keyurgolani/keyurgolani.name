import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditKitSections, auditVariant, type AuditFinding } from './audit';
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
    "[data-variant='acme-ocean'] .d { border-top-right-radius: 1rem; }",
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
