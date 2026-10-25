// What a design language's texture paints under text (#20, PR 2b): the
// gate's measure of --ui-texture, on the basis the quality cells' contrast
// sampler (tests/quality/lib/a11y/contrast.ts) reads a page by. The sampler
// lays the text color over every pixel of the text's content box, with its
// glyphs hidden, and holds it to the worst one. Here the texture is drawn,
// as the platform stylesheet paints it on every surface, the top layer over
// the surface's own color, on a few reference surfaces, and every pixel
// where a surface's text can sit is kept: inside its padding, which the
// language's space-surface tokens set. A pixel is a recipe, not a color: the
// share of the surface under it and of each color role the texture mixes,
// so one drawing serves every color set.
//
// The browser draws a gradient by its color at each pixel's center, so the
// drawing samples each pixel at four points a half pixel apart, and a dot
// or a line under a pixel wide still shows at its full strength. Chromium
// dithers a gradient's colors, as much as 2 of 255 a channel under a
// scanline texture in the quality cells, so a textured pixel is read that
// much nearer the text's color (TEXTURE_DITHER).
//
// The tokens are the gradients the language grammar accepts: linear,
// repeating-linear, radial, and conic, with each color transparent,
// var(--color-<role>), or color-mix(in srgb, var(--color-<role>) N%,
// transparent). A texture written any other way can't be measured, so it
// fails the gate rather than passing unchecked.

import { COLOR_ROLES, type ColorRole } from './roles';

/** How far, in 0 to 255 a channel, a gradient's dither can move a textured pixel. */
export const TEXTURE_DITHER = 2;

/**
 * The surfaces a texture is drawn on, in CSS px: a short card, a panel, a
 * wide band, and a tall column, so a texture placed by percentages meets
 * each shape a variant gives a surface.
 */
export const REFERENCE_SURFACES: readonly (readonly [number, number])[] = [
  [160, 120],
  [360, 200],
  [640, 240],
  [200, 400],
];

/** One pixel under text: the surface's share, and each role's, summing to 1. */
export interface TexturePixel {
  readonly surface: number;
  readonly roles: Readonly<Partial<Record<ColorRole, number>>>;
}

/** Where text sits inside a surface: its padding, in CSS px. */
export interface TextureInset {
  readonly block: number;
  readonly inline: number;
}

const ROLES: ReadonlySet<string> = new Set(COLOR_ROLES);

interface Stop {
  /** null: transparent. */
  readonly role: ColorRole | null;
  readonly alpha: number;
  /** In px along the gradient, or null until the stops are resolved. */
  readonly at: number | null;
}

interface RawStop {
  readonly role: ColorRole | null;
  readonly alpha: number;
  readonly positions: readonly string[];
}

/** A gradient layer: where on its line each point of a w by h box falls, and its stops. */
interface Layer {
  readonly kind: 'linear' | 'radial' | 'conic';
  readonly repeating: boolean;
  readonly prelude: string | null;
  readonly stops: readonly RawStop[];
}

/** Splits `value` at its top-level commas. */
function splitTop(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

const COLOR_MIX =
  /^color-mix\(\s*in\s+srgb\s*,\s*var\(--color-([a-z0-9-]+)\)\s+(\d+(?:\.\d+)?)%\s*,\s*transparent\s*\)/;
const VAR = /^var\(--color-([a-z0-9-]+)\)/;

/** A color stop: its color, then up to two positions. */
function parseStop(text: string): RawStop | string {
  let rest = text.trim();
  let role: ColorRole | null = null;
  let alpha = 0;
  const mixed = COLOR_MIX.exec(rest);
  const plain = VAR.exec(rest);
  if (mixed) {
    if (!ROLES.has(mixed[1]!)) return `names no color role: ${mixed[1]}`;
    role = mixed[1] as ColorRole;
    alpha = Number.parseFloat(mixed[2]!) / 100;
    rest = rest.slice(mixed[0].length);
  } else if (plain) {
    if (!ROLES.has(plain[1]!)) return `names no color role: ${plain[1]}`;
    role = plain[1] as ColorRole;
    alpha = 1;
    rest = rest.slice(plain[0].length);
  } else if (rest.startsWith('transparent')) {
    rest = rest.slice('transparent'.length);
  } else {
    return `has a color the gate can't measure: ${text}`;
  }
  const positions = rest.trim() === '' ? [] : rest.trim().split(/\s+/);
  if (positions.length > 2) return `has a stop the gate can't read: ${text}`;
  return { role, alpha, positions };
}

/** A gradient's first argument when it's a direction, shape, size, or position, not a stop. */
const PRELUDE = /^(?:to\s|from\s|at\s|circle|ellipse|closest-|farthest-|-?\.?\d)/;

/** The layers of a texture token, or why the gate can't draw it. */
function parseLayers(texture: string): Layer[] | string {
  const layers: Layer[] = [];
  for (const part of splitTop(texture)) {
    const match = /^(repeating-)?(linear|radial|conic)-gradient\((.*)\)$/s.exec(part);
    if (!match) return `--ui-texture has a layer the gate can't draw: ${part}`;
    const args = splitTop(match[3]!);
    const prelude = PRELUDE.test(args[0]!) ? args.shift()! : null;
    const stops: RawStop[] = [];
    for (const arg of args) {
      const stop = parseStop(arg);
      if (typeof stop === 'string') return `--ui-texture ${stop}`;
      stops.push(stop);
    }
    if (stops.length < 2) return `--ui-texture has a layer with fewer than two stops: ${part}`;
    layers.push({
      kind: match[2] as Layer['kind'],
      repeating: Boolean(match[1]),
      prelude,
      stops,
    });
  }
  return layers;
}

/** A length or percentage, in px against `basis`, or null. */
function length(value: string, basis: number): number | null {
  if (value === '0') return 0;
  const match = /^(-?\d+(?:\.\d+)?|-?\.\d+)(px|rem|em|%|deg|turn)$/.exec(value);
  if (!match) return null;
  const amount = Number.parseFloat(match[1]!);
  switch (match[2]) {
    case 'px':
      return amount;
    case 'rem':
    case 'em':
      return amount * 16;
    case '%':
      return (amount / 100) * basis;
    case 'deg':
      return (amount / 360) * basis;
    case 'turn':
      return amount * basis;
    default:
      return null;
  }
}

/** CSS's stop fixup: positions in px along a line of `basis`, never going back. */
function resolveStops(raw: readonly RawStop[], basis: number): Stop[] | string {
  const expanded: { role: ColorRole | null; alpha: number; at: number | null }[] = [];
  for (const stop of raw) {
    if (stop.positions.length === 0) expanded.push({ ...stop, at: null });
    for (const position of stop.positions) {
      const at = length(position, basis);
      if (at === null) return `--ui-texture has a stop position the gate can't read: ${position}`;
      expanded.push({ role: stop.role, alpha: stop.alpha, at });
    }
  }
  if (expanded[0]!.at === null) expanded[0]!.at = 0;
  if (expanded.at(-1)!.at === null) expanded.at(-1)!.at = basis;
  let max = -Infinity;
  for (let index = 0; index < expanded.length; index += 1) {
    const stop = expanded[index]!;
    if (stop.at === null) {
      let next = index + 1;
      while (expanded[next]!.at === null) next += 1;
      const from = expanded[index - 1]!.at!;
      const to = expanded[next]!.at!;
      for (let k = index; k < next; k += 1) {
        expanded[k]!.at = from + ((to - from) * (k - index + 1)) / (next - index + 1);
      }
    }
    max = Math.max(max, stop.at!);
    stop.at = max;
  }
  return expanded as Stop[];
}

/** A layer's color at one point: up to two roles' premultiplied shares, which colorAt() fills in. */
interface Sample {
  a: ColorRole | null;
  shareA: number;
  b: ColorRole | null;
  shareB: number;
}

/**
 * The premultiplied color at `t` px along a gradient's line, into `out`,
 * interpolated between its two stops as CSS does, in premultiplied sRGB.
 */
function colorAt(stops: readonly Stop[], t: number, repeating: boolean, out: Sample): void {
  let at = t;
  const first = stops[0]!.at!;
  const last = stops[stops.length - 1]!.at!;
  if (repeating && last > first) {
    const period = last - first;
    at = first + ((((t - first) % period) + period) % period);
  }
  out.a = out.b = null;
  out.shareA = out.shareB = 0;
  let a: Stop;
  let b: Stop | null = null;
  let u = 0;
  if (at <= first) a = stops[0]!;
  else if (at >= last) a = stops[stops.length - 1]!;
  else {
    let index = 0;
    while (stops[index + 1]!.at! < at) index += 1;
    a = stops[index]!;
    b = stops[index + 1]!;
    const span = b.at! - a.at!;
    u = span <= 0 ? 1 : (at - a.at!) / span;
  }
  if (a.role && a.alpha * (1 - u) > 0) {
    out.a = a.role;
    out.shareA = a.alpha * (1 - u);
  }
  if (b?.role && b.alpha * u > 0) {
    if (b.role === out.a) out.shareA += b.alpha * u;
    else {
      out.b = b.role;
      out.shareB = b.alpha * u;
    }
  }
}

/** A position keyword or length on an axis of `size`. */
function axisPosition(value: string, size: number): number | null {
  if (value === 'center') return size / 2;
  if (value === 'left' || value === 'top') return 0;
  if (value === 'right' || value === 'bottom') return size;
  return length(value, size);
}

/** `at <x> <y>`, or the center. */
function center(words: readonly string[], w: number, h: number): [number, number] | null {
  const index = words.indexOf('at');
  if (index < 0) return [w / 2, h / 2];
  const [x = 'center', y = 'center'] = words.slice(index + 1);
  const cx = axisPosition(x, w);
  const cy = axisPosition(y, h);
  return cx === null || cy === null ? null : [cx, cy];
}

const SIDES: Readonly<Record<string, number>> = {
  'to top': 0,
  'to right': 90,
  'to bottom': 180,
  'to left': 270,
};

/** Each point's distance along a layer's line, and the line's length, in a w by h box. */
function geometry(
  layer: Layer,
  w: number,
  h: number,
): { line: number; at: (x: number, y: number) => number } | string {
  const words = (layer.prelude ?? '').trim().split(/\s+/).filter(Boolean);
  if (layer.kind === 'linear') {
    const prelude = (layer.prelude ?? 'to bottom').trim();
    const deg =
      SIDES[prelude] ?? (/^-?\d+(?:\.\d+)?deg$/.test(prelude) ? Number.parseFloat(prelude) : null);
    if (deg === null) return `--ui-texture has a direction the gate can't read: ${prelude}`;
    const rad = (deg * Math.PI) / 180;
    const [dx, dy] = [Math.sin(rad), -Math.cos(rad)];
    const line = Math.abs(w * dx) + Math.abs(h * dy);
    return { line, at: (x, y) => (x - w / 2) * dx + (y - h / 2) * dy + line / 2 };
  }
  const c = center(words, w, h);
  if (!c) return `--ui-texture has a position the gate can't read: ${layer.prelude}`;
  const [cx, cy] = c;
  if (layer.kind === 'conic') {
    const from = words[0] === 'from' ? length(words[1] ?? '', 360) : 0;
    if (from === null) return `--ui-texture has an angle the gate can't read: ${layer.prelude}`;
    return {
      line: 360,
      at: (x, y) => {
        const deg = (Math.atan2(x - cx, -(y - cy)) * 180) / Math.PI;
        return (((deg - from) % 360) + 360) % 360;
      },
    };
  }
  const shape = words.includes('circle') ? 'circle' : 'ellipse';
  const sizes = words.filter((word) => /^(closest|farthest)-(side|corner)$/.test(word));
  const size = sizes[0] ?? 'farthest-corner';
  const before = words.slice(0, words.includes('at') ? words.indexOf('at') : words.length);
  if (before.some((word) => !['circle', 'ellipse', ...sizes].includes(word))) {
    return `--ui-texture has a radial size the gate can't read: ${layer.prelude}`;
  }
  const sides = [cx, w - cx, cy, h - cy];
  const [nearX, farX] = [Math.min(cx, w - cx), Math.max(cx, w - cx)];
  const [nearY, farY] = [Math.min(cy, h - cy), Math.max(cy, h - cy)];
  if (shape === 'circle') {
    const r =
      size === 'closest-side'
        ? Math.min(...sides)
        : size === 'farthest-side'
          ? Math.max(...sides)
          : size === 'closest-corner'
            ? Math.hypot(nearX, nearY)
            : Math.hypot(farX, farY);
    return { line: r, at: (x, y) => Math.hypot(x - cx, y - cy) };
  }
  // An ellipse's line runs along x; its y distances scale by rx / ry.
  let [rx, ry] =
    size === 'closest-side' || size === 'closest-corner' ? [nearX, nearY] : [farX, farY];
  if (size.endsWith('corner')) [rx, ry] = [rx * Math.SQRT2, ry * Math.SQRT2];
  const k = ry > 0 ? rx / ry : 1;
  return { line: rx, at: (x, y) => Math.hypot(x - cx, (y - cy) * k) };
}

const drawn = new Map<string, TexturePixel[] | string>();

/**
 * Every distinct pixel `texture` puts under a surface's text, the surface
 * alone among them, on the reference surfaces with `inset` padding; or why
 * the gate can't draw it. `none` puts only the surface.
 */
export function texturePixels(texture: string, inset: TextureInset): TexturePixel[] | string {
  const id = `${inset.block} ${inset.inline} ${texture}`;
  const cached = drawn.get(id);
  if (cached) return cached;
  const result = draw(texture, inset);
  drawn.set(id, result);
  return result;
}

function draw(texture: string, inset: TextureInset): TexturePixel[] | string {
  const plain: TexturePixel = { surface: 1, roles: {} };
  if (texture.trim() === 'none') return [plain];
  const layers = parseLayers(texture);
  if (typeof layers === 'string') return layers;
  const found = new Map<string, TexturePixel>([['', plain]]);
  const offsets = [0.25, 0.75];
  const sample: Sample = { a: null, shareA: 0, b: null, shareB: 0 };
  for (const [w, h] of REFERENCE_SURFACES) {
    const prepared = [];
    for (const layer of layers) {
      const shape = geometry(layer, w, h);
      if (typeof shape === 'string') return shape;
      const stops = resolveStops(layer.stops, shape.line);
      if (typeof stops === 'string') return stops;
      prepared.push({ shape, stops, repeating: layer.repeating });
    }
    // The CSS layers list the top one first: paint from the last.
    prepared.reverse();
    for (let py = Math.floor(inset.block); py < Math.ceil(h - inset.block); py += 1) {
      for (let px = Math.floor(inset.inline); px < Math.ceil(w - inset.inline); px += 1) {
        for (const oy of offsets) {
          for (const ox of offsets) {
            const [x, y] = [px + ox, py + oy];
            let surface = 1;
            let roles: Map<ColorRole, number> | null = null;
            for (const { shape, stops, repeating } of prepared) {
              colorAt(stops, shape.at(x, y), repeating, sample);
              const alpha = sample.shareA + sample.shareB;
              if (alpha <= 0) continue;
              surface *= 1 - alpha;
              roles ??= new Map();
              for (const [role, share] of roles) roles.set(role, share * (1 - alpha));
              if (sample.a) roles.set(sample.a, (roles.get(sample.a) ?? 0) + sample.shareA);
              if (sample.b) roles.set(sample.b, (roles.get(sample.b) ?? 0) + sample.shareB);
            }
            if (!roles) continue;
            // Pixels a step of 1/64 apart in every share read alike: keep the strongest of each.
            let id = '';
            let total = 0;
            for (const [role, share] of roles) {
              id += `${role}:${Math.round(share * 64)},`;
              total += share;
            }
            const kept = found.get(id);
            if (!kept || 1 - kept.surface < total) {
              found.set(id, { surface, roles: Object.fromEntries(roles) });
            }
          }
        }
      }
    }
  }
  return [...found.values()];
}

/** Whether `texture` can be drawn, or why not. */
export function textureProblem(texture: string): string | null {
  const result = texturePixels(texture, { block: 0, inline: 0 });
  return typeof result === 'string' ? result : null;
}
