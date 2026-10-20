// Limits on extension data: plain JSON (what YAML and JSON both carry, minus
// .inf and .nan), at most 8 levels deep and 32 KiB as JSON per occurrence.

export const EXTENSION_MAX_DEPTH = 8;
export const EXTENSION_MAX_BYTES = 32 * 1024;

export type PlainJsonProblem = 'not-json' | 'too-deep';

/**
 * Why a value isn't plain JSON within `maxDepth` levels, or null when it is.
 * Each array or object counts as one level.
 */
export function plainJsonProblem(value: unknown, maxDepth: number): PlainJsonProblem | null {
  const visit = (node: unknown, depth: number): PlainJsonProblem | null => {
    if (node === null || typeof node === 'string' || typeof node === 'boolean') return null;
    if (typeof node === 'number') return Number.isFinite(node) ? null : 'not-json';
    if (!Array.isArray(node) && !isPlainObject(node)) return 'not-json';
    if (depth + 1 > maxDepth) return 'too-deep';
    for (const child of Array.isArray(node) ? node : Object.values(node)) {
      const problem = visit(child, depth + 1);
      if (problem) return problem;
    }
    return null;
  };
  return visit(value, 0);
}

/** Size of the value serialized as JSON, in UTF-8 bytes. */
export function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? '').length;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
