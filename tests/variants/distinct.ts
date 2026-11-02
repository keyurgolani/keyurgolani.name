// The distinct guards' arithmetic (Design gate rule 5, stream C): what
// distinct.spec.ts measures, as pure functions a unit test runs without a
// browser. Three guards say the first-party compositions really differ, with
// the appearance tuple held constant, so only the composition varies:
//
// - Structure (design). A composition's boundary, as snapshotBoundary()
//   reads it, becomes a tree of tokens, each element's tag and its explicit
//   or landmark-implied role. A generic div or span with no role is
//   transparent: it drops, and its children lift to its parent. Text and
//   every other attribute drop, a run of more than 3 identical siblings
//   collapses to 3, and an svg or a canvas keeps its token but not its
//   contents. Every element's path from the boundary gives one shingle, its
//   last 3 tokens, and the landmark skeleton gives more, weighted 4 times.
//   Two compositions' similarity is the weighted Jaccard index of their
//   shingles: 0 shares nothing, 1 is the same structure.
// - Layout boxes (design). The top-level blocks across the first two
//   viewports, less the main landmark that wraps them (BOX_LEFT_OUT),
//   normalized by the viewport, matched greedily by IoU. Two
//   compositions' similarity is the matched IoU weighted by the boxes' area:
//   0 shares no block's place, 1 is the same blocks in the same places.
// - Pixels (clones). The first viewport's screenshot becomes luminance, then
//   a Sobel edge map, then a coarse grid of mean edge strength (96x60 on
//   desktop, 40x86 on mobile). Two compositions' distance is 1 - SSIM over
//   their grids: 0 is the same page, 1 unrelated. It moves with any shift of
//   the layout, so it only tells a clone from everything else.
//
// judge() applies the thresholds distinct.json holds, per viewport: the
// clone guard to every pair, and the design guards with each composition's
// quality unit saying whether it's still pending its redesign (`distinct:
// 'pending'`). calibrate() sets a design guard's threshold from its
// controls, and noiseFloor() the clone guard's. sharedMarkupFindings() is
// the rendered side of stream E's audit.shared-markup rule, off until E's
// PR 3 pins land.

import type { ParityNode } from '../../packages/variant-contract/src/node/parity';
import { decodePng, type Image } from '../quality/lib/pixels';

// ---------------------------------------------------------------------------
// Structure

/**
 * The role each landmark-like element implies, which its token carries.
 * Four of them hold only where HTML-AAM says so (impliedRole): a header is
 * banner and a footer contentinfo only outside sectioning content, a
 * section is region only with an accessible name, and an aside inside
 * sectioning content is complementary only with one. Anywhere else they're
 * generic, so they're as transparent as a bare div.
 */
export const IMPLIED_ROLES: Readonly<Record<string, string>> = {
  header: 'banner',
  nav: 'navigation',
  main: 'main',
  footer: 'contentinfo',
  aside: 'complementary',
  section: 'region',
  article: 'article',
  figure: 'figure',
  ul: 'list',
  ol: 'list',
  dl: 'list',
  table: 'table',
  form: 'form',
  dialog: 'dialog',
};

/** The elements that scope a header, a footer, or an aside: sectioning content, and main. */
export const SECTIONING = new Set(['article', 'aside', 'main', 'nav', 'section']);

/**
 * The boundary as the structure guard reads it: snapshotBoundary()'s nodes,
 * each also saying whether it has an accessible name (aria-label,
 * aria-labelledby, or title), as a boolean, never the name's text.
 */
export interface StructureNode {
  readonly tag: string;
  readonly role?: string;
  readonly named?: boolean;
  readonly children: readonly (StructureNode | string)[];
}

/** Generic containers: with no role, they drop and their children lift. */
const TRANSPARENT = new Set(['div', 'span']);
/** Roles that leave a generic container generic. */
const GENERIC_ROLES = new Set(['generic', 'none', 'presentation']);
/** Elements whose contents aren't markup structure: their token stays, their children go. */
const OPAQUE = new Set(['svg', 'canvas']);
/** The roles the landmark skeleton follows. */
const SKELETON_ROLES = new Set([
  'banner',
  'navigation',
  'main',
  'contentinfo',
  'complementary',
  'region',
  'article',
  'form',
  'search',
  'dialog',
]);
/** How deep the skeleton goes: the boundary's landmarks, and the landmarks directly in them. */
const SKELETON_DEPTH = 2;

/** The longest run of identical siblings a shape keeps. */
export const SIBLING_RUN = 3;
/** How many tokens a path shingle keeps: its last 3. */
export const SHINGLE_LENGTH = 3;
/** The weight of each landmark skeleton shingle, against 1 for a path shingle. */
export const SKELETON_WEIGHT = 4;

/** An element as the structure guard sees it: its token, and its children's. */
export interface Shape {
  readonly token: string;
  readonly role?: string;
  readonly children: readonly Shape[];
}

/**
 * The role `node` implies, as HTML-AAM maps it, with `scoped` saying it's
 * inside sectioning content: a role, undefined for an element that implies
 * none but stays, or null for one that's generic there.
 */
export function impliedRole(
  node: Pick<StructureNode, 'tag' | 'named'>,
  scoped: boolean,
): string | undefined | null {
  if (TRANSPARENT.has(node.tag)) return null;
  switch (node.tag) {
    case 'header':
    case 'footer':
      return scoped ? null : IMPLIED_ROLES[node.tag];
    case 'section':
      return node.named ? IMPLIED_ROLES.section : null;
    case 'aside':
      return scoped && !node.named ? null : IMPLIED_ROLES.aside;
    default:
      return IMPLIED_ROLES[node.tag];
  }
}

/**
 * An element's token, or null for a generic one, which is transparent. An
 * explicit role always wins; without one, the role it implies where it is
 * (impliedRole). `scoped` says it's inside sectioning content.
 */
export function tokenOf(
  node: Pick<StructureNode, 'tag' | 'role' | 'named'>,
  scoped = false,
): { token: string; role?: string } | null {
  const explicit = node.role?.trim().split(/\s+/)[0]?.toLowerCase();
  if (explicit && !GENERIC_ROLES.has(explicit)) {
    return { token: `${node.tag}[${explicit}]`, role: explicit };
  }
  // An explicit generic role (generic, none, presentation) makes any element generic.
  const implied = explicit ? null : impliedRole(node, scoped);
  if (implied === null) return null;
  return implied === undefined
    ? { token: node.tag }
    : { token: `${node.tag}[${implied}]`, role: implied };
}

const keys = new WeakMap<Shape, string>();
/** A shape's whole subtree as one string, so identical siblings compare equal. */
function shapeKey(shape: Shape): string {
  let key = keys.get(shape);
  if (key === undefined) {
    key = `${shape.token}(${shape.children.map(shapeKey).join(',')})`;
    keys.set(shape, key);
  }
  return key;
}

/** `shapes` with every run of more than SIBLING_RUN identical siblings cut to SIBLING_RUN. */
export function collapseRuns(shapes: readonly Shape[]): Shape[] {
  const kept: Shape[] = [];
  let run = 0;
  let previous: string | undefined;
  for (const shape of shapes) {
    const key = shapeKey(shape);
    run = key === previous ? run + 1 : 1;
    previous = key;
    if (run <= SIBLING_RUN) kept.push(shape);
  }
  return kept;
}

/** `node`'s element children, transparent ones replaced by theirs, before any collapse. */
function lifted(node: StructureNode, scoped: boolean): Shape[] {
  if (OPAQUE.has(node.tag)) return [];
  const inside = scoped || SECTIONING.has(node.tag);
  return node.children.flatMap((child) =>
    typeof child === 'string' ? [] : shapesOf(child, inside),
  );
}

/** `node` as shapes: one, or its lifted children when it's generic. */
function shapesOf(node: StructureNode, scoped: boolean): Shape[] {
  const children = lifted(node, scoped);
  const token = tokenOf(node, scoped);
  if (token === null) return children;
  return [{ ...token, children: collapseRuns(children) }];
}

/** The boundary's top-level shapes: the boundary element itself, normalized, and lifted if it's generic. */
export function boundaryShapes(boundary: StructureNode): Shape[] {
  return collapseRuns(shapesOf(boundary, false));
}

/**
 * `boundary` with each element's `named` from `named`, in the pre-order
 * namedElements() walks: the same elements snapshotBoundary() keeps, in the
 * same order. Throws when the counts differ, so a walk out of step can't
 * pass unseen.
 */
export function withNames(boundary: ParityNode, named: readonly boolean[]): StructureNode {
  let index = 0;
  const walk = (node: ParityNode): StructureNode => {
    const own = named[index++];
    if (own === undefined) throw new Error('Fewer names than elements in the boundary');
    return {
      tag: node.tag,
      ...(node.role === undefined ? {} : { role: node.role }),
      named: own,
      children: node.children.map((child) => (typeof child === 'string' ? child : walk(child))),
    };
  };
  const out = walk(boundary);
  if (index !== named.length)
    throw new Error(`${named.length} names for ${index} elements in the boundary`);
  return out;
}

/**
 * Whether each element of the first `[data-variant]` boundary under `root`
 * has an accessible name, as a boolean, in pre-order, over exactly the
 * elements snapshotBoundary() keeps: it skips scripts, styles, templates,
 * and noscript, the boundary's skip link, and a visitor-control slot's
 * contents. It runs in a page, reading nothing from outside its own body.
 */
export function namedElements(root: ParentNode = document): boolean[] {
  const boundary = root.querySelector('[data-variant]');
  if (!boundary) return [];
  const skipped = new Set(['script', 'style', 'template', 'noscript']);
  const has = (element: Element, name: string) => (element.getAttribute(name) ?? '').trim() !== '';
  const out: boolean[] = [];
  const read = (element: Element) => {
    out.push(
      has(element, 'aria-label') || has(element, 'aria-labelledby') || has(element, 'title'),
    );
    if (element.hasAttribute('data-visitor-control-slot')) return;
    for (const child of Array.from(element.children)) {
      const tag = child.tagName.toLowerCase();
      if (skipped.has(tag)) continue;
      if (element === boundary && child.getAttribute('data-ui-slot') === 'skip-link') continue;
      read(child);
    }
  };
  read(boundary);
  return out;
}

/** A weighted multiset of shingles. */
export type Shingles = ReadonlyMap<string, number>;

function add(into: Map<string, number>, key: string, weight: number): void {
  into.set(key, (into.get(key) ?? 0) + weight);
}

/** The landmark skeleton: each landmark in document order, by its landmark depth, down to SKELETON_DEPTH. */
export function skeleton(shapes: readonly Shape[]): string[] {
  const order: string[] = [];
  const walk = (list: readonly Shape[], depth: number) => {
    for (const shape of list) {
      const landmark = shape.role !== undefined && SKELETON_ROLES.has(shape.role);
      if (landmark) order.push(`${depth}:${shape.token}`);
      const next = landmark ? depth + 1 : depth;
      if (next < SKELETON_DEPTH) walk(shape.children, next);
    }
  };
  walk(shapes, 0);
  return order;
}

/**
 * A boundary's structural signature: a shingle for each element, its path's
 * last SHINGLE_LENGTH tokens, weight 1, and one for each consecutive pair in
 * the landmark skeleton, from its start to its end, weight SKELETON_WEIGHT.
 */
export function signature(boundary: StructureNode): Shingles {
  const shapes = boundaryShapes(boundary);
  const shingles = new Map<string, number>();
  const walk = (list: readonly Shape[], path: readonly string[]) => {
    for (const shape of list) {
      const here = [...path, shape.token];
      add(shingles, here.slice(-SHINGLE_LENGTH).join('>'), 1);
      walk(shape.children, here);
    }
  };
  walk(shapes, []);
  const order = ['^', ...skeleton(shapes), '$'];
  for (let index = 1; index < order.length; index++) {
    add(shingles, `skeleton ${order[index - 1]} ${order[index]}`, SKELETON_WEIGHT);
  }
  return shingles;
}

/** Σ min / Σ max over every shingle in either: 0 shares nothing, 1 the same multiset. Two empty ones are the same. */
export function weightedJaccard(a: Shingles, b: Shingles): number {
  let min = 0;
  let max = 0;
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(key) ?? 0;
    const y = b.get(key) ?? 0;
    min += Math.min(x, y);
    max += Math.max(x, y);
  }
  return max === 0 ? 1 : min / max;
}

/** The `limit` shingles `a` and `b` share with the most weight, for a failure to show what to change. */
export function sharedShingles(
  a: Shingles,
  b: Shingles,
  limit = 10,
): { shingle: string; weight: number }[] {
  return [...a.keys()]
    .filter((key) => b.has(key))
    .map((key) => ({ shingle: key, weight: Math.min(a.get(key)!, b.get(key)!) }))
    .sort((x, y) => y.weight - x.weight || (x.shingle < y.shingle ? -1 : 1))
    .slice(0, limit);
}

/** `boundary` with its children wrapped in `depth` extra divs: the transparency control. */
export function wrapInDivs(boundary: StructureNode, depth = 3): StructureNode {
  let children: StructureNode['children'] = boundary.children;
  for (let level = 0; level < depth; level++) children = [{ tag: 'div', children }];
  return { ...boundary, children };
}

// ---------------------------------------------------------------------------
// Pixels

/** A grid of values, row by row. */
export interface Grid {
  readonly width: number;
  readonly height: number;
  readonly data: Float64Array;
}

/** The edge grid's size at each viewport: about 15 px cells on desktop and 10 px on mobile. */
export const GRID_SIZES = {
  desktop: { cols: 96, rows: 60 },
  mobile: { cols: 40, rows: 86 },
} as const;

/** Each pixel's luma, Rec. 709 on the encoded values, from 0 to 1. */
export function luminanceGrid(image: Image): Grid {
  const data = new Float64Array(image.width * image.height);
  for (let i = 0; i < data.length; i++) {
    data[i] =
      (0.2126 * image.data[i * 4]! +
        0.7152 * image.data[i * 4 + 1]! +
        0.0722 * image.data[i * 4 + 2]!) /
      255;
  }
  return { width: image.width, height: image.height, data };
}

/** The Sobel gradient's magnitude at each pixel, edges clamped to the nearest pixel. */
export function sobel(grid: Grid): Grid {
  const { width, height, data } = grid;
  const at = (x: number, y: number) =>
    data[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))]!;
  const out = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx =
        at(x + 1, y - 1) +
        2 * at(x + 1, y) +
        at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const gy =
        at(x - 1, y + 1) +
        2 * at(x, y + 1) +
        at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      out[y * width + x] = Math.hypot(gx, gy);
    }
  }
  return { width, height, data: out };
}

/** `grid` averaged down to `cols` by `rows` cells, each the mean of the pixels it covers. */
export function downscale(grid: Grid, cols: number, rows: number): Grid {
  const out = new Float64Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    const y0 = Math.floor((row * grid.height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * grid.height) / rows));
    for (let col = 0; col < cols; col++) {
      const x0 = Math.floor((col * grid.width) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((col + 1) * grid.width) / cols));
      let sum = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) sum += grid.data[y * grid.width + x]!;
      }
      out[row * cols + col] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return { width: cols, height: rows, data: out };
}

/**
 * `grid` scaled so its 99th percentile is 1, and clamped there, so a scheme
 * with softer contrast draws the same edges as a sharper one. An empty grid
 * stays 0.
 */
export function normalizeGrid(grid: Grid): Grid {
  const sorted = [...grid.data].sort((a, b) => a - b);
  const top = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ?? 0;
  const data = top > 0 ? grid.data.map((value) => Math.min(1, value / top)) : grid.data.slice();
  return { width: grid.width, height: grid.height, data };
}

/** A PNG screenshot's edge grid, `cols` by `rows`, normalized. */
export function edgeGrid(png: Uint8Array, cols: number, rows: number): Grid {
  return normalizeGrid(downscale(sobel(luminanceGrid(decodePng(png))), cols, rows));
}

/** The SSIM window, in grid cells. */
export const SSIM_WINDOW = 7;
const C1 = 0.01 ** 2;
const C2 = 0.03 ** 2;

/**
 * SSIM at each window position over two grids of the same size, values from
 * 0 to 1, as a grid one window narrower each way: the agreement heatmap.
 */
export function ssimMap(a: Grid, b: Grid, window = SSIM_WINDOW): Grid {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `SSIM needs grids of one size: ${a.width}x${a.height} and ${b.width}x${b.height}`,
    );
  }
  const size = Math.min(window, a.width, a.height);
  const width = a.width - size + 1;
  const height = a.height - size + 1;
  const out = new Float64Array(width * height);
  const n = size * size;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sa = 0;
      let sb = 0;
      for (let dy = 0; dy < size; dy++) {
        for (let dx = 0; dx < size; dx++) {
          sa += a.data[(y + dy) * a.width + x + dx]!;
          sb += b.data[(y + dy) * b.width + x + dx]!;
        }
      }
      const ma = sa / n;
      const mb = sb / n;
      let va = 0;
      let vb = 0;
      let cov = 0;
      for (let dy = 0; dy < size; dy++) {
        for (let dx = 0; dx < size; dx++) {
          const da = a.data[(y + dy) * a.width + x + dx]! - ma;
          const db = b.data[(y + dy) * b.width + x + dx]! - mb;
          va += da * da;
          vb += db * db;
          cov += da * db;
        }
      }
      va /= n - 1;
      vb /= n - 1;
      cov /= n - 1;
      out[y * width + x] =
        ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
    }
  }
  return { width, height, data: out };
}

/** Mean SSIM over two grids. */
export function ssim(a: Grid, b: Grid, window = SSIM_WINDOW): number {
  const map = ssimMap(a, b, window);
  let sum = 0;
  for (const value of map.data) sum += value;
  return sum / map.data.length;
}

/** The pixel guard's distance, 1 - SSIM, clamped to 0 to 1. */
export function pixelDistance(a: Grid, b: Grid): number {
  return Math.min(1, Math.max(0, 1 - ssim(a, b)));
}

// ---------------------------------------------------------------------------
// Layout boxes

/**
 * The blocks the layout-box guard leaves out: the main landmark, by tag or
 * by role. It wraps the blocks rather than being one. On every composition
 * it's full width and runs past both viewports, so any two pages' mains
 * overlap at an IoU near 1, and as the largest box it carried 0.4 to 0.5 of
 * every pair's score whatever the pages drew. The structure guard still
 * counts it in the landmark skeleton.
 */
export const BOX_LEFT_OUT = 'main, [role="main"]';

/**
 * The elements the layout-box guard reads: the top-level blocks a visitor
 * sees, landmarks, sections, articles, figures, media, the h1 and h2
 * headings, and navigation, by tag or by explicit role, less BOX_LEFT_OUT.
 */
export const BOX_SELECTOR = `:is(${[
  'header',
  'nav',
  'footer',
  'aside',
  'section',
  'article',
  'figure',
  'img',
  'picture',
  'video',
  'canvas',
  'svg',
  'h1',
  'h2',
  '[role="banner"]',
  '[role="navigation"]',
  '[role="contentinfo"]',
  '[role="complementary"]',
  '[role="region"]',
].join(', ')}):not(${BOX_LEFT_OUT})`;

/** How many viewports down the guard reads: the first two. */
export const BOX_VIEWPORTS = 2;

/**
 * One block's box, normalized: x and width by the viewport's width, y and
 * height by its height, clipped to the window's width and the first
 * BOX_VIEWPORTS viewports, so y runs from 0 to BOX_VIEWPORTS.
 */
export interface Box {
  /** Its tag, for a failure to show; the matching ignores it. */
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const area = (box: Box) => box.width * box.height;

/** The intersection over union of two boxes, 0 apart to 1 the same. */
export function iou(a: Box, b: Box): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  const inter = width > 0 && height > 0 ? width * height : 0;
  const union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Greedy matching: every pair of boxes with any overlap, by IoU, highest
 * first, each box matched at most once. Greedy rather than Hungarian, since
 * a page has tens of blocks and the best overlap is nearly always the right
 * partner; ties break by document order.
 */
export function matchBoxes(
  a: readonly Box[],
  b: readonly Box[],
): { a: number; b: number; iou: number }[] {
  const candidates: { a: number; b: number; iou: number }[] = [];
  a.forEach((left, i) =>
    b.forEach((right, j) => {
      const overlap = iou(left, right);
      if (overlap > 0) candidates.push({ a: i, b: j, iou: overlap });
    }),
  );
  candidates.sort((x, y) => y.iou - x.iou || x.a - y.a || x.b - y.b);
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const matched: { a: number; b: number; iou: number }[] = [];
  for (const candidate of candidates) {
    if (usedA.has(candidate.a) || usedB.has(candidate.b)) continue;
    usedA.add(candidate.a);
    usedB.add(candidate.b);
    matched.push(candidate);
  }
  return matched;
}

/**
 * The layout-box guard's similarity: each matched pair's IoU, weighted by
 * the two boxes' area, over every box's area on both pages. An unmatched
 * box counts at 0. 1 is the same blocks in the same places; two pages with
 * no blocks are the same.
 */
export function boxSimilarity(a: readonly Box[], b: readonly Box[]): number {
  const total =
    a.reduce((sum, box) => sum + area(box), 0) + b.reduce((sum, box) => sum + area(box), 0);
  if (total === 0) return 1;
  const matched = matchBoxes(a, b).reduce(
    (sum, { a: i, b: j, iou: overlap }) => sum + overlap * (area(a[i]!) + area(b[j]!)),
    0,
  );
  return Math.min(1, matched / total);
}

// ---------------------------------------------------------------------------
// Rules

export const VIEWPORT_IDS = ['desktop', 'mobile'] as const;
export type ViewportId = (typeof VIEWPORT_IDS)[number];

type PerViewport = Readonly<Record<ViewportId, number>>;

/**
 * Each guard's threshold at each viewport, as distinct.json holds them. A
 * design guard's is null while its calibration found no gap: it doesn't gate.
 */
export interface Thresholds {
  /** The design guards: the highest structural and box similarity a pair may have. */
  readonly dom: PerViewport | null;
  readonly box: PerViewport | null;
  /** The clone guard: the lowest first-viewport pixel distance a pair may have. */
  readonly px: PerViewport;
}

/** One pair's scores at one viewport. */
export interface PairScore {
  readonly a: string;
  readonly b: string;
  readonly viewport: ViewportId;
  /** Structural similarity, 0 to 1. */
  readonly dom: number;
  /** Layout-box similarity, 0 to 1. */
  readonly box: number;
  /** First-viewport pixel distance, 0 to 1. */
  readonly px: number;
}

/**
 * A recorded box-only acceptance (lead A): one pair, at one viewport, whose
 * layout boxes may reach `box` while its structure and pixels both clear
 * their guards, with the reason and until when. It's the lead's ruling for a
 * pair the boxes alone call alike when the other two guards and the eye
 * don't, never a threshold: a score over `box`, a structure or pixel
 * failure, or a pair that no longer needs it fails the run.
 */
export interface BoxAcceptance {
  readonly a: string;
  readonly b: string;
  readonly viewport: ViewportId;
  /** The highest box similarity accepted for this pair at this viewport. */
  readonly box: number;
  readonly reason: string;
  /** Who ruled it, and when. */
  readonly by: string;
  /** What ends it, such as the guard scoring a fixture with media. */
  readonly until: string;
}

export interface PairOutcome extends PairScore {
  /** Null when the guard doesn't gate. */
  readonly domPass: boolean | null;
  readonly boxPass: boolean | null;
  /** The acceptance that let the boxes pass, when one did. */
  readonly accepted?: BoxAcceptance;
  readonly pxPass: boolean;
  /** The design guards' mode: `report` for two pending compositions, `enforced` otherwise. */
  readonly mode: 'enforced' | 'report';
}

export interface Verdict {
  readonly outcomes: readonly PairOutcome[];
  /** Pairs that fail the clone guard, pending or not. */
  readonly clones: readonly PairOutcome[];
  /** Enforced pairs that fail a design guard. */
  readonly failures: readonly PairOutcome[];
  /** Pending-only pairs that fail a design guard: reported, never failed. */
  readonly reports: readonly PairOutcome[];
  /** Pending compositions that already pass the design guards against every other at every viewport. */
  readonly stale: readonly string[];
  /** Anything else wrong with the inputs, such as a pending id the guard doesn't cover or a missing score. */
  readonly problems: readonly string[];
}

/** Every unordered pair of `ids`, in their order. */
export function pairs<T>(ids: readonly T[]): [T, T][] {
  return ids.flatMap((a, index) => ids.slice(index + 1).map((b): [T, T] => [a, b]));
}

/** Whether an outcome passes the design guards that gate; null when none does. */
export function designPass(outcome: Pick<PairOutcome, 'domPass' | 'boxPass'>): boolean | null {
  const gating = [outcome.domPass, outcome.boxPass].filter((pass) => pass !== null);
  return gating.length === 0 ? null : gating.every(Boolean);
}

/**
 * The guards' verdict over every pair of `ids` at every viewport.
 *
 * - The clone guard gates every pair: distance at least `thresholds.px`.
 *   Pending exempts nothing.
 * - The design guards, structure (at most `thresholds.dom`) and layout
 *   boxes (at most `thresholds.box`), gate a pair with one composition off
 *   pending, and only report a pair of two pending ones. One whose
 *   threshold is null doesn't gate.
 * - A pending composition that already passes the design guards against
 *   every other at every viewport is stale. With no design guard gating,
 *   nothing is.
 * - A recorded box acceptance passes its pair's boxes up to its own `box`,
 *   only while structure and pixels pass. One that matches no pair, or whose
 *   pair passes without it, is a problem, so it's removed once unneeded.
 *
 * The run fails on any clone, failure, stale composition, or problem.
 */
export function judge({
  ids,
  pending,
  scores,
  thresholds,
  accepted = [],
}: {
  readonly ids: readonly string[];
  readonly pending: readonly string[];
  readonly scores: readonly PairScore[];
  readonly thresholds: Thresholds;
  readonly accepted?: readonly BoxAcceptance[];
}): Verdict {
  const problems: string[] = [];
  const used = new Set<BoxAcceptance>();
  for (const id of pending) {
    if (!ids.includes(id))
      problems.push(`${id} is pending, and the guard covers no such composition`);
  }
  const waiting = new Set(pending);
  const outcomes: PairOutcome[] = [];
  for (const viewport of VIEWPORT_IDS) {
    for (const [a, b] of pairs(ids)) {
      const score = scores.find(
        (each) =>
          each.viewport === viewport &&
          ((each.a === a && each.b === b) || (each.a === b && each.b === a)),
      );
      if (!score) {
        problems.push(`no score for ${a} and ${b} at ${viewport}`);
        continue;
      }
      const domPass = thresholds.dom === null ? null : score.dom <= thresholds.dom[viewport];
      const pxPass = score.px >= thresholds.px[viewport];
      let boxPass = thresholds.box === null ? null : score.box <= thresholds.box[viewport];
      const acceptance = accepted.find(
        (each) =>
          each.viewport === viewport &&
          ((each.a === a && each.b === b) || (each.a === b && each.b === a)),
      );
      let applied: BoxAcceptance | undefined;
      if (acceptance) {
        used.add(acceptance);
        if (boxPass !== false) {
          problems.push(
            `the box acceptance for ${a} and ${b} at ${viewport} is no longer needed: remove it from distinct.json`,
          );
        } else if (domPass !== false && pxPass && score.box <= acceptance.box) {
          boxPass = true;
          applied = acceptance;
        }
      }
      outcomes.push({
        a,
        b,
        viewport,
        dom: score.dom,
        box: score.box,
        px: score.px,
        domPass,
        boxPass,
        pxPass,
        ...(applied ? { accepted: applied } : {}),
        mode: waiting.has(a) && waiting.has(b) ? 'report' : 'enforced',
      });
    }
  }
  for (const acceptance of accepted) {
    if (!used.has(acceptance)) {
      problems.push(
        `the box acceptance for ${acceptance.a} and ${acceptance.b} at ${acceptance.viewport} matches no pair the guard scored`,
      );
    }
  }
  const stale = pending.filter((id) => {
    const own = outcomes.filter(({ a, b }) => a === id || b === id);
    return (
      ids.includes(id) && own.length > 0 && own.every((outcome) => designPass(outcome) === true)
    );
  });
  return {
    outcomes,
    clones: outcomes.filter((outcome) => !outcome.pxPass),
    failures: outcomes.filter(
      (outcome) => outcome.mode === 'enforced' && designPass(outcome) === false,
    ),
    reports: outcomes.filter(
      (outcome) => outcome.mode === 'report' && designPass(outcome) === false,
    ),
    stale,
    problems,
  };
}

/** One line for an outcome, as a failure or a report prints it. */
export function describeOutcome(outcome: PairOutcome, thresholds: Thresholds): string {
  const at = (value: PerViewport | null) =>
    value === null ? 'not gating' : value[outcome.viewport];
  const mark = (pass: boolean | null, ok: string, bad: string) =>
    pass === null ? '~' : pass ? ok : bad;
  const dom = `structure ${outcome.dom.toFixed(3)} ${mark(outcome.domPass, '<=', '>')} ${at(thresholds.dom)}`;
  const box = outcome.accepted
    ? `boxes ${outcome.box.toFixed(3)} accepted to ${outcome.accepted.box} (${outcome.accepted.by})`
    : `boxes ${outcome.box.toFixed(3)} ${mark(outcome.boxPass, '<=', '>')} ${at(thresholds.box)}`;
  const px = `pixels ${outcome.px.toFixed(3)} ${outcome.pxPass ? '>=' : '<'} ${thresholds.px[outcome.viewport]}`;
  return `${outcome.a} and ${outcome.b} at ${outcome.viewport}: ${dom}, ${box}, ${px}`;
}

// ---------------------------------------------------------------------------
// Calibration

/** Where a guard's threshold sits between its controls. */
export interface Calibration {
  /** The "same" control nearest the "different" side. */
  readonly same: number;
  /** The "different" control nearest the "same" side. */
  readonly different: number;
  /** How far apart they are; negative when they overlap. */
  readonly gap: number;
  /** The threshold, halfway into the gap; null when the gap is under MIN_GAP. */
  readonly threshold: number | null;
}

/** The smallest gap a threshold may sit in: under it the signature needs work first. */
export const MIN_GAP = 0.1;
/** Where in the gap the threshold sits, from the "same" side: halfway, within the brief's 0.6. */
export const GAP_FRACTION = 0.5;

const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * A threshold from the controls. For `similarity`, "same" controls score
 * high and "different" ones low, and a pair passes at or under it; for
 * `distance` the other way round, and a pair passes at or over it. Either
 * way it sits GAP_FRACTION of the gap from the nearest "same" control.
 */
export function calibrate(
  same: readonly number[],
  different: readonly number[],
  measure: 'similarity' | 'distance',
): Calibration {
  if (same.length === 0 || different.length === 0) {
    throw new Error('Calibration needs at least one "same" and one "different" control.');
  }
  if (measure === 'similarity') {
    const nearestSame = Math.min(...same);
    const nearestDifferent = Math.max(...different);
    const gap = nearestSame - nearestDifferent;
    return {
      same: round(nearestSame),
      different: round(nearestDifferent),
      gap: round(gap),
      threshold: round(gap) < MIN_GAP ? null : round(nearestSame - GAP_FRACTION * gap),
    };
  }
  const nearestSame = Math.max(...same);
  const nearestDifferent = Math.min(...different);
  const gap = nearestDifferent - nearestSame;
  return {
    same: round(nearestSame),
    different: round(nearestDifferent),
    gap: round(gap),
    threshold: round(gap) < MIN_GAP ? null : round(nearestSame + GAP_FRACTION * gap),
  };
}

/** How far over the "same" controls' noise floor the clone guard's threshold sits. */
export const NOISE_FACTOR = 2;

/** The clone guard's threshold, from its noise floor. */
export interface NoiseFloor {
  /** The largest pixel distance among the "same" controls: what a re-render or a recolor moves. */
  readonly floor: number;
  /** NOISE_FACTOR times the floor: a pair closer than this is a clone. */
  readonly threshold: number;
}

/**
 * The clone guard's threshold from its "same" controls (a re-render, a
 * dark scheme, another typography): NOISE_FACTOR times the largest. It
 * needs no "different" control, since it only says two pages are the same
 * page give or take appearance.
 */
export function noiseFloor(same: readonly number[], factor = NOISE_FACTOR): NoiseFloor {
  if (same.length === 0) throw new Error('A noise floor needs at least one "same" control.');
  const floor = Math.max(...same);
  return { floor: round(floor), threshold: round(Math.min(1, factor * floor)) };
}

// ---------------------------------------------------------------------------
// Shared markup: stream E's rule, observed in the rendered output

/**
 * Stream E's diagnostic for a first-party composition rendering shared
 * markup. It joins AUDIT_CODES in packages/variant-contract/src/node/audit.ts
 * with E's PR 3; until then it's this string, and these findings take the
 * shape of an AuditFinding with it as the code.
 */
export const SHARED_MARKUP_CODE = 'audit.shared-markup';

/** E's remedy for audit.shared-markup, word for word. */
export const SHARED_MARKUP_REMEDY =
  "Render this kind in the composition's own renderer; the shared one is the fallback's and third parties'.";

/**
 * Whether a shared frame in a first-party boundary fails the spec. Off until
 * E's PR 3 pins land (renderedKinds all core, routes bespoke/bespoke, and the
 * ban on importing the shared renderers): today's first-party frames are
 * shared, so the spec only attaches the findings. Turn it on in the PR that
 * lands with those pins.
 */
export const SHARED_MARKUP_ENFORCED = false;

/** A section frame the page renders with data-renderer="shared". */
export interface SharedFrame {
  /** `section` or `article`. */
  readonly tag: string;
  readonly sectionId: string | null;
  readonly kind: string | null;
}

/** audit.shared-markup's finding, an AuditFinding with E's code. */
export interface SharedMarkupFinding {
  readonly code: typeof SHARED_MARKUP_CODE;
  readonly package: string;
  /** The route or fixture the frame rendered on. */
  readonly file: string;
  readonly line: 0;
  readonly column: 0;
  readonly message: string;
  readonly remedy: typeof SHARED_MARKUP_REMEDY;
}

/** The selector the spec reads frames with: a section frame inside `variant`'s boundary, rendered shared. */
export const sharedFrameSelector = (variant: string) =>
  `[data-variant="${variant}"] :is(section, article)[data-renderer="shared"]`;

/** One audit.shared-markup finding for each shared frame in a first-party composition's boundary. */
export function sharedMarkupFindings({
  packageName,
  file,
  frames,
}: {
  readonly packageName: string;
  readonly file: string;
  readonly frames: readonly SharedFrame[];
}): SharedMarkupFinding[] {
  return frames.map((frame) => ({
    code: SHARED_MARKUP_CODE,
    package: packageName,
    file,
    line: 0,
    column: 0,
    message: `Section ${frame.sectionId ?? '(no id)'}, a ${frame.kind ?? '(no kind)'} section, renders in the shared renderer: its <${frame.tag}> has data-renderer="shared".`,
    remedy: SHARED_MARKUP_REMEDY,
  }));
}
