import type { PlaneModel } from './model';

// A board drawn as an isometric plane: its ground, and on it a block for
// each tile, raised a little more the more of the grid it covers, in the
// tile's tone. The Contents tile draws one for each board of the page, and
// each board's label draws its own, so the drawing of the page and the page
// come from the same layout. Decoration: hidden from assistive technology,
// with no word in it, and every color a role the stylesheet sets by class.

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;

/** The plane's ground, in drawing units: its width along the columns and its depth along the rows. */
const WIDTH = 112;
const DEPTH = 64;
/** The ground's lip. */
const LIP = 2.5;
/** The gap between blocks. */
const INSET = 1.1;

type Point = readonly [number, number];

const points = (list: readonly Point[]) =>
  list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

/** The drawing's size, in its own units. */
export const PLANE_VIEW = {
  width: Math.round((WIDTH + DEPTH) * COS30 + 8),
  height: Math.round((WIDTH + DEPTH) * SIN30 + 20),
};

export function Plane({
  model,
  raised = false,
  className,
}: {
  readonly model: PlaneModel;
  /** The current board's: its blocks stand taller. */
  readonly raised?: boolean;
  readonly className?: string;
}) {
  const ox = DEPTH * COS30 + 4;
  const oy = 14;
  /** A point on the ground at (x, y), raised z. */
  const at = (x: number, y: number, z: number): Point => [
    ox + (x - y) * COS30,
    oy + (x + y) * SIN30 - z,
  ];
  const cell = { x: WIDTH / model.columns, y: DEPTH / model.rows };
  const blocks = model.blocks
    .map((block) => {
      const x0 = block.c0 * cell.x + INSET;
      const x1 = (block.c1 + 1) * cell.x - INSET;
      const y0 = block.r0 * cell.y + INSET;
      const y1 = (block.r1 + 1) * cell.y - INSET;
      const area = (block.c1 - block.c0 + 1) * (block.r1 - block.r0 + 1);
      const share = Math.min(area / (model.columns * model.rows), 0.5);
      const height = (raised ? 4 : 2.5) + share * (raised ? 18 : 10);
      return { ...block, x0, x1, y0, y1, height };
    })
    // Back to front, so a nearer block draws over a farther one.
    .sort((a, b) => a.x1 + a.y1 - (b.x1 + b.y1));
  return (
    <svg
      className={className}
      viewBox={`0 0 ${PLANE_VIEW.width} ${PLANE_VIEW.height}`}
      aria-hidden="true"
      focusable="false"
      data-raised={raised ? '' : undefined}
    >
      <polygon
        className="sb-plane__side"
        points={points([
          at(WIDTH, 0, 0),
          at(WIDTH, DEPTH, 0),
          at(WIDTH, DEPTH, -LIP),
          at(WIDTH, 0, -LIP),
        ])}
      />
      <polygon
        className="sb-plane__front"
        points={points([
          at(0, DEPTH, 0),
          at(WIDTH, DEPTH, 0),
          at(WIDTH, DEPTH, -LIP),
          at(0, DEPTH, -LIP),
        ])}
      />
      <polygon
        className="sb-plane__ground"
        points={points([at(0, 0, 0), at(WIDTH, 0, 0), at(WIDTH, DEPTH, 0), at(0, DEPTH, 0)])}
      />
      {blocks.map((block, index) => (
        <g key={index} className="sb-plane__block" data-tone={block.tone}>
          <polygon
            className="sb-plane__front"
            points={points([
              at(block.x0, block.y1, 0),
              at(block.x1, block.y1, 0),
              at(block.x1, block.y1, block.height),
              at(block.x0, block.y1, block.height),
            ])}
          />
          <polygon
            className="sb-plane__side"
            points={points([
              at(block.x1, block.y0, 0),
              at(block.x1, block.y1, 0),
              at(block.x1, block.y1, block.height),
              at(block.x1, block.y0, block.height),
            ])}
          />
          <polygon
            className="sb-plane__top"
            points={points([
              at(block.x0, block.y0, block.height),
              at(block.x1, block.y0, block.height),
              at(block.x1, block.y1, block.height),
              at(block.x0, block.y1, block.height),
            ])}
          />
        </g>
      ))}
    </svg>
  );
}
