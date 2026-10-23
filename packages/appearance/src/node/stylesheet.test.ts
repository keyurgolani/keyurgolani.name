import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LANGUAGE_PROPERTIES,
  MAX_STYLESHEET_BYTES,
  readLanguageStylesheet,
  writeStyleNodes,
} from './stylesheet';

// A design language's stylesheet (#19, Slice 2, item 1): the subset it may
// use, each refusal the refined body lists, the properties it may set and
// nothing else, and inputs that try to reach past the language's @scope or
// layer.

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

/**
 * The reviewed prototype's language layer (appearance-boundary.css, lines
 * 333 to 453), every rule it styles per language through a token, written as
 * a language's stylesheet: --appearance-* tokens as --ui-*, its focus color as
 * var(--color-focus), and its parts as [data-ui-slot] parts.
 */
const PROTOTYPE_LANGUAGE_LAYER = `
  [data-ui-slot="surface"] {
    border-radius: var(--ui-radius-card);
    box-shadow: var(--ui-shadow-card);
    backdrop-filter: blur(var(--ui-backdrop-blur));
  }
  [data-ui-slot="action"] {
    min-height: var(--ui-control-height);
    padding: var(--ui-space-control-block) var(--ui-space-control-inline);
    border: var(--ui-border-control);
    border-radius: var(--ui-radius-control);
    transition:
      transform var(--ui-motion-fast) var(--ui-motion-easing),
      background-color var(--ui-motion-fast) var(--ui-motion-easing),
      border-color var(--ui-motion-fast) var(--ui-motion-easing);
  }
  [data-ui-slot="action"]:hover:not(:disabled) { transform: var(--ui-state-hover-transform); }
  [data-ui-slot="action"]:active:not(:disabled) { transform: var(--ui-state-active-transform); }
  [data-ui-slot="action"]:disabled { opacity: var(--ui-state-disabled-opacity); }
  [data-ui-slot="action"][aria-busy="true"] { opacity: var(--ui-state-loading-opacity); }
  [data-ui-slot="field"] > [data-ui-slot="field.input"] {
    min-height: var(--ui-control-height);
    padding: var(--ui-space-control-block) var(--ui-space-control-inline);
    border: var(--ui-border-control);
    border-width: var(--ui-state-validation-emphasis);
    border-radius: var(--ui-radius-control);
  }
  [data-ui-slot="selection"] { padding: 0; border: 0; }
  [data-ui-slot="badge"] {
    border: var(--ui-border-control);
    border-radius: var(--ui-radius-badge);
  }
  [data-ui-slot="tab"] {
    min-height: var(--ui-control-height);
    padding-inline: var(--ui-space-control-inline);
    border: var(--ui-border-control);
    border-radius: var(--ui-radius-control);
  }
  [data-ui-slot="disclosure"] {
    padding-block: var(--ui-space-control-block);
    border-top: var(--ui-border-divider);
    border-bottom: var(--ui-border-divider);
  }
  [data-ui-slot="dialog"] {
    border: var(--ui-border-card);
    border-radius: var(--ui-radius-overlay);
    box-shadow: var(--ui-shadow-overlay);
  }
  [data-ui-slot="tooltip"] {
    border: var(--ui-border-control);
    border-radius: var(--ui-radius-control);
    box-shadow: var(--ui-shadow-raised);
  }
  [data-ui-slot="media"] {
    border: var(--ui-border-card);
    border-radius: var(--ui-radius-media);
  }
  [data-ui-slot]:focus-visible {
    outline: var(--ui-focus-width) var(--ui-focus-style) var(--color-focus);
    outline-offset: var(--ui-focus-offset);
  }
  [data-ui-slot="icon"] {
    fill: var(--ui-icon-fill);
    stroke-width: var(--ui-icon-stroke-width);
  }
`;

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
  refuses(`${slot} { display: none; }`, /display: none lays the part out, or takes it off/);
  refuses(`${slot} { visibility: hidden; }`, /visibility: hidden can hide the part/);
  refuses(`${slot}::before { content: "New"; }`, /content: "New" adds text/);
  refuses(`${slot} { order: -1; }`, /order: -1 reorders content/);
  refuses(`${slot} { grid-column: 1 / -1; }`, /places a grid item/);
  refuses(`${slot} { grid-area: hero; }`, /places a grid item/);
  refuses(`${slot} { position: fixed; }`, /position: fixed places the part/);
  refuses(`${slot} { border-color: #ff0000; }`, /hex color literal/);
  refuses(`${slot} { border-color: rebeccapurple; }`, /can't hold the color rebeccapurple/);
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

test('a selector may test the kind a primitive renders as, its data-emphasis and data-status (Slice 3)', () => {
  const sheet = read(`
    [data-ui-slot="action"][data-emphasis="primary"] { border-radius: 0; }
    [data-ui-slot="surface"]:not([data-emphasis="subtle"]) { border-radius: 0; }
    [data-ui-slot="badge"][data-status~="danger"] { border-radius: 0; }
  `);
  assert.ok(sheet.ok, JSON.stringify(sheet));
  refuses('[data-emphasis="primary"] { border-radius: 0; }', /every part/);
  refuses('[data-ui-slot][data-tone="danger"] { border-radius: 0; }', /tests \[data-tone\]/);
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
  refuses(`${slot} { animation: spin 1s linear infinite; }`, /animates through keyframes/);
  refuses(`${slot} { animation-name: spin; }`, /animates through keyframes/);
  refuses(`${slot} { background: url(https://example.test/x.png); }`, /url\(\)/);
  refuses(`${slot} { background: image-set(x 1x); }`, /calls image-set\(\)/);
  refuses(
    `${slot} { border-color: var(--type-body-font-size); }`,
    /var\(--color-<role>\) or var\(--ui-<key>\)/,
  );
  refuses(`${slot} { border-color: var(--color-accent, red); }`, /no fallback/);
  refuses(
    `${slot} { border-color: var(--color-nonexistent); }`,
    /var\(--color-<role>\) or var\(--ui-<key>\)/,
  );
  refuses(`${slot} { all: unset; }`, /resets every property/);
  refuses(`${slot} { display: contents; }`, /display: contents lays the part out/);
  refuses(`${slot} { position: sticky; }`, /position: sticky places the part/);
  refuses(`${slot} { flex-direction: row-reverse; }`, /lays out the part or its contents/);
  refuses(`${slot} { direction: rtl; }`, /reorders content/);
  refuses(`${slot} { -webkit-order: 2; }`, /reorders content/);
  refuses(`${slot} { DISPLAY: block; }`, /isn't a lowercase property name/);
  refuses(`${slot} { color var(--color-accent); }`, /isn't a declaration/);
  // What a language does style.
  assert.ok(
    read(`${slot} {
      min-height: var(--ui-control-height);
      border: var(--ui-border-control);
      border-color: currentcolor;
      backdrop-filter: blur(var(--ui-backdrop-blur));
      -webkit-backdrop-filter: blur(var(--ui-backdrop-blur));
      transition: opacity var(--ui-motion-fast) var(--ui-motion-easing);
    }`).ok,
  );
});

test('deny by default: display, visibility, content-visibility, and position are never a language property, whatever the value', () => {
  const slot = '[data-ui-slot="surface"]';
  // Before the allowlist, the reader took these keywords as written.
  for (const value of ['block', 'flex', 'inline-flex', 'grid', 'flow-root', 'none', 'contents']) {
    refuses(`${slot} { display: ${value}; }`, new RegExp(`display: ${value} lays the part out`));
  }
  refuses(`${slot} { display: Flex; }`, /display: Flex lays the part out/);
  for (const value of ['visible', 'hidden', 'collapse']) {
    refuses(`${slot} { visibility: ${value}; }`, new RegExp(`visibility: ${value} can hide`));
  }
  for (const value of ['visible', 'auto', 'hidden']) {
    refuses(
      `${slot} { content-visibility: ${value}; }`,
      new RegExp(`content-visibility: ${value} can skip rendering`),
    );
  }
  for (const value of ['static', 'relative', 'absolute', 'fixed', 'sticky']) {
    refuses(`${slot} { position: ${value}; }`, new RegExp(`position: ${value} places the part`));
  }
  // A token's value lands at compute time, where nothing reads it first.
  refuses(`${slot} { display: var(--ui-texture); }`, /display: var\(--ui-texture\) lays/);
  refuses(
    `${slot} { visibility: var(--ui-motion-exit); }`,
    /visibility: var\(--ui-motion-exit\) can hide/,
  );
  refuses(
    `${slot} { position: var(--ui-motion-enter); }`,
    /position: var\(--ui-motion-enter\) places/,
  );
  // Whatever the part could be placed with goes the same way.
  for (const declaration of [
    'inset: 0',
    'top: -9999px',
    'inset-inline-start: 0',
    'z-index: 2147483647',
    'float: left',
  ]) {
    refuses(`${slot} { ${declaration}; }`, /places the part, which is the variant's layout/);
  }
});

test('every hiding and layout vector the review lists is refused', () => {
  const slot = '[data-ui-slot="surface"]';
  refuses(
    `${slot} { clip-path: inset(50%); }`,
    /clip-path: inset\(50%\) can clip or mask the part/,
  );
  refuses(`${slot} { clip-path: content-box; }`, /can clip or mask the part/);
  refuses(
    `${slot} { mask: linear-gradient(transparent, transparent); }`,
    /mask: linear-gradient\(transparent, transparent\) can clip or mask the part/,
  );
  refuses(
    `${slot} { -webkit-mask-image: linear-gradient(transparent, transparent); }`,
    /can clip or mask the part/,
  );
  refuses(`${slot} { zoom: 0.01; }`, /zoom: 0.01 scales the part and its layout/);
  // Sizes, zero ones included, are the variant's.
  for (const property of [
    'width',
    'height',
    'max-width',
    'max-height',
    'max-inline-size',
    'max-block-size',
    'inline-size',
    'block-size',
    'min-width',
    'min-inline-size',
  ]) {
    refuses(`${slot} { ${property}: 0; }`, new RegExp(`^${property}: 0 sizes the part`));
  }
  refuses(`${slot} { aspect-ratio: 1000; }`, /sizes the part/);
  refuses(`${slot} { overflow: hidden; }`, /overflow: hidden can clip the part's contents/);
  refuses(`${slot} { overflow-y: clip; }`, /can clip the part's contents/);
  refuses(`${slot} { text-overflow: ellipsis; }`, /can clip the part's contents/);
  refuses(`${slot} { color: transparent; }`, /color: transparent colors the part's text/);
  // The scheme's colors on the part's own ground hide text as well as transparent does.
  refuses(`${slot} { color: var(--color-canvas); }`, /a language never colors text/);
  refuses(`${slot} { -webkit-text-fill-color: transparent; }`, /a language never colors text/);
  refuses(`${slot} { font-size: 0; }`, /font-size: 0 sets type/);
  refuses(`${slot} { text-indent: -9999px; }`, /text-indent: -9999px indents the text/);
  // What the ownership table gives typography: weight, tracking, and leading as well.
  for (const declaration of [
    'font-weight: 650',
    'letter-spacing: -1em',
    'line-height: 0',
    'font-style: italic',
    'text-transform: uppercase',
    'word-spacing: 1em',
  ]) {
    refuses(`${slot} { ${declaration}; }`, /sets type, which belongs to the typography profile/);
  }
});

test('outlines, shadows, padding, gaps, borders, and radii stay within their caps, so none covers the page or pushes content off it', () => {
  const slot = '[data-ui-slot="surface"]';
  refuses(
    `${slot}:focus-visible { outline: 100000px solid var(--color-canvas); }`,
    /outline: 100000px solid var\(--color-canvas\) has 100000px, over the cap of 64px or 4rem/,
  );
  refuses(
    `${slot} { box-shadow: 0 0 0 100vmax var(--color-canvas); }`,
    /box-shadow: 0 0 0 100vmax var\(--color-canvas\) uses 100vmax, which scales with the window/,
  );
  refuses(
    `${slot} { padding-inline-start: 100vw; }`,
    /padding-inline-start: 100vw uses 100vw, which scales with the window/,
  );
  for (const declaration of [
    'box-shadow: inset 0 0 0 65px var(--color-text-primary)',
    'box-shadow: 0 0 100px var(--color-shadow)',
    'outline-offset: -65px',
    'gap: 4.5rem',
    'padding: 0 65px',
    'border-bottom: 1000px solid var(--color-canvas)',
    'border-width: 65px',
  ]) {
    refuses(`${slot} { ${declaration}; }`, /over the cap of 64px or 4rem/);
  }
  for (const declaration of [
    'padding: 10%',
    'border-radius: 50%',
    'outline-width: 1dvmax',
    'gap: 10svh',
    'padding: 1cqi',
    'border-width: 1in',
    'padding: 5',
  ]) {
    refuses(`${slot} { ${declaration}; }`, /a length here is px or rem/);
  }
  refuses(`${slot} { border-radius: 1000px; }`, /over a radius's cap of 999px or 62\.4375rem/);
  // em scales with the part's font size, which a display part's typography sets.
  for (const declaration of [
    'padding: 4em',
    'gap: 0.45em',
    'outline: 1em solid var(--color-focus)',
    'border-radius: 1em',
  ]) {
    refuses(
      `${slot} { ${declaration}; }`,
      /scales with the part's font size, the typography profile's/,
    );
  }
  // Math or a radius token would stretch a length past its cap.
  refuses(`${slot} { padding: calc(var(--ui-space-surface-block) * 1000); }`, /calls calc\(\)/);
  refuses(`${slot} { gap: max(4rem, 100vw); }`, /calls max\(\)/);
  refuses(`${slot} { padding: var(--ui-radius-badge); }`, /reads a radius token/);
  refuses(
    `${slot} { box-shadow: 0 0 0 var(--ui-radius-badge) var(--color-canvas); }`,
    /reads a radius token/,
  );
  // What fits: the caps themselves, tokens, and percentages that mix colors.
  assert.ok(
    read(`${slot} {
      box-shadow: 0 22px 60px color-mix(in srgb, var(--color-text-primary) 22%, transparent), var(--ui-shadow-card);
      outline: 4px solid var(--color-focus);
      outline-offset: -64px;
      padding: 4rem 0 64px;
      gap: var(--ui-space-surface-block);
      border: var(--ui-border-card);
      border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
      border-radius: 999px 62.4375rem var(--ui-radius-card);
    }`).ok,
  );
  // Elsewhere percentages and other units stay, as in a texture's gradient.
  assert.ok(
    read(
      `${slot} { background-image: radial-gradient(circle at 25% 25%, var(--color-accent) 0 8%, transparent 9%); }`,
    ).ok,
  );
});

test('a control height is the one size a language sets, through its token', () => {
  const slot = '[data-ui-slot="action"]';
  assert.ok(read(`${slot} { min-height: var(--ui-control-height); }`).ok);
  assert.ok(read(`${slot} { min-block-size: var(--ui-control-height); }`).ok);
  for (const value of [
    '2rem',
    '0',
    '100vh',
    'var(--ui-space-control-block)',
    'calc(var(--ui-control-height) * 100)',
  ]) {
    refuses(`${slot} { min-height: ${value}; }`, /a language sizes only a control, as min-height/);
  }
  refuses(`${slot} { min-block-size: 100vh; }`, /sizes the part/);
});

test('a property off the list is refused with whose it is, or as one a language never sets', () => {
  const slot = '[data-ui-slot="action"]';
  for (const declaration of [
    'margin: 0 0 0 -100vw',
    'align-items: center',
    'justify-content: center',
    'flex: 1',
    'grid-template-columns: 1fr',
    'columns: 2',
    'box-sizing: content-box',
  ]) {
    refuses(`${slot} { ${declaration}; }`, /lays out the part or its contents/);
  }
  for (const declaration of [
    'cursor: pointer',
    'pointer-events: none',
    'user-select: none',
    'appearance: none',
    'mix-blend-mode: difference',
  ]) {
    refuses(`${slot} { ${declaration}; }`, /which the shared primitives own/);
  }
  refuses(`${slot} { forced-color-adjust: none; }`, /forced colors or print/);
  refuses(`${slot} { filter: opacity(0); }`, /filters the part/);
  for (const declaration of [
    'list-style: none',
    'text-align: center',
    '-webkit-box-reflect: below',
    '-webkit-line-clamp: 1',
  ]) {
    refuses(`${slot} { ${declaration}; }`, /isn't a property a design language sets/);
  }
});

test("the prototype's language layer reads, and the rules a part needs structurally are the primitives'", () => {
  const result = read(PROTOTYPE_LANGUAGE_LAYER);
  assert.ok(result.ok, JSON.stringify(result.ok ? [] : result.problems));
  const properties = new Set<string>();
  const collect = (nodes: typeof result.nodes) => {
    for (const node of nodes) {
      if (node.type === 'group') collect(node.children);
      else for (const { property } of node.declarations) properties.add(property);
    }
  };
  collect(result.ok ? result.nodes : []);
  assert.deepEqual([...properties].sort(), [
    'backdrop-filter',
    'border',
    'border-bottom',
    'border-radius',
    'border-top',
    'border-width',
    'box-shadow',
    'fill',
    'min-height',
    'opacity',
    'outline',
    'outline-offset',
    'padding',
    'padding-block',
    'padding-inline',
    'stroke-width',
    'transform',
    'transition',
  ]);
  for (const property of properties) assert.ok(LANGUAGE_PROPERTIES.has(property), property);
  // The layer's rules that every language shares, which slice 3's primitives own.
  for (const [declaration, owner] of [
    ['display: inline-flex', /display is the shared primitives'/],
    ['align-items: center', /lays out the part or its contents, which the shared primitives/],
    ['justify-content: center', /lays out the part or its contents, which the shared primitives/],
    ['width: 100%', /sizes the part/],
    ['width: fit-content', /sizes the part/],
    ['min-height: 2rem', /sizes the part/],
    ['overflow: hidden', /media with rounded corners, does so in the shared primitives/],
    ['cursor: pointer', /which the shared primitives own/],
    ['font-weight: 650', /typography profile/],
    ['gap: 0.45em', /scales with the part's font size/],
    ['padding: 0.32em 0.68em', /scales with the part's font size/],
  ] as const) {
    refuses(`[data-ui-slot="media"] { ${declaration}; }`, owner);
  }
});

test('the list gives a language what the ownership table does, and nothing it gives another axis', () => {
  for (const property of [
    'border',
    'border-inline-end-color',
    'border-end-start-radius',
    'box-shadow',
    'background-image',
    'opacity',
    'backdrop-filter',
    'min-height',
    'padding-block-start',
    'column-gap',
    'outline-offset',
    'fill',
    'stroke-width',
    'transition-timing-function',
    'transform',
    'content',
  ]) {
    assert.ok(LANGUAGE_PROPERTIES.has(property), property);
  }
  for (const property of [
    'font',
    'font-family',
    'font-size',
    'font-weight',
    'letter-spacing',
    'line-height',
    'display',
    'position',
    'width',
    'height',
    'max-width',
    'min-width',
    'margin',
    'order',
    'grid-area',
    'color',
    'visibility',
    'overflow',
    'clip-path',
    'mask',
    'zoom',
    'filter',
    'text-indent',
    'z-index',
  ]) {
    assert.ok(!LANGUAGE_PROPERTIES.has(property), property);
  }
  assert.equal(LANGUAGE_PROPERTIES.size, 101);
});

test('motion, blur, and opacity go only through the tokens the accessibility layer overrides', () => {
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
  // Surface translucency is the material's, and surface-opacity no part's opacity.
  refuses(
    '[data-ui-slot="surface"] { opacity: var(--ui-surface-opacity); }',
    /var\(--ui-surface-opacity\) sets opacity outside the tokens/,
  );
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
      backdrop-filter: blur(var(--ui-backdrop-blur));
      -webkit-backdrop-filter: none;
    }
    ${slot}[aria-busy="true"] { opacity: var(--ui-state-loading-opacity); }`).ok,
  );
});

test('the state opacities dim only a part each selector tests as disabled or busy', () => {
  const slot = '[data-ui-slot="action"]';
  for (const selector of [
    `${slot}:disabled`,
    `${slot}[disabled]`,
    `${slot}[aria-disabled="true"]`,
    `${slot}[aria-busy="true"]:hover`,
    `${slot}[disabled]::before`,
    `[data-ui-slot="form"] > ${slot}[disabled], ${slot}[aria-busy="true"]`,
  ]) {
    assert.ok(read(`${selector} { opacity: var(--ui-state-disabled-opacity); }`).ok, selector);
    assert.ok(read(`${selector} { opacity: var(--ui-state-loading-opacity); }`).ok, selector);
  }
  for (const selector of [
    slot,
    `${slot}:hover`,
    `${slot}:not([disabled])`,
    `${slot}:not(:disabled)`,
    `${slot}[aria-disabled="false"]`,
    `${slot}[aria-busy]`,
    `${slot}:has([disabled])`,
    `${slot}:is([disabled])`,
    `[data-ui-slot="form"][disabled] ${slot}`,
    `${slot}[disabled] + [data-ui-slot="badge"]`,
    `${slot}[disabled], [data-ui-slot="badge"]`,
  ]) {
    refuses(
      `${selector} { opacity: var(--ui-state-disabled-opacity); }`,
      /dims a part the rule doesn't test as disabled or busy/,
    );
  }
  // A group doesn't change what a rule's own selector tests.
  refuses(
    `@media (hover: hover) { ${slot} { opacity: var(--ui-state-loading-opacity); } }`,
    /dims a part/,
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
      "display: none lays the part out, or takes it off the page: display is the shared primitives' and the variant's, never a language's.",
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
