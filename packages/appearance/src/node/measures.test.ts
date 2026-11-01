import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TypographyManifest } from '../manifests';
import { SIZE_ADJUST } from '../scales';
import { compilePack, measureEm } from './compile';
import { readFontMetrics, TEXT_FACES } from './font-metrics';

// The measures (R11, lead A's ruling): a typography pack declares each as a
// count of characters, `68ch` for body and `52ch` for compact, and the
// compiler resolves it to that many of the body face's average advance,
// plus the body's letter-spacing, in em. A ch is the width of a 0, which
// is about 1.2 average letters in these faces, so 68ch ran to 84 to 94
// characters a line. Here each shipping pack's compiled measures are held
// to their characters, with the advance found apart from the compiler: the
// body's shipped face read from its file; for an OS stack, the stack's
// first system face read from this machine's file as 16px body text
// renders it, else the advance recorded below, never the compiler's table.
//
// R11.1 (lead A's ruling): the count is of characters as they render. Where
// a composition applies font-size-adjust, the body face renders at the
// aspect it's adjusted to over its own, so the composition sets
// --layout-measure-scale to that ratio, from the profile's
// --type-body-aspect, and each measure is multiplied by it. Here each pack
// is counted both ways: at its font-size, scale 1, and under the platform's
// font-size-adjust (or the pack's own body aspect), at the scale a
// composition sets.

const PACKS = fileURLToPath(new URL('../../../appearance-typography/packs/', import.meta.url));

/**
 * The OS-stack packs' first faces' average advances per em, as 16px body
 * text renders them on macOS (2026-10-26): SF Pro at its Text design, opsz
 * 17, not its Display default (the measure review's M1). Then each one's
 * aspect, its x-height per em: OS/2's sxHeight, or the x glyph's top where
 * the table has none (Iowan Old Style, Trebuchet MS, Charter).
 */
const RECORDED: Readonly<Record<string, number>> = {
  Verdana: 0.514,
  'Iowan Old Style': 0.4521,
  'Trebuchet MS': 0.4589,
  Charter: 0.4439,
  'system-ui': 0.4785,
  'Avenir Next': 0.462,
};
const RECORDED_ASPECT: Readonly<Record<string, number>> = {
  Verdana: 0.5454,
  'Iowan Old Style': 0.479,
  'Trebuchet MS': 0.5229,
  Charter: 0.481,
  'system-ui': 0.5078,
  'Avenir Next': 0.468,
};

const unquote = (entry: string) => entry.trim().replace(/^["'](.*)["']$/, '$1');

/** The body face's average advance and aspect per em, measured apart from the compiler, and what they were measured from. */
function advanceOf(
  manifest: TypographyManifest,
  dir: string,
): { advance: number; aspect: number; from: string } {
  const body = manifest.roles.body;
  const weight = Number(body['font-weight']);
  const stack = String(body['font-family']).split(',').map(unquote);
  for (const name of stack) {
    const face = manifest.fontAssets.find(
      (asset) =>
        asset.family === name &&
        asset.style === 'normal' &&
        (Array.isArray(asset.weight)
          ? asset.weight[0] <= weight && weight <= asset.weight[1]
          : asset.weight === weight) &&
        /U\+0000-00FF/.test(asset.unicodeRange),
    );
    if (!face) continue;
    const metrics = readFontMetrics(
      new Uint8Array(fs.readFileSync(path.join(dir, face.file))),
      face.file,
      { ...(Array.isArray(face.weight) ? { wght: weight } : {}), opsz: 16 },
    );
    return {
      advance: metrics.latinWidth! / metrics.unitsPerEm,
      aspect: metrics.xHeight! / metrics.unitsPerEm,
      from: face.file,
    };
  }
  const name = stack.find((each) => Object.hasOwn(RECORDED, each));
  assert.ok(name, `${manifest.id}'s body stack leads with a recorded system face`);
  // Where the face is on this machine, its file, read as body text renders.
  const file = TEXT_FACES.find(({ names }) => names.includes(name))?.file;
  if (file && fs.existsSync(file)) {
    const face = TEXT_FACES.find(({ names }) => names.includes(name))!;
    const metrics = readFontMetrics(new Uint8Array(fs.readFileSync(file)), name, {
      ...(face.fullName ? { fullName: face.fullName } : {}),
      wght: 400,
      opsz: 16,
    });
    const read = metrics.latinWidth! / metrics.unitsPerEm;
    const aspect = metrics.xHeight! / metrics.unitsPerEm;
    assert.ok(Math.abs(read - RECORDED[name]!) < 0.0005, `${name} reads ${read.toFixed(4)}`);
    assert.ok(
      Math.abs(aspect - RECORDED_ASPECT[name]!) < 0.0005,
      `${name}'s aspect reads ${aspect.toFixed(4)}`,
    );
    return { advance: read, aspect, from: file };
  }
  return {
    advance: RECORDED[name]!,
    aspect: RECORDED_ASPECT[name]!,
    from: `the recorded ${name}`,
  };
}

/** A compiled measure's em, from `calc(<n>em * clamp(0.5, var(--layout-measure-scale, 1), 2))`. */
const ems = (css: string, measure: string) =>
  Number(
    new RegExp(
      `--type-measure-${measure}: calc\\((\\d+(?:\\.\\d+)?)em \\* clamp\\(0\\.5, var\\(--layout-measure-scale, 1\\), 2\\)\\);`,
    ).exec(css)?.[1],
  );

/**
 * The measure scale Spatial Bento, which applies font-size-adjust, declares
 * in its root rule, for a profile's body aspect and the face's own, held to
 * the compiled clamp. Read from its stylesheet, so the test holds the
 * composition's formula as well as the compiler.
 */
const BENTO = fs.readFileSync(
  fileURLToPath(new URL('../../../variant-spatial-bento/src/styles.css', import.meta.url)),
  'utf8',
);
function bentoScale(adjust: number, aspect: number): number {
  const declared = /\[data-variant='spatial-bento'\] \{[^}]*?--layout-measure-scale: ([^;]+);/.exec(
    BENTO,
  )?.[1];
  assert.equal(declared, 'calc(var(--type-body-size-adjust) / var(--type-body-aspect))');
  return Math.min(2, Math.max(0.5, adjust / aspect));
}

/** The profile's compiled --type-body-aspect. */
const aspectOf = (css: string) => Number(/\n {4}--type-body-aspect: (\d*\.\d+);\n/.exec(css)?.[1]);

const tracking = (manifest: TypographyManifest) =>
  Number(/^(-?[\d.]+)em$/.exec(String(manifest.roles.body['letter-spacing']))?.[1] ?? 0);

const read = (id: string) =>
  JSON.parse(fs.readFileSync(path.join(PACKS, id, 'manifest.json'), 'utf8')) as TypographyManifest;

/**
 * The packs that declare measures of their own, and what (packs-plan §3.2):
 * shell-mono's 72 and 56 for monospace prose, book-serif's 65 for long reading,
 * and accessible-reading's 60 and 48, a shorter line for its larger body (LANG-5b).
 */
const DECLARED: Readonly<Record<string, { body: string; compact: string }>> = {
  'shell-mono': { body: '72ch', compact: '56ch' },
  'book-serif': { body: '65ch', compact: '52ch' },
  'accessible-reading': { body: '60ch', compact: '48ch' },
};

const count = (measure: string) => Number(/^(\d+(?:\.\d+)?)ch$/.exec(measure)?.[1]);

test("every shipping typography pack's compiled measures are its declared characters of its body face, 68 and 52 unless it says otherwise, within 2", () => {
  const ids = fs
    .readdirSync(PACKS)
    .filter((id) => fs.existsSync(path.join(PACKS, id, 'manifest.json')));
  assert.ok(ids.length >= 10, 'the shipping packs are all here');
  for (const id of ids) {
    const dir = path.join(PACKS, id);
    const manifest = read(id);
    // The packs declare characters: 68 and 52, or the counts DECLARED names.
    const declared = DECLARED[id] ?? { body: '68ch', compact: '52ch' };
    assert.deepEqual(manifest.measures, declared, id);
    const result = compilePack({ kind: 'typography', manifest, dir });
    assert.ok(result.ok, `${id}: ${JSON.stringify(result.ok ? null : result.problems)}`);
    assert.equal(result.pack.warnings, undefined, id);
    const css = new TextDecoder().decode(result.pack.stylesheet!.bytes);
    assert.doesNotMatch(css, /--type-measure-[a-z]+: [\d.]+ch;/, id);
    const { advance, aspect, from } = advanceOf(manifest, dir);
    // The profile's aspect is its body face's, as measured apart from the compiler.
    assert.ok(
      Math.abs(aspectOf(css) - aspect) < 0.0005,
      `${id}: --type-body-aspect is ${aspectOf(css)}, not ${aspect.toFixed(4)} from ${from}`,
    );
    const [wantBody, wantCompact] = [count(declared.body), count(declared.compact)];
    // At the body's font-size (no font-size-adjust, scale 1); then under
    // font-size-adjust at the body's aspect, the platform's 0.5 or the pack's
    // own, where a glyph renders at `adjust / aspect` of its advance (the
    // face's own aspect, measured apart), its em tracking stays the
    // font-size's, and the scale is the one Spatial Bento's formula gives
    // from the profile's tokens.
    const adjust = manifest.roles.body['font-size-adjust'] ?? SIZE_ADJUST;
    const rendered = adjust / aspect;
    const scaled = bentoScale(adjust, aspectOf(css));
    for (const [scale, size, how] of [
      [1, 1, 'at its font-size'],
      [
        scaled,
        rendered,
        `under font-size-adjust ${adjust}, at Spatial Bento's scale ${scaled.toFixed(3)}`,
      ],
    ] as const) {
      const per = advance * size + tracking(manifest);
      const body = (ems(css, 'body') * scale) / per;
      const compact = (ems(css, 'compact') * scale) / per;
      assert.ok(
        Math.abs(body - wantBody) <= 2,
        `${id}: body is ${body.toFixed(1)} characters of ${from} ${how}, not ${wantBody}`,
      );
      assert.ok(
        Math.abs(compact - wantCompact) <= 2,
        `${id}: compact is ${compact.toFixed(1)} of ${from} ${how}, not ${wantCompact}`,
      );
    }
  }
});

test('under font-size-adjust, a measure the scale leaves at 1 counts too few or too many characters, which is why a composition sets it', () => {
  // screen-grotesque's Inter, at an aspect of 0.5459, renders at 0.916 of its size under the
  // platform's 0.5, so 68 counted characters, unscaled, would hold about 74.
  const manifest = read('screen-grotesque');
  const dir = path.join(PACKS, 'screen-grotesque');
  const result = compilePack({ kind: 'typography', manifest, dir });
  assert.ok(result.ok);
  const css = new TextDecoder().decode(result.pack.stylesheet!.bytes);
  const { advance } = advanceOf(manifest, dir);
  const size = SIZE_ADJUST / aspectOf(css);
  assert.equal(aspectOf(css), 0.5459);
  assert.equal(Math.round(ems(css, 'body') / (advance * size)), 74);
  assert.equal(Math.round((ems(css, 'body') * size) / (advance * size)), 68);
  assert.match(
    css,
    /times --layout-measure-scale, which a composition that applies font-size-adjust sets from --type-body-aspect, 0\.5459, held from 0\.5 to 2\. \*\//,
  );
});

test("multilingual-system's measures are SF Pro's Text design, so its body is 68 characters, not 60", () => {
  const manifest = read('multilingual-system');
  const result = compilePack({
    kind: 'typography',
    manifest,
    dir: path.join(PACKS, 'multilingual-system'),
  });
  assert.ok(result.ok);
  const css = new TextDecoder().decode(result.pack.stylesheet!.bytes);
  assert.equal(ems(css, 'body'), 32.54);
  assert.equal(ems(css, 'compact'), 24.88);
});

test("the body's letter-spacing widens every character, so it's in the width the measure counts", () => {
  const dir = path.join(PACKS, 'humanist-ui');
  const humanist = read('humanist-ui');
  const tracked = {
    ...humanist,
    id: 'acme-type',
    roles: { ...humanist.roles, body: { ...humanist.roles.body, 'letter-spacing': '0.02em' } },
  } as TypographyManifest;
  const result = compilePack({ kind: 'typography', manifest: tracked, dir });
  assert.ok(result.ok);
  const css = new TextDecoder().decode(result.pack.stylesheet!.bytes);
  // Trebuchet MS's 0.45889em, and 0.02em each: 68 × 0.47889.
  assert.equal(ems(css, 'body'), 32.56);
  assert.match(css, /characters at Trebuchet MS's 0\.4789em average advance/);
});

test('a body stack with no face whose advance is known keeps its declared ch, with a warning, and still compiles', () => {
  const dir = path.join(PACKS, 'humanist-ui');
  const humanist = read('humanist-ui');
  const manifest = {
    ...humanist,
    id: 'acme-type',
    roles: {
      ...humanist.roles,
      body: { ...humanist.roles.body, 'font-family': '"Nowhere Sans", sans-serif' },
    },
  } as TypographyManifest;
  const result = compilePack({ kind: 'typography', manifest, dir });
  assert.ok(result.ok);
  const css = new TextDecoder().decode(result.pack.stylesheet!.bytes);
  // A ch is the rendered font's own 0, so it follows font-size-adjust with no scale, and no aspect is set.
  assert.match(css, /--type-measure-body: 68ch;\n {4}--type-measure-compact: 52ch;\n/);
  assert.doesNotMatch(css, /--type-body-aspect/);
  assert.match(css, /Measures: in ch as declared/);
  assert.equal(result.pack.warnings?.length, 1);
  assert.match(result.pack.warnings![0]!, /typography acme-type: its body stack names no face/);
});

test('a measure is its count of average advances, in em, to two places', () => {
  assert.equal(measureEm('68ch', 0.4589), '31.21em');
  assert.equal(measureEm('52ch', 0.5), '26em');
  assert.equal(measureEm(' 68.5ch ', 0.44), '30.14em');
});
