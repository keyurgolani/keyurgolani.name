// validatePackManifest() (#19, Slice 1, item 2): a pack's manifest.json
// against token contract 1, in #5's ManifestDiagnostic shape and codes, so
// registry generation (Slice 2) reports a pack's problems the way it reports
// a variant's. The token contract comes first, since another contract's
// tokens mean something else; then the shape; then the rules the shape
// can't state.

import { z } from 'zod';
import { allowedKeysAt, closestWord, isPlainObject } from '@portfolio/schema';
import {
  FIRST_PARTY_SCOPE,
  MANIFEST_CODES,
  packageScope,
  TOKEN_CONTRACT_VERSION,
  toPointer,
  type ManifestCode,
  type ManifestDiagnostic,
} from '@portfolio/variant-contract';
import { PACK_AXES, PLATFORM_DEFAULTS, type PackKind } from './axes';
import {
  ColorSchemeManifestSchema,
  DesignLanguageManifestSchema,
  TypographyManifestSchema,
  type ColorSchemeManifest,
  type DesignLanguageManifest,
  type TypographyManifest,
} from './manifests';

export interface PackContext {
  /** The `portfolio.kind` of the package that holds the pack. */
  readonly kind: PackKind;
  /** The package's npm name, which the id rules read. */
  readonly packageName: string;
  /** The package's `exports`, which each enhancement's subpath must be in. Omitted, those go unchecked. */
  readonly exports?: unknown;
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

/** The fields each kind may leave out, for the message when a required one is missing. */
const OPTIONAL_FIELDS: Readonly<Record<PackKind, string>> = {
  'design-language': 'stylesheet and enhancements',
  'color-scheme':
    'whichever of light, dark, anchors, derivation, and generator the scheme does not use, highContrast, and swatches',
  typography: 'none',
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
      message: `${pointer || 'The manifest'} ${message}`,
      ...extra,
      remedy,
    });
  };
  const result = (manifest?: PackManifestByKind[K]): PackResult<K> =>
    manifest && !diagnostics.some(({ severity }) => severity === 'error')
      ? { ok: true, manifest, diagnostics, notChecked }
      : { ok: false, diagnostics, notChecked };

  if (!isPlainObject(input)) {
    report('manifest.invalid', [], 'must be a JSON object.', 'Write manifest.json as one object.');
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
  if (id) report(id.code, ['id'], id.message, id.remedy, { expected: id.expected, actual: manifest.id });
  if (context.kind === 'color-scheme') checkScheme(manifest as ColorSchemeManifest, report);
  if (context.kind === 'design-language') {
    checkLanguage(manifest as DesignLanguageManifest, context, report, notChecked);
  }
  if (context.kind === 'typography') checkTypography(manifest as TypographyManifest, report);
  return result(manifest);
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
          `Add it. A token set gives every role, and the optional fields of a ${kind} pack are ${OPTIONAL_FIELDS[kind]}.`,
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
      report('manifest.invalid', path, issueMessage(issue), 'Change the value to what the message asks for.');
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
      return /^(?:must|is|has|may|can't|calls|closes|leaves)\b/.test(text) ? text : `is invalid: ${text}`;
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
      report('manifest.missing', ['anchors'], 'names no mode.', 'Give light anchors, dark anchors, or both.');
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
        "is authored for a generator scheme, whose high-contrast sets high-contrast-v1 derives from what it generates.",
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

function checkLanguage(
  manifest: DesignLanguageManifest,
  context: PackContext,
  report: Report,
  notChecked: string[],
) {
  const enhancements = manifest.enhancements ?? [];
  duplicates(
    enhancements.map(({ id }) => id),
    ['enhancements'],
    report,
    'enhancement id',
    (index) => ['enhancements', index, 'id'],
  );
  if (enhancements.length === 0) return;
  if (!isPlainObject(context.exports)) {
    notChecked.push('enhancements.export');
    return;
  }
  const exported = context.exports;
  enhancements.forEach((enhancement, index) => {
    if (!Object.hasOwn(exported, enhancement.export)) {
      report(
        'manifest.enhancement-missing-export',
        ['enhancements', index, 'export'],
        "isn't a subpath in the package's exports, so the host can't load it.",
        `Add ${enhancement.export} to the package's exports, or point export at a subpath it has.`,
        { actual: enhancement.export },
      );
    }
  });
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
      report('manifest.duplicate', at(index), `repeats a ${noun} an earlier entry has.`, 'Remove the repeat.', {
        actual: value,
      });
    }
    seen.add(value);
  });
}
