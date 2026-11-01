import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPOSITION_IDS } from '@portfolio/variant-contract';
import { auditedFiles, translucentBackgrounds, variantPackageDirs } from './source-audit';

// The translucency lint (C's P-8 note, item 8): a background a composition
// paints translucent itself never meets the language's 97% glass floor, as
// Aurora's panes at 52 to 74% don't. It reports and never fails a check; the
// rule refuses once the compositions are clean.

const block = (body: string, selector = "[data-variant='acme'] .pane") =>
  `${selector} {\n${body}\n}\n`;
const whys = (css: string) => translucentBackgrounds(css).map(({ why }) => why);

test('the translucency lint reports a background a composition makes translucent itself', () => {
  for (const [declaration, why] of [
    [
      'background: color-mix(in oklab, var(--color-surface-default) 60%, transparent);',
      'transparent-mix',
    ],
    [
      'background-color: color-mix(in srgb, transparent 30%, var(--color-canvas));',
      'transparent-mix',
    ],
    [
      'background: color-mix(in srgb, var(--color-surface-default), transparent);',
      'transparent-mix',
    ],
    [
      'background-image: linear-gradient(color-mix(in oklab, var(--color-scrim) 40%, transparent), transparent);',
      'transparent-mix',
    ],
    [
      'background: color-mix(in oklab, var(--color-surface-default) 40%, var(--color-canvas) 30%);',
      'partial-mix',
    ],
    ['background: oklch(from var(--color-surface-default) l c h / 0.6);', 'relative-alpha'],
    ['background-color: rgb(from var(--color-canvas) r g b / 70%);', 'relative-alpha'],
  ] as const) {
    assert.deepEqual(whys(block(`  ${declaration}`)), [why], declaration);
  }
  // Through a --layout-* property the file declares.
  assert.deepEqual(
    whys(
      `[data-variant='acme'] {\n  --layout-pane: color-mix(in oklab, var(--color-surface-default) 52%, transparent);\n}\n${block('  background: var(--layout-pane);')}`,
    ),
    ['transparent-mix'],
  );
  // An opacity below 1 on a rule that paints a background, in another rule of the same selector too.
  assert.deepEqual(
    translucentBackgrounds(
      block('  background: var(--color-surface-default);\n  opacity: 0.7;') +
        `@media (min-width: 60em) {\n${block('  opacity: 85%;')}}\n`,
    ).map(({ line, property, why }) => [line, property, why]),
    [
      [3, 'opacity', 'opacity'],
      [7, 'opacity', 'opacity'],
    ],
  );
});

test('the translucency lint reports a material token painted with no surface layer over it (P-8 item 8)', () => {
  for (const declaration of [
    // Aurora's mockup panes: the material alone, 52 to 74% under glassmorphism.
    'background: var(--ui-surface-material);',
    'background-color: var(--ui-surface-material);',
    'background-image: var(--ui-surface-material);',
    // A layer of the composition's own over it isn't a surface.
    'background: linear-gradient(var(--color-accent), transparent 40%), var(--ui-surface-material);',
    // Nor is a surface under it.
    'background: var(--ui-surface-material), var(--color-surface-default);',
  ]) {
    assert.deepEqual(whys(block(`  ${declaration}`)), ['bare-material'], declaration);
  }
  // Through a --layout-* property the file declares.
  assert.deepEqual(
    whys(
      `[data-variant='acme'] {\n  --layout-glass: var(--ui-surface-material);\n}\n${block('  background: var(--layout-glass);')}`,
    ),
    ['bare-material'],
  );
  // Under a surface layer, the language's stack or an opaque surface, it passes, and a color under the rule's surfaced images too.
  for (const css of [
    block(
      '  background: linear-gradient(var(--color-surface-default), var(--color-surface-default)), var(--ui-surface-material);',
    ),
    block(
      '  background-image: linear-gradient(color-mix(in srgb, var(--color-surface-default) var(--ui-surface-opacity), transparent), color-mix(in srgb, var(--color-surface-default) var(--ui-surface-opacity), transparent));\n  background-color: var(--ui-surface-material);',
    ),
  ]) {
    assert.deepEqual(translucentBackgrounds(css), [], css);
  }
});

test("a dialog's ::backdrop is a scrim, see-through on purpose, and passes", () => {
  for (const css of [
    block(
      '  background-color: color-mix(in oklab, var(--color-scrim) 55%, transparent);',
      "[data-variant='acme'] .index::backdrop",
    ),
    block(
      '  background: var(--color-scrim);\n  opacity: 0.6;',
      "[data-variant='acme'] .index::backdrop, [data-variant='acme'] .sheet::backdrop",
    ),
  ]) {
    assert.deepEqual(translucentBackgrounds(css), [], css);
  }
  // A selector list that styles a pane beside the backdrop still reports.
  assert.deepEqual(
    whys(
      block(
        '  background-color: color-mix(in oklab, var(--color-scrim) 55%, transparent);',
        "[data-variant='acme'] .index::backdrop, [data-variant='acme'] .pane",
      ),
    ),
    ['transparent-mix'],
  );
});

test("the translucency lint skips the language's pane surface stack, opaque mixes, and an opacity with no background", () => {
  for (const css of [
    // The pane surface stack, a surface at --ui-surface-opacity over the material.
    block(
      '  background:\n    linear-gradient(\n      color-mix(in srgb, var(--color-surface-default) var(--ui-surface-opacity), transparent),\n      color-mix(in srgb, var(--color-surface-default) var(--ui-surface-opacity), transparent)\n    ),\n    var(--ui-surface-material);',
    ),
    block('  background: var(--color-surface-default);'),
    block(
      '  background: color-mix(in oklab, var(--color-surface-default) 60%, var(--color-canvas));',
    ),
    block('  background: color-mix(in oklab, var(--color-accent), var(--color-canvas) 20%);'),
    block('  background: color-mix(in srgb, var(--color-canvas) 100%, transparent);'),
    block('  background: color-mix(in srgb, var(--color-canvas), transparent 0%);'),
    block('  background: oklch(from var(--color-canvas) calc(l + 0.1) c h);'),
    block('  background: oklch(from var(--color-canvas) l c h / alpha);'),
    // A border or a text color mixed with transparent isn't a background.
    block('  border-color: color-mix(in oklab, var(--color-text-primary) 18%, transparent);'),
    // An opacity with no background, or hidden at 0.
    block('  opacity: 0.6;'),
    block('  background: none;\n  opacity: 0.6;'),
    block('  background: var(--color-surface-default);\n  opacity: 0;'),
    block('  background: var(--color-surface-default);\n  opacity: 1;'),
  ]) {
    assert.deepEqual(translucentBackgrounds(css), [], css);
  }
});

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

test(
  'no first-party composition paints a translucent background of its own (P-8 item 8)',
  { todo: "each composition paints its panes through the language's surface stack" },
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
      for (const file of auditedFiles(dir).filter((name) => name.endsWith('.css'))) {
        for (const { line, property, why } of translucentBackgrounds(
          fs.readFileSync(file, 'utf8'),
        )) {
          found.push(`${path.relative(ROOT, file)}:${line} ${property}: ${why}`);
        }
      }
    }
    t.diagnostic(`${found.length} backgrounds a composition paints translucent itself`);
    for (const line of found) t.diagnostic(line);
    assert.deepEqual(found, []);
  },
);
