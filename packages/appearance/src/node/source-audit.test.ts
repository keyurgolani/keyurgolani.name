import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  auditCodeText,
  auditStylesheetText,
  exceptionProblems,
  runSourceAudit,
  SOURCE_AUDIT_RULES,
  variantPackageDirs,
  type SourceAuditRule,
} from './source-audit';

// The appearance source audit (#19, Slice 5): each rule refuses its
// known-bad input and passes the token or keyword that replaces it, a
// reviewed exception covers exactly its file and rule, and an exception no
// finding needs fails.

const rulesIn = (css: string) => auditStylesheetText(css).map(({ rule }) => rule);
const rule = (css: string) => `[data-variant='acme'] .x {\n  ${css}\n}\n`;

/** Each rule's known-bad declarations, and what it accepts in their place. */
const CASES: Record<
  Exclude<SourceAuditRule, 'legacy-property'>,
  { bad: string[]; good: string[] }
> = {
  'color-literal': {
    bad: [
      'color: #fff;',
      'background: #1a2b3c;',
      'border-color: rgb(0 0 0);',
      'fill: oklch(0.5 0.1 200);',
      'outline-color: hsl(10 50% 50%);',
      'color: color(display-p3 1 0 0);',
    ],
    good: ['color: var(--color-text-primary);', 'color: currentColor;', 'background: transparent;'],
  },
  'font-family': {
    bad: ['font-family: Georgia, serif;', 'font: 1rem/1.5 system-ui;'],
    good: ['font-family: var(--type-body-font-family);', 'font: inherit;'],
  },
  'font-face': { bad: ['}\n@font-face { font-family: x; src: url(x.woff2); }\n.y {'], good: [] },
  import: { bad: ['}\n@import "./more.css";\n.y {'], good: [] },
  shadow: {
    bad: ['box-shadow: 0 1px 2px var(--color-shadow);', 'text-shadow: 1px 1px 0 currentColor;'],
    good: ['box-shadow: var(--ui-shadow-card);', 'box-shadow: none;', 'text-shadow: none;'],
  },
  radius: {
    bad: ['border-radius: 8px;', 'border-start-start-radius: 0.5rem;', 'border-radius: 50%;'],
    good: [
      'border-radius: var(--ui-radius-card);',
      'border-radius: 0;',
      'border-end-end-radius: 0px;',
    ],
  },
  blur: {
    bad: ['backdrop-filter: blur(8px);', 'filter: saturate(1.2) blur(2px);'],
    good: ['backdrop-filter: blur(var(--ui-backdrop-blur));', 'filter: none;'],
  },
  timing: {
    bad: [
      'transition: opacity 200ms ease;',
      'animation: acme-drift 12s linear infinite;',
      'transition-duration: .3s;',
      'animation-delay: 1s;',
    ],
    good: [
      'transition: opacity var(--ui-motion-fast) var(--ui-motion-easing);',
      'animation-duration: var(--ui-motion-slow);',
      'transition: none;',
    ],
  },
};

for (const [name, { bad, good }] of Object.entries(CASES)) {
  test(`${name}: refuses each known-bad value and passes its token`, () => {
    for (const declaration of bad) {
      assert.ok(rulesIn(rule(declaration)).includes(name as SourceAuditRule), declaration);
    }
    for (const declaration of good) {
      assert.deepEqual(rulesIn(rule(declaration)), [], declaration);
    }
  });
}

test('legacy-property: refuses the v1 properties, in a stylesheet and in code', () => {
  for (const css of [
    'color: var(--paper);',
    'background: var(--ink);',
    '--kc-glow: 1;',
    'gap: var(--vt-space);',
  ]) {
    assert.ok(rulesIn(rule(css)).includes('legacy-property'), css);
  }
  assert.deepEqual(rulesIn(rule('color: var(--paper-white-is-not-it, var(--color-canvas));')), []);
  assert.deepEqual(
    auditCodeText("const glow = 'var(--kc-glow)';").map(({ rule: name }) => name),
    ['legacy-property'],
  );
});

test('a layout property of the variant’s own may hold a length, but no color', () => {
  assert.deepEqual(rulesIn(rule('--layout-gutter: clamp(1rem, 4vw, 3rem);')), []);
  assert.deepEqual(rulesIn(rule('--layout-tint: #abcdef;')), ['color-literal']);
});

test('comments never count, in a stylesheet or in code', () => {
  assert.deepEqual(rulesIn('/* color: #fff; border-radius: 8px; @import x; */\n'), []);
  assert.deepEqual(
    auditCodeText("// #fff and rgb(0 0 0)\n/* @font-face */\nconst issue = 1; // #10b's route\n"),
    [],
  );
});

test('code: a color in a string is refused, and a fragment or an issue number is not', () => {
  const found = (source: string) => auditCodeText(source).map(({ rule: name }) => name);
  assert.deepEqual(found("ctx.fillStyle = '#ff0000';"), ['color-literal']);
  assert.deepEqual(found('const shade = `rgba(0, 0, 0, ${alpha})`;'), ['color-literal']);
  assert.deepEqual(found("style={{ border: '1px solid #ccc' }}"), ['color-literal']);
  assert.deepEqual(found("const href = '#main';"), []);
  assert.deepEqual(found("const note = 'see #19';"), []);
  assert.deepEqual(found("const fill = 'var(--color-accent)';"), []);
});

test('each finding names its line, and every rule has a case here', () => {
  const [finding] = auditStylesheetText('.a {}\n.b {\n  color: #000;\n}\n');
  assert.equal(finding?.line, 3);
  assert.deepEqual(
    [...Object.keys(CASES), 'legacy-property'].sort(),
    [...SOURCE_AUDIT_RULES].sort(),
  );
});

/** A scratch repository with one variant package, one file in it, and the kit's source. */
function scratch(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'appearance-audit-'));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}

test('it reads variant packages and the kit, skipping tests, fixtures, and other packages', () => {
  const root = scratch({
    'packages/variant-acme/package.json': JSON.stringify({ portfolio: { kind: 'variant' } }),
    'packages/variant-acme/src/styles.css': rule('color: #123456;'),
    'packages/variant-acme/src/plate.test.tsx': "const bad = '#123456';",
    'packages/variant-acme/src/__fixtures__/x.ts': "const bad = '#123456';",
    'packages/group/fixture-variant/package.json': JSON.stringify({
      portfolio: { kind: 'variant' },
    }),
    'packages/group/fixture-variant/src/index.tsx': "const bad = 'rgb(1 2 3)';",
    'packages/appearance-schemes/package.json': JSON.stringify({
      portfolio: { kind: 'color-scheme' },
    }),
    'packages/appearance-schemes/packs/x/notes.css': rule('color: #fff;'),
    'packages/kit/src/effect.tsx': "const glow = '#abcdef';",
  });
  try {
    const dirs = [
      ...variantPackageDirs(path.join(root, 'packages')),
      path.join(root, 'packages', 'kit', 'src'),
    ];
    const result = runSourceAudit(root, dirs, []);
    assert.deepEqual(
      result.findings.map(({ path: file, rule: name }) => `${file} ${name}`),
      [
        'packages/group/fixture-variant/src/index.tsx color-literal',
        'packages/variant-acme/src/styles.css color-literal',
        'packages/kit/src/effect.tsx color-literal',
      ],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a reviewed exception covers its file and rule alone, and one nothing needs fails', () => {
  const root = scratch({
    'packages/kit/src/photo.tsx': "const duotone = '#2b241c';",
    'packages/kit/src/other.tsx': "const tint = '#2b241c';",
  });
  const reviewed = {
    path: 'packages/kit/src/photo.tsx',
    rule: 'color-literal',
    reason: "The duotone is the photograph's own two colors, which no scheme sets.",
    reviewer: 'keyurgolani',
  };
  const stale = { ...reviewed, path: 'packages/kit/src/gone.tsx' };
  try {
    const dirs = [path.join(root, 'packages', 'kit', 'src')];
    const result = runSourceAudit(root, dirs, [reviewed, stale]);
    assert.deepEqual(result.exceptionProblems, []);
    assert.deepEqual(
      result.findings.map(({ path: file }) => file),
      ['packages/kit/src/other.tsx'],
    );
    assert.deepEqual(result.unused, [stale]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an exception needs a path, a real rule, a reason, and a reviewer, and nothing else', () => {
  const good = {
    path: 'packages/kit/src/a.ts',
    rule: 'radius',
    reason: 'A circle crop for an avatar, which is geometry.',
    reviewer: 'keyurgolani',
  };
  assert.deepEqual(exceptionProblems([good]), []);
  assert.equal(exceptionProblems({}).length, 1);
  for (const bad of [
    { ...good, rule: 'colour' },
    { ...good, reason: 'TODO' },
    { ...good, reason: 'short' },
    { ...good, reviewer: '' },
    { ...good, path: '/abs/a.ts' },
    { ...good, extra: true },
  ]) {
    assert.equal(exceptionProblems([bad]).length, 1, JSON.stringify(bad));
  }
  assert.equal(exceptionProblems([good, good]).length, 1, 'a repeat');
});
