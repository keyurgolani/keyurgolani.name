// image-palette@1 (#20 PR 3): a first-party quantizer and scorer for the
// image-derived schemes. It's this project's own, not Material's Wu,
// WSMeans, or Score, so its records name it as itself.
//
// 1. Sample a 64 by 64 grid of the decoded RGBA, each cell's center pixel,
//    in integer arithmetic. A pixel under half alpha is skipped.
// 2. Count the samples in a 4-bit-per-channel histogram, each bin keeping
//    its pixels' sums.
// 3. Merge the bins, most populous first (then by bin), into clusters: a
//    bin joins the first cluster whose first bin's mean is within
//    CLUSTER_DISTANCE in OKLab, else starts one.
// 4. Score each cluster's mean: its share of the samples times its OKLCH
//    chroma, 0 under MIN_CHROMA, so a neutral never scores.
//
// Pure, on integers until the OKLab reads, so the server, the checks, and
// the browser get the same palette from the same pixels.

import { chroma, deltaE } from '../color';
import type { ExtractedColor } from './compose';

/** Decoded pixels, four bytes a pixel, red, green, blue, alpha, in rows. */
export interface Raster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

export const GRID = 64;
export const CLUSTER_DISTANCE = 0.08;
export const MIN_CHROMA = 0.04;
/** How many scored colors a record keeps. */
export const KEPT = 6;

const hex = (values: readonly number[]) =>
  `#${values.map((value) => value.toString(16).padStart(2, '0')).join('')}`;

const round4 = (value: number) => Math.round(value * 10000) / 10000;

interface Bin {
  readonly key: number;
  count: number;
  red: number;
  green: number;
  blue: number;
}

/** The raster's colors, scored, best first: at most KEPT, with every scoring one before any that doesn't. */
export function imagePalette(raster: Raster): ExtractedColor[] {
  const { width, height, data } = raster;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    data.length !== width * height * 4
  ) {
    throw new TypeError('image-palette takes RGBA pixels, four bytes for each of width x height.');
  }
  const bins = new Map<number, Bin>();
  let total = 0;
  for (let row = 0; row < GRID; row += 1) {
    const y = Math.floor(((2 * row + 1) * height) / (2 * GRID));
    for (let column = 0; column < GRID; column += 1) {
      const x = Math.floor(((2 * column + 1) * width) / (2 * GRID));
      const at = (y * width + x) * 4;
      if (data[at + 3]! < 128) continue;
      const red = data[at]!;
      const green = data[at + 1]!;
      const blue = data[at + 2]!;
      const key = ((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4);
      const bin = bins.get(key) ?? { key, count: 0, red: 0, green: 0, blue: 0 };
      bin.count += 1;
      bin.red += red;
      bin.green += green;
      bin.blue += blue;
      bins.set(key, bin);
      total += 1;
    }
  }
  if (total === 0) return [];
  const mean = (bin: Pick<Bin, 'count' | 'red' | 'green' | 'blue'>) =>
    hex([bin.red, bin.green, bin.blue].map((sum) => Math.round(sum / bin.count)));
  const ordered = [...bins.values()].sort((a, b) => b.count - a.count || a.key - b.key);
  const clusters: { seed: string; count: number; red: number; green: number; blue: number }[] = [];
  for (const bin of ordered) {
    const color = mean(bin);
    const cluster = clusters.find(({ seed }) => deltaE(seed, color) <= CLUSTER_DISTANCE);
    if (cluster) {
      cluster.count += bin.count;
      cluster.red += bin.red;
      cluster.green += bin.green;
      cluster.blue += bin.blue;
    } else {
      clusters.push({
        seed: color,
        count: bin.count,
        red: bin.red,
        green: bin.green,
        blue: bin.blue,
      });
    }
  }
  return clusters
    .map((cluster) => {
      const color = mean(cluster);
      const share = cluster.count / total;
      const amount = chroma(color);
      return {
        hex: color,
        share: round4(share),
        score: amount < MIN_CHROMA ? 0 : round4(share * amount),
      };
    })
    .sort((a, b) => b.score - a.score || b.share - a.share || (a.hex < b.hex ? -1 : 1))
    .slice(0, KEPT);
}
