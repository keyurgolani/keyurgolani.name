// Failure records for the quality gates (#11, Slice 1, item 10): one record
// per failing rule and element in a cell, in #12's schema at version 1.1.
// Each record is checked against ci/failure-record.schema.json before any
// is written, so a writer that drifts from the schema fails here rather
// than leaving a record ci/summarize.mjs refuses later. The quality runner
// hands writeCellFailures() a cell's failures. A record names the cell's
// surface, route, tuple, viewport, input mode, and preference mode, the
// failing rule, and the element by its ARIA role (semanticRole), accessible
// name, #19 slot, and token role.

import { currentGate, failureRecord, writeFailureRecord } from '../../../ci/lib/reports.mjs';
import { loadValidator } from '../../../ci/summarize.mjs';
import {
  ID,
  INPUT_MODES,
  PREFERENCE_MODES,
  tupleKey,
  VIEWPORT,
  type AppearanceTuple,
  type InputMode,
  type PreferenceMode,
} from './vocabulary';

/** The schema version quality records are written against. */
export const RECORD_VERSION = '1.1';

/** The element a rule failed on. */
export interface FailingElement {
  /** Its ARIA role. */
  readonly semanticRole?: string;
  readonly accessibleName?: string;
  /** Its #19 primitive slot, its data-ui-slot. */
  readonly uiSlot?: string;
  /** The color role the boundary's resolved tokens give the rendered color, or hard-coded. */
  readonly tokenRole?: string;
  /**
   * Tells apart two elements that share a role, name, and slot, so each
   * gets its record. It isn't written: the schema has no selector field,
   * and the cell's axe JSON keeps it.
   */
  readonly selector?: string;
}

/** One rule failing on one element in one cell. */
export interface CellFailure {
  /** The quality check, such as axe or targets: an exception's gate. */
  readonly check: string;
  /** The rule that failed, such as color-contrast. */
  readonly rule: string;
  /** The surface or composition the cell renders. */
  readonly surface: string;
  /** It's a registered composition, so the record names it as its variant. */
  readonly composition?: boolean;
  readonly route: string;
  readonly tuple?: AppearanceTuple;
  /** WIDTHxHEIGHT in CSS px. */
  readonly viewport: string;
  readonly inputMode: InputMode;
  readonly preferenceMode: PreferenceMode;
  /** The deployment profile the app ran under. */
  readonly profile?: string;
  readonly element?: FailingElement;
  readonly expected?: string | number | boolean;
  readonly actual?: string | number | boolean;
  readonly threshold?: string | number | boolean;
  /** Paths inside the uploaded reports artifact. */
  readonly artifacts?: readonly string[];
  /** The exception that covers it, when one does. */
  readonly exceptionId?: string;
  /** A command that reproduces this cell, in place of the gate's. */
  readonly reproCommand?: string;
}

/** The CI gate records are written for, and its local command. */
export interface RecordGate {
  readonly gate: string;
  readonly reproCommand: string;
}

/** Why `failure` can't be written, or null. The schema checks the rest. */
function failureProblem(failure: CellFailure): string | null {
  if (!failure.check || !/^[a-z][a-z0-9-]*$/.test(failure.check)) {
    return `check ${JSON.stringify(failure.check)} isn't a check id, such as axe.`;
  }
  if (!failure.rule || failure.rule.trim() !== failure.rule) {
    return `rule ${JSON.stringify(failure.rule)} isn't the id of the rule that failed, such as color-contrast.`;
  }
  if (!ID.test(failure.surface))
    return `surface ${JSON.stringify(failure.surface)} isn't a registry id.`;
  if (!failure.route.startsWith('/')) return `route ${JSON.stringify(failure.route)} isn't a path.`;
  if (!VIEWPORT.test(failure.viewport)) {
    return `viewport ${JSON.stringify(failure.viewport)} isn't WIDTHxHEIGHT, such as 1440x900.`;
  }
  if (!(INPUT_MODES as readonly string[]).includes(failure.inputMode)) {
    return `inputMode ${JSON.stringify(failure.inputMode)} isn't ${INPUT_MODES.join(', ')}.`;
  }
  if (!(PREFERENCE_MODES as readonly string[]).includes(failure.preferenceMode)) {
    return `preferenceMode ${JSON.stringify(failure.preferenceMode)} isn't one of ${PREFERENCE_MODES.join(', ')}.`;
  }
  return null;
}

/** The 1.1 record for `failure`, without empty fields. Throws when the failure can't be one. */
export function cellFailureRecord(failure: CellFailure, gate: RecordGate): Record<string, unknown> {
  const problem = failureProblem(failure);
  if (problem) throw new Error(`A quality failure record can't be written: ${problem}`);
  return failureRecord({
    schemaVersion: RECORD_VERSION,
    gate: gate.gate,
    test: `${failure.check} on ${failure.surface}`,
    variant: failure.composition ? failure.surface : undefined,
    profile: failure.profile,
    route: failure.route,
    viewport: failure.viewport,
    inputMode: failure.inputMode,
    preferenceMode: failure.preferenceMode,
    tuple: failure.tuple ? tupleKey(failure.tuple) : undefined,
    rule: failure.rule,
    semanticRole: failure.element?.semanticRole,
    accessibleName: failure.element?.accessibleName,
    uiSlot: failure.element?.uiSlot,
    tokenRole: failure.element?.tokenRole,
    expected: failure.expected,
    actual: failure.actual,
    threshold: failure.threshold,
    artifacts: failure.artifacts ? [...failure.artifacts] : undefined,
    exceptionId: failure.exceptionId,
    reproCommand: failure.reproCommand ?? gate.reproCommand,
  }) as Record<string, unknown>;
}

/** What two reports of one rule failing on one element in one cell share. */
export function failureKey(failure: CellFailure): string {
  const { element } = failure;
  return JSON.stringify([
    failure.check,
    failure.rule,
    failure.surface,
    failure.route,
    failure.tuple ? tupleKey(failure.tuple) : null,
    failure.viewport,
    failure.inputMode,
    failure.preferenceMode,
    failure.profile ?? null,
    element?.selector ?? [element?.semanticRole, element?.accessibleName, element?.uiSlot],
  ]);
}

let validator: ReturnType<typeof loadValidator> | undefined;

export interface WriteResult {
  /** The record files written, one per failing rule and element. */
  readonly written: readonly string[];
  /** Failures that repeated one already written. */
  readonly duplicates: number;
}

/**
 * Writes one record per failing rule and element in `failures`, a repeat
 * of the same rule on the same element in the same cell once. It checks
 * every record against the schema first and writes none when one fails,
 * throwing with each problem. The gate comes from ci/run.mjs, as every CI
 * record's does, unless the caller names one; with neither, nothing is
 * written. `dir` is reports/failures/ unless a test names another.
 */
export async function writeCellFailures(
  failures: readonly CellFailure[],
  options: { readonly gate?: RecordGate; readonly dir?: string } = {},
): Promise<WriteResult> {
  const gate = options.gate ?? (currentGate() as RecordGate | null);
  if (!gate) return { written: [], duplicates: 0 };
  const seen = new Set<string>();
  const records: Record<string, unknown>[] = [];
  for (const failure of failures) {
    const key = failureKey(failure);
    if (seen.has(key)) continue;
    seen.add(key);
    records.push(cellFailureRecord(failure, gate));
  }
  validator ??= loadValidator();
  const validate = await validator;
  const problems = records.flatMap((record) => {
    // A plain boolean: the validator's type guard would narrow a failing record to never.
    const valid: boolean = validate(record);
    if (valid) return [];
    const errors = (validate.errors ?? []) as { instancePath?: string; message?: string }[];
    return [
      `${String(record.test)} ${String(record.rule)}: ${errors
        .map((error) => `${error.instancePath || '(record)'} ${error.message}`)
        .join('; ')}`,
    ];
  });
  if (problems.length > 0) {
    throw new Error(
      `Quality failure records don't match the schema, so none was written:\n${problems.join('\n')}`,
    );
  }
  const written = records.map((record) =>
    options.dir ? writeFailureRecord(record, options.dir) : writeFailureRecord(record),
  );
  return { written, duplicates: failures.length - records.length };
}
