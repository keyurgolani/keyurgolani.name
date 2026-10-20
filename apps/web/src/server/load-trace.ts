// The process-wide trace of loaded owner modules (#1, item 14). Every module
// under server/owner/ records its name when it's evaluated, and so do the
// owner modules #2 and #3 put in @portfolio/core, through the same
// globalThis symbol. Readiness (#1, item 19) reports it empty under demo and
// read-only.

const TRACE = Symbol.for('keyurgolani.portfolio.owner-modules');
type Holder = typeof globalThis & { [TRACE]?: Set<string> };

export function recordOwnerModule(name: string): void {
  const holder = globalThis as Holder;
  (holder[TRACE] ??= new Set()).add(name);
}

/** Owner modules this process has evaluated, in load order. */
export function loadedOwnerModules(): readonly string[] {
  return [...((globalThis as Holder)[TRACE] ?? [])];
}
