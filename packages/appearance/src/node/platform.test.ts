import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { languageTokenProblem } from '../language-grammar';
import { LAYER_ORDER } from '../layers';
import { COLOR_ROLES, LANGUAGE_KEYS } from '../tokens';
import { catalogPacks, packPackages } from './catalog';
import { compilePlatform, layerRules, platformStylesheet, SURFACE_HOOKS } from './platform';
import { propertyRules, scaleDeclarations } from '../scales';
import { readLanguageStylesheet } from './stylesheet';

// The platform stylesheet (#19, Slice 2, item 3): the reset, utilities, and
// accessibility layers, where accessibility rules override tokens, not rules.

const css = platformStylesheet();

/** The declarations of the first block whose selector list is exactly `selectors`, under `within` if given. */
function declarations(selectors: string, within?: string): Map<string, string> {
  const scope = within ? css.slice(css.indexOf(`${within} {`)) : css;
  const start = scope.indexOf(`${selectors} {\n`);
  assert.ok(start >= 0, `no block for ${selectors}${within ? ` in ${within}` : ''}`);
  const body = scope.slice(start + selectors.length + 3, scope.indexOf('}', start));
  return new Map(
    body
      .split('\n')
      .map((line) => /^\s*([a-z0-9-]+): (.*);$/.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => [match[1]!, match[2]!]),
  );
}

test('it starts with the layer order and holds the reset, utilities, and accessibility layers in order', () => {
  assert.ok(css.startsWith(`${LAYER_ORDER}\n`));
  assert.deepEqual(css.match(/^@layer [a-z-]+ \{/gm), [
    '@layer reset {',
    '@layer utilities {',
    '@layer accessibility {',
  ]);
});

test('the reset paints each boundary from its tokens', () => {
  const reset = declarations('  [data-appearance-boundary]', '@layer reset');
  assert.equal(reset.get('color'), 'var(--color-text-primary)');
  assert.equal(reset.get('background-color'), 'var(--color-canvas)');
  assert.equal(reset.get('font-family'), 'var(--type-body-font-family)');
  assert.equal(reset.get('line-height'), 'var(--type-body-line-height)');
  // A word wider than its line breaks, without lowering min-content sizing (#11, 1.4.10).
  assert.equal(reset.get('overflow-wrap'), 'break-word');
});

test("the reset puts every id and focusable element below a variant's sticky chrome (Slice 3)", () => {
  const offset = declarations(
    '  [data-appearance-boundary] :is([id], a[href], area[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable])',
    '@layer reset',
  );
  assert.deepEqual(Object.fromEntries(offset), {
    'scroll-margin-top': 'var(--layout-sticky-offset, 0px)',
  });
});

test("the primitives' rules join the platform's reset and utilities layers, under the accessibility layer (Slice 3)", () => {
  const primitives = readFileSync(new URL('../primitives/styles.css', import.meta.url), 'utf8');
  const reset = css.slice(css.indexOf('@layer reset {'), css.indexOf('@layer utilities {'));
  const utilities = css.slice(
    css.indexOf('@layer utilities {'),
    css.indexOf('@layer accessibility {'),
  );
  assert.ok(reset.includes("  [data-ui-slot='action'] {\n"), 'an action renders from the tokens');
  assert.ok(reset.includes("  [data-ui-slot='surface'][data-emphasis='prominent'] {\n"));
  assert.ok(
    utilities.includes('  [data-appearance-boundary] :focus-visible {\n'),
    'focus is an outline',
  );
  assert.ok(utilities.includes('  @keyframes fade-rise {\n'));
  // Every rule of theirs is here, once, in its own layer.
  for (const layer of ['reset', 'utilities'] as const) {
    const within = layer === 'reset' ? reset : utilities;
    for (const line of layerRules(primitives, layer).split('\n')) {
      if (/^\S.*\{$/.test(line)) assert.ok(within.includes(`\n  ${line}\n`), `${layer}: ${line}`);
    }
  }
  assert.equal(css.split('@layer reset {').length, 2, 'still one reset block');
  assert.throws(() => layerRules('@layer reset {}', 'utilities'), /no @layer utilities block/);
});

test('reduced motion keeps motion-fast feedback and stops or fades the rest', () => {
  for (const [selector, within] of [
    ['    [data-appearance-boundary]', '@media (prefers-reduced-motion: reduce)'],
    ['  [data-appearance-boundary][data-motion="reduced"]', '@layer accessibility'],
  ] as const) {
    const reduced = declarations(selector, within);
    assert.equal(reduced.has('--ui-motion-fast'), false);
    assert.equal(reduced.get('--ui-state-hover-transform'), 'none');
    assert.equal(reduced.get('--ui-state-active-transform'), 'none');
    assert.equal(reduced.get('--ui-motion-enter'), 'fade');
    assert.equal(reduced.get('--ui-motion-exit'), 'fade');
    assert.equal(reduced.get('--ui-motion-emphasis'), 'none');
    // Every duration is the fast one, which the pack gate holds to the reduced-motion limit (#11).
    assert.equal(reduced.get('--ui-motion-standard'), 'var(--ui-motion-fast)');
    assert.equal(reduced.get('--ui-motion-slow'), 'var(--ui-motion-fast)');
    // What a composition reads for motion takes the fast duration too, whatever its slots say (M2).
    assert.equal(reduced.get('--motion-feedback'), 'var(--ui-motion-fast)');
    assert.equal(reduced.get('--motion-scene'), 'var(--ui-motion-fast)');
    assert.equal(reduced.has('--layout-motion-scene'), false);
  }
  const paused = declarations(
    '  [data-appearance-boundary][data-motion="static"]',
    '@layer accessibility',
  );
  assert.equal(paused.get('--ui-motion-fast'), '0s');
  assert.equal(paused.get('--ui-motion-enter'), 'none');
  assert.equal(paused.get('--motion-feedback'), '0s');
  assert.equal(paused.get('--motion-scene'), '0s');
  // A disclosure's chevron keeps still: its turn is movement, though it runs at the fast duration.
  const chevron = "[data-marker='chevron'] > [data-ui-slot='disclosure.summary']::after";
  assert.equal(
    declarations(
      `    [data-appearance-boundary] ${chevron}`,
      '@media (prefers-reduced-motion: reduce)',
    ).get('transition'),
    'none',
  );
  assert.equal(
    declarations(
      [
        `  [data-appearance-boundary][data-motion="reduced"] ${chevron}`,
        `  [data-appearance-boundary][data-motion="static"] ${chevron}`,
      ].join(',\n'),
      '@layer accessibility',
    ).get('transition'),
    'none',
  );
});

test("the reset declares the shared scales on each boundary, under every pack's layer (redesign G1, G3, G6, T2, M3)", () => {
  const reset = css.slice(css.indexOf('@layer reset {'), css.indexOf('@layer utilities {'));
  const start = reset.indexOf('  [data-appearance-boundary] {\n    --space-3xs:');
  assert.ok(start >= 0, 'no scales block in the reset layer');
  const body = reset.slice(start, reset.indexOf('}', start));
  const names = [...body.matchAll(/^\s+(--[\w-]+): /gm)].map((match) => match[1]);
  assert.deepEqual(names, Object.keys(scaleDeclarations()));
  // Nothing outside the reset layer and the accessibility layer's motion rules declares them.
  const elsewhere = css.replace(reset, '');
  for (const name of names) {
    if (['--motion-feedback', '--motion-scene', '--motion-ambient-state'].includes(name!)) continue;
    assert.equal(elsewhere.includes(`${name}:`), false, `${name} is declared outside the reset`);
  }
});

test('forced colors map every color role to a system color and drop the effects', () => {
  const forced = declarations('    [data-appearance-boundary]', '@media (forced-colors: active)');
  const roles = [...forced.keys()].filter((key) => key.startsWith('--color-'));
  assert.deepEqual(
    roles,
    COLOR_ROLES.map((role) => `--color-${role}`),
  );
  for (const role of roles) assert.match(forced.get(role)!, /^[A-Z][A-Za-z]+$/, role);
  for (const key of [
    '--ui-shadow-card',
    '--ui-shadow-overlay',
    '--ui-shadow-raised',
    '--ui-shadow-inset',
    '--ui-texture',
    '--ui-emphasis-glow',
  ]) {
    assert.equal(forced.get(key), 'none', key);
  }
  assert.equal(forced.get('--ui-backdrop-blur'), '0px');
  assert.equal(forced.get('--ui-surface-opacity'), '100%');
});

test('under forced colors a Surface keeps an opaque Canvas, and an overlay Surface its edge in CanvasText', () => {
  const surface = declarations(
    '    [data-appearance-boundary] [data-ui-slot="surface"]',
    '@media (forced-colors: active)',
  );
  assert.equal(surface.get('background-color'), 'Canvas');
  const overlay = declarations(
    '    [data-appearance-boundary] [data-ui-slot="surface"][data-emphasis="overlay"]',
    '@media (forced-colors: active)',
  );
  assert.equal(overlay.get('border'), '1px solid CanvasText');
});

test("forced colors zero every language token that offsets a part or draws a shadow, whichever the contract has (poster-press's press among them)", () => {
  const forced = declarations('    [data-appearance-boundary]', '@media (forced-colors: active)');
  // The offsets: every token the stylesheet reader lets a language move a part through.
  const offsets = LANGUAGE_KEYS.filter((key) =>
    ['transform', 'translate', 'scale', 'rotate'].some(
      (property) =>
        readLanguageStylesheet(`[data-ui-slot="a"] { ${property}: var(--ui-${key}); }`).ok,
    ),
  );
  // The shadows: every token whose grammar holds a shadow, as box-shadow reads it.
  const shadows = LANGUAGE_KEYS.filter(
    (key) => languageTokenProblem(key, 'inset 0 2px 8px var(--color-text-primary)') === null,
  );
  // The lists come from the contract; these hold only that they found what it has today.
  for (const key of ['state-hover-transform', 'state-active-transform'] as const) {
    assert.ok(offsets.includes(key), key);
  }
  for (const key of ['shadow-card', 'shadow-overlay', 'shadow-raised', 'shadow-inset'] as const) {
    assert.ok(shadows.includes(key), key);
  }
  for (const key of [...offsets, ...shadows]) {
    const value = forced.get(`--ui-${key}`);
    assert.equal(value, 'none', key);
    // none is each one's zero: the token's own grammar takes it.
    assert.equal(languageTokenProblem(key, value), null, key);
  }
  // The focus ring's offset places the ring, not the part, so forced colors keep it.
  assert.equal(forced.has('--ui-focus-offset'), false);
});

test('reduced transparency and a browser without backdrop-filter get opaque surfaces', () => {
  for (const within of [
    '@media (prefers-reduced-transparency: reduce)',
    '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))',
  ]) {
    const opaque = declarations('    [data-appearance-boundary]', within);
    assert.deepEqual(Object.fromEntries(opaque), {
      '--ui-surface-opacity': '100%',
      '--ui-backdrop-blur': '0px',
    });
  }
});

test("under prefers-contrast: more and prefers-reduced-transparency: reduce, the visitor's Appearance control, summary and open panel, is opaque surface-default with text-primary, and in no other mode", () => {
  const control = [
    '    [data-appearance-boundary] [data-ui-slot="appearance-control"]',
    '    [data-appearance-boundary] [data-ui-slot="appearance-control"] [data-ui-slot="disclosure.summary"]',
  ].join(',\n');
  for (const within of [
    '@media (prefers-contrast: more)',
    '@media (prefers-reduced-transparency: reduce)',
  ]) {
    // The wrapper holds the summary and the panel, its form, actions and status, so one
    // opaque ground lies under all of them; the summary takes the text color itself, past any
    // a language or a composition gives it.
    assert.deepEqual(Object.fromEntries(declarations(control, within)), {
      'background-color': 'var(--color-surface-default)',
      'background-image': 'none',
      color: 'var(--color-text-primary)',
    });
    // Room on that ground for a ring's width past each part's ring, so a focused summary's ring
    // lies whole on it, not on what's behind it; and the ring in that ground's own ink, the
    // control's text, not a focus color inherited from a region around it (K-2's on-accent was
    // white on the plate in Terra Field's footer: 0 of 576 pixels at 3:1 under contrast-more).
    assert.deepEqual(
      Object.fromEntries(
        declarations('    [data-appearance-boundary] [data-ui-slot="appearance-control"]', within),
      ),
      {
        padding: 'calc(2 * var(--ui-focus-width) + max(0px, var(--ui-focus-offset)))',
        '--color-focus': 'var(--color-text-primary)',
      },
    );
    // In the accessibility layer, past every pack and composition.
    assert.ok(css.indexOf(within) > css.indexOf('@layer accessibility {'), within);
  }
  // Two of each, those two: normal mode, forced colors, print and the rest leave it alone.
  assert.equal(css.split('[data-ui-slot="appearance-control"],\n').length - 1, 2);
  assert.equal(css.split('[data-ui-slot="appearance-control"] {\n').length - 1, 2);
});

test('high contrast makes the signature fill solid text-primary and drops the glow and the texture, however it is asked for', () => {
  const solid = 'linear-gradient(var(--color-text-primary), var(--color-text-primary))';
  const explicit = declarations(
    '  [data-appearance-boundary][data-display-mode="high-contrast"],\n  [data-appearance-boundary][data-contrast="more"]',
    '@layer accessibility',
  );
  const preferred = declarations(
    '    [data-appearance-boundary]',
    '@media (prefers-contrast: more)',
  );
  for (const block of [explicit, preferred]) {
    assert.equal(block.get('--ui-signature-fill'), solid);
    assert.equal(block.get('--ui-emphasis-glow'), 'none');
    // Every high-contrast set draws border-subtle in the text color, so a texture would stripe the text's ground (#11).
    assert.equal(block.get('--ui-texture'), 'none');
  }
  // The one block covers both the display mode and data-contrast="more".
  for (const selector of ['[data-display-mode="high-contrast"]', '[data-contrast="more"]']) {
    assert.ok(css.includes(`[data-appearance-boundary]${selector}`), selector);
  }
  // Print, where a dark-only scheme prints its light high-contrast set, drops it too.
  const print = declarations('    [data-appearance-boundary]', '@media print');
  assert.equal(print.get('--ui-texture'), 'none');
  // As forced colors already does.
  const forced = declarations('    [data-appearance-boundary]', '@media (forced-colors: active)');
  assert.equal(forced.get('--ui-texture'), 'none');
});

test('every token a language may move, blur, or fade a part through is one the accessibility layer sets', () => {
  // Which --ui-* tokens the stylesheet reader lets each effect read.
  const accepted = (declaration: (token: string) => string, selector = '[data-ui-slot="a"]') =>
    LANGUAGE_KEYS.map((key) => `--ui-${key}`).filter(
      (token) => readLanguageStylesheet(`${selector} { ${declaration(token)}; }`).ok,
    );
  const moves = [
    ...new Set(
      ['transform', 'translate', 'scale', 'rotate'].flatMap((property) =>
        accepted((token) => `${property}: var(${token})`),
      ),
    ),
  ];
  const blurs = accepted((token) => `backdrop-filter: blur(var(${token}))`);
  // Opacity dims only a disabled or busy part, and never through surface-opacity.
  const fades = accepted((token) => `opacity: var(${token})`, '[data-ui-slot="a"]:disabled');
  assert.deepEqual(moves, ['--ui-state-hover-transform', '--ui-state-active-transform']);
  assert.deepEqual(blurs, ['--ui-backdrop-blur']);
  assert.deepEqual(fades, ['--ui-state-disabled-opacity', '--ui-state-loading-opacity']);
  // Reduced motion, a paused boundary, and print stop every move.
  for (const [selector, within] of [
    ['    [data-appearance-boundary]', '@media (prefers-reduced-motion: reduce)'],
    ['  [data-appearance-boundary][data-motion="reduced"]', '@layer accessibility'],
    ['  [data-appearance-boundary][data-motion="static"]', '@layer accessibility'],
    ['    [data-appearance-boundary]', '@media print'],
  ] as const) {
    const block = declarations(selector, within);
    for (const token of moves) assert.equal(block.get(token), 'none', `${within} ${token}`);
  }
  // Reduced transparency, a browser without backdrop-filter, forced colors, and print drop the
  // blur and make surfaces opaque. The two state opacities dim a disabled or loading part,
  // which every setting still shows.
  for (const within of [
    '@media (prefers-reduced-transparency: reduce)',
    '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))',
    '@media (forced-colors: active)',
    '@media print',
  ]) {
    const block = declarations('    [data-appearance-boundary]', within);
    for (const token of blurs) assert.equal(block.get(token), '0px', `${within} ${token}`);
    assert.equal(block.get('--ui-surface-opacity'), '100%', within);
  }
});

test('every focusable part draws its focus ring in the accessibility layer, past anything a language sets (Slice 3)', () => {
  const ring = declarations(
    '  [data-appearance-boundary] [data-ui-slot]:focus-visible',
    '@layer accessibility',
  );
  assert.deepEqual(Object.fromEntries(ring), {
    outline: 'var(--ui-focus-width) var(--ui-focus-style) var(--color-focus)',
    'outline-offset': 'var(--ui-focus-offset)',
  });
  // #20's lint refuses a language that turns the outline off. Past it, the
  // compiler puts a language's rules in the language layer, which comes
  // before the accessibility layer, so the ring would still win, and a
  // language shapes it only through the focus tokens. tests/appearance
  // renders that case.
  for (const hiding of [
    '[data-ui-slot]:focus-visible { outline-style: none; }',
    "[data-ui-slot='action']:focus-visible { outline: none; }",
  ]) {
    const read = readLanguageStylesheet(hiding);
    assert.ok(!read.ok && read.problems.some(({ rule }) => rule === 'focus-outline'), hiding);
  }
  assert.ok(readLanguageStylesheet('[data-ui-slot]:focus-visible { outline-offset: 4px; }').ok);
  const order = LAYER_ORDER.replace(/^@layer |;$/g, '').split(', ');
  assert.ok(order.indexOf('language') < order.indexOf('accessibility'));
  assert.equal(order.at(-1), 'accessibility');
  // On a toast's status fill the ring takes on-status, which the gate holds
  // to the fill, since the focus color can fall under 3:1 there (#11).
  assert.deepEqual(
    Object.fromEntries(
      declarations(
        "  [data-appearance-boundary] [data-ui-slot='toast'][data-status] [data-ui-slot]:focus-visible",
        '@layer accessibility',
      ),
    ),
    { 'outline-color': 'var(--color-on-status)' },
  );
  // Forced colors give the ring the system highlight.
  assert.equal(
    declarations('    [data-appearance-boundary]', '@media (forced-colors: active)').get(
      '--color-focus',
    ),
    'Highlight',
  );
});

test('an ambient loop runs by default, and only the pause, reduced motion, and a static page stop it (K-4 b)', () => {
  const reset = css.slice(css.indexOf('@layer reset {'), css.indexOf('@layer utilities {'));
  assert.match(reset, /--motion-ambient: var\(--layout-motion-ambient\);/);
  assert.match(reset, /--motion-ambient-state: running;/);
  const gates = [
    // Reduced motion: the OS's, and the site's policy or a preview's on the boundary.
    ['    [data-appearance-boundary]', '@media (prefers-reduced-motion: reduce)'],
    ['  [data-appearance-boundary][data-motion="reduced"]', '@layer accessibility'],
    // Static: a plate.
    ['  [data-appearance-boundary][data-motion="static"]', '@layer accessibility'],
    // The pause: a runtime root that isn't active, on the boundary or inside it.
    [
      '  [data-appearance-boundary][data-activity="paused"],\n  [data-appearance-boundary] [data-activity="paused"]',
      '@layer accessibility',
    ],
    // Print.
    ['    [data-appearance-boundary]', '@media print'],
  ] as const;
  for (const [selector, within] of gates) {
    assert.equal(
      declarations(selector, within).get('--motion-ambient-state'),
      'paused',
      `${within} ${selector.trim()}`,
    );
  }
  // Nothing else declares the state: no contrast, transparency, or forced-colors rule stops a loop.
  const states = [...css.matchAll(/--motion-ambient-state: (\w+);/g)].map((match) => match[1]);
  assert.deepEqual(states, ['running', ...gates.map(() => 'paused')]);
  // The cycle itself is never rewritten: a gate pauses the loop at its first frame.
  assert.equal(css.match(/--motion-ambient:/g)?.length, 1);
});

test('print is opaque and still', () => {
  const print = declarations('    [data-appearance-boundary]', '@media print');
  assert.equal(print.get('--ui-surface-opacity'), '100%');
  assert.equal(print.get('--ui-motion-standard'), '0s');
  assert.equal(print.get('--motion-scene'), '0s');
});

test('the platform file is named by its content', () => {
  const file = compilePlatform();
  assert.match(file.name, /^_platform\.[0-9a-f]{12}\.css$/);
  assert.equal(new TextDecoder().decode(file.bytes), css);
  assert.equal(compilePlatform().sha256, file.sha256);
});

/** `value` with each var(--ui-*) replaced by what `tokens` sets it to, until none is left. */
function resolveTokens(value: string, tokens: Readonly<Record<string, string>>): string {
  let resolved = value;
  for (let depth = 0; depth < 8 && /var\(--ui-/.test(resolved); depth++) {
    resolved = resolved.replace(/var\((--ui-[a-z0-9-]+)\)/g, (_, name: string) => {
      assert.ok(tokens[name] !== undefined, `${name} is set`);
      return tokens[name]!;
    });
  }
  assert.doesNotMatch(resolved, /var\(--ui-/, value);
  return resolved;
}

test("under reduced motion, a toast's and an open dialog's fade, and a tooltip's, run at the language's fast duration, in every registered language (#11)", () => {
  const animation = (selector: string) => {
    const start = css.indexOf(`  ${selector} {\n`);
    assert.ok(start >= 0, selector);
    const body = css.slice(start, css.indexOf('}', start));
    const value = /animation: ([^;]+);/.exec(body)?.[1];
    assert.ok(value, `${selector} animates`);
    // The shorthand's name, then its duration.
    return value.split(' ')[1]!;
  };
  const durations = {
    toast: animation("[data-ui-slot='toast']"),
    dialog: animation("[data-ui-slot='dialog'][open]"),
    tooltip: animation("[data-ui-slot='tooltip']:popover-open"),
  };
  const reducedBlocks = [
    declarations('    [data-appearance-boundary]', '@media (prefers-reduced-motion: reduce)'),
    declarations('  [data-appearance-boundary][data-motion="reduced"]', '@layer accessibility'),
  ];
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const languages = catalogPacks(root, packPackages(root)).filter(
    ({ axis }) => axis === 'designLanguage',
  );
  assert.ok(languages.length >= 30, `${languages.length} languages`);
  for (const pack of languages) {
    const own = (pack.manifest as { tokens: Record<string, string> }).tokens;
    const language = Object.fromEntries(
      Object.entries(own).map(([key, value]) => [`--ui-${key}`, value]),
    );
    for (const reduced of reducedBlocks) {
      const tokens = { ...language, ...Object.fromEntries(reduced) };
      for (const [part, duration] of Object.entries(durations)) {
        assert.equal(resolveTokens(duration, tokens), own['motion-fast'], `${pack.id} ${part}`);
      }
    }
    // At full motion the toast keeps the language's own standard duration.
    assert.equal(resolveTokens(durations.toast, language), own['motion-standard'], pack.id);
  }
});

test('the registered scale properties come right after the layer order, outside every layer', () => {
  const head = css.slice(0, css.indexOf('@layer reset {'));
  assert.ok(head.startsWith(`${LAYER_ORDER}\n`));
  assert.ok(head.includes(propertyRules()), 'the @property rules sit before the layers');
  assert.equal(css.split('@property ').length - 1, propertyRules().split('@property ').length - 1);
});

test("the surface hook: inside a region marked data-ui-surface, the focus color and a selection are that ground's pair (K-2)", () => {
  assert.deepEqual(
    SURFACE_HOOKS.map(({ surface, focus }) => [surface, focus]),
    [
      ['accent', 'on-accent'],
      ['inverse', 'focus-inverse'],
      ['emphasis', 'on-emphasis'],
    ],
  );
  const expected = {
    accent: { focus: 'on-accent', text: 'accent', ground: 'on-accent' },
    inverse: { focus: 'focus-inverse', text: 'text-primary', ground: 'text-inverse' },
    emphasis: { focus: 'on-emphasis', text: 'emphasis', ground: 'on-emphasis' },
  };
  for (const [surface, { focus, text, ground }] of Object.entries(expected)) {
    const region = `  [data-appearance-boundary] [data-ui-surface='${surface}']`;
    assert.deepEqual(Object.fromEntries(declarations(region, '@layer accessibility')), {
      '--color-focus': `var(--color-${focus})`,
    });
    assert.deepEqual(
      Object.fromEntries(
        declarations(`${region}::selection,\n${region} ::selection`, '@layer accessibility'),
      ),
      { color: `var(--color-${text})`, 'background-color': `var(--color-${ground})` },
    );
  }
  // Every role the hook names is a contract role, so each resolves in every set.
  for (const { focus, selection } of SURFACE_HOOKS)
    for (const role of [focus, ...selection]) assert.ok(COLOR_ROLES.includes(role), role);
  // Under forced colors the inverse ring is Canvas, the inverse pair's ink on CanvasText (review L1).
  assert.equal(
    declarations('    [data-appearance-boundary]', '@media (forced-colors: active)').get(
      '--color-focus-inverse',
    ),
    'Canvas',
  );
  // No other region value is remapped.
  assert.deepEqual(
    [...css.matchAll(/\[data-ui-surface='([a-z-]+)'\] \{/g)].map((match) => match[1]),
    ['accent', 'inverse', 'emphasis'],
  );
});

test("under forced colors a focused band link's ring is the system color, whatever --color-focus the composition gave the band (row 73)", () => {
  const accessibility = css.indexOf('@layer accessibility {');
  const forcedAt = css.indexOf('@media (forced-colors: active) {', accessibility);
  assert.ok(
    accessibility >= 0 && forcedAt > accessibility,
    'forced colors sit in the accessibility layer',
  );
  // The rule the safeguard adds, and the boundary's own map, from the compiled stylesheet.
  const inherits = declarations(
    '    [data-appearance-boundary] *',
    '@media (forced-colors: active)',
  );
  assert.deepEqual(Object.fromEntries(inherits), { '--color-focus': 'inherit' });
  const mapped = declarations('    [data-appearance-boundary]', '@media (forced-colors: active)');
  assert.equal(mapped.get('--color-focus'), 'Highlight');
  // The ring reads the focus color, in utilities and again in accessibility.
  for (const [selectors, layer] of [
    ['  [data-appearance-boundary] :focus-visible', '@layer utilities'],
    ['  [data-appearance-boundary] [data-ui-slot]:focus-visible', '@layer accessibility'],
  ] as const) {
    assert.match(
      declarations(selectors, layer).get('outline')!,
      /var\(--color-focus\)$/,
      selectors,
    );
  }
  const hook = SURFACE_HOOKS.find(({ surface }) => surface === 'inverse')!;
  const region = `  [data-appearance-boundary] [data-ui-surface='${hook.surface}']`;
  assert.equal(
    declarations(region, '@layer accessibility').get('--color-focus'),
    `var(--color-${hook.focus})`,
  );

  // The cascade for --color-focus down boundary > root > band > link, and in a hook's region,
  // each declaration in its layer (LAYER_ORDER), with its specificity and its source order.
  const layers = LAYER_ORDER.replace(/^@layer |;$/g, '').split(', ');
  interface Declared {
    readonly layer: string;
    readonly specificity: number;
    readonly order: number;
    readonly value: string;
    readonly forced?: boolean;
  }
  const declared: Record<string, Declared[]> = {
    boundary: [
      { layer: 'scheme', specificity: 10, order: 0, value: 'rgb(176, 91, 49)' },
      {
        layer: 'accessibility',
        specificity: 10,
        order: 2,
        value: mapped.get('--color-focus')!,
        forced: true,
      },
    ],
    root: [{ layer: 'accessibility', specificity: 10, order: 1, value: 'inherit', forced: true }],
    // The composition's own: a band, and the focused link on it, in variant-layout.
    band: [
      { layer: 'variant-layout', specificity: 20, order: 0, value: 'var(--color-on-scrim)' },
      { layer: 'accessibility', specificity: 10, order: 1, value: 'inherit', forced: true },
    ],
    link: [
      { layer: 'variant-layout', specificity: 31, order: 1, value: 'var(--color-on-scrim)' },
      { layer: 'accessibility', specificity: 10, order: 1, value: 'inherit', forced: true },
    ],
    region: [
      { layer: 'accessibility', specificity: 20, order: 0, value: `var(--color-${hook.focus})` },
      { layer: 'variant-layout', specificity: 20, order: 0, value: 'var(--color-on-scrim)' },
      { layer: 'accessibility', specificity: 10, order: 1, value: 'inherit', forced: true },
    ],
  };
  const parent: Record<string, string | null> = {
    boundary: null,
    root: 'boundary',
    band: 'root',
    link: 'band',
    region: 'root',
  };
  const resolve = (element: string, forcedColors: boolean): string => {
    const winner = declared[element]!.filter(({ forced }) => forcedColors || !forced).sort(
      (a, b) =>
        layers.indexOf(b.layer) - layers.indexOf(a.layer) ||
        b.specificity - a.specificity ||
        b.order - a.order,
    )[0];
    const up = parent[element];
    if (!winner || winner.value === 'inherit') return up ? resolve(up, forcedColors) : 'initial';
    return winner.value;
  };
  assert.ok(layers.indexOf('accessibility') > layers.indexOf('variant-layout'));
  // Forced colors on: the band link's ring is Highlight, and a hook's region keeps its own pair.
  assert.equal(resolve('link', true), 'Highlight');
  assert.equal(resolve('region', true), `var(--color-${hook.focus})`);
  // Forced colors off: the composition's band color reaches its link's ring.
  assert.equal(resolve('link', false), 'var(--color-on-scrim)');
});
