// Raw Grid's way on rings past its neighbours' rules: its two cells, each the link, set the
// focus offset to --space-3xs, so the ring lies outside the next cell's and the next row's rules. That
// holds only while the space step is wider than the rule: the step's smallest (the platform's, fluid,
// no language or density scales it) against --layout-rule's px width in Raw Grid's stylesheet.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { spacePx } from '../../packages/appearance/src/scales';

const CSS = readFileSync(
  new URL('../../packages/variant-raw-grid/src/styles.css', import.meta.url),
  'utf8',
);

test("Raw Grid's way-on cells ring a space step out, wider than the rules they clear", () => {
  const rule = /--layout-rule:\s*(\d+(?:\.\d+)?)px solid /.exec(CSS);
  assert.ok(rule, '--layout-rule is a px border shorthand');
  assert.match(
    CSS,
    /:is\(\.rg-next__go, \.rg-next__all\):focus-visible \{\s*--ui-focus-offset: var\(--space-3xs\);/,
  );
  const step = spacePx('3xs');
  assert.ok(
    step.min > Number(rule[1]),
    `--space-3xs at its smallest (${step.min} px) is wider than --layout-rule (${rule[1]} px)`,
  );
});
