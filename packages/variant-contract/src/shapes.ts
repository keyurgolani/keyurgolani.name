// The corners a basic shape gives (K-5 review L1). `inset()`, `rect()` and
// `xywh()` take `round <radius>`, a border radius by another name, so a
// clip-path or a shape-outside could give an element a corner no
// --ui-radius-* token decides. Both audits read each radius this returns as
// they read a border-radius. `circle()`, `ellipse()`, `polygon()` and
// `path()` give no corner and stay as they are.

const ROUNDED_SHAPE = /(?<![\w-])(?:inset|rect|xywh)\(/gi;

/** The radius after `round` in each rounded basic shape `value` holds, outermost parentheses only. */
export function shapeRadii(value: string): string[] {
  const radii: string[] = [];
  for (const match of value.matchAll(ROUNDED_SHAPE)) {
    const start = match.index + match[0].length;
    let depth = 1;
    let i = start;
    let round = -1;
    for (; i < value.length; i++) {
      const char = value[i]!;
      if (char === '(') depth++;
      else if (char === ')' && --depth === 0) break;
      else if (
        depth === 1 &&
        round === -1 &&
        /^round(?![\w-]|\s*\()/i.test(value.slice(i, i + 32)) &&
        !/[\w-]/.test(value[i - 1] ?? ' ')
      ) {
        round = i + 'round'.length;
      }
    }
    if (round !== -1) radii.push(value.slice(round, i).trim());
  }
  return radii;
}
