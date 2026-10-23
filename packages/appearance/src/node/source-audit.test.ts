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
    ],
    good: [
      'border-radius: var(--ui-radius-card);',
      'border-radius: 0;',
      'border-end-end-radius: 0px;',
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
