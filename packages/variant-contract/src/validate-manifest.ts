// validateManifest() (#5, Slice 1, item 1): a manifest.json against contract
// 2.0. The contract version comes first, since another major's fields mean
// something else. Then the shape, then the rules the shape can't state.

import { z } from 'zod';
import {
  ALL_SECTION_KINDS,
  closestWord,
  isPlainObject,
  issueCode,
  issueView,
  reportedIssues,
  SCHEMA_VERSIONS,
  valueAt,
} from '@portfolio/schema';
import {
  MANIFEST_CODES,
  toPointer,
  type ManifestCode,
  type ManifestDiagnostic,
} from './diagnostics';
import {
  FALLBACK_ID,
  FIRST_PARTY_ANIMATIONS,
  FIRST_PARTY_PINS,
  FIRST_PARTY_SCOPE,
  idProblem,
  packageScope,
} from './ids';
import {
  DOCUMENT_ACTIONS,
  DOCUMENT_BINDING_MINOR,
  DOCUMENT_KEYS,
  DOCUMENT_REGION,
  keyVerdict,
} from './keys';
import {
  ManifestSchema,
  V1_FIELDS,
  type ControlDeclaration,
  type VariantManifest,
} from './manifest-schema';
import {
  isReservedSegment,
  parseFragmentPattern,
  parsePathPattern,
  RESERVED_SEGMENTS,
  viewShape,
} from './segments';
import { TRANSITIONS_MINOR, transitionNameProblem } from './transitions';
import {
  CONTRACT_MAJOR,
  CONTRACT_MINOR,
  CONTRACT_VERSION,
  parseContractVersion,
  TOKEN_CONTRACT_VERSION,
} from './version';

export interface ManifestContext {
  /** The package's npm name, which the id rules read. */
  readonly packageName: string;
  /** The package's `exports`, which each enhancement's subpath must be in. Omitted, those go unchecked. */
  readonly exports?: unknown;
  /** #20's appearance recipe ids. Omitted, `recommendedAppearance` goes unchecked. */
  readonly recipes?: readonly string[];
}

export type ManifestResult =
  | {
      readonly ok: true;
      readonly manifest: VariantManifest;
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

type Path = readonly (string | number)[];

/** The contract versions this host reads, for a record's `expected`. */
const SUPPORTED_CONTRACTS =
  CONTRACT_MINOR === 0 ? CONTRACT_VERSION : `${CONTRACT_MAJOR}.0 to ${CONTRACT_VERSION}`;

/** Validates a parsed manifest.json against this contract, 2.0 to its minor. It never throws. */
export function validateManifest(input: unknown, context: ManifestContext): ManifestResult {
  const diagnostics: ManifestDiagnostic[] = [];
  const notChecked: string[] = [];
  const report = (
    code: ManifestCode,
    path: Path,
    message: string,
    remedy: string,
    extra: { expected?: string; actual?: string } = {},
  ) => {
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
  const result = (manifest?: VariantManifest): ManifestResult => {
    const failed = diagnostics.some(({ severity }) => severity === 'error');
    return manifest && !failed
      ? { ok: true, manifest, diagnostics, notChecked }
      : { ok: false, diagnostics, notChecked };
  };

  if (!isPlainObject(input)) {
    report('manifest.invalid', [], 'must be a JSON object.', 'Write manifest.json as one object.');
    return result();
  }

  // Another contract major's fields mean something else, so that's all there is to say.
  const contract = typeof input.contract === 'string' ? parseContractVersion(input.contract) : null;
  if (contract && contract.major !== CONTRACT_MAJOR) {
    report(
      'manifest.contract-unsupported',
      ['contract'],
      `is contract ${input.contract}, and this host reads contract ${CONTRACT_MAJOR}.`,
      `Install a release of the package built for contract ${CONTRACT_MAJOR}, or a host that reads ${input.contract}.`,
      { expected: SUPPORTED_CONTRACTS, actual: String(input.contract) },
    );
    return result();
  }
  if (contract && contract.minor > CONTRACT_MINOR) {
    report(
      'manifest.contract-newer',
      ['contract'],
      `is contract ${input.contract}, newer than the ${CONTRACT_VERSION} this host reads.`,
      'Upgrade the host, or pin a release of the package built for this contract.',
      { expected: SUPPORTED_CONTRACTS, actual: String(input.contract) },
    );
    return result();
  }

  const parsed = ManifestSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of reportedIssues(parsed.error.issues)) shapeIssue(issue, input, report);
    return result();
  }
  checkRules(parsed.data, context, report, notChecked);
  return result(parsed.data);
}

type Report = (
  code: ManifestCode,
  path: Path,
  message: string,
  remedy: string,
  extra?: { expected?: string; actual?: string },
) => void;

/** Messages for unions zod can only call invalid, by the field they're at. */
const UNION_MESSAGES: Readonly<Record<string, string>> = {
  select:
    'must be { "kind": <kind> }, { "control": <control id> }, or { "field": <JSON pointer> }.',
};

/** One zod issue as manifest records. */
function shapeIssue(issue: z.ZodIssue, input: unknown, report: Report) {
  const path = issue.path as (string | number)[];
  const value = valueAt(input, path);
  const view = issueView(issue, input);
  switch (view.code) {
    case 'unrecognized_keys':
      if (issue.code !== 'unrecognized_keys') return;
      for (const key of issue.keys) unknownKey(path, key, input, report);
      return;
    case 'invalid_type': {
      if (view.received === 'undefined') {
        report(
          'manifest.missing',
          path,
          `is required in contract ${CONTRACT_VERSION}.`,
          'Add it. Every field but author, homepage, bestFor, budgets, enhancements, keyBindings, kitLayout, recommendedAppearance, studio, and transitions is required.',
        );
      } else {
        const expected = view.expected ?? '';
        const received = view.received ?? '';
        report(
          'manifest.invalid',
          path,
          `must be ${article(expected)}, not ${article(received)}.`,
          `Change it to ${article(expected)}.`,
          { expected, actual: received },
        );
      }
      return;
    }
    case 'invalid_enum_value': {
      const options = view.options ?? [];
      report(
        'manifest.invalid',
        path,
        `must be one of: ${options.join(', ')}.`,
        `Use one of: ${options.join(', ')}.`,
        { expected: options.join(' | '), actual: String(value) },
      );
      return;
    }
    case 'invalid_union_discriminator': {
      const options = discriminatorOptions(ManifestSchema, input, path);
      report(
        'manifest.invalid',
        path,
        `must be one of: ${options.join(', ')}.`,
        `Use one of: ${options.join(', ')}.`,
        { expected: options.join(' | ') },
      );
      return;
    }
    case 'invalid_union': {
      const last = path.at(-1);
      const message =
        (typeof last === 'string' && Object.hasOwn(UNION_MESSAGES, last)
          ? UNION_MESSAGES[last]
          : undefined) ?? "doesn't match any form contract 2.0 allows here.";
      report('manifest.invalid', path, message, 'Change it to one of the allowed forms.');
      return;
    }
    default:
      report(
        'manifest.invalid',
        path,
        issueMessage(issue, input),
        'Change the value to what the message asks for.',
      );
  }
}

/** A key the manifest's schema doesn't define, with what it became if it's a v1 field. */
function unknownKey(path: Path, key: string, input: unknown, report: Report) {
  const at = [...path, key];
  const v1 = path.length === 0 && Object.hasOwn(V1_FIELDS, key) ? V1_FIELDS[key] : undefined;
  if (v1?.to) {
    report(
      'manifest.unknown-key',
      at,
      `is a v1 field. Contract ${CONTRACT_VERSION} calls it ${v1.to}.`,
      `Rename it to ${v1.to}.`,
      { expected: v1.to, actual: key },
    );
    return;
  }
  if (v1) {
    report(
      'manifest.unknown-key',
      at,
      `is a v1 field contract ${CONTRACT_VERSION} deleted: ${v1.why}.`,
      'Remove it.',
      { actual: key },
    );
    return;
  }
  const hint = closestWord(key, allowedKeysAt(ManifestSchema, input, path) ?? []);
  report(
    'manifest.unknown-key',
    at,
    hint
      ? `isn't a field contract ${CONTRACT_VERSION} defines. Did you mean ${hint}?`
      : `isn't a field contract ${CONTRACT_VERSION} defines.`,
    hint ? `Rename it to ${hint}, or remove it.` : 'Remove it.',
    { actual: key, ...(hint ? { expected: hint } : {}) },
  );
}

function issueMessage(issue: z.ZodIssue, input: unknown): string {
  switch (issue.code) {
    case 'too_small':
      if (issue.origin === 'array') return `must have at least ${issue.minimum} items.`;
      if (issue.origin === 'string') return `must be at least ${issue.minimum} characters.`;
      return `must be at least ${issue.minimum}.`;
    case 'too_big':
      if (issue.origin === 'array') return `must have at most ${issue.maximum} items.`;
      if (issue.origin === 'string') return `must be at most ${issue.maximum} characters.`;
      return `must be at most ${issue.maximum}.`;
    case 'invalid_value':
      if (issueCode(issue, input) === 'invalid_literal')
        return `must be ${JSON.stringify(issue.values[0])}.`;
      break;
    case 'not_multiple_of':
      return `must be a multiple of ${issue.divisor}.`;
  }
  // Custom and pattern messages are written as "must ...".
  const text = issue.message.trim();
  return /^(?:must|is|has)\b/.test(text) ? text : `is invalid: ${text}`;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function article(noun: string): string {
  return /^[aeiou]/.test(noun) ? `an ${noun}` : `a ${noun}`;
}

/** The keys the schema allows on the object at `path`, following the data through unions. */
function allowedKeysAt(schema: z.ZodTypeAny, data: unknown, path: Path): string[] | undefined {
  const at = schemaAt(schema, data, path);
  const current = at && unwrap(at.schema, at.value);
  return current instanceof z.ZodObject ? Object.keys(current.shape) : undefined;
}

/** The tags the discriminated union holding the tag at `path` allows, for its issue. */
function discriminatorOptions(schema: z.ZodTypeAny, data: unknown, path: Path): string[] {
  const at = schemaAt(schema, data, path.slice(0, -1));
  const union = at && unwrap(at.schema, at.value, { stopAtUnion: true });
  if (!(union instanceof z.ZodDiscriminatedUnion)) return [];
  const tag = String(union._zod.def.discriminator);
  return (union.options as z.ZodTypeAny[]).flatMap((option) =>
    [...(option._zod.propValues?.[tag] ?? [])].map(String),
  );
}

/** The schema at `path` in `data`, before unwrapping, and the value there. */
function schemaAt(
  schema: z.ZodTypeAny,
  data: unknown,
  path: Path,
): { readonly schema: z.ZodTypeAny | undefined; readonly value: unknown } | undefined {
  let current: z.ZodTypeAny | undefined = schema;
  let value = data;
  for (const segment of path) {
    current = unwrap(current, value);
    if (current instanceof z.ZodObject) {
      const shape = current.shape as Record<string, z.ZodTypeAny>;
      current = Object.hasOwn(shape, segment) ? shape[segment] : undefined;
    } else if (current instanceof z.ZodArray) {
      current = current.element as z.ZodTypeAny;
    } else if (current instanceof z.ZodRecord) {
      current = current.valueType as z.ZodTypeAny;
    } else {
      return undefined;
    }
    value =
      (isPlainObject(value) || Array.isArray(value)) && Object.hasOwn(value, segment)
        ? (value as Record<string | number, unknown>)[segment]
        : undefined;
  }
  return { schema: current, value };
}

function unwrap(
  schema: z.ZodTypeAny | undefined,
  value: unknown,
  { stopAtUnion = false } = {},
): z.ZodTypeAny | undefined {
  let current = schema;
  for (;;) {
    if (
      current instanceof z.ZodOptional ||
      current instanceof z.ZodNullable ||
      current instanceof z.ZodDefault
    ) {
      current = current.unwrap() as z.ZodTypeAny;
    } else if (current instanceof z.ZodPipe) {
      // A transform's pipeline names its keys on the way in.
      current = (current.out instanceof z.ZodTransform ? current.in : current.out) as z.ZodTypeAny;
    } else if (stopAtUnion && current instanceof z.ZodUnion) {
      return current;
    } else if (current instanceof z.ZodDiscriminatedUnion) {
      const key = String(current._zod.def.discriminator);
      const tag = isPlainObject(value) ? value[key] : undefined;
      current = (current.options as z.ZodTypeAny[]).find((option) =>
        option._zod.propValues?.[key]?.has(tag as never),
      );
    } else if (current instanceof z.ZodUnion) {
      const options = current.options as z.ZodTypeAny[];
      const keys = isPlainObject(value) ? Object.keys(value) : [];
      current = options.find(
        (option) =>
          option instanceof z.ZodObject && keys.some((key) => Object.hasOwn(option.shape, key)),
      );
    } else {
      return current;
    }
  }
}

/**
 * The document binding (K-4 (d), contract 2.1): one per manifest, `mod+k`
 * and `/` among its keys, and `palette.open` its action, in a manifest that
 * declares contract 2.1 or later.
 */
function checkDocumentBinding(
  manifest: VariantManifest,
  binding: NonNullable<VariantManifest['keyBindings']>[number],
  index: number,
  earlier: number,
  report: Report,
) {
  const at = ['keyBindings', index];
  const contract = parseContractVersion(manifest.contract);
  if (contract && contract.minor < DOCUMENT_BINDING_MINOR) {
    report(
      'manifest.invalid',
      [...at, 'region'],
      `is the document region, which contract 2.${DOCUMENT_BINDING_MINOR} adds, and the manifest declares contract ${manifest.contract}.`,
      `Declare contract 2.${DOCUMENT_BINDING_MINOR}, or remove the document binding.`,
      { expected: `contract 2.${DOCUMENT_BINDING_MINOR} or later`, actual: manifest.contract },
    );
  }
  if (earlier !== -1) {
    report(
      'manifest.duplicate',
      [...at, 'region'],
      `is a second document binding: keyBindings/${earlier} is one already, and a variant has one at most.`,
      'Put every document key in the one binding.',
      { actual: DOCUMENT_REGION },
    );
  }
  binding.keys.forEach((key, keyIndex) => {
    if (!(DOCUMENT_KEYS as readonly string[]).includes(key)) {
      report(
        'manifest.invalid',
        [...at, 'keys', keyIndex],
        `isn't a key a document binding may hold: ${DOCUMENT_KEYS.join(' and ')}.`,
        `Use ${DOCUMENT_KEYS.join(' or ')}, or bind the key in a region of your own.`,
        { expected: DOCUMENT_KEYS.join(', '), actual: key },
      );
    }
  });
  if (!(DOCUMENT_ACTIONS as readonly string[]).includes(binding.action)) {
    report(
      'manifest.invalid',
      [...at, 'action'],
      `isn't an action a document binding may take: ${DOCUMENT_ACTIONS.join(', ')}.`,
      `Name ${DOCUMENT_ACTIONS.join(' or ')}.`,
      { expected: DOCUMENT_ACTIONS.join(', '), actual: binding.action },
    );
  }
}

/** The rules a valid shape can still break. */
function checkRules(
  manifest: VariantManifest,
  context: ManifestContext,
  report: Report,
  notChecked: string[],
) {
  const firstParty = packageScope(context.packageName) === FIRST_PARTY_SCOPE;

  const id = idProblem(manifest.id, context.packageName);
  if (id)
    report(id.code, ['id'], id.message, id.remedy, { expected: id.expected, actual: manifest.id });

  const pin = FIRST_PARTY_PINS[manifest.id];
  if (firstParty && pin) {
    for (const field of ['performanceTier', 'motionIntent'] as const) {
      if (manifest[field] !== pin[field]) pinned(report, field, pin[field], manifest[field]);
    }
  }
  const animations = FIRST_PARTY_ANIMATIONS[manifest.id];
  if (firstParty && animations) checkAnimationPin(manifest, animations, report);
  if (firstParty && manifest.id === FALLBACK_ID) checkFallback(manifest, report);

  for (const document of ['portfolio', 'site'] as const) {
    const range = manifest.schemas[document];
    // Each document has its own version: the portfolio's is 3 and the site's 2 (#10).
    const version = SCHEMA_VERSIONS[document];
    if (range.min > range.max) {
      report(
        'manifest.invalid',
        ['schemas', document, 'max'],
        `must be at least min (${range.min}).`,
        'Set max to the newest version the variant reads, and min to the oldest.',
        { expected: `>= ${range.min}`, actual: String(range.max) },
      );
    } else if (version < range.min || version > range.max) {
      report(
        'manifest.schemas-unsupported',
        ['schemas', document],
        `reads ${document} versions ${range.min} to ${range.max}, and this host's ${document} documents are version ${version}.`,
        `Upgrade the package to a release that reads version ${version}, or pin a host whose version it reads.`,
        { expected: `a range including ${version}`, actual: `${range.min} to ${range.max}` },
      );
    }
  }

  if (manifest.tokenContract !== TOKEN_CONTRACT_VERSION) {
    report(
      'manifest.token-contract-mismatch',
      ['tokenContract'],
      `is ${manifest.tokenContract}, and this host's appearance tokens are contract ${TOKEN_CONTRACT_VERSION}.`,
      `Build the package against token contract ${TOKEN_CONTRACT_VERSION}, or install a host on token contract ${manifest.tokenContract}.`,
      { expected: String(TOKEN_CONTRACT_VERSION), actual: String(manifest.tokenContract) },
    );
  }

  duplicates(manifest.renderedKinds, ['renderedKinds'], (kind) => kind, report, 'kind');
  duplicates(manifest.unsupportedKinds, ['unsupportedKinds'], (kind) => kind, report, 'kind');
  manifest.unsupportedKinds.forEach((kind, index) => {
    if (manifest.renderedKinds.includes(kind)) {
      report(
        'manifest.kinds-overlap',
        ['unsupportedKinds', index],
        `is also in renderedKinds. A kind is rendered bespoke or skipped, not both.`,
        'Remove it from one of the two lists.',
        { actual: kind },
      );
    }
  });
  // K-5: only a composition whose every core kind it renders itself, or declines,
  // leaves the kit's layout out: no core section reaches the shared renderers then.
  if (manifest.kitLayout === false) {
    const missing = ALL_SECTION_KINDS.filter(
      (kind) => !manifest.renderedKinds.includes(kind) && !manifest.unsupportedKinds.includes(kind),
    );
    if (missing.length > 0) {
      report(
        'manifest.invalid',
        ['kitLayout'],
        `is false, but neither renderedKinds nor unsupportedKinds lists ${missing.join(', ')}, which the shared renderers draw on the kit's layout.`,
        'Render or decline every core kind yourself, or remove kitLayout.',
        {
          expected: 'every core kind in renderedKinds or unsupportedKinds',
          actual: missing.join(', '),
        },
      );
    }
  }

  checkSlots(manifest, report);
  checkRoutes(manifest, report);
  checkControls(manifest, report);
  checkEnhancements(manifest, context, report, notChecked);
  checkTransitions(manifest, report);

  // One action per key in a region.
  const bound = new Set<string>();
  let documentBinding = -1;
  manifest.keyBindings?.forEach((binding, index) => {
    const isDocument = binding.region === DOCUMENT_REGION;
    if (isDocument) checkDocumentBinding(manifest, binding, index, documentBinding, report);
    if (isDocument && documentBinding === -1) documentBinding = index;
    binding.keys.forEach((key, keyIndex) => {
      // The document binding's keys are its own, which checkDocumentBinding holds.
      const verdict = isDocument ? 'allowed' : keyVerdict(key);
      const slot = JSON.stringify([binding.region, key]);
      if (bound.has(slot)) {
        report(
          'manifest.duplicate',
          ['keyBindings', index, 'keys', keyIndex],
          'binds a key an earlier binding in the same region already has.',
          'Give each key one action per region.',
          { actual: key },
        );
      }
      bound.add(slot);
      if (verdict === 'reserved') {
        report(
          'manifest.key-binding-reserved',
          ['keyBindings', index, 'keys', keyIndex],
          'is reserved: Tab, Escape, Enter, Space, function keys, and modifier shortcuts belong to focus, the shared primitives, and the browser.',
          'Bind a letter, a digit, an arrow key, PageUp, PageDown, Home, or End instead.',
          { actual: key },
        );
      } else if (verdict === 'unknown') {
        report(
          'manifest.invalid',
          ['keyBindings', index, 'keys', keyIndex],
          'must be a KeyboardEvent.key value a variant may bind: a lowercase letter, a digit, an arrow key, PageUp, PageDown, Home, or End.',
          'Use one of those keys.',
          { actual: key },
        );
      }
    });
  });
  manifest.provenance.sources.forEach((source, index) => {
    if (source.disposition === 'retired' && source.note === undefined) {
      report(
        'manifest.provenance-note-required',
        ['provenance', 'sources', index],
        'is retired with no note. A retired source says why it was dropped.',
        'Add a note saying why.',
      );
    }
  });

  if (manifest.recommendedAppearance !== undefined) {
    if (!context.recipes) {
      notChecked.push('recommendedAppearance');
    } else if (!context.recipes.includes(manifest.recommendedAppearance)) {
      report(
        'manifest.recipe-unknown',
        ['recommendedAppearance'],
        "isn't an appearance recipe this build knows, so Studio won't suggest it.",
        'Use a recipe id the appearance catalog lists, or remove the field.',
        { actual: manifest.recommendedAppearance },
      );
    }
  }
}

/**
 * A first-party composition's animation budget is its approved count (K-4
 * c), declared outright, since a kind left out takes its tier's ceiling.
 * A light composition with a pin of 0 may leave it out: the light ceiling
 * is 0 (runtime-budgets.json, which manifest.test.ts holds to it).
 */
function checkAnimationPin(
  manifest: VariantManifest,
  pin: (typeof FIRST_PARTY_ANIMATIONS)[string],
  report: Report,
) {
  const declared = manifest.budgets?.animation;
  if (declared === undefined && pin.count === 0 && manifest.performanceTier === 'light') return;
  const fits =
    declared !== undefined && (pin.atMost ? declared <= pin.count : declared === pin.count);
  if (fits) return;
  const expected = pin.atMost ? `at most ${pin.count}` : String(pin.count);
  report(
    'manifest.first-party-pin',
    ['budgets', 'animation'],
    `is ${declared ?? 'left out'}, and this composition's approved animation count is ${expected}: its infinite animations and recurring timers, as RB ruling R3 counts them, where finite and scroll-driven animations don't count.`,
    `Set budgets.animation to ${pin.atMost ? `${pin.count} or fewer` : pin.count}. The first-party values are part of the approved catalog.`,
    { expected, actual: declared === undefined ? 'left out' : String(declared) },
  );
}

function pinned(report: Report, field: string, expected: string, actual: string) {
  report(
    'manifest.first-party-pin',
    [field],
    `is ${actual}, and this composition's approved ${field} is ${expected}.`,
    `Set it to ${expected}. The first-party values are part of the approved catalog.`,
    { expected, actual },
  );
}

/**
 * The fallback composition renders anything: it requires nothing, renders
 * nothing bespoke, and skips nothing.
 */
function checkFallback(manifest: VariantManifest, report: Report) {
  const pins = {
    compositionFamily: 'document',
    motionIntent: 'still',
    performanceTier: 'light',
  } as const;
  for (const [field, expected] of Object.entries(pins) as [keyof typeof pins, string][]) {
    if (manifest[field] !== expected) pinned(report, field, expected, manifest[field]);
  }
  if (manifest.renderedKinds.length > 0) {
    report(
      'manifest.first-party-pin',
      ['renderedKinds'],
      'must be empty: the fallback composition renders every kind through the shared renderers.',
      'Remove every kind from renderedKinds.',
      { expected: '[]' },
    );
  }
  if (manifest.unsupportedKinds.length > 0) {
    report(
      'manifest.first-party-pin',
      ['unsupportedKinds'],
      'must be empty: the fallback composition renders every kind, so no content goes unseen.',
      'Remove every kind from unsupportedKinds.',
      { expected: '[]' },
    );
  }
  manifest.contentSlots.forEach((slot, index) => {
    if (slot.level !== 'optional') {
      report(
        'manifest.first-party-pin',
        ['contentSlots', index, 'level'],
        'must be optional: the fallback composition requires and recommends no content.',
        'Make the slot optional.',
        { expected: 'optional', actual: slot.level },
      );
    }
  });
}

function duplicates<T>(
  items: readonly T[],
  at: Path,
  keyOf: (item: T) => string,
  report: Report,
  noun: string,
  tail: Path = [],
) {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const key = keyOf(item);
    if (seen.has(key)) {
      report(
        'manifest.duplicate',
        [...at, index, ...tail],
        `repeats a ${noun} an earlier entry has.`,
        'Remove the repeat, or give it its own id.',
      );
    }
    seen.add(key);
  });
}

function checkSlots(manifest: VariantManifest, report: Report) {
  duplicates(manifest.contentSlots, ['contentSlots'], (slot) => slot.id, report, 'slot id', ['id']);
  const controls = new Map(manifest.controls.items.map((control) => [control.id, control]));
  manifest.contentSlots.forEach((slot, index) => {
    const named = 'control' in slot.select ? controls.get(slot.select.control) : undefined;
    if ('control' in slot.select && !named) {
      report(
        'manifest.unknown-ref',
        ['contentSlots', index, 'select', 'control'],
        "names a control the manifest doesn't declare.",
        'Name one of controls.items, or select by kind or field.',
        { actual: slot.select.control },
      );
    } else if (named && named.type !== 'contentRef' && named.type !== 'contentRefList') {
      report(
        'manifest.invalid',
        ['contentSlots', index, 'select', 'control'],
        `names a ${named.type} control. A slot holds content, so it selects by a contentRef or contentRefList control.`,
        'Name a contentRef or contentRefList control, or select by kind or field.',
        { expected: 'contentRef | contentRefList', actual: named.type },
      );
    }
    if (slot.max !== undefined && slot.min > slot.max) {
      report(
        'manifest.invalid',
        ['contentSlots', index, 'max'],
        `must be at least min (${slot.min}).`,
        'Set max to at least min, or leave it out for no limit.',
        { expected: `>= ${slot.min}`, actual: String(slot.max) },
      );
    }
  });
}

function checkRoutes(manifest: VariantManifest, report: Report) {
  const views = manifest.routes.views;
  duplicates(views, ['routes', 'views'], (view) => view.id, report, 'view id', ['id']);
  const shapes = new Map<string, number>();
  views.forEach((view, index) => {
    const at = ['routes', 'views', index] as const;
    if (view.id === 'home' || view.id === 'work') {
      report(
        'manifest.route-conflict',
        [...at, 'id'],
        `is the id of the ${view.id} route every variant has.`,
        'Give the view an id of its own.',
        { actual: view.id },
      );
    }
    const parsed =
      view.type === 'path' ? parsePathPattern(view.segment) : parseFragmentPattern(view.segment);
    if ('problem' in parsed) {
      report('manifest.invalid', [...at, 'segment'], parsed.problem, 'Rewrite the segment.', {
        actual: view.segment,
      });
      return;
    }
    const first = parsed.parts[0]!;
    if (
      view.type === 'path' &&
      view.under === 'home' &&
      'literal' in first &&
      isReservedSegment(first.literal)
    ) {
      report(
        'manifest.route-reserved-segment',
        [...at, 'segment'],
        `starts with ${first.literal}, a first segment the host reserves.`,
        `Start the segment with a word not in: ${RESERVED_SEGMENTS.join(', ')}.`,
        { actual: first.literal },
      );
    }
    // Placeholders match any segment, so two views of one shape can't both be reached.
    const shape = viewShape(view)!;
    if (shapes.has(shape)) {
      report(
        'manifest.route-conflict',
        [...at, 'segment'],
        `matches the same addresses as /routes/views/${shapes.get(shape)}.`,
        'Change one of the two segments.',
        { actual: view.segment },
      );
    } else {
      shapes.set(shape, index);
    }
  });
}

/**
 * Words that would make a control choose appearance, which #19 owns: palette
 * and color, type, materials and component geometry, display modes, and
 * motion timing. A bare "theme" is a topic, as in "Group chapters by theme",
 * so only a visual one counts.
 */
const APPEARANCE_WORDS = new RegExp(
  '\\b(?:' +
    [
      'colou?rs?',
      'palettes?',
      'hues?',
      'swatch(?:es)?',
      'tints?',
      'schemes?',
      'fonts?',
      'typefaces?',
      'typography',
      'type ?scales?',
      'serifs?',
      'sans ?serif',
      'weights?',
      'design ?languages?',
      'radius',
      'radii',
      'rounded(?:ness)?',
      'borders?',
      'shadows?',
      'elevations?',
      'glass(?:y|morphism)?',
      'blurs?',
      'materials?',
      'textures?',
      'dark',
      'contrast',
      'light ?modes?',
      'display ?modes?',
      'durations?',
      'speeds?',
      'easings?',
      'timings?',
      '(?:colou?r|dark|light|visual|site) ?themes?',
      'themes? ?(?:colou?rs?|modes?|toggles?|switch(?:es|er)?)',
    ].join('|') +
    ')\\b',
  'i',
);

function wordsOf(text: string): string {
  return text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ');
}

function checkControls(manifest: VariantManifest, report: Report) {
  const { items, migrations, version } = manifest.controls;
  duplicates(items, ['controls', 'items'], (control) => control.id, report, 'control id', ['id']);
  items.forEach((control, index) => {
    const at = ['controls', 'items', index] as const;
    const texts: Array<[string, Path]> = [
      [control.id, ['id']],
      [control.label, ['label']],
      [control.description, ['description']],
      ...(control.type === 'enum'
        ? control.options.flatMap((option, optionIndex): Array<[string, Path]> => [
            [option.value, ['options', optionIndex, 'value']],
            [option.label, ['options', optionIndex, 'label']],
          ])
        : []),
    ];
    const appearance = texts.find(([value]) => APPEARANCE_WORDS.test(wordsOf(value)));
    if (appearance) {
      report(
        'manifest.controls-appearance',
        [...at, ...appearance[1]],
        'reads as choosing appearance: a palette or color, type, a material or shape, a display mode, or motion timing. Controls change composition only; #19 owns appearance.',
        'Make the control about layout, order, emphasis, or interaction, or drop it.',
        { actual: appearance[0] },
      );
    }
    checkControlDefault(control, [...at], report);
  });

  // Steps 1 to 2, 2 to 3, and so on to the current version, each once and in
  // order. Counted, not listed, so a huge version can't exhaust memory.
  const needed = version - 1;
  migrations.forEach((step, index) => {
    const want = index < needed ? index + 1 : undefined;
    if (step.to !== step.from + 1 || step.from !== want) {
      report(
        'manifest.controls-migration-gap',
        ['controls', 'migrations', index],
        want === undefined
          ? `steps past the current version (${version}).`
          : `steps from ${step.from} to ${step.to}, and migration ${index + 1} must step from ${want} to ${want + 1}.`,
        'List one step per version, from 1 to 2 up to the current version, in order.',
        want === undefined
          ? { actual: `${step.from} to ${step.to}` }
          : { expected: `${want} to ${want + 1}`, actual: `${step.from} to ${step.to}` },
      );
    }
  });
  if (migrations.length < needed) {
    report(
      'manifest.controls-migration-gap',
      ['controls', 'migrations'],
      `has ${count(migrations.length, 'step')}, and version ${version} needs ${needed}, one from each earlier version.`,
      'Add the missing steps, so stored values of any earlier version migrate.',
      { expected: String(needed), actual: String(migrations.length) },
    );
  }
  checkLastStep(manifest, report);
}

/**
 * The step to the current version leaves values under the current controls,
 * so each control it renames to, maps, or clamps must be one, under the name
 * the step's later renames give it. Earlier steps name controls of versions
 * the manifest no longer describes, so they go unchecked.
 */
function checkLastStep(manifest: VariantManifest, report: Report) {
  const { items, migrations, version } = manifest.controls;
  const stepIndex = migrations.findIndex((step) => step.to === version);
  const step = migrations[stepIndex];
  if (!step) return;
  const current = new Set(items.map((control) => control.id));
  const finalName = (name: string, after: number) =>
    step.operations
      .slice(after + 1)
      .reduce((value, op) => (op.op === 'rename' && op.from === value ? op.to : value), name);
  step.operations.forEach((op, opIndex) => {
    const named: [string, string] | null =
      op.op === 'rename'
        ? ['to', op.to]
        : op.op === 'mapValue' || op.op === 'clamp'
          ? ['control', op.control]
          : null;
    if (!named || current.has(finalName(named[1], opIndex))) return;
    report(
      'manifest.unknown-ref',
      ['controls', 'migrations', stepIndex, 'operations', opIndex, named[0]],
      `names a control version ${version} doesn't declare, so the value this step leaves is one nothing reads.`,
      'Name one of controls.items, as the step leaves it.',
      { actual: named[1] },
    );
  });
}

function checkControlDefault(control: ControlDeclaration, at: (string | number)[], report: Report) {
  switch (control.type) {
    case 'enum': {
      duplicates(control.options, [...at, 'options'], (option) => option.value, report, 'value', [
        'value',
      ]);
      const values = control.options.map((option) => option.value);
      if (!values.includes(control.default)) {
        report(
          'manifest.invalid',
          [...at, 'default'],
          'must be one of the options.',
          `Use one of: ${values.join(', ')}.`,
          { expected: values.join(' | '), actual: control.default },
        );
      }
      return;
    }
    case 'integer':
      if (control.min > control.max) {
        report(
          'manifest.invalid',
          [...at, 'max'],
          `must be at least min (${control.min}).`,
          'Swap or fix the bounds.',
          {
            expected: `>= ${control.min}`,
            actual: String(control.max),
          },
        );
      } else if (
        control.default < control.min ||
        control.default > control.max ||
        (control.default - control.min) % control.step !== 0
      ) {
        report(
          'manifest.invalid',
          [...at, 'default'],
          `must be between ${control.min} and ${control.max}, in steps of ${control.step} from ${control.min}.`,
          'Pick a default the control can take.',
          { actual: String(control.default) },
        );
      }
      return;
    case 'contentRefList':
      // With min at 0 and max at least 1, the bounds can't cross.
      if (control.min > 0) {
        report(
          'manifest.invalid',
          [...at, 'min'],
          "must be 0: the list's default is empty, since a manifest can't know content ids.",
          'Set min to 0. To need content, add a content slot that selects by this control, with its own min.',
          { expected: '0', actual: String(control.min) },
        );
      }
      return;
    default:
      return;
  }
}

/**
 * Cross-document view transitions (K-4 (a), contract 2.1): only in a 2.1
 * manifest, each name a CSS ident starting with the variant's id and a
 * hyphen, no name twice, and no names when crossDocument is false, since
 * nothing would run them. The schema holds the cap, MAX_TRANSITION_NAMES.
 */
function checkTransitions(manifest: VariantManifest, report: Report) {
  const transitions = manifest.transitions;
  if (!transitions) return;
  const contract = parseContractVersion(manifest.contract);
  if (contract && contract.minor < TRANSITIONS_MINOR) {
    report(
      'manifest.invalid',
      ['transitions'],
      `is cross-document view transitions, which contract 2.${TRANSITIONS_MINOR} adds, and the manifest declares contract ${manifest.contract}.`,
      `Declare contract 2.${TRANSITIONS_MINOR}, or remove transitions.`,
      { expected: `contract 2.${TRANSITIONS_MINOR} or later`, actual: manifest.contract },
    );
  }
  if (!transitions.crossDocument && transitions.names.length > 0) {
    report(
      'manifest.invalid',
      ['transitions', 'names'],
      'names view transitions, and crossDocument is false, so the host writes no @view-transition to run them.',
      'Set crossDocument to true, or empty names.',
      { expected: '[]', actual: `${transitions.names.length} names` },
    );
  }
  transitions.names.forEach((name, index) => {
    const problem = transitionNameProblem(manifest.id, name);
    if (problem) {
      report(
        'manifest.invalid',
        ['transitions', 'names', index],
        problem,
        `Rename it ${manifest.id}-<name>.`,
        {
          expected: `${manifest.id}-<name>`,
          actual: name,
        },
      );
    }
  });
  duplicates(transitions.names, ['transitions', 'names'], (name) => name, report, 'name');
}

function checkEnhancements(
  manifest: VariantManifest,
  context: ManifestContext,
  report: Report,
  notChecked: string[],
) {
  const enhancements = manifest.enhancements ?? [];
  duplicates(enhancements, ['enhancements'], (item) => item.id, report, 'enhancement id', ['id']);
  enhancements.forEach((item, index) => {
    duplicates(
      item.requires,
      ['enhancements', index, 'requires'],
      (flag) => flag,
      report,
      'requirement',
    );
  });
  if (enhancements.length === 0) return;
  if (context.exports === undefined) {
    notChecked.push('enhancements.export');
    return;
  }
  const subpaths =
    typeof context.exports === 'string'
      ? ['.']
      : isPlainObject(context.exports)
        ? Object.keys(context.exports)
        : [];
  enhancements.forEach((item, index) => {
    if (!subpaths.includes(item.export)) {
      report(
        'manifest.enhancement-missing-export',
        ['enhancements', index, 'export'],
        "isn't in the package's exports, so the host can't load it.",
        `Add "${item.export}" to exports in package.json, or fix the subpath.`,
        { actual: item.export },
      );
    }
  });
}
