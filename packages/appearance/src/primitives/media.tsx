import type { ReactNode } from 'react';
import type { Status } from '../slots';

// Media and DataDisplay (#19, Slice 3, item 2): static primitives that
// render the same on the server, in a client component, and in a plate.

/** One rendition of an image: #10's media model lists them by width. */
export interface MediaRendition {
  readonly src: string;
  /** Its intrinsic width in pixels, for srcset. */
  readonly width: number;
}

export interface MediaProps {
  /**
   * What the image shows, required: a short description, or '' when it's
   * decoration that adds nothing the text doesn't say.
   */
  readonly alt: string;
  /** The image. Without one, a placeholder stands in, named by alt. */
  readonly src?: string;
  /** #10's renditions, for srcset. */
  readonly renditions?: readonly MediaRendition[];
  /** How wide it renders, for the browser to pick a rendition. */
  readonly sizes?: string;
  /** Its intrinsic size, so the page doesn't shift as it loads. */
  readonly width?: number;
  readonly height?: number;
  readonly caption?: ReactNode;
  /** Load it at once: for an image above the fold. Else it loads lazily. */
  readonly eager?: boolean;
  readonly id?: string;
  /** A hook for the variant's layout, such as its aspect ratio. Never for state or appearance. */
  readonly className?: string;
}

export function Media({
  alt,
  src,
  renditions,
  sizes,
  width,
  height,
  caption,
  eager = false,
  id,
  className,
}: MediaProps) {
  if (typeof alt !== 'string') {
    throw new TypeError(
      'Media needs alt text: say what the image shows, or pass alt="" for decoration.',
    );
  }
  const srcSet = renditions?.length
    ? renditions.map((rendition) => `${rendition.src} ${rendition.width}w`).join(', ')
    : undefined;
  return (
    <figure id={id} className={className} data-ui-slot="media">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- no image optimizer; #10 supplies renditions.
        <img
          data-ui-slot="media.image"
          src={src}
          srcSet={srcSet}
          sizes={srcSet ? sizes : undefined}
          alt={alt}
          width={width}
          height={height}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
        />
      ) : (
        <div
          data-ui-slot="media.placeholder"
          role={alt ? 'img' : undefined}
          aria-label={alt || undefined}
          aria-hidden={alt ? undefined : true}
        />
      )}
      {caption ? <figcaption data-ui-slot="media.caption">{caption}</figcaption> : null}
    </figure>
  );
}

export interface DataColumn {
  readonly key: string;
  readonly label: ReactNode;
  /** Numbers, which align and set in the numeric role. */
  readonly numeric?: boolean;
  /** How the rows are sorted by it, if they are. */
  readonly sort?: 'ascending' | 'descending';
}

export interface DataRow {
  readonly key: string;
  /** Each column's cell, by the column's key. The first column heads its row. */
  readonly cells: Readonly<Record<string, ReactNode>>;
  /** The row's status, in words in one of its cells, never color alone. */
  readonly status?: Status;
}

/** A numeric column drawn as bars too: the categorical colors in row order, or the sequential ramp by value. */
export interface DataBars {
  readonly column: string;
  readonly max: number;
  readonly encoding: 'categorical' | 'sequential';
  /** Each row's value, by row key, which the bar's length shows. */
  readonly values: Readonly<Record<string, number>>;
}

export interface DataDisplayProps {
  readonly caption: ReactNode;
  readonly columns: readonly DataColumn[];
  readonly rows: readonly DataRow[];
  readonly bars?: DataBars;
  readonly id?: string;
  readonly className?: string;
}

const SEQUENCE = ['start', 'middle', 'end'] as const;

/**
 * The bar's length, as data-value holds it, and its series: one of six
 * categorical colors by row, or the sequential ramp's third its value falls in.
 */
function bar(bars: DataBars, row: DataRow, index: number) {
  const value = bars.values[row.key] ?? 0;
  const fraction = bars.max > 0 ? Math.min(Math.max(value / bars.max, 0), 1) : 0;
  const series =
    bars.encoding === 'categorical'
      ? String((index % 6) + 1)
      : SEQUENCE[Math.min(Math.floor(fraction * 3), 2)]!;
  return { value: `${Math.round(fraction * 1000) / 10}%`, series };
}

export function DataDisplay({ caption, columns, rows, bars, id, className }: DataDisplayProps) {
  const [head, ...rest] = columns;
  if (!head) throw new TypeError('A data display has at least one column.');
  return (
    <figure id={id} className={className} data-ui-slot="data-display">
      <figcaption data-ui-slot="data-display.caption">{caption}</figcaption>
      <table data-ui-slot="data-display.table">
        <thead>
          <tr data-ui-slot="data-display.row">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                data-ui-slot="data-display.header"
                data-state={column.numeric ? 'numeric' : undefined}
                aria-sort={column.sort}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.key} data-ui-slot="data-display.row" data-status={row.status}>
              <th scope="row" data-ui-slot="data-display.cell">
                {row.cells[head.key]}
              </th>
              {rest.map((column) => {
                const drawn = bars?.column === column.key ? bar(bars, row, index) : null;
                return (
                  <td
                    key={column.key}
                    data-ui-slot="data-display.cell"
                    data-state={column.numeric ? 'numeric' : undefined}
                  >
                    {row.cells[column.key]}
                    {drawn ? (
                      <span
                        data-ui-slot="data-display.bar"
                        data-value={drawn.value}
                        data-series={drawn.series}
                        aria-hidden="true"
                      />
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
