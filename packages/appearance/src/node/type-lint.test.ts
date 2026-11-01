import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPOSITION_IDS } from '@portfolio/variant-contract';
import { auditedFiles, variantPackageDirs } from './source-audit';
import { TYPE_SIZE_EXCEPTIONS, typeSizeLiterals } from './type-lint';

// The type lint (T1 and T3 of the redesign's typography rules): a composition's font sizes come from
// the type steps or a role's size, with one exception each for two of them:
// Horizontal Cinema's prologue title card and Raw Grid's poster name.

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CARD = "[data-variant='horizontal-cinema'] .hc-card__name";
const rule = (selector: string, body: string) => `${selector} {\n  ${body}\n}\n`;
const values = (css: string, composition?: string) =>
  typeSizeLiterals(css, composition).map(({ value }) => value);

test('a size from the steps or a role passes', () => {
  for (const value of [
    'var(--type-step-5)',
    'var(--type-step--1)',
    'var(--type-display-font-size)',
    'inherit',
    '1em',
    '100%',
  ]) {
    assert.deepEqual(values(rule("[data-variant='acme'] .x", `font-size: ${value};`)), [], value);
  }
});

test('a size of its own is reported, with its selector and line, a token beside it too', () => {
  for (const value of [
    '18px',
    '1.25rem',
    '4vw',
    'clamp(1rem, 4vw, 3rem)',
    'calc(var(--type-step-3) + 2px)',
    'calc(var(--type-step-3) * 1.37px)',
    'calc(var(--type-step-3) / 2)',
    'calc(var(--made-up) * 2)',
    'calc(var(--type-step-3) * -1)',
    // Only a step or a role's size, by a factor over 0 and up to 4 (K-5 review L1).
    'calc(var(--type-measure-body) * 0.05)',
    'calc(var(--type-body-letter-spacing) * 400)',
    'calc(var(--type-step-1) * 40)',
    'calc(var(--type-step-1) * 0)',
    'calc(var(--type-body-line-height) * 2)',
    'var(--type-step-3, 18px)',
    'large',
    '16.6cqi',
  ]) {
    assert.deepEqual(
      values(rule("[data-variant='acme'] .x", `font-size: ${value};`)),
      [value],
      value,
    );
  }
  const [found] = typeSizeLiterals(
    "[data-variant='acme'] {\n  .a { color: red; }\n  .b {\n    font-size: 2rem;\n  }\n}\n",
  );
  assert.deepEqual(found, { line: 4, selector: '.b', value: '2rem' });
  // Comments, and a font-size inside one, are nothing.
  assert.deepEqual(values("[data-variant='acme'] .x { /* font-size: 9px; */ color: red; }"), []);
});

test("Cinema's title card may set its name in cqi, wide and narrow, and nothing else may", () => {
  const css = `${rule(CARD, 'font-size: 16.6cqi;')}@media (max-width: 47.99rem) {\n${rule(CARD, 'font-size: 25cqi;')}}\n`;
  assert.deepEqual(values(css, 'horizontal-cinema'), []);
  // The same selector in another unit, or another selector in cqi, is a finding.
  assert.deepEqual(values(rule(CARD, 'font-size: 96px;'), 'horizontal-cinema'), ['96px']);
  assert.deepEqual(
    values(rule(CARD, 'font-size: clamp(2rem, 16cqi, 9rem);'), 'horizontal-cinema'),
    ['clamp(2rem, 16cqi, 9rem)'],
  );
  assert.deepEqual(
    values(
      rule("[data-variant='horizontal-cinema'] .hc-title", 'font-size: 16cqi;'),
      'horizontal-cinema',
    ),
    ['16cqi'],
  );
  // Another composition can't borrow it.
  assert.deepEqual(values(rule(CARD, 'font-size: 16.6cqi;'), 'kinetic-cosmos'), ['16.6cqi']);
  // Each composition has at most one, and two have one.
  assert.deepEqual(Object.keys(TYPE_SIZE_EXCEPTIONS), ['horizontal-cinema', 'raw-grid']);
});

test("Raw Grid's name fit may set its size in cqi on its one selector, and a second cqi selector still reports", () => {
  const NAME = "[data-variant='raw-grid'] .rg-name";
  const fit =
    'min(var(--type-step-7), calc(var(--layout-name-share) * 100cqi / (var(--layout-name-chars) * var(--layout-fit))))';
  assert.deepEqual(values(rule(NAME, `font-size: ${fit};`), 'raw-grid'), []);
  assert.deepEqual(
    values(
      rule("[data-variant='raw-grid'] .rg-poster--stuck .rg-name", `font-size: ${fit};`),
      'raw-grid',
    ),
    [fit],
  );
  assert.deepEqual(
    values(rule("[data-variant='raw-grid'] .rg-sheet__word", 'font-size: 20cqi;'), 'raw-grid'),
    ['20cqi'],
  );
  // Cinema's exception doesn't carry over, nor Raw Grid's to Cinema.
  assert.deepEqual(values(rule(NAME, 'font-size: 20cqi;'), 'horizontal-cinema'), ['20cqi']);
});

test(
  'every first-party composition sets its type from the steps (T1)',
  { todo: 'each composition moves onto --type-step-* with its redesign' },
  (t) => {
    const found: string[] = [];
    const compositions = variantPackageDirs(path.join(ROOT, 'packages')).filter((dir) =>
      path.basename(dir).startsWith('variant-'),
    );
    assert.deepEqual(
      compositions.map((dir) => path.basename(dir)).sort(),
      COMPOSITION_IDS.map((id) => `variant-${id}`).sort(),
    );
    for (const dir of compositions) {
      const id = path.basename(dir).slice('variant-'.length);
      for (const file of auditedFiles(dir).filter((name) => name.endsWith('.css'))) {
        for (const { line, selector, value } of typeSizeLiterals(
          fs.readFileSync(file, 'utf8'),
          id,
        )) {
          found.push(`${path.relative(ROOT, file)}:${line} ${selector} font-size: ${value}`);
        }
      }
    }
    // The one exception is used: its composition's stylesheets name its selector.
    for (const [id, { selector }] of Object.entries(TYPE_SIZE_EXCEPTIONS)) {
      const dir = compositions.find((candidate) => path.basename(candidate) === `variant-${id}`);
      const css = dir
        ? auditedFiles(dir)
            .filter((name) => name.endsWith('.css'))
            .map((name) => fs.readFileSync(name, 'utf8').replace(/\s+/g, ' '))
            .join('\n')
        : '';
      if (!css.includes(selector.split(' ').at(-1)!)) {
        found.push(
          `${id}: its type exception names ${selector}, which none of its stylesheets sets`,
        );
      }
    }
    t.diagnostic(`${found.length} font sizes of a composition's own`);
    for (const line of found) t.diagnostic(line);
    assert.deepEqual(found, []);
  },
);

test('a calc() multiple of a step or a role size, and a --layout-* size declared as one, is the scale (K-5)', () => {
  for (const value of [
    // Swiss's poster at 1.6 steps, Shell's 2x line, and Chapters' long-prose step.
    'calc(var(--type-step-5) * 1.6)',
    'calc(2 * var(--type-body-font-size))',
    'calc( var(--type-body-font-size) * .875 )',
    // A hyphenated role's size (K-5 delta review K5-L2).
    'calc(var(--type-body-compact-font-size) * 1.2)',
  ]) {
    assert.deepEqual(values(rule("[data-variant='acme'] .x", `font-size: ${value};`)), [], value);
  }
  // Through a --layout-* property the stylesheet declares as a size from the scale.
  const layout = (declared: string, used: string) =>
    values(
      `[data-variant='acme'] {\n  --layout-line-size: ${declared};\n}\n${rule("[data-variant='acme'] .x", `font-size: ${used};`)}`,
    );
  assert.deepEqual(layout('var(--type-body-font-size)', 'calc(var(--layout-line-size) * 2)'), []);
  assert.deepEqual(layout('calc(var(--type-step-2) * 1.5)', 'var(--layout-line-size)'), []);
  assert.deepEqual(layout('18px', 'var(--layout-line-size)'), ['var(--layout-line-size)']);
  assert.deepEqual(
    values(rule("[data-variant='acme'] .x", 'font-size: var(--layout-undeclared);')),
    ['var(--layout-undeclared)'],
  );
});
