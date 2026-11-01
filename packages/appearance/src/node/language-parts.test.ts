import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DesignLanguageManifest } from '../manifests';

// The language design review's P1s on the ten compositions' languages
// (kgn-a-review-langs-design.md), held: what each pack's tokens and
// stylesheet give the primitives they restyle.

const here = path.dirname(fileURLToPath(import.meta.url));
const PACKS = path.resolve(here, '../../../appearance-languages/packs');
const read = (id: string) => ({
  tokens: (
    JSON.parse(
      fs.readFileSync(path.join(PACKS, id, 'manifest.json'), 'utf8'),
    ) as DesignLanguageManifest
  ).tokens as Readonly<Record<string, string>>,
  css: fs.readFileSync(path.join(PACKS, id, 'styles.css'), 'utf8'),
});

/** The declarations of the stylesheet's rule for exactly `selector`. */
function rule(css: string, selector: string): string {
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors!.replace(/\/\*[\s\S]*?\*\//g, '').trim() === selector) return body!;
  }
  assert.fail(`no rule for ${selector}`);
}

/** A hard shadow's offset, in px: `8px 8px 0 ...` is 8. */
const offset = (shadow: string) => Number(/^(\d+)px \1px 0 /.exec(shadow.trim())?.[1]);

test('poster-press: hover lowers the shadow without moving, a press moves, and prominent stands above default', () => {
  const { tokens, css } = read('poster-press');
  // Hover never moves the action, so the pointer can't slip off its edge; the press does.
  assert.equal(tokens['state-hover-transform'], 'none');
  assert.equal(tokens['state-active-transform'], 'translate(4px, 4px)');
  const hover = rule(
    css,
    "[data-ui-slot='action']:hover:not(:disabled, [aria-disabled='true'], [data-emphasis='quiet'])",
  );
  const press = rule(
    css,
    "[data-ui-slot='action']:active:not(:disabled, [aria-disabled='true'], [data-emphasis='quiet'])",
  );
  assert.match(hover, /box-shadow: 2px 2px 0 var\(--color-border-strong\);/);
  assert.match(press, /box-shadow: none;/);
  // Elevation: subtle 0, default 8, prominent 10, overlay 12, and the raised press depth 4.
  const prominent = /box-shadow: ([^;]+);/.exec(
    rule(css, "[data-ui-slot='surface'][data-emphasis='prominent']"),
  )![1]!;
  assert.ok(offset(tokens['shadow-card']!) < offset(prominent), 'prominent above default');
  assert.ok(offset(prominent) < offset(tokens['shadow-overlay']!), 'overlay above prominent');
  assert.equal(offset(tokens['shadow-raised']!), 4);
  // A data bar is square, as every part but a badge is.
  assert.equal(tokens['radius-card'], '0');
  assert.match(
    rule(css, "[data-ui-slot='data-display.bar']"),
    /border-radius: var\(--ui-radius-card\);/,
  );
});

test('letterpress: hairlines in the quiet border with ink for fields, shadows in the shadow role, a deboss, and a round busy ring', () => {
  const { tokens, css } = read('letterpress');
  assert.equal(tokens['border-control'], '1px solid var(--color-border-strong)');
  assert.equal(tokens['border-card'], '1px solid var(--color-border-default)');
  assert.equal(tokens['border-divider'], '1px solid var(--color-border-default)');
  // No shadow mixes the text color, which is cream in dark and would glow.
  for (const key of ['shadow-overlay', 'shadow-raised', 'shadow-inset']) {
    assert.match(tokens[key]!, /var\(--color-shadow\)/, key);
    assert.doesNotMatch(tokens[key]!, /--color-text-/, key);
  }
  assert.equal(tokens['shadow-card'], 'none');
  assert.match(
    rule(css, "[data-ui-slot='action']:active:not(:disabled, [aria-disabled='true'])"),
    /box-shadow: var\(--ui-shadow-inset\);/,
  );
  // The ring breathes, and is round when it's still.
  assert.equal(tokens['motion-emphasis'], 'pulse-once');
  assert.match(rule(css, "[data-ui-slot='action.spinner']"), /border-radius: 999px;/);
});
