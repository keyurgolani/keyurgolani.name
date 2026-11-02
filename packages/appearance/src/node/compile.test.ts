import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { anchorV1 } from '../derive';
import { LENGTH_KEYS } from '../language-grammar';
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
  MEASURE_SCALE_RANGE,
  namespacedStack,
  PACK_URL,
  packFile,
  preloadFace,
  scaledMeasure,
  schemeBaseSets,
  unicodeRanges,
  withoutRanges,
} from './compile';
import { mappedCodePoints } from './font-metrics';
import { minimalWoff2, SAMPLE_METRICS } from '../test-support/woff2';

// compilePack() (#19, Slice 2, items 1 and 4). Scheme stylesheets are checked
// by evaluating their cascade: for every scheme shape, display mode,
// data-contrast, and media state, the boundary and the document's root get
// exactly the set that combination renders, and outside print, the root's
// view-transition tree gets the set's every role (K-4 (a)).

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

/** The boundary, the document's root, or the root's ::view-transition pseudo-element. */
type Element = 'boundary' | 'root' | 'transition';

function selectorMatch(selector: string, element: Element, attributes: Attributes): number | null {
  const transition = /^:root:has\((.*)\)::view-transition$/.exec(selector);
  if (transition || element === 'transition') {
    if (!transition || element !== 'transition') return null;
    const inner = attributeMatch(transition[1]!, attributes);
    return inner === null ? null : inner + 2;
  }
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
  element: Element,
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
  // The root rules set only color-scheme and background-color, and the root's
  // view-transition rules (K-4 (a)) only the color roles.
  for (const rule of rules(css)) {
    if (rule.selectors.every((selector) => selector.endsWith('::view-transition'))) {
      assert.ok(
        rule.selectors.every((selector) =>
          selector.startsWith(':root:has([data-appearance-boundary="document"]'),
        ),
      );
      assert.ok(
        rule.media.every((prelude) => !prelude.includes('print')),
        'no print context',
      );
      assert.deepEqual(
        [...rule.declarations.keys()],
        COLOR_ROLES.map((role) => `--color-${role}`),
      );
    } else if (rule.selectors.some((selector) => selector.startsWith(':root'))) {
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
              // K-4 (a): the view-transition tree reads the boundary's colors on screen. No
              // page navigates in print, so its contexts write none.
              if (!print) {
                const transition = cascade(css, 'transition', attributes, env);
                for (const role of COLOR_ROLES)
                  assert.equal(
                    transition.get(`--color-${role}`),
                    set[role],
                    `${label}: transition ${role}`,
                  );
              }
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
  assert.equal(cascade(css, 'transition', plate, env).size, 0);
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

/** A pack directory with nothing in it, for a pack that reads no file. */
const EMPTY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-empty-pack-'));
test.after(() => fs.rmSync(EMPTY_DIR, { recursive: true, force: true }));

test('no pack ships JavaScript: a script file anywhere in its directory fails the compile (#20)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-script-pack-'));
  try {
    assert.ok(compilePack({ kind: 'color-scheme', manifest: WARM_PARCHMENT, dir }).ok);
    for (const file of [
      'enhance.js',
      'lib/ripple.mjs',
      'a.cjs',
      'b.ts',
      'c.tsx',
      'd.wasm',
      'e.html',
      'f.svg',
      'g.JS',
    ]) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), 'export {};\n');
    }
    // License text, notes, and data stay fine.
    fs.writeFileSync(path.join(dir, 'OFL.txt'), 'license\n');
    fs.writeFileSync(path.join(dir, 'README.md'), 'notes\n');
    const result = compilePack({ kind: 'color-scheme', manifest: WARM_PARCHMENT, dir });
    assert.ok(!result.ok);
    assert.deepEqual(
      result.problems.map(({ file, rule }) => [file, rule]),
      [
        ['a.cjs', 'javascript'],
        ['b.ts', 'javascript'],
        ['c.tsx', 'javascript'],
        ['d.wasm', 'javascript'],
        ['e.html', 'javascript'],
        ['enhance.js', 'javascript'],
        ['f.svg', 'javascript'],
        ['g.JS', 'javascript'],
        ['lib/ripple.mjs', 'javascript'],
      ],
    );
    assert.match(result.problems[0]!.message, /no pack ships JavaScript/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('compilePack names a stylesheet by its content and serves it from the pack directory', () => {
  const result = compilePack({ kind: 'color-scheme', manifest: WARM_PARCHMENT, dir: EMPTY_DIR });
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
    dir: EMPTY_DIR,
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
  const result = compilePack({ kind: 'color-scheme', manifest: SEED, dir: EMPTY_DIR });
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
  const woff2 = minimalWoff2();
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
    // The shipped family comes ahead of the declared fallbacks, its two fallback aliases right after it.
    assert.match(
      css,
      /--type-body-font-family: "acme-type Body Face", "acme-type Body Face Fallback 1", "acme-type Body Face Fallback 2", "Segoe UI", sans-serif;/,
    );
    // SAMPLE_METRICS is 500 wide per 520 x-height: Verdana fits it best per x-height (-1.99%),
    // and Arial best among the faces Windows and Linux have.
    assert.match(
      css,
      /\/\* Verdana at 400: width per x-height -1\.99%, width \+2\.79% before size-adjust\. \*\/\n {2}@font-face \{\n {4}font-family: "acme-type Body Face Fallback 1";\n {4}src: local\("Verdana"\);\n {4}font-weight: 400;\n {4}font-style: normal;\n {4}size-adjust: 97\.28%;\n {4}ascent-override: 92\.52%;\n {4}descent-override: 25\.70%;\n {4}line-gap-override: 5\.14%;\n {4}unicode-range: U\+0000-00FF;\n {2}\}/,
    );
    assert.match(
      css,
      /@font-face \{\n {4}font-family: "acme-type Body Face Fallback 2";\n {4}src: local\("Arial"\), local\("ArialMT"\), local\("Liberation Sans"\), local\("Arimo"\);\n {4}font-weight: 400;\n {4}font-style: normal;\n {4}size-adjust: 111\.86%;\n {4}ascent-override: 80\.45%;\n {4}descent-override: 22\.35%;\n {4}line-gap-override: 4\.47%;\n {4}unicode-range: U\+0000-00FF;\n {2}\}/,
    );
    // Its face covers 700 too, so bold text inside the body falls back to each alias's bold,
    // by its own names, sized by its own width: this static face is as wide at 700 as at 400.
    assert.match(
      css,
      /\/\* Verdana Bold at 700: [^*]+\*\/\n {2}@font-face \{\n {4}font-family: "acme-type Body Face Fallback 1";\n {4}src: local\("Verdana Bold"\), local\("Verdana-Bold"\);\n {4}font-weight: 700;\n {4}font-style: normal;\n {4}size-adjust: 86\.96%;/,
    );
    assert.match(
      css,
      /src: local\("Arial Bold"\), local\("Arial-BoldMT"\), local\("Liberation Sans Bold"\), local\("Arimo Bold"\);\n {4}font-weight: 700;/,
    );
    // Two aliases, each at 400 and 700.
    assert.equal(css.match(/Fallback [12]";/g)?.length, 4);
    // Its one face covers Latin at the body's weight, so it's the preload.
    assert.equal(result.pack.preload, assets[0]!.url);
    assert.match(
      css,
      /\[data-typography="acme-type"\] \{\n {4}--type-display-font-family: "Trebuchet MS", "acme-type Trebuchet MS Linux Fallback", "acme-type Trebuchet MS DejaVu Fallback", "Segoe UI", sans-serif;/,
    );
    // The measures are counts of characters, 68 and 52, at the body face's
    // measured width, 500 per 1000 (R11): never ch, a 0's width. Each is
    // times the composition's measure scale, and the face's aspect, its
    // x-height of 520 per 1000, is the profile's (R11.1).
    assert.match(
      css,
      /\/\* Measures: characters at Body Face's 0\.5000em average advance, times --layout-measure-scale, which a composition that applies font-size-adjust sets from --type-body-aspect, 0\.5200, held from 0\.5 to 2\. \*\/\n {2}\[data-typography="acme-type"\] \{\n[^}]*--type-measure-body: calc\(34em \* clamp\(0\.5, var\(--layout-measure-scale, 1\), 2\)\);\n {4}--type-measure-compact: calc\(26em \* clamp\(0\.5, var\(--layout-measure-scale, 1\), 2\)\);\n {4}--type-body-aspect: 0\.5200;\n/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("drafting-grotesk's Space Grotesk 600 falls back to Avenir Next Demi Bold, and its 700 to the Bold", () => {
  const dir = fileURLToPath(shippedDir('appearance-typography', 'drafting-grotesk'));
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'),
  ) as TypographyManifest;
  const result = compilePack({ kind: 'typography', manifest, dir });
  assert.ok(result.ok);
  const css = new TextDecoder().decode(result.pack.stylesheet!.bytes);
  const face = (name: string, weight: number) =>
    new RegExp(
      `/\\* ${name} at ${weight}: [^*]+\\*/\\n {2}@font-face \\{\\n {4}font-family: "drafting-grotesk Space Grotesk Fallback 1";\\n {4}src: local\\("([^"]+)"\\), local\\("([^"]+)"\\);\\n {4}font-weight: ${weight};`,
    )
      .exec(css)
      ?.slice(1);
  assert.deepEqual(face('Avenir Next Demi Bold', 600), [
    'Avenir Next Demi Bold',
    'AvenirNext-DemiBold',
  ]);
  assert.deepEqual(face('Avenir Next Bold', 700), ['Avenir Next Bold', 'AvenirNext-Bold']);
  // Elsewhere there's no semibold among the faces: Verdana's Bold stands under 600 too.
  assert.match(css, /\/\* Verdana Bold at 600: /);
});

test("console-mono's Inter 500 falls back to Helvetica Neue Medium, its 400 to the Regular, and its 700 to the Bold", () => {
  const dir = fileURLToPath(shippedDir('appearance-typography', 'console-mono'));
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'),
  ) as TypographyManifest;
  const result = compilePack({ kind: 'typography', manifest, dir });
  assert.ok(result.ok);
  const css = new TextDecoder().decode(result.pack.stylesheet!.bytes);
  const face = (weight: number) =>
    new RegExp(
      `/\\* ([^*]+?) at ${weight}: [^*]+\\*/\\n {2}@font-face \\{\\n {4}font-family: "console-mono Inter Fallback 1";\\n {4}src: ([^;]+);\\n {4}font-weight: ${weight};`,
    )
      .exec(css)
      ?.slice(1);
  assert.deepEqual(face(400), [
    'Helvetica Neue',
    'local("Helvetica Neue"), local("HelveticaNeue")',
  ]);
  assert.deepEqual(face(500), [
    'Helvetica Neue Medium',
    'local("Helvetica Neue Medium"), local("HelveticaNeue-Medium")',
  ]);
  assert.deepEqual(face(700), [
    'Helvetica Neue Bold',
    'local("Helvetica Neue Bold"), local("HelveticaNeue-Bold")',
  ]);
  // Elsewhere there's no medium among the faces: Arial's Regular stands under 500.
  assert.match(css, /\/\* Arial at 500: /);
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

test("a WOFF2 whose tables don't decode is a problem naming the file, not a face with made-up metrics", () => {
  const corrupt = minimalWoff2();
  for (let at = 60; at < corrupt.length; at += 1) corrupt[at] = corrupt[at]! ^ 0xff;
  const dir = packDir({ 'face.woff2': corrupt });
  try {
    const result = compilePack({
      kind: 'typography',
      manifest: {
        ...HUMANIST_UI,
        roles: {
          ...HUMANIST_UI.roles,
          body: { ...HUMANIST_UI.roles.body, 'font-family': 'Face, sans-serif' },
        },
        fontAssets: [
          {
            family: 'Face',
            file: './face.woff2',
            weight: 400,
            style: 'normal',
            unicodeRange: 'U+0000-00FF',
          },
        ],
      },
      dir,
    });
    assert.equal(result.ok, false);
    const [problem] = result.ok ? [] : result.problems;
    assert.equal(problem!.file, './face.woff2');
    assert.match(problem!.message, /^\.\/face\.woff2 can't be read for its metrics: /);
    assert.match(problem!.remedy, /pnpm catalog:fonts vendor/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the fixture font compiles to its face, its metric-matched fallback, and its stack', () => {
  const result = compilePack({
    kind: 'typography',
    manifest: FONT,
    dir: fileURLToPath(shippedDir('appearance-fixtures-typography', 'fixture-font')),
  });
  assert.ok(result.ok);
  const css = new TextDecoder().decode(result.pack.stylesheet!.bytes);
  const url = result.pack.assets[0]!.url;
  // Geist's latin subset: 1000 units per em, a frequency-weighted Latin width of 473.33 and
  // an x-height of 530, typo metrics 1005, -295, 0, laid out by its USE_TYPO_METRICS bit.
  // Per x-height, Helvetica Neue fits it best (-1.94%); Arial, measured the same way, best
  // among the faces Windows and Linux have (-3.49%), and its size-adjust, 105.90%, is within
  // 1.1% of capsize's 104.76% (font-metrics.test.ts). Each alias has a face at every weight
  // a role sets (400, 500, 650) and at 700, each sized to Geist's variable font at that
  // weight through its HVAR, the bold ones over the system face's bold, and the 500 over
  // Helvetica Neue's Medium where the first alias has it (Arial has none).
  const faces = css.slice(css.indexOf('@font-face'), css.indexOf('/* Measures'));
  // Its measures are Geist's characters, at its 473.33 per 1000 (R11), times the
  // composition's scale, with Geist's aspect, 530 per 1000 (R11.1).
  assert.match(
    css,
    /\/\* Measures: characters at Geist's 0\.4733em average advance, times --layout-measure-scale, which a composition that applies font-size-adjust sets from --type-body-aspect, 0\.5300, held from 0\.5 to 2\. \*\/\n {2}\[data-typography="fixture-font"\] \{\n[^}]*--type-measure-body: calc\(32\.19em \* clamp\(0\.5, var\(--layout-measure-scale, 1\), 2\)\);\n {4}--type-measure-compact: calc\(24\.61em \* clamp\(0\.5, var\(--layout-measure-scale, 1\), 2\)\);\n {4}--type-body-aspect: 0\.5300;\n/,
  );
  const range = FONT.fontAssets[0]!.unicodeRange;
  const HN = 'local("Helvetica Neue"), local("HelveticaNeue")';
  const HN_MEDIUM = 'local("Helvetica Neue Medium"), local("HelveticaNeue-Medium")';
  const HN_BOLD = 'local("Helvetica Neue Bold"), local("HelveticaNeue-Bold")';
  const ARIAL = 'local("Arial"), local("ArialMT"), local("Liberation Sans"), local("Arimo")';
  const ARIAL_BOLD =
    'local("Arial Bold"), local("Arial-BoldMT"), local("Liberation Sans Bold"), local("Arimo Bold")';
  assert.equal(
    faces,
    [
      '@font-face {',
      '    font-family: "fixture-font Geist";',
      `    src: url("${url}") format("woff2");`,
      '    font-weight: 100 900;',
      '    font-style: normal;',
      '    font-display: swap;',
      `    unicode-range: ${range};`,
      '  }',
      // [comment, alias, src, weight, size-adjust, ascent, descent]
      ...(
        [
          [
            'Helvetica Neue at 400: width per x-height -1.94%, width -4.35%',
            1,
            HN,
            400,
            '104.54',
            '96.13',
            '28.22',
          ],
          [
            'Helvetica Neue Medium at 500: width per x-height -0.79%, width -3.23%',
            1,
            HN_MEDIUM,
            500,
            '103.33',
            '97.26',
            '28.55',
          ],
          [
            'Helvetica Neue Bold at 650: width per x-height -0.83%, width -3.26%',
            1,
            HN_BOLD,
            650,
            '103.37',
            '97.23',
            '28.54',
          ],
          [
            'Helvetica Neue Bold at 700: width per x-height -1.89%, width -4.29%',
            1,
            HN_BOLD,
            700,
            '104.49',
            '96.18',
            '28.23',
          ],
          [
            'Arial at 400: width per x-height -3.49%, width -5.57%',
            2,
            ARIAL,
            400,
            '105.90',
            '94.90',
            '27.86',
          ],
          [
            'Arial at 500: width per x-height -5.65%, width -7.68%',
            2,
            ARIAL,
            500,
            '108.32',
            '92.78',
            '27.23',
          ],
          [
            'Arial Bold at 650: width per x-height -1.14%, width -3.28%',
            2,
            ARIAL_BOLD,
            650,
            '103.39',
            '97.21',
            '28.53',
          ],
          [
            'Arial Bold at 700: width per x-height -2.20%, width -4.31%',
            2,
            ARIAL_BOLD,
            700,
            '104.51',
            '96.16',
            '28.23',
          ],
        ] as const
      ).flatMap(([comment, alias, src, weight, size, ascent, descent]) => [
        `  /* ${comment} before size-adjust. */`,
        '  @font-face {',
        `    font-family: "fixture-font Geist Fallback ${alias}";`,
        `    src: ${src};`,
        `    font-weight: ${weight};`,
        '    font-style: normal;',
        `    size-adjust: ${size}%;`,
        `    ascent-override: ${ascent}%;`,
        `    descent-override: ${descent}%;`,
        '    line-gap-override: 0.00%;',
        `    unicode-range: ${range};`,
        '  }',
      ]),
      '  ',
    ].join('\n'),
  );
  for (const role of ['display', 'headline', 'title', 'body', 'body-compact', 'label']) {
    assert.match(
      css,
      new RegExp(
        `--type-${role}-font-family: "fixture-font Geist", "fixture-font Geist Fallback 1", "fixture-font Geist Fallback 2", "Segoe UI", sans-serif;`,
      ),
      role,
    );
  }
  // The code roles ship no font, so they get no fallback face either.
  assert.match(
    css,
    /--type-code-font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;/,
  );
  // The face, and two aliases at four weights each.
  assert.equal(css.match(/@font-face/g)!.length, 1 + 2 * 4);
  assert.equal(result.pack.preload, url);
});

test('an italic-only family falls back to the system italic, and a static face only at its own weight', () => {
  const dir = packDir({
    'italic.woff2': minimalWoff2(),
    'mono.woff2': minimalWoff2({ ...SAMPLE_METRICS, advance: 600 }),
  });
  try {
    const manifest: TypographyManifest = {
      ...HUMANIST_UI,
      id: 'acme-type',
      roles: {
        ...HUMANIST_UI.roles,
        quote: {
          ...HUMANIST_UI.roles.quote,
          'font-family': 'Aside, Georgia, serif',
          'font-weight': 400,
        },
        code: {
          ...HUMANIST_UI.roles.code,
          'font-family': 'Code Face, Menlo, monospace',
          'font-weight': 500,
        },
      },
      fontAssets: [
        {
          family: 'Aside',
          file: './italic.woff2',
          weight: 400,
          style: 'italic',
          unicodeRange: 'U+0000-00FF',
        },
        {
          family: 'Code Face',
          file: './mono.woff2',
          weight: 500,
          style: 'normal',
          unicodeRange: 'U+0000-00FF',
        },
      ],
    };
    const result = compilePack({ kind: 'typography', manifest, dir });
    assert.ok(result.ok, JSON.stringify(result.ok ? null : result.problems));
    const css = new TextDecoder().decode(result.pack.stylesheet!.bytes);
    // The italic family's faces are italic, over the system italic's own names.
    const aside = [
      ...css.matchAll(
        /@font-face \{\n {4}font-family: "acme-type Aside Fallback (\d)";\n {4}src: ([^;]+);\n {4}font-weight: ([\d ]+);\n {4}font-style: (\w+);/g,
      ),
    ];
    assert.ok(aside.length > 0);
    for (const [, , src, weight, style] of aside) {
      assert.equal(style, 'italic');
      // From its own 400 to 900, as its web face is: a bold sets in the real italic, never a faked one.
      assert.equal(weight, '400 900');
      assert.match(src!, /Italic/);
    }
    assert.match(css, /font-family: "acme-type Aside";\n[^}]*font-weight: 400 900;/);
    // A face at 400 only, with no 700: no separate bold face, for the face or the fallback.
    assert.doesNotMatch(css, /Aside Fallback \d";\n[^}]*font-weight: 700/);
    // The static mono face has a fallback at its own weight only.
    const code = [
      ...css.matchAll(
        /"acme-type Code Face Fallback \d";\n {4}src: [^;]+;\n {4}font-weight: (\d+);/g,
      ),
    ];
    assert.deepEqual([...new Set(code.map(([, weight]) => weight))], ['500']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a page preloads the body face alone: upright, at the body weight, in the Latin subset', () => {
  const face = (family: string, extra: Partial<TypographyManifest['fontAssets'][number]> = {}) => ({
    family,
    file: './face.woff2',
    weight: 400 as number | [number, number],
    style: 'normal' as const,
    unicodeRange: 'U+0000-00FF',
    ...extra,
  });
  const withBody = (
    stack: string,
    fontAssets: TypographyManifest['fontAssets'],
    weight = 400,
  ): TypographyManifest => ({
    ...HUMANIST_UI,
    roles: {
      ...HUMANIST_UI.roles,
      body: { ...HUMANIST_UI.roles.body, 'font-family': stack, 'font-weight': weight },
    },
    fontAssets,
  });
  const cyrillic = face('Text', { unicodeRange: 'U+0400-045F' });
  const italic = face('Text', { style: 'italic' });
  const bold = face('Text', { weight: 700 });
  const latin = face('Text', { file: './latin.woff2' });
  assert.equal(
    preloadFace(withBody('Text, serif', [cyrillic, italic, bold, latin]))?.file,
    './latin.woff2',
  );
  // A variable face covers the body's weight inside its range.
  const variable = face('Text', { weight: [300, 800], file: './variable.woff2' });
  assert.equal(preloadFace(withBody('Text, serif', [variable], 350))?.file, './variable.woff2');
  // No face at the body's weight, a display family the body doesn't use, or a system stack: none.
  assert.equal(preloadFace(withBody('Text, serif', [bold])), null);
  assert.equal(preloadFace(withBody('Georgia, serif', [face('Display')])), null);
  assert.equal(preloadFace(HUMANIST_UI), null);
  // The body's first shipped family is the one.
  assert.equal(
    preloadFace(withBody('Text, Other, serif', [face('Other', { file: './other.woff2' }), latin]))
      ?.file,
    './latin.woff2',
  );
});

test("a fallback face covers its family's ranges alone, a non-Latin family gets none, and a family can't take a fallback's name", () => {
  const dir = packDir({
    'latin.woff2': minimalWoff2(),
    'latin-ext.woff2': minimalWoff2(),
    'greek.woff2': minimalWoff2({ ...SAMPLE_METRICS, withoutZ: true }),
  });
  try {
    const face = (family: string, file: string, unicodeRange: string) => ({
      family,
      file,
      weight: 400,
      style: 'normal' as const,
      unicodeRange,
    });
    const manifest: TypographyManifest = {
      ...HUMANIST_UI,
      id: 'acme-type',
      roles: {
        ...HUMANIST_UI.roles,
        body: { ...HUMANIST_UI.roles.body, 'font-family': 'Text, Greek, sans-serif' },
      },
      fontAssets: [
        face('Text', './latin.woff2', 'U+0000-00FF, U+2000-206F'),
        face('Text', './latin-ext.woff2', 'U+0100-02AF, U+2000-206F'),
        face('Greek', './greek.woff2', 'U+0370-03FF'),
      ],
    };
    const result = compilePack({ kind: 'typography', manifest, dir });
    assert.ok(result.ok, JSON.stringify(result.ok ? null : result.problems));
    const css = new TextDecoder().decode(result.pack.stylesheet!.bytes);
    // Text's fallbacks cover Text's ranges, each once, so Greek text falls through to Greek.
    for (const alias of [1, 2]) {
      assert.match(
        css,
        new RegExp(
          `"acme-type Text Fallback ${alias}";[^}]*unicode-range: U\\+0000-00FF, U\\+2000-206F, U\\+0100-02AF;`,
        ),
      );
    }
    // Greek maps no Latin lowercase: no fallback sized by a guess.
    assert.doesNotMatch(css, /Greek Fallback/);
    assert.match(
      css,
      /--type-body-font-family: "acme-type Text", "acme-type Text Fallback 1", "acme-type Text Fallback 2", "acme-type Greek", sans-serif;/,
    );
    for (const [name, at] of [
      ['text Fallback 1', 3],
      ['Text fallback 2', 3],
    ] as const) {
      const clash = compilePack({
        kind: 'typography',
        manifest: {
          ...manifest,
          fontAssets: [...manifest.fontAssets, face(name, './latin.woff2', 'U+0000-00FF')],
        },
        dir,
      });
      assert.equal(clash.ok, false, name);
      const [problem] = clash.ok ? [] : clash.problems;
      assert.equal(problem!.pointer, `/fontAssets/${at}/family`);
      assert.match(problem!.message, /the name the compiler gives one of text's fallback faces/i);
    }
    // A family merely ending in "Fallback" is its own name.
    const plain = compilePack({
      kind: 'typography',
      manifest: {
        ...manifest,
        fontAssets: [...manifest.fontAssets, face('Text Fallback', './latin.woff2', 'U+0000-00FF')],
      },
      dir,
    });
    assert.ok(plain.ok, JSON.stringify(plain.ok ? null : plain.problems));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a face's declared range is held to its cmap over Basic Latin (review R2-M1)", () => {
  const dir = packDir({
    'caps.woff2': minimalWoff2({ ...SAMPLE_METRICS, maps: ' ABCDEFGHIJKLMNOPQRSTUVWXYZ' }),
  });
  try {
    const compile = (unicodeRange: string) =>
      compilePack({
        kind: 'typography',
        manifest: {
          ...HUMANIST_UI,
          roles: {
            ...HUMANIST_UI.roles,
            display: { ...HUMANIST_UI.roles.display, 'font-family': 'Caps, sans-serif' },
          },
          fontAssets: [
            { family: 'Caps', file: './caps.woff2', weight: 700, style: 'normal', unicodeRange },
          ],
        },
        dir,
      });
    // The space and the capitals, which it maps: it compiles, with no fallback, since it maps no a to z.
    const honest = compile('U+0020, U+0041-005A');
    assert.ok(honest.ok, JSON.stringify(honest.ok ? null : honest.problems));
    assert.doesNotMatch(new TextDecoder().decode(honest.pack.stylesheet!.bytes), /Caps Fallback/);
    // Code points past Basic Latin aren't held to it: a subset's range may name controls it doesn't map.
    assert.ok(compile('U+0000-001F, U+0020, U+0041-005A, U+00C0-00DE').ok);
    // Claiming the digits and lowercase it has no glyphs for fails, naming the first of them.
    const claims = compile('U+0020-007E');
    assert.equal(claims.ok, false);
    const [problem] = claims.ok ? [] : claims.problems;
    assert.equal(problem!.pointer, '/fontAssets/0/unicodeRange');
    // Its own package's range may be the one that claims too much (review R3-L2).
    assert.match(problem!.remedy, /narrow the range to the code points the file maps/);
    assert.match(
      problem!.message,
      /declares \.\/caps\.woff2 covers 68 Basic Latin code point\(s\) its cmap doesn't map: U\+0021, U\+0022, U\+0023, .*, \.\.\.\./,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a system-font profile compiles with no preload, and its leading family gets the Linux metric fallbacks right behind it', () => {
  const result = compilePack({ kind: 'typography', manifest: HUMANIST_UI, dir: EMPTY_DIR });
  assert.ok(result.ok);
  assert.equal(result.pack.preload, undefined);
  const css = new TextDecoder().decode(result.pack.stylesheet!.bytes);
  // No webfont: every face is a local() fallback.
  assert.doesNotMatch(css, /url\(/);
  const trebuchet =
    'U\\+0020-007E, U\\+00A0-00FF, U\\+2010, U\\+2013-2014, U\\+2018-2019, U\\+201C-201D, U\\+2022, U\\+2026, U\\+20AC, U\\+2122';
  const face = (family: string, src: string, weight: number, style: string, size: string) =>
    new RegExp(
      `@font-face \\{\\n {4}font-family: "humanist-ui Trebuchet MS ${family}";\\n {4}src: ${src};\\n {4}font-weight: ${weight};\\n {4}font-style: ${style};\\n {4}size-adjust: ${size};\\n {4}ascent-override: [\\d.]+%;\\n {4}descent-override: [\\d.]+%;\\n {4}line-gap-override: 0\\.00%;\\n {4}unicode-range: ${trebuchet};\\n {2}\\}`,
    );
  // Liberation Sans first, by its Arial-metric names, sized to Trebuchet MS face by face.
  assert.match(
    css,
    face(
      'Linux Fallback',
      'local\\("Liberation Sans"\\), local\\("Arimo"\\), local\\("Arial"\\), local\\("ArialMT"\\)',
      400,
      'normal',
      '102\\.67%',
    ),
  );
  assert.match(
    css,
    /size-adjust: 102\.67%;\n {4}ascent-override: 91\.46%;\n {4}descent-override: 21\.64%;/,
  );
  assert.match(
    css,
    face('Linux Fallback', 'local\\("Liberation Sans Bold"\\)[^;]*', 700, 'normal', '99\\.01%'),
  );
  assert.match(
    css,
    face('Linux Fallback', 'local\\("Liberation Sans Italic"\\)[^;]*', 400, 'italic', '103\\.79%'),
  );
  assert.match(
    css,
    face(
      'Linux Fallback',
      'local\\("Liberation Sans Bold Italic"\\)[^;]*',
      700,
      'italic',
      '100\\.63%',
    ),
  );
  // Then DejaVu Sans, its own face.
  assert.match(
    css,
    face(
      'DejaVu Fallback',
      'local\\("DejaVu Sans"\\), local\\("DejaVuSans"\\)',
      400,
      'normal',
      '89\\.43%',
    ),
  );
  assert.match(
    css,
    face('DejaVu Fallback', 'local\\("DejaVu Sans Bold"\\)[^;]*', 700, 'normal', '82\\.66%'),
  );
  assert.equal(css.match(/@font-face/g)!.length, 8);
  // Right behind Trebuchet MS, ahead of Segoe UI and the generic; the mono stack, which leads with none, as declared.
  assert.match(
    css,
    /--type-body-font-family: "Trebuchet MS", "humanist-ui Trebuchet MS Linux Fallback", "humanist-ui Trebuchet MS DejaVu Fallback", "Segoe UI", sans-serif;/,
  );
  assert.match(
    css,
    /--type-code-font-family: "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace;/,
  );
});

test('accessible-reading gets the Linux metric fallbacks sized to Verdana, without the U+2010 Verdana lacks, ahead of Tahoma', () => {
  const dir = fileURLToPath(shippedDir('appearance-typography', 'accessible-reading'));
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'),
  ) as TypographyManifest;
  const result = compilePack({ kind: 'typography', manifest, dir });
  assert.ok(result.ok);
  const css = new TextDecoder().decode(result.pack.stylesheet!.bytes);
  const sizes = [
    ...css.matchAll(
      /font-family: "accessible-reading Verdana ([^"]+)";[^}]*?font-weight: (\d+);\s*font-style: (\w+);\s*size-adjust: ([\d.]+%);/g,
    ),
  ].map(([, family, weight, style, size]) => `${family} ${weight} ${style} ${size}`);
  assert.deepEqual(sizes, [
    'Linux Fallback 400 normal 114.99%',
    'Linux Fallback 700 normal 118.78%',
    'Linux Fallback 400 italic 114.98%',
    'Linux Fallback 700 italic 118.77%',
    'DejaVu Fallback 400 normal 100.17%',
    'DejaVu Fallback 700 normal 99.17%',
    'DejaVu Fallback 400 italic 100.16%',
    'DejaVu Fallback 700 italic 99.16%',
  ]);
  assert.match(css, /unicode-range: U\+0020-007E, U\+00A0-00FF, U\+2013-2014,/);
  assert.doesNotMatch(css, /U\+2010/);
  assert.match(
    css,
    /--type-display-font-family: Verdana, "accessible-reading Verdana Linux Fallback", "accessible-reading Verdana DejaVu Fallback", Tahoma, "Segoe UI", sans-serif;/,
  );
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
  // Each shipped family is followed by its fallback aliases, as many as it has.
  assert.equal(
    namespacedStack(
      'Inter, Noto, sans-serif',
      'acme',
      ['Inter', 'Noto'],
      new Map([
        ['Inter', 2],
        ['Noto', 1],
      ]),
    ),
    '"acme Inter", "acme Inter Fallback 1", "acme Inter Fallback 2", "acme Noto", "acme Noto Fallback 1", sans-serif',
  );
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
    // K-4 (a): the motion tokens, and only they, on a document root's view-transition tree.
    const transition = rules(css).find((rule) =>
      rule.selectors.every((selector) => selector.endsWith('::view-transition')),
    );
    assert.deepEqual(transition?.selectors, [
      ':root:has([data-appearance-boundary="document"][data-design-language="acme-lang"])::view-transition',
    ]);
    const motion = LANGUAGE_KEYS.filter((key) => key.startsWith('motion-'));
    assert.ok(motion.includes('motion-fast') && motion.includes('motion-easing'));
    assert.deepEqual(
      [...transition!.declarations],
      motion.map((key) => [`--ui-${key}`, PLATFORM_NEUTRAL.tokens[key]]),
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

test("a family's italic falls back to the system italic that fits the italic, not its upright's pick", () => {
  // field-serif's Fraunces files as one family, 600 upright and 400 italic
  // (the pack itself names its italic "Fraunces Italic"). The upright fits
  // Palatino best; Palatino's italic runs narrow per x-height against
  // Fraunces' (-11.47%), and Times New Roman's italic fits it (-1.38%).
  const dir = fileURLToPath(shippedDir('appearance-typography', 'field-serif'));
  const shipped = JSON.parse(
    fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'),
  ) as TypographyManifest;
  const oneFamily = (value: string) => value.replace('"Fraunces Italic"', '"Fraunces"');
  const manifest: TypographyManifest = {
    ...shipped,
    roles: Object.fromEntries(
      Object.entries(shipped.roles).map(([role, settings]) => [
        role,
        { ...settings, 'font-family': oneFamily(String(settings['font-family'])) },
      ]),
    ) as TypographyManifest['roles'],
    fontAssets: shipped.fontAssets.map((asset) => ({
      ...asset,
      family: asset.family === 'Fraunces Italic' ? 'Fraunces' : asset.family,
    })),
  };
  assert.ok(
    manifest.fontAssets.some((asset) => asset.family === 'Fraunces' && asset.style === 'italic'),
  );
  const result = compilePack({ kind: 'typography', manifest, dir });
  assert.ok(result.ok);
  const css = new TextDecoder().decode(result.pack.stylesheet!.bytes);
  const faces = [
    ...css.matchAll(
      /\/\* (.+?) at (\d+): width per x-height ([-+]\d+\.\d+%)[^*]*\*\/\s*@font-face \{\s*font-family: "field-serif Fraunces (Fallback \d)";\s*src: ([^;]+);[\s\S]*?font-style: (\w+);/g,
    ),
  ].map(([, name, weight, error, alias, src, style]) => ({
    alias,
    style,
    weight: Number(weight),
    name,
    error,
    src,
  }));
  const at = (alias: string, style: string) =>
    faces.filter((face) => face.alias === alias && face.style === style);
  assert.deepEqual(
    at('Fallback 1', 'normal').map(({ name, weight }) => [name, weight]),
    [['Palatino Bold', 600]],
  );
  assert.deepEqual(
    at('Fallback 1', 'italic').map(({ name, weight, error }) => [name, weight, error]),
    [['Times New Roman Italic', 400, '-1.38%']],
  );
  // The second alias takes the italic's Windows and Linux names, never Palatino's.
  const [second] = at('Fallback 2', 'italic');
  assert.equal(second?.name, 'Times New Roman Italic');
  assert.doesNotMatch(second?.src ?? '', /Palatino|Pagella/);
  assert.doesNotMatch(css, /Palatino Italic/);
});

test("an italic-only family's faces and fallbacks take every weight from their own to 900, so its bold is never faked, and every other face keeps its weight, so its bold synthesizes as before", () => {
  const packs = fileURLToPath(new URL('../../../appearance-typography/packs/', import.meta.url));
  const ranged: string[] = [];
  for (const id of fs.readdirSync(packs).sort()) {
    const dir = path.join(packs, id);
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) continue;
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'),
    ) as TypographyManifest;
    const result = compilePack({ kind: 'typography', manifest, dir });
    assert.ok(result.ok, id);
    const css = new TextDecoder().decode(result.pack.stylesheet!.bytes);
    // No profile turns synthesis off: a bold in a family with no bold face still synthesizes.
    assert.doesNotMatch(css, /font-synthesis/, id);
    const italicOnly = new Set(
      manifest.fontAssets
        .map((asset) => asset.family)
        .filter((family) =>
          manifest.fontAssets
            .filter((asset) => asset.family === family)
            .every((asset) => asset.style === 'italic'),
        ),
    );
    for (const [, family, weight] of css.matchAll(
      /@font-face \{\s*font-family: "([^"]+)";\s*src: [^;]+;\s*font-weight: ([^;]+);/g,
    )) {
      // A leading system family's Linux metric fallbacks: 400 and 700 alone, as its own faces are.
      if (/ (Linux|DejaVu) Fallback$/.test(family!)) {
        assert.match(weight!, /^(400|700)$/, `${id}: ${family}`);
        continue;
      }
      const own = family!.slice(id.length + 1).replace(/ Fallback \d$/, '');
      const declared = manifest.fontAssets.find((asset) => asset.family === own)!;
      if (italicOnly.has(own)) {
        assert.equal(weight, `${String(declared.weight)} 900`, `${id}: ${family}`);
        ranged.push(`${id}: ${family}`);
      } else {
        // Its own weight or range, as declared, or a fallback's one weight.
        const own = Array.isArray(declared.weight)
          ? declared.weight.join(' ')
          : String(declared.weight);
        assert.ok(
          manifest.fontAssets.some(
            (asset) =>
              asset.family === declared.family &&
              (Array.isArray(asset.weight) ? asset.weight.join(' ') : String(asset.weight)) ===
                weight,
          ) || /^\d+$/.test(weight!),
          `${id}: ${family} at ${weight}, not ${own}`,
        );
      }
    }
  }
  // Exactly field-serif's Fraunces Italic and swiss-grotesque's Newsreader, web faces and aliases.
  assert.deepEqual(
    [...new Set(ranged)],
    [
      'field-serif: field-serif Fraunces Italic',
      'field-serif: field-serif Fraunces Italic Fallback 1',
      'field-serif: field-serif Fraunces Italic Fallback 2',
      'swiss-grotesque: swiss-grotesque Newsreader',
      'swiss-grotesque: swiss-grotesque Newsreader Fallback 1',
      'swiss-grotesque: swiss-grotesque Newsreader Fallback 2',
    ],
  );
  // swiss-grotesque's Plex Mono keeps its 500, so a bold caption title over it is synthesized, as in drafting-grotesk.
  const swiss = path.join(packs, 'swiss-grotesque');
  const compiled = compilePack({
    kind: 'typography',
    manifest: JSON.parse(fs.readFileSync(path.join(swiss, 'manifest.json'), 'utf8')),
    dir: swiss,
  });
  assert.ok(compiled.ok);
  assert.match(
    new TextDecoder().decode(compiled.pack.stylesheet!.bytes),
    /font-family: "swiss-grotesque IBM Plex Mono";\s*src: url\([^)]+\) format\("woff2"\);\s*font-weight: 500;/,
  );
});

test("every pack writes each family, weight, and style's Latin face after its other subsets, and a code point they share stays on the one whose file draws it, the Latin face first (L-1)", () => {
  const packs = fileURLToPath(new URL('../../../appearance-typography/packs/', import.meta.url));
  const covers = (range: string, point: number) =>
    unicodeRanges(range).some(([from, to]) => from <= point && point <= to);
  const counts = { dagger: 0, macron: 0 };
  for (const id of fs.readdirSync(packs).sort()) {
    const dir = path.join(packs, id);
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) continue;
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'),
    ) as TypographyManifest;
    const result = compilePack({ kind: 'typography', manifest, dir });
    assert.ok(result.ok, id);
    const css = new TextDecoder().decode(result.pack.stylesheet!.bytes);
    // Each shipped face, in the order the stylesheet declares them, with the file it loads.
    const byUrl = new Map(
      manifest.fontAssets.map((asset) => {
        const bytes = fs.readFileSync(path.join(dir, asset.file));
        return [packFile(id, 'woff2', new Uint8Array(bytes)).url, { asset, bytes }] as const;
      }),
    );
    const faces = [
      ...css.matchAll(
        /@font-face \{\s*font-family: "([^"]+)";\s*src: url\("([^"]+)"\) format\("woff2"\);\s*font-weight: ([^;]+);\s*font-style: (\w+);\s*font-display: swap;\s*unicode-range: ([^;]+);/g,
      ),
    ].map(([, family, url, weight, style, range]) => ({
      key: `${family} ${weight} ${style}`,
      range: range!,
      ...byUrl.get(url!)!,
    }));
    assert.equal(faces.length, manifest.fontAssets.length, id);
    for (const key of new Set(faces.map((face) => face.key))) {
      const group = faces.filter((face) => face.key === key);
      const latin = group.findIndex((face) => covers(face.asset.unicodeRange, 0x61));
      if (latin >= 0)
        assert.equal(latin, group.length - 1, `${id}: ${key}'s Latin face isn't last`);
      // Every code point two of its faces declare.
      const shared = new Set<number>();
      group.forEach((a, i) => {
        for (const b of group.slice(i + 1)) {
          for (const [from, to] of unicodeRanges(a.asset.unicodeRange)) {
            for (let point = from; point <= to; point += 1) {
              if (covers(b.asset.unicodeRange, point)) shared.add(point);
            }
          }
        }
      });
      const points = [...shared];
      const maps = group.map((face) => mappedCodePoints(new Uint8Array(face.bytes), points));
      for (const point of points) {
        const holders = group.filter((face) => covers(face.range, point));
        const drawing = group.filter((_, i) => maps[i]!.has(point));
        if (drawing.length === 0) {
          // No file has it: no face takes it, and it falls through to the stack.
          assert.deepEqual(holders, [], `${id}: ${key} U+${point.toString(16)}`);
          continue;
        }
        // One face takes it, and that face's file draws it: the Latin face when it does.
        assert.equal(holders.length, 1, `${id}: ${key} U+${point.toString(16)}`);
        assert.ok(drawing.includes(holders[0]!), `${id}: ${key} U+${point.toString(16)}`);
        if (latin >= 0 && drawing.includes(group[latin]!)) {
          assert.equal(holders[0], group[latin], `${id}: ${key} U+${point.toString(16)}`);
        }
      }
      // Fontsource's: the dagger is the latin-ext file's, which has it, and the macron the Latin file's.
      if (latin >= 0 && shared.has(0x2020) && !maps[latin]!.has(0x2020)) {
        assert.ok(!covers(group[latin]!.range, 0x2020), `${id}: ${key}`);
        counts.dagger += 1;
      }
      if (latin >= 0 && shared.has(0x0304) && maps[latin]!.has(0x0304)) {
        assert.ok(covers(group[latin]!.range, 0x0304), `${id}: ${key}`);
        counts.macron += 1;
      }
    }
  }
  // Archivo, Space Grotesk, Fraunces (600 and 400 italic), Inter, Newsreader, and JetBrains Mono, at least.
  assert.ok(counts.dagger >= 10, `${counts.dagger} Latin faces leave the dagger to latin-ext`);
  assert.ok(counts.macron >= 10, `${counts.macron} Latin faces keep the macron`);
});

test('a measure is held to its scale from 0.5 to 2, so a scale of 0 or 100 never collapses or blows out a column', () => {
  assert.equal(
    scaledMeasure('31.21em'),
    'calc(31.21em * clamp(0.5, var(--layout-measure-scale, 1), 2))',
  );
  assert.deepEqual(MEASURE_SCALE_RANGE, { min: 0.5, max: 2 });
  // The range covers every scale the R11.1 formula gives: 0.45 to 0.56 over aspects from 0.42 to 0.6.
  for (const adjust of [0.45, 0.5, 0.56]) {
    for (const aspect of [0.42, 0.5, 0.6]) {
      const scale = adjust / aspect;
      assert.ok(scale >= MEASURE_SCALE_RANGE.min && scale <= MEASURE_SCALE_RANGE.max, `${scale}`);
    }
  }
});

test('withoutRanges takes code points out of a unicode-range and keeps the rest', () => {
  assert.equal(
    withoutRanges('U+0100-02BA, U+0304, U+2020, U+20A0-20AB', ['U+0000-00FF, U+0304, U+2000-206F']),
    'U+0100-02BA, U+20A0-20AB',
  );
  assert.equal(withoutRanges('U+0041-005A', ['U+0045-0047']), 'U+0041-0044, U+0048-005A');
  assert.equal(withoutRanges('U+0041', ['U+0000-00FF']), null);
  assert.equal(withoutRanges('U+0100-017F', []), 'U+0100-017F');
});

test("a one-length language token's bare 0 compiles to 0px, so it stays valid inside calc() (#11)", () => {
  const css = (tokens: Partial<DesignLanguageManifest['tokens']>) => {
    const manifest = { ...PLATFORM_NEUTRAL, tokens: { ...PLATFORM_NEUTRAL.tokens, ...tokens } };
    const result = compilePack({ kind: 'design-language', manifest, dir: EMPTY_DIR });
    assert.ok(result.ok);
    return new TextDecoder().decode(result.pack.stylesheet!.bytes);
  };
  // calc(2px + 0) is invalid CSS, which would drop the field gap's whole max().
  assert.match(css({ 'focus-offset': '0' }), /\n {4}--ui-focus-offset: 0px;\n/);
  assert.match(css({ 'space-control-block': '0' }), /\n {4}--ui-space-control-block: 0px;\n/);
  for (const key of LENGTH_KEYS) {
    if (key === 'focus-width') continue; // Never 0: a focus ring always draws.
    assert.match(css({ [key]: '0' }), new RegExp(`\\n {4}--ui-${key}: 0px;\\n`), key);
  }
  // A length that has its unit, and every other key, is written as the manifest gives it.
  assert.match(css({ 'focus-offset': '2px' }), /\n {4}--ui-focus-offset: 2px;\n/);
  assert.match(css({ 'radius-control': '0' }), /\n {4}--ui-radius-control: 0;\n/);
  assert.ok(LENGTH_KEYS.has('focus-offset') && LENGTH_KEYS.has('space-control-block'));
  assert.ok(!LENGTH_KEYS.has('radius-control') && !LENGTH_KEYS.has('surface-opacity'));
});
