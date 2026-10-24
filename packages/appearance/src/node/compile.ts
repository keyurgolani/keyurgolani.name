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
//   color-scheme and background-color, so canvas, scrollbars, and form
//   controls match from first paint. One file holds every mode.
// - A typography profile scopes its role tokens to [data-typography], with
//   each @font-face family namespaced "<pack id> <family>" ahead of the
//   declared fallback stack.
// - A design language gets its tokens, and its stylesheet inside
//   @scope ([data-design-language="<id>"]) to ([data-appearance-boundary]),
//   written from what readLanguageStylesheet() read.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DisplayMode } from '@portfolio/schema';
import type { PackKind } from '../axes';
import { anchorV1 } from '../derive';
import { LAYER_ORDER } from '../layers';
import type { ColorSchemeManifest, DesignLanguageManifest, TypographyManifest } from '../manifests';
import type { GeneratedScheme } from '../resolve-tokens';
import {
  isHighContrastSet,
  printSet,
  schemeSets,
  setPolarity,
  type ColorSetName,
  type SchemeSets,
} from '../sets';
import {
  COLOR_ROLES,
  LANGUAGE_KEYS,
  TYPOGRAPHY_FIELDS,
  TYPOGRAPHY_MEASURES,
  TYPOGRAPHY_ROLES,
  type ColorTokens,
} from '../tokens';
import { SCRIPT_FILE, type PackManifest } from '../validate-pack';
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
    const css = compileSchemeStylesheet(manifest.id, schemeSets(sets, manifest.highContrast));
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

/** A scheme's base sets: authored, or anchor-v1's from its anchors. Null for a generator scheme. */
export function schemeBaseSets(
  manifest: ColorSchemeManifest,
): { light?: ColorTokens; dark?: ColorTokens } | null {
  if (manifest.generator) return null;
  const sets: { light?: ColorTokens; dark?: ColorTokens } = {};
  for (const mode of ['light', 'dark'] as const) {
    const anchors = manifest.anchors?.[mode];
    if (anchors) sets[mode] = anchorV1(anchors, mode);
    else if (manifest[mode]) sets[mode] = manifest[mode];
  }
  return sets;
}

/** The stylesheet of a generator scheme's generated sets, which Slice 4's route and #7's grant path serve. */
export function compileGeneratedScheme(id: string, generated: GeneratedScheme): string {
  return compileSchemeStylesheet(id, schemeSets(generated));
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
      const blocks = schemeBlocks(assignments, sets);
      return media === null ? blocks : `@media ${media} {\n${indent(blocks, '  ')}}\n`;
    })
    .join('');
  return `${header('Color scheme', id)}@layer scheme {\n${indent(body, '  ')}}\n`;
}

/** A context's rules: the boundary's tokens per set, then the document root's two properties per set. */
function schemeBlocks(assignments: readonly Assignment[], sets: SchemeSets): string {
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
      )} {\n  color-scheme: ${setPolarity(set)};\n  background-color: ${sets[set]!.canvas};\n}\n`;
  }
  return css;
}

function compileTypography(manifest: TypographyManifest, dir: string): CompileResult {
  const problems: CompileProblem[] = [];
  const assets: PackFile[] = [];
  const faces: string[] = [];
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
    const file = packFile(manifest.id, 'woff2', bytes);
    if (!assets.some((existing) => existing.name === file.name)) assets.push(file);
    const weight = Array.isArray(asset.weight) ? asset.weight.join(' ') : String(asset.weight);
    faces.push(
      [
        '@font-face {',
        `  font-family: "${manifest.id} ${asset.family}";`,
        `  src: url("${file.url}") format("woff2");`,
        `  font-weight: ${weight};`,
        `  font-style: ${asset.style};`,
        '  font-display: swap;',
        `  unicode-range: ${asset.unicodeRange};`,
        '}',
        '',
      ].join('\n'),
    );
  });
  if (problems.length > 0) return { ok: false, problems };

  const families = manifest.fontAssets.map((asset) => asset.family);
  const tokens = [
    ...TYPOGRAPHY_ROLES.flatMap((role) =>
      TYPOGRAPHY_FIELDS.map((field) => {
        const value = manifest.roles[role][field];
        return `  --type-${role}-${field}: ${
          field === 'font-family' ? namespacedStack(String(value), manifest.id, families) : value
        };\n`;
      }),
    ),
    ...TYPOGRAPHY_MEASURES.map(
      (measure) => `  --type-measure-${measure}: ${manifest.measures[measure]};\n`,
    ),
  ].join('');
  const css = `${header('Typography', manifest.id)}@layer typography {\n${indent(
    `${faces.join('')}[data-typography="${manifest.id}"] {\n${tokens}}\n`,
    '  ',
  )}}\n`;
  return { ok: true, pack: { stylesheet: cssFile(manifest.id, css), assets } };
}

/**
 * A role's stack with each family the pack ships first, as "<pack id>
 * <family>", in the order the role lists them, then the declared
 * fallbacks. A pack's own name can't match an installed font or another
 * pack's face, so two profiles side by side never share one.
 */
export function namespacedStack(stack: string, id: string, families: readonly string[]): string {
  const shipped: string[] = [];
  const fallback: string[] = [];
  for (const entry of stack.split(',').map((family) => family.trim())) {
    const name = entry.replace(/^"(.*)"$/, '$1');
    const match = families.find((family) => family.toLowerCase() === name.toLowerCase());
    if (match) shipped.push(`"${id} ${match}"`);
    else fallback.push(entry);
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
  const tokens = LANGUAGE_KEYS.map((key) => `  --ui-${key}: ${manifest.tokens[key]};\n`).join('');
  const css = `${header('Design language', manifest.id)}@layer language {\n${indent(
    `${scope} {\n${tokens}}\n${rules}`,
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
