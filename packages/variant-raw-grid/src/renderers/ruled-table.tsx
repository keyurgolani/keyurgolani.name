import type { ReactNode } from 'react';
import { Words } from '../parts';

// The ruled table: episodes, roles, study, talks. One cell of the band,
// holding a real <table> with its caption, so dated lists read as rows and
// columns to assistive technology (C6). A column no row fills is left out,
// so no table carries an empty column. On a phone each row is a block, its
// cells stacked, the head row hidden, and the first cell, the date or the
// number, leading the row on its own line.

export interface Column<T> {
  readonly key: string;
  /** The column's head, the composition's word. */
  readonly head: string;
  /** Headed for assistive technology alone, as a link column is. */
  readonly hiddenHead?: boolean;
  /** The class of its cells: the data voice for dates and numbers. */
  readonly className?: string;
  readonly cell: (row: T) => ReactNode;
}

const empty = (node: ReactNode) =>
  node === null || node === undefined || node === false || node === '';

export function RuledTable<T>({
  rows,
  columns,
  caption,
  rowId,
  rowLang,
  uiLang,
  variant,
}: {
  rows: readonly T[];
  columns: readonly Column<T>[];
  caption: string;
  rowId: (row: T) => string | undefined;
  rowLang?: (row: T) => string | undefined;
  uiLang: 'en' | undefined;
  variant: string;
}) {
  const cells = rows.map((row) => columns.map((column) => column.cell(row)));
  const kept = columns
    .map((column, index) => ({ column, index }))
    .filter(({ index }) => cells.some((row) => !empty(row[index])));
  return (
    <div className="rg-cell rg-tablecell">
      <table className={`rg-table rg-table--${variant}`}>
        <caption className="rg-hidden">{caption}</caption>
        <thead>
          <tr>
            {kept.map(({ column }) => (
              <th key={column.key} scope="col">
                {column.hiddenHead ? (
                  <span className="rg-hidden">
                    <Words lang={uiLang}>{column.head}</Words>
                  </span>
                ) : (
                  <Words lang={uiLang}>{column.head}</Words>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} id={rowId(row)} lang={rowLang?.(row)}>
              {kept.map(({ column, index }) => (
                <td key={column.key} className={column.className}>
                  {cells[r]![index]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
