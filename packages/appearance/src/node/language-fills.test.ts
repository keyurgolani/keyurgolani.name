import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { composite, contrast } from '../color';
import { GATE_TARGETS } from '../gate';
import type { ColorSchemeManifest, DesignLanguageManifest } from '../manifests';
import type { ColorRole, ColorTokens } from '../roles';
import { deriveBaseSet, isHighContrastSet, schemeSets, type ColorSetName } from '../sets';
import { compilePack } from './compile';

// A language's stylesheet may fill a part but never color its text (the lint
// refuses `color`), so a fill it moves has to stay legible under the text the
// primitives keep. check:appearance gates token pairs, not a stylesheet's
// fills, so this reads each shipping language's compiled stylesheet and
// holds every badge status's text to its fill, in every set of every
// shipping scheme. Poster Press once filled every badge surface-default
// under on-status text, at 1.0 to 2.0:1.

const here = path.dirname(fileURLToPath(import.meta.url));
const LANGUAGES = path.resolve(here, '../../../appearance-languages/packs');
const SCHEMES = path.resolve(here, '../../../appearance-schemes/packs');

/** Each badge status, with the text and fill the shared primitives give it. */
const BADGES: readonly { status: string; text: ColorRole; fill: ColorRole }[] = [
  { status: 'neutral', text: 'text-secondary', fill: 'surface-subtle' },
  { status: 'positive', text: 'on-status', fill: 'positive' },
  { status: 'warning', text: 'on-status', fill: 'warning' },
  { status: 'danger', text: 'on-status', fill: 'danger' },
  { status: 'information', text: 'on-status', fill: 'information' },
];

const read = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T;

/** The shipping languages that ship a stylesheet, with it compiled as registry generation compiles it. */
function stylesheets(): { id: string; css: string }[] {
  return fs
    .readdirSync(LANGUAGES)
    .sort()
    .flatMap((id) => {
      const dir = path.join(LANGUAGES, id);
      const manifest = read<DesignLanguageManifest>(path.join(dir, 'manifest.json'));
      if (!manifest.stylesheet) return [];
      const compiled = compilePack({ kind: 'design-language', manifest, dir });
      assert.ok(compiled.ok, `${id} compiles: ${JSON.stringify(compiled)}`);
      assert.ok(compiled.pack.stylesheet, id);
      return [{ id, css: new TextDecoder().decode(compiled.pack.stylesheet.bytes) }];
    });
}

/** The selectors of a list, split at its top-level commas only. */
function selectorList(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ',' && depth === 0) {
      out.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  out.push(text.slice(start).trim());
  return out;
}

/**
 * The fill `css` gives a badge of `status`, as the role it names, or null
 * when no rule fills that badge. A rule reaches the badge when one of its
 * selectors names the badge slot and names no other status; the last wins,
 * as within one layer the later equal rule does.
 */
function badgeFill(css: string, status: string): string | null {
  let fill: string | null = null;
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const reaches = selectorList(selectors!).some((selector) => {
      const normalized = selector.replace(/"/g, "'");
      if (!normalized.includes("[data-ui-slot='badge']")) return false;
      const named = /\[data-status='([a-z]+)'\]/.exec(normalized)?.[1];
      return named === undefined || named === status;
    });
    if (!reaches) continue;
    for (const [, value] of body!.matchAll(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/g)) {
      const role = /^var\(--color-([a-z0-9-]+)\)$/.exec(value!.trim())?.[1];
      assert.ok(role, `a badge fill this test can read as a role, not ${value}`);
      fill = role;
    }
  }
  return fill;
}

/** Every set of every shipping scheme that renders from its manifest: generated ones have none. */
function sets(): { id: string; name: ColorSetName; tokens: ColorTokens }[] {
  return fs
    .readdirSync(SCHEMES)
    .sort()
    .flatMap((id) => {
      const manifest = read<ColorSchemeManifest & Record<string, unknown>>(
        path.join(SCHEMES, id, 'manifest.json'),
      );
      if (manifest.generator) return [];
      const base = manifest.anchors
        ? Object.fromEntries(
            (['light', 'dark'] as const)
              .filter((mode) => manifest.anchors![mode])
              .map((mode) => [
                mode,
                deriveBaseSet(manifest.derivation ?? 'anchor-v1', manifest.anchors![mode]!, mode),
              ]),
          )
        : { light: manifest.light, dark: manifest.dark };
      const all = schemeSets(base, manifest.highContrast, manifest.derivation, manifest.anchors);
      return (Object.entries(all) as [ColorSetName, ColorTokens][]).map(([name, tokens]) => ({
        id,
        name,
        tokens,
      }));
    });
}

test("a language's badge fills keep every status's text legible, in every set of every shipping scheme", () => {
  const languages = stylesheets();
  assert.ok(
    languages.some(({ id }) => id === 'poster-press'),
    'poster-press ships a stylesheet',
  );
  const every = sets();
  assert.ok(every.length > 60, `${every.length} sets`);
  for (const { id: language, css } of languages) {
    for (const { status, text, fill: primitive } of BADGES) {
      const fill = (badgeFill(css, status) ?? primitive) as ColorRole;
      for (const { id: scheme, name, tokens } of every) {
        const target = isHighContrastSet(name) ? GATE_TARGETS.highContrastText : GATE_TARGETS.text;
        const ratio = contrast(tokens[text], tokens[fill]);
        assert.ok(
          ratio >= target,
          `${language} ${status} badge under ${scheme} ${name}: ${text} on ${fill} is ${ratio.toFixed(2)}:1, under ${target}:1`,
        );
      }
    }
  }
});

test('the badge fill reader finds a bare badge rule, a status-scoped one, and no other status', () => {
  const css =
    "@layer language { @scope ([data-design-language='x']) {\n" +
    "[data-ui-slot='badge'] { border-color: var(--color-border-strong); }\n" +
    '[data-ui-slot="badge"][data-status="neutral"] { background-color: var(--color-surface-default); }\n' +
    "[data-ui-slot='toast'], [data-ui-slot='badge']:hover { background: var(--color-surface-prominent); }\n" +
    '} }';
  assert.equal(badgeFill(css, 'neutral'), 'surface-prominent');
  assert.equal(badgeFill(css, 'danger'), 'surface-prominent');
  assert.equal(badgeFill(css.replace(/\n\[data-ui-slot='toast'\][^\n]+/, ''), 'danger'), null);
  assert.equal(
    badgeFill(css.replace(/\n\[data-ui-slot='toast'\][^\n]+/, ''), 'neutral'),
    'surface-default',
  );
});

// A filled field (LANG-5c round 2, material-3-inspired): a stylesheet that
// takes a Field's border down to its bottom edge leaves one indicator line,
// in the language's control border color, on the field's surface-subtle
// fill. check:appearance holds that color to the grounds around a control,
// surface-subtle among them, at a target a texture raises; this holds the
// line to the fill it sits on at the plain non-text target, 3:1 (4.5:1 in a
// high-contrast set), in every set of every shipping scheme, so a filled
// field keeps its indicator whatever the gate's raise does.

/** The border-width a stylesheet gives Field's control, or null when no rule sets one. */
function fieldBorderWidth(css: string): string | null {
  let width: string | null = null;
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const reaches = selectorList(selectors!).some(
      (selector) => selector.replace(/"/g, "'") === "[data-ui-slot='field.control']",
    );
    if (!reaches) continue;
    for (const [, value] of body!.matchAll(/(?:^|;)\s*border-width\s*:\s*([^;]+)/g)) {
      width = value!.trim();
    }
  }
  return width;
}

/** Whether a border-width draws the bottom edge alone: `0 0 <w>` or `0 0 <w> 0`, with w over 0. */
function bottomOnly(width: string): boolean {
  const [top, right, bottom, left = right, ...rest] = width.split(/\s+/);
  const zero = (value?: string) => value !== undefined && Number.parseFloat(value) === 0;
  return (
    rest.length === 0 &&
    zero(top) &&
    zero(right) &&
    zero(left) &&
    bottom !== undefined &&
    Number.parseFloat(bottom) > 0
  );
}

test('the filled-field reader finds a bottom-only border on Field, and nothing else', () => {
  assert.equal(bottomOnly('0 0 1px'), true);
  assert.equal(bottomOnly('0 0 2px 0'), true);
  assert.equal(bottomOnly('0 0 0'), false);
  assert.equal(bottomOnly('1px'), false);
  assert.equal(bottomOnly('0 1px 1px'), false);
  const css =
    "[data-ui-slot='field.control'],\n[data-ui-slot='select.control'] { border-width: 0 0 1px; }\n" +
    "[data-ui-slot='action'] { border-width: 0; }";
  assert.equal(fieldBorderWidth(css), '0 0 1px');
  assert.equal(fieldBorderWidth("[data-ui-slot='field'] { border-width: 0 0 1px; }"), null);
});

test("a filled field's bottom indicator holds 3:1 against its fill, in every set of every shipping scheme", () => {
  const filled = stylesheets().filter(({ css }) => {
    const width = fieldBorderWidth(css);
    return width !== null && bottomOnly(width);
  });
  assert.ok(
    filled.some(({ id }) => id === 'material-3-inspired'),
    'material-3-inspired draws a filled field',
  );
  const every = sets();
  for (const { id: language } of filled) {
    const manifest = read<DesignLanguageManifest>(path.join(LANGUAGES, language, 'manifest.json'));
    const roles = [...manifest.tokens['border-control'].matchAll(/var\(--color-([a-z0-9-]+)\)/g)];
    assert.equal(roles.length, 1, `${language}'s control border draws in one role`);
    assert.deepEqual(indicatorFailures(language, roles[0]![1] as ColorRole, every), []);
    // An invalid field's indicator is the danger role (the primitives' invalid border).
    assert.deepEqual(indicatorFailures(language, 'danger', every), []);
  }
});

test('the indicator check fails a filled field ruled in border-subtle, and a 4:1 line in high contrast only', () => {
  assert.ok(indicatorFailures('subtle', 'border-subtle', sets()).length > 0);
  // #808080 on white is 3.95:1: over the base 3:1, under high contrast's 4.5:1.
  const grey = {
    'border-strong': '#808080',
    'surface-subtle': '#ffffff',
  } as unknown as ColorTokens;
  const planted = (['light', 'high-contrast-light'] as const).map((name) => ({
    id: 'grey',
    name,
    tokens: grey,
  }));
  assert.deepEqual(
    indicatorFailures('grey', 'border-strong', planted).map((failure) => failure.split(':')[0]),
    ["grey's filled field under grey high-contrast-light"],
  );
});

/** Each set in which a filled field's `line` falls under the non-text target on its surface-subtle fill. */
function indicatorFailures(
  language: string,
  line: ColorRole,
  every: readonly { id: string; name: ColorSetName; tokens: ColorTokens }[],
): string[] {
  return every.flatMap(({ id: scheme, name, tokens }) => {
    const target = isHighContrastSet(name)
      ? GATE_TARGETS.highContrastNonText
      : GATE_TARGETS.nonText;
    const ratio = contrast(tokens[line], tokens['surface-subtle']);
    return ratio >= target
      ? []
      : [
          `${language}'s filled field under ${scheme} ${name}: ${line} on surface-subtle is ${ratio.toFixed(2)}:1, under ${target}:1`,
        ];
  });
}

// A state layer (LANG-5c round 2 review, P1-4): a stylesheet that lays a
// translucent role over an Action on hover, as Material's state layer does,
// tints the fill under the Action's text. check:appearance gates token
// pairs, not a stylesheet's fills, so this composites each such layer over
// the Action's fill and holds the text there to the text target, 4.5:1 (7:1
// in a high-contrast set, which keeps a stylesheet's layers), in every set.
// A pressed Action's label is accent-text, so a layer that doesn't leave
// pressed Actions out is held for accent-text too.

/** The fill the primitives give a hovered Action of each emphasis, and the text they set on it. */
const HOVERED: Readonly<Record<string, { fill: ColorRole; text: ColorRole }>> = {
  secondary: { fill: 'surface-prominent', text: 'text-primary' },
  quiet: { fill: 'surface-subtle', text: 'accent-text' },
  primary: { fill: 'accent-hover', text: 'on-accent' },
};

interface StateLayer {
  readonly emphasis: string;
  readonly role: ColorRole;
  readonly percent: number;
  readonly sparesPressed: boolean;
  readonly fill: ColorRole;
}

/** Each hover state layer `css` lays on an Action: its emphasis, role and percent, whether it spares pressed ones, and the fill under it. */
function stateLayers(css: string): StateLayer[] {
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) => ({
    selectors: selectorList(selectors!).map((selector) => selector.replace(/"/g, "'")),
    body: body!,
  }));
  const restingFill = (emphasis: string): ColorRole | null => {
    let fill: ColorRole | null = null;
    for (const { selectors, body } of rules) {
      if (!selectors.includes(`[data-ui-slot='action'][data-emphasis='${emphasis}']`)) continue;
      const role = /background-color\s*:\s*var\(--color-([a-z0-9-]+)\)/.exec(body)?.[1];
      if (role) fill = role as ColorRole;
    }
    return fill;
  };
  return rules.flatMap(({ selectors, body }) =>
    selectors.flatMap((selector) => {
      if (!selector.startsWith("[data-ui-slot='action']") || !selector.includes(':hover'))
        return [];
      const layer =
        /background-image\s*:\s*linear-gradient\(\s*color-mix\(in srgb, var\(--color-([a-z0-9-]+)\) (\d+)%, transparent\)/.exec(
          body,
        );
      if (!layer) return [];
      const emphasis = /\[data-emphasis='([a-z]+)'\]/.exec(selector)?.[1] ?? 'secondary';
      return [
        {
          emphasis,
          role: layer[1] as ColorRole,
          percent: Number(layer[2]),
          sparesPressed: /:not\([^{]*\[aria-pressed='true'\]/.test(selector),
          fill: restingFill(emphasis) ?? HOVERED[emphasis]!.fill,
        },
      ];
    }),
  );
}

/** Each set in which a state layer takes the hovered Action's text under the text target. */
function stateLayerFailures(
  language: string,
  layer: StateLayer,
  every: readonly { id: string; name: ColorSetName; tokens: ColorTokens }[],
): string[] {
  const texts: ColorRole[] = [HOVERED[layer.emphasis]!.text];
  if (!layer.sparesPressed && !texts.includes('accent-text')) texts.push('accent-text');
  return every.flatMap(({ id: scheme, name, tokens }) => {
    const target = isHighContrastSet(name) ? GATE_TARGETS.highContrastText : GATE_TARGETS.text;
    const ground = composite(tokens[layer.role], tokens[layer.fill], layer.percent / 100);
    return texts.flatMap((text) => {
      const ratio = contrast(tokens[text], ground);
      return ratio >= target
        ? []
        : [
            `${language}'s ${layer.percent}% ${layer.role} hover layer on a ${layer.emphasis} Action under ${scheme} ${name}: ${text} on ${layer.fill} is ${ratio.toFixed(2)}:1, under ${target}:1`,
          ];
    });
  });
}

test("a stylesheet's hover state layer keeps the Action's text at the text target over its fill, in every set of every shipping scheme", () => {
  const layered = stylesheets().flatMap(({ id, css }) =>
    stateLayers(css).map((layer) => ({ id, layer })),
  );
  assert.ok(
    layered.some(({ id, layer }) => id === 'material-3-inspired' && layer.sparesPressed),
    "material-3-inspired's state layer is read, sparing pressed Actions",
  );
  const every = sets();
  for (const { id, layer } of layered) {
    assert.deepEqual(stateLayerFailures(id, layer, every).slice(0, 5), []);
  }
});

test('the state-layer check fails the same layer when it lays over pressed Actions too', () => {
  const css =
    "[data-ui-slot='action'][data-emphasis='secondary'] { background-color: var(--color-surface-prominent); }\n" +
    "[data-ui-slot='action'][data-emphasis='secondary']:hover:not(:disabled) { background-image: linear-gradient(color-mix(in srgb, var(--color-text-primary) 8%, transparent), color-mix(in srgb, var(--color-text-primary) 8%, transparent)); }";
  const [layer] = stateLayers(css);
  assert.deepEqual(layer, {
    emphasis: 'secondary',
    role: 'text-primary',
    percent: 8,
    sparesPressed: false,
    fill: 'surface-prominent',
  });
  const failures = stateLayerFailures('planted', layer!, sets());
  assert.ok(
    failures.some((failure) => / dark: accent-text on surface-prominent /.test(failure)),
    failures[0],
  );
});
