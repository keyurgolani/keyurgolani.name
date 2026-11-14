// compilePack() (#19, Slice 2, items 1 and 4): one stylesheet per pack, its
// rules inside its axis layer, starting with LAYER_ORDER so load order can't
// change layer order. Registry generation writes each pack's stylesheet to
// apps/web/public/_portfolio/pack/ by content hash, and its fonts to
// apps/web/public/_portfolio/font/ (#6, item 7), and the metadata module
// lists each with its url and sha256.
//
// - A scheme gets a block per display mode, keyed on the boundary's
//   attributes, with the prefers-color-scheme, prefers-contrast, and print
//   queries the compiler writes, its high-contrast sets, and, under the same
//   queries, :root:has() rules that give the document's root only
//   color-scheme, background-color, and scrollbar-color (a thumb the set's
//   border-strong moved ROOT_THUMB_STEP toward its text-primary, on its
//   canvas), so canvas, scrollbars, and form
//   controls match from first paint. One file holds every mode. Outside
//   print, the same :root:has() selectors give the root's
//   ::view-transition every color role too (K-4 (a)): the view-transition
//   pseudo-elements hang from the root, not the boundary, so a variant's
//   transition reads the boundary's colors there, and nothing in the
//   document's own tree gets them.
// - A typography profile scopes its role tokens to [data-typography], with
//   each @font-face family namespaced "<pack id> <family>" ahead of the
//   declared fallback stack. Each family a role renders in also gets up to
//   two fallback aliases, "<pack id> <family> Fallback 1" and "... Fallback
//   2", over the local system faces of its class that fit its width per
//   x-height best (fallbackAliases(), font-metrics.ts), each style fitted
//   to its own face, so an italic to the system italics, the first by its
//   macOS names and the second by the names Windows and Linux give it,
//   each with size-adjust and the metric overrides computed from the font's
//   own tables, right after it in the stack; a chain whose aliases have no
//   face a stock Linux has gets a third, "... Fallback 3", over the
//   class's Liberation face (LIBERATION_FONTS); and the profile names the one font a
//   page preloads. A role whose system stack leads with a family
//   Linux doesn't install (LEADING_FAMILIES, font-metrics.ts) gets two
//   metric fallbacks right behind it, "<pack id> <family> Linux Fallback"
//   over Liberation Sans and "... DejaVu Fallback" over DejaVu Sans, sized to
//   that family's faces and limited to the code points it draws, so they're
//   used only where it's missing.
// - A design language gets its tokens, and beside them
//   --ui-shadow-raised-reach, how far its shadow-raised's hard edge paints
//   past its object (shadowEdgeReach()), and its stylesheet inside
//   @scope ([data-design-language="<id>"]) to ([data-appearance-boundary]),
//   written from what readLanguageStylesheet() read. Its --ui-motion-*
//   tokens go on the document root's ::view-transition too (K-4 (a)), for
//   the same reason as a scheme's colors.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DisplayMode } from '@portfolio/schema';
import type { PackKind } from '../axes';
import { mix } from '../color';
import { withDerivedRoles } from '../derived-roles';
import { shadowEdgeReach } from '../gate';
import { LENGTH_KEYS } from '../language-grammar';
import { LAYER_ORDER } from '../layers';
import { BODY_ASPECT, MEASURE_SCALE, sizeAdjustProperty } from '../scales';
import type { ColorSchemeManifest, DesignLanguageManifest, TypographyManifest } from '../manifests';
import type { GeneratedScheme } from '../resolve-tokens';
import {
  isHighContrastSet,
  printSet,
  deriveBaseSet,
  generatedSchemeSets,
  schemeSets,
  setPolarity,
  type ColorSetName,
  type SchemeSets,
} from '../sets';
import {
  COLOR_ROLES,
  LANGUAGE_KEYS,
  SHADOW_RAISED_REACH,
  TYPOGRAPHY_FIELDS,
  TYPOGRAPHY_MEASURES,
  TYPOGRAPHY_ROLES,
  type ColorTokens,
  type LanguageKey,
} from '../tokens';
import { SCRIPT_FILE, type PackManifest } from '../validate-pack';
import {
  BASIC_LATIN,
  FACE_KEYS,
  fallbackAliases,
  fallbackFace,
  leadingFamily,
  leadingOverrides,
  LINUX_FACES,
  FontMetricsError,
  mappedCodePoints,
  readFontMetrics,
  stackClass,
  stackTextFace,
  type FontMetrics,
} from './font-metrics';
import { readLanguageStylesheet, writeStyleNodes, type LintRule } from './stylesheet';

/** Where the host serves pack stylesheets from: apps/web/public/_portfolio/pack/. */
export const PACK_URL = '/_portfolio/pack/';
/** Where the host serves the fonts a typography profile ships (#6, item 7): apps/web/public/_portfolio/font/. */
export const FONT_URL = '/_portfolio/font/';

/** Larger than any subset a pack needs. */
export const MAX_FONT_BYTES = 512 * 1024;

/** A file registry generation writes into the pack directory. */
export interface PackFile {
  /** Its name there: `<id>.<sha256-12>.css`, or `.woff2`. */
  readonly name: string;
  readonly url: string;
  /** The hex SHA-256 of its bytes. */
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

export interface CompiledPack {
  /** Null for a generator scheme: its stylesheet compiles from what it generates (Slice 4's route). */
  readonly stylesheet: PackFile | null;
  /** The font files a typography profile ships. */
  readonly assets: readonly PackFile[];
  /**
   * The URL of the one font a page under a typography profile preloads,
   * one of `assets`: its body face's Latin file at the body's weight
   * (preloadFace()). Absent for a profile that ships no such face.
   */
  readonly preload?: string;
  /** What compiled, but not as the author likely meant, such as a measure left in ch. Registry generation prints each. */
  readonly warnings?: readonly string[];
}

/** Why a valid manifest still can't compile: a file it names. */
export interface CompileProblem {
  /** The file, relative to the pack's directory: manifest.json, or one it names. */
  readonly file: string;
  /** JSON pointer into manifest.json; '' for the file as a whole. */
  readonly pointer: string;
  readonly message: string;
  readonly remedy: string;
  /** The pack CSS lint rule it breaks, when it breaks one (#20). */
  readonly rule?: LintRule;
}

export type CompileResult =
  | { readonly ok: true; readonly pack: CompiledPack }
  | { readonly ok: false; readonly problems: readonly CompileProblem[] };

/** A pack that validatePackManifest() passed, and its directory, packs/<id> in its package. */
export interface PackSource {
  readonly kind: PackKind;
  readonly manifest: PackManifest;
  readonly dir: string;
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** A file named by its content, `<id>.<sha256-12>.<extension>`: a stylesheet under PACK_URL, a font under FONT_URL. */
export function packFile(id: string, extension: 'css' | 'woff2', bytes: Uint8Array): PackFile {
  const digest = sha256(bytes);
  const name = `${id}.${digest.slice(0, 12)}.${extension}`;
  const base = extension === 'woff2' ? FONT_URL : PACK_URL;
  return { name, url: `${base}${name}`, sha256: digest, bytes };
}

const cssFile = (id: string, css: string) => packFile(id, 'css', new TextEncoder().encode(css));

/** Compiles one valid pack, reading the files its manifest names from its directory. */
export function compilePack(source: PackSource): CompileResult {
  const scripts = scriptFiles(source.dir);
  if (scripts.length > 0) {
    return {
      ok: false,
      problems: scripts.map((file) => ({
        file,
        pointer: '',
        message: `${file} is a file a page could run as script, and no pack ships JavaScript.`,
        remedy:
          "Remove it: a pack's directory holds its manifest, its stylesheet, its fonts, and their license text.",
        rule: 'javascript' as const,
      })),
    };
  }
  if (source.kind === 'color-scheme') {
    const manifest = source.manifest as ColorSchemeManifest;
    const sets = schemeBaseSets(manifest);
    if (!sets) return { ok: true, pack: { stylesheet: null, assets: [] } };
    const css = compileSchemeStylesheet(
      manifest.id,
      schemeSets(sets, manifest.highContrast, manifest.derivation, manifest.anchors),
    );
    return { ok: true, pack: { stylesheet: cssFile(manifest.id, css), assets: [] } };
  }
  if (source.kind === 'typography')
    return compileTypography(source.manifest as TypographyManifest, source.dir);
  return compileLanguage(source.manifest as DesignLanguageManifest, source.dir);
}

/**
 * Every file under a pack's directory a page could run as script, such as
 * a .js, .mjs, .ts, .wasm, .html, or .svg file, relative to it and sorted.
 * A link with a script-file name counts, whatever it points at.
 */
export function scriptFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      const shown = path.relative(dir, full).split(path.sep).join('/');
      if (entry.isSymbolicLink()) {
        if (SCRIPT_FILE.test(entry.name)) found.push(shown);
      } else if (entry.isDirectory()) walk(full);
      else if (SCRIPT_FILE.test(entry.name)) found.push(shown);
    }
  };
  walk(dir);
  return found.sort();
}

/** A scheme's base sets: authored, or its derivation's from its anchors. Null for a generator scheme. */
export function schemeBaseSets(
  manifest: ColorSchemeManifest,
): { light?: ColorTokens; dark?: ColorTokens } | null {
  if (manifest.generator) return null;
  const sets: { light?: ColorTokens; dark?: ColorTokens } = {};
  for (const mode of ['light', 'dark'] as const) {
    const anchors = manifest.anchors?.[mode];
    if (anchors) sets[mode] = deriveBaseSet(manifest.derivation!, anchors, mode);
    // An authored set gets the roles K-2 added from its others where it leaves them out.
    else if (manifest[mode]) sets[mode] = withDerivedRoles(manifest[mode]!, false);
  }
  return sets;
}

/** The stylesheet of a generator scheme's generated sets, which Slice 4's route and #7's grant path serve. */
export function compileGeneratedScheme(id: string, generated: GeneratedScheme): string {
  return compileSchemeStylesheet(id, generatedSchemeSets(generated));
}

/** What a file holds before its first rule: the layer order, then the pack it is. */
function header(kind: string, id: string): string {
  return `${LAYER_ORDER}\n/* ${kind} ${id}, compiled by @portfolio/appearance. */\n`;
}

const indent = (lines: string, by: string) =>
  lines
    .split('\n')
    .map((line) => (line === '' ? line : `${by}${line}`))
    .join('\n');

type Assignment = readonly [selector: string, set: ColorSetName];

/**
 * Every display mode's colors for one scheme. Each media context lists
 * which set a boundary selector gets; within a context no two selectors of
 * one specificity match one element, so grouping a context's selectors by
 * set keeps the cascade, and the contexts run in an order where each later
 * one wins: the defaults, prefers-color-scheme: dark, prefers-contrast:
 * more, both, then print, which is always light.
 */
export function compileSchemeStylesheet(id: string, sets: SchemeSets): string {
  const scheme = `[data-color-scheme="${id}"]`;
  const mode = (value: DisplayMode) => `${scheme}[data-display-mode="${value}"]`;
  const more = (value: DisplayMode) => `${mode(value)}[data-contrast="more"]`;
  const dual = Boolean(sets.light && sets.dark);
  const highContrastOf = (set: ColorSetName): ColorSetName =>
    isHighContrastSet(set)
      ? set
      : setPolarity(set) === 'light'
        ? 'high-contrast-light'
        : 'high-contrast-dark';
  const rendered: Readonly<Record<DisplayMode, ColorSetName>> = {
    system: sets.light ? 'light' : 'dark',
    light: sets.light ? 'light' : 'dark',
    dark: sets.dark ? 'dark' : 'light',
    // The dark high-contrast set, or the light one for a light-only scheme.
    'high-contrast': sets.dark ? 'high-contrast-dark' : 'high-contrast-light',
  };
  const modes = ['light', 'dark', 'system', 'high-contrast'] as const;
  const shown = ['light', 'dark', 'system'] as const;
  const print = printSet(sets, false);

  const contexts: [string | null, Assignment[]][] = [
    [
      null,
      [
        [scheme, rendered.system],
        ...modes.map((value): Assignment => [mode(value), rendered[value]]),
        ...modes.map((value): Assignment => [more(value), highContrastOf(rendered[value])]),
      ],
    ],
  ];
  if (dual) {
    contexts.push([
      '(prefers-color-scheme: dark)',
      [
        [scheme, 'dark'],
        [mode('system'), 'dark'],
        [more('system'), 'high-contrast-dark'],
      ],
    ]);
  }
  contexts.push([
    '(prefers-contrast: more)',
    [
      [scheme, highContrastOf(rendered.system)],
      ...shown.map((value): Assignment => [mode(value), highContrastOf(rendered[value])]),
    ],
  ]);
  if (dual) {
    contexts.push([
      '(prefers-contrast: more) and (prefers-color-scheme: dark)',
      [
        [scheme, 'high-contrast-dark'],
        [mode('system'), 'high-contrast-dark'],
      ],
    ]);
  }
  contexts.push([
    'print',
    [
      [scheme, print],
      ...shown.map((value): Assignment => [mode(value), print]),
      [mode('high-contrast'), 'high-contrast-light'],
      ...modes.map((value): Assignment => [more(value), 'high-contrast-light']),
    ],
  ]);
  contexts.push([
    'print and (prefers-contrast: more)',
    [
      [scheme, 'high-contrast-light'],
      ...shown.map((value): Assignment => [mode(value), 'high-contrast-light']),
    ],
  ]);

  const body = contexts
    .map(([media, assignments]) => {
      // No page navigates in print, so its contexts carry no view-transition colors.
      const blocks = schemeBlocks(assignments, sets, media === null || !/\bprint\b/.test(media));
      return media === null ? blocks : `@media ${media} {\n${indent(blocks, '  ')}}\n`;
    })
    .join('');
  return `${header('Color scheme', id)}@layer scheme {\n${indent(body, '  ')}}\n`;
}

/** The rule a document boundary's selector gives its root's view-transition pseudo-element tree. */
export function rootTransition(selector: string): string {
  return `:root:has([data-appearance-boundary="document"]${selector})::view-transition`;
}

/**
 * A context's rules: the boundary's tokens per set, then the document root's two properties
 * per set, then, with `transitions`, every role on the root's ::view-transition per set.
 */
/**
 * How far the root's scrollbar thumb moves from the set's border-strong toward its text-primary,
 * in percent, as color-mix(in srgb) does: the smallest step that reads 3:1 on the canvas track a
 * classic bar paints and over the art behind an overlay bar, which paints no track (macOS: Aurora
 * Glass's sky, Terra Field's accent band). border-strong alone clears the canvas in every shipped
 * scheme but nearly vanishes over that art.
 */
const ROOT_THUMB_STEP = 55;

function schemeBlocks(
  assignments: readonly Assignment[],
  sets: SchemeSets,
  transitions: boolean,
): string {
  const bySet = new Map<ColorSetName, string[]>();
  for (const [selector, set] of assignments) {
    if (!sets[set]) throw new Error(`A scheme compiled without its ${set} set.`);
    bySet.set(set, [...(bySet.get(set) ?? []), selector]);
  }
  let css = '';
  for (const [set, selectors] of bySet) {
    const tokens = sets[set]!;
    css += `${selectors.join(',\n')} {\n  color-scheme: ${setPolarity(set)};\n${COLOR_ROLES.map(
      (role) => `  --color-${role}: ${tokens[role]};\n`,
    ).join('')}}\n`;
  }
  for (const [set, selectors] of bySet) {
    css += `${selectors
      .map((selector) => `:root:has([data-appearance-boundary="document"]${selector})`)
      .join(
        ',\n',
      )} {\n  color-scheme: ${setPolarity(set)};\n  background-color: ${sets[set]!.canvas};\n  scrollbar-color: ${mix(sets[set]!['border-strong']!, sets[set]!['text-primary']!, ROOT_THUMB_STEP)} ${sets[set]!.canvas};\n}\n`;
  }
  if (!transitions) return css;
  for (const [set, selectors] of bySet) {
    const tokens = sets[set]!;
    css += `${selectors.map(rootTransition).join(',\n')} {\n${COLOR_ROLES.map(
      (role) => `  --color-${role}: ${tokens[role]};\n`,
    ).join('')}}\n`;
  }
  return css;
}

type FontAsset = TypographyManifest['fontAssets'][number];

/** The code point a face must cover to count as the family's Latin face: a. */
const LATIN_PROBE = 0x61;

/** The most code points two subsets of a family may share and still be sorted by their cmaps (L-1). */
const SHARED_MAX = 4096;

/** Each code point range of a unicode-range, as [first, last]. */
export function unicodeRanges(range: string): [number, number][] {
  return range
    .split(',')
    .map((part) => part.trim().replace(/^U\+/i, ''))
    .filter(Boolean)
    .map((part): [number, number] => {
      if (part.includes('?')) {
        return [
          Number.parseInt(part.replace(/\?/g, '0'), 16),
          Number.parseInt(part.replace(/\?/g, 'F'), 16),
        ];
      }
      const [first, last = first] = part.split('-');
      return [Number.parseInt(first!, 16), Number.parseInt(last!, 16)];
    });
}

/**
 * `range` less every code point `others` cover, as a unicode-range, in
 * ascending order, or null when nothing is left.
 */
export function withoutRanges(range: string, others: readonly string[]): string | null {
  const taken = others.flatMap(unicodeRanges).sort((a, b) => a[0] - b[0]);
  const left: [number, number][] = [];
  for (const [first, last] of [...unicodeRanges(range)].sort((a, b) => a[0] - b[0])) {
    let from = first;
    for (const [start, end] of taken) {
      if (end < from || start > last) continue;
      if (start > from) left.push([from, start - 1]);
      from = Math.max(from, end + 1);
      if (from > last) break;
    }
    if (from <= last) left.push([from, last]);
  }
  if (left.length === 0) return null;
  return left
    .map(([first, last]) => (first === last ? hex(first) : `${hex(first)}-${hex(last).slice(2)}`))
    .join(', ');
}

/** Whether `range` covers the code point `point`. */
export const coversCodePoint = (range: string, point: number) =>
  unicodeRanges(range).some(([first, last]) => point >= first && point <= last);

/** Whether `range` meets any code point from `first` to `last`. */
export const meetsRange = (range: string, first: number, last: number) =>
  unicodeRanges(range).some(([start, end]) => start <= last && end >= first);

const hex = (point: number) => `U+${point.toString(16).toUpperCase().padStart(4, '0')}`;

const coversWeight = (asset: FontAsset, weight: number) =>
  Array.isArray(asset.weight)
    ? weight >= asset.weight[0] && weight <= asset.weight[1]
    : asset.weight === weight;

const weightDistance = (asset: FontAsset, weight: number) =>
  Array.isArray(asset.weight)
    ? Math.max(0, asset.weight[0] - weight, weight - asset.weight[1])
    : Math.abs(asset.weight - weight);

/**
 * The face a style's fallback is matched to: among `faces`, one style's,
 * the Latin face nearest weight 400, the one most text renders in, and the
 * upright where `faces` mixes styles.
 */
function representativeFace(faces: readonly FontAsset[]): FontAsset {
  const score = (asset: FontAsset) => [
    coversCodePoint(asset.unicodeRange, LATIN_PROBE) ? 0 : 1,
    asset.style === 'normal' ? 0 : 1,
    weightDistance(asset, 400),
  ];
  return [...faces].sort((a, b) => {
    const [x, y] = [score(a), score(b)];
    return x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]!;
  })[0]!;
}

/**
 * The one face a page preloads under `manifest` (at most one per page): the
 * body role's first shipped family, upright, at the body's weight, in the
 * subset that covers Latin. None when the body ships no such face.
 */
export function preloadFace(manifest: TypographyManifest): FontAsset | null {
  const body = manifest.roles.body;
  const families = manifest.fontAssets.map((asset) => asset.family);
  const first = shippedFamilies(String(body['font-family']), families)[0];
  if (!first) return null;
  return (
    manifest.fontAssets.find(
      (asset) =>
        asset.family === first &&
        asset.style === 'normal' &&
        coversWeight(asset, body['font-weight']) &&
        coversCodePoint(asset.unicodeRange, LATIN_PROBE),
    ) ?? null
  );
}

/** The shipped families `stack` lists, in its order, as `families` names them. */
function shippedFamilies(stack: string, families: readonly string[]): string[] {
  const found: string[] = [];
  for (const entry of stack.split(',').map((family) => family.trim())) {
    const name = entry.replace(/^"(.*)"$/, '$1');
    const match = families.find((family) => family.toLowerCase() === name.toLowerCase());
    if (match && !found.includes(match)) found.push(match);
  }
  return found;
}

/**
 * The width a pack's measures are counted in (R11): the body face's
 * average advance per em, the body's own shipped face at the body's weight
 * and size, else the first face in its stack that TEXT_FACES has, plus the
 * body's letter-spacing, which every character on the line takes. A pack
 * whose body names neither keeps its declared ch, with a warning, rather
 * than failing a build that compiled before measures were characters.
 */
function bodyAdvance(
  manifest: TypographyManifest,
  preload: FontAsset | null,
  metricsAt: (asset: FontAsset, weight: number, opsz?: number) => FontMetrics,
  pxOf: (size: unknown) => number | undefined,
):
  | { readonly face: string; readonly advance: number; readonly aspect: number | null }
  | { readonly warning: string } {
  const body = manifest.roles.body;
  const tracking = Number(
    /^(-?\d+(?:\.\d+)?)em$/.exec(String(body['letter-spacing']).trim())?.[1] ?? 0,
  );
  if (preload) {
    const metrics = metricsAt(preload, Number(body['font-weight']), pxOf(body['font-size']));
    if (metrics.latinWidth !== null) {
      return {
        face: preload.family,
        advance: metrics.latinWidth / metrics.unitsPerEm + tracking,
        aspect: metrics.xHeight === null ? null : metrics.xHeight / metrics.unitsPerEm,
      };
    }
  }
  const found = stackTextFace(String(body['font-family']));
  if (found) {
    return { face: found.face.names[0]!, advance: found.advance + tracking, aspect: found.aspect };
  }
  return {
    warning: `typography ${manifest.id}: its body stack names no face whose average advance is known, so its measures stay in ch, a 0's width, about 1.2 characters each. Ship the body face, or list a system face TEXT_FACES has (font-metrics.ts) in the body stack.`,
  };
}

/** How far a composition's measure scale may move a measure (R11.1): a scale of 0, or of 100, can't collapse or blow out a column. */
export const MEASURE_SCALE_RANGE = Object.freeze({ min: 0.5, max: 2 });

/** A measure in em, times the composition's measure scale, held to MEASURE_SCALE_RANGE. */
export function scaledMeasure(ems: string): string {
  return `calc(${ems} * clamp(${MEASURE_SCALE_RANGE.min}, var(${MEASURE_SCALE}, 1), ${MEASURE_SCALE_RANGE.max}))`;
}

/** A measure, a count of characters such as `68ch`, as that many average advances, in em. */
export function measureEm(measure: string, advance: number): string {
  const count = Number(/^(\d+(?:\.\d+)?)ch$/.exec(measure.trim())?.[1]);
  return `${Number((count * advance).toFixed(2))}em`;
}

/** The name of the fallback face the compiler writes for `family` in pack `id`. */
export const fallbackFamily = (id: string, family: string, alias: number) =>
  `${id} ${family} Fallback ${alias}`;

/** A share as a signed percentage, such as +0.12% or -5.18%. */
const signed = (share: number) => `${share >= 0 ? '+' : '-'}${Math.abs(share * 100).toFixed(2)}%`;

function compileTypography(manifest: TypographyManifest, dir: string): CompileResult {
  const problems: CompileProblem[] = [];
  const assets: PackFile[] = [];
  const faces: string[] = [];
  /** Each shipped file, in manifest order, before its @font-face is written, Latin last. */
  const webFaces: { readonly asset: FontAsset; readonly url: string; readonly weight: string }[] =
    [];
  const metrics = new Map<FontAsset, FontMetrics>();
  const fontBytes = new Map<FontAsset, Uint8Array>();
  const urls = new Map<FontAsset, string>();
  // A family named "<another family> Fallback 1" (or 2, or 3) would share a fallback face's name.
  const named = new Set(manifest.fontAssets.map((asset) => asset.family.toLowerCase()));
  manifest.fontAssets.forEach((asset, index) => {
    const alias = / fallback [123]$/i.exec(asset.family);
    const base = alias ? asset.family.slice(0, alias.index) : null;
    if (base !== null && named.has(base.toLowerCase())) {
      problems.push({
        file: 'manifest.json',
        pointer: `/fontAssets/${index}/family`,
        message: `names the family ${asset.family}, the name the compiler gives one of ${base}'s fallback faces.`,
        remedy:
          'Name the family something that does not end in " Fallback 1", " Fallback 2", or " Fallback 3".',
      });
    }
  });
  manifest.fontAssets.forEach((asset, index) => {
    const read = readPackFile(dir, asset.file, MAX_FONT_BYTES);
    const pointer = `/fontAssets/${index}/file`;
    if ('problem' in read) {
      problems.push({ file: 'manifest.json', pointer, ...read.problem });
      return;
    }
    const bytes = read.bytes;
    if (bytes.length < 4 || new TextDecoder().decode(bytes.subarray(0, 4)) !== 'wOF2') {
      problems.push({
        file: asset.file,
        pointer: '',
        message: `${asset.file} isn't a WOFF2 font: its first bytes aren't wOF2.`,
        remedy: 'Ship the font as WOFF2, or point fontAssets at the WOFF2 file.',
      });
      return;
    }
    try {
      metrics.set(asset, readFontMetrics(bytes, asset.file));
      fontBytes.set(asset, bytes);
    } catch (error) {
      if (!(error instanceof FontMetricsError)) throw error;
      problems.push({
        file: asset.file,
        pointer: '',
        message: error.message,
        remedy:
          'Vendor the file again from its package (pnpm catalog:fonts vendor), or ship a WOFF2 that decodes.',
      });
      return;
    }
    // Its declared range, held to its cmap over printable Basic Latin: a face
    // can't claim Latin text it has no glyphs for, so what a Latin page loads
    // by the declared ranges is what its files hold.
    const mapped = new Set(metrics.get(asset)!.basicLatin);
    const claimed: number[] = [];
    for (let point = BASIC_LATIN[0]; point <= BASIC_LATIN[1]; point += 1) {
      if (coversCodePoint(asset.unicodeRange, point) && !mapped.has(point)) claimed.push(point);
    }
    if (claimed.length > 0) {
      problems.push({
        file: 'manifest.json',
        pointer: `/fontAssets/${index}/unicodeRange`,
        message: `declares ${asset.file} covers ${claimed.length} Basic Latin code point(s) its cmap doesn't map: ${claimed.slice(0, 8).map(hex).join(', ')}${claimed.length > 8 ? ', ...' : ''}.`,
        remedy:
          "Declare the unicode-range the package's own stylesheet gives for the file (pnpm catalog:fonts vendor prints it), narrow the range to the code points the file maps, or vendor the subset that maps them.",
      });
      return;
    }
    const file = packFile(manifest.id, 'woff2', bytes);
    urls.set(asset, file.url);
    if (!assets.some((existing) => existing.name === file.name)) assets.push(file);
    const weight = Array.isArray(asset.weight) ? asset.weight.join(' ') : String(asset.weight);
    webFaces.push({ asset, url: file.url, weight });
  });
  // Fontsource's latin and latin-ext subsets both declare U+0304, U+0308,
  // U+0329, and U+2020 (†). Where two faces of a family at one weight and
  // style declare a code point, the browser draws it from the one declared
  // last that has it, and Chromium loads every face whose range meets the
  // text. So each family, weight, and style's Latin face comes after its
  // other subsets, as Fontsource's own stylesheets put it, and each shared
  // code point stays only on the face whose file maps it, by its cmap: the
  // Latin face where both do (U+0304, U+0308), else the subset that has the
  // glyph (U+2020: Fontsource's Latin files have no †, so a † loads the
  // latin-ext file, which draws it), else neither (U+0329, which no file
  // maps, falls through to the stack as before). So a code point loads one
  // file at most, and always the one that draws it (review L-1). The files
  // are unchanged; only what each is used for is.
  const group = (asset: FontAsset) =>
    `${asset.family}\u0000${JSON.stringify(asset.weight)}\u0000${asset.style}`;
  const groups = [...new Set(webFaces.map(({ asset }) => group(asset)))];
  const isLatin = (asset: FontAsset) => coversCodePoint(asset.unicodeRange, LATIN_PROBE);
  /** The code points each face gives up to another face of its group, or to none. */
  const givenUp = new Map<FontAsset, number[]>();
  for (const key of groups) {
    const members = webFaces.filter(({ asset }) => group(asset) === key).map(({ asset }) => asset);
    if (members.length < 2) continue;
    const shared = new Set<number>();
    members.forEach((a, i) => {
      for (const b of members.slice(i + 1)) {
        for (const [from, to] of unicodeRanges(a.unicodeRange)) {
          for (const [start, end] of unicodeRanges(b.unicodeRange)) {
            for (let point = Math.max(from, start); point <= Math.min(to, end); point += 1) {
              shared.add(point);
              if (shared.size > SHARED_MAX) return;
            }
          }
        }
      }
    });
    // Subsets that share more than a few marks and symbols aren't subsets of one font: left as declared.
    if (shared.size === 0 || shared.size > SHARED_MAX) continue;
    const points = [...shared].sort((a, b) => a - b);
    const maps = new Map(
      members.map((asset) => [asset, mappedCodePoints(fontBytes.get(asset)!, points, asset.file)]),
    );
    // The Latin face first, then the others in manifest order.
    const byPreference = [...members].sort((a, b) => Number(isLatin(b)) - Number(isLatin(a)));
    for (const point of points) {
      const declaring = members.filter((asset) => coversCodePoint(asset.unicodeRange, point));
      const owner = byPreference.find(
        (asset) => declaring.includes(asset) && maps.get(asset)!.has(point),
      );
      for (const asset of declaring) {
        if (asset !== owner) givenUp.set(asset, [...(givenUp.get(asset) ?? []), point]);
      }
    }
  }
  // A family that ships only italics, as field-serif's Fraunces Italic and
  // swiss-grotesque's Newsreader do: its faces take every weight from their
  // own to 900, so a bold in its roles sets in the real italic, never one the
  // browser fakes, while every other family's bolds synthesize as before.
  const italicOnly = new Set(
    [...new Set(manifest.fontAssets.map((asset) => asset.family))].filter((family) =>
      manifest.fontAssets
        .filter((asset) => asset.family === family)
        .every((asset) => asset.style === 'italic'),
    ),
  );
  for (const { asset, url, weight } of [...webFaces].sort(
    (a, b) =>
      groups.indexOf(group(a.asset)) - groups.indexOf(group(b.asset)) ||
      Number(isLatin(a.asset)) - Number(isLatin(b.asset)),
  )) {
    const lost = givenUp.get(asset);
    const range = lost ? withoutRanges(asset.unicodeRange, lost.map(hex)) : asset.unicodeRange;
    // A subset whose every code point another face draws loads for nothing: it gets no face.
    if (range === null) continue;
    const weights =
      italicOnly.has(asset.family) && !Array.isArray(asset.weight) && asset.weight < 900
        ? `${asset.weight} 900`
        : weight;
    faces.push(
      [
        ...(weights === weight
          ? []
          : [
              `/* ${asset.family} ships its italic alone: from ${asset.weight} to 900, so a bold is never faked. */`,
            ]),
        '@font-face {',
        `  font-family: "${manifest.id} ${asset.family}";`,
        `  src: url("${url}") format("woff2");`,
        `  font-weight: ${weights};`,
        `  font-style: ${asset.style};`,
        '  font-display: swap;',
        `  unicode-range: ${range};`,
        '}',
        '',
      ].join('\n'),
    );
  }
  if (problems.length > 0) return { ok: false, problems };

  const families = [...new Set(manifest.fontAssets.map((asset) => asset.family))];
  // A face's metrics as text at `weight` renders in it: a variable face at
  // that weight, through its HVAR, a static face as it is.
  const instances = new Map<string, FontMetrics>();
  // With an optical-size axis, at `opsz` too, the px size text renders at,
  // as font-optical-sizing: auto sets it.
  const metricsAt = (asset: FontAsset, weight: number, opsz?: number): FontMetrics => {
    if (!Array.isArray(asset.weight) && opsz === undefined) return metrics.get(asset)!;
    const key = `${manifest.fontAssets.indexOf(asset)}@${weight}/${opsz ?? ''}`;
    if (!instances.has(key)) {
      instances.set(
        key,
        readFontMetrics(fontBytes.get(asset)!, asset.file, {
          ...(Array.isArray(asset.weight) ? { wght: weight } : {}),
          ...(opsz === undefined ? {} : { opsz }),
        }),
      );
    }
    return instances.get(key)!;
  };
  /** A role's font size in px, at 16 px to the rem, or undefined for one that isn't a plain rem or px length. */
  const pxOf = (size: unknown) => {
    const match = /^(\d+(?:\.\d+)?)(rem|px)$/.exec(String(size).trim());
    return match ? Number(match[1]) * (match[2] === 'rem' ? 16 : 1) : undefined;
  };
  // Each family a role renders in gets up to three fallback aliases: the local
  // system faces of its class that fit it best, sized and spaced to take the
  // room its webfont does, so the swap moves nothing, the third only where
  // the first two have no Linux face. How many each family has, 0 to 3,
  // goes into its stacks.
  const fallbacks = new Map<string, number>();
  for (const family of families) {
    const roles = TYPOGRAPHY_ROLES.filter(
      (role) => shippedFamilies(String(manifest.roles[role]['font-family']), [family]).length > 0,
    );
    if (roles.length === 0) continue;
    const kind =
      roles
        .map((role) => stackClass(String(manifest.roles[role]['font-family'])))
        .find((found) => found !== null) ?? 'sans';
    const own = manifest.fontAssets.filter((asset) => asset.family === family);
    const styles = [...new Set(own.map((asset) => asset.style))].sort();
    // Each style's aliases are fitted to that style's own face: the upright's
    // to the system uprights, and the italic's to the system italics by the
    // italic webfont's metrics, so an italic takes the system italic that
    // fits it, not the one its upright's pick happens to have. A style with
    // no face that maps Latin lowercase gets no fallback, never one sized by
    // a guess. Its aliases are picked at the weight most text renders at.
    const aliasesOf = new Map(
      styles.map((style) => {
        const face = representativeFace(own.filter((asset) => asset.style === style));
        return [
          style,
          fallbackAliases(metricsAt(face, 400, pxOf(manifest.roles.body['font-size'])), kind, {
            italic: style === 'italic',
          }),
        ] as const;
      }),
    );
    const count = Math.max(...[...aliasesOf.values()].map((aliases) => aliases.length));
    if (count === 0) continue;
    // The fallbacks stand in only where the family's own faces would render,
    // so other text falls through to the stack's next family as declared.
    const range = [
      ...new Set(own.flatMap((asset) => asset.unicodeRange.split(',').map((part) => part.trim()))),
    ].join(', ');
    fallbacks.set(family, count);
    // One face per alias for each weight the family's roles set, and 400 and
    // 700 for text inside a role, in each style it ships, so a heading at 800
    // falls back to the system bold, sized to the webfont at 800, and an
    // italic to the system italic. Only at weights the family has a
    // face for: where it has none, the browser synthesizes the bold from its
    // nearest face, and from the fallback's nearest alike.
    const first = roles.filter(
      (role) =>
        shippedFamilies(String(manifest.roles[role]['font-family']), families)[0] === family,
    );
    const used = first.map((role) => Number(manifest.roles[role]['font-weight']));
    // The size a weight's face is measured at, for a font with an optical-size
    // axis: the largest any role sets at that weight, since a heading that
    // wraps is where a mismatch moves lines; the body's at a weight no role sets.
    const opszAt = (weight: number) => {
      const sizes = first
        .filter((role) => Number(manifest.roles[role]['font-weight']) === weight)
        .map((role) => pxOf(manifest.roles[role]['font-size']))
        .filter((size): size is number => size !== undefined);
      return sizes.length > 0 ? Math.max(...sizes) : pxOf(manifest.roles.body['font-size']);
    };
    const weightsOf = (style: string) => {
      const faces = own.filter((asset) => asset.style === style);
      const covered = [...new Set([...used, 400, 700])]
        .filter((weight) => faces.some((asset) => coversWeight(asset, weight)))
        .sort((a, b) => a - b);
      if (covered.length > 0) return covered;
      // None of them: the face nearest 400, at its own weight.
      const nearest = [...faces].sort(
        (a, b) => weightDistance(a, 400) - weightDistance(b, 400),
      )[0]!;
      return [Array.isArray(nearest.weight) ? nearest.weight[0] : nearest.weight];
    };
    for (let i = 0; i < count; i += 1) {
      for (const style of styles) {
        const aliases = aliasesOf.get(style)!;
        for (const weight of weightsOf(style)) {
          // The face text at this weight and style renders in: one that covers it, else the nearest.
          const source = [...own]
            .filter((asset) => asset.style === style)
            .sort((a, b) => weightDistance(a, weight) - weightDistance(b, weight))[0]!;
          const fallback = fallbackFace(aliases, i, metricsAt(source, weight, opszAt(weight)), {
            bold: weight >= 600,
            semibold: weight >= 600 && weight < 700,
            medium: weight >= 500 && weight < 600,
            italic: style === 'italic',
          });
          if (!fallback) continue;
          const fit = [
            ...(fallback.xHeightWidthError === null
              ? []
              : [`width per x-height ${signed(fallback.xHeightWidthError)}`]),
            `width ${signed(fallback.widthError)} before size-adjust`,
          ].join(', ');
          faces.push(
            [
              `/* ${fallback.name} at ${weight}: ${fit}. */`,
              '@font-face {',
              `  font-family: "${fallbackFamily(manifest.id, family, i + 1)}";`,
              `  src: ${fallback.locals.map((local) => `local("${local}")`).join(', ')};`,
              // An italic-only family's alias takes every weight from its own, as its faces do.
              `  font-weight: ${italicOnly.has(family) && weight < 900 ? `${weight} 900` : weight};`,
              `  font-style: ${style};`,
              `  size-adjust: ${fallback.overrides.sizeAdjust};`,
              `  ascent-override: ${fallback.overrides.ascentOverride};`,
              `  descent-override: ${fallback.overrides.descentOverride};`,
              `  line-gap-override: ${fallback.overrides.lineGapOverride};`,
              `  unicode-range: ${range};`,
              '}',
              '',
            ].join('\n'),
          );
        }
      }
    }
  }
  // A role whose stack leads with a family macOS, Windows, and iOS install
  // and Linux doesn't (LEADING_FAMILIES: Trebuchet MS, Verdana) gets two
  // metric fallbacks right behind it, as a shipped family does: Liberation
  // Sans, by its Arial-metric names, then DejaVu Sans, each face sized to
  // the family's own face at 400 and 700, upright and italic. Their range is
  // what the family draws, so where it's installed they're never used.
  const leading = new Map<string, readonly string[]>();
  for (const role of TYPOGRAPHY_ROLES) {
    const lead = leadingFamily(String(manifest.roles[role]['font-family']), families);
    if (!lead || leading.has(lead.name)) continue;
    leading.set(
      lead.name,
      LINUX_FACES.map((linux) => `${manifest.id} ${lead.name} ${linux.suffix}`),
    );
    for (const linux of LINUX_FACES) {
      for (const key of FACE_KEYS) {
        const own = lead.faces[key];
        const system = linux.faces[key];
        const overrides = leadingOverrides(own, system);
        const width =
          system.metrics.latinWidth /
            system.metrics.unitsPerEm /
            (own.latinWidth / own.unitsPerEm) -
          1;
        const weight = key.startsWith('bold') ? 700 : 400;
        faces.push(
          [
            `/* ${lead.name} at ${weight}${key === 'italic' || key === 'boldItalic' ? ' italic' : ''}, where it isn't installed: ${system.name}, width ${signed(width)} before size-adjust. */`,
            '@font-face {',
            `  font-family: "${manifest.id} ${lead.name} ${linux.suffix}";`,
            `  src: ${system.locals.map((local) => `local("${local}")`).join(', ')};`,
            `  font-weight: ${weight};`,
            `  font-style: ${key === 'italic' || key === 'boldItalic' ? 'italic' : 'normal'};`,
            `  size-adjust: ${overrides.sizeAdjust};`,
            `  ascent-override: ${overrides.ascentOverride};`,
            `  descent-override: ${overrides.descentOverride};`,
            `  line-gap-override: ${overrides.lineGapOverride};`,
            `  unicode-range: ${lead.unicodeRange};`,
            '}',
            '',
          ].join('\n'),
        );
      }
    }
  }
  const preload = preloadFace(manifest);
  const measured = bodyAdvance(manifest, preload, metricsAt, pxOf);
  const resolved = 'advance' in measured ? measured : null;
  const tokens = [
    ...TYPOGRAPHY_ROLES.flatMap((role) => [
      ...TYPOGRAPHY_FIELDS.map((field) => {
        const value = manifest.roles[role][field];
        return `  --type-${role}-${field}: ${
          field === 'font-family'
            ? namespacedStack(String(value), manifest.id, families, fallbacks, leading)
            : value
        };\n`;
      }),
      // A role's own aspect, when the pack sets one, over the platform's 0.5 (packs-plan 7.5).
      ...(manifest.roles[role]['font-size-adjust'] === undefined
        ? []
        : [`  ${sizeAdjustProperty(role)}: ${manifest.roles[role]['font-size-adjust']};\n`]),
    ]),
    ...TYPOGRAPHY_MEASURES.map(
      (measure) =>
        `  --type-measure-${measure}: ${
          resolved
            ? scaledMeasure(measureEm(manifest.measures[measure], resolved.advance))
            : manifest.measures[measure]
        };\n`,
    ),
    // The body face's own aspect, its x-height per em, for a composition that
    // applies font-size-adjust to scale the measures by (R11.1).
    ...(resolved?.aspect ? [`  ${BODY_ASPECT}: ${resolved.aspect.toFixed(4)};\n`] : []),
  ].join('');
  const note = resolved
    ? `/* Measures: characters at ${resolved.face}'s ${resolved.advance.toFixed(4)}em average advance, ${
        resolved.aspect
          ? `times ${MEASURE_SCALE}, which a composition that applies font-size-adjust sets from ${BODY_ASPECT}, ${resolved.aspect.toFixed(4)}`
          : `times ${MEASURE_SCALE}; its x-height isn't known, so there's no ${BODY_ASPECT} and the scale stays 1`
      }, held from ${MEASURE_SCALE_RANGE.min} to ${MEASURE_SCALE_RANGE.max}. */\n`
    : '/* Measures: in ch as declared, since no face in the body stack has a known advance. */\n';
  const css = `${header('Typography', manifest.id)}@layer typography {\n${indent(
    `${faces.join('')}${note}[data-typography="${manifest.id}"] {\n${tokens}}\n`,
    '  ',
  )}}\n`;
  return {
    ok: true,
    pack: {
      stylesheet: cssFile(manifest.id, css),
      assets,
      ...(preload ? { preload: urls.get(preload)! } : {}),
      ...('warning' in measured ? { warnings: [measured.warning] } : {}),
    },
  };
}

/**
 * A role's stack with each family the pack ships first, as "<pack id>
 * <family>", in the order the role lists them, each followed by its
 * fallback aliases, "<pack id> <family> Fallback 1" and "... Fallback 2",
 * as many as `fallbacks` gives it, then the declared fallbacks, a leading
 * system family's metric fallbacks right behind it, as `leading` names
 * them (leadingFamily()). A pack's own name can't match an installed font
 * or another pack's face, so two profiles side by side never share one.
 */
export function namespacedStack(
  stack: string,
  id: string,
  families: readonly string[],
  fallbacks: ReadonlyMap<string, number> = new Map(),
  leading: ReadonlyMap<string, readonly string[]> = new Map(),
): string {
  const shipped: string[] = [];
  const fallback: string[] = [];
  const lead = leadingFamily(stack, families);
  for (const [index, entry] of stack
    .split(',')
    .map((family) => family.trim())
    .entries()) {
    const name = entry.replace(/^"(.*)"$/, '$1');
    const match = families.find((family) => family.toLowerCase() === name.toLowerCase());
    if (match) {
      shipped.push(`"${id} ${match}"`);
      for (let alias = 1; alias <= (fallbacks.get(match) ?? 0); alias += 1) {
        shipped.push(`"${fallbackFamily(id, match, alias)}"`);
      }
    } else {
      fallback.push(entry);
      // A leading system family's metric fallbacks, right behind it.
      if (index === 0 && lead)
        fallback.push(...(leading.get(lead.name) ?? []).map((n) => `"${n}"`));
    }
  }
  return [...shipped, ...fallback].join(', ');
}

function compileLanguage(manifest: DesignLanguageManifest, dir: string): CompileResult {
  const scope = `[data-design-language="${manifest.id}"]`;
  let rules = '';
  if (manifest.stylesheet) {
    const read = readPackFile(dir, manifest.stylesheet, Number.POSITIVE_INFINITY);
    if ('problem' in read) {
      return {
        ok: false,
        problems: [{ file: 'manifest.json', pointer: '/stylesheet', ...read.problem }],
      };
    }
    const sheet = readLanguageStylesheet(
      new TextDecoder('utf-8', { fatal: false }).decode(read.bytes),
      { packId: manifest.id },
    );
    if (!sheet.ok) {
      return {
        ok: false,
        problems: sheet.problems.map(({ line, column, message, rule }) => ({
          file: manifest.stylesheet!,
          pointer: '',
          message: `${manifest.stylesheet}:${line}:${column} ${message}`,
          remedy: "Change the rule to style [data-ui-slot] parts through the language's tokens.",
          ...(rule ? { rule } : {}),
        })),
      };
    }
    if (sheet.nodes.length > 0) {
      rules = `@scope (${scope}) to ([data-appearance-boundary]) {\n${writeStyleNodes(sheet.nodes, '  ')}}\n`;
    }
  }
  // A one-length token's bare 0 is written 0px, so it stays valid inside calc() (#11).
  const value = (key: LanguageKey) =>
    LENGTH_KEYS.has(key) && manifest.tokens[key].trim() === '0' ? '0px' : manifest.tokens[key];
  // How far its raised shadow's hard edge reaches, which a tooltip stands off by too (#11, row 17).
  const reach = shadowEdgeReach(manifest.tokens['shadow-raised']);
  if (reach === null) {
    return {
      ok: false,
      problems: [
        {
          file: 'manifest.json',
          pointer: '/tokens/shadow-raised',
          message: "shadow-raised has a layer whose lengths the compiler can't read.",
          remedy:
            'Write each layer as two to four px or rem lengths and one color, optionally inset.',
        },
      ],
    };
  }
  const tokens = `${LANGUAGE_KEYS.map((key) => `  --ui-${key}: ${value(key)};\n`).join('')}  ${SHADOW_RAISED_REACH}: ${reach}px;\n`;
  // K-4 (a): the motion tokens on the document root's view-transition tree, which hangs from the root.
  const motion = LANGUAGE_KEYS.filter((key) => key.startsWith('motion-'))
    .map((key) => `  --ui-${key}: ${value(key)};\n`)
    .join('');
  const css = `${header('Design language', manifest.id)}@layer language {\n${indent(
    `${scope} {\n${tokens}}\n${rootTransition(scope)} {\n${motion}}\n${rules}`,
    '  ',
  )}}\n`;
  return { ok: true, pack: { stylesheet: cssFile(manifest.id, css), assets: [] } };
}

/** A file a manifest names, read from inside the pack's directory, or why it can't be. */
function readPackFile(
  dir: string,
  file: string,
  max: number,
): { bytes: Uint8Array } | { problem: { message: string; remedy: string } } {
  const target = path.resolve(dir, file);
  let real: string;
  try {
    real = fs.realpathSync(target);
  } catch {
    return {
      problem: {
        message: `names ${file}, which the pack doesn't have.`,
        remedy: `Add ${file} to the pack's directory, or point the manifest at a file it has.`,
      },
    };
  }
  const root = fs.realpathSync(dir);
  if (real !== root && !real.startsWith(`${root}${path.sep}`)) {
    return {
      problem: {
        message: `names ${file}, which resolves outside the pack's directory.`,
        remedy: "Keep the pack's files inside its directory, with no link leading out.",
      },
    };
  }
  const stat = fs.statSync(real);
  if (!stat.isFile()) {
    return {
      problem: { message: `names ${file}, which isn't a file.`, remedy: 'Point it at a file.' },
    };
  }
  if (stat.size > max) {
    return {
      problem: {
        message: `names ${file}, which is ${Math.ceil(stat.size / 1024)} KB, over the ${max / 1024} KB a pack's file may be.`,
        remedy: 'Subset the font to the scripts the profile declares.',
      },
    };
  }
  return { bytes: new Uint8Array(fs.readFileSync(real)) };
}
