import type { ReactNode } from 'react';
import { Hidden, Words } from '../parts';

// Every collection Swiss sets as a list of rows is a native table (SS-M2):
// a caption, column headers with scope, and rows of cells, so a screen
// reader's table commands and header announcements work as in any table.
// The columns sit on the page's column lines through <col> widths in
// twelfths of a table one gutter wider than its track (styles.css), never
// by changing a table part's display. On a narrow screen the table stays a
// table: the `wide` columns leave, and each row's first cell carries their
// words on a sub-line, so nothing shares a cell or overprints (SS-M3).

export interface Column {
  /** The header, in the composition's words. */
  readonly label: string;
  /** How many of the twelve columns it spans at full width. */
  readonly span: number;
  /** Numbers and short values: set to the inline end, in tabular figures. */
  readonly end?: boolean;
  /** Leaves on a narrow screen, its words moving onto the first cell's sub-line. */
  readonly wide?: boolean;
}

export interface Row {
  readonly key: string;
  readonly cells: readonly ReactNode[];
  /** What the first cell adds on a narrow screen: the `wide` columns' words. */
  readonly narrow?: ReactNode;
  /** Which cell carries the sub-line: the first by default. */
  readonly narrowAt?: number;
  /** A row that grew out of the one above it, indented. */
  readonly branch?: boolean;
  readonly id?: string;
  readonly lang?: string;
  /** The named group the row belongs to: consecutive rows of one group share a tbody headed by its name. */
  readonly group?: string;
}

/** Consecutive rows of one group, in order; rows with no group form unnamed runs. */
function groupsOf(rows: readonly Row[]): { name?: string; rows: Row[] }[] {
  const groups: { name?: string; rows: Row[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.name === row.group) last.rows.push(row);
    else groups.push({ ...(row.group ? { name: row.group } : {}), rows: [row] });
  }
  return groups.length ? groups : [{ rows: [] }];
}

export function RuledTable({
  caption,
  columns,
  rows,
  lang,
  foot,
}: {
  /** The table's name: the section's title, for assistive technology. */
  caption: string;
  columns: readonly Column[];
  rows: readonly Row[];
  lang: 'en' | undefined;
  /** A closing row, such as an album's total, spanning the table. */
  foot?: { readonly label: string; readonly value: ReactNode };
}) {
  const cls = (column: Column, extra = '') =>
    [column.end ? 'ss-end' : '', column.wide ? 'ss-wide' : '', extra].filter(Boolean).join(' ') ||
    undefined;
  return (
    <table className="ss-table">
      <caption>
        <Hidden>{caption}</Hidden>
      </caption>
      <colgroup>
        {columns.map((column, index) => (
          <col key={index} className={`ss-c${column.span}${column.wide ? ' ss-wide' : ''}`} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((column, index) => (
            <th key={index} scope="col" className={cls(column)} data-type-role="label">
              <Words lang={lang}>{column.label}</Words>
            </th>
          ))}
        </tr>
      </thead>
      {groupsOf(rows).map(({ name, rows: grouped }, groupIndex) => (
        <tbody key={groupIndex}>
          {name ? (
            <tr className="ss-group-row">
              <th scope="rowgroup" colSpan={columns.length} data-type-role="title">
                {name}
              </th>
            </tr>
          ) : null}
          {grouped.map((row) => (
            <tr
              key={row.key}
              id={row.id}
              lang={row.lang}
              className={row.branch ? 'ss-branch' : undefined}
            >
              {row.cells.map((cell, index) => {
                const column = columns[index]!;
                return (
                  <td key={index} className={cls(column)} data-type-role="body-compact">
                    {cell}
                    {index === (row.narrowAt ?? 0) && row.narrow ? (
                      <div className="ss-narrow">{row.narrow}</div>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      ))}
      {foot ? (
        <tfoot>
          <tr>
            <th scope="row" colSpan={columns.length - 1} data-type-role="label">
              <Words lang={lang}>{foot.label}</Words>
            </th>
            <td className="ss-end ss-num" data-type-role="body-compact">
              {foot.value}
            </td>
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}
