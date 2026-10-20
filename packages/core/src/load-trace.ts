// The owner load trace (#1, item 14), through the same globalThis symbol as
// apps/web/src/server/load-trace.ts. Every module in this package is owner
// code and records its name as it loads, so readiness sees it under demo or
// read-only as it would a module under server/owner/.

const TRACE = Symbol.for('keyurgolani.portfolio.owner-modules');
type Holder = typeof globalThis & { [TRACE]?: Set<string> };

export function recordOwnerModule(name: string): void {
  const holder = globalThis as Holder;
  (holder[TRACE] ??= new Set()).add(name);
}
