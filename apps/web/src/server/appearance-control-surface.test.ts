import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contrast,
  GATE_TARGETS,
  isHighContrastSet,
  schemeSets,
  TEXT_ROLES,
} from '@portfolio/appearance';
import { platformStylesheet } from '@portfolio/appearance/node';
import { APPEARANCE_REGISTRY } from '../lib/appearance-registry';

// The visitor's Appearance control under prefers-contrast: more and prefers-reduced-transparency:
// reduce (the lead's ruling, 2026-11-01): the platform stylesheet paints it surface-default with
// text-primary (packages/appearance/src/node/platform.ts). Here, for every scheme this build
// registers, that ground is opaque and its text reaches each mode's target: 7:1 under
// prefers-contrast: more, which renders the scheme's high-contrast set, and 4.5:1 under reduced
// transparency, which renders its base set. Aurora's sky measured 2.31:1 and 2.22:1 without it.

const opaque = (color: string) => /^#[0-9a-f]{6}$/i.test(color);

const schemes = [...APPEARANCE_REGISTRY.packs.colorScheme.values()].filter(
  // A generated scheme's sets come from each site's input, which its contrast report gates at draft save.
  (entry) => !entry.manifest.generator,
);

test("the control's rule is in the platform stylesheet under both preferences", () => {
  const css = platformStylesheet();
  for (const media of ['(prefers-contrast: more)', '(prefers-reduced-transparency: reduce)']) {
    const block = css.slice(css.lastIndexOf(`@media ${media} {`));
    assert.match(
      block.slice(0, block.indexOf('\n  }\n')),
      /\[data-ui-slot="appearance-control"\] \[data-ui-slot="disclosure.summary"\] \{\n\s+background-color: var\(--color-surface-default\);\n\s+background-image: none;\n\s+color: var\(--color-text-primary\);/,
      media,
    );
  }
});

for (const [mode, highContrast, target] of [
  ['prefers-contrast: more', true, GATE_TARGETS.highContrastText],
  ['prefers-reduced-transparency: reduce', false, GATE_TARGETS.text],
] as const) {
  test(`under ${mode}, every registered scheme's surface-default is opaque and its text reaches ${target}:1 on it`, () => {
    assert.ok(schemes.length > 0);
    let checked = 0;
    for (const entry of schemes) {
      const sets = schemeSets(
        entry.sets,
        entry.manifest.highContrast,
        entry.manifest.derivation,
        entry.manifest.anchors,
      );
      for (const [name, set] of Object.entries(sets)) {
        if (!set || isHighContrastSet(name as never) !== highContrast) continue;
        const ground = set['surface-default'];
        assert.ok(opaque(ground), `${entry.manifest.id} ${name}: surface-default ${ground}`);
        for (const role of ['text-primary', ...TEXT_ROLES] as const) {
          const ratio = contrast(set[role], ground);
          assert.ok(
            ratio >= target,
            `${entry.manifest.id} ${name}: ${role} ${set[role]} on ${ground} is ${ratio.toFixed(2)}:1`,
          );
        }
        checked += 1;
      }
    }
    assert.ok(checked >= schemes.length, `${checked} sets`);
  });
}

test("control-room's dark sets, the tuple Aurora's cells found it on, meet both targets", () => {
  const entry = APPEARANCE_REGISTRY.packs.colorScheme.get('control-room');
  assert.ok(entry, 'control-room is registered');
  const sets = schemeSets(
    entry.sets,
    entry.manifest.highContrast,
    entry.manifest.derivation,
    entry.manifest.anchors,
  );
  const high = sets['high-contrast-dark']!;
  const base = sets.dark!;
  assert.ok(contrast(high['text-primary'], high['surface-default']) >= 7);
  assert.ok(contrast(base['text-primary'], base['surface-default']) >= 4.5);
});
