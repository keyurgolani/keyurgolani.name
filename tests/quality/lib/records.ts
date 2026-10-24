// The quality cells' failures (#11, Slice 1, item 10): one per failing rule
// and element in a cell, as Part A's writer (failure-records.ts) takes
// them, naming the rule, the route, viewport, input mode, preference mode,
// tuple, and the element's ARIA role, accessible name, #19 slot, and token
// role. A test attaches its failures as quality-records.json; the quality
// reporter hands them to writeCellFailures() under ci/run.mjs, which
// checks each against the schema (1.1) and writes it with the gate and
// the local command.

import type { AxeBuilder } from '@axe-core/playwright';
import type { Cell } from '../cells';
import type { CellFailure } from './failure-records';
import type { PreferenceRow, Viewport } from './matrix';
import type { ColorProperty, ElementDetails } from './probes';
import type { AppearanceTuple } from './vocabulary';

/** axe's results, as @axe-core/playwright's analyze() gives them. */
export type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>;
type Result = AxeResults['violations'][number];
type NodeResult = Result['nodes'][number];

/** The attachment a test's failures travel in, to the reporter. */
export const RECORDS_ATTACHMENT = 'quality-records.json';

/** The check the runner's own rules belong to: the status, the emulation, and the clock. */
export const RUNNER_CHECK = 'runner';

/** The property a rule's token role is matched on, or null for a rule that isn't about color. */
export function colorPropertyFor(rule: string): ColorProperty | null {
  return /contrast|color|link-in-text-block/.test(rule) ? 'color' : null;
}

/** The element a node result names: its last selector, outside any frame or shadow root. */
export function nodeSelector(node: NodeResult): string | null {
  const last = node.target.at(-1);
  return typeof last === 'string' ? last : null;
}

/** What the failure was against: a contrast check's ratios, or the rule's help and what the node failed. */
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

/** A cell's tuple as records and exception scopes name it: the three packs and the display mode. */
export function recordTuple(cell: Cell): AppearanceTuple {
  return {
    designLanguage: cell.tuple.designLanguage,
    colorScheme: cell.tuple.colorScheme,
    typography: cell.tuple.typography,
    displayMode: cell.tuple.displayMode as AppearanceTuple['displayMode'],
  };
}

export interface CellContext {
  readonly cell: Cell;
  readonly viewport: Viewport;
  readonly row: PreferenceRow;
  /** Paths inside the reports artifact: the cell's axe JSON, vitals, and resolved tokens. */
  readonly artifacts: readonly string[];
}

/**
 * The axis a change-directed cell's failures name (the owner's [37] rule):
 * the first change that brought the cell in, and for a language, the pack.
 */
export function changeFields(cell: Pick<Cell, 'changed'>): Pick<CellFailure, 'axis' | 'pack'> {
  const by = cell.changed?.[0];
  if (!by) return {};
  // A changed pack names itself; a changed variant, the shipping pack it met (#20).
  if (by.axis !== 'variant') return { axis: by.axis, pack: by.id };
  return by.pack ? { axis: by.pack.axis, pack: by.pack.id } : { axis: by.axis };
}

/** What every failure of a cell's test shares. */
function cellFields(context: CellContext): Omit<CellFailure, 'check' | 'rule'> {
  const { cell, viewport, row } = context;
  return {
    ...changeFields(cell),
    surface: cell.target,
    composition: cell.kind === 'composition',
    route: cell.route,
    tuple: recordTuple(cell),
    viewport: viewport.id,
    inputMode: viewport.inputMode,
    preferenceMode: row.id,
    profile: cell.profile,
    artifacts: context.artifacts.length > 0 ? context.artifacts : undefined,
  };
}

/** One failure per violated rule and element. `details` holds each node's element, by rule id and the node's index. */
export function axeFailures(
  context: CellContext,
  results: Pick<AxeResults, 'violations'>,
  details: Readonly<Record<string, readonly ElementDetails[]>>,
): CellFailure[] {
  const shared = cellFields(context);
  return results.violations.flatMap((rule) =>
    rule.nodes.map((node, index): CellFailure => {
      const element = details[rule.id]?.[index];
      return {
        ...shared,
        check: 'axe',
        rule: rule.id,
        element: {
          semanticRole: element?.semanticRole,
          accessibleName: element?.accessibleName,
          uiSlot: element?.uiSlot,
          tokenRole: element?.tokenRole,
          selector: nodeSelector(node) ?? undefined,
        },
        ...measures(rule, node),
      };
    }),
  );
}

/** One failure of the runner's own rules, such as a status other than the state's. */
export function runnerFailure(context: CellContext, rule: string, actual: string): CellFailure {
  return { ...cellFields(context), check: RUNNER_CHECK, rule, actual };
}

/** The boundaries a page resolved, as probes.ts's resolvedTokensScript reads them. */
export interface ResolvedTokens {
  readonly boundaries: readonly {
    readonly kind: string | null;
    readonly attributes: Readonly<Record<string, string>>;
    readonly tokens: Readonly<Record<string, string>>;
  }[];
}

/** How many tokens a diagnostic shows of each boundary; the file it names keeps every one. */
const SHOWN_TOKENS = 6;

/**
 * The resolved-token diagnostic a change-directed cell's failures carry
 * (the owner's [37] rule): which changed axis brought the cell in, its
 * tuple, and what each page's presentation boundaries resolved, with the
 * file that keeps every token. Null for a cell no change brought in.
 */
export function changeDiagnostic(
  cell: Pick<Cell, 'changed' | 'tuple'>,
  pages: readonly {
    readonly route: string;
    readonly tokens: ResolvedTokens;
    readonly file: string;
  }[],
): string | null {
  if (!cell.changed?.length) return null;
  const by = cell.changed
    .map(
      ({ axis, id, pack }) =>
        `${axis} ${id}${pack ? ` (against the ${pack.axis} ${pack.id})` : ''}`,
    )
    .join(' and ');
  const tuple = [
    cell.tuple.variant,
    cell.tuple.designLanguage,
    cell.tuple.colorScheme,
    cell.tuple.typography,
    cell.tuple.displayMode,
  ].join('/');
  const resolved = pages.map(({ route, tokens, file }) => {
    if (tokens.boundaries.length === 0)
      return `${route} rendered no presentation boundary (${file})`;
    const boundaries = tokens.boundaries.map((boundary) => {
      const attributes = Object.entries(boundary.attributes)
        .map(([name, value]) => `${name}=${value}`)
        .join(' ');
      const entries = Object.entries(boundary.tokens).sort(([a], [b]) => (a < b ? -1 : 1));
      const shown = entries
        .slice(0, SHOWN_TOKENS)
        .map(([name, value]) => `${name}: ${value}`)
        .join(', ');
      const more =
        entries.length > SHOWN_TOKENS ? `, and ${entries.length - SHOWN_TOKENS} more` : '';
      return `the ${boundary.kind ?? 'unnamed'} boundary (${attributes || 'no data attributes'}) resolved ${entries.length} token(s)${entries.length > 0 ? `: ${shown}${more}` : ''}`;
    });
    return `on ${route}, ${boundaries.join('; ')} (${file})`;
  });
  return `Change-directed by the [37] rule: the ${by} changed, so this cell runs ${tuple}. ${resolved.join('. ')}.`;
}
