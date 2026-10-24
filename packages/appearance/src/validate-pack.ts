// validatePackManifest() (#19, Slice 1, item 2): a pack's manifest.json
// against token contract 1, in #5's ManifestDiagnostic shape and codes, so
// registry generation (Slice 2) reports a pack's problems the way it reports
// a variant's. The token contract comes first, since another contract's
// tokens mean something else; then the shape; then the rules the shape
// can't state.

import { z } from 'zod';
import { allowedKeysAt, closestWord, isPlainObject, REGISTRY_ID_PATTERN } from '@portfolio/schema';
import {
  FIRST_PARTY_SCOPE,
  MANIFEST_CODES,
  packageScope,
  TOKEN_CONTRACT_VERSION,
  toPointer,
  type ManifestCode,
  type ManifestDiagnostic,
} from '@portfolio/variant-contract';
import {
  AXIS_NAMES,
  PACK_AXES,
  PACK_KIND_BY_AXIS,
  PLATFORM_DEFAULTS,
  type BaseMode,
  type PackAxis,
  type PackKind,
} from './axes';
import {
  ColorSchemeManifestSchema,
  DesignLanguageManifestSchema,
  PACK_TIERS,
  TypographyManifestSchema,
  type AccessibilityCheck,
  type ColorSchemeManifest,
  type DesignLanguageManifest,
  type TypographyManifest,
} from './manifests';

/** Each pack kind's axis. */
export const AXIS_BY_KIND = Object.fromEntries(
  PACK_AXES.map((axis) => [PACK_KIND_BY_AXIS[axis], axis]),
) as Readonly<Record<PackKind, PackAxis>>;

export interface PackContext {
  /** The `portfolio.kind` of the package that holds the pack. */
  readonly kind: PackKind;
  /** The package's npm name, which the id rules read. */
  readonly packageName: string;
  /** The package's `exports`, which each enhancement's subpath must be in. Omitted, those go unchecked. */
  readonly exports?: unknown;
  /** The package's `main`, `module`, and `browser` fields, as its package.json gives them (#20). Omitted, those go unchecked. */
  readonly entryPoints?: {
    readonly main?: unknown;
    readonly module?: unknown;
    readonly browser?: unknown;
  };
}

export interface PackManifestByKind {
  readonly 'design-language': DesignLanguageManifest;
  readonly 'color-scheme': ColorSchemeManifest;
  readonly typography: TypographyManifest;
}

export type PackManifest = PackManifestByKind[PackKind];

export type PackResult<K extends PackKind = PackKind> =
  | {
      readonly ok: true;
      readonly manifest: PackManifestByKind[K];
      /** Warnings only. */
      readonly diagnostics: readonly ManifestDiagnostic[];
      readonly notChecked: readonly string[];
    }
  | {
      readonly ok: false;
      /** At least one error. */
      readonly diagnostics: readonly ManifestDiagnostic[];
      readonly notChecked: readonly string[];
    };

const SCHEMAS = {
  'design-language': DesignLanguageManifestSchema,
  'color-scheme': ColorSchemeManifestSchema,
  typography: TypographyManifestSchema,
} as const satisfies Record<PackKind, z.ZodTypeAny>;

/** What each kind may leave out, for the remedy when a required field is missing. */
const OPTIONAL_FIELDS: Readonly<Record<PackKind, string>> = {
  'design-language': 'Only stylesheet and enhancements are optional.',
  'color-scheme':
    'A scheme gives token sets, anchors, or a generator, and highContrast and swatches are optional.',
  typography: 'Every field of a typography pack is required.',
};

/** The first-party fallback packs' ids, which only @portfolio/* packages may take. */
const RESERVED_PACK_IDS: readonly string[] = PACK_AXES.map((axis) => PLATFORM_DEFAULTS[axis]);

type Path = readonly (string | number)[];
type Report = (
  code: ManifestCode,
  path: Path,
  message: string,
  remedy: string,
  extra?: { expected?: string; actual?: string },
) => void;

/** Validates a parsed pack manifest.json against token contract 1. It never throws. */
export function validatePackManifest<K extends PackKind>(
  input: unknown,
  context: PackContext & { readonly kind: K },
): PackResult<K> {
  const diagnostics: ManifestDiagnostic[] = [];
  const notChecked: string[] = [];
  const report: Report = (code, path, message, remedy, extra = {}) => {
    const pointer = toPointer(path);
    diagnostics.push({
      code,
      severity: MANIFEST_CODES[code],
      pointer,
      // Each record names the pack, its axis, and the field (#20).
      message: `${subject}: ${pointer || 'the manifest'} ${message}`,
      ...extra,
      remedy,
    });
  };
  const result = (manifest?: PackManifestByKind[K]): PackResult<K> =>
    manifest && !diagnostics.some(({ severity }) => severity === 'error')
      ? { ok: true, manifest, diagnostics, notChecked }
      : { ok: false, diagnostics, notChecked };

  const named =
    isPlainObject(input) && typeof input.id === 'string' && REGISTRY_ID_PATTERN.test(input.id)
      ? input.id
      : null;
  const subject = `The ${AXIS_NAMES[AXIS_BY_KIND[context.kind]]} ${named ?? 'pack'} in ${context.packageName}`;

  if (!isPlainObject(input)) {
    report('manifest.invalid', [], 'must be a JSON object.', 'Write manifest.json as one object.');
    return result();
  }
  if (input.tier === 'research') {
    report(
      'manifest.invalid',
      ['tier'],
      "is research, and a Research record isn't a pack: registry generation never registers one.",
      "Move it to the package's research/<id>.json as a research record, or give it a shipping tier: stable, extended, or experimental.",
      { expected: PACK_TIERS.join(' | '), actual: 'research' },
    );
    return result();
  }
  if (
    typeof input.tokenContract === 'number' &&
    Number.isInteger(input.tokenContract) &&
    input.tokenContract !== TOKEN_CONTRACT_VERSION
  ) {
    report(
      'manifest.token-contract-mismatch',
      ['tokenContract'],
      `is ${input.tokenContract}, and this host's appearance tokens are contract ${TOKEN_CONTRACT_VERSION}.`,
      `Build the pack against token contract ${TOKEN_CONTRACT_VERSION}, or install a host on token contract ${input.tokenContract}.`,
      { expected: String(TOKEN_CONTRACT_VERSION), actual: String(input.tokenContract) },
    );
    return result();
  }

  const schema: z.ZodTypeAny = SCHEMAS[context.kind];
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) shapeIssue(issue, schema, input, context.kind, report);
    return result();
  }
  const manifest = parsed.data as PackManifestByKind[K];
  const id = packIdProblem(manifest.id, context.packageName);
  if (id)
    report(id.code, ['id'], id.message, id.remedy, { expected: id.expected, actual: manifest.id });
  if (context.kind === 'color-scheme') checkScheme(manifest as ColorSchemeManifest, report);
  checkNoScript(context, report);
  if (context.kind === 'typography') checkTypography(manifest as TypographyManifest, report);
  checkGovernance(manifest, context, report);
  return result(manifest);
}

/** The accessibility checks each axis's packs are held to, each a gate check:appearance runs. */
export const REQUIRED_CHECKS: Readonly<Record<PackKind, readonly AccessibilityCheck[]>> = {
  'design-language': ['contrast', 'focus-ring', 'stylesheet-lint'],
  'color-scheme': ['contrast', 'hierarchy'],
  typography: ['contrast', 'text-size'],
};

/** The budgets no pack may spend: no pack ships JavaScript. */
const NO_SCRIPT_BUDGETS = ['js', 'enhancement'] as const;

const sameName = (a: string, b: string) =>
  a.toLowerCase().replace(/\s+/g, ' ') === b.toLowerCase().replace(/\s+/g, ' ');

/**
 * #20's tier and provenance policy, past the shape: who may claim Stable,
 * which license state fits which pack, the modes a pack covers, the
 * evidence it's held to, and that it carries no script.
 */
function checkGovernance(manifest: PackManifest, context: PackContext, report: Report) {
  const thirdParty = packageScope(context.packageName) !== FIRST_PARTY_SCOPE;
  const { license } = manifest.provenance;
  if (thirdParty && manifest.tier === 'stable') {
    report(
      'manifest.invalid',
      ['tier'],
      "is stable, and only the platform's own @portfolio/* packs can claim Stable.",
      'Ship it as extended or experimental.',
      { expected: 'extended | experimental', actual: 'stable' },
    );
  }
  if (thirdParty && license === 'first-party') {
    report(
      'manifest.invalid',
      ['provenance', 'license'],
      "is first-party, which names this repository's own MIT, and the pack comes from another package.",
      "Name the pack's own license: an upstream SPDX identifier, or another license state.",
      { actual: license },
    );
  }
  if (license === 'provided-by-operating-system') {
    const typography = context.kind === 'typography';
    if (!typography || (manifest as TypographyManifest).fontAssets.length > 0) {
      report(
        'manifest.invalid',
        ['provenance', 'license'],
        typography
          ? 'is provided-by-operating-system, and the profile ships font files of its own.'
          : 'is provided-by-operating-system, which only a typography profile that ships no font file can be.',
        typography
          ? "Name the fonts' own license, such as OFL-1.1, or remove the fontAssets."
          : "Name the pack's own license state.",
        { actual: license },
      );
    }
  }
  const generator =
    context.kind === 'color-scheme' && (manifest as ColorSchemeManifest).generator !== undefined;
  if ((license === 'generated') !== generator) {
    report(
      'manifest.invalid',
      ['provenance', 'license'],
      generator
        ? `is ${license}, and a generator scheme's colors are generated: its license state is generated.`
        : 'is generated, which only a generator scheme is.',
      generator ? 'Set it to generated.' : "Name the pack's own license state.",
      { actual: license, ...(generator ? { expected: 'generated' } : {}) },
    );
  }
  if (
    license === 'independent-inspired-interpretation' &&
    (!manifest.id.endsWith('-inspired') || !/\binspired\b/i.test(manifest.name))
  ) {
    report(
      'manifest.invalid',
      ['id'],
      "adapts a system's principles, so its id ends with -inspired and its name says Inspired: neither may imply endorsement or exact conformance.",
      `Rename it, such as ${manifest.id.replace(/-inspired$/, '')}-inspired and "${manifest.name.replace(/\s*inspired$/i, '')} Inspired".`,
      { actual: manifest.id },
    );
  }

  const derivedFrom = manifest.provenance.derivedFrom;
  if (derivedFrom) {
    if (sameName(derivedFrom.name, manifest.name)) {
      report(
        'manifest.invalid',
        ['name'],
        `is ${manifest.name}, the name of the work it's derived from: a derived counterpart takes a distinct name.`,
        `Name it apart from ${derivedFrom.name}.`,
        { actual: manifest.name },
      );
    }
    if (!manifest.provenance.derivation) {
      report(
        'manifest.missing',
        ['provenance', 'derivation'],
        'is required with derivedFrom: a derived counterpart says how it was derived.',
        `Say how it derives from ${derivedFrom.name}.`,
      );
    }
  }

  checkModes(manifest, context.kind, report);

  const required = REQUIRED_CHECKS[context.kind];
  const checks = manifest.accessibility.checks;
  duplicates(checks, ['accessibility', 'checks'], report, 'check');
  const missing = required.filter((check) => !checks.includes(check));
  const extra = checks.filter((check) => !required.includes(check));
  if (missing.length > 0 || extra.length > 0) {
    report(
      'manifest.invalid',
      ['accessibility', 'checks'],
      `must name the gates a ${context.kind} pack is held to, ${required.join(', ')}${
        missing.length > 0 ? `, and leaves out ${missing.join(', ')}` : ''
      }${extra.length > 0 ? `, and names ${extra.join(', ')}, which it isn't held to` : ''}.`,
      `Set it to [${required.map((check) => JSON.stringify(check)).join(', ')}].`,
      { expected: required.join(', '), actual: checks.join(', ') },
    );
  }

  for (const kind of NO_SCRIPT_BUDGETS) {
    if (manifest.budgets[kind] !== 0) {
      report(
        manifest.budgets[kind] === undefined ? 'manifest.missing' : 'manifest.invalid',
        ['budgets', kind],
        `must be 0: no pack ships JavaScript.`,
        `Set budgets.${kind} to 0.`,
        {
          expected: '0',
          ...(manifest.budgets[kind] !== undefined
            ? { actual: String(manifest.budgets[kind]) }
            : {}),
        },
      );
    }
  }

  const files =
    context.kind === 'typography'
      ? new Set((manifest as TypographyManifest).fontAssets.map(({ file }) => file)).size
      : 0;
  if (manifest.cost.assets !== files) {
    report(
      'manifest.invalid',
      ['cost', 'assets'],
      `is ${manifest.cost.assets}, and the pack ships ${files} asset file${files === 1 ? '' : 's'}.`,
      `Set it to ${files}.`,
      { expected: String(files), actual: String(manifest.cost.assets) },
    );
  }
  if (files === 0 && manifest.cost.assetBytes !== 0) {
    report(
      'manifest.invalid',
      ['cost', 'assetBytes'],
      `is ${manifest.cost.assetBytes}, and the pack ships no asset file.`,
      'Set it to 0.',
      { expected: '0', actual: String(manifest.cost.assetBytes) },
    );
  }
}

/**
 * The modes a pack covers, as it declares them: both for a language or a
 * typography profile, which apply in every mode, and a scheme's own base
 * modes. A single-mode scheme locks every display mode to its native one,
 * and says so with lockedMode; no other pack may.
 */
function checkModes(manifest: PackManifest, kind: PackKind, report: Report) {
  const declared = manifest.modes;
  duplicates(declared, ['modes'], report, 'mode');
  const covered: readonly BaseMode[] =
    kind === 'color-scheme' ? baseModes(manifest as ColorSchemeManifest) : ['light', 'dark'];
  // A scheme with no colors has its own record, and nothing to compare.
  if (covered.length === 0) return;
  const listed = (modes: readonly string[]) => [...new Set(modes)].sort().join(' and ');
  if (listed(declared) !== listed(covered)) {
    report(
      'manifest.invalid',
      ['modes'],
      `is ${listed(declared)}, and the pack covers ${listed(covered)}${
        kind === 'color-scheme' ? '' : ': a language or a profile applies in every mode'
      }.`,
      `Set it to [${covered.map((mode) => JSON.stringify(mode)).join(', ')}].`,
      { expected: listed(covered), actual: listed(declared) },
    );
  }
  const native = covered.length === 1 ? covered[0] : undefined;
  if (native && manifest.lockedMode !== native) {
    report(
      manifest.lockedMode === undefined ? 'manifest.missing' : 'manifest.invalid',
      ['lockedMode'],
      `must be ${native}: a single-mode scheme keeps its native mode, locked for every display mode.`,
      `Set lockedMode to "${native}".`,
      { expected: native, ...(manifest.lockedMode ? { actual: manifest.lockedMode } : {}) },
    );
  } else if (!native && manifest.lockedMode !== undefined) {
    report(
      'manifest.invalid',
      ['lockedMode'],
      'locks a mode, and only a single-mode scheme has one to lock.',
      'Remove it.',
      { actual: manifest.lockedMode },
    );
  }
}

function shapeIssue(
  issue: z.ZodIssue,
  schema: z.ZodTypeAny,
  input: unknown,
  kind: PackKind,
  report: Report,
) {
  const path = issue.path;
  switch (issue.code) {
    case 'unrecognized_keys':
      for (const key of issue.keys) {
        const hint = closestWord(key, allowedKeysAt(schema, input, path) ?? []);
        report(
          'manifest.unknown-key',
          [...path, key],
          hint
            ? `isn't a field token contract ${TOKEN_CONTRACT_VERSION} defines here. Did you mean ${hint}?`
            : `isn't a field token contract ${TOKEN_CONTRACT_VERSION} defines here.`,
          hint ? `Rename it to ${hint}, or remove it.` : 'Remove it.',
          { actual: key, ...(hint ? { expected: hint } : {}) },
        );
      }
      return;
    case 'invalid_type':
      if (issue.received === 'undefined') {
        report(
          'manifest.missing',
          path,
          `is required in token contract ${TOKEN_CONTRACT_VERSION}.`,
          `Add it. A token set gives every role. ${OPTIONAL_FIELDS[kind]}`,
        );
      } else {
        report(
          'manifest.invalid',
          path,
          `must be ${article(issue.expected)}, not ${article(issue.received)}.`,
          `Change it to ${article(issue.expected)}.`,
          { expected: issue.expected, actual: issue.received },
        );
      }
      return;
    case 'invalid_enum_value':
      report(
        'manifest.invalid',
        path,
        `must be one of: ${issue.options.join(', ')}.`,
        `Use one of: ${issue.options.join(', ')}.`,
        { expected: issue.options.join(' | '), actual: String(issue.received) },
      );
      return;
    case 'invalid_literal':
      report(
        'manifest.invalid',
        path,
        `must be ${JSON.stringify(issue.expected)}.`,
        `Set it to ${JSON.stringify(issue.expected)}.`,
        { expected: JSON.stringify(issue.expected) },
      );
      return;
    case 'invalid_union':
      report(
        'manifest.invalid',
        path,
        "doesn't match any form the contract allows here.",
        'Change it to one of the allowed forms.',
      );
      return;
    default:
      report(
        'manifest.invalid',
        path,
        issueMessage(issue),
        'Change the value to what the message asks for.',
      );
  }
}

function issueMessage(issue: z.ZodIssue): string {
  switch (issue.code) {
    case 'too_small':
      if (issue.type === 'array') return `must have at least ${issue.minimum} items.`;
      if (issue.type === 'string') return `must be at least ${issue.minimum} characters.`;
      return `must be at least ${issue.minimum}.`;
    case 'too_big':
      if (issue.type === 'array') return `must have at most ${issue.maximum} items.`;
      if (issue.type === 'string') return `must be at most ${issue.maximum} characters.`;
      return `must be at most ${issue.maximum}.`;
    default: {
      // Custom and pattern messages are written as "must ...".
      const text = issue.message.trim();
      return /^(?:must|is|has|may|can't|calls|closes|leaves)\b/.test(text)
        ? text
        : `is invalid: ${text}`;
    }
  }
}

function article(noun: string): string {
  return /^[aeiou]/.test(noun) ? `an ${noun}` : `a ${noun}`;
}

/**
 * What rule a pack's `id` breaks for its package, if any: the first-party
 * fallback packs' ids belong to `@portfolio/*`, and a package under another
 * scope starts its ids with the scope, so `@acme/packs` registers
 * `acme-ocean`.
 */
export function packIdProblem(
  id: string,
  packageName: string,
): {
  readonly code: 'manifest.id-reserved' | 'manifest.id-prefix';
  readonly message: string;
  readonly expected: string;
  readonly remedy: string;
} | null {
  const scope = packageScope(packageName);
  if (scope === FIRST_PARTY_SCOPE) return null;
  if (RESERVED_PACK_IDS.includes(id)) {
    return {
      code: 'manifest.id-reserved',
      message: `${id} is a first-party fallback pack's id, reserved for the platform's own @${FIRST_PARTY_SCOPE}/* packages.`,
      expected: scope ? `an id starting with ${scope}-` : 'an id that is not reserved',
      remedy: scope ? `Use ${scope}-${id} or another ${scope}- id.` : 'Pick another id.',
    };
  }
  if (scope !== null && !id.startsWith(`${scope}-`)) {
    return {
      code: 'manifest.id-prefix',
      message: `A package under @${scope} starts its pack ids with ${scope}-, which keeps third-party ids apart.`,
      expected: `an id starting with ${scope}-`,
      remedy: `Rename the id to ${scope}-${id}, or another ${scope}- id.`,
    };
  }
  return null;
}

/** A scheme takes its colors one way, and a stable one has both base modes. */
function checkScheme(manifest: ColorSchemeManifest, report: Report) {
  const ways = [
    ...(manifest.light || manifest.dark ? ['light and dark token sets'] : []),
    ...(manifest.anchors ? ['anchors'] : []),
    ...(manifest.generator ? ['a generator'] : []),
  ];
  if (ways.length === 0) {
    report(
      'manifest.missing',
      [],
      'gives the scheme no colors.',
      'Add light or dark token sets, per-mode anchors with derivation: "anchor-v1", or a generator.',
    );
    return;
  }
  if (ways.length > 1) {
    report(
      'manifest.invalid',
      [],
      `gives its colors more than one way: ${ways.join(', ')}.`,
      'Keep one: token sets, anchors, or a generator.',
    );
    return;
  }
  if (manifest.anchors) {
    if (!manifest.anchors.light && !manifest.anchors.dark) {
      report(
        'manifest.missing',
        ['anchors'],
        'names no mode.',
        'Give light anchors, dark anchors, or both.',
      );
    }
    if (manifest.derivation === undefined) {
      report(
        'manifest.missing',
        ['derivation'],
        'is required with anchors.',
        'Set derivation: "anchor-v1".',
        { expected: 'anchor-v1' },
      );
    }
  } else if (manifest.derivation !== undefined) {
    report(
      'manifest.invalid',
      ['derivation'],
      'names how anchors become token sets, and the scheme has no anchors.',
      'Remove it, or give the scheme anchors.',
    );
  }

  const modes = baseModes(manifest);
  if (manifest.highContrast) {
    if (manifest.generator) {
      report(
        'manifest.invalid',
        ['highContrast'],
        'is authored for a generator scheme, whose high-contrast sets high-contrast-v1 derives from what it generates.',
        'Remove it.',
      );
    } else {
      for (const polarity of ['light', 'dark'] as const) {
        if (manifest.highContrast[polarity] && !modes.includes(polarity)) {
          report(
            'manifest.invalid',
            ['highContrast', polarity],
            `is for a ${polarity} page, and the scheme has no ${polarity} mode, so nothing uses it.`,
            `Remove it, or add the scheme's ${polarity} mode.`,
          );
        }
      }
    }
  }
  if (manifest.tier === 'stable' && modes.length < 2) {
    report(
      'manifest.invalid',
      ['tier'],
      'is stable, and a stable color scheme has both light and dark modes.',
      'Add the missing mode, or ship the scheme as extended or experimental.',
      { expected: 'light and dark', actual: modes.join('') },
    );
  }
  duplicates(manifest.swatches ?? [], ['swatches'], report, 'color');
}

/** The base modes a scheme manifest has: a generator gives both. */
export function baseModes(manifest: ColorSchemeManifest): readonly ('light' | 'dark')[] {
  if (manifest.generator) return ['light', 'dark'];
  const source = manifest.anchors ?? manifest;
  return (['light', 'dark'] as const).filter((mode) => source[mode] !== undefined);
}

/** A file a package could load as script. */
export const SCRIPT_FILE = /\.(?:[cm]?[jt]sx?|wasm|html?|svg|xml|xhtml)$/i;

/** Every string target in a package's exports, however deeply its conditions nest. */
function exportTargets(exports: unknown): string[] {
  if (typeof exports === 'string') return [exports];
  if (Array.isArray(exports)) return exports.flatMap(exportTargets);
  if (isPlainObject(exports)) return Object.values(exports).flatMap(exportTargets);
  return [];
}

/** An export target with no file extension, such as `./index` or `./dist/`, which could resolve to script. */
const extensionless = (target: string) => !/\.[A-Za-z0-9]+$/.test(target);

/**
 * No pack ships JavaScript (#20): a pack package exports nothing a page
 * could run, and names no entry point. Its packs are data, which registry
 * generation reads from the packs directory, and the compiler writes the
 * only CSS that reaches a page. compilePack() refuses a script file inside a
 * pack's directory. An exports target with no extension is refused too,
 * since what it resolves to isn't said.
 */
function checkNoScript(context: PackContext, report: Report) {
  const entries = (['main', 'module', 'browser'] as const).filter(
    (field) => context.entryPoints?.[field] !== undefined,
  );
  if (entries.length > 0) {
    report(
      'manifest.invalid',
      [],
      `comes from a package that names an entry point, ${entries.map((field) => `"${field}"`).join(', ')}, and no pack ships JavaScript.`,
      "Remove the package's main, module, and browser fields: a pack package holds data the host compiles.",
      { actual: entries.join(', ') },
    );
  }
  const scripts = exportTargets(context.exports).filter(
    (target) => SCRIPT_FILE.test(target) || extensionless(target),
  );
  if (scripts.length > 0) {
    report(
      'manifest.invalid',
      [],
      `comes from a package that exports script, ${scripts.join(', ')}, and no pack ships JavaScript.`,
      "Remove the package's script exports: a pack package holds data the host compiles.",
      { actual: scripts.join(', ') },
    );
  }
}

function checkTypography(manifest: TypographyManifest, report: Report) {
  duplicates(manifest.scripts, ['scripts'], report, 'script');
  duplicates(
    manifest.fontAssets.map(({ file }) => file),
    ['fontAssets'],
    report,
    'font file',
    (index) => ['fontAssets', index, 'file'],
  );
}

/** One record for every repeat of an earlier value. */
function duplicates(
  values: readonly string[],
  path: Path,
  report: Report,
  noun: string,
  at: (index: number) => Path = (index) => [...path, index],
) {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      report(
        'manifest.duplicate',
        at(index),
        `repeats a ${noun} an earlier entry has.`,
        'Remove the repeat.',
        {
          actual: value,
        },
      );
    }
    seen.add(value);
  });
}
