import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPOSITION_IDS } from '@portfolio/variant-contract';
import {
  auditCodeText,
  auditedFiles,
  auditStylesheetText,
  spacingLiterals,
  variantPackageDirs,
} from './source-audit';

// The redesign's shared scales, as the source audit reads a composition:
// the space lint (dossier G3), which reports a padding, margin, or gap with
// a length of its own, and the motion slots' band (M3), which the timing
// rule holds a composition's own durations to.

const block = (body: string) => `[data-variant='acme'] .x {\n${body}\n}\n`;
const lengthsIn = (css: string) => spacingLiterals(css).flatMap(({ lengths }) => lengths);

test('the space lint reports px, rem, and vw in padding, margin, and gap, and their longhands', () => {
  for (const declaration of [
    'padding: 1rem;',
    'padding: 0 2px;',
    'padding-inline: 4vw;',
    'padding-block-start: 0.5rem;',
    'margin: 0 auto 3rem;',
    'margin-top: -1px;',
    'margin-inline-end: .75rem;',
    'gap: 24px;',
    'row-gap: 1.5rem;',
    'column-gap: clamp(1rem, 4vw, 3rem);',
    'PADDING: 2REM;',
  ]) {
    assert.notDeepEqual(lengthsIn(block(`  ${declaration}`)), [], declaration);
  }
  assert.deepEqual(lengthsIn(block('  column-gap: clamp(1rem, 4vw, 3rem);')), [
    '1rem',
    '4vw',
    '3rem',
  ]);
});

test('the space lint passes the shared scale, zero, auto, percentages, and other properties', () => {
  for (const declaration of [
    'padding: var(--space-m);',
    'padding: var(--space-s-l) var(--layout-grid-margin);',
    'margin: 0 auto;',
    'margin-block: 0px;',
    'gap: var(--layout-grid-gutter);',
    'padding-inline: calc(var(--space-l) * 2);',
    'margin-inline: 5%;',
    'width: 20rem;',
    'inset: 1rem;',
    'max-inline-size: var(--layout-width-text);',
    'font-size: 1.5rem;',
  ]) {
    assert.deepEqual(lengthsIn(block(`  ${declaration}`)), [], declaration);
  }
});

test("the space lint reads a composition's own --layout-* property through to its value, fallbacks too", () => {
  const css = `[data-variant='acme'] {\n  --layout-gutter: clamp(1.25rem, 4vw, 3rem);\n  --layout-step: var(--space-m);\n}\n${block(
    '  padding-inline: var(--layout-gutter);\n  gap: var(--layout-step);\n  margin: var(--space-unset, 2rem);',
  )}`;
  assert.deepEqual(
    spacingLiterals(css).map(({ line, property, lengths }) => [line, property, lengths]),
    [
      [6, 'padding-inline', ['1.25rem', '4vw', '3rem']],
      [8, 'margin', ['2rem']],
    ],
  );
});

test("a platform slot the root rule sets is the platform's default, which the lint doesn't follow; the same value on a descendant reports", () => {
  // Raw Grid's shape: the page width in the root rule, read through a gutter of its own.
  const gutter =
    '  --layout-x: max(var(--layout-grid-margin), calc((100% - var(--layout-width-page)) / 2));';
  const rawGrid = `[data-variant='acme'] {\n  --layout-width-page: 90rem;\n  --layout-grid-columns: 12;\n${gutter}\n}\n${block(
    '  padding-inline: var(--layout-x);\n  margin-inline: var(--layout-width-page);',
  )}`;
  assert.deepEqual(spacingLiterals(rawGrid), []);
  // Under @media in the root rule too.
  assert.deepEqual(
    spacingLiterals(
      `@media (min-width: 60em) {\n  [data-variant='acme'] {\n    --layout-width-page: 80rem;\n  }\n}\n${block('  padding-inline: var(--layout-width-page);')}`,
    ),
    [],
  );
  // The same slot set on a descendant is a length of the composition's own.
  const descendant = `[data-variant='acme'] .shell {\n  --layout-width-page: 90rem;\n${gutter}\n}\n${block(
    '  padding-inline: var(--layout-x);',
  )}`;
  assert.deepEqual(
    spacingLiterals(descendant).map(({ line, property, lengths }) => [line, property, lengths]),
    [[6, 'padding-inline', ['90rem']]],
  );
});

test('a declaration Prettier splits over lines counts once, on the line it starts', () => {
  const css = block('  padding:\n    1rem\n    2rem;');
  assert.deepEqual(spacingLiterals(css), [
    { line: 2, property: 'padding', lengths: ['1rem', '2rem'] },
  ]);
});

/** The rules a variant's stylesheet breaks, sorted, once each. */
const variantRules = (css: string) =>
  [...new Set(auditStylesheetText(css, { variant: true }).map(({ rule }) => rule))].sort();
const root = (body: string) => `[data-variant='acme'] {\n  ${body}\n}\n`;

test("a composition's motion slots hold a time in their band, and a curve that doesn't overshoot (M3)", () => {
  for (const good of [
    '--layout-motion-feedback: 150ms;',
    '--layout-motion-feedback: .3s;',
    '--layout-motion-scene: 0.8s;',
    '--layout-motion-scene: 1000ms;',
    '--layout-motion-curve: var(--ui-motion-easing);',
    '--layout-motion-curve: cubic-bezier(0.22, 1, 0.36, 1);',
  ]) {
    assert.deepEqual(variantRules(root(good)), [], good);
  }
  for (const bad of [
    '--layout-motion-feedback: 100ms;',
    '--layout-motion-feedback: 320ms;',
    '--layout-motion-feedback: 800ms;',
    '--layout-motion-feedback: var(--ui-motion-standard);',
    '--layout-motion-scene: 400ms;',
    '--layout-motion-scene: 5s;',
    '--layout-motion-scene: var(--layout-pace);',
    '--layout-motion-curve: linear;',
    '--layout-motion-curve: ease;',
    '--layout-motion-curve: cubic-bezier(0.34, 1.56, 0.64, 1);',
    '--layout-motion-curve: steps(4, end);',
  ]) {
    assert.deepEqual(variantRules(root(bad)), ['timing'], bad);
  }
});

test("the ambient slot holds a loop's cycle in its 20 to 60 s band, and a loop reads it through --motion-ambient (K-4 b)", () => {
  for (const good of [
    '--layout-motion-ambient: 20s;',
    '--layout-motion-ambient: 45s;',
    '--layout-motion-ambient: 60000ms;',
  ]) {
    assert.deepEqual(variantRules(root(good)), [], good);
  }
  for (const bad of [
    '--layout-motion-ambient: 19.9s;',
    '--layout-motion-ambient: 61s;',
    '--layout-motion-ambient: 800ms;',
    '--layout-motion-ambient: infinite;',
    '--layout-motion-ambient: var(--motion-scene);',
  ]) {
    assert.deepEqual(variantRules(root(bad)), ['timing'], bad);
  }
  // A loop reads the platform's token and its state; the slot itself is no duration.
  assert.deepEqual(
    variantRules(
      root('--layout-motion-ambient: 40s;') +
        block(
          '  animation: acme-drift var(--motion-ambient) linear infinite;\n  animation-play-state: var(--motion-ambient-state);',
        ),
    ),
    [],
  );
  assert.deepEqual(variantRules(block('  animation-duration: var(--layout-motion-ambient);')), [
    'timing',
  ]);
  // A literal cycle is no token, and with no play state nothing gates the loop either.
  assert.deepEqual(variantRules(block('  animation: acme-drift 40s linear infinite;')), [
    'motion-gate',
    'timing',
  ]);
  // Set anywhere but the root rule, it's a platform default out of place.
  assert.deepEqual(variantRules(block('  --layout-motion-ambient: 40s;')), ['custom-property']);
});

test('a duration reads --motion-*, never a slot, wherever the slot is set (M2, M3)', () => {
  const reads = (use: string) => variantRules(block(`  ${use}`));
  assert.deepEqual(reads('transition: opacity var(--motion-feedback) var(--motion-curve);'), []);
  assert.deepEqual(reads('animation-duration: var(--motion-scene);'), []);
  assert.deepEqual(reads('transition-duration: var(--layout-motion-feedback);'), ['timing']);
  assert.deepEqual(reads('animation: acme-in var(--layout-motion-scene) both;'), ['timing']);
  // A slot set in band in the same file is still no duration of its own.
  assert.deepEqual(
    variantRules(
      root('--layout-motion-scene: 800ms;') +
        block('  animation-duration: var(--layout-motion-scene);'),
    ),
    ['timing'],
  );
  // A slot read through another --layout-* property, however deep, fails too (the delta review's D1).
  assert.deepEqual(
    variantRules(
      root('--layout-pace: var(--layout-motion-scene);') +
        block('  transition-duration: var(--layout-pace);'),
    ),
    ['timing'],
  );
  assert.deepEqual(
    variantRules(
      root('--layout-pace: var(--layout-step);\n  --layout-step: var(--layout-motion-feedback);') +
        block('  transition: opacity var(--layout-pace);'),
    ),
    ['timing'],
  );
  assert.deepEqual(
    variantRules(
      root('--layout-pace: var(--layout-step);\n  --layout-step: 300ms;') +
        block('  transition-duration: var(--layout-pace);'),
    ),
    ['timing'],
  );
  // A chain that ends in the platform's tokens passes, and a loop fails closed.
  assert.deepEqual(
    variantRules(
      root('--layout-pace: var(--layout-step);\n  --layout-step: var(--motion-scene);') +
        block('  transition-duration: var(--layout-pace);'),
    ),
    [],
  );
  assert.deepEqual(
    variantRules(
      root('--layout-a: var(--layout-b);\n  --layout-b: var(--layout-a);') +
        block('  transition-duration: var(--layout-a);'),
    ),
    ['timing'],
  );
  // Another --layout-* property holding a literal time fails as it did.
  assert.deepEqual(
    variantRules(
      root('--layout-pace: 200ms;') + block('  transition-duration: var(--layout-pace);'),
    ),
    ['timing'],
  );
});

test("the review's probes: a slot set out of band in one file, or in code, fails where it's set", () => {
  // a.css sets the scene slot and b.css reads it: a.css fails on its own.
  assert.deepEqual(variantRules(root('--layout-motion-scene: 5s;')), ['timing']);
  assert.deepEqual(variantRules(block('  animation-duration: var(--motion-scene);')), []);
  // Code that sets a slot, in a style key or with setProperty(), fails: a composition sets it in its root rule alone.
  const code = (text: string) =>
    [...new Set(auditCodeText(text, { variant: true }).map(({ rule }) => rule))].sort();
  assert.deepEqual(code("const style = { '--layout-motion-scene': '5s' };"), [
    'custom-property',
    'timing',
  ]);
  assert.deepEqual(code("el.style.setProperty('--layout-grid-gutter', '3rem');"), [
    'custom-property',
  ]);
  assert.deepEqual(code("const style = { '--layout-gutter': '3rem' };"), []);
  // A style attribute's text, too (the delta review's D3).
  assert.deepEqual(code("el.style.cssText = '--layout-width-text: 10px';"), ['custom-property']);
  assert.deepEqual(
    code("el.setAttribute('style', '--layout-grid-gutter: 2rem; color: inherit');"),
    ['custom-property'],
  );
});

test("the platform's defaults are set in a composition's root rule alone, so they compute on the boundary (G1, G6, M2)", () => {
  for (const good of [
    root('--layout-grid-gutter: var(--space-m);'),
    `[data-variant="acme"] {\n  --layout-width-text: 60ch;\n}\n`,
    `@media (min-width: 60rem) {\n  [data-variant='acme'] {\n    --layout-grid-columns: 16;\n  }\n}\n`,
    block('  --layout-gutter: var(--space-m);'),
    // The measure scale (R11.1), from the profile's aspect, where the profile's measures read it.
    root('--layout-measure-scale: calc(var(--type-body-size-adjust) / var(--type-body-aspect));'),
  ]) {
    assert.deepEqual(variantRules(good), [], good);
  }
  for (const bad of [
    block('  --layout-motion-scene: 800ms;'),
    block('  --layout-width-text: 60ch;'),
    // On an element inside, the profile's measures, computed on the boundary, would never see it.
    block('  --layout-measure-scale: 1.1;'),
    `[data-variant='acme'] .x,\n[data-variant='acme'] {\n  --layout-grid-gutter: var(--space-m);\n}\n`,
    `[data-variant='acme'] {\n  .hero {\n    --layout-grid-margin: var(--space-l);\n  }\n}\n`,
    `[data-variant='acme']:is([data-motion='full']) {\n  --layout-motion-feedback: 200ms;\n}\n`,
  ]) {
    assert.ok(variantRules(bad).includes('custom-property'), bad);
  }
  // It names the declaration's own line.
  const found = auditStylesheetText(
    `[data-variant='acme'] .hero {\n  color: var(--color-text-primary);\n  --layout-width-page: 60rem;\n}\n`,
    { variant: true },
  );
  assert.deepEqual(
    found.map(({ line, rule }) => [line, rule]),
    [[3, 'custom-property']],
  );
});

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

test(
  'every first-party composition spaces itself from the shared scale (G3)',
  { todo: 'each composition moves onto --space-* with its redesign' },
  (t) => {
    const found: string[] = [];
    // The first-party compositions, which the redesign moves over: every one COMPOSITION_IDS names.
    const compositions = variantPackageDirs(path.join(ROOT, 'packages')).filter((dir) =>
      path.basename(dir).startsWith('variant-'),
    );
    assert.deepEqual(
      compositions.map((dir) => path.basename(dir)).sort(),
      COMPOSITION_IDS.map((id) => `variant-${id}`).sort(),
    );
    for (const dir of compositions) {
      for (const file of auditedFiles(dir).filter((name) => name.endsWith('.css'))) {
        for (const { line, property, lengths } of spacingLiterals(fs.readFileSync(file, 'utf8'))) {
          found.push(`${path.relative(ROOT, file)}:${line} ${property}: ${lengths.join(' ')}`);
        }
      }
    }
    t.diagnostic(`${found.length} padding, margin, and gap declarations set a length of their own`);
    for (const line of found) t.diagnostic(line);
    assert.deepEqual(found, []);
  },
);
