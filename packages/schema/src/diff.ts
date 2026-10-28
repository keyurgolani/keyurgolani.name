// A unified diff of two texts, for the migration's dry run and Studio's
// publish history (#8), which shows a revision's authored changes. Myers'
// algorithm finds the fewest added and removed lines; past MAX_EDITS of
// them it stops, and the caller shows the new text whole instead.

/** The most added plus removed lines worth showing as a diff. */
export const MAX_EDITS = 1000;

type Op = readonly [kind: ' ' | '-' | '+', line: string];

/**
 * `before` and `after` as a unified diff with three lines of context: '' when
 * they're equal, null when more than MAX_EDITS lines differ.
 */
export function unifiedDiff(
  before: string,
  after: string,
  names: { readonly before: string; readonly after: string },
): string | null {
  if (before === after) return '';
  const ops = diffLines(lines(before), lines(after));
  if (!ops) return null;
  return [`--- ${names.before}`, `+++ ${names.after}`, ...hunks(ops)].join('\n') + '\n';
}

function lines(text: string): string[] {
  const all = text.split('\n');
  if (all.at(-1) === '') all.pop();
  return all;
}

function diffLines(a: readonly string[], b: readonly string[]): Op[] | null {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const middle = myers(a.slice(start, endA), b.slice(start, endB));
  if (!middle) return null;
  const same = (line: string): Op => [' ', line];
  return [...a.slice(0, start).map(same), ...middle, ...a.slice(endA).map(same)];
}

function myers(a: readonly string[], b: readonly string[]): Op[] | null {
  const [n, m] = [a.length, b.length];
  const limit = Math.min(n + m, MAX_EDITS);
  const offset = limit + 1;
  const v = new Int32Array(2 * limit + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= limit; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
          ? v[offset + k + 1]!
          : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, a, b, offset);
    }
  }
  return null;
}

function backtrack(
  trace: readonly Int32Array[],
  a: readonly string[],
  b: readonly string[],
  offset: number,
): Op[] {
  const ops: Op[] = [];
  let [x, y] = [a.length, b.length];
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d]!;
    const k = x - y;
    const down = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!);
    const previousX = v[offset + (down ? k + 1 : k - 1)]!;
    const previousY = previousX - (down ? k + 1 : k - 1);
    while (x > previousX && y > previousY) {
      ops.push([' ', a[--x]!]);
      y--;
    }
    if (d > 0) {
      if (down) ops.push(['+', b[--y]!]);
      else ops.push(['-', a[--x]!]);
    }
    [x, y] = [previousX, previousY];
  }
  return ops.reverse();
}

const CONTEXT = 3;

function hunks(ops: readonly Op[]): string[] {
  const out: string[] = [];
  const changed = ops.flatMap(([kind], index) => (kind === ' ' ? [] : [index]));
  let i = 0;
  while (i < changed.length) {
    // One hunk: changes no more than twice the context apart.
    let last = i;
    while (last + 1 < changed.length && changed[last + 1]! - changed[last]! <= 2 * CONTEXT) last++;
    const from = Math.max(0, changed[i]! - CONTEXT);
    const to = Math.min(ops.length, changed[last]! + CONTEXT + 1);
    const lineBefore = ops.slice(0, from).filter(([kind]) => kind !== '+').length + 1;
    const lineAfter = ops.slice(0, from).filter(([kind]) => kind !== '-').length + 1;
    const body = ops.slice(from, to);
    const sizeBefore = body.filter(([kind]) => kind !== '+').length;
    const sizeAfter = body.filter(([kind]) => kind !== '-').length;
    out.push(
      `@@ -${sizeBefore ? lineBefore : lineBefore - 1},${sizeBefore} +${sizeAfter ? lineAfter : lineAfter - 1},${sizeAfter} @@`,
      ...body.map(([kind, line]) => `${kind}${line}`),
    );
    i = last + 1;
  }
  return out;
}
