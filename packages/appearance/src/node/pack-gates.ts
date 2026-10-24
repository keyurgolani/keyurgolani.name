// The per-axis pack gates (#20): what each pack's compiled output must hold
// on its own, whatever it's combined with. A failure names one pack, its
// axis, and the token role or file it's about, so the pack is what's
// excluded, never a pair. `pnpm check:appearance` runs them over every pack
// registry generation compiled, beside #19's computed contrast gate.
//
// - token-coverage: every block that sets the axis's tokens sets all of
//   #19's contract roles for it: each --color-<role> in each scheme set,
//   each --type-<role>-<field> and --type-measure-<measure> in a profile,
//   and each --ui-<key> in a language;
// - bundle-size: the stylesheet within the pack's css budget, its fonts
//   within its font budget, and its declared cost what it ships;
// - boundary-isolation: nothing outside the pack's own layer and scope.
//   The file starts with the layer order and opens one layer, its axis's;
//   every rule selects the pack's own boundary attribute; a language's own
//   rules sit in its one @scope; and every url() is one of its own fonts.
//
// The compiled stylesheet is the compiler's own output, from values the
// validator and #19's reader already passed, so these read its structure
// directly: they check the compiler, and catch a value that got past both.

import { gzipSync } from 'node:zlib';
import type { PackAxis, PackKind } from '../axes';
import { LAYER_ORDER, startsWithLayerOrder } from '../layers';
import type { ColorSchemeManifest, DesignLanguageManifest, TypographyManifest } from '../manifests';
import {
  COLOR_ROLES,
  LANGUAGE_KEYS,
  TYPOGRAPHY_FIELDS,
  TYPOGRAPHY_MEASURES,
  TYPOGRAPHY_ROLES,
} from '../tokens';
import { AXIS_BY_KIND, type PackManifest } from '../validate-pack';

export const PACK_GATES = ['token-coverage', 'bundle-size', 'boundary-isolation'] as const;
export type PackGate = (typeof PACK_GATES)[number];

/** A pack gate's failure: one pack, and the role or file it's about. */
export interface PackGateFailure {
  readonly gate: PackGate;
  readonly pack: string;
  readonly axis: PackAxis;
  /** The token role it's about, such as text-primary, when it's about one. */
  readonly role?: string;
  readonly message: string;
}

/** A compiled file of the pack's, as registry generation gives it. */
export interface GatedFile {
  readonly url: string;
  readonly bytes: Uint8Array;
}

/** One compiled pack, as the gates read it. */
export interface GatedPack {
  readonly kind: PackKind;
  readonly manifest: PackManifest;
  /** Its compiled stylesheet: null for a generator scheme, which compiles from what it generates. */
  readonly stylesheet: GatedFile | null;
  /** The fonts it ships. */
  readonly assets: readonly GatedFile[];
}

/** A block of the compiled stylesheet: a rule, with its declarations, or an at-rule with its children. */
interface Block {
  readonly prelude: string;
  readonly declarations: readonly string[];
  readonly children: readonly Block[];
}

/** The compiled stylesheet's blocks, read by its braces, skipping its strings. */
function blocks(css: string): { top: Block[]; statements: string[] } {
  let index = 0;
  const statements: string[] = [];
  const read = (): Block[] => {
    const found: Block[] = [];
    let text = '';
    const declarations: string[] = [];
    while (index < css.length) {
      const character = css[index]!;
      if (character === '"' || character === "'") {
        const end = css.indexOf(character, index + 1);
        text += css.slice(index, end < 0 ? css.length : end + 1);
        index = end < 0 ? css.length : end + 1;
        continue;
      }
      if (css.startsWith('/*', index)) {
        const end = css.indexOf('*/', index + 2);
        index = end < 0 ? css.length : end + 2;
        continue;
      }
      index += 1;
      if (character === '{') {
        const prelude = text.trim();
        text = '';
        const start = index;
        const children = read();
        // A block with no children holds declarations: split what read() left.
        const body = css.slice(start, index - 1);
        const own = children.length === 0 ? splitDeclarations(body) : [];
        found.push({ prelude, declarations: own, children });
      } else if (character === '}') {
        if (text.trim()) declarations.push(text.trim());
        return found;
      } else if (character === ';') {
        if (text.trim().startsWith('@')) statements.push(text.trim());
        text = '';
      } else {
        text += character;
      }
    }
    return found;
  };
  const top = read();
  return { top, statements };
}

function splitDeclarations(body: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: string | null = null;
  let depth = 0;
  for (const character of body) {
    if (quote) {
      current += character;
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ';' && depth === 0) {
      if (current.trim()) out.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** Every rule block under `list`, with the at-rule preludes it's nested in, outermost first. */
function rules(
  list: readonly Block[],
  within: readonly string[] = [],
): { block: Block; within: string[] }[] {
  return list.flatMap((block) =>
    block.prelude.startsWith('@')
      ? rules(block.children, [...within, block.prelude])
      : [{ block, within: [...within] }],
  );
}

const property = (declaration: string) => declaration.slice(0, declaration.indexOf(':')).trim();

/** The custom properties an axis's tokens are, every one the contract defines. */
function contractTokens(kind: PackKind): readonly string[] {
  if (kind === 'color-scheme') return COLOR_ROLES.map((role) => `--color-${role}`);
  if (kind === 'typography') {
    return [
      ...TYPOGRAPHY_ROLES.flatMap((role) =>
        TYPOGRAPHY_FIELDS.map((field) => `--type-${role}-${field}`),
      ),
      ...TYPOGRAPHY_MEASURES.map((measure) => `--type-measure-${measure}`),
    ];
  }
  return LANGUAGE_KEYS.map((key) => `--ui-${key}`);
}

const TOKEN_PREFIX: Readonly<Record<PackKind, string>> = {
  'color-scheme': '--color-',
  typography: '--type-',
  'design-language': '--ui-',
};

const ATTRIBUTE: Readonly<Record<PackKind, string>> = {
  'color-scheme': 'data-color-scheme',
  typography: 'data-typography',
  'design-language': 'data-design-language',
};

const LAYER: Readonly<Record<PackKind, string>> = {
  'color-scheme': 'scheme',
  typography: 'typography',
  'design-language': 'language',
};

/** The role a token names: text-primary for --color-text-primary, body for --type-body-font-size, radius-card for --ui-radius-card. */
function roleOf(kind: PackKind, token: string): string {
  if (kind === 'typography') {
    const name = token.slice('--type-'.length);
    return TYPOGRAPHY_ROLES.find((role) => name.startsWith(`${role}-`)) ?? name;
  }
  return token.slice(TOKEN_PREFIX[kind].length);
}

/** Runs every pack gate over one compiled pack. */
export function gatePack(pack: GatedPack): PackGateFailure[] {
  const { kind, manifest } = pack;
  const axis = AXIS_BY_KIND[kind];
  const failures: PackGateFailure[] = [];
  const fail = (gate: PackGate, message: string, role?: string) =>
    failures.push({ gate, pack: manifest.id, axis, ...(role ? { role } : {}), message });

  // bundle-size: what it ships, against what it declares. #6 counts a
  // stylesheet's budget in gzip bytes at level 9, as ASSET_MANIFEST does.
  const fontBytes = pack.assets.reduce((sum, file) => sum + file.bytes.length, 0);
  const budgets = manifest.budgets;
  const cssBytes = pack.stylesheet ? gzipSync(pack.stylesheet.bytes, { level: 9 }).byteLength : 0;
  if (budgets.css !== undefined && cssBytes > budgets.css) {
    fail(
      'bundle-size',
      `compiles to a stylesheet of ${cssBytes} gzip bytes, over its css budget of ${budgets.css}.`,
    );
  }
  if (budgets.font !== undefined && fontBytes > budgets.font) {
    fail(
      'bundle-size',
      `ships ${fontBytes} bytes of fonts, over its font budget of ${budgets.font} bytes.`,
    );
  }
  if (pack.assets.length !== manifest.cost.assets || fontBytes !== manifest.cost.assetBytes) {
    fail(
      'bundle-size',
      `declares ${manifest.cost.assets} assets of ${manifest.cost.assetBytes} bytes, and ships ${pack.assets.length} of ${fontBytes}.`,
    );
  }

  if (!pack.stylesheet) {
    // Only a generator scheme compiles nothing until it generates.
    if (!(kind === 'color-scheme' && (manifest as ColorSchemeManifest).generator)) {
      fail('token-coverage', 'compiles no stylesheet, so it sets none of its tokens.');
    }
    return failures;
  }
  const css = new TextDecoder().decode(pack.stylesheet.bytes);
  const { top, statements } = blocks(css);
  const ruleBlocks = rules(top);

  // token-coverage: each block that sets the axis's tokens sets every one.
  const tokens = contractTokens(kind);
  const tokenBlocks = ruleBlocks.filter(({ block }) =>
    block.declarations.some((declaration) => property(declaration).startsWith(TOKEN_PREFIX[kind])),
  );
  if (tokenBlocks.length === 0)
    fail('token-coverage', `sets none of its ${TOKEN_PREFIX[kind]}* tokens.`);
  for (const { block } of tokenBlocks) {
    const set = new Set(block.declarations.map(property));
    for (const token of tokens) {
      if (!set.has(token)) {
        fail(
          'token-coverage',
          `${block.prelude.split('\n')[0]} doesn't set ${token}.`,
          roleOf(kind, token),
        );
      }
    }
    for (const name of set) {
      if (name.startsWith('--') && !tokens.includes(name)) {
        fail(
          'boundary-isolation',
          `${block.prelude.split('\n')[0]} sets ${name}, which isn't one of its axis's tokens.`,
        );
      }
    }
  }

  // boundary-isolation: its layer, its scope, its attribute, its files.
  if (!startsWithLayerOrder(css)) fail('boundary-isolation', "doesn't start with the layer order.");
  const layerStatements = statements.filter((statement) => /^@layer\b/i.test(statement));
  if (layerStatements.length !== 1 || layerStatements[0] !== LAYER_ORDER.slice(0, -1)) {
    fail(
      'boundary-isolation',
      `has ${layerStatements.length} @layer statements, and only the layer order may be one.`,
    );
  }
  const layers = top.filter((block) => /^@layer\b/i.test(block.prelude));
  if (layers.length !== 1 || layers[0]!.prelude !== `@layer ${LAYER[kind]}` || top.length !== 1) {
    fail('boundary-isolation', `puts its rules somewhere but one @layer ${LAYER[kind]} block.`);
  }
  const own = `[${ATTRIBUTE[kind]}="${manifest.id}"]`;
  const scope = `@scope (${own}) to ([data-appearance-boundary])`;
  for (const { block, within } of ruleBlocks) {
    const nested = within.filter(
      (prelude) => !prelude.startsWith('@layer') && !prelude.startsWith('@media'),
    );
    const inScope = nested.length > 0 && nested[0] === scope;
    if (nested.some((prelude) => /^@scope\b/i.test(prelude) && prelude !== scope)) {
      fail(
        'boundary-isolation',
        `opens a scope of its own: ${nested.find((prelude) => /^@scope/i.test(prelude))}.`,
      );
      continue;
    }
    if (kind === 'design-language' && inScope) continue;
    if (block.prelude === '@font-face' || within.at(-1) === '@font-face') continue;
    const selectors = block.prelude.split(',').map((selector) => selector.trim());
    for (const selector of selectors) {
      const owned =
        selector.startsWith(own) ||
        (kind === 'color-scheme' &&
          selector.startsWith(':root:has([data-appearance-boundary="document"]') &&
          selector.includes(own));
      if (!owned) {
        fail('boundary-isolation', `has a rule for ${selector}, outside its own boundary, ${own}.`);
      }
    }
  }
  const scopes = (function count(list: readonly Block[]): number {
    return list.reduce(
      (sum, block) => sum + (/^@scope\b/i.test(block.prelude) ? 1 : 0) + count(block.children),
      0,
    );
  })(top);
  if (kind !== 'design-language' && scopes > 0)
    fail('boundary-isolation', 'opens a scope, which only a language has.');
  if (scopes > 1) fail('boundary-isolation', `opens ${scopes} scopes, and a language has one.`);
  const declared = new Set(pack.assets.map(({ url }) => url));
  for (const [, , target] of css.matchAll(/url\(\s*(["']?)([^"')\s]*)\1\s*\)/gi)) {
    if (!declared.has(target!)) {
      fail('boundary-isolation', `loads ${target}, which isn't one of its own files.`);
    }
  }
  if (/@import\b/i.test(css)) fail('boundary-isolation', 'imports another stylesheet.');
  if (css.includes('\\'))
    fail('boundary-isolation', 'holds a backslash escape, which hides what a name or value is.');
  return failures;
}

/** The manifests a gated pack can have, for callers that hold them typed. */
export type GatedManifest = ColorSchemeManifest | DesignLanguageManifest | TypographyManifest;
