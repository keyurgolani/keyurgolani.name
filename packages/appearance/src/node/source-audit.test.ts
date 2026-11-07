import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  auditCodeText,
  auditStylesheetText,
  exceptionProblems,
  AUDIT_EXCEPTIONS_FILE,
  runSourceAudit,
  SOURCE_AUDIT_REMEDIES,
  SOURCE_AUDIT_RULES,
  sourceAuditReport,
  variantPackageDirs,
  type SourceAuditRule,
} from './source-audit';
import { ID_AXES } from '../axes';
import { boundaryAttributes, BOUNDARY_KINDS, isPlatformAttribute } from '../boundary';

// The appearance source audit (#19, Slice 5): each rule refuses its
// known-bad input and passes the token or keyword that replaces it, a
// reviewed exception covers exactly its file and rule, and an exception no
// finding needs fails.

/** The rules a variant's stylesheet breaks. */
const rulesIn = (css: string) =>
  auditStylesheetText(css, { variant: true }).map(({ rule }) => rule);
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
      'color: red;',
      'border: 1px solid black;',
      'background-color: CanvasText;',
      'color: var(--color-text-primary, white);',
    ],
    good: [
      'color: var(--color-text-primary);',
      'color: currentColor;',
      'background: transparent;',
      'color: inherit;',
      'border-color: var(--color-red-accent);',
      'grid-template-areas: "red blue";',
    ],
  },
  'font-family': {
    bad: [
      'font-family: Georgia, serif;',
      'font: 1rem/1.5 system-ui;',
      'font-family: var(--brand-font);',
      'font-family: var(--type-body-font-family, Georgia);',
    ],
    good: ['font-family: var(--type-body-font-family);', 'font: inherit;'],
  },
  'font-face': { bad: ['}\n@font-face { font-family: x; src: url(x.woff2); }\n.y {'], good: [] },
  import: { bad: ['}\n@import "./more.css";\n.y {'], good: [] },
  shadow: {
    bad: ['box-shadow: 0 1px 2px var(--color-shadow);', 'text-shadow: 1px 1px 0 currentColor;'],
    good: ['box-shadow: var(--ui-shadow-card);', 'box-shadow: none;', 'text-shadow: none;'],
  },
  radius: {
    bad: [
      'border-radius: 8px;',
      'border-start-start-radius: 0.5rem;',
      'border-radius: 50%;',
      'border-radius: var(--x, 999px);',
      'border-radius: var(--ui-radius-card, 4px);',
      '-moz-border-radius: 4px;',
      'clip-path: inset(0 round 24px);',
      'clip-path: rect(0 100% 100% 0 round 1rem / 2rem);',
      '-webkit-clip-path: xywh(0 0 100% 100% round var(--ui-radius-card, 8px));',
      'shape-outside: inset(1rem round var(--ui-border-card));',
    ],
    good: [
      'border-radius: var(--ui-radius-card);',
      'border-radius: 0;',
      'border-end-end-radius: 0px;',
      'clip-path: inset(0 round var(--ui-radius-card));',
      'clip-path: inset(50%);',
      'clip-path: circle(50%);',
      'clip-path: inset(0 round 0);',
      'shape-outside: inset(round(1.4rem, 1px) 0);',
    ],
  },
  blur: {
    bad: [
      'backdrop-filter: blur(8px);',
      'filter: saturate(1.2) blur(2px);',
      '-webkit-backdrop-filter: blur(8px);',
      'backdrop-filter: blur(var(--ui-backdrop-blur, 12px));',
    ],
    good: ['backdrop-filter: blur(var(--ui-backdrop-blur));', 'filter: none;'],
  },
  timing: {
    bad: [
      'transition: opacity 200ms ease;',
      'animation: acme-drift 12s linear infinite;',
      'transition-duration: .3s;',
      'animation-delay: 1s;',
      'transition-duration: 1.5S;',
      'animation-delay: 1e3ms;',
      'transition: opacity var(--ui-motion-fast, 200ms);',
      'transition: opacity var(--color-accent);',
    ],
    good: [
      'transition: opacity var(--ui-motion-fast) var(--ui-motion-easing);',
      'animation-duration: var(--ui-motion-slow);',
      'transition: none;',
    ],
  },
  'custom-property': {
    bad: ['--acme-tint: 1;', '--brand-gap: 2rem;'],
    good: ['--layout-gutter: 2rem;', 'gap: var(--layout-gutter);'],
  },
  'motion-gate': {
    bad: [
      'animation: acme-drift var(--motion-ambient) linear infinite;',
      'animation-name: acme-drift;\n  animation-iteration-count: infinite;',
      'animation: acme-drift var(--motion-ambient) linear 5000;',
      'animation-play-state: running;',
      // The shorthand after the state resets it to running.
      'animation-play-state: var(--motion-ambient-state);\n  animation: acme-drift var(--motion-ambient) linear infinite;',
    ],
    good: [
      'animation: acme-drift var(--motion-ambient) linear infinite;\n  animation-play-state: var(--motion-ambient-state);',
      'animation: acme-in var(--motion-scene) both;',
      'animation: acme-in var(--motion-scene) 3;',
      'animation-play-state: paused;',
    ],
  },
  'layout-line': {
    bad: [
      '--layout-line-hair: 1px solid;',
      '--layout-line-hair: 1px dotted var(--color-border-default);',
      '--layout-rule-strong: 0.1rem solid var(--color-text-primary);',
      '--layout-rule-card: 1px solid var(--ui-border-card);',
      '--layout-line-mixed: 1px solid color-mix(in oklab, var(--color-accent) 40%, var(--ui-glow));',
      '--layout-line-bare: var(--color-border-default);',
      '--layout-rule-double: 1px 2px solid var(--color-text-primary);',
    ],
    good: [
      // Geometry, not a line (K-5 review M3): a name ending in -height, -size, -length, -clamp, or -gap.
      '--layout-line-height: 1.5;',
      '--layout-line-size: var(--type-body-font-size);',
      '--layout-line-length: 66ch;',
      '--layout-rule-gap: var(--space-s);',
      '--layout-line-clamp: 3;',
      '--layout-line-hair: 1px solid var(--color-border-default);',
      '--layout-rule-strong: 2px dashed color-mix(in oklab, var(--color-text-primary) 40%, var(--color-canvas));',
      '--layout-line-ink: solid 1px currentColor;',
      '--layout-rule-tint: 0.5px solid color-mix(in srgb, currentColor 30%, transparent);',
    ],
  },
  // K-5 round 7 (R6-H1): the variant contract's at-rule list, and selector() as one pseudo compound.
  'at-rule': {
    bad: [
      '@scope (:not(&)) { * { color: inherit; } }',
      '@scope (& ~ *) { * { color: inherit; } }',
      '}\n@property --layout-a { syntax: "*"; inherits: true; }\n.y {',
      '}\n@counter-style acme { system: cyclic; symbols: x; }\n.y {',
      '}\n@page { margin: 0; }\n.y {',
      '}\n@font-feature-values Acme { @styleset { a: 1; } }\n.y {',
      '@starting-style { opacity: 0; }',
      '}\n@-webkit-keyframes acme-a { to { opacity: 1; } }\n.y {',
      '@whatever (x) { color: inherit; }',
      '@supports selector(:popover-open .a) { color: inherit; }',
      '@supports selector(:has(.a)) { color: inherit; }',
      '@supports not selector(div) { color: inherit; }',
    ],
    good: [
      '@media (min-width: 40rem) { color: inherit; }',
      '@supports (display: grid) { color: inherit; }',
      '@supports not selector(:popover-open) { color: inherit; }',
      '@supports selector(::details-content) { color: inherit; }',
      '@container (min-width: 20rem) { color: inherit; }',
      '}\n@layer acme { .y { color: inherit; } }\n.y {',
    ],
  },
  // K-5 round 5: no backslash outside a string, in a name, a value, or an unquoted url().
  escape: {
    bad: [
      'b\\ox-shadow: none;',
      'border-r\\adius: 0;',
      'transition: opacity 5\\73;',
      'color: #\\66 00;',
      'background-image: url(./a\\).png);',
      '--layout-a: \\};',
    ],
    good: ["content: '\\201C';", "content: '\\2009\\2197';", "content: '\\2212' / '';"],
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

test('code: a color function built only from interpolated values names no color, and one with a literal of its own does', () => {
  const found = (source: string) => auditCodeText(source).map(({ rule: name }) => name);
  // A color the code read elsewhere, such as a boundary's --color-<role>, written out for a canvas.
  assert.deepEqual(found('return `rgba(${r}, ${g}, ${b}, ${alpha})`;'), []);
  assert.deepEqual(
    found(
      "el.style.background = `linear-gradient(rgb(${a.map((c) => c * 255).join(',')}) 0%, rgb(${b}) 100%)`;",
    ),
    [],
  );
  assert.deepEqual(found('const shade = `rgb(${r} ${g} ${b} / 50%)`;'), ['color-literal']);
  assert.deepEqual(found('const red = `rgba(${r}, 0, 0, 1)`;'), ['color-literal']);
  assert.deepEqual(found('const fill = `oklch(${l} 0.1 ${h})`;'), ['color-literal']);
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

test("the report names each finding's line and remedy, each exception nothing needs, and a file that doesn't read", () => {
  const exception = {
    path: 'packages/kit/src/photo.tsx',
    rule: 'color-literal',
    reason: "The duotone is the photograph's own two colors, which no scheme sets.",
    reviewer: 'keyurgolani',
  };
  const root = scratch({
    'packages/variant-acme/package.json': JSON.stringify({ portfolio: { kind: 'variant' } }),
    'packages/variant-acme/src/styles.css': rule('box-shadow: 0 1px 2px black;'),
    'packages/kit/src/photo.tsx': "const duotone = '#2b241c';",
    [AUDIT_EXCEPTIONS_FILE]: JSON.stringify([
      exception,
      { ...exception, path: 'packages/kit/src/gone.tsx' },
    ]),
  });
  try {
    const report = sourceAuditReport(root);
    assert.deepEqual(report.lines, [
      `packages/variant-acme/src/styles.css:2 color-literal: box-shadow: 0 1px 2px black; ${SOURCE_AUDIT_REMEDIES['color-literal']}`,
      `packages/variant-acme/src/styles.css:2 shadow: box-shadow: 0 1px 2px black; ${SOURCE_AUDIT_REMEDIES.shadow}`,
      `${AUDIT_EXCEPTIONS_FILE} excepts packages/kit/src/gone.tsx from color-literal, which no finding needs anymore. Remove the exception.`,
    ]);
    assert.equal(report.files, 2);
    assert.equal(report.exceptions, 2);
    fs.writeFileSync(path.join(root, AUDIT_EXCEPTIONS_FILE), '[{');
    const broken = sourceAuditReport(root);
    assert.equal(broken.lines.length, 1);
    assert.match(broken.lines[0]!, new RegExp(`^${AUDIT_EXCEPTIONS_FILE} doesn't read: `));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the repository passes its own audit: every finding has a reviewed exception, and every exception a finding', () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
  const report = sourceAuditReport(root);
  assert.deepEqual(report.lines, []);
  // Variant packages and the kit, not nothing.
  assert.ok(report.files > 50, `${report.files} files`);
  const exceptions = JSON.parse(
    fs.readFileSync(path.join(root, AUDIT_EXCEPTIONS_FILE), 'utf8'),
  ) as { reviewer: string }[];
  assert.ok(exceptions.length > 0 && exceptions.length === report.exceptions);
});

test('a declaration counts whole across the lines Prettier splits it over, on the line it starts', () => {
  const css = [
    "[data-variant='acme'] .x {",
    '  transition:',
    '    opacity 200ms ease,',
    '    transform var(--ui-motion-fast);',
    '  box-shadow:',
    '    0 1px 2px var(--color-shadow),',
    '    var(--ui-shadow-card);',
    '  font-family:',
    '    Georgia,',
    '    serif;',
    '}',
    '',
  ].join('\n');
  assert.deepEqual(
    auditStylesheetText(css).map(({ line, rule: name }) => `${line} ${name}`),
    ['2 timing', '5 shadow', '8 font-family'],
  );
  // A data: URL's semicolon ends nothing.
  assert.deepEqual(
    rulesIn(rule("background-image: url('data:image/svg+xml;utf8,<svg/>');\n  color: #fff;")),
    ['color-literal'],
  );
});

test("a --layout-* property passes where it's read only when its own value passes", () => {
  const sheet = (layout: string, use: string) =>
    `[data-variant='acme'] { --layout-corner: ${layout}; }\n[data-variant='acme'] .x { ${use} }\n`;
  assert.deepEqual(rulesIn(sheet('8px', 'border-radius: var(--layout-corner);')), ['radius']);
  assert.deepEqual(
    rulesIn(sheet('var(--ui-radius-card)', 'border-radius: var(--layout-corner);')),
    [],
  );
  assert.deepEqual(rulesIn(sheet('300ms', 'transition: opacity var(--layout-corner);')), [
    'timing',
  ]);
  assert.deepEqual(rulesIn(sheet('2rem', 'border-radius: var(--layout-nowhere);')), ['radius']);
});

test('custom-property: only a variant stylesheet is held to --layout-* properties', () => {
  assert.deepEqual(
    auditStylesheetText(rule('--kit-gap: 1rem;')).map(({ rule: name }) => name),
    [],
  );
  assert.deepEqual(rulesIn(rule('--kit-gap: 1rem;')), ['custom-property']);
});

test('code: a string under a style key, in a style attribute, or in a stylesheet meets the stylesheet rules', () => {
  const found = (source: string) =>
    auditCodeText(source)
      .map(({ rule: name }) => name)
      .sort();
  for (const [source, expected] of [
    ["const s = { boxShadow: '0 1px 2px var(--color-shadow)' };", ['shadow']],
    ["const s = { borderRadius: '8px' };", ['radius']],
    ["const s = { filter: 'blur(4px)' };", ['blur']],
    ["const s = { WebkitBackdropFilter: 'blur(4px)' };", ['blur']],
    ["const s = { transition: 'opacity 0.2s ease' };", ['timing']],
    ['const s = { animation: `spin ${speed}s linear` };', []],
    ["const s = { fontFamily: 'Georgia, serif' };", ['font-family']],
    ["const s = { 'border-radius': '4px' };", ['radius']],
    ["el.style.boxShadow = '0 0 4px var(--color-accent)';", ['shadow']],
    ["el.style['transition'] = 'opacity 1s';", ['timing']],
    ["const css = 'border-radius: 6px; transition: opacity 1s';", ['radius', 'timing']],
    ['const sheet = `.x { border-radius: 8px; }`;', ['radius']],
    ["const s = { borderRadius: 'var(--ui-radius-card)' };", []],
    ["const s = { transition: 'opacity var(--ui-motion-fast) var(--ui-motion-easing)' };", []],
    ['const s = { backdropFilter: `blur(${glass}) saturate(140%)` };', []],
    ["const note = 'Note: one thing';", []],
  ] as const) {
    assert.deepEqual(found(source), [...expected].sort(), source);
  }
  // A stylesheet in a template literal reports the line each rule is on.
  const lines = auditCodeText(
    ['const sheet = `', '  .x {', '    border-radius: 8px;', '  }', '`;', ''].join('\n'),
  ).map(({ line, rule: name }) => `${line} ${name}`);
  assert.deepEqual(lines, ['3 radius']);
});

test('code: what an interpolation holds is code, so a string in it is checked, and a template across lines is one string', () => {
  const found = (source: string) => auditCodeText(source).map(({ rule: name }) => name);
  for (const source of [
    "const a = `${c ?? '#ff0000'}`;",
    "const a = `${'#fff'}`;",
    "const a = `${x ? 'rgb(1 2 3)' : y}`;",
    'const a = `${fallback("rgb(1 2 3)")}`;',
    'const a = `\n  color: #fff;\n`;',
    'const a = `${`${"#abc"}`}`;',
  ]) {
    assert.deepEqual(found(source), ['color-literal'], source);
  }
  assert.deepEqual(found('return `rgba(${r}, ${g}, ${b}, ${alpha})`;'), []);
  assert.deepEqual(found('const r = /["\'`]/;\nconst x = `${y}`;\n'), []);
});

test('code: a named color assigned to a canvas or a color style key is a color literal, and a word that names one is not', () => {
  const found = (source: string) => auditCodeText(source).map(({ rule: name }) => name);
  for (const source of [
    "ctx.fillStyle = 'black';",
    "ctx.strokeStyle = 'White';",
    "const s = { color: 'red' };",
    "const s = { backgroundColor: 'canvas' };",
    "el.style.color = 'blue';",
  ]) {
    assert.deepEqual(found(source), ['color-literal'], source);
  }
  for (const source of [
    "const label = 'red';",
    "const s = { color: 'currentColor' };",
    "const s = { color: 'transparent' };",
    "const s = { color: 'var(--color-text-primary)' };",
  ]) {
    assert.deepEqual(found(source), [], source);
  }
});

test('a --layout-* property declared twice passes where it is read only when every value it takes passes', () => {
  const twice = (second: string, use: string) =>
    `[data-variant='acme'] .a { --layout-r: 12px; ${use} }\n[data-variant='acme'] .b { --layout-r: ${second}; }\n`;
  assert.deepEqual(rulesIn(twice('0', 'border-radius: var(--layout-r);')), ['radius']);
  assert.deepEqual(
    rulesIn(
      `[data-variant='acme'] .a { --layout-r: 0; border-radius: var(--layout-r); }\n` +
        `[data-variant='acme'] .b { --layout-r: 12px; }\n`,
    ),
    ['radius'],
  );
  assert.deepEqual(
    rulesIn(
      `[data-variant='acme'] .a { --layout-t: var(--ui-duration-short); transition: opacity var(--layout-t); }\n` +
        `[data-variant='acme'] .b { --layout-t: 300ms; }\n`,
    ),
    ['timing'],
  );
  assert.deepEqual(
    rulesIn(
      `[data-variant='acme'] .a { --layout-r: var(--ui-radius-card); border-radius: var(--layout-r); }\n` +
        `[data-variant='acme'] .b { --layout-r: 0; }\n`,
    ),
    [],
  );
});

test('every CSS named and system color is a literal, in a color property, a layout property, a gradient in any property, and code', () => {
  for (const css of [
    'color: tomato;',
    'color: rebeccapurple;',
    'background-image: linear-gradient(black, white);',
    'mask-image: linear-gradient(black, transparent);',
    '-webkit-mask-image: radial-gradient(circle, white 40%, transparent);',
    'border-image: linear-gradient(to right, gold, transparent) 1;',
    'background: CanvasText;',
    'list-style-image: repeating-linear-gradient(navy, transparent 2px);',
    '--layout-x: tomato;',
  ]) {
    assert.deepEqual(rulesIn(rule(css)), ['color-literal'], css);
  }
  for (const css of [
    'transition-property: background-color, color;',
    'mask-image: linear-gradient(currentColor, transparent);',
    "background-image: url('./white.png');",
    'background: url(./white.png) no-repeat;',
    '--layout-angle: tan(30deg);',
    'mask-mode: alpha;',
  ]) {
    assert.deepEqual(rulesIn(rule(css)), [], css);
  }
  assert.deepEqual(
    auditCodeText("const s = { color: 'tomato' };").map(({ rule: name }) => name),
    ['color-literal'],
  );
});

test('custom-property: a variant’s code sets no token but its own --layout-* ones', () => {
  const variantCode = (source: string) =>
    auditCodeText(source, { variant: true }).map(({ rule: name }) => name);
  for (const source of [
    "const s = { '--ui-radius-card': '24px' };",
    'const s = { "--ui-shadow-card": shadow };',
    "<div style={{ '--color-text-primary': ink }} />",
    "el.style.setProperty('--ui-blur-glass', value);",
    "el.style['--type-body'] = family;",
  ]) {
    assert.ok(variantCode(source).includes('custom-property'), source);
    assert.ok(
      !auditCodeText(source)
        .map(({ rule: name }) => name)
        .includes('custom-property'),
      source,
    );
  }
  for (const source of [
    "const s = { '--layout-columns': count };",
    "el.style.setProperty('--layout-gap', gap);",
    "const name = '--ui-radius-card';",
  ]) {
    assert.deepEqual(variantCode(source), [], source);
  }
});

test('a --layout-* property the package’s code sets fails closed where its stylesheet reads it', () => {
  const root = scratch({
    'packages/variant-acme/package.json': JSON.stringify({ portfolio: { kind: 'variant' } }),
    'packages/variant-acme/src/styles.css':
      "[data-variant='acme'] .x { --layout-r: 0; border-radius: var(--layout-r); }\n" +
      "[data-variant='acme'] .y { --layout-g: 0; border-radius: var(--layout-g); }\n",
    'packages/variant-acme/src/index.tsx': "export const s = { '--layout-r': radius };\n",
  });
  try {
    const result = runSourceAudit(root, variantPackageDirs(path.join(root, 'packages')), []);
    assert.deepEqual(
      result.findings.map(({ path: file, line, rule: name }) => `${file}:${line} ${name}`),
      ['packages/variant-acme/src/styles.css:1 radius'],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('code: setProperty() meets the rules of the property it sets', () => {
  const found = (source: string) => auditCodeText(source).map(({ rule: name }) => name);
  assert.deepEqual(found("el.style.setProperty('border-radius', '12px');"), ['radius']);
  assert.deepEqual(found("el.style.setProperty('transition', 'opacity 300ms');"), ['timing']);
  assert.deepEqual(found("el.style.setProperty('border-radius', 'var(--ui-radius-card)');"), []);
});

test('motion-gate: a loop reads the ambient state in its own rule, under the kit runtime or not, nested or not (K-4, OWN-1)', () => {
  const css = (body: string) => `${body}\n`;
  // Kinetic's pattern: the loop runs only under the kit runtime's attribute, and pauses through the state.
  assert.deepEqual(
    rulesIn(
      css(
        "[data-variant='acme'] .stage[data-kit-runtime] .orbit {\n  animation: acme-spin var(--motion-ambient) linear infinite;\n  animation-play-state: var(--motion-ambient-state);\n}",
      ),
    ),
    [],
  );
  // The kit runtime's attribute alone no longer gates a loop: the runtime's pause holds loops
  // only through the state, so a one-shot entrance below a paused root plays to its end (OWN-1).
  assert.deepEqual(
    rulesIn(
      css(
        "[data-variant='acme'] .stage[data-kit-runtime] .orbit {\n  animation: acme-spin var(--motion-ambient) linear infinite;\n}",
      ),
    ),
    ['motion-gate'],
  );
  assert.deepEqual(
    rulesIn(
      css(
        "[data-variant='acme'] .stage[data-kit-runtime] {\n  & .orbit {\n    animation: acme-spin var(--motion-ambient) linear infinite;\n  }\n}",
      ),
    ),
    ['motion-gate'],
  );
  // A nested rule sets its own state, and a later @media shorthand needs its own state.
  assert.deepEqual(
    rulesIn(
      css(
        "[data-variant='acme'] .stage[data-kit-runtime] {\n  & .orbit {\n    animation: acme-spin var(--motion-ambient) linear infinite;\n    animation-play-state: var(--motion-ambient-state);\n  }\n}",
      ),
    ),
    [],
  );
  assert.deepEqual(
    rulesIn(
      css(
        "[data-variant='acme'] .sky {\n  animation: acme-drift var(--motion-ambient) linear infinite;\n  animation-play-state: var(--motion-ambient-state);\n}\n@media (min-width: 60em) {\n  [data-variant='acme'] .sky {\n    animation: acme-drift var(--motion-ambient) linear infinite;\n  }\n}",
      ),
    ),
    ['motion-gate'],
  );
  // An ungated loop in a nested rule is found too.
  assert.deepEqual(
    rulesIn(
      css(
        "[data-variant='acme'] .sky {\n  color: var(--color-text-primary);\n  & .bead {\n    animation: acme-travel var(--motion-ambient) linear infinite;\n  }\n}",
      ),
    ),
    ['motion-gate'],
  );
  // Keyframes hold no loop of their own.
  assert.deepEqual(
    rulesIn(
      css(
        '@keyframes acme-drift {\n  from {\n    opacity: 1;\n  }\n  to {\n    opacity: 0.6;\n  }\n}',
      ),
    ),
    [],
  );
  // Only a variant's stylesheet answers for it.
  assert.deepEqual(
    auditStylesheetText('.a {\n  animation: spin var(--ui-motion-slow) infinite;\n}\n').map(
      ({ rule }) => rule,
    ),
    [],
  );
});

test("motion-gate: no selector stands in for the ambient state, and a variant can't set the kit's gate (K-4 round 2, OWN-1)", () => {
  const loop = (selector: string) =>
    rulesIn(`${selector} {\n  animation: acme-spin var(--motion-ambient) linear infinite;\n}\n`);
  for (const selector of [
    "[data-variant='acme'] .stage[data-kit-runtime] .orbit",
    "[data-variant='acme'] .stage[data-kit-runtime='active'] > .orbit",
    "[data-variant='acme'] .stage[data-kit-runtime=paused] .orbit",
    "[data-variant='acme'] .orbit[data-kit-runtime]",
    "[data-variant='acme'] .stage[data-runtime] .orbit",
    "[data-variant='acme'] .stage:not([data-kit-runtime]) .orbit",
    "[data-variant='acme'] :is([data-kit-runtime], *) .orbit",
    "[data-variant='acme'] .stage[data-kit-runtime] ~ .orbit",
  ])
    assert.deepEqual(loop(selector), ['motion-gate'], selector);
  // Hard-coding the gate in a variant's markup or code is refused.
  const code = (text: string) => auditCodeText(text, { variant: true }).map(({ rule }) => rule);
  assert.deepEqual(code('export const Stage = () => <div data-kit-runtime="active" />;'), [
    'motion-gate',
  ]);
  assert.deepEqual(code("node.dataset.kitRuntime = 'active';"), ['motion-gate']);
  assert.deepEqual(code("node.setAttribute('data-kit-runtime', 'active');"), ['motion-gate']);
  // A comment naming it, and the kit's own code, are fine.
  assert.deepEqual(code('// runs under data-kit-runtime\nexport const x = 1;'), []);
  assert.deepEqual(auditCodeText("root.setAttribute('data-kit-runtime', 'active');"), []);
});

test("K-5's amendments: each allowed form passes the source audit, and raw color, radius, and shadow literals stay refused", () => {
  const passes = (css: string) => assert.deepEqual(rulesIn(css), [], css);
  const refused = (css: string, expected: SourceAuditRule) =>
    assert.ok(rulesIn(css).includes(expected), `${expected}: ${css}`);
  // --layout-line-* and --layout-rule-*: a px width, solid or dashed, and a role color,
  // read through a --layout-* color the file declares (Schematic's line types).
  passes(
    [
      "[data-variant='acme'] {",
      '  --layout-ink-hair: color-mix(in oklab, var(--color-border-strong) 26%, var(--color-canvas));',
      '  --layout-line-hair: 1px solid var(--layout-ink-hair);',
      '  --layout-rule-heavy: 2px dashed var(--color-border-strong);',
      '}',
      "[data-variant='acme'] .x {",
      '  border-block-end: var(--layout-line-hair);',
      '  border-inline-start: var(--layout-rule-heavy);',
      '}',
      '',
    ].join('\n'),
  );
  refused(
    "[data-variant='acme'] {\n  --layout-ink: var(--ui-glow);\n  --layout-line-a: 1px solid var(--layout-ink);\n}\n",
    'layout-line',
  );
  refused("[data-variant='acme'] {\n  --layout-line-a: 1px solid #333;\n}\n", 'color-literal');
  // The badge radius joins the per-component choices.
  passes(rule('border-radius: var(--ui-radius-badge);'));
  // --layout-round: 50%, for Schematic's balloons, and nothing else.
  passes(
    "[data-variant='acme'] {\n  --layout-round: 50%;\n}\n[data-variant='acme'] .x {\n  border-radius: var(--layout-round);\n}\n",
  );
  refused(
    "[data-variant='acme'] {\n  --layout-round: 40%;\n}\n[data-variant='acme'] .x {\n  border-radius: var(--layout-round);\n}\n",
    'radius',
  );
  refused(rule('border-radius: var(--layout-round);'), 'radius');
  refused(rule('border-radius: 50%;'), 'radius');
  // A mask and a clip-path on a pseudo-element, for Schematic's draw-on and Terra's arc:
  // black, white, and transparent are alpha there.
  passes(
    "[data-variant='acme'] .x::after {\n  mask: linear-gradient(#000 0 0) right center / 100% 100% no-repeat;\n  -webkit-mask-image: conic-gradient(black var(--layout-arc), transparent 0);\n  clip-path: inset(0 50% 0 0);\n}\n",
  );
  passes(
    "[data-variant='acme'] .x::before, [data-variant='acme'] .y::after {\n  mask-image: linear-gradient(white, transparent);\n}\n",
  );
  passes(rule('clip-path: circle(50%);'));
  // On an element, or with a color of its own, a mask's color is a color.
  refused(rule('mask-image: linear-gradient(#000, transparent);'), 'color-literal');
  refused(
    "[data-variant='acme'] .x::after {\n  mask-image: linear-gradient(#ff0000, transparent);\n}\n",
    'color-literal',
  );
  refused(
    "[data-variant='acme'] .x::after {\n  background: linear-gradient(black, transparent);\n}\n",
    'color-literal',
  );
  // Empty generated content, for Mission Control's lamps.
  passes("[data-variant='acme'] .x::before {\n  content: '';\n}\n");
  // --layout-* under the root with attribute selectors of the composition's own (Terra's
  // data-tf-field), the platform's defaults included, and under span selectors (MC).
  passes(
    "[data-variant='acme'][data-tf-field='quiet'] {\n  --layout-grid-columns: 6;\n  --layout-field-ground: var(--color-surface-prominent);\n}\n",
  );
  passes(
    "[data-variant='acme'] .x[data-span='10'], [data-variant='acme'] [data-span=\"4\"] {\n  --layout-span: 10;\n  grid-column: span var(--layout-span);\n}\n",
  );
  // The boundary's and the packs' attributes aren't the composition's, and a descendant
  // still can't take the platform's defaults.
  for (const selector of [
    "[data-variant='acme'][data-motion='reduced']",
    "[data-variant='acme'][data-color-scheme='paper-ink']",
    "[data-variant='acme']:hover",
    "[data-variant='acme'] [data-span='10']",
  ])
    refused(`${selector} {\n  --layout-grid-columns: 6;\n}\n`, 'custom-property');
  // The code role's family at the body role's size, for Shell's machine lines.
  passes(
    rule('font-family: var(--type-code-font-family);\n  font-size: var(--type-body-font-size);'),
  );
  // :has(), initial-letter, and a scroll timeline, for Chapters, Terra, and Shell.
  passes("[data-variant='acme'] .x:has(> img) {\n  display: grid;\n}\n");
  passes("[data-variant='acme'] .x::first-letter {\n  initial-letter: 3;\n}\n");
  passes(
    "@supports (animation-timeline: scroll()) {\n  [data-variant='acme'] .x {\n    animation: acme-grow linear both;\n    animation-timeline: scroll();\n  }\n}\n",
  );
  // Raw color, radius, and shadow literals stay refused.
  refused(rule('color: #ff0000;'), 'color-literal');
  refused(rule('border-radius: 6px;'), 'radius');
  refused(rule('box-shadow: 0 1px 2px var(--color-shadow);'), 'shadow');
  refused(
    rule('text-decoration-color: color-mix(in oklab, currentColor 40%, #f00);'),
    'color-literal',
  );
});

test("the root rule refuses every attribute the boundary can set, and the kit runtime's, from boundary.ts's one list (K-5 review H1)", () => {
  // Every attribute boundaryAttributes() sets: every axis fallen back, a diagnostic, both kinds.
  const selection = {
    variant: 'acme',
    designLanguage: 'platform-neutral',
    colorScheme: 'warm-parchment',
    typography: 'humanist-ui',
    displayMode: 'light',
  };
  const names = new Set<string>();
  for (const kind of BOUNDARY_KINDS) {
    const attributes = boundaryAttributes(
      {
        selection,
        requested: { ...selection, colorScheme: 'missing' },
        resolvedMode: 'light',
        modeLocked: true,
        contrast: 'more',
        motion: 'reduced',
        enhancement: 'off',
        fallbackAxes: [...ID_AXES],
        diagnostics: [{ code: 'appearance.mode-incompatible' }],
      } as never,
      kind,
    );
    for (const name of Object.keys(attributes)) names.add(name);
  }
  assert.ok(names.size >= 16, [...names].join(' '));
  for (const name of [...names, 'data-activity', 'data-kit-runtime']) {
    assert.ok(isPlatformAttribute(name), name);
    for (const selector of [
      `[data-variant='acme'][${name}]`,
      `[data-variant='acme'][${name}='x']`,
    ]) {
      const css = `${selector} {\n  --layout-grid-columns: 6;\n}\n`;
      assert.deepEqual(rulesIn(css), ['custom-property'], css);
    }
  }
  // The review's probes, each a mode, a plate, or a fallback moving the platform's defaults.
  for (const [selector, declaration] of [
    ["[data-variant='acme'][data-enhancement='off']", '--layout-motion-scene: 900ms;'],
    ["[data-variant='acme'][data-mode-locked='true']", '--layout-grid-columns: 4;'],
    ["[data-variant='acme'][data-requested-color-scheme='x']", '--layout-width-page: 60rem;'],
    ["[data-variant='acme'][data-appearance-fallback]", '--layout-width-page: 60rem;'],
    [
      "[data-variant='acme'][data-appearance-diagnostics~='appearance.mode-incompatible']",
      '--layout-grid-columns: 4;',
    ],
  ])
    assert.deepEqual(
      rulesIn(`${selector} {\n  ${declaration}\n}\n`),
      ['custom-property'],
      selector,
    );
  // A composition's own attribute still passes.
  assert.deepEqual(
    rulesIn("[data-variant='acme'][data-tf-field='quiet'] {\n  --layout-grid-columns: 6;\n}\n"),
    [],
  );
});

test('the root rule stays the root rule under @media, @layer, @supports, and a @container size query, and under no other at-rule (K-5 delta review Nit1)', () => {
  const root = "[data-variant='acme'] {\n  --layout-grid-columns: 4;\n}\n";
  for (const prelude of [
    '@media (min-width: 60em)',
    '@layer acme',
    '@supports (display: grid)',
    '@container (min-width: 40em)',
    '@container acme (inline-size > 30em)',
    '@media (min-width: 60em) {\n@layer acme',
  ]) {
    const css = `${prelude} {\n${root}}\n${prelude.includes('{') ? '}\n' : ''}`;
    assert.deepEqual(rulesIn(css), [], css);
  }
  for (const prelude of [
    "@scope ([data-enhancement='off'])",
    '@scope (.x) to (.y)',
    '@container style(--acme-dense: 1)',
    '@container acme scroll-state(stuck: top)',
    '@supports selector(:has(a))',
    '@supports (display: grid) and selector(:has(a))',
    '@starting-style',
    "@media (min-width: 60em) {\n@scope ([data-enhancement='off'])",
    "@scope ([data-enhancement='off']) {\n@media (min-width: 60em)",
  ]) {
    const css = `${prelude} {\n${root}}\n${prelude.includes('{') ? '}\n' : ''}`;
    // @scope, @starting-style, and a selector() reading :has() are off the list too (K-5 round 7).
    const atRule = /@scope|@starting-style|selector\(/.test(prelude) ? ['at-rule'] : [];
    assert.deepEqual(rulesIn(css), ['custom-property', ...atRule], css);
  }
  // The review's probe, a declaration straight in @scope, and a nested rule under one.
  for (const css of [
    "@scope ([data-enhancement='off']) {\n  [data-variant='acme'] {\n    --layout-grid-columns: 4;\n  }\n}\n",
    "@scope ([data-variant='acme']) {\n  --layout-grid-columns: 4;\n}\n",
    "@scope ([data-enhancement='off']) {\n  [data-variant='acme'] {\n    @media (min-width: 60em) {\n      --layout-grid-columns: 4;\n    }\n  }\n}\n",
  ])
    assert.deepEqual(rulesIn(css), ['custom-property', 'at-rule'], css);
});

test("a composition declares no property in the platform's namespaces, and reads only the platform's own tokens (K-5 delta review K5-H1)", () => {
  for (const declaration of [
    '--ui-acme-glow: 0 0 24px var(--color-accent);',
    '--ui-radius-acme: 12pt;',
    '--ui-shadow-raised: 0 0 24px var(--color-accent);',
    '--ui-radius-control: 40px;',
    '--color-accent: color-mix(in oklab, var(--color-canvas) 10%, transparent);',
    '--type-body-font-size: 30px;',
    '--space-m: 3rem;',
    '--motion-scene: 5s;',
  ])
    assert.ok(rulesIn(rule(declaration)).includes('custom-property'), declaration);
  // A token name the platform doesn't define reads as no token at all.
  assert.deepEqual(rulesIn(rule('border-radius: var(--ui-radius-acme);')), ['radius']);
  assert.deepEqual(rulesIn(rule('box-shadow: var(--ui-acme-glow);')), ['shadow']);
  assert.deepEqual(rulesIn(rule('transition: opacity var(--ui-motion-acme);')), ['timing']);
  assert.deepEqual(rulesIn(rule('border-radius: var(--ui-radius-control);')), []);
  assert.deepEqual(rulesIn(rule('transition: opacity var(--ui-motion-fast);')), []);
});

test("a '/*' or a '*/' inside a string hides nothing from the source audit (K-5 round 3, R3-H2)", () => {
  assert.deepEqual(
    rulesIn(
      rule("content: '/*';\n  border-radius: 35px;\n  box-shadow: 0 0 40px red;\n  content: '*/';"),
    ),
    ['radius', 'color-literal', 'shadow'],
  );
  assert.deepEqual(rulesIn(rule('content: "*/";\n  color: #f00;')), ['color-literal']);
  assert.deepEqual(rulesIn(rule(`content: 'say "/*"';\n  color: #f00;`)), ['color-literal']);
  // Across rules, the root-only rule reads past the pair too.
  assert.deepEqual(
    rulesIn(
      `${rule("content: '/*';")}[data-variant='acme'] .y {\n  --layout-grid-columns: 4;\n}\n${rule("content: '*/';")}`,
    ),
    ['custom-property'],
  );
});

test('row 73: a variant stylesheet sets --color-focus and --ui-focus-offset in their value forms, on any selector', () => {
  const at = (selector: string, css: string) => `${selector} {\n  ${css}\n}\n`;
  for (const selector of [
    "[data-variant='acme'] .band",
    "[data-variant='acme'] .stage:focus-visible",
    "[data-variant='acme']",
  ]) {
    for (const css of [
      '--color-focus: var(--color-on-scrim);',
      '--color-focus: var(--color-focus-inverse);',
      '--color-focus: var(--color-text-primary);',
      '--color-focus: var(--color-on-accent);',
      '--color-focus: var(--color-on-emphasis);',
      '--ui-focus-offset: calc(var(--ui-focus-width) * -1);',
      '--ui-focus-offset: 0;',
      '--ui-focus-offset: var(--space-3xs);',
    ]) {
      assert.deepEqual(rulesIn(at(selector, css)), [], `${selector} { ${css} }`);
    }
  }
  // The remedy says what a composition may set, and how.
  assert.match(
    SOURCE_AUDIT_REMEDIES['custom-property'],
    /--color-focus only as var\(--color-on-scrim\), var\(--color-focus-inverse\), var\(--color-text-primary\), var\(--color-on-accent\), or var\(--color-on-emphasis\)/,
  );
});

test('row 73: any other value of the two, any other platform property, and either one set from code, is refused', () => {
  for (const css of [
    '--color-focus: red;',
    '--color-focus: var(--color-surface);',
    '--color-focus: var(--color-surface-default);',
    '--color-focus: var(--color-text-inverse);',
    '--color-focus: var(--color-on-scrim, white);',
    '--ui-focus-offset: -10px;',
    '--ui-focus-offset: 0px;',
    '--ui-focus-offset: calc(var(--ui-focus-width) * -2);',
    '--ui-focus-offset: var(--space-huge);',
    '--ui-focus-width: 4px;',
    '--ui-focus-style: dashed;',
    '--color-focus-inverse: var(--color-on-scrim);',
  ]) {
    assert.ok(rulesIn(rule(css)).includes('custom-property'), css);
  }
  // A stylesheet's rule alone sets them: code's inline style is in no layer.
  const variantCode = (source: string) =>
    auditCodeText(source, { variant: true }).map(({ rule: name }) => name);
  for (const source of [
    "const s = { '--color-focus': 'var(--color-on-scrim)' };",
    "<div style={{ '--ui-focus-offset': '0' }} />",
    "el.style.setProperty('--color-focus', 'var(--color-on-accent)');",
    "const css = '--ui-focus-offset: var(--space-3xs)';",
  ]) {
    assert.ok(variantCode(source).includes('custom-property'), source);
  }
  // The kit's and a non-variant stylesheet's custom properties aren't held, as before.
  assert.deepEqual(
    auditStylesheetText(rule('--color-focus: red;')).map(({ rule: name }) => name),
    [],
  );
});
