// Failure records for the quality cells (#11, Slice 1, item 10): one per
// failing rule and element in a cell, in the #12 schema's minor version 1.1,
// naming the gate's rule, the route, viewport, input mode, preference mode,
// tuple, and the element's slot, ARIA role, accessible name, and token role.
// A test attaches its records as quality-records.json; the quality reporter
// writes them under ci/run.mjs, with the gate and the local command.

import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { AxeBuilder } from '@axe-core/playwright';
import { failuresDir } from '../../../ci/lib/reports.mjs';
import type { Cell } from '../cells';
import { tupleKey } from '../coverage';
import type { InputMode, PreferenceRow, Viewport } from './matrix';
import type { ColorProperty, ElementDetails } from './probes';

/** axe's results, as @axe-core/playwright's analyze() gives them. */
export type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>;
type Result = AxeResults['violations'][number];
type NodeResult = Result['nodes'][number];

/** What a record says beyond the gate, the local command, and the schema version. */
export interface RecordFields {
  readonly test: string;
  /** The gate's rule: an axe rule id, or one of the harness's own. */
  readonly rule: string;
  readonly route: string;
  readonly profile: string;
  readonly viewport: string;
  readonly inputMode: InputMode;
  /** The preference row. */
  readonly preferenceMode: string;
  readonly displayMode: string;
  /** variant/designLanguage/colorScheme/typography/displayMode. */
  readonly tuple: string;
  readonly variant?: string;
  readonly pack?: string;
  readonly uiSlot?: string;
  readonly semanticRole?: string;
  readonly accessibleName?: string;
  readonly tokenRole?: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly artifacts?: readonly string[];
}

/** The attachment a test's records travel in, to the reporter. */
export const RECORDS_ATTACHMENT = 'quality-records.json';

/** The property a rule's token role is matched on, or null for a rule that isn't about color. */
export function colorPropertyFor(rule: string): ColorProperty | null {
  return /contrast|color|link-in-text-block/.test(rule) ? 'color' : null;
}

/** The element a node result names: its last selector, outside any frame or shadow root. */
export function nodeSelector(node: NodeResult): string | null {
  const last = node.target.at(-1);
  return typeof last === 'string' ? last : null;
}

/** What the failure was against: a contrast check's ratios, or the rule's help. */
function measures(rule: Result, node: NodeResult): { expected?: string; actual?: string } {
  const data = node.any.find((check) => check.data && typeof check.data === 'object')?.data as
    { contrastRatio?: number; expectedContrastRatio?: string } | undefined;
  if (data?.expectedContrastRatio !== undefined && data.contrastRatio !== undefined) {
    return { expected: data.expectedContrastRatio, actual: `${data.contrastRatio}:1` };
  }
  const summary = node.failureSummary
    ?.split('\n')
    .find((line) => line.trim() && !line.startsWith('Fix'));
  return { expected: rule.help, actual: summary?.trim() || rule.description };
}

export interface CellContext {
  readonly cell: Cell;
  readonly viewport: Viewport;
  readonly row: PreferenceRow;
  readonly test: string;
  readonly artifacts: readonly string[];
}

/** The fields every record of a cell's test shares. */
export function cellFields(context: CellContext): Omit<RecordFields, 'rule'> {
  const { cell, viewport, row } = context;
  return {
    test: context.test,
    route: cell.route,
    profile: cell.profile,
    viewport: viewport.id,
    inputMode: viewport.inputMode,
    preferenceMode: row.id,
    displayMode: cell.tuple.displayMode,
    tuple: tupleKey(cell.tuple),
    variant: cell.kind === 'composition' ? cell.target : undefined,
    pack: cell.pack,
    artifacts: context.artifacts.length > 0 ? context.artifacts : undefined,
  };
}

/**
 * One record per violated rule and element. `details` holds each node's
 * element details, by rule id and the node's index.
 */
export function axeRecords(
  context: CellContext,
  results: Pick<AxeResults, 'violations'>,
  details: Readonly<Record<string, readonly ElementDetails[]>>,
): RecordFields[] {
  const shared = cellFields(context);
  return results.violations.flatMap((rule) =>
    rule.nodes.map((node, index) => {
      const element = details[rule.id]?.[index];
      return {
        ...shared,
        rule: rule.id,
        uiSlot: element?.uiSlot,
        semanticRole: element?.semanticRole,
        accessibleName: element?.accessibleName,
        tokenRole: element?.tokenRole,
        ...measures(rule, node),
      };
    }),
  );
}

/** One record for one of the harness's own rules, such as a missing marker. */
export function harnessRecord(context: CellContext, rule: string, actual: string): RecordFields {
  return { ...cellFields(context), rule, actual };
}

/** The schema version these records are written against: #12's 1.0 plus #11's fields. */
export const RECORD_SCHEMA_VERSION = '1.1';

/**
 * Writes each record into the failures directory, one file each, with the
 * gate and the local command, dropping empty fields.
 */
export function writeRecords(
  records: readonly (Partial<RecordFields> & Pick<RecordFields, 'test' | 'rule'>)[],
  { gate, reproCommand }: { readonly gate: string; readonly reproCommand: string },
  dir: string = failuresDir(),
): string[] {
  mkdirSync(dir, { recursive: true });
  return records.map((fields) => {
    const record: Record<string, unknown> = { schemaVersion: RECORD_SCHEMA_VERSION, gate };
    for (const [key, value] of Object.entries({ ...fields, reproCommand })) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value) && value.length === 0) continue;
      record[key] = value;
    }
    const file = path.join(dir, `${gate}-${Date.now()}-${randomUUID()}.json`);
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    return file;
  });
}
