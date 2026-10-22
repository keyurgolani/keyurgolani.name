// Typed customization controls (#5, Slice 1, item 2). A variant declares
// them in its manifest; the site document stores values per variant in
// `variantControls.<id>`. Omitted values take defaults, an invalid or stale
// one renders its default, and inactive variants keep their entries.

import { canonicalize, isPlainObject, type PublicPortfolio, type Site } from '@portfolio/schema';
import type { ControlDeclaration, MigrationOperation, VariantManifest } from './manifest-schema';

/** A control's value: boolean, enum value, integer, content id or null, or a list of content ids. */
export type ControlValue = boolean | string | number | null | readonly string[];
export type ControlValues = Readonly<Record<string, ControlValue>>;

/** One variant's stored values, as `variantControls.<id>` holds them. */
export interface ControlsEntry {
  readonly version: number;
  readonly values: Readonly<Record<string, unknown>>;
}

/**
 * The site's stored values for the variant `id`: its own `variantControls`
 * entry, never one the object inherits, so a variant with the id
 * `constructor` has none until the site stores one.
 */
export function storedControls(
  site: Pick<Site, 'variantControls'>,
  id: string,
): ControlsEntry | undefined {
  const stored = site.variantControls;
  return stored !== undefined && Object.hasOwn(stored, id) ? stored[id] : undefined;
}

/**
 * The content a contentRef may point at, by id: each visible section, by its
 * kind, and each visible work, evidence entry, and chronology entry, by the
 * kind of section that lists it (works, evidence, chronology). Ids are unique
 * across the document, so the two never collide.
 */
export type ContentIndex = ReadonlyMap<string, string>;

/**
 * Each visible section's id and kind, and each visible record's id and the
 * section kind that lists its type (#10). Pass a public view's portfolio,
 * which holds no hidden section, private record, or unregistered extension
 * section, so a reference to any of them is dangling, as it is when the
 * variant renders.
 */
export function contentIndex(portfolio: PublicPortfolio): ContentIndex {
  const index = new Map<string, string>(
    portfolio.sections.map((section) => [section.id, section.kind]),
  );
  for (const [kind, records] of [
    ['works', portfolio.works],
    ['evidence', portfolio.evidence],
    ['chronology', portfolio.chronology],
  ] as const) {
    for (const { id } of records) if (!index.has(id)) index.set(id, kind);
  }
  return index;
}

export interface ControlProblem {
  readonly code: 'controls.invalid' | 'controls.stale' | 'controls.dangling-ref';
  /** Path inside the entry, such as `['values', 'heroLayout']`. */
  readonly path: readonly (string | number)[];
  /** What's wrong, written to follow the value's pointer: "must be true or false." */
  readonly message: string;
  readonly remediation: string;
}

/**
 * What's wrong with a variant's stored values, against its manifest and the
 * visible content. A version other than the manifest's is the one problem:
 * its values are of another version, so none of them is read.
 */
export function checkControlValues(
  manifest: VariantManifest,
  entry: ControlsEntry | undefined,
  content: ContentIndex,
): ControlProblem[] {
  if (!entry) return [];
  const { version, items } = manifest.controls;
  if (entry.version !== version) {
    const older = entry.version < version;
    return [
      {
        code: 'controls.stale',
        path: ['version'],
        message: older
          ? `is older than the variant's controls version (${version}), so every control renders its default.`
          : `is newer than the variant's controls version (${version}), so every control renders its default.`,
        remediation: older
          ? 'Run pnpm variants:migrate-controls --site <path> to migrate the values, or set them again.'
          : 'Upgrade the variant package to the release these values were set with, or set them again.',
      },
    ];
  }
  const problems: ControlProblem[] = [];
  const declared = new Map(items.map((control) => [control.id, control]));
  for (const [key, value] of Object.entries(entry.values)) {
    const control = declared.get(key);
    if (!control) {
      problems.push({
        code: 'controls.invalid',
        path: ['values', key],
        message: "names a control the variant doesn't declare.",
        remediation: `Remove it. The variant's controls are: ${[...declared.keys()].join(', ') || 'none'}.`,
      });
      continue;
    }
    problems.push(...valueProblems(control, value, content, ['values', key]));
  }
  return problems;
}

function valueProblems(
  control: ControlDeclaration,
  value: unknown,
  content: ContentIndex,
  path: readonly (string | number)[],
): ControlProblem[] {
  const invalid = (message: string, remediation: string, at = path): ControlProblem => ({
    code: 'controls.invalid',
    path: at,
    message,
    remediation,
  });
  switch (control.type) {
    case 'boolean':
      return typeof value === 'boolean'
        ? []
        : [invalid('must be true or false.', 'Set true or false.')];
    case 'enum': {
      const values = control.options.map((option) => option.value);
      return typeof value === 'string' && values.includes(value)
        ? []
        : [invalid("must be one of the control's options.", `Use one of: ${values.join(', ')}.`)];
    }
    case 'integer':
      return integerFits(control, value)
        ? []
        : [
            invalid(
              `must be an integer from ${control.min} to ${control.max}, in steps of ${control.step}.`,
              'Pick a value the control can take.',
            ),
          ];
    case 'contentRef':
      if (value === null) return [];
      if (typeof value !== 'string') {
        return [
          invalid(
            'must be a section or record id, or null.',
            'Set a section or record id, or null for none.',
          ),
        ];
      }
      return refProblems(control, value, content, path);
    case 'contentRefList': {
      if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
        return [
          invalid(
            'must be a list of section or record ids.',
            'Set a list of section or record ids.',
          ),
        ];
      }
      const problems: ControlProblem[] = [];
      if (value.length < control.min || value.length > control.max) {
        problems.push(
          invalid(
            `must list from ${control.min} to ${control.max} sections or records.`,
            `List between ${control.min} and ${control.max}.`,
          ),
        );
      }
      const seen = new Set<string>();
      value.forEach((item, index) => {
        if (seen.has(item)) {
          problems.push(invalid('lists an id twice.', 'Remove the repeat.', [...path, index]));
        }
        seen.add(item);
        problems.push(...refProblems(control, item, content, [...path, index]));
      });
      return problems;
    }
  }
}

function integerFits(
  control: Extract<ControlDeclaration, { type: 'integer' }>,
  value: unknown,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= control.min &&
    value <= control.max &&
    (value - control.min) % control.step === 0
  );
}

function refProblems(
  control: Extract<ControlDeclaration, { type: 'contentRef' | 'contentRefList' }>,
  id: string,
  content: ContentIndex,
  path: readonly (string | number)[],
): ControlProblem[] {
  const kind = content.get(id);
  if (kind === undefined) {
    return [
      {
        code: 'controls.dangling-ref',
        path,
        message:
          'points at nothing visible: no section or record has that id, or it is hidden or private.',
        remediation: 'Point it at a visible section or record, or clear it.',
      },
    ];
  }
  if (control.kinds && !control.kinds.includes(kind)) {
    return [
      {
        code: 'controls.invalid',
        path,
        message: `points at content of a kind the control doesn't take.`,
        remediation: `Point it at a section or record of kind ${control.kinds.join(', ')}.`,
      },
    ];
  }
  return [];
}

/**
 * Every control's value: the stored one when it's valid, else the default.
 * An entry of another version gives every default, since nothing reads old
 * control versions. This is what a revision stores (#3).
 */
export function materializeControls(
  manifest: VariantManifest,
  entry: ControlsEntry | undefined,
  content: ContentIndex,
): ControlValues {
  const stored =
    entry && entry.version === manifest.controls.version && isPlainObject(entry.values)
      ? entry.values
      : {};
  const values: Record<string, ControlValue> = {};
  for (const control of manifest.controls.items) {
    const value = Object.hasOwn(stored, control.id) ? stored[control.id] : undefined;
    const usable =
      value !== undefined &&
      valueProblems(control, value, content, ['values', control.id]).length === 0;
    values[control.id] = usable ? (value as ControlValue) : control.default;
  }
  return values;
}

/** Deterministic JSON for an entry: keys sorted, numbers in their canonical form (RFC 8785). */
export function serializeControls(entry: ControlsEntry): string {
  return canonicalize(entry);
}

/** One change a migration made, for a diff. */
export interface ControlChange {
  readonly from: number;
  readonly to: number;
  readonly op: MigrationOperation['op'];
  readonly control: string;
  readonly before?: unknown;
  readonly after?: unknown;
}

export interface MigrationResult {
  readonly entry: ControlsEntry;
  readonly changes: readonly ControlChange[];
  /** The entry is newer than the manifest, so it's left as it was. */
  readonly newer: boolean;
}

/**
 * Steps an entry from its version to the manifest's, one migration at a
 * time. An entry already at the manifest's version comes back unchanged, so
 * running it twice is a no-op.
 */
export function migrateControls(manifest: VariantManifest, entry: ControlsEntry): MigrationResult {
  const target = manifest.controls.version;
  if (entry.version > target) return { entry, changes: [], newer: true };
  let values: Record<string, unknown> = { ...entry.values };
  let version = entry.version;
  const changes: ControlChange[] = [];
  for (const step of manifest.controls.migrations) {
    if (step.from !== version || version >= target) continue;
    for (const operation of step.operations) {
      values = apply(operation, values, (change) =>
        changes.push({ from: step.from, to: step.to, op: operation.op, ...change }),
      );
    }
    version = step.to;
  }
  return { entry: { version, values }, changes, newer: false };
}

function apply(
  operation: MigrationOperation,
  values: Record<string, unknown>,
  record: (change: { control: string; before?: unknown; after?: unknown }) => void,
): Record<string, unknown> {
  const next = { ...values };
  switch (operation.op) {
    case 'rename':
      if (Object.hasOwn(next, operation.from) && !Object.hasOwn(next, operation.to)) {
        next[operation.to] = next[operation.from];
        delete next[operation.from];
        record({ control: operation.from, after: operation.to });
      }
      return next;
    case 'mapValue': {
      const value = next[operation.control];
      const key =
        typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : undefined;
      if (key !== undefined && Object.hasOwn(operation.map, key)) {
        next[operation.control] = operation.map[key];
        record({ control: operation.control, before: value, after: operation.map[key] });
      }
      return next;
    }
    case 'clamp': {
      const value = next[operation.control];
      if (typeof value !== 'number') return next;
      const low = operation.min ?? -Infinity;
      const high = operation.max ?? Infinity;
      const clamped = Math.min(high, Math.max(low, value));
      if (clamped !== value) {
        next[operation.control] = clamped;
        record({ control: operation.control, before: value, after: clamped });
      }
      return next;
    }
    case 'drop':
      if (Object.hasOwn(next, operation.control)) {
        record({ control: operation.control, before: next[operation.control] });
        delete next[operation.control];
      }
      return next;
  }
}
