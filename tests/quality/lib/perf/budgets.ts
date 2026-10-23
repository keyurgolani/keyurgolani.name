// #6's budget results in a quality run's summary.json (#11, 11-3),
// read-only. The budgets gate in CI's trace job, where pnpm check:budgets
// writes reports/budgets/budget-report.json and one failure record per
// breach; the quality runs never judge them a second time. When that report
// is in the same job's reports, summary.json carries its counts and
// breaches; when it isn't, it says so.

import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Where check:budgets writes its report, under the reports root. */
export const BUDGET_REPORT = path.join('budgets', 'budget-report.json');

/** What gates the budgets, for a summary that has none to show. */
export const BUDGETS_GATED_BY = "pnpm check:budgets in CI's trace job (#6)";

interface BudgetReport {
  readonly tool?: string;
  readonly generatedAt?: string;
  readonly units?: readonly unknown[];
  readonly checked?: readonly unknown[];
  readonly records?: readonly {
    readonly unit?: { readonly kind?: string; readonly id?: string } | null;
    readonly metric?: string;
    readonly route?: string;
    readonly viewport?: string;
    readonly actual?: number;
    readonly threshold?: number;
    readonly test?: string;
  }[];
}

export type BudgetResults =
  | {
      readonly status: 'not in this job';
      readonly gatedBy: string;
    }
  | {
      readonly status: 'unreadable';
      readonly source: string;
      readonly gatedBy: string;
      readonly error: string;
    }
  | {
      readonly status: 'within' | 'over';
      readonly source: string;
      readonly gatedBy: string;
      readonly tool: string | null;
      readonly generatedAt: string | null;
      readonly units: number;
      readonly checked: number;
      readonly breaches: readonly {
        readonly unit: string | null;
        readonly metric: string | null;
        readonly route: string | null;
        readonly viewport: string | null;
        readonly actual: number | null;
        readonly threshold: number | null;
        readonly test: string | null;
      }[];
    };

/** check:budgets' report under `reports`, summarized, or what says it isn't there. */
export function budgetResults(reports: string): BudgetResults {
  const file = path.join(reports, BUDGET_REPORT);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return { status: 'not in this job', gatedBy: BUDGETS_GATED_BY };
  }
  let report: BudgetReport;
  try {
    report = JSON.parse(text) as BudgetReport;
  } catch (error) {
    return {
      status: 'unreadable',
      source: BUDGET_REPORT,
      gatedBy: BUDGETS_GATED_BY,
      error: (error as Error).message,
    };
  }
  const breaches = (report.records ?? []).map((record) => ({
    unit: record.unit ? `${record.unit.kind} ${record.unit.id}` : null,
    metric: record.metric ?? null,
    route: record.route ?? null,
    viewport: record.viewport ?? null,
    actual: record.actual ?? null,
    threshold: record.threshold ?? null,
    test: record.test ?? null,
  }));
  return {
    status: breaches.length > 0 ? 'over' : 'within',
    source: BUDGET_REPORT,
    gatedBy: BUDGETS_GATED_BY,
    tool: report.tool ?? null,
    generatedAt: report.generatedAt ?? null,
    units: report.units?.length ?? 0,
    checked: report.checked?.length ?? 0,
    breaches,
  };
}
