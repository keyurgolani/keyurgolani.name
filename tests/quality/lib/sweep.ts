// The pack sweep (#11 and #20, the owner's [37] rule in a PR). A PR that
// changes a pack runs it against every registered variant. Before the
// sweep, each pack and variant pair was a cell with a server of its own,
// tested at every viewport in the default row and in every row at
// 1440x900, which put 2a's 33 new packs at about 8500 s a shard. The sweep
// keeps every pair and drops the rest:
//
// - One server per variant, its sweep server (server.ts): the complete
//   fixture under the variant's published default appearance, with every
//   pack axis and the display mode selectable by the visitor. Each pair's
//   cell applies its tuple through the visitor's preference cookie, the
//   one POST /api/appearance sets, which the host resolves as it would for
//   any visitor. A pack that doesn't render as asked fails the cell's
//   runner check (`sweep-pack`), so a cookie the host ignored never passes
//   as the variant's own appearance.
// - The [37] rule's five checks at 1440x900, in the rows that run them:
//   contrast and focus in the default row, focus under forced colors,
//   motion under reduced motion, and transparency under reduced
//   transparency (SWEEP_CHECKS). Each row is a test of its own, so each
//   pack starts in a fresh browser context and a full load: nothing one
//   pack set carries into the next.
// - Every failure is a failure record, naming the pack, its axis, the
//   variant, and the check (records.ts's changeFields and runnerFailure),
//   and a test records every one of its findings before it fails.
//
// What moves out of the PR: those pairs at 1024x768 and 390x844 in the
// default row, the contrast-more, high-contrast, print, and no-JavaScript
// rows, and the default row's reload conditions (reflow, inventory, and
// failed enhancement). The scheduled quality-full run plans every one of
// them for every shipping pack and every variant, as it did.

import type { Cell, PlannedTest } from '../cells';
import { requiredChecks } from './checks';
import type { Finding } from './a11y/interaction';
import { PREFERENCE_ROWS, VIEWPORTS, type PreferenceRow, type Viewport } from './matrix';
import type { ResolvedTokens } from './records';

/** The visitor's preference cookie (apps/web/src/lib/document-appearance.ts's APPEARANCE_COOKIE). */
export const APPEARANCE_COOKIE = 'portfolio_appearance';

/** The viewport the sweep runs at. */
export const SWEEP_VIEWPORT: Viewport = VIEWPORTS[0]!;

/**
 * The [37] rule's five checks, each with the row the sweep runs it in and
 * the check a test of that row owes (checks.ts's requiredChecks).
 */
export const SWEEP_CHECKS = [
  { name: 'contrast', row: 'default', check: 'contrast' },
  { name: 'focus', row: 'default', check: 'focus' },
  { name: 'forced-colors', row: 'forced-colors', check: 'focus' },
  { name: 'reduced-motion', row: 'reduced-motion', check: 'motion' },
  { name: 'reduced-transparency', row: 'reduced-transparency', check: 'transparency' },
] as const;

/** The rows the sweep runs, in the matrix's order. */
export const SWEEP_ROWS: readonly PreferenceRow[] = PREFERENCE_ROWS.filter((row) =>
  SWEEP_CHECKS.some((each) => each.row === row.id),
);

/**
 * Whether a PR plan sweeps `cell`: a change-directed cell that only
 * changed packs brought in. A cell a changed variant also directs, or one
 * that is a sentinel, such as a changed pack that is the platform default,
 * keeps every viewport and row.
 */
export function sweeps(
  cell: Pick<Cell, 'changed' | 'sentinel' | 'pack'>,
  mode: 'pr' | 'full',
): boolean {
  return (
    mode === 'pr' &&
    !cell.sentinel &&
    cell.pack === undefined &&
    cell.changed !== undefined &&
    cell.changed.length > 0 &&
    cell.changed.every((by) => by.axis !== 'variant')
  );
}

/** The cookie that applies a sweep cell's tuple on its variant's sweep server at `origin`. */
export function packCookie(
  cell: Pick<Cell, 'tuple'>,
  origin: string,
): { name: string; value: string; url: string } {
  // The text form serializeSelection() writes and parseSelection() reads.
  const value = new URLSearchParams({
    language: cell.tuple.designLanguage,
    scheme: cell.tuple.colorScheme,
    type: cell.tuple.typography,
    mode: cell.tuple.displayMode,
  }).toString();
  return { name: APPEARANCE_COOKIE, value, url: origin };
}

/** The boundary attribute each pack axis renders as (packages/appearance/src/boundary.ts). */
const PACK_ATTRIBUTES = [
  ['designLanguage', 'data-design-language'],
  ['colorScheme', 'data-color-scheme'],
  ['typography', 'data-typography'],
] as const;

/**
 * The runner's `sweep-pack` findings: the page's outermost presentation
 * boundary must render the cell's packs, so a cookie the host refused, or
 * a pack left over from another, fails instead of passing as the variant's
 * default.
 */
export function packFindings(cell: Pick<Cell, 'tuple'>, tokens: ResolvedTokens): Finding[] {
  const boundary = tokens.boundaries[0];
  if (!boundary) {
    return [
      {
        gate: 'runner',
        rule: 'sweep-pack',
        expected: 'a presentation boundary',
        actual: 'the page rendered none',
      },
    ];
  }
  return PACK_ATTRIBUTES.flatMap(([axis, attribute]): Finding[] => {
    const rendered = boundary.attributes[attribute];
    const asked = cell.tuple[axis];
    return rendered === asked
      ? []
      : [
          {
            gate: 'runner',
            rule: 'sweep-pack',
            expected: `${attribute}=${asked}`,
            actual: `${attribute}=${rendered ?? '(none)'}`,
          },
        ];
  });
}

/** The [37] checks a planned test runs: each SWEEP_CHECKS entry whose row it is and whose check it owes. */
export function sweepChecksOf(
  test: Pick<PlannedTest, 'viewport' | 'row' | 'conditions'>,
): (typeof SWEEP_CHECKS)[number]['name'][] {
  if (test.viewport.id !== SWEEP_VIEWPORT.id) return [];
  const owed = requiredChecks(test.row.id, test.viewport.id, test.conditions);
  return SWEEP_CHECKS.filter((each) => each.row === test.row.id && owed.includes(each.check)).map(
    (each) => each.name,
  );
}
