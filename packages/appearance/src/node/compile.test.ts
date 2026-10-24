import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { anchorV1 } from '../derive';
import { LAYER_ORDER } from '../layers';
import type { DesignLanguageManifest, TypographyManifest } from '../manifests';
import { schemeSets, type ColorSetName, type SchemeSets } from '../sets';
import { COLOR_ROLES, LANGUAGE_KEYS } from '../tokens';
import { fileURLToPath } from 'node:url';
import {
  DARK_ONLY,
  FONT,
  HUMANIST_UI,
  LIGHT_ONLY,
  packDir as shippedDir,
  PLATFORM_NEUTRAL,
  SEED,
  TRANSLUCENT,
  WARM_PARCHMENT,
} from '../test-support/packs';
import {
  compileGeneratedScheme,
  compilePack,
  compileSchemeStylesheet,
  namespacedStack,
  PACK_URL,
  schemeBaseSets,
} from './compile';

// compilePack() (#19, Slice 2, items 1 and 4). Scheme stylesheets are checked
// by evaluating their cascade: for every scheme shape, display mode,
// data-contrast, and media state, the boundary and the document's root get
// exactly the set that combination renders.

type Rule = { media: string[]; selectors: string[]; declarations: Map<string, string> };

/** The compiler's own output format, read back: rules with their media conditions, in order. */
function rules(css: string): Rule[] {
  const out: Rule[] = [];
  const media: string[] = [];
  const kinds: ('media' | 'layer' | 'rule')[] = [];
  let selectors: string[] = [];
  let current: Rule | null = null;
  for (const raw of css.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('/*') || line === LAYER_ORDER) continue;
    if (line.startsWith('@media ') && line.endsWith(' {')) {
      media.push(line.slice('@media '.length, -2));
      kinds.push('media');
    } else if (line.startsWith('@layer ') && line.endsWith(' {')) {
      kinds.push('layer');
    } else if (line.endsWith(',')) {
      selectors.push(line.slice(0, -1));
    } else if (line.endsWith(' {')) {
      selectors.push(line.slice(0, -2));
      current = { media: [...media], selectors, declarations: new Map() };
      selectors = [];
      kinds.push('rule');
    } else if (line === '}') {
      const kind = kinds.pop();
      if (kind === 'rule') out.push(current!);
      if (kind === 'media') media.pop();
    } else {
      const match = /^([a-z0-9-]+): (.*);$/.exec(line);
      assert.ok(match && current, `unexpected line: ${line}`);
      current!.declarations.set(match[1]!, match[2]!);
    }
  }
  return out;
}

interface Environment {
  readonly dark: boolean;
  readonly more: boolean;
  readonly print: boolean;
}

function mediaMatches(prelude: string, env: Environment): boolean {
  return prelude.split(' and ').every((part) => {
    if (part === 'print') return env.print;
    if (part === '(prefers-color-scheme: dark)') return env.dark;
    if (part === '(prefers-contrast: more)') return env.more;
    throw new Error(`unexpected media ${part}`);
  });
}

type Attributes = Readonly<Record<string, string>>;

/** Whether a selector of attribute tests matches, and its specificity. */
function attributeMatch(selector: string, attributes: Attributes): number | null {
  const tests = [...selector.matchAll(/\[([a-z-]+)="([^"]*)"\]/g)];
  assert.equal(
    tests.map((test) => test[0]).join(''),
    selector,
    `not a plain attribute selector: ${selector}`,
  );
  return tests.every(([, name, value]) => attributes[name!] === value) ? tests.length : null;
}

function selectorMatch(
  selector: string,
  element: 'boundary' | 'root',
  attributes: Attributes,
): number | null {
  const root = /^:root:has\((.*)\)$/.exec(selector);
  if (element === 'root') {
    if (!root) return null;
    const inner = attributeMatch(root[1]!, attributes);
    return inner === null ? null : inner + 1;
  }
  return root ? null : attributeMatch(selector, attributes);
}

/** What the cascade gives `element` for each property. */
function cascade(
  css: string,
  element: 'boundary' | 'root',
  attributes: Attributes,
  env: Environment,
): Map<string, string> {
  const winners = new Map<string, { specificity: number; order: number; value: string }>();
  rules(css).forEach((rule, order) => {
    if (!rule.media.every((prelude) => mediaMatches(prelude, env))) return;
    const specificity = Math.max(
      -1,
      ...rule.selectors.map((selector) => selectorMatch(selector, element, attributes) ?? -1),
    );
    if (specificity < 0) return;
    for (const [property, value] of rule.declarations) {
      const best = winners.get(property);
      if (!best || specificity >= best.specificity)
        winners.set(property, { specificity, order, value });
    }
  });
  return new Map([...winners].map(([property, { value }]) => [property, value]));
}

/** The set a combination renders, by the refined body's rules. */
function expected(
  sets: SchemeSets,
  mode: string,
  contrast: 'system' | 'more',
  env: Environment,
): ColorSetName {
  const dual = Boolean(sets.light && sets.dark);
  const high = mode === 'high-contrast' || contrast === 'more' || env.more;
  if (env.print) return high || !sets.light ? 'high-contrast-light' : 'light';
  if (mode === 'high-contrast') return sets.dark ? 'high-contrast-dark' : 'high-contrast-light';
  const polarity =
    mode === 'light'
      ? sets.light
        ? 'light'
        : 'dark'
      : mode === 'dark'
        ? sets.dark
          ? 'dark'
          : 'light'
        : dual
          ? env.dark
            ? 'dark'
            : 'light'
          : sets.light
            ? 'light'
            : 'dark';
  if (high) return polarity === 'light' ? 'high-contrast-light' : 'high-contrast-dark';
  return polarity;
}

const SHAPES: [string, SchemeSets][] = [
  [
    'dual',
    schemeSets({
      light: anchorV1(WARM_PARCHMENT.anchors!.light!, 'light'),
      dark: anchorV1(WARM_PARCHMENT.anchors!.dark!, 'dark'),
    }),
  ],
  ['dark-only', schemeSets({ dark: anchorV1(DARK_ONLY.anchors!.dark!, 'dark') })],
  ['light-only', schemeSets({ light: anchorV1(LIGHT_ONLY.anchors!.light!, 'light') })],
];

test('a scheme stylesheet starts with the layer order and holds only scheme-layer rules', () => {
  const css = compileSchemeStylesheet('warm-parchment', SHAPES[0]![1]);
  assert.ok(css.startsWith(`${LAYER_ORDER}\n`));
  assert.deepEqual(css.match(/@layer [a-z-]+ \{/g), ['@layer scheme {']);
  assert.ok(css.endsWith('}\n'));
  // The root rules set only color-scheme and background-color.
  for (const rule of rules(css)) {
    if (rule.selectors.some((selector) => selector.startsWith(':root'))) {
      assert.ok(
        rule.selectors.every((selector) =>
          selector.startsWith(':root:has([data-appearance-boundary="document"]'),
        ),
      );
      assert.deepEqual([...rule.declarations.keys()], ['color-scheme', 'background-color']);
    } else {
      assert.deepEqual(
        [...rule.declarations.keys()],
        ['color-scheme', ...COLOR_ROLES.map((role) => `--color-${role}`)],
      );
    }
  }
});

test('every mode, contrast, and media state renders its set, on the boundary and the root', () => {
  let checked = 0;
  for (const [shape, sets] of SHAPES) {
    const css = compileSchemeStylesheet('acme-scheme', sets);
    for (const mode of ['system', 'light', 'dark', 'high-contrast']) {
      for (const contrast of ['system', 'more'] as const) {
        for (const dark of [false, true]) {
          for (const more of [false, true]) {
            for (const print of [false, true]) {
              const env = { dark, more, print };
              const want = expected(sets, mode, contrast, env);
              const attributes = {
                'data-appearance-boundary': 'document',
                'data-color-scheme': 'acme-scheme',
                'data-display-mode': mode,
                'data-contrast': contrast,
              };
              const label = `${shape} ${mode} contrast=${contrast} ${JSON.stringify(env)}`;
              const boundary = cascade(css, 'boundary', attributes, env);
              const set = sets[want]!;
              for (const role of COLOR_ROLES)
                assert.equal(boundary.get(`--color-${role}`), set[role], `${label}: ${role}`);
              const polarity =
                want === 'light' || want === 'high-contrast-light' ? 'light' : 'dark';
              assert.equal(boundary.get('color-scheme'), polarity, label);
              const root = cascade(css, 'root', attributes, env);
              assert.equal(root.get('background-color'), set.canvas, `${label}: root`);
              assert.equal(root.get('color-scheme'), polarity, `${label}: root`);
              checked += 1;
            }
          }
        }
      }
    }
  }
  assert.equal(checked, 3 * 4 * 2 * 8);
});

test("a plate's scheme never reaches the document root, and another scheme's rules never match", () => {
  const css = compileSchemeStylesheet('acme-scheme', SHAPES[0]![1]);
  const env = { dark: false, more: false, print: false };
  const plate = {
    'data-appearance-boundary': 'plate',
    'data-color-scheme': 'acme-scheme',
    'data-display-mode': 'dark',
    'data-contrast': 'system',
  };
  assert.equal(cascade(css, 'root', plate, env).size, 0);
  assert.equal(
    cascade(css, 'boundary', plate, env).get('--color-canvas'),
    SHAPES[0]![1].dark!.canvas,
  );
  const other = { ...plate, 'data-color-scheme': 'other' };
  assert.equal(cascade(css, 'boundary', other, env).size, 0);
});

test('a boundary without a display mode still gets every token, as system does', () => {
  for (const [shape, sets] of SHAPES) {
    const css = compileSchemeStylesheet('acme-scheme', sets);
    const tokens = cascade(
      css,
      'boundary',
      { 'data-color-scheme': 'acme-scheme' },
      { dark: true, more: false, print: false },
    );
    assert.equal(tokens.size, COLOR_ROLES.length + 1, shape);
  }
});

test('compilePack names a stylesheet by its content and serves it from the pack directory', () => {
  const result = compilePack({ kind: 'color-scheme', manifest: WARM_PARCHMENT, dir: os.tmpdir() });
  assert.ok(result.ok);
  const { stylesheet, assets } = result.pack;
  assert.ok(stylesheet);
  assert.match(stylesheet.name, /^warm-parchment\.[0-9a-f]{12}\.css$/);
  assert.equal(stylesheet.url, `${PACK_URL}${stylesheet.name}`);
  assert.equal(stylesheet.name.split('.')[1], stylesheet.sha256.slice(0, 12));
  assert.deepEqual(assets, []);
  const again = compilePack({
    kind: 'color-scheme',
    manifest: { ...WARM_PARCHMENT },
    dir: os.tmpdir(),
  });
  assert.ok(again.ok);
  assert.deepEqual(
    again.pack.stylesheet!.bytes,
    stylesheet.bytes,
    'compiling twice gives the same bytes',
  );
});

test('a generator scheme compiles no stylesheet until it has generated sets', () => {
  assert.equal(schemeBaseSets(SEED), null);
  const result = compilePack({ kind: 'color-scheme', manifest: SEED, dir: os.tmpdir() });
  assert.ok(result.ok);
  assert.equal(result.pack.stylesheet, null);
  const generated = { light: SHAPES[0]![1].light!, dark: SHAPES[0]![1].dark! };
  assert.equal(
    compileGeneratedScheme('fixture-seed', generated),
    compileSchemeStylesheet('fixture-seed', schemeSets(generated)),
  );
});

test('authored high-contrast sets take the place of the derived ones', () => {
  const sets = SHAPES[0]![1];
  const authored = { ...sets['high-contrast-dark']!, accent: '#ffd700' };
  const css = compileSchemeStylesheet(
    'acme',
    schemeSets({ light: sets.light!, dark: sets.dark! }, { dark: authored }),
  );
  const tokens = cascade(
    css,
    'boundary',
    { 'data-color-scheme': 'acme', 'data-display-mode': 'high-contrast' },
    { dark: false, more: false, print: false },
  );
  assert.equal(tokens.get('--color-accent'), '#ffd700');
});

function packDir(files: Record<string, string | Uint8Array>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-pack-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

test('a typography profile scopes its roles and namespaces each font it ships', () => {
  const woff2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, 4]);
  const dir = packDir({ 'faces/body.woff2': woff2 });
  try {
    const manifest: TypographyManifest = {
      ...HUMANIST_UI,
      id: 'acme-type',
      roles: {
        ...HUMANIST_UI.roles,
        body: { ...HUMANIST_UI.roles.body, 'font-family': '"Segoe UI", Body Face, sans-serif' },
      },
      fontAssets: [
        {
          family: 'Body Face',
          file: './faces/body.woff2',
          weight: [100, 900],
          style: 'normal',
          unicodeRange: 'U+0000-00FF',
        },
      ],
    };
    const result = compilePack({ kind: 'typography', manifest, dir });
    assert.ok(result.ok, JSON.stringify(result.ok ? null : result.problems));
    const { stylesheet, assets } = result.pack;
    assert.equal(assets.length, 1);
    assert.match(assets[0]!.name, /^acme-type\.[0-9a-f]{12}\.woff2$/);
    assert.deepEqual(assets[0]!.bytes, woff2);
    const css = new TextDecoder().decode(stylesheet!.bytes);
    assert.ok(css.startsWith(`${LAYER_ORDER}\n`));
    assert.deepEqual(css.match(/@layer [a-z-]+ \{/g), ['@layer typography {']);
    assert.match(
      css,
      /@font-face \{\n {4}font-family: "acme-type Body Face";\n {4}src: url\("\/_portfolio\/font\/acme-type\.[0-9a-f]{12}\.woff2"\) format\("woff2"\);\n {4}font-weight: 100 900;\n {4}font-style: normal;\n {4}font-display: swap;\n {4}unicode-range: U\+0000-00FF;\n {2}\}/,
    );
    // The shipped family comes ahead of the declared fallbacks.
    assert.match(css, /--type-body-font-family: "acme-type Body Face", "Segoe UI", sans-serif;/);
    assert.match(
      css,
      /\[data-typography="acme-type"\] \{\n {4}--type-display-font-family: "Trebuchet MS", "Segoe UI", sans-serif;/,
    );
    assert.match(css, /--type-measure-body: 68ch;\n {4}--type-measure-compact: 52ch;/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a font a typography profile can't ship is a problem, never a silent skip", () => {
  const dir = packDir({ 'notfont.woff2': 'plain text', 'big.woff2': new Uint8Array(600 * 1024) });
  const outside = packDir({ 'face.woff2': new Uint8Array([0x77, 0x4f, 0x46, 0x32]) });
  fs.symlinkSync(path.join(outside, 'face.woff2'), path.join(dir, 'link.woff2'));
  try {
    const asset = (file: string) => ({
      family: 'Face',
      file,
      weight: 400,
      style: 'normal' as const,
      unicodeRange: 'U+0000-00FF',
    });
    const problems = (file: string) => {
      const result = compilePack({
        kind: 'typography',
        manifest: { ...HUMANIST_UI, fontAssets: [asset(file)] },
        dir,
      });
      assert.equal(result.ok, false);
      return result.ok ? [] : result.problems.map(({ message }) => message);
    };
    assert.match(
      problems('./missing.woff2')[0]!,
      /names \.\/missing\.woff2, which the pack doesn't have/,
    );
    assert.match(problems('./notfont.woff2')[0]!, /isn't a WOFF2 font/);
    assert.match(problems('./big.woff2')[0]!, /over the 512 KB/);
    assert.match(problems('./link.woff2')[0]!, /resolves outside the pack's directory/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('namespacedStack moves shipped families ahead and leaves the fallbacks in order', () => {
  assert.equal(
    namespacedStack('Inter, "Segoe UI", sans-serif', 'acme', ['Inter']),
    '"acme Inter", "Segoe UI", sans-serif',
  );
  assert.equal(
    namespacedStack('system-ui, "inter", Noto, sans-serif', 'acme', ['Noto', 'Inter']),
    '"acme Inter", "acme Noto", system-ui, sans-serif',
  );
  assert.equal(namespacedStack('Georgia, serif', 'acme', []), 'Georgia, serif');
});

test('a design language compiles its tokens, and its stylesheet inside its @scope', () => {
  const dir = packDir({
    'styles.css':
      '[data-ui-slot="action"]:hover {\n  transform: var(--ui-state-hover-transform);\n}\n',
  });
  try {
    const manifest: DesignLanguageManifest = {
      ...PLATFORM_NEUTRAL,
      id: 'acme-lang',
      stylesheet: './styles.css',
    };
    const result = compilePack({ kind: 'design-language', manifest, dir });
    assert.ok(result.ok, JSON.stringify(result.ok ? null : result.problems));
    const css = new TextDecoder().decode(result.pack.stylesheet!.bytes);
    assert.ok(css.startsWith(`${LAYER_ORDER}\n`));
    assert.deepEqual(css.match(/@layer [a-z-]+ \{/g), ['@layer language {']);
    assert.match(css, /\n {2}\[data-design-language="acme-lang"\] \{\n {4}--ui-surface-material: /);
    for (const key of LANGUAGE_KEYS) assert.match(css, new RegExp(`--ui-${key}: `));
    assert.match(
      css,
      / {2}@scope \(\[data-design-language="acme-lang"\]\) to \(\[data-appearance-boundary\]\) \{\n {4}\[data-ui-slot="action"\]:hover \{\n {6}transform: var\(--ui-state-hover-transform\);\n {4}\}\n {2}\}\n\}\n$/,
    );
    // Without a stylesheet there's no scope block at all.
    const bare = compilePack({ kind: 'design-language', manifest: PLATFORM_NEUTRAL, dir });
    assert.ok(bare.ok);
    assert.doesNotMatch(new TextDecoder().decode(bare.pack.stylesheet!.bytes), /@scope/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a language's stylesheet problems name the file, line, and column", () => {
  const dir = packDir({ 'styles.css': '[data-ui-slot="action"] {\n  display: none;\n}\n' });
  try {
    const manifest: DesignLanguageManifest = {
      ...PLATFORM_NEUTRAL,
      id: 'acme-lang',
      stylesheet: './styles.css',
    };
    const result = compilePack({ kind: 'design-language', manifest, dir });
    assert.equal(result.ok, false);
    assert.deepEqual(result.ok ? null : result.problems[0], {
      file: './styles.css',
      pointer: '',
      message:
        "./styles.css:2:3 display: none lays the part out, or takes it off the page: display is the shared primitives' and the variant's, never a language's.",
      remedy: "Change the rule to style [data-ui-slot] parts through the language's tokens.",
    });
    const missing = compilePack({
      kind: 'design-language',
      manifest: { ...manifest, stylesheet: './gone.css' },
      dir,
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.ok ? null : missing.problems[0]!.pointer, '/stylesheet');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('every first-party pack compiles from the directory its package ships', () => {
  const shipped = [
    ['design-language', 'appearance-languages', PLATFORM_NEUTRAL],
    ['color-scheme', 'appearance-schemes', WARM_PARCHMENT],
    ['typography', 'appearance-typography', HUMANIST_UI],
    ['design-language', 'appearance-fixtures-languages', TRANSLUCENT],
    ['color-scheme', 'appearance-fixtures-schemes', DARK_ONLY],
    ['color-scheme', 'appearance-fixtures-schemes', LIGHT_ONLY],
    ['color-scheme', 'appearance-fixtures-schemes', SEED],
    ['typography', 'appearance-fixtures-typography', FONT],
  ] as const;
  for (const [kind, packageDir, manifest] of shipped) {
    const dir = fileURLToPath(shippedDir(packageDir, manifest.id));
    const result = compilePack({ kind, manifest, dir });
    assert.ok(result.ok, `${manifest.id}: ${JSON.stringify(result.ok ? null : result.problems)}`);
    const { stylesheet, assets } = result.pack;
    if (manifest.id === 'fixture-seed') {
      assert.equal(stylesheet, null);
      continue;
    }
    assert.ok(
      new TextDecoder().decode(stylesheet!.bytes).startsWith(`${LAYER_ORDER}\n`),
      manifest.id,
    );
    assert.equal(assets.length, manifest.id === 'fixture-font' ? 1 : 0, manifest.id);
  }
  // The font ships byte for byte, and the translucent stylesheet compiles into its scope.
  const font = compilePack({
    kind: 'typography',
    manifest: FONT,
    dir: fileURLToPath(shippedDir('appearance-fixtures-typography', 'fixture-font')),
  });
  assert.ok(font.ok);
  assert.equal(
    font.pack.assets[0]!.sha256,
    '1b5ebfb3a01a97343ac96873e6d59a8cb285c66012b6a1ac509cb2765e995ba8',
  );
  const translucent = compilePack({
    kind: 'design-language',
    manifest: TRANSLUCENT,
    dir: fileURLToPath(shippedDir('appearance-fixtures-languages', 'fixture-translucent')),
  });
  assert.ok(translucent.ok);
  assert.match(
    new TextDecoder().decode(translucent.pack.stylesheet!.bytes),
    /@scope \(\[data-design-language="fixture-translucent"\]\) to \(\[data-appearance-boundary\]\) \{\n {4}\[data-ui-slot="surface"\] \{\n {6}backdrop-filter: blur\(var\(--ui-backdrop-blur\)\);/,
  );
});
