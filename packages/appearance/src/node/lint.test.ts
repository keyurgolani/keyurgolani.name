import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeEscapes,
  LINT_RULES,
  readLanguageStylesheet,
  testsFocus,
  type LintRule,
} from './stylesheet';

// #20's pack CSS lint. Pack CSS is untrusted input, so #19's reader parses
// it, refuses what a language can't do, and names the lint rule a refusal
// breaks. Each rule is held however the construct is spelled: any case, a
// comment in the way, a `\` escape, and each function that loads a file.

const PACK = 'acme-ink';
const slot = "[data-ui-slot='action']";

/** The lint rules a stylesheet breaks, sorted and once each. */
function rules(css: string): LintRule[] {
  const read = readLanguageStylesheet(css, { packId: PACK });
  if (read.ok) return [];
  return [...new Set(read.problems.flatMap(({ rule }) => (rule ? [rule] : [])))].sort();
}

/** Whether the reader refuses it at all, whatever the reason. */
const refused = (css: string) => !readLanguageStylesheet(css, { packId: PACK }).ok;

function breaks(rule: LintRule, inputs: readonly string[]) {
  for (const css of inputs) {
    assert.ok(refused(css), `refused: ${css}`);
    assert.ok(rules(css).includes(rule), `${rule} in ${JSON.stringify(rules(css))}: ${css}`);
  }
}

test('the lint has the seven rules #20 names', () => {
  assert.deepEqual(
    [...LINT_RULES],
    ['url', 'import', 'layer-scope', 'universal', 'prefixed-names', 'focus-outline', 'javascript'],
  );
});

test('a stylesheet that keeps every rule names none, and a refusal outside the lint names none', () => {
  assert.deepEqual(rules(`${slot} { border-radius: var(--ui-radius-control); }`), []);
  assert.deepEqual(rules(`${slot}:focus-visible { outline-offset: var(--ui-focus-offset); }`), []);
  // A refusal no lint rule covers is still a refusal, just not a lint one.
  assert.ok(refused(`${slot} { color: var(--color-text-primary); }`));
  assert.deepEqual(rules(`${slot} { color: var(--color-text-primary); }`), []);
});

test('url: nothing loads a file, through any function, in any case', () => {
  breaks('url', [
    `${slot} { background-image: url(x.png); }`,
    `${slot} { background-image: url("x.png"); }`,
    `${slot} { background-image: URL(x.png); }`,
    `${slot} { background-image: Url(x.png); }`,
    `${slot} { background: image-set("x.png" 1x, "y.png" 2x); }`,
    `${slot} { background: -webkit-image-set(url(x.png) 1x); }`,
    `${slot} { background: IMAGE-SET(x 1x); }`,
    `${slot} { background: src("x.png"); }`,
    `${slot} { background: image("x.png"); }`,
    `${slot} { background: cross-fade(url(a.png), url(b.png), 50%); }`,
    `${slot} { background: element(#banner); }`,
    `${slot} { background: -moz-element(#banner); }`,
    `${slot} { border-image: url(x.png) 30; }`,
    `${slot} { background: linear-gradient(red, blue), url(x.png); }`,
    // A comment inside the call hides nothing.
    `${slot} { background: url(/* x */x.png); }`,
    // An escape: \\75 is u, \\55 is U, \\6c is l.
    `${slot} { background: \\75 rl(x.png); }`,
    `${slot} { background: \\55 RL(x.png); }`,
    `${slot} { background: ur\\6c(x.png); }`,
    `${slot} { background: u\\rl(x.png); }`,
    // A file in a feature test's condition.
    `@supports (background: url(x.png)) { ${slot} { border-radius: 0; } }`,
  ]);
});

test('import: no @import, in any case, behind an escape, or with a url', () => {
  breaks('import', [
    "@import 'elsewhere.css';",
    '@import url(elsewhere.css);',
    '@IMPORT "elsewhere.css";',
    '@Import url("https://example.test/x.css") layer(language);',
    "@\\69mport 'elsewhere.css';",
    "@\\49 MPORT 'elsewhere.css';",
    "@-webkit-import 'elsewhere.css';",
    // With no semicolon, as the stylesheet's last text.
    "@import 'elsewhere.css'",
    `${slot} { border-radius: 0; } @import url(elsewhere.css)`,
    // Inside a rule's body, alone or among declarations.
    `${slot} { @import 'elsewhere.css'; }`,
    `${slot} { border-radius: 0; @import 'elsewhere.css' }`,
    `${slot} { border-radius: 0; @IMPORT url(elsewhere.css); }`,
  ]);
  breaks('layer-scope', [`${slot} { @layer own { border-radius: 0; } }`]);
  // A comment ends the at-keyword, so this is the at-rule @im, which a browser doesn't import, and it's still refused.
  assert.ok(refused("@im/**/port 'elsewhere.css';"));
});

test('layer-scope: no @layer or @scope of its own, as a statement or a block, in any case', () => {
  breaks('layer-scope', [
    '@layer own;',
    '@layer reset, accessibility;',
    `@layer own { ${slot} { border-radius: 0; } }`,
    `@LAYER own { ${slot} { border-radius: 0; } }`,
    `@\\6c ayer own { ${slot} { border-radius: 0; } }`,
    `@scope ([data-x]) { ${slot} { border-radius: 0; } }`,
    `@Scope ([data-x]) to ([data-y]) { ${slot} { border-radius: 0; } }`,
    `@\\73 cope ([data-x]) { ${slot} { border-radius: 0; } }`,
  ]);
});

test('universal: no *, bare, in a compound, after a combinator, or in a pseudo-class', () => {
  breaks('universal', [
    '* { border-radius: 0; }',
    '*:hover { border-radius: 0; }',
    "*[data-ui-slot='action'] { border-radius: 0; }",
    `${slot} * { border-radius: 0; }`,
    `${slot} > * { border-radius: 0; }`,
    `${slot} + * { border-radius: 0; }`,
    `${slot}:is(*) { border-radius: 0; }`,
    `${slot}:not(*) { border-radius: 0; }`,
    `${slot}:has(> *) { border-radius: 0; }`,
    `${slot}, * { border-radius: 0; }`,
    '\\2a { border-radius: 0; }',
  ]);
  // A namespace's *, which uses |, is a universal selector too.
  breaks('universal', [
    '*|* { border-radius: 0; }',
    `${slot}, *|* { border-radius: 0; }`,
    `${slot} > *|* { border-radius: 0; }`,
    "*|[data-ui-slot='action'] { border-radius: 0; }",
  ]);
});

test('prefixed-names: keyframes, counter styles, and view transitions start with the pack id', () => {
  breaks('prefixed-names', [
    '@keyframes spin { to { border-radius: 0; } }',
    '@-webkit-keyframes spin { to { border-radius: 0; } }',
    '@KEYFRAMES spin { to { border-radius: 0; } }',
    '@keyframes "spin" { to { border-radius: 0; } }',
    '@keyframes acme-spin { to { border-radius: 0; } }',
    "@counter-style stars { system: cyclic; symbols: '*'; }",
    '@counter-style acme-stars { system: cyclic; }',
    `${slot} { view-transition-name: hero; }`,
    `${slot} { view-transition-name: acme-hero; }`,
    `${slot} { view-transition-class: card; }`,
    `${slot} { VIEW-TRANSITION-NAME: hero; }`,
    `@\\6b eyframes spin { to { border-radius: 0; } }`,
  ]);
  // Prefixed, each is still refused: the reader takes none of them, which is stricter.
  for (const css of [
    `@keyframes ${PACK}-spin { to { border-radius: 0; } }`,
    `@counter-style ${PACK}-stars { system: cyclic; }`,
    `${slot} { view-transition-name: ${PACK}-hero; }`,
  ]) {
    assert.ok(refused(css), css);
    assert.deepEqual(rules(css), [], css);
  }
});

test('focus-outline: nothing removes an outline, and a focus rule draws no shadow ring', () => {
  breaks('focus-outline', [
    `${slot} { outline: none; }`,
    `${slot} { outline: 0; }`,
    `${slot} { outline: 0px solid var(--color-focus); }`,
    `${slot} { outline: NONE; }`,
    `${slot} { outline-style: none; }`,
    `${slot} { outline-style: hidden; }`,
    `${slot} { outline-width: 0; }`,
    // A width is read as a number: zero however it's written, a fraction of a pixel, or below zero.
    `${slot} { outline-width: .0px; }`,
    `${slot} { outline-width: 00px; }`,
    `${slot} { outline-width: 0.00rem; }`,
    `${slot} { outline-width: +0px; }`,
    `${slot} { outline-width: 0.01px; }`,
    `${slot} { outline-width: 0.5px; }`,
    `${slot} { outline-width: 0.05rem; }`,
    `${slot} { outline-width: -1px; }`,
    `${slot} { outline: 0.01px solid var(--color-focus); }`,
    `${slot} { outline: solid .0px var(--color-focus); }`,
    `${slot} { outline-width: calc(0px); }`,
    // A transparent outline draws nothing either, in a focus rule or one that cascades into it.
    `${slot}:focus-visible { outline-color: transparent; }`,
    `${slot}:focus-visible { outline-color: TRANSPARENT; }`,
    `${slot} { outline-color: transparent; }`,
    `${slot}:focus-visible { outline: 2px solid transparent; }`,
    `${slot}:focus { outline: none; }`,
    `${slot}:focus-visible { box-shadow: 0 0 0 3px var(--color-focus); }`,
    `${slot}:FOCUS-VISIBLE { box-shadow: 0 0 0 3px var(--color-focus); }`,
    `[data-ui-slot='field']:focus-within { box-shadow: 0 0 0 3px var(--color-focus); }`,
    `${slot}:is(:hover, :focus-visible) { box-shadow: 0 0 0 3px var(--color-focus); }`,
    `[data-ui-slot='field']:focus-within ${slot} { -webkit-box-shadow: 0 0 0 3px var(--color-focus); }`,
    `${slot}:hover, ${slot}:focus-visible { box-shadow: 0 0 0 3px var(--color-focus); }`,
  ]);
  // A ring shaped through the tokens, and a shadow where nothing is focused, are fine.
  assert.deepEqual(
    rules(
      `${slot}:focus-visible { outline-offset: var(--ui-focus-offset); border-color: var(--color-focus); }`,
    ),
    [],
  );
  assert.ok(!refused(`${slot}:not(:focus) { box-shadow: var(--ui-shadow-card); }`));
  // A ring at least 1px wide, written out or as a keyword or a token, keeps the rule.
  for (const width of ['1px', '2px', '0.0625rem', 'thin', 'var(--ui-focus-width)']) {
    assert.deepEqual(rules(`${slot} { outline-width: ${width}; }`), [], width);
  }
  assert.deepEqual(rules(`${slot}:focus-visible { outline-color: var(--color-focus); }`), []);
  assert.ok(testsFocus("[data-ui-slot='a']:focus-visible"));
  assert.ok(testsFocus("[data-ui-slot='a']:focus-within [data-ui-slot='b']"));
  assert.ok(!testsFocus("[data-ui-slot='a']:not(:focus)"));
  assert.ok(!testsFocus("[data-ui-slot='a']:hover"));
});

test('javascript: no script through CSS', () => {
  breaks('javascript', [
    `${slot} { background: expression(alert(1)); }`,
    `${slot} { width: EXPRESSION(alert(1)); }`,
    `${slot} { behavior: url(x.htc); }`,
    `${slot} { -moz-binding: url(x.xml#y); }`,
    `${slot} { background: url(javascript:alert(1)); }`,
    `${slot} { background: url('vbscript:x'); }`,
    `${slot} { background: \\65 xpression(alert(1)); }`,
  ]);
});

test('escapes decode as CSS reads them, and the reader refuses every one', () => {
  assert.equal(decodeEscapes('\\75 rl'), 'url');
  assert.equal(decodeEscapes('\\000075rl'), 'url');
  assert.equal(decodeEscapes('\\75\nrl'), 'url');
  assert.equal(decodeEscapes('\\u\\r\\l'), 'url');
  // A backslash before a newline is nothing inside a string, and outside one is no escape at all.
  assert.equal(decodeEscapes("'a\\\nb'"), "'ab'");
  assert.equal(decodeEscapes('"a\\\r\nb"'), '"ab"');
  assert.equal(decodeEscapes('a\\\nb'), 'a\\\nb');
  // A comment's text is no escape.
  assert.equal(decodeEscapes('/* \\75 */\\75 rl'), '/* \\75 */url');
  assert.equal(decodeEscapes('\\0 x'), '�x');
  assert.equal(decodeEscapes('\\d800 x'), '�x');
  assert.equal(decodeEscapes('\\110000 x'), '�x');
  // An escaped name the lint doesn't cover still fails: the backslash alone is refused.
  const escaped = readLanguageStylesheet(`${slot} { border-r\\61 dius: 0; }`, { packId: PACK });
  assert.ok(!escaped.ok);
  assert.ok(escaped.problems.some(({ message }) => /can't use a backslash/.test(message)));
  // A rule an escape hid is named even when decoding yields a character past ASCII.
  for (const css of [
    "@\\69mport '\\e9.css';",
    `@\\69mport 'x.css'; ${slot} { border-radius: 0\\e9; }`,
  ]) {
    const read = readLanguageStylesheet(css, { packId: PACK });
    assert.ok(!read.ok);
    assert.ok(
      read.problems.some(({ rule }) => rule === 'import'),
      `import in ${JSON.stringify(read.problems)}`,
    );
  }
  // A rule an escape hid is named once its escapes are decoded.
  const hidden = readLanguageStylesheet("@\\69mport 'x.css';", { packId: PACK });
  assert.ok(!hidden.ok);
  assert.ok(
    hidden.problems.some(
      ({ rule, message }) =>
        rule === 'import' && message.startsWith('once its escapes are decoded'),
    ),
  );
});

test('a rule names itself in the message, so a build log says which rule broke', () => {
  const read = readLanguageStylesheet("@import 'x.css';", { packId: PACK });
  assert.ok(!read.ok);
  assert.match(read.problems[0]!.message, /\(pack lint: import\)$/);
});
