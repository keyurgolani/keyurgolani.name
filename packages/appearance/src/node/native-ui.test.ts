import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { anchorV1 } from '../derive';
import { schemeSets } from '../sets';
import { WARM_PARCHMENT } from '../test-support/packs';
import { compileSchemeStylesheet } from './compile';
import { platformStylesheet } from './platform';

// The browser's own UI inside a boundary takes the scheme, from one shared layer: the platform
// stylesheet with the primitives' rules in it. Every native control a first-party composition, the
// primitives or the visitor's Appearance control renders is one this layer themes, so a control
// added without its theming fails here, by name.

const css = platformStylesheet();
const root = fileURLToPath(new URL('../../../../', import.meta.url));

/** Every block's declarations whose selector list is exactly `selectors`, merged, in the layer named. */
function rule(selectors: string, layer: string): Map<string, string> {
  const start = css.indexOf(`@layer ${layer} {`);
  assert.ok(start >= 0, `no ${layer} layer`);
  const next = css.indexOf('\n@layer ', start + 1);
  const scope = css.slice(start, next < 0 ? undefined : next);
  const found = new Map<string, string>();
  for (
    let at = scope.indexOf(`\n${selectors} {\n`);
    at >= 0;
    at = scope.indexOf(`\n${selectors} {\n`, at + 1)
  ) {
    const body = scope.slice(at + selectors.length + 4, scope.indexOf('}', at));
    for (const line of body.split('\n')) {
      const match = /^\s*([a-z0-9-]+): (.*);$/.exec(line);
      if (match) found.set(match[1]!, match[2]!);
    }
  }
  return found;
}

/** What themes each kind of native control, read from the shared layer. */
const THEMED: Readonly<Record<string, () => void>> = {
  // Text the visitor types: the caret in the accent's text color, a placeholder in text-muted, and
  // the browser's autofill wash replaced by the control's own surface and text.
  text: () => {
    assert.equal(
      rule('  [data-appearance-boundary]', 'reset').get('caret-color'),
      'var(--color-accent-text)',
    );
    assert.equal(
      rule('  [data-appearance-boundary] ::placeholder', 'reset').get('color'),
      'var(--color-text-muted)',
    );
    const autofill = rule('  [data-appearance-boundary] :autofill', 'reset');
    assert.equal(autofill.get('-webkit-text-fill-color'), 'var(--color-text-primary)');
    assert.equal(autofill.get('box-shadow'), 'inset 0 0 0 100vmax var(--color-surface-subtle)');
  },
  // Checkbox, radio, range, progress and meter take the accent.
  accent: () => {
    assert.equal(
      rule('  [data-appearance-boundary]', 'reset').get('accent-color'),
      'var(--color-accent)',
    );
  },
  // A select's list, and a number field's steppers, are drawn by the browser in the scheme's
  // color-scheme, which the scheme compile writes on the boundary and the root.
  scheme: () => {
    const scheme = compileSchemeStylesheet(
      'warm-parchment',
      schemeSets({
        light: anchorV1(WARM_PARCHMENT.anchors!.light!, 'light'),
        dark: anchorV1(WARM_PARCHMENT.anchors!.dark!, 'dark'),
      }),
    );
    assert.match(scheme, /\[data-display-mode="dark"\] \{\n {4}color-scheme: dark;/);
    assert.match(scheme, /\[data-display-mode="dark"\]\) \{\n {4}color-scheme: dark;/);
  },
  // A dialog's backdrop is the scheme's scrim, under any composition's own.
  dialog: () => {
    assert.equal(
      rule('  [data-appearance-boundary] :where(dialog)::backdrop', 'reset').get(
        'background-color',
      ),
      'color-mix(in srgb, var(--color-scrim) 62%, transparent)',
    );
  },
  // A disclosure's marker is its text's color: nothing of the browser's own.
  disclosure: () => {
    assert.equal(
      rule('  [data-appearance-boundary]', 'reset').get('color'),
      'var(--color-text-primary)',
    );
  },
};

/** The kind each native element or input type is themed as. A hidden input draws nothing. */
const KINDS: Readonly<Record<string, keyof typeof THEMED | null>> = {
  'input[text]': 'text',
  'input[email]': 'text',
  'input[url]': 'text',
  'input[search]': 'text',
  'input[tel]': 'text',
  'input[password]': 'text',
  'input[number]': 'scheme',
  'input[checkbox]': 'accent',
  'input[radio]': 'accent',
  'input[range]': 'accent',
  'input[hidden]': null,
  textarea: 'text',
  select: 'scheme',
  progress: 'accent',
  meter: 'accent',
  dialog: 'dialog',
  details: 'disclosure',
  summary: 'disclosure',
};

/** The text field primitive's types, from its props, for its `type={type}`. */
function fieldTypes(): string[] {
  const source = readFileSync(
    path.join(root, 'packages/appearance/src/primitives/form-markup.tsx'),
    'utf8',
  );
  const union = /readonly type\?: ([^;]+);/.exec(source);
  assert.ok(union, "the text field's type union");
  return [...union[1]!.matchAll(/'([a-z]+)'/g)].map((match) => match[1]!);
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory())
      return name === 'node_modules' || name === '__tests__' ? [] : sources(file);
    return name.endsWith('.tsx') && !name.includes('.test.') ? [file] : [];
  });
}

/** Every native control a first-party composition, the primitives or the platform's React renders. */
function renderedControls(): Map<string, string[]> {
  const dirs = [
    ...readdirSync(path.join(root, 'packages'))
      .filter((name) => name.startsWith('variant-') && name !== 'variant-contract')
      .map((name) => path.join(root, 'packages', name, 'src')),
    path.join(root, 'packages/appearance/src'),
    path.join(root, 'packages/kit/src'),
  ];
  const found = new Map<string, string[]>();
  const add = (kind: string, file: string) =>
    found.set(kind, [...(found.get(kind) ?? []), path.relative(root, file)]);
  for (const file of dirs.flatMap(sources)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(
      /<(select|textarea|progress|meter|dialog|details|summary|input)\b([^>]*)/g,
    )) {
      const [, tag, attributes] = match;
      if (tag !== 'input') {
        add(tag!, file);
        continue;
      }
      const literal = /\btype=(?:\{\s*)?['"]([a-z-]+)['"]/.exec(attributes!);
      if (literal) add(`input[${literal[1]}]`, file);
      else if (/\btype=\{type\}/.test(attributes!))
        for (const type of fieldTypes()) add(`input[${type}]`, file);
      else add('input[text]', file);
    }
  }
  return found;
}

test('every native control a composition, the primitives or the Appearance control renders is a kind the shared layer themes', () => {
  const controls = renderedControls();
  assert.ok(controls.size >= 6, [...controls.keys()].join(', '));
  for (const [kind, files] of controls) {
    assert.ok(
      kind in KINDS,
      `${kind} (${files[0]}) is a native control the shared layer doesn't theme: give it the scheme there, and its kind here`,
    );
  }
});

for (const [kind, check] of Object.entries(THEMED)) {
  test(`the shared layer themes the ${kind} kind of native control from the tokens`, () => {
    check();
  });
}

test("a tap's highlight is the accent, faint, not the browser's grey", () => {
  assert.equal(
    rule('  [data-appearance-boundary]', 'reset').get('-webkit-tap-highlight-color'),
    'color-mix(in srgb, var(--color-accent) 20%, transparent)',
  );
});
