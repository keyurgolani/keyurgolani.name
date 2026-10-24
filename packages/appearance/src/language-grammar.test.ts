import test from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGE_GRAMMARS, languageTokenProblem, MOTION_RECIPES } from './language-grammar';
import { LANGUAGE_KEYS, type LanguageKey } from './tokens';
import { validatePackManifest } from './validate-pack';
import { PLATFORM_NEUTRAL, TRANSLUCENT } from './test-support/packs';

// Each design-language token's grammar (#19, Slice 2): the shapes the
// reviewed prototype's recipes use, so no token carries a layout or
// visibility keyword into a stylesheet that reads it.

/** The reviewed prototype's recipe values (appearance-catalog.js), its colors read as var(--color-*). */
const PROTOTYPE: Partial<Record<LanguageKey, readonly string[]>> = {
  'surface-material': [
    'linear-gradient(145deg, color-mix(in srgb, var(--color-surface-prominent) 52%, transparent), color-mix(in srgb, var(--color-surface-default) 74%, transparent))',
    'linear-gradient(165deg, color-mix(in srgb, var(--color-text-inverse) 22%, transparent), transparent 38%), linear-gradient(var(--color-surface-prominent), var(--color-surface-default))',
  ],
  'surface-opacity': ['92%', '66%', '100%'],
  'radius-card': ['0', '28px 18px 30px 16px', '2px 18px', '0 16px', '999px'],
  'border-control': ['0 solid', '3px double', '1px dashed', '2px outset', '2px groove'],
  'shadow-card': [
    'none',
    '0 1px 0 var(--color-border-subtle)',
    '0 22px 60px color-mix(in srgb, var(--color-text-primary) 22%, transparent)',
    'inset 2px 2px 5px color-mix(in srgb, var(--color-text-primary) 16%, transparent)',
    '5px 5px 0 var(--color-border-strong)',
  ],
  'backdrop-blur': ['0px', '28px'],
  'control-height': ['2rem', '2.875rem'],
  'focus-style': ['solid', 'double', 'dashed'],
  'state-hover-transform': [
    'none',
    'translateY(-1px)',
    'translateY(-2px) scale(1.01)',
    'translate(-2px, -2px)',
  ],
  'state-active-transform': ['scale(0.96)', 'translate(2px, 2px)'],
  'state-disabled-opacity': ['0.45', '0.5'],
  'state-loading-opacity': ['0.65', '0.7'],
  'icon-stroke-width': ['1.5', '2'],
  'icon-fill': ['none', 'currentColor'],
  'motion-fast': ['0.01ms', '80ms', '160ms'],
  'motion-slow': ['480ms'],
  'motion-easing': ['linear', 'cubic-bezier(0.16, 1, 0.3, 1)', 'steps(4, end)'],
  'motion-enter': ['fade-rise', 'spring-in', 'slide-cut', 'pixel-in', 'none'],
  'motion-exit': ['fade', 'pixel-out', 'none'],
  'motion-emphasis': ['pulse-once', 'float-once', 'bounce-once', 'glitch-once', 'blink-once'],
  texture: [
    'none',
    'linear-gradient(var(--color-border-subtle) 1px, transparent 1px), linear-gradient(90deg, var(--color-border-subtle) 1px, transparent 1px)',
    'conic-gradient(from 45deg, color-mix(in srgb, var(--color-accent) 12%, transparent) 0 25%, transparent 0 50%, color-mix(in srgb, var(--color-information) 10%, transparent) 0 75%, transparent 0)',
  ],
};

test('every fallback and fixture token, and the prototype recipes, fit their keys', () => {
  for (const [key, value] of [
    ...Object.entries(PLATFORM_NEUTRAL.tokens),
    ...Object.entries(TRANSLUCENT.tokens),
  ]) {
    assert.equal(languageTokenProblem(key as LanguageKey, value), null, `${key}: ${value}`);
  }
  for (const [key, values] of Object.entries(PROTOTYPE)) {
    for (const value of values!) {
      assert.equal(languageTokenProblem(key as LanguageKey, value), null, `${key}: ${value}`);
    }
  }
  assert.deepEqual(Object.keys(LANGUAGE_GRAMMARS), [...LANGUAGE_KEYS]);
});

test('no token carries a layout or visibility keyword', () => {
  for (const key of LANGUAGE_KEYS) {
    for (const word of [
      'fixed',
      'sticky',
      'absolute',
      'relative',
      'static',
      'hidden',
      'collapse',
      'visible',
      'contents',
      'block',
      'inline',
      'flex',
      'grid',
    ]) {
      assert.notEqual(languageTokenProblem(key, word), null, `${key}: ${word}`);
    }
  }
  // none means "no effect" only where a token can have none.
  const takesNone = LANGUAGE_KEYS.filter((key) => languageTokenProblem(key, 'none') === null);
  assert.deepEqual(takesNone, [
    'border-control',
    'border-card',
    'border-divider',
    'shadow-card',
    'shadow-overlay',
    'shadow-raised',
    'shadow-inset',
    'state-hover-transform',
    'state-active-transform',
    'icon-fill',
    'motion-enter',
    'motion-exit',
    'motion-emphasis',
    'texture',
    'emphasis-glow',
  ]);
});

test('a token never moves a part off the page, hides it, or stops focus drawing', () => {
  const refused: Array<[LanguageKey, string, RegExp]> = [
    ['motion-enter', 'fixed', /one of the platform's motion recipes: none, fade, fade-rise/],
    ['motion-exit', 'hidden', /one of the platform's motion recipes: none, fade, or pixel-out/],
    ['state-hover-transform', 'translateY(-200px)', /within 8px or 0\.5rem/],
    ['state-hover-transform', 'translateY(-50%)', /translate\(\), translateX\(\)/],
    ['state-active-transform', 'scale(0)', /scale\(\) within 0\.9 to 1\.1/],
    ['state-active-transform', 'rotate(90deg)', /rotate\(\) within 10deg/],
    ['state-active-transform', 'matrix(1, 0, 0, 1, 0, 0)', /none, or up to three/],
    ['state-disabled-opacity', '0', /from 0\.3 to 1/],
    ['state-loading-opacity', '10%', /30% to 100%/],
    ['surface-opacity', 'calc(1 - 0.5)', /a percentage from 50% to 100%/],
    ['surface-opacity', '120%', /a percentage from 50% to 100%/],
    // color-mix() reads it, so a number such as 0.72 leaves the surface with no background.
    ['surface-opacity', '0.72', /a percentage from 50% to 100%, such as 72% or 100%/],
    ['surface-opacity', '1', /color-mix\(\) reads it/],
    ['surface-opacity', '0', /a surface stays at least half opaque/],
    ['surface-opacity', '49%', /from 50% to 100%/],
    ['focus-style', 'none', /an outline style that draws/],
    ['focus-width', '-2px', /from 2px or 0\.125rem/],
    [
      'texture',
      'linear-gradient(var(--color-accent), transparent) hidden',
      /none, or one or more gradients/,
    ],
    ['surface-material', 'var(--color-surface-default)', /one or more gradients/],
    ['shadow-card', '0 2px', /two to four lengths and a color/],
    ['motion-slow', '5s', /at most 2s/],
    ['motion-easing', 'fixed', /a timing function/],
    ['radius-card', '-4px', /none negative/],
    ['icon-stroke-width', '0', /from 0\.5 to 4/],
  ];
  for (const [key, value, message] of refused) {
    assert.match(languageTokenProblem(key, value) ?? 'accepted', message, `${key}: ${value}`);
  }
  // The value rules every token follows still come first.
  assert.match(languageTokenProblem('radius-card', 'url(x.png)') ?? '', /can't load anything/);
  assert.deepEqual(MOTION_RECIPES['motion-exit'], ['none', 'fade', 'pixel-out']);
});

test("a token's lengths stay within 64px or 4rem, and a radius's within 999px", () => {
  const refused: Array<[LanguageKey, string, RegExp]> = [
    ['shadow-card', '0 0 0 100px var(--color-canvas)', /every length within 64px or 4rem/],
    ['shadow-overlay', '0 22px 65px var(--color-shadow)', /every length within 64px or 4rem/],
    ['emphasis-glow', '0 0 5rem var(--color-emphasis)', /every length within 64px or 4rem/],
    ['shadow-raised', '0 -65px 0 var(--color-shadow)', /every length within 64px or 4rem/],
    ['border-control', '100000px solid', /a width of at most 64px or 4rem/],
    ['focus-width', '65px', /to 64px or 4rem/],
    // A ring under the gate's 2px draws too thin to see, or not at all.
    ['focus-width', '0', /a focus ring always draws/],
    ['focus-width', '0px', /from 2px or 0\.125rem/],
    ['focus-width', '0.25px', /from 2px or 0\.125rem/],
    ['focus-width', '1px', /from 2px or 0\.125rem/],
    ['focus-width', '0.1rem', /from 2px or 0\.125rem/],
    ['space-surface-inline', '4.5rem', /at most 64px or 4rem/],
    ['control-height', '100vh', /a length in px or rem/],
    // em scales with the part's font size, which the typography profile sets.
    ['space-control-inline', '4em', /a length in px or rem/],
    ['shadow-card', '0 2px 1em var(--color-shadow)', /two to four lengths and a color/],
    ['border-card', '1em solid', /a width of at most 64px or 4rem/],
    ['radius-card', '1em', /one to four lengths in px or rem/],
    ['focus-offset', '0.5em', /a length in px or rem/],
    ['state-hover-transform', 'translateY(-0.5em)', /within 8px or 0\.5rem/],
    ['backdrop-blur', '5em', /at most 64px or 4rem/],
    ['state-selected-emphasis', '100px', /at most 64px or 4rem/],
    ['focus-offset', '-65px', /within 64px or 4rem either way/],
    ['radius-badge', '1000px', /none over 999px or 62\.4375rem/],
    ['radius-card', '50%', /one to four lengths in px or rem/],
  ];
  for (const [key, value, message] of refused) {
    assert.match(languageTokenProblem(key, value) ?? 'accepted', message, `${key}: ${value}`);
  }
  for (const [key, value] of [
    ['shadow-card', '0 22px 60px color-mix(in srgb, var(--color-text-primary) 22%, transparent)'],
    ['shadow-inset', 'inset 0 0 0 64px var(--color-shadow), 0 -4rem 4rem var(--color-shadow)'],
    ['border-card', '4rem solid'],
    ['focus-offset', '-64px'],
    ['control-height', '4rem'],
    ['radius-badge', '999px'],
    ['radius-card', '62.4375rem 0'],
    ['surface-opacity', '50%'],
    ['surface-opacity', '66%'],
    ['focus-width', '2px'],
    ['focus-width', '0.125rem'],
    ['focus-width', '4rem'],
  ] as const) {
    assert.equal(languageTokenProblem(key, value), null, `${key}: ${value}`);
  }
});

test("the validator reports a token's grammar where the token is", () => {
  const result = validatePackManifest(
    {
      ...structuredClone(PLATFORM_NEUTRAL),
      tokens: { ...PLATFORM_NEUTRAL.tokens, 'motion-enter': 'fixed', 'motion-exit': 'hidden' },
    },
    { kind: 'design-language', packageName: '@portfolio/x' },
  );
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.diagnostics.map(({ code, pointer }) => [code, pointer]),
    [
      ['manifest.invalid', '/tokens/motion-enter'],
      ['manifest.invalid', '/tokens/motion-exit'],
    ],
  );
  assert.match(
    result.diagnostics[0]!.message,
    /: \/tokens\/motion-enter must be one of the platform's motion recipes/,
  );
});
