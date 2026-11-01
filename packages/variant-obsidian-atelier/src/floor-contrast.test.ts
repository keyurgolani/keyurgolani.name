import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  COLOR_SET_NAMES,
  contrast,
  schemeSets,
  withDerivedRoles,
  type ColorSchemeManifest,
  type ColorTokens,
} from '@portfolio/appearance';
import { schemeBaseSets } from '@portfolio/appearance/node';

// The composition's own mixes, held to body contrast in every shipping
// scheme and mode (F2: each lane proves its own). Two of them carry text:
//
// - the floor, the wall mixed 16% toward the scheme's shadow in oklab
//   (styles.css, `.oa-wall::after`), under the entrance's label, the way
//   on, the counter, and every wall's floor line, all in the primary ink;
// - the light (`.oa-hang__work`'s pool), whose brightest is the lit
//   surface, K-2's role for it, fading to the wall. No text sits over it by
//   its geometry: this holds the primary ink over its brightest point
//   anyway, so moving a label onto it can't lose contrast, and holds it
//   gone in high contrast, where the lit surface is the wall itself.
//
// Every authored scheme pack is read from its manifest, as registry
// generation reads it, with each set it renders: light, dark, and both
// high-contrast sets. A generator scheme's sets come from the owner's own
// seed or picture at runtime, so no test can hold every one of them; each
// is held here as its committed reference record generates it, from the
// seed or the repository's example picture check:appearance keeps current.
// The demo's profile-image scheme is drawn from the same portrait.

const STYLES = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const PACKS = new URL('../../appearance-schemes/packs/', import.meta.url);
const GENERATED = new URL('../../appearance-schemes/generated/', import.meta.url);

/** The mixes, as the stylesheet writes them, so the test reads what ships. */
const FLOOR =
  /--layout-floor-ground: color-mix\(\s*in oklab,\s*var\(--color-surface-prominent\),\s*var\(--color-shadow\) (\d+)%\s*\)/;
const POOL =
  /:is\(\.oa-entrance, \.oa-installation\) \.oa-hang__work::before \{[^}]*radial-gradient\(50% 50% at 50% 50%, var\(--color-surface-lit\), transparent\)/;

type Lab = readonly [number, number, number];

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

function oklab(hex: string): Lab {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(Number.parseInt(hex.slice(i, i + 2), 16)));
  const l = Math.cbrt(0.4122214708 * r! + 0.5363325363 * g! + 0.0514459929 * b!);
  const m = Math.cbrt(0.2119034982 * r! + 0.6806995451 * g! + 0.1073969566 * b!);
  const s = Math.cbrt(0.0883024619 * r! + 0.2817188376 * g! + 0.6299787005 * b!);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function hex([L, a, b]: Lab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${rgb
    .map((v) => Math.round(Math.min(1, Math.max(0, toGamma(v))) * 255))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** color-mix(in oklab, from, to percent%). */
function mixOklab(from: string, to: string, percent: number): string {
  const a = oklab(from);
  const b = oklab(to);
  const t = percent / 100;
  return hex([0, 1, 2].map((i) => a[i]! * (1 - t) + b[i]! * t) as unknown as Lab);
}

interface Reference {
  readonly result: {
    readonly tokens: {
      readonly light: ColorTokens;
      readonly dark: ColorTokens;
      readonly highContrast: { readonly light: ColorTokens; readonly dark: ColorTokens };
    };
  };
}

/** Every set every scheme pack renders: an authored pack's from its manifest, a generator's from its reference record. */
function shippingSets(): {
  packs: number;
  generated: string[];
  sets: { where: string; set: ColorTokens; highContrast: boolean }[];
} {
  const sets: { where: string; set: ColorTokens; highContrast: boolean }[] = [];
  const generated: string[] = [];
  const ids = readdirSync(PACKS);
  for (const id of ids) {
    const manifest = JSON.parse(
      readFileSync(new URL(`${id}/manifest.json`, PACKS), 'utf8'),
    ) as ColorSchemeManifest & { generator?: unknown };
    const base = schemeBaseSets(manifest);
    if (base) {
      const rendered = schemeSets(base, manifest.highContrast ?? {}, manifest.derivation);
      // Each mode the pack declares renders, and its high-contrast set with it: none goes unread.
      for (const mode of manifest.modes as readonly ('light' | 'dark')[]) {
        assert.ok(rendered[mode] && rendered[`high-contrast-${mode}`], `${id} renders ${mode}`);
      }
      for (const name of COLOR_SET_NAMES) {
        const set = rendered[name];
        if (set) sets.push({ where: `${id} ${name}`, set, highContrast: name.startsWith('high') });
      }
      continue;
    }
    // A scheme with no authored sets is a generator's, and its reference record is committed beside the packs.
    assert.ok(manifest.generator, `${id} has neither authored sets nor a generator`);
    generated.push(id);
    const { tokens } = (
      JSON.parse(readFileSync(new URL(`${id}.json`, GENERATED), 'utf8')) as Reference
    ).result;
    // A reference stores the core roles alone (K-2): rendering works the derived three out again, as here.
    sets.push(
      {
        where: `${id} light (reference)`,
        set: withDerivedRoles(tokens.light, false),
        highContrast: false,
      },
      {
        where: `${id} dark (reference)`,
        set: withDerivedRoles(tokens.dark, false),
        highContrast: false,
      },
      {
        where: `${id} high-contrast light (reference)`,
        set: withDerivedRoles(tokens.highContrast.light, true),
        highContrast: true,
      },
      {
        where: `${id} high-contrast dark (reference)`,
        set: withDerivedRoles(tokens.highContrast.dark, true),
        highContrast: true,
      },
    );
  }
  return { packs: ids.length, generated, sets };
}

const HEX = /^#[0-9a-f]{6}$/i;

test('the floor holds the primary ink at 4.5:1, the light under it would too and is gone in high contrast, and Index stands on its plate at 4.95:1, in every shipping scheme and mode', () => {
  // The wall's floor, and a hall's floor line over its rail, are both that ground.
  assert.match(STYLES, /\.oa-wall::after \{[^}]*background-color: var\(--layout-floor-ground\)/);
  const floor = Number(FLOOR.exec(STYLES)?.[1]);
  assert.ok(floor > 0, 'the stylesheet mixes the floor from the wall and the shadow');
  assert.match(STYLES, POOL, 'the light is the lit surface, fading to the wall');
  // No rule takes the light away by display mode: high contrast removes it through its role.
  assert.doesNotMatch(STYLES, /prefers-contrast[^{]*\{[^}]*::before[^}]*\{\s*display: none/);
  const { packs, generated, sets } = shippingSets();
  // Every pack is read, two sets at least to each, so a count short means one was skipped.
  assert.ok(sets.length >= packs * 2, `read ${sets.length} sets of ${packs} packs`);
  assert.ok(generated.length >= 4, `the generator schemes, from their references: ${generated}`);
  const failing: string[] = [];
  for (const { where, set, highContrast } of sets) {
    const wall = set['surface-prominent'];
    const ink = set['text-primary'];
    // The mix reads hex alone: any other form would make a NaN that no comparison fails.
    for (const [role, value] of Object.entries({
      wall,
      ink,
      shadow: set.shadow,
      'surface-lit': set['surface-lit'],
    })) {
      assert.match(value, HEX, `${where} ${role}`);
    }
    const onFloor = contrast(ink, mixOklab(wall, set.shadow, floor));
    const underLight = contrast(ink, set['surface-lit']);
    // In high contrast the lit surface is the canvas, and the light shows nothing on a wall of it.
    if (highContrast && set['surface-lit'] !== set.canvas) {
      failing.push(`${where}: the lit surface isn't the canvas`);
    }
    assert.ok(Number.isFinite(onFloor) && Number.isFinite(underLight), where);
    if (onFloor < 4.5) failing.push(`${where}: floor ${onFloor.toFixed(2)}`);
    if (underLight < 4.5) failing.push(`${where}: light ${underLight.toFixed(2)}`);
    // Index, the one fixed control: the primary ink on its plate, the wall's own surface.
    const onPlate = contrast(ink, wall);
    if (!(onPlate >= 4.95)) failing.push(`${where}: Index ${onPlate.toFixed(2)}`);
    // Its edge, the strong border on the wall, a non-text contrast of 3:1, so the plate reads on a wall of its own surface.
    const edge = contrast(set['border-strong'], wall);
    if (!(edge >= 3)) failing.push(`${where}: Index's edge ${edge.toFixed(2)}`);
  }
  assert.deepEqual(failing, []);
  // The plate is what the test holds: the wall's surface, the primary ink.
  const plate = /\.oa-chrome__pin \{([^}]*)\}/.exec(STYLES)?.[1] ?? '';
  assert.match(plate, /background-color: var\(--color-surface-prominent\)/);
  assert.match(plate, /color: var\(--color-text-primary\)/);
  assert.match(
    plate,
    /outline: var\(--ui-border-divider\);\s*outline-color: var\(--color-border-strong\)/,
  );
});

test('focus on the floor takes the primary ink as its ground, 4.5:1 on the floor as above, and the inverse ink on it at 4.5:1, since the focus color falls short there', () => {
  const rule =
    /:is\(\.oa-wallfloor, \.oa-floor__on\) a:focus-visible \{([^}]*)\}/.exec(STYLES)?.[1] ?? '';
  assert.match(rule, /background-color: var\(--color-text-primary\)/);
  assert.match(rule, /color: var\(--color-text-inverse\)/);
  const floor = Number(FLOOR.exec(STYLES)?.[1]);
  const failing: string[] = [];
  let short = 0;
  for (const { where, set } of shippingSets().sets) {
    const ink = contrast(set['text-inverse'], set['text-primary']);
    if (!(ink >= 4.5)) failing.push(`${where}: ${ink.toFixed(2)}`);
    if (contrast(set.focus, mixOklab(set['surface-prominent'], set.shadow, floor)) < 3) short++;
  }
  assert.deepEqual(failing, []);
  // Why the rule is there: in some shipping set the ring alone reads under 3:1 on the floor.
  assert.ok(short > 0, 'the focus color reads at 3:1 on the floor everywhere, so the rule may go');
});
