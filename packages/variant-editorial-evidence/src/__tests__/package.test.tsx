import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { contrast, LAYER_ORDER, PLATFORM_DEFAULTS, schemeSets } from '@portfolio/appearance';
import { schemeBaseSets } from '@portfolio/appearance/node';
import { validateManifest } from '@portfolio/variant-contract';
import { auditVariant, compileVariantStylesheet } from '@portfolio/variant-contract/node';
import { count, MANIFEST, PACKAGE, PACKAGE_DIR, RAW_MANIFEST, REPO_ROOT } from './harness';

// The package itself (#13): a manifest that validates clean and keeps the
// catalog's pins, budgets inside the light tier's ceilings, sources and a
// stylesheet the variant audit passes, no motion anywhere, and the host
// registering it as the platform default (#13, PR 2).

test('its manifest validates with nothing to report, and keeps the catalog pins', () => {
  const result = validateManifest(RAW_MANIFEST, {
    packageName: PACKAGE.name,
    exports: PACKAGE.exports,
  });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, []);
  assert.equal(MANIFEST.id, 'editorial-evidence');
  assert.deepEqual(
    [MANIFEST.compositionFamily, MANIFEST.motionIntent, MANIFEST.performanceTier],
    ['monograph', 'still', 'light'],
  );
  assert.deepEqual(MANIFEST.enhancements ?? [], []);
  assert.deepEqual(PACKAGE.portfolio, { kind: 'variant', manifest: './manifest.json' });
  assert.equal(PACKAGE.scripts.test, "tsx --test 'src/**/*.test.tsx'");
});

test('it declares all six budgets, each inside the light tier ceiling', () => {
  const ceilings = JSON.parse(readFileSync(path.join(REPO_ROOT, 'runtime-budgets.json'), 'utf8'))
    .budgets.tiers.light as Record<string, number>;
  const declared = RAW_MANIFEST.budgets as Record<string, number>;
  assert.deepEqual(Object.keys(declared).sort(), Object.keys(ceilings).sort());
  for (const [kind, value] of Object.entries(declared)) {
    assert.ok(
      value <= ceilings[kind]!,
      `${kind}: ${value} over the light ceiling ${ceilings[kind]}`,
    );
  }
  // Nothing animates while idle, and no enhancement loads.
  assert.equal(declared.animation, 0);
  assert.equal(declared.enhancement, 0);
});

test('the variant source audit finds nothing in its code or its stylesheet', () => {
  const findings = auditVariant({
    packageName: PACKAGE.name,
    dir: PACKAGE_DIR,
    id: MANIFEST.id,
    rtl: MANIFEST.textDirection.includes('rtl'),
  });
  assert.deepEqual(findings, []);
});

test('its stylesheet compiles as the host compiles it, inside its CSS budget', () => {
  const kit = path.join(REPO_ROOT, 'packages', 'kit');
  const compiled = compileVariantStylesheet({
    id: MANIFEST.id,
    layerOrder: LAYER_ORDER,
    layer: 'variant-layout',
    source: { dir: PACKAGE_DIR, file: path.join(PACKAGE_DIR, 'src', 'styles.css') },
    shared: [{ dir: kit, file: path.join(kit, 'src', 'sections', 'styles.css') }],
  });
  assert.ok(compiled.ok, JSON.stringify(compiled.ok ? [] : compiled.problems));
  assert.deepEqual(compiled.assets, []);
  const css = Buffer.from(compiled.stylesheet.bytes);
  assert.match(css.toString('utf8'), /@layer variant-layout/);
  // What check:budgets measures: the compiled file, gzipped at level 9 (codegen.ts), the kit's layout included.
  const gzip = gzipSync(css, { level: 9 }).length;
  assert.ok(
    gzip <= RAW_MANIFEST.budgets.css,
    `${gzip} B gzipped, over ${RAW_MANIFEST.budgets.css}`,
  );
});

/** The package's own source and style files, tests and fixtures aside. */
function ownFiles(): { file: string; text: string }[] {
  const dir = path.join(PACKAGE_DIR, 'src');
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.(?:tsx?|css)$/.test(name) && !/__tests__|__fixtures__/.test(name))
    .map((name) => ({ file: name, text: readFileSync(path.join(dir, name), 'utf8') }));
}

const css = () => readFileSync(path.join(PACKAGE_DIR, 'src', 'styles.css'), 'utf8');

/** The body of the first `@media <query> {` block, to its closing brace at column 0. */
const block = (text: string, query: string) => {
  const start = text.indexOf(`@media ${query} {`);
  assert.ok(start >= 0, query);
  const end = text.indexOf('\n}\n', start);
  return text.slice(start, end);
};

test('the client modules are the scroll-spy and the sheet control, and nothing runs a frame loop or a timer', () => {
  const found = ownFiles().flatMap(({ file, text }) =>
    (
      [
        [/['"]use client['"]/, 'a client module'],
        [/\buse(?:Effect|LayoutEffect|State|SyncExternalStore)\b/, 'a client hook'],
      ] as const
    )
      .filter(([pattern]) => pattern.test(text))
      .map(([, what]) => `${file}: ${what}`),
  );
  assert.deepEqual(found.sort(), [
    'scroll-spy.tsx: a client hook',
    'scroll-spy.tsx: a client module',
    'sheet-control.tsx: a client hook',
    'sheet-control.tsx: a client module',
  ]);
  // The sheet closes on a followed link through the shared Dialog's own helper (F4).
  const control = readFileSync(path.join(PACKAGE_DIR, 'src', 'sheet-control.tsx'), 'utf8');
  assert.match(control, /import \{ closesOnFollow \} from '@portfolio\/appearance\/primitives';/);
  assert.match(control, /typeof sheet\.showPopover !== 'function'/);
  for (const { file, text } of ownFiles()) {
    assert.doesNotMatch(
      text,
      /\brequestAnimationFrame\b|\bsetInterval\b|\bsetTimeout\b|addEventListener\(\s*['"]scroll/,
      file,
    );
    assert.doesNotMatch(text, /@font-face|@import|font-family\s*:(?!\s*var\(--type-)/, file);
    assert.doesNotMatch(text, /--(?:paper|ink|kc-|vt-)/, file);
  }
  const spy = readFileSync(path.join(PACKAGE_DIR, 'src', 'scroll-spy.tsx'), 'utf8');
  assert.match(spy, /new IntersectionObserver/);
  assert.match(spy, /if \(\s*plate \|\|/);
  // It rebuilds its observers on a ResizeObserver, never a resize or scroll listener.
  assert.match(spy, /new ResizeObserver\(observe\)/);
  assert.doesNotMatch(spy, /addEventListener\(\s*['"](?:resize|scroll)/);
});

test('motion is state feedback on the motion tokens, and the one animation is scroll-linked, all only under full motion', () => {
  const text = css();
  assert.doesNotMatch(text, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/i);
  assert.doesNotMatch(text, /\binfinite\b|transition\s*:\s*all|scroll-behavior/);
  for (const [, value] of text.matchAll(/\btransition:\s*([^;]+);/g)) {
    assert.match(value!, /var\(--motion-feedback\) var\(--motion-curve\)/, value);
    assert.doesNotMatch(value!, /\d+m?s\b/, value);
  }
  // Every transition and the one animation, the reading-progress rule tied to the scroll, sit in
  // the one no-preference block, and each holds to the boundary's full motion too: under the
  // site's reduce policy the host sets data-motion reduced whatever the OS says (motion-contract).
  assert.equal(count(text, /@keyframes /g), 1);
  assert.equal(count(text, /@media \(prefers-reduced-motion: no-preference\)/g), 1);
  const motion = block(text, '(prefers-reduced-motion: no-preference)');
  assert.match(motion, /animation: editorial-evidence-progress linear both;/);
  assert.match(motion, /animation-timeline: scroll\(root\);/);
  const outside = text.replace(motion, '');
  assert.equal(count(outside, /\banimation(?:-name)?\s*:/g), 0);
  assert.equal(count(outside, /\btransition\s*:/g), 0);
  const moving = [...motion.matchAll(/([^{}]+)\{[^{}]*?\b(?:transition|animation)\s*:/g)];
  // Pl. 1's marks and leaders share one transition rule (EDI-1), where the numeral and callout had two.
  assert.equal(moving.length, 7);
  for (const [, selector] of moving) {
    assert.match(
      selector!,
      /\[data-variant='editorial-evidence'\]:not\(\[data-motion='reduced'\], \[data-motion='static'\]\)/,
      selector,
    );
  }
  // Fragment jumps and focus land below the sticky chrome (WCAG 2.4.11): the masthead's height,
  // and under 81.25rem the chapter bar's too.
  assert.match(
    block(text, '(min-height: 31.25rem)'),
    /--layout-sticky-offset: calc\(var\(--layout-ee-bar\) \+ var\(--space-s\)\);/,
  );
  assert.match(
    block(text, '(width < 81.25rem)'),
    /--layout-sticky-offset: calc\(\s*var\(--layout-ee-bar\) \+ var\(--ui-control-height\) \+ var\(--space-s\)\s*\);/,
  );
  // Held to the window: the masthead and the chapter bar only in one tall enough for them, the
  // hanging heads and the chapter index only beside the head column.
  assert.equal(count(text, /position: sticky/g), 4);
  assert.match(block(text, '(min-height: 31.25rem)'), /\.ee-masthead \{\s*position: sticky;/);
  const wide = block(text, '(width >= 81.25rem)');
  assert.match(wide, /\.ee-head \{\s*position: sticky;/);
  // The chapter index holds directly under the hanging head, never at the column's foot (EE-M1).
  assert.match(
    wide,
    /\.ee-rail \{[^}]*?position: sticky;\s*inset-block-start: var\(--layout-ee-rail-top\);[^}]*?align-self: start;/,
  );
  assert.match(wide, /\.ee-head \{\s*position: sticky;[^}]*?z-index: 2;/);
  assert.match(
    block(text, '(width < 81.25rem)'),
    /@media \(min-height: 31\.25rem\) \{[^@]*?\[data-variant='editorial-evidence'\] \.ee-rail \{\s*position: sticky;/,
  );
});

test('the head column folds below 81.25rem, and below 48rem there is one column', () => {
  const text = css();
  const fold = block(text, '(width < 81.25rem)');
  assert.match(fold, /--layout-ee-head: 1 \/ -1;\s*--layout-ee-main: 1 \/ -1;/);
  const one = block(text, '(width < 48rem)');
  assert.match(
    one,
    /--layout-ee-text: 1 \/ -1;\s*--layout-ee-notes: 1 \/ -1;\s*--layout-ee-note-row: auto;/,
  );
  // The spine is drawn only where the head column is.
  const wide = block(text, '(width >= 81.25rem)');
  assert.match(wide, /border-inline-end: var\(--ui-border-divider\);/);
  assert.equal(count(text.replace(wide, ''), /border-inline-end/g), 0);
  // Below band level, columns are explicit, never a nested subgrid of the page's: the one
  // more is a fact list's rows, on the list's own two tracks, so its values start on one line.
  assert.equal(count(text, /grid-template-columns: subgrid;/g), 4);
  assert.match(
    text,
    /\.ee-facts \{\s*display: grid;\s*grid-template-columns: minmax\(min-content, 1fr\) minmax\(0, 2fr\);\s*align-content: start;\s*\}/,
  );
  assert.match(
    text,
    /\.ee-facts > div \{\s*display: grid;\s*grid-column: 1 \/ -1;\s*grid-template-columns: subgrid;/,
  );
});

test('the layers: the masthead over the heads over the rail, and the rail steps aside for a crossing head', () => {
  const text = css();
  const z = (selector: RegExp) =>
    Number(new RegExp(`${selector.source} \\{[^}]*?z-index: (\\d+);`).exec(text)?.[1]);
  assert.equal(z(/\] \.ee-masthead/), 4);
  assert.equal(z(/\] \.ee-head/), 2);
  assert.equal(z(/\] \.ee-rail:focus-within/), 3);
  assert.match(
    text,
    /\.ee-rail\[data-ee-yield='away'\]:not\(:focus-within\) \{\s*visibility: hidden;\s*opacity: 0;/,
  );
  // Holding focus over a crossing head, it takes the canvas.
  assert.match(
    text,
    /\.ee-rail:focus-within \{\s*z-index: 3;[^}]*background: var\(--color-canvas\);/,
  );
  // It folds until it docks, and is watched from there.
  const spy = readFileSync(path.join(PACKAGE_DIR, 'src', 'scroll-spy.tsx'), 'utf8');
  assert.match(spy, /if \(!docked\) \{\s*rail\.setAttribute\('data-ee-yield', 'fold'\);/);
  assert.match(text, /\.ee-rail\[data-ee-yield='fold'\]:not\(:focus-within\)/);
  // The rail draws no ground over the first chapter's rule or the spine.
  assert.match(block(text, '(width >= 81.25rem)'), /\.ee-rail \{[^}]*?background: none;/);
  // A sheet Tab leaves closes, so focus never sits on what it covers.
  const control = readFileSync(path.join(PACKAGE_DIR, 'src', 'sheet-control.tsx'), 'utf8');
  assert.match(control, /sheet\.addEventListener\('focusout', leave\)/);
  assert.match(control, /opener\.addEventListener\('focusout', leave\)/);
});

test('no column is held empty: plates fill their margin, and a band with none runs its table to the outset', () => {
  const text = css();
  assert.match(text, /\.ee-plate__side \{[^}]*?align-self: end;/);
  assert.match(
    text,
    /\.ee-band:not\(\.ee-band--margined\)\s*\.ee-band__body\s*> :is\(\.ee-figtable, \.ee-pairs\) \{\s*grid-column: 1 \/ -1;/,
  );
  // One end line per list: a list's lines run into the margin only when none of its rows has a note.
  assert.match(
    text,
    /\.ee-rows:not\(:has\(> \.ee-row > \.ee-row__note\), \.ee-archive \.ee-rows\)/,
  );
});

test("Pl. 1 hangs from the contents' top line, its mat hugging the artwork, its marks on it at every width (EDI-1)", () => {
  const text = css();
  const frame =
    /\[data-variant='editorial-evidence'\] \.ee-lead__frame \{([^}]*)\}/.exec(text)?.[1] ?? '';
  assert.match(frame, /align-self: start;/);
  // One mat on every side: EDI-1's step at least, so leader 1 runs inside the mat's ground, never
  // on its edge, and the language's surface space where that is wider (EE-LANG round 2, P1-1).
  assert.match(frame, /padding: var\(--layout-ee-mat\);/);
  assert.match(
    text,
    /--layout-ee-mat: max\(\s*var\(--space-l\),\s*var\(--ui-space-surface-block\),\s*var\(--ui-space-surface-inline\)\s*\);/,
  );
  // The mat is the Surface primitive's: EE paints no ground, corner, border or shadow of its own on it.
  assert.doesNotMatch(frame, /background|border|box-shadow/);
  assert.doesNotMatch(frame, /justify-content: end|display: flex|align-self: end/);
  // The marks sit in the artwork's box, inside the mat's padding.
  assert.match(text, /\.ee-lead__pins \{\s*position: absolute;\s*inset: var\(--layout-ee-mat\);/);
  // Nothing hides them at any width; only the leaders go, under 64rem, where the notes sit among
  // the marks (768) or under the plate (390), and on the printed page.
  assert.doesNotMatch(text, /ee-lead__callout|ee-lead__numeral/);
  const fold = block(text, '(width < 81.25rem)');
  assert.doesNotMatch(fold, /ee-lead__(?:pins|key|leaders)/);
  // There the notes sit over the marks, so the diagonal mirrors: the pin's one rule moves it.
  assert.match(fold, /\.ee-lead__pin \{\s*inset-inline-start: var\(--layout-ee-pin-mx\);\s*\}/);
  assert.equal(count(fold, /ee-lead__pin\b/g), 1);
  assert.match(
    block(text, '(width < 64rem)'),
    /^[^}]*\.ee-lead__leaders \{\s*display: none;\s*\}\s*$/,
  );
  // The leaders need anchor positioning; without it the figure keys its notes by numeral alone.
  assert.match(text, /@supports \(anchor-name: --a\)/);
});

test('a fact sheet keeps its rows at its top, so one taller than its rows never stretches them (EDI-3)', () => {
  const sheet = /\[data-variant='editorial-evidence'\] \.ee-facts \{([^}]*)\}/.exec(css());
  assert.ok(sheet, 'the fact sheet’s rule');
  assert.match(sheet[1]!, /align-content: start;/);
});

test("the chapter index's scrollers keep the platform ring's reach clear inside their edges, so no ring is clipped", () => {
  const text = css();
  assert.match(
    text,
    /--layout-ee-ring: calc\(var\(--ui-focus-width\) \+ var\(--ui-focus-offset\)\);/,
  );
  // Beside the head column the rail scrolls up and down; under it the chapter bar scrolls sideways.
  const side = /\.ee-rail \{([^}]*overflow-y: auto;[^}]*)\}/.exec(
    block(text, '(width >= 81.25rem)'),
  )?.[1];
  // Its padding is border-box: the reach comes off its start, and its width grows by both sides, so the links keep their line and length.
  assert.match(side ?? '', /padding-inline: var\(--layout-ee-ring\);/);
  assert.match(
    side ?? '',
    /margin-inline-start: calc\(var\(--layout-ee-inset\) - var\(--layout-ee-ring\)\);/,
  );
  assert.match(side ?? '', /inline-size: calc\([^;]*\+ 2 \* var\(--layout-ee-ring\)\s*\);/);
  const bar = /\.ee-rail__list \{([^}]*overflow-x: auto;[^}]*)\}/.exec(
    block(text, '(width < 81.25rem)'),
  )?.[1];
  assert.match(bar ?? '', /padding: var\(--layout-ee-ring\);/);
  assert.match(bar ?? '', /margin: calc\(-1 \* var\(--layout-ee-ring\)\);/);
  // Below the links it keeps the reach, so the ring ends where the bar's hairline starts.
  assert.match(bar ?? '', /margin-block-end: 0;/);
});

test('print keeps the order, opens every disclosure, holds nothing to the screen, and drops the visitor control', () => {
  const text = css();
  const print = block(text, 'print');
  assert.match(print, /:is\(\[data-visitor-control-slot\], \.ee-spy\) \{\s*display: none;/);
  assert.match(print, /details::details-content \{\s*content-visibility: visible;/);
  // Every sticky box on screen, the chapter index's rail included, is static on paper.
  assert.match(print, /:is\(\.ee-masthead, \.ee-head, \.ee-rail\) \{\s*position: static;/);
  assert.doesNotMatch(text, /\border\s*:|flex-direction:\s*(?:row|column)-reverse/);
});

test('the host registers it as the platform default: a dependency of @portfolio/web, and the default selection', () => {
  const web = JSON.parse(readFileSync(path.join(REPO_ROOT, 'apps', 'web', 'package.json'), 'utf8'));
  assert.equal(web.dependencies?.[PACKAGE.name], 'workspace:*');
  for (const list of ['devDependencies', 'optionalDependencies']) {
    assert.equal(web[list]?.[PACKAGE.name], undefined, list);
  }
  assert.equal(PLATFORM_DEFAULTS.variant, MANIFEST.id);
});

// The rail's current rule is a non-text mark, so it holds 3:1 on EE's canvas (WCAG 1.4.11). It
// draws in the accent; a scheme whose accent falls under that in any set it renders is on the
// stylesheet's list, where the rule takes the accent's text role. Every registered scheme is
// measured, set by set, as the compiler renders them. A generator scheme has no fixed sets until
// an owner generates one, so it's out of reach here.
test("every registered scheme whose accent is under 3:1 on the canvas is on the rail rule's list, and no other", () => {
  const lock = JSON.parse(
    readFileSync(
      path.join(REPO_ROOT, 'packages', 'appearance', 'appearance-catalog.lock.json'),
      'utf8',
    ),
  ) as { packs: Record<string, { axis: string; package: string }> };
  const under = new Map<string, string[]>();
  let measured = 0;
  for (const [id, pack] of Object.entries(lock.packs)) {
    if (pack.axis !== 'colorScheme') continue;
    const dir = path.join(
      REPO_ROOT,
      'packages',
      pack.package.replace('@portfolio/', ''),
      'packs',
      id,
    );
    const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    const base = schemeBaseSets(manifest);
    if (!base) continue;
    measured++;
    const sets = schemeSets(base, manifest.highContrast, manifest.derivation, manifest.anchors);
    for (const [name, set] of Object.entries(sets)) {
      const ratio = contrast(set!.accent, set!.canvas);
      if (ratio < 3) under.set(id, [...(under.get(id) ?? []), `${name} ${ratio.toFixed(2)}:1`]);
    }
  }
  assert.ok(measured >= 30, `measured ${measured} schemes`);
  const css = readFileSync(path.join(PACKAGE_DIR, 'src', 'styles.css'), 'utf8');
  const listed = new Set(
    [
      ...css.matchAll(
        /\[data-variant='editorial-evidence'\]\[data-color-scheme='([a-z0-9-]+)'\]\s+\.ee-rail__link::after/g,
      ),
    ].map((match) => match[1]!),
  );
  for (const id of listed) {
    const underline = new RegExp(
      `\\[data-color-scheme='${id}'\\]\\s+\\.ee-rail__link\\[aria-current\\]`,
    );
    assert.ok(underline.test(css), `${id}: the one-column underline is listed too`);
  }
  for (const [id, sets] of under) {
    assert.ok(
      listed.has(id),
      `${id}'s accent is under 3:1 on its canvas (${sets.join(', ')}) and isn't listed`,
    );
  }
  for (const id of listed) {
    assert.ok(under.has(id), `${id} is listed, but its accent holds 3:1 in every set: drop it`);
  }
  // Warm-parchment, EE's default, keeps its terracotta.
  assert.ok(!listed.has('warm-parchment'));
});
