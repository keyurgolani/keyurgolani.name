import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_STYLESHEET_BYTES, readLanguageStylesheet, writeStyleNodes } from './stylesheet';

// A design language's stylesheet (#19, Slice 2, item 1): the subset it may
// use, each refusal the refined body lists, and inputs that try to reach
// past the language's @scope or layer.

function read(css: string) {
  return readLanguageStylesheet(css);
}

function problems(css: string): string[] {
  const result = read(css);
  assert.equal(result.ok, false, `expected a refusal for ${css}`);
  return result.ok ? [] : result.problems.map(({ message }) => message);
}

function refuses(css: string, pattern: RegExp) {
  const messages = problems(css);
  assert.ok(
    messages.some((message) => pattern.test(message)),
    `${css}\n  gave: ${messages.join(' | ')}`,
  );
}

test('slots, their parts, and state attributes read back in canonical form', () => {
  const css = `
    /* A comment, which the output drops. */
    [data-ui-slot="action"]:hover:not([data-state='loading']) {
      transform: var(--ui-state-hover-transform);
      transition:
        transform var(--ui-motion-fast) var(--ui-motion-easing),
        background-color var(--ui-motion-fast) var(--ui-motion-easing);
    }
    [data-ui-slot="tabs"] > [data-ui-slot="tabs.tab"][aria-selected="true"],
    [data-ui-slot=badge]::before {
      content: '';
      border-radius: var(--ui-radius-badge);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 40%, transparent);
    }
    @media (min-width: 48rem) and (hover: hover) {
      @supports (backdrop-filter: blur(1px)) {
        [data-ui-slot="surface"] { backdrop-filter: blur(var(--ui-backdrop-blur)); }
      }
    }
    @container (inline-size >= 30rem) {
      [data-ui-slot="field"]:is([aria-invalid="true"], [data-state="invalid"]) { outline-offset: 2px; }
    }
    [data-ui-slot="disclosure"]:has(> [data-ui-slot="disclosure.summary"]:focus-visible) {
      outline: var(--ui-focus-width) var(--ui-focus-style) var(--color-focus);
    }
  `;
  const result = read(css);
  assert.ok(result.ok, JSON.stringify(result.ok ? [] : result.problems));
  assert.equal(
    writeStyleNodes(result.nodes, ''),
    [
      '[data-ui-slot="action"]:hover:not([data-state="loading"]) {',
      '  transform: var(--ui-state-hover-transform);',
      '  transition: transform var(--ui-motion-fast) var(--ui-motion-easing), background-color var(--ui-motion-fast) var(--ui-motion-easing);',
      '}',
      '[data-ui-slot="tabs"] > [data-ui-slot="tabs.tab"][aria-selected="true"],',
      '[data-ui-slot="badge"]::before {',
      '  content: "";',
      '  border-radius: var(--ui-radius-badge);',
      '  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 40%, transparent);',
      '}',
      '@media (min-width: 48rem) and (hover: hover) {',
      '  @supports (backdrop-filter: blur(1px)) {',
      '    [data-ui-slot="surface"] {',
      '      backdrop-filter: blur(var(--ui-backdrop-blur));',
      '    }',
      '  }',
      '}',
      '@container (inline-size >= 30rem) {',
      '  [data-ui-slot="field"]:is([aria-invalid="true"], [data-state="invalid"]) {',
      '    outline-offset: 2px;',
      '  }',
      '}',
      '[data-ui-slot="disclosure"]:has(> [data-ui-slot="disclosure.summary"]:focus-visible) {',
      '  outline: var(--ui-focus-width) var(--ui-focus-style) var(--color-focus);',
      '}',
      '',
    ].join('\n'),
  );
});

test('each refusal the refined body lists', () => {
  const slot = '[data-ui-slot="surface"]';
  refuses(`${slot} { display: none; }`, /display: none removes the part/);
  refuses(`${slot} { visibility: hidden; }`, /visibility: hidden hides the part/);
  refuses(`${slot}::before { content: "New"; }`, /content: "New" adds text/);
  refuses(`${slot} { order: -1; }`, /order: -1 reorders content/);
  refuses(`${slot} { grid-column: 1 / -1; }`, /places a grid item/);
  refuses(`${slot} { grid-area: hero; }`, /places a grid item/);
  refuses(`${slot} { position: fixed; }`, /pins the part to the viewport/);
  refuses(`${slot} { color: #ff0000; }`, /hex color literal/);
  refuses(`${slot} { color: rebeccapurple; }`, /can't hold the color rebeccapurple/);
  refuses(`${slot} { background: rgb(0 0 0); }`, /can't make a color with rgb\(\)/);
  refuses(`@import "elsewhere.css";`, /@import can't import another stylesheet/);
  refuses(`@font-face { font-family: Hijack; }`, /@font-face can't declare a font/);
  refuses(`:root { border-radius: 0; }`, /uses :root/);
  refuses(`html ${slot} { border-radius: 0; }`, /uses html, outside every boundary/);
  refuses(`body > ${slot} { border-radius: 0; }`, /uses body, outside every boundary/);
  refuses(`${slot} { border-radius: 0 !important; }`, /can't use !important/);
});

test('selectors target only [data-ui-slot] parts and state attributes', () => {
  refuses('.card { border-radius: 0; }', /uses a class/);
  refuses('#main { border-radius: 0; }', /uses an id/);
  refuses('div { border-radius: 0; }', /uses the element div/);
  refuses('* { border-radius: 0; }', /uses \*/);
  refuses(
    '[data-state="open"] { border-radius: 0; }',
    /every part of a language's selector is a \[data-ui-slot\] part/,
  );
  refuses('[data-ui-slot] [data-state="open"] { border-radius: 0; }', /every part/);
  refuses(':hover > [data-ui-slot] { border-radius: 0; }', /every part/);
  refuses('[data-variant="x"] [data-ui-slot] { border-radius: 0; }', /tests \[data-variant\]/);
  refuses('[data-ui-slot^="tabs"] { border-radius: 0; }', /can't use "\^"/);
  refuses('[data-ui-slot="tabs" i] { border-radius: 0; }', /an attribute test is/);
  refuses('[data-ui-slot="Tabs"] { border-radius: 0; }', /lowercase value/);
  refuses('[data-ui-slot]:scope { border-radius: 0; }', /uses :scope/);
  refuses('[data-ui-slot]:visited { border-radius: 0; }', /isn't a state pseudo-class/);
  refuses('[data-ui-slot]::selection { border-radius: 0; }', /uses ::selection/);
  refuses(
    '[data-ui-slot]::before [data-ui-slot] { border-radius: 0; }',
    /pseudo-element before the end/,
  );
  refuses(
    '[data-ui-slot]:not([data-ui-slot] [data-state]) { border-radius: 0; }',
    /combinator inside :not/,
  );
  refuses('[data-ui-slot]:not(:is([data-state])) { border-radius: 0; }', /nests :is\(\)/);
  refuses(
    '[data-ui-slot]:nth-child(2n of [data-ui-slot]) { border-radius: 0; }',
    /takes :nth-child/,
  );
  refuses('[data-ui-slot]:has(> [data-state="open"]) { border-radius: 0; }', /every part/);
  // :is() counts as a slot when every alternative is one.
  assert.ok(read(':is([data-ui-slot="a"], [data-ui-slot="b"]) { border-radius: 0; }').ok);
  refuses(':is([data-ui-slot="a"], [data-state="b"]) { border-radius: 0; }', /every part/);
});

test('declarations can only use tokens for type, motion, and color', () => {
  const slot = '[data-ui-slot="action"]';
  refuses(`${slot} { --ui-radius-control: 0; }`, /defines a custom property/);
  refuses(`${slot} { --color-accent: red; }`, /defines a custom property/);
  refuses(`${slot} { --private: 1px; }`, /defines a custom property/);
  refuses(`${slot} { font-family: Papyrus, fantasy; }`, /belongs to the typography profile/);
  refuses(`${slot} { font: 700 2rem serif; }`, /belongs to the typography profile/);
  refuses(`${slot} { font-size: 2rem; }`, /belongs to the typography profile/);
  refuses(`${slot} { transition: opacity 200ms ease; }`, /literal duration/);
  refuses(`${slot} { animation: spin 1s linear infinite; }`, /names keyframes/);
  refuses(`${slot} { animation-name: spin; }`, /names keyframes/);
  refuses(`${slot} { background: url(https://example.test/x.png); }`, /url\(\)/);
  refuses(`${slot} { background: image-set(x 1x); }`, /calls image-set\(\)/);
  refuses(
    `${slot} { color: var(--type-body-font-size); }`,
    /var\(--color-<role>\) or var\(--ui-<key>\)/,
  );
  refuses(`${slot} { color: var(--color-accent, red); }`, /no fallback/);
  refuses(
    `${slot} { color: var(--color-nonexistent); }`,
    /var\(--color-<role>\) or var\(--ui-<key>\)/,
  );
  refuses(`${slot} { all: unset; }`, /resets every property/);
  refuses(`${slot} { display: contents; }`, /removes the part/);
  refuses(`${slot} { position: sticky; }`, /pins the part/);
  refuses(`${slot} { flex-direction: row-reverse; }`, /reverses the content order/);
  refuses(`${slot} { direction: rtl; }`, /reorders content/);
  refuses(`${slot} { -webkit-order: 2; }`, /reorders content/);
  refuses(`${slot} { DISPLAY: block; }`, /isn't a lowercase property name/);
  refuses(`${slot} { color var(--color-accent); }`, /isn't a declaration/);
  // What a language does style.
  assert.ok(
    read(`${slot} {
      display: inline-flex;
      position: relative;
      min-height: var(--ui-control-height);
      border: var(--ui-border-control);
      opacity: var(--ui-state-disabled-opacity);
      backdrop-filter: blur(var(--ui-backdrop-blur));
      -webkit-backdrop-filter: blur(var(--ui-backdrop-blur));
      transition: opacity var(--ui-motion-fast) var(--ui-motion-easing);
      color: currentcolor;
    }`).ok,
  );
});

test('display, visibility, content-visibility, and position take a listed keyword, never a token', () => {
  const slot = '[data-ui-slot="surface"]';
  // A token's value lands at compute time, where nothing reads it first.
  refuses(`${slot} { display: var(--ui-texture); }`, /display: var\(--ui-texture\) isn't a value/);
  refuses(`${slot} { display: var(--ui-texture); }`, /written out, never through a token/);
  refuses(`${slot} { visibility: var(--ui-motion-exit); }`, /never through a token/);
  refuses(`${slot} { position: var(--ui-motion-enter); }`, /never through a token/);
  refuses(`${slot} { content-visibility: var(--ui-motion-exit); }`, /never through a token/);
  refuses(`${slot} { visibility: collapse; }`, /visibility: collapse hides the part/);
  refuses(`${slot} { content-visibility: hidden; }`, /skips rendering the part's contents/);
  refuses(`${slot} { position: absolute; inset: 0; }`, /takes the part out of the flow/);
  refuses(`${slot} { display: table; }`, /it takes block, inline, inline-block, flex/);
  refuses(`${slot} { display: block flex; }`, /isn't a value a language may give display/);
  refuses(`${slot} { position: revert-layer; }`, /it takes static or relative/);
  const kept = read(`${slot} {
    display: Flex;
    visibility: visible;
    content-visibility: auto;
    position: relative;
  }`);
  assert.ok(kept.ok);
  assert.deepEqual(kept.ok && kept.nodes[0]!.type === 'rule' ? kept.nodes[0].declarations : [], [
    { property: 'display', value: 'flex' },
    { property: 'visibility', value: 'visible' },
    { property: 'content-visibility', value: 'auto' },
    { property: 'position', value: 'relative' },
  ]);
});

test('motion, blur, opacity, and filters go only through the tokens the accessibility layer overrides', () => {
  const slot = '[data-ui-slot="action"]';
  refuses(
    `${slot}:hover { transform: translateY(-12px) rotate(8deg); transition: transform var(--ui-motion-slow); }`,
    /moves the part outside the tokens/,
  );
  refuses(`${slot} { translate: 0 -12px; }`, /translate: 0 -12px moves the part/);
  refuses(`${slot} { scale: 1.5; }`, /scale: 1\.5 moves the part/);
  refuses(`${slot} { rotate: 8deg; }`, /rotate: 8deg moves the part/);
  refuses(
    `${slot} { transform: var(--ui-radius-card); }`,
    /it takes none, var\(--ui-state-hover-transform\)/,
  );
  refuses(`${slot} { backdrop-filter: blur(24px); }`, /blurs outside the tokens/);
  refuses(`${slot} { -webkit-backdrop-filter: blur(24px); }`, /blurs outside the tokens/);
  refuses(`${slot} { backdrop-filter: blur(var(--ui-radius-card)); }`, /blurs outside the tokens/);
  refuses(`${slot} { opacity: 0.6; }`, /sets opacity outside the tokens/);
  refuses(`${slot} { opacity: var(--ui-texture); }`, /sets opacity outside the tokens/);
  refuses(`${slot} { filter: opacity(0); }`, /filters the part/);
  refuses(`${slot} { filter: blur(24px); }`, /filters the part/);
  assert.ok(
    read(`${slot}:hover {
      transform: var(--ui-state-hover-transform);
      translate: none;
      transition: transform var(--ui-motion-fast) var(--ui-motion-easing);
    }
    ${slot}:active { scale: var(--ui-state-active-transform); }
    [data-ui-slot="surface"] {
      opacity: var(--ui-surface-opacity);
      backdrop-filter: blur(var(--ui-backdrop-blur));
      -webkit-backdrop-filter: none;
      filter: none;
    }
    ${slot}[aria-busy="true"] { opacity: var(--ui-state-loading-opacity); }`).ok,
  );
});

test('at-rules a language can use, and the ones it cannot', () => {
  const rule = '[data-ui-slot="action"] { border-radius: 0; }';
  refuses(`@layer language { ${rule} }`, /@layer can't declare a layer/);
  refuses('@layer reset, language;', /@layer can't declare a layer/);
  refuses(`@scope ([data-x]) { ${rule} }`, /@scope can't open a scope/);
  refuses(
    '@keyframes spin { to { transform: rotate(1turn); } }',
    /@keyframes can't declare keyframes/,
  );
  refuses('@-webkit-keyframes spin { to { border-radius: 0; } }', /can't declare keyframes/);
  refuses(`@page { margin: 0; }`, /isn't an at-rule a language can use/);
  refuses('@charset "utf-8";', /isn't an at-rule a language can use/);
  refuses(
    `@media (prefers-reduced-motion: no-preference) { ${rule} }`,
    /a preference the accessibility layer answers/,
  );
  refuses(`@media (forced-colors: active) { ${rule} }`, /a preference/);
  refuses(`@media (prefers-color-scheme: dark) { ${rule} }`, /a preference/);
  refuses(`@media print { ${rule} }`, /isn't a media type or keyword/);
  refuses(`@media (color-gamut: p3) { ${rule} }`, /can't branch on/);
  refuses(`@supports selector(:has(a)) { ${rule} }`, /tests a selector/);
  refuses(
    `@media (min-width: 1px) { @media (min-width: 2px) { @media (min-width: 3px) { @media (min-width: 4px) { ${rule} } } } }`,
    /more than 3 deep/,
  );
  assert.ok(read(`@media screen and (max-width: 40rem), (orientation: landscape) { ${rule} }`).ok);
  assert.ok(read(`@media (30rem <= width < 60rem) { ${rule} }`).ok);
  assert.ok(read(`@container card (min-inline-size: 20rem) { ${rule} }`).ok);
});

test('nothing reaches past the scope: nesting, stray braces, escapes, and unclosed text', () => {
  const slot = '[data-ui-slot="action"]';
  refuses(
    `${slot} { border-radius: 0; } } :root { border-radius: 0; }`,
    /closes a block it never opened/,
  );
  refuses(
    `${slot} { border-radius: 0; [data-ui-slot="x"] { border-radius: 0; } }`,
    /nests a rule inside a rule/,
  );
  refuses(`${slot} { &:hover { border-radius: 0; } }`, /can't nest rules with &/);
  refuses(`${slot} { border-radius: 0;`, /opens a block it never closes/);
  refuses(`${slot} { border-radius: 0; } /* never closed`, /opens a comment it never closes/);
  refuses(`[data-ui-slot="a] { border-radius: 0; }`, /opens a string it never closes/);
  refuses(`${slot} { dis\\play: none; }`, /can't use a backslash/);
  refuses(`[data-ui-slot="\\61"] { border-radius: 0; }`, /can't use a backslash/);
  refuses(`${slot} { border-radius: 0; }\u00a0`, /plain ASCII/);
  // A Cyrillic a, which looks like the Latin one.
  refuses(`[data-ui-slot="\u0430ction"] { border-radius: 0; }`, /plain ASCII/);
  refuses(`${slot} { opacity: calc(1 + (2); }`, /leaves a parenthesis open/);
  refuses(`${slot} { border-radius: 0; } trailing`, /isn't a rule/);
  refuses(`border-radius: 0;`, /declaration outside any rule/);
  refuses(
    `${slot} { background: var(--color-accent); } @media (min-width: 1px) { :root { border-radius: 0 } }`,
    /uses :root/,
  );
  // A brace inside a string never closes anything.
  refuses(`[data-ui-slot="}"] { border-radius: 0; }`, /an attribute test is/);
  refuses(`${slot}::before { content: "}"; }`, /adds text/);
});

test('problems carry their line and column, and the reader never throws', () => {
  const result = read('[data-ui-slot="a"] {\n  border-radius: 0;\n  display: none;\n}\n');
  assert.equal(result.ok, false);
  assert.deepEqual(result.ok ? null : result.problems[0]!, {
    line: 3,
    column: 3,
    message:
      'display: none removes the part from the page or its semantics: languages style parts, never hide them.',
  });
  for (const input of [
    '',
    '{',
    '}',
    ';',
    '@',
    '"',
    "'",
    '(',
    ')',
    '[',
    ']',
    '/*',
    '*/',
    '::',
    '[]{}',
    '@media{}',
    '[data-ui-slot]{a:}',
    'a,{}',
  ]) {
    assert.doesNotThrow(() => read(input), input);
  }
  assert.ok(read('').ok, 'an empty stylesheet reads as no rules');
  refuses(
    `[data-ui-slot] { border-radius: 0; }\n${' '.repeat(MAX_STYLESHEET_BYTES)}`,
    /larger than 32 KB/,
  );
});
