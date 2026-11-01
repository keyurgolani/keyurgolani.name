import type { ReactNode } from 'react';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { Words } from '../parts';

// The record's catalogue checklist and Practice's labels (redesign, stream
// C, C1). Experience, education, publications, talks, awards, and the rest
// of the record hang as a catalogue checklist in a vitrine: a mat of the
// canvas, lit along its top edge, standing on the room's wall, its rows the
// catalogue raisonné's list mode, number, title, where, and when, with no
// rule between them, which is Editorial's ruled table. Practice's lists are
// labels on its shelf: a title over its quiet lines.

export function CheckLabel({
  title,
  lines,
  id,
  lang,
  type,
}: {
  title: ReactNode;
  /** The label's other lines, in order; empty ones are left out. */
  lines: readonly ReactNode[];
  id?: string;
  lang?: string;
  /** What kind of entry it is, for a stylesheet or a test. */
  type?: string;
}) {
  const shown = lines.filter(
    (line) => line !== null && line !== undefined && line !== false && line !== '',
  );
  return (
    <li id={id} className="oa-check" lang={lang} data-entry-type={type}>
      <span className="oa-check__title">{title}</span>
      {shown.map((line, index) => (
        <div key={index} className="oa-check__line">
          {line}
        </div>
      ))}
    </li>
  );
}

/** Labels on a shelf, one under another. */
export function CheckLabels({ children }: { children: ReactNode }) {
  return (
    <ul className="oa-checks" role="list">
      {children}
    </ul>
  );
}

/** One row of the checklist: what it is, with the lines under it, where, and when. */
export interface ChecklistRow {
  readonly key: string;
  readonly id?: string;
  readonly lang?: string;
  readonly type?: string;
  readonly title: ReactNode;
  /** Quiet lines under the title: what it was, what it adds. */
  readonly more?: readonly ReactNode[];
  readonly where?: ReactNode;
  readonly when?: ReactNode;
}

/** The checklist in its vitrine: a table, its number, title, where, and when, on a mat of the canvas. */
export function Vitrine({
  input,
  title,
  where,
  when,
  rows,
}: {
  input: VariantRenderInput;
  /** The column heads, in the catalogue's words for what the rows are. */
  title: string;
  where: string;
  when: string;
  rows: readonly ChecklistRow[];
}) {
  const shown = (more: readonly ReactNode[] | undefined) =>
    (more ?? []).filter(
      (line) => line !== null && line !== undefined && line !== false && line !== '',
    );
  // A column no row fills isn't drawn (N2).
  const filled = (cell: ReactNode) =>
    cell !== null && cell !== undefined && cell !== false && cell !== '';
  const withWhere = rows.some((row) => filled(row.where));
  const withWhen = rows.some((row) => filled(row.when));
  return (
    <div className="oa-vitrine-mat">
      <table className="oa-checktable">
        <thead>
          <tr>
            <th scope="col" className="oa-checktable__no">
              <Words input={input}>No.</Words>
            </th>
            <th scope="col">
              <Words input={input}>{title}</Words>
            </th>
            {withWhere ? (
              <th scope="col">
                <Words input={input}>{where}</Words>
              </th>
            ) : null}
            {withWhen ? (
              <th scope="col" className="oa-checktable__when">
                <Words input={input}>{when}</Words>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.key} id={row.id} lang={row.lang} data-entry-type={row.type}>
              <td className="oa-checktable__no">{index + 1}</td>
              <th scope="row">
                <span className="oa-checktable__title">{row.title}</span>
                {shown(row.more).map((line, lineIndex) => (
                  <div key={lineIndex} className="oa-checktable__more">
                    {line}
                  </div>
                ))}
              </th>
              {withWhere ? <td>{row.where}</td> : null}
              {withWhen ? <td className="oa-checktable__when">{row.when}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
