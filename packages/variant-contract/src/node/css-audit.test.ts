import test from 'node:test';
import assert from 'node:assert/strict';
import { appearanceProblem, auditStylesheet } from './css-audit';

// A composition designs its own elements from the tokens (docs/variants.md,
// Styling conventions): it chooses among the language's radius, border, and
// shadow tokens, the type steps, and the role surfaces, and never writes a
// value of its own.

test('the element-design forms a composition may write all pass', () => {
  const allowed: [string, string][] = [
    ['border-radius', '0'],
    ['border-radius', 'var(--ui-radius-control)'],
    ['border-radius', 'var(--ui-radius-card)'],
    ['border-start-start-radius', 'var(--ui-radius-media)'],
    ['border-radius', 'var(--ui-radius-overlay)'],
    ['border', 'var(--ui-border-divider)'],
    ['border-block-end', 'var(--ui-border-control)'],
    ['border', 'var(--ui-border-card)'],
    ['box-shadow', 'none'],
    ['box-shadow', 'var(--ui-shadow-raised)'],
    ['box-shadow', 'var(--ui-shadow-raised), var(--ui-shadow-overlay)'],
    ['font-size', 'var(--type-step-5)'],
    ['font-weight', 'var(--type-display-font-weight)'],
    ['background', 'var(--color-canvas)'],
    ['background-color', 'var(--color-surface-prominent)'],
    // The inverse pair and the matte pair.
    ['background', 'var(--color-text-primary)'],
    ['color', 'var(--color-text-inverse)'],
    ['background', 'var(--color-scrim)'],
    ['color', 'var(--color-on-scrim)'],
    ['background', 'var(--color-accent)'],
    ['color', 'var(--color-on-accent)'],
    // A hairline or tint mixed from two role tokens.
    ['border-color', 'color-mix(in oklab, var(--color-text-primary) 18%, var(--color-canvas))'],
    ['color', 'color-mix(in oklab, var(--color-text-inverse), var(--color-text-primary) 30%)'],
    ['color', 'currentColor'],
    ['border-color', 'transparent'],
    ['color', 'inherit'],
    // A basic shape's corner, from a radius token or none (K-5 review L1).
    ['clip-path', 'inset(0 round var(--ui-radius-card))'],
    ['clip-path', 'inset(50%)'],
    ['clip-path', 'circle(50%)'],
    ['shape-outside', 'inset(round(1.4rem, 1px) 0 round 0)'],
  ];
  for (const [property, value] of allowed) {
    assert.equal(appearanceProblem(property, value), undefined, `${property}: ${value}`);
  }
});

test('a raw color, radius, or shadow is refused, beside a token too', () => {
  for (const [property, value] of [
    ['border-radius', 'calc(var(--ui-radius-card) + 4px)'],
    ['box-shadow', '0 4px 12px var(--color-scrim)'],
    ['filter', 'drop-shadow(0 4px 12px var(--color-scrim))'],
  ] as const) {
    assert.ok(appearanceProblem(property, value), `${property}: ${value}`);
  }
  const refused: [string, string, RegExp][] = [
    ['color', '#123456', /raw color/],
    ['background', 'oklch(70% 0.1 40)', /raw color/],
    ['border-color', 'rebeccapurple', /raw color/],
    ['border-radius', '12px', /sets border-radius/],
    ['clip-path', 'inset(0 round 24px)', /a corner of its own/],
    ['clip-path', 'rect(0 100% 100% 0 round 1rem / 2rem)', /a corner of its own/],
    ['-webkit-clip-path', 'xywh(0 0 100% 100% round var(--ui-radius-card, 8px))', /a corner/],
    ['shape-outside', 'inset(1rem round var(--ui-shadow-card))', /a corner of its own/],
    ['clip-path', 'inset(0 round var(--ui-radius-acme))', /a corner of its own/],
    ['box-shadow', '0 1px 2px black', /sets box-shadow/],
    ['font-family', 'Georgia, serif', /sets font-family/],
    // A token beside a literal of its own is still a literal.
    [
      'border-color',
      'color-mix(in oklab, var(--color-text-primary) 18%, #ffffff)',
      /raw color beside its tokens/,
    ],
    [
      'background',
      'linear-gradient(var(--color-canvas), rgb(0 0 0 / 0.4))',
      /raw color beside its tokens/,
    ],
  ];
  for (const [property, value, message] of refused) {
    assert.match(appearanceProblem(property, value) ?? '', message, `${property}: ${value}`);
  }
});

test("a token's fallback may be another token, never a literal of its own", () => {
  assert.equal(
    appearanceProblem('color', 'var(--color-text-primary, var(--color-canvas))'),
    undefined,
  );
  for (const value of [
    'var(--made-up, #ff0000)',
    'var(--x, white)',
    'var(--x, rgb(255 0 0))',
    'var(--a, var(--b, #000))',
  ]) {
    assert.match(appearanceProblem('color', value) ?? '', /raw color beside its tokens/, value);
  }
});

test("K-5's amendments: a color-mix() of roles, currentColor, and transparent, and a pseudo-element's mask, pass; raw literals stay refused", () => {
  for (const [property, value] of [
    ['text-decoration-color', 'color-mix(in oklab, currentColor 40%, transparent)'],
    ['border-color', 'color-mix(in srgb, var(--color-accent) 30%, transparent)'],
    [
      '--layout-line-hair',
      '1px solid color-mix(in oklab, var(--color-border-strong) 26%, var(--color-canvas))',
    ],
    ['--layout-rule-heavy', '2px dashed var(--color-text-primary)'],
    ['background', 'linear-gradient(var(--color-canvas), var(--color-surface-prominent))'],
    ['border-radius', 'var(--ui-radius-badge)'],
    ['clip-path', 'circle(50%)'],
    ['content', "''"],
    ['initial-letter', '3'],
    ['animation-timeline', 'scroll()'],
  ] as const) {
    assert.equal(appearanceProblem(property, value), undefined, `${property}: ${value}`);
  }
  // var(--layout-round) is a radius where the stylesheet declares it 50%, and only then (L3).
  const round = (values: string[]) => ({ layout: new Map([['--layout-round', values]]) });
  assert.equal(
    appearanceProblem('border-radius', 'var(--layout-round)', round(['50%'])),
    undefined,
  );
  assert.ok(appearanceProblem('border-radius', 'var(--layout-round)', round(['12px'])));
  assert.ok(appearanceProblem('border-radius', 'var(--layout-round)', round(['50%', '1rem'])));
  assert.ok(appearanceProblem('border-radius', 'var(--layout-round)'));
  // A mask reads black, white, and transparent for their alpha, on a ::before or ::after alone.
  const mask = 'linear-gradient(#000 0 0) right center / 100% 100% no-repeat';
  assert.equal(appearanceProblem('mask', mask, { pseudoElement: true }), undefined);
  assert.equal(
    appearanceProblem('-webkit-mask-image', 'linear-gradient(black, transparent)', {
      pseudoElement: true,
    }),
    undefined,
  );
  assert.match(appearanceProblem('mask', mask) ?? '', /raw color/);
  assert.match(
    appearanceProblem('mask-image', 'linear-gradient(#ff0000, transparent)', {
      pseudoElement: true,
    }) ?? '',
    /raw color/,
  );
  const found = (css: string) => {
    const codes: string[] = [];
    auditStylesheet(css, { id: 'acme', rtl: false }, (code) => codes.push(code));
    return codes;
  };
  assert.deepEqual(found(`[data-variant='acme'] .x::after { mask: ${mask}; }`), []);
  assert.deepEqual(found(`[data-variant='acme'] .x { &::before { mask: ${mask}; } }`), []);
  assert.deepEqual(found(`[data-variant='acme'] .x { mask: ${mask}; }`), ['audit.css-appearance']);
  assert.deepEqual(
    found(`[data-variant='acme'] .x::after, [data-variant='acme'] .y { mask: ${mask}; }`),
    ['audit.css-appearance'],
  );
  // Raw color, radius, and shadow literals stay refused, in a mix too.
  for (const [property, value] of [
    ['text-decoration-color', 'color-mix(in oklab, currentColor 40%, #f00)'],
    ['color', 'color-mix(in oklab, red, transparent)'],
    ['border-radius', '50%'],
    ['box-shadow', '0 1px 2px var(--color-shadow)'],
    ['color', '#123456'],
  ] as const) {
    assert.ok(appearanceProblem(property, value), `${property}: ${value}`);
  }
});

test('a shadow or a radius reads tokens alone, in a color-mix() or out of one, as before K-5 (K-5 review H2)', () => {
  const found = (css: string) => {
    const codes: string[] = [];
    auditStylesheet(css, { id: 'acme', rtl: false }, (code) => codes.push(code));
    return codes;
  };
  // The review's rows: refused at e789bc2e, passing at c9a7fabd, refused again.
  for (const value of [
    '0 0 var(--space-4) color-mix(in oklab, var(--color-accent) 40%, transparent)',
    '0 0 var(--space-4) color-mix(in oklab, currentColor 40%, transparent)',
    '0 0 12pt color-mix(in oklab, currentColor 40%, transparent)',
    '0 0 12pt currentColor',
    // Units and forms the old length test missed.
    '0 0 12pt var(--color-accent)',
    '0 0 1e1px var(--color-accent)',
    '0 0 2vmin var(--color-accent)',
    '0 0 1lh var(--color-accent)',
    'var(--ui-shadow-card), 0 0 0 1px var(--color-accent)',
    'var(--made-up)',
    'var(--ui-shadow-card, 0 0 4px black)',
  ]) {
    assert.match(appearanceProblem('box-shadow', value) ?? '', /sets box-shadow/, value);
    assert.match(appearanceProblem('text-shadow', value) ?? '', /sets text-shadow/, value);
    assert.deepEqual(found(`[data-variant='acme'] .x { box-shadow: ${value}; }`), [
      'audit.css-appearance',
    ]);
  }
  for (const value of [
    '12pt',
    'calc(var(--ui-radius-card) + 4px)',
    'calc(var(--ui-radius-media) / 3)',
    'var(--ui-radius-card) 12pt',
    'color-mix(in oklab, currentColor 40%, transparent)',
    'var(--made-up)',
    'var(--ui-shadow-card)',
  ]) {
    assert.match(appearanceProblem('border-radius', value) ?? '', /sets border-radius/, value);
  }
  // What a composition may write still passes.
  for (const value of [
    'none',
    'var(--ui-shadow-raised), var(--ui-shadow-overlay)',
    'var(--ui-shadow-card)',
  ])
    assert.equal(appearanceProblem('box-shadow', value), undefined, value);
  for (const value of ['0', '0 0', 'var(--ui-radius-card) 0', 'var(--ui-radius-card) / 0'])
    assert.equal(appearanceProblem('border-radius', value), undefined, value);
  // Through a --layout-* the stylesheet declares, which passes in turn, or doesn't.
  assert.deepEqual(
    found(
      "[data-variant='acme'] { --layout-card: var(--ui-radius-card); --layout-glow: 0 0 4px var(--color-accent); }\n[data-variant='acme'] .x { border-radius: var(--layout-card); }\n[data-variant='acme'] .y { box-shadow: var(--layout-glow); }",
    ),
    ['audit.css-appearance'],
  );
  assert.deepEqual(
    found(
      "[data-variant='acme'] { --layout-round: 50%; }\n[data-variant='acme'] .x { border-radius: var(--layout-round); }",
    ),
    [],
  );
  assert.deepEqual(
    found(
      "[data-variant='acme'] { --layout-round: 12px; }\n[data-variant='acme'] .x { border-radius: var(--layout-round); }",
    ),
    ['audit.css-appearance'],
  );
});

test("a composition declares no token in the platform's namespaces, and a token reader takes only the platform's own names (K-5 delta review K5-H1)", () => {
  const found = (css: string) => {
    const codes: string[] = [];
    auditStylesheet(css, { id: 'acme', rtl: false }, (code, _at, message) =>
      codes.push(`${code}: ${message}`),
    );
    return codes;
  };
  // The review's probes, and a role token redefined from another role.
  for (const css of [
    "[data-variant='acme'] { --ui-acme-glow: 0 0 24px var(--color-accent); }\n[data-variant='acme'] .x { box-shadow: var(--ui-acme-glow); }",
    "[data-variant='acme'] { --ui-radius-acme: 12pt; }\n[data-variant='acme'] .x { border-radius: var(--ui-radius-acme); }",
    "[data-variant='acme'] .x { --ui-shadow-raised: 0 0 24px var(--color-accent); box-shadow: var(--ui-shadow-raised); }",
    "[data-variant='acme'] { --ui-radius-control: 40px; }",
    "[data-variant='acme'] { --ui-acme-glow: 0 0 24px color-mix(in oklab, currentColor 40%, transparent); }\n[data-variant='acme'] .x { box-shadow: var(--ui-acme-glow); }",
    "[data-variant='acme'] { --color-accent: color-mix(in oklab, var(--color-canvas) 10%, transparent); }",
    "[data-variant='acme'] { --type-body-font-size: 30px; }",
    "[data-variant='acme'] { --space-m: 3rem; }",
    "[data-variant='acme'] { --motion-scene: 5s; }",
    "[data-variant='acme'] { --rhythm-section: 9rem; }",
  ]) {
    const codes = found(css);
    assert.ok(codes.length > 0, css);
    assert.ok(
      codes.every((code) => code.startsWith('audit.css-appearance')),
      `${css}\n${codes.join('\n')}`,
    );
    assert.ok(
      codes.some((code) => /declares --(?:ui|color|type|space|motion|rhythm)-/.test(code)),
      css,
    );
  }
  // A radius or a shadow reads only a token the platform defines, declared or not.
  assert.match(
    appearanceProblem('border-radius', 'var(--ui-radius-acme)') ?? '',
    /sets border-radius/,
  );
  assert.match(appearanceProblem('box-shadow', 'var(--ui-acme-glow)') ?? '', /sets box-shadow/);
  assert.equal(appearanceProblem('border-radius', 'var(--ui-radius-control)'), undefined);
  assert.equal(appearanceProblem('box-shadow', 'var(--ui-shadow-raised)'), undefined);
  // So does a color: a name the platform doesn't define is refused where a color goes.
  assert.match(appearanceProblem('color', 'var(--color-acme)') ?? '', /isn't a platform token/);
  assert.match(
    appearanceProblem('background', 'color-mix(in oklab, var(--ui-acme) 20%, transparent)') ?? '',
    /isn't a platform token/,
  );
  assert.equal(appearanceProblem('color', 'var(--color-text-primary)'), undefined);
  // A --layout-* of the composition's own still declares and reads as before.
  assert.deepEqual(
    found(
      "[data-variant='acme'] { --layout-ink: var(--color-border-strong); }\n[data-variant='acme'] .x { border-color: var(--layout-ink); }",
    ),
    [],
  );
});

test('a vendor prefix hides no shadow or radius, and a named color is a color in an image value (K-5 delta review K5-M1, K5-M2)', () => {
  for (const [property, value] of [
    ['-webkit-box-shadow', '0 0 24px var(--color-accent)'],
    ['-webkit-box-shadow', '0 0 4px red'],
    ['-moz-box-shadow', '0 0 4px var(--color-accent)'],
    ['-webkit-border-radius', '24px'],
    ['-webkit-border-top-left-radius', '1rem'],
    ['-webkit-text-shadow', '0 0 2px currentColor'],
    ['border-image', 'linear-gradient(red, blue) 1'],
    ['border-image-source', 'linear-gradient(red, blue)'],
    ['list-style-image', 'linear-gradient(red, red)'],
    ['list-style', 'square linear-gradient(red, red)'],
    ['mask-image', 'linear-gradient(red, transparent)'],
    ['-webkit-mask-image', 'linear-gradient(tomato, transparent)'],
    ['mask', 'linear-gradient(navy, transparent)'],
    ['shape-outside', 'linear-gradient(red, transparent)'],
    // A prefix the audit strips leaves a color property a color property.
    ['-webkit-text-fill-color', 'red'],
    ['-webkit-text-stroke-color', 'navy'],
  ] as const) {
    assert.ok(appearanceProblem(property, value), `${property}: ${value}`);
  }
  // The token forms pass, prefixed or not.
  for (const [property, value] of [
    ['-webkit-box-shadow', 'var(--ui-shadow-card)'],
    ['-webkit-border-radius', 'var(--ui-radius-card)'],
    ['border-image', 'linear-gradient(var(--color-accent), var(--color-canvas)) 1'],
    ['list-style-image', 'none'],
    ['list-style', 'square inside'],
  ] as const) {
    assert.equal(appearanceProblem(property, value), undefined, `${property}: ${value}`);
  }
});

/** Each code the variant audit reports for `css`, in order. */
const codesIn = (css: string) => {
  const codes: string[] = [];
  auditStylesheet(css, { id: 'acme', rtl: false }, (code) => codes.push(code));
  return codes;
};
const rule = (body: string, selector = "[data-variant='acme'] .x") => `${selector} { ${body} }`;

/** Each code the audit reports for a first-party package's `css`, the scope the registry gives it. */
const firstPartyCodesIn = (css: string, id = 'acme') => {
  const codes: string[] = [];
  auditStylesheet(css, { id, rtl: false, firstParty: true }, (code) => codes.push(code));
  return codes;
};

test('a backslash anywhere in a third-party stylesheet is refused, strings and selectors included (K-5 rounds 3 to 5)', () => {
  // Round 3's rows: each redefines a token, or writes a raw shadow, color, radius, or font.
  for (const css of [
    "[data-variant='acme'] { --\\75 i-radius-card: 40px; }",
    "[data-variant='acme'] { --c\\olor-accent: rgb(0 160 0); }",
    rule('b\\ox-shadow: 0 0 0 10px r\\65 d;'),
    rule('color: #\\66 00;'),
    rule('background-color: \\72 gb(255 0 0);'),
    rule('border-\\72 adius: 24px;'),
    rule('font-f\\61 mily: Georgia;'),
    rule('--m\\otion-scene: 1s;'),
    rule('filter: dr\\6f p-shadow(0 0 4px var(--color-accent));'),
    "[data-v\\61 riant='acme'] .x { color: inherit; }",
    `@m\\65 dia (min-width: 1px) { ${rule('color: inherit;')} }`,
    // Round 4's rows: an escape in a value or a selector desynced the old reader.
    "[data-variant='acme'] { --layout-a: \\}; --ui-radius-card: 40px; --color-accent: rgb(0 160 0); }",
    "[data-variant='acme'] .a { --layout-a: \\}; border-radius: 40px; box-shadow: 0 0 0 10px rgb(255 0 0); }",
    "[data-variant='acme'] .c { --layout-a: \\(; border-radius: 40px; --layout-b: \\); }",
    "[data-variant='acme'] .e { --layout-q: \\\"; border-radius: 40px;\n}",
    "[data-variant='acme'] .x\\(, body > .outside, .z\\) { color: inherit; }",
    rule('transition: opacity 5\\73;'),
    rule('color: var(--color-accent) !\\69mportant;'),
    // Round 5: a string's escape too, for a third party, and a class name's.
    rule("content: '\\201C';", "[data-variant='acme'] .x::before"),
    rule('color: var(--color-accent);', "[data-variant='acme'] .md\\:wide"),
  ]) {
    assert.ok(codesIn(css).includes('audit.css-escape'), css);
  }
  // A backslash in a comment is no escape.
  assert.deepEqual(codesIn(`/* a \\ b */ ${rule('color: inherit;')}`), []);
});

test('a first-party content string alone may name a printable character as \\<hex>, and nothing else may (K-5 round 5)', () => {
  // Horizontal Cinema's quotes, Editorial Evidence's minus, and Spatial Bento's thin space and arrow.
  for (const content of ["'\\201C'", "'\\201D'", "'\\2212' / ''", "'\\2009\\2197'", "'\\201C '"])
    assert.deepEqual(
      firstPartyCodesIn(rule(`content: ${content};`, "[data-variant='acme'] .x::before")),
      [],
      content,
    );
  // A quote, a backslash, a brace, NUL, a control, a bidi control, or anything but hex.
  for (const content of [
    "'\\22'",
    "'\\27'",
    "'\\5C'",
    "'\\7D'",
    "'\\0'",
    "'\\7'",
    "'\\202E'",
    "'\\n'",
    "'it\\'s'",
  ])
    assert.ok(
      firstPartyCodesIn(rule(`content: ${content};`, "[data-variant='acme'] .x::before")).includes(
        'audit.css-escape',
      ),
      content,
    );
  // Outside a content string, a first-party backslash is refused as a third party's is.
  for (const css of [
    rule("font-feature-settings: '\\6C iga';"),
    rule('color: #\\66 00;'),
    rule('color: inherit;', "[data-variant='acme'] .md\\:wide"),
  ])
    assert.ok(firstPartyCodesIn(css).includes('audit.css-escape'), css);
});

test("a '/*' or a '*/' inside a string is text, and a stylesheet PostCSS can't parse is refused (K-5 rounds 3 and 5)", () => {
  // The review's sheet: the string's '/*' hid the radius and the shadow.
  assert.deepEqual(
    codesIn(rule("content: '/*'; border-radius: 35px; box-shadow: 0 0 40px red; content: '*/';")),
    ['audit.css-appearance', 'audit.css-appearance'],
  );
  // Across rules, where the pair hid an unscoped rule.
  assert.deepEqual(
    codesIn(`${rule("content: '/*';")}\n.anywhere { color: inherit; }\n${rule("content: '*/';")}`),
    ['audit.css-unscoped'],
  );
  for (const declaration of [
    'content: "*/"; color: red;',
    `content: "it's /* not a comment"; color: red;`,
    `content: 'say "/*" twice'; color: red;`,
  ]) {
    assert.deepEqual(codesIn(rule(declaration)), ['audit.css-appearance'], declaration);
  }
  // A quote in a comment opens no string.
  assert.deepEqual(codesIn(rule("/* it's */ color: red;")), ['audit.css-appearance']);
  // An unclosed string, comment, bracket, or block, and a stray word.
  for (const css of [
    rule("content: 'never closes"),
    `${rule('color: inherit;')} /* never closes`,
    rule('background-image: url(./a.png;'),
    "[data-variant='acme'] .x { color: inherit;",
    `stray ${rule('color: inherit;')} }`,
  ]) {
    assert.ok(codesIn(css).includes('audit.css-syntax'), css);
  }
});

test("strings go in content, the font settings, a quoted url(), and a grid's area names alone (K-5 round 5)", () => {
  for (const declaration of [
    "content: 'x';",
    "font-feature-settings: 'liga' 1;",
    "font-variation-settings: 'wght' 650;",
    "background-image: url('./a.png');",
    "grid-template-areas: 'still still . words' 'press press . words';",
    "grid-template: 'a b' 1fr 'c d' auto / 1fr 1fr;",
    "grid: 'head menu' auto 'body body' 1fr / 1fr auto;",
    "grid-template-areas: 'a_1 b-2 c.3';",
  ]) {
    assert.deepEqual(codesIn(rule(declaration)), [], declaration);
  }
  // A grid string with a quote, a backslash, a brace, or a parenthesis names no area.
  for (const declaration of [
    `grid-template-areas: "a ' b";`,
    `grid-template-areas: 'a } b';`,
    `grid-template-areas: 'a ( b';`,
    `grid: 'a;b' / 1fr;`,
  ]) {
    assert.ok(codesIn(rule(declaration)).includes('audit.css-string'), declaration);
  }
  assert.ok(codesIn(rule("grid-template-areas: 'a \\5c b';")).includes('audit.css-escape'));
  // Anywhere else, a string is refused: a custom property's, a font's, an image-set()'s, an at-rule's.
  for (const css of [
    rule("--layout-u: 'https://evil.example/a.png';"),
    rule("quotes: '«' '»';"),
    rule("background-image: image-set('./a.png' 1x);"),
    `@container style(--x: 'a') { ${rule('color: inherit;')} }`,
    `@keyframes 'acme-spin' { to { opacity: 1; } }`,
  ]) {
    assert.ok(codesIn(css).includes('audit.css-string'), css);
  }
});

test('a url() or an @import is a quoted path inside the package, and nothing else (K-5 round 5)', () => {
  for (const css of [
    rule("background-image: url('./a.png');"),
    rule('background-image: url("../shared/a-b_c.svg");'),
    rule("mask-image: url( './mask.svg' );"),
    rule("background-image: image-set(url('./a.png') 1x, url('./a@2x.png') 2x);").replace(
      '@2x',
      '-2x',
    ),
    "@import './more.css';",
    "@import url('./more.css') layer(acme);",
  ]) {
    assert.deepEqual(codesIn(css), [], css);
  }
  // Round 4's remote forms, an unquoted url(), data:, %, var(), src(), and image-set() with var().
  for (const declaration of [
    'background-image: url(./a.png);',
    `background-image: url("https://evil.example/a).png");`,
    `background-image: url("https://evil.example/'.png");`,
    `background-image: url("//evil.example/a.png");`,
    `background-image: url("/x//evil.example/a.png");`,
    "background-image: url('data:image/png;base64,AAAA');",
    "background-image: url('./a%2e.png');",
    'background-image: url(var(--layout-u));',
    'background-image: image-set(var(--layout-u) 1x);',
    'background-image: src(var(--layout-u));',
    "cursor: url('https://evil.example/c.png'), auto;",
    'background-image: url(data:,});',
  ]) {
    const codes = codesIn(rule(declaration));
    assert.ok(
      codes.includes('audit.css-remote-url') || codes.includes('audit.css-syntax'),
      `${declaration}: ${codes.join(' ')}`,
    );
  }
  for (const css of [
    '@import url(./more.css);',
    "@import 'https://evil.example/a.css';",
    '@import url("//evil.example/a.css");',
    "@import './a%2e.css';",
  ]) {
    assert.ok(codesIn(css).includes('audit.css-remote-import'), css);
  }
});

test('a duration, vendor-prefixed too, reads the motion tokens or is 0, and scales a token by at most 4 (K-5 rounds 3 to 5)', () => {
  for (const declaration of [
    'transition: opacity 5s ease;',
    'animation: acme-spin 9s linear infinite;',
    'animation-duration: 900ms;',
    'transition-duration: var(--acme-slow);',
    'transition-duration: var(--ui-motion-nope, 9s);',
    'transition-duration: var(--ui-motion-slow, 9s);',
    'animation-delay: .5s;',
    // Round 4: the vendor forms, and a slot that isn't one.
    '-webkit-transition: opacity 9s linear;',
    '-webkit-animation: acme-spin 9s linear infinite;',
    '-webkit-animation-duration: 9s;',
    'transition: opacity var(--layout-motion-acme);',
    // Round 5: a finite duration at 5 times a token, or at 0 or a negative factor.
    'transition-duration: calc(var(--ui-motion-fast) * 5);',
    'transition-duration: calc(5 * var(--motion-feedback));',
    'transition-duration: calc(var(--ui-motion-fast) / 0.2);',
    'transition-duration: calc(var(--ui-motion-fast) * 40);',
  ]) {
    assert.deepEqual(codesIn(rule(declaration)), ['audit.css-appearance'], declaration);
  }
  for (const declaration of [
    'transition: opacity var(--motion-feedback) var(--motion-curve);',
    'animation: acme-fade var(--layout-motion-scene) var(--motion-curve) backwards;',
    'transition-duration: 0s;',
    'transition: none;',
    'animation: none;',
    'animation-delay: calc(var(--motion-scene) * 0.4);',
    'transition-duration: calc(var(--motion-feedback) * 2);',
    'animation-delay: calc(var(--motion-scene) / 4);',
    '-webkit-transition: opacity var(--motion-feedback);',
  ]) {
    assert.deepEqual(codesIn(rule(declaration)), [], declaration);
  }
});

test("an infinite loop's cycle reads the ambient slot, never a scaled UI token (K-5 round 5)", () => {
  for (const css of [
    rule('animation: acme-spin calc(var(--ui-motion-slow) * 400) linear infinite;'),
    rule('animation: acme-spin var(--ui-motion-slow) linear infinite;'),
    rule(
      'animation: acme-spin var(--motion-scene) linear;\n  animation-iteration-count: infinite;',
    ),
  ]) {
    assert.ok(codesIn(css).includes('audit.css-appearance'), css);
  }
  for (const css of [
    rule(
      'animation: acme-drift var(--motion-ambient) linear infinite;\n  animation-play-state: var(--motion-ambient-state);',
    ),
    rule('animation: acme-drift var(--layout-motion-ambient) var(--motion-curve) infinite;'),
    rule('animation: acme-pulse var(--motion-scene) var(--motion-curve) 3;'),
  ]) {
    assert.deepEqual(codesIn(css), [], css);
  }
});

test("Kinetic Cosmos's loops meet the loop rule like every composition's, now its P1 has merged (K-5 round 7)", () => {
  const css =
    "[data-variant='kinetic-cosmos'] .a { animation: kinetic-cosmos-spin calc(var(--ui-motion-slow) * 400) linear infinite; }\n" +
    "[data-variant='kinetic-cosmos'] .b { animation: kinetic-cosmos-rise calc(var(--ui-motion-slow) * 20) both; }\n" +
    "[data-variant='kinetic-cosmos'] .c { transition: opacity 9s; }\n" +
    "[data-variant='kinetic-cosmos'] .d { animation: kinetic-cosmos-drift var(--motion-ambient) linear infinite; animation-play-state: var(--motion-ambient-state); }\n";
  for (const firstParty of [true, false]) {
    const failed: string[] = [];
    auditStylesheet(css, { id: 'kinetic-cosmos', rtl: false, firstParty }, (code, at) =>
      failed.push(`${code}@${at.line}`),
    );
    assert.deepEqual(
      failed,
      ['audit.css-appearance@1', 'audit.css-appearance@2', 'audit.css-appearance@3'],
      `first party: ${firstParty}`,
    );
  }
});

test('a motion slot is one of the four, with a value in its band (K-5 round 5)', () => {
  for (const declaration of [
    '--layout-motion-feedback: 200ms;',
    '--layout-motion-scene: 900ms;',
    '--layout-motion-ambient: 40s;',
    '--layout-motion-curve: var(--ui-motion-easing);',
    '--layout-motion-curve: cubic-bezier(0.05, 0.7, 0.1, 1);',
  ]) {
    assert.deepEqual(codesIn(`[data-variant='acme'] { ${declaration} }`), [], declaration);
  }
  for (const declaration of [
    '--layout-motion-feedback: 7s;',
    '--layout-motion-scene: 400ms;',
    '--layout-motion-ambient: 5s;',
    '--layout-motion-acme: 9s;',
    '--layout-motion-curve: cubic-bezier(0.34, 1.56, 0.64, 1);',
    '--layout-motion-feedback: var(--ui-motion-fast);',
  ]) {
    assert.ok(
      codesIn(`[data-variant='acme'] { ${declaration} }`).includes('audit.css-appearance'),
      declaration,
    );
  }
});

test('a system color only under forced colors, and a recoloring filter reads tokens alone (K-5 round 5, R4-L1)', () => {
  for (const declaration of [
    'color: ActiveText;',
    'background-color: Mark;',
    'color: LinkText;',
    'outline-color: Highlight;',
    'border-color: AccentColor;',
    '--layout-ink: CanvasText;',
    'filter: hue-rotate(180deg) saturate(4);',
    'backdrop-filter: sepia(1);',
    'filter: invert(1);',
    'filter: saturate(var(--layout-sat));',
    // A name in the platform's namespace that the platform doesn't define.
    'backdrop-filter: saturate(var(--ui-backdrop-saturate));',
  ]) {
    assert.ok(codesIn(rule(declaration)).includes('audit.css-appearance'), declaration);
  }
  for (const css of [
    `@media (forced-colors: active) { ${rule('outline-color: Highlight; color: CanvasText;')} }`,
    rule('filter: grayscale(1);'),
    rule('backdrop-filter: blur(var(--ui-backdrop-blur));'),
    rule('grid-area: menu;'),
  ]) {
    assert.deepEqual(codesIn(css), [], css);
  }
  assert.ok(
    codesIn(`@media not (forced-colors: active) { ${rule('color: CanvasText;')} }`).includes(
      'audit.css-appearance',
    ),
  );
});

test('a font reads the type tokens, a generic family, or inherit, and no name of its own (K-5 round 3, R3-M2)', () => {
  for (const css of [
    "[data-variant='acme'] { --layout-font: 'Comic Sans MS', cursive; }\n" +
      rule('font-family: var(--layout-font);'),
    rule('font-family: var(--acme-font);'),
    rule('font: var(--acme-font);'),
    rule('font-family: var(--type-body-font-family, Georgia);'),
    rule('font-family: var(--type-step-1);'),
    rule('font: 1rem "Comic Sans MS";'),
    rule('font: 700 1rem Georgia;'),
    // A family whose name starts with - (K-5 round 4, R4-L2).
    rule('font: 16px -Comic-Sans;'),
    rule('font: 16px -apple-system;'),
  ]) {
    assert.ok(codesIn(css).includes('audit.css-appearance'), css);
  }
  for (const declaration of [
    'font-family: var(--type-title-font-family);',
    'font-family: var(--type-code-font-family), monospace;',
    'font-family: monospace;',
    'font: inherit;',
    'font: caption;',
    'font: 700 var(--type-step-1) / 1.2 var(--type-body-font-family);',
    'font: italic calc(var(--type-step-1) * 2) var(--type-body-font-family), serif;',
  ]) {
    assert.deepEqual(codesIn(rule(declaration)), [], declaration);
  }
});

test("!important is refused in a variant's stylesheet, where it would win over the accessibility layer (K-5 round 3, R3-M3)", () => {
  assert.deepEqual(
    codesIn(
      rule('outline: none !important;', "[data-variant='acme'] [data-ui-slot]:focus-visible"),
    ),
    ['audit.css-important'],
  );
  assert.deepEqual(codesIn(rule('color: var(--color-accent) ! IMPORTANT;')), [
    'audit.css-important',
  ]);
  assert.deepEqual(codesIn(rule("content: '!important';", "[data-variant='acme'] .x::before")), []);
});

test('attr() reads a plain attribute in content alone (K-5 round 3, R3-M4)', () => {
  for (const declaration of [
    'color: attr(data-ink type(<color>));',
    'background-color: attr(data-ink type(<color>), var(--color-accent));',
    '--layout-ink: attr(data-ink);',
    'transition-duration: attr(data-d type(<time>));',
    'content: attr(data-glyph type(<string>));',
  ]) {
    assert.deepEqual(codesIn(rule(declaration)), ['audit.css-appearance'], declaration);
  }
  assert.deepEqual(
    codesIn(rule('content: attr(data-glyph);', "[data-variant='acme'] .x::before")),
    [],
  );
});

// K-5 round 6 (R5-H1): a comment in a selector or a prelude hides nothing from the scope.

test("the round 5 review's probes: a comment holding a quote or a bracket hides no comma or combinator (K-5 round 6, R5-H1)", () => {
  const probes = [
    "[data-variant='acme'] .a/*'*/,html body *,.b/*'*/ { color: var(--color-accent); }",
    "[data-variant='acme'] .a/*(*/,html .paren-target { color: var(--color-accent); }",
    "[data-variant='acme']/*'*/~*,[data-variant='acme'] + * { display: none; }",
    "[data-variant='acme'] { .a/*'*/,& ~ * { display: none; } }",
    "[data-variant='acme'] { .a/*(*/,& + * { display: none; } }",
  ];
  for (const css of probes) {
    const third = codesIn(css);
    assert.ok(third.includes('audit.css-syntax'), `third party, comment: ${css}`);
    assert.ok(third.includes('audit.css-unscoped'), `third party, scope: ${css}`);
    const first = firstPartyCodesIn(css);
    assert.ok(first.includes('audit.css-unscoped'), `first party: ${css}`);
    assert.ok(!first.includes('audit.css-syntax'), `first party: ${css}`);
  }
  // The review's nested form: nested, `html *` is the scope's descendant, as a browser
  // nests it, so the comment alone is refused, and a first party's reads as written.
  const nested = "[data-variant='acme'] { .a/*'*/,html * { display: none; } }";
  assert.deepEqual(codesIn(nested), ['audit.css-syntax']);
  assert.deepEqual(firstPartyCodesIn(nested), []);
});

test("a comment in a third party's selector or at-rule prelude is refused as audit.css-syntax (K-5 round 6)", () => {
  for (const css of [
    "[data-variant='acme'] .a /* note */ { display: none; }",
    "[data-variant='acme'] /* note */ .a { display: none; }",
    "[data-variant='acme'] .a, /* note */ [data-variant='acme'] .b { display: none; }",
    "@media /* note */ (min-width: 40rem) { [data-variant='acme'] .a { display: none; } }",
    "@media (min-width: 40rem) /* note */ { [data-variant='acme'] .a { display: none; } }",
    "@supports /*(*/ (display: grid) { [data-variant='acme'] .a { display: grid; } }",
    "@import /* note */ './a.css';",
    '@keyframes acme-in { from /* note */ { opacity: 0; } to { opacity: 1; } }',
  ]) {
    assert.ok(codesIn(css).includes('audit.css-syntax'), css);
    assert.ok(!firstPartyCodesIn(css).includes('audit.css-syntax'), `first party: ${css}`);
  }
  // A comment between rules, or in a declaration block, is no selector's.
  assert.deepEqual(
    codesIn("/* the cards */\n[data-variant='acme'] .a { /* hidden */ display: none; }"),
    [],
  );
  // `/*` in a string isn't a comment, and the comma after it is read.
  assert.deepEqual(codesIn("[data-variant='acme'] [data-note='/*'], html .b { display: none; }"), [
    'audit.css-unscoped',
  ]);
});

test('a comment holding a quote, a double quote, a bracket, or a paren, on either side of each combinator, hides nothing (K-5 round 6)', () => {
  const scope = "[data-variant='acme']";
  // [combinator, its codes inside the scope, its codes right after the scope's compound]
  const combinators: [string, string[], string[]][] = [
    [' ', [], []],
    ['>', [], []],
    ['~', [], ['audit.css-unscoped']],
    ['+', [], ['audit.css-unscoped']],
    [',', ['audit.css-unscoped'], ['audit.css-unscoped']],
  ];
  for (const held of ["'", '"', '(', '[', ')', ']']) {
    const comment = `/*${held}*/`;
    for (const [combinator, inside, atScope] of combinators) {
      const target = combinator === ',' ? 'html *' : '.b';
      const forms = (head: string) => [
        `${head}${comment}${combinator}${target}`,
        `${head} ${comment} ${combinator} ${target}`,
        `${head}${combinator}${comment}${target}`,
        `${head} ${combinator} ${comment} ${target}`,
      ];
      for (const selector of forms(`${scope} .a`)) {
        const css = `${selector} { display: none; }`;
        assert.deepEqual(firstPartyCodesIn(css), inside, `first party: ${css}`);
        assert.deepEqual(codesIn(css), ['audit.css-syntax', ...inside], `third party: ${css}`);
      }
      for (const selector of forms(scope)) {
        const css = `${selector} { display: none; }`;
        assert.deepEqual(firstPartyCodesIn(css), atScope, `first party: ${css}`);
        assert.deepEqual(codesIn(css), ['audit.css-syntax', ...atScope], `third party: ${css}`);
      }
    }
  }
});

test("the scope's compound reaches no sibling: only a descendant or > follows it, nested and in :has(), :is(), :where(), and :not() too (K-5 round 6)", () => {
  for (const selector of [
    "[data-variant='acme'] ~ *",
    "[data-variant='acme'] + *",
    "[data-variant='acme']~*",
    "[data-variant='acme']:hover + div",
    "[data-variant='acme'][data-x] ~ .b",
    "[data-variant='acme'] || td",
    "[data-variant='acme']:has(~ .b)",
    "[data-variant='acme']:has(.a, + .b)",
    "[data-variant='acme']:is(:has( ~ .b))",
    "[data-variant='acme']:where(:not(+ .b))",
    "html [data-variant='acme'] .a",
    ":is([data-variant='acme']) ~ *",
  ]) {
    assert.deepEqual(codesIn(rule('display: none;', selector)), ['audit.css-unscoped'], selector);
    assert.deepEqual(
      firstPartyCodesIn(rule('display: none;', selector)),
      ['audit.css-unscoped'],
      `first party: ${selector}`,
    );
  }
  for (const nested of [
    '& ~ * { display: none; }',
    '+ p { display: none; }',
    '&:has(~ p) { display: none; }',
  ]) {
    const css = `[data-variant='acme'] { ${nested} }`;
    assert.deepEqual(codesIn(css), ['audit.css-unscoped'], css);
  }
  // Inside the scope, past its compound, siblings are the variant's own: Shell's
  // `.shell-menu__all:has(+ [data-navigation-menu-control])` sits on a descendant.
  for (const selector of [
    "[data-variant='acme'] .a ~ .b",
    "[data-variant='acme'] > .a + .b",
    "[data-variant='acme'] .shell-menu__all:has(+ [data-navigation-menu-control])",
    "[data-variant='acme'] .a:is(.b ~ .c)",
    "[data-variant='acme']:has(.a ~ .b)",
    "[data-variant='acme']:not([data-x='~ +'])",
  ]) {
    assert.deepEqual(codesIn(rule('display: none;', selector)), [], selector);
  }
  assert.deepEqual(codesIn("[data-variant='acme'] { .a ~ .b { display: none; } }"), []);
});

// K-5 round 7 (R6-H1): a variant's stylesheet uses six at-rules alone.

test("the round 6 review's probes: a @scope nested in a scoped rule is refused (K-5 round 7, R6-H1)", () => {
  for (const css of [
    "[data-variant='acme'] { @scope (:not(&)) { * { color: var(--color-accent); } } }",
    "[data-variant='acme'] { @scope (& ~ *) { * { display: none; } } }",
    "@scope ([data-variant='acme']) { .a { display: none; } }",
  ]) {
    assert.ok(codesIn(css).includes('audit.css-at-rule'), css);
    assert.ok(firstPartyCodesIn(css).includes('audit.css-at-rule'), `first party: ${css}`);
  }
});

test('an at-rule outside @media, @supports, @layer, @container, @keyframes, and @import is audit.css-at-rule, for both parties (K-5 round 7)', () => {
  for (const css of [
    "[data-variant='acme'] { @scope (.a) { .b { display: none; } } }",
    '@property --layout-a { syntax: "*"; inherits: true; }',
    '@counter-style acme { system: cyclic; symbols: x; }',
    "@font-face { font-family: 'Acme'; src: url('./acme.woff2'); }",
    '@page { margin: 0; }',
    '@font-feature-values Acme { @styleset { nice: 1; } }',
    '@font-palette-values --acme { font-family: Acme; }',
    "[data-variant='acme'] .a { @starting-style { opacity: 0; } }",
    "@starting-style { [data-variant='acme'] .a { opacity: 0; } }",
    '@-webkit-keyframes acme-in { to { opacity: 1; } }',
    "@namespace svg url('./svg');",
    '@charset "utf-8";',
    '@view-transition { navigation: auto; }',
    '@position-try --acme { inset-block-start: 0; }',
    "@whatever (x) { [data-variant='acme'] .a { display: none; } }",
  ]) {
    assert.ok(codesIn(css).includes('audit.css-at-rule'), css);
    assert.ok(firstPartyCodesIn(css).includes('audit.css-at-rule'), `first party: ${css}`);
  }
});

test('each at-rule on the list passes, @supports selector() with one pseudo compound among them (K-5 round 7)', () => {
  for (const css of [
    `@media (min-width: 40rem) { ${rule('display: none;')} }`,
    `@supports (display: grid) { ${rule('display: grid;')} }`,
    `@supports not selector(:popover-open) { ${rule('display: none;')} }`,
    `@supports selector(::details-content) { ${rule('display: none;')} }`,
    `@supports selector(:hover:focus-visible) and (display: grid) { ${rule('display: none;')} }`,
    `@supports selector(::-webkit-details-marker) { ${rule('display: none;')} }`,
    '@layer acme-a, acme-b;',
    `@layer acme-a { ${rule('display: none;')} }`,
    `@container (min-width: 20rem) { ${rule('display: none;')} }`,
    '@keyframes acme-in { from { opacity: 0; } to { opacity: 1; } }',
    "@import './more.css';",
    `${"[data-variant='acme']"} { @media (min-width: 40rem) { .a { display: none; } } }`,
  ]) {
    assert.deepEqual(codesIn(css), [], css);
    assert.deepEqual(firstPartyCodesIn(css), [], `first party: ${css}`);
  }
});

test('a @supports selector() tests one compound of pseudo-classes and pseudo-elements, and no other shape (K-5 round 7)', () => {
  for (const argument of [
    // A combinator: descendant, child, siblings, a list, and the column combinator.
    ':popover-open .a',
    ':popover-open > *',
    ':popover-open ~ *',
    ':popover-open + *',
    ':popover-open, ::details-content',
    ':popover-open || *',
    // Nesting.
    '&',
    '&:popover-open',
    // A type, the universal selector, an attribute, a class, or an id.
    'div',
    'details::details-content',
    '*',
    '[open]',
    ':popover-open[open]',
    '.a',
    '#a',
    // An argument list of any kind.
    ':has(.a)',
    ':is(:hover)',
    ':where(:hover)',
    ':not(:hover)',
    ':nth-child(2)',
    '::part(a)',
    // A comment, an escape, or nothing at all.
    ':popover-open/**/',
    '/*x*/:popover-open',
    ':popover\\-open',
    '',
  ]) {
    for (const prelude of [`selector(${argument})`, `not selector(${argument})`]) {
      const css = `@supports ${prelude} { ${rule('display: none;')} }`;
      assert.ok(codesIn(css).includes('audit.css-at-rule'), css);
      assert.ok(firstPartyCodesIn(css).includes('audit.css-at-rule'), `first party: ${css}`);
    }
  }
});

/** Each finding for `css` as [code, message], for a variant whose manifest names `transitions` (K-4 (a)). */
const transitionFindings = (css: string, transitions: readonly string[] | null) => {
  const found: [string, string][] = [];
  auditStylesheet(css, { id: 'acme', rtl: false, transitions }, (code, _at, message) =>
    found.push([code, message]),
  );
  return found;
};
const transitionCodes = (css: string, transitions: readonly string[] | null) =>
  transitionFindings(css, transitions).map(([code]) => code);
const NAMES = ['acme-hero', 'acme-title'];
const FADE =
  'animation-duration: var(--ui-motion-standard); animation-timing-function: var(--ui-motion-easing);';

test('an opted-in variant targets its own names with the view-transition pseudo-elements, on the root or its scope (K-4 (a))', () => {
  for (const selector of [
    '::view-transition-group(acme-hero)',
    '::view-transition-image-pair(acme-hero)',
    '::view-transition-old(acme-title)',
    '::view-transition-new(acme-title)',
    ':root::view-transition-old(acme-hero)',
    'html::view-transition-new(acme-hero)',
    "[data-variant='acme']::view-transition-group(acme-hero)",
    '::view-transition-old( acme-hero ):only-child',
    '::view-transition-group(acme-hero), ::view-transition-group(acme-title)',
  ]) {
    const css = `${selector} { ${FADE} }`;
    assert.deepEqual(transitionFindings(css, NAMES), [], css);
    // First party or not, the same rules.
    const codes: string[] = [];
    auditStylesheet(css, { id: 'acme', rtl: false, firstParty: true, transitions: NAMES }, (code) =>
      codes.push(code),
    );
    assert.deepEqual(codes, [], `first party: ${css}`);
  }
  // Nested under the scope with &, inside @media, and with & after one, as a browser reads them.
  for (const css of [
    `[data-variant='acme'] { &::view-transition-old(acme-hero) { ${FADE} } }`,
    `@media (min-width: 40rem) { ::view-transition-new(acme-hero) { ${FADE} } }`,
    `::view-transition-old(acme-hero) { &:only-child { ${FADE} } }`,
  ]) {
    assert.deepEqual(transitionFindings(css, NAMES), [], css);
  }
  // Its keyframes are its own, and its durations read tokens, as anywhere else.
  assert.deepEqual(
    transitionFindings(
      '@keyframes acme-wipe { from { opacity: 0; } to { opacity: 1; } } ::view-transition-new(acme-hero) { animation: acme-wipe var(--ui-motion-slow) var(--ui-motion-easing); }',
      NAMES,
    ),
    [],
  );
  assert.deepEqual(
    transitionCodes('::view-transition-new(acme-hero) { animation-duration: 400ms; }', NAMES),
    ['audit.css-appearance'],
  );
  // Its elements take its names, and none.
  for (const value of ['acme-hero', 'acme-title', 'none']) {
    const css = rule(`view-transition-name: ${value};`);
    assert.deepEqual(transitionFindings(css, NAMES), [], css);
  }
});

test("an opted-in variant targets only its manifest's names, in no other pseudo-element shape (K-4 (a))", () => {
  for (const selector of [
    // A name the manifest doesn't list, unprefixed or not.
    '::view-transition-old(hero)',
    '::view-transition-old(acme-other)',
    // Every transition's, and the browser's own root.
    '::view-transition-group(*)',
    '::view-transition-old(root)',
    // A class, or nothing.
    '::view-transition-group(*.card)',
    '::view-transition-group(acme-hero.card)',
    '::view-transition-new()',
    // The tree's root, and a pseudo-element that isn't one of the four.
    '::view-transition',
    '::view-transition-group-children(acme-hero)',
    // Rooted anywhere but the root or the scope.
    "[data-variant='acme'] .a::view-transition-old(acme-hero)",
    "[data-variant='acme'] ::view-transition-old(acme-hero)",
    "[data-variant='other']::view-transition-old(acme-hero)",
    '.a::view-transition-old(acme-hero)',
    ':root:has(.a)::view-transition-old(acme-hero)',
    "[data-variant='acme']:root::view-transition-old(acme-hero)",
    // Past the pseudo-element.
    '::view-transition-old(acme-hero) .a',
    '::view-transition-old(acme-hero):hover',
    '::view-transition-old(acme-hero) + ::view-transition-new(acme-hero)',
  ]) {
    const css = `${selector} { ${FADE} }`;
    assert.ok(transitionCodes(css, NAMES).includes('audit.css-view-transition'), css);
  }
  // The message names what's wrong.
  assert.match(
    transitionFindings(`::view-transition-old(hero) { ${FADE} }`, NAMES)[0]![1],
    /whose hero isn't one of the manifest's transitions.names: acme-hero, acme-title/,
  );
  // A nested rule past the pseudo-element is refused once, at the nested rule.
  assert.deepEqual(transitionCodes(`::view-transition-old(acme-hero) { .a { ${FADE} } }`, NAMES), [
    'audit.css-view-transition',
  ]);
  // A name outside the list, any other value, and any class.
  for (const declaration of [
    'view-transition-name: acme-other;',
    'view-transition-name: hero;',
    'view-transition-name: auto;',
    'view-transition-name: match-element;',
    'view-transition-name: var(--layout-name);',
    'view-transition-name: inherit;',
    '-webkit-view-transition-name: hero;',
    'view-transition-class: acme-card;',
  ]) {
    const css = rule(declaration);
    assert.deepEqual(transitionCodes(css, NAMES), ['audit.css-view-transition'], css);
  }
  // A keyframe sets a name too, since the property animates discretely.
  assert.deepEqual(
    transitionCodes('@keyframes acme-name { to { view-transition-name: hero; } }', NAMES),
    ['audit.css-view-transition'],
  );
});

test("a variant that doesn't opt in has every view-transition pseudo-element and name refused, and no variant writes @view-transition (K-4 (a))", () => {
  for (const css of [
    `::view-transition-old(acme-hero) { ${FADE} }`,
    `:root::view-transition-group(acme-hero) { ${FADE} }`,
    `[data-variant='acme']::view-transition-new(acme-hero) { ${FADE} }`,
    `[data-variant='acme'] .a::view-transition-new(acme-hero) { ${FADE} }`,
    rule('view-transition-name: acme-hero;'),
  ]) {
    const found = transitionFindings(css, null);
    assert.deepEqual(
      found.map(([code]) => code),
      ['audit.css-view-transition'],
      css,
    );
    assert.match(found[0]![1], /the manifest doesn't opt in to view transitions/);
    // A target with no transitions at all, as a caller from before K-4 (a) passes it.
    assert.deepEqual(codesIn(css), ['audit.css-view-transition'], css);
  }
  // none is anyone's.
  assert.deepEqual(codesIn(rule('view-transition-name: none;')), []);
  // @view-transition is the host's, opted in or not.
  for (const transitions of [NAMES, null]) {
    const found = transitionFindings(
      "@view-transition { navigation: auto; } [data-variant='acme'] .x { display: block; }",
      transitions,
    );
    assert.deepEqual(
      found.map(([code]) => code),
      ['audit.css-at-rule'],
    );
    assert.match(
      found[0]![1],
      /which the host writes for a variant whose manifest sets transitions.crossDocument to true/,
    );
  }
  assert.deepEqual(
    transitionCodes(
      '@media (prefers-reduced-motion: no-preference) { @view-transition { navigation: auto; } }',
      NAMES,
    ),
    ['audit.css-at-rule'],
  );
});

test("no variant declares or runs the host's reduced-motion keyframes, _portfolio-vt-*, opted in or not (K-4 (a))", () => {
  for (const transitions of [NAMES, null]) {
    // Declaring them, under the host's own names or any other in the namespace.
    for (const name of ['_portfolio-vt-fade-out', '_portfolio-vt-fade-in', '_portfolio-vt-wipe']) {
      const found = transitionFindings(`@keyframes ${name} { to { opacity: 0; } }`, transitions);
      assert.deepEqual(
        found.map(([code]) => code),
        ['audit.css-keyframes'],
        name,
      );
      assert.match(found[0]![1], /in the host's own _portfolio-vt- namespace/);
    }
  }
  // Running them, from an image of its own or any element.
  for (const css of [
    '::view-transition-old(acme-hero) { animation: var(--ui-motion-fast) ease both _portfolio-vt-fade-out; }',
    '::view-transition-new(acme-hero) { animation-name: _portfolio-vt-fade-in; animation-duration: var(--ui-motion-fast); }',
    rule('animation: _portfolio-vt-fade-in var(--ui-motion-fast);'),
    rule('-webkit-animation-name: _portfolio-vt-fade-out;'),
  ]) {
    const found = transitionFindings(css, NAMES);
    assert.deepEqual(
      found.map(([code]) => code),
      ['audit.css-keyframes'],
      css,
    );
    assert.match(found[0]![1], /the host's own keyframes for reduced-motion view transitions/);
  }
  // Its own keyframes of a similar name are fine.
  assert.deepEqual(
    transitionCodes(
      '@keyframes acme-portfolio-vt-fade { to { opacity: 0; } } ::view-transition-old(acme-hero) { animation: acme-portfolio-vt-fade var(--ui-motion-fast); }',
      NAMES,
    ),
    [],
  );
});

/** Each [code, message] the variant audit reports for `css`, in order. */
const reportsIn = (css: string) => {
  const found: [string, string][] = [];
  auditStylesheet(css, { id: 'acme', rtl: false }, (code, _at, message) =>
    found.push([code, message]),
  );
  return found;
};

test('row 73: a composition sets --color-focus and --ui-focus-offset, in their value forms alone, on any of its selectors', () => {
  const allowed = [
    '--color-focus: var(--color-on-scrim);',
    '--color-focus: var(--color-focus-inverse);',
    '--color-focus: var(--color-text-primary);',
    '--color-focus: var(--color-on-accent);',
    '--color-focus: var(--color-on-emphasis);',
    '--color-focus: var( --color-on-scrim );',
    '--ui-focus-offset: calc(var(--ui-focus-width) * -1);',
    '--ui-focus-offset: calc( var(--ui-focus-width)*-1 );',
    '--ui-focus-offset: 0;',
    '--ui-focus-offset: var(--space-3xs);',
    '--ui-focus-offset: var(--space-xl-3xl);',
  ];
  // A band, a focused part, and the root rule: wherever the composition puts it.
  for (const selector of [
    "[data-variant='acme'] .band",
    "[data-variant='acme'] .stage:focus-visible",
    "[data-variant='acme']",
  ]) {
    for (const declaration of allowed) {
      assert.deepEqual(
        reportsIn(rule(declaration, selector)),
        [],
        `${selector} { ${declaration} }`,
      );
    }
  }
});

test('row 73: any other value of the two, and any other platform property, is refused', () => {
  const values = [
    '--color-focus: red;',
    '--color-focus: var(--color-surface);',
    '--color-focus: var(--color-surface-default);',
    '--color-focus: var(--color-focus);',
    '--color-focus: var(--color-text-inverse);',
    '--color-focus: var(--color-on-scrim, white);',
    '--color-focus: color-mix(in oklab, var(--color-on-scrim), var(--color-canvas));',
    '--color-focus: VAR(--color-on-scrim);',
    '--color-focus: var(--layout-ink);',
    '--ui-focus-offset: -10px;',
    '--ui-focus-offset: 2px;',
    '--ui-focus-offset: 0px;',
    '--ui-focus-offset: calc(var(--ui-focus-width) * -2);',
    '--ui-focus-offset: calc(var(--ui-focus-offset) * -1);',
    '--ui-focus-offset: var(--space-huge);',
    '--ui-focus-offset: var(--ui-focus-width);',
    '--ui-focus-offset: calc(var(--space-3xs) * 2);',
  ];
  for (const declaration of values) {
    const found = reportsIn(rule(declaration));
    assert.ok(found.length > 0, declaration);
    assert.ok(
      found.every(([code]) => code === 'audit.css-appearance'),
      declaration,
    );
    // The value's own refusal, beside any other a value breaks too, such as red's raw color.
    const said = found.filter(([, message]) =>
      message.startsWith(`sets ${declaration.slice(0, declaration.indexOf(':'))}: `),
    );
    assert.equal(said.length, 1, declaration);
    assert.match(said[0]![1], /may set --color-focus only as var\(--color-on-scrim\)/, declaration);
    assert.match(
      said[0]![1],
      /--ui-focus-offset only as calc\(var\(--ui-focus-width\) \* -1\), 0, or a var\(--space-\*\) token/,
      declaration,
    );
  }
  for (const declaration of [
    '--ui-focus-width: 4px;',
    '--ui-focus-style: dashed;',
    '--color-focus-inverse: var(--color-on-scrim);',
    '--color-on-scrim: var(--color-canvas);',
  ]) {
    const found = reportsIn(rule(declaration));
    assert.deepEqual(
      found.map(([code]) => code),
      ['audit.css-appearance'],
      declaration,
    );
    assert.match(found[0]![1], /in a namespace the platform's tokens own/, declaration);
  }
  // The bad-value text, exactly, and today's text for every other platform property.
  assert.deepEqual(
    reportsIn(rule('--color-focus: red;')).find(([, message]) => message.startsWith('sets ')),
    [
      'audit.css-appearance',
      "sets --color-focus: red, and a composition may set --color-focus only as var(--color-on-scrim), var(--color-focus-inverse), var(--color-text-primary), var(--color-on-accent), or var(--color-on-emphasis), and --ui-focus-offset only as calc(var(--ui-focus-width) * -1), 0, or a var(--space-*) token, in its stylesheet, and no other property in the platform's namespaces.",
    ],
  );
  assert.deepEqual(reportsIn(rule('--ui-focus-width: 4px;')), [
    [
      'audit.css-appearance',
      "declares --ui-focus-width, in a namespace the platform's tokens own, which a composition reads and never sets.",
    ],
  ]);
  // !important is its own refusal, beside the value's.
  assert.deepEqual(
    reportsIn(rule('--ui-focus-offset: var(--space-3xs) !important;')).map(([code]) => code),
    ['audit.css-important'],
  );
});
