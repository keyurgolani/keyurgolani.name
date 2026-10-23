// The pieces of <Enhancement>, apart so tests can reach them.

import { Component, Suspense, use, useSyncExternalStore, type ReactNode } from 'react';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { hostModules, type EnhancementComponent } from '../sections/host-modules';

declare global {
  /** Set by tests to make every enhancement fail, as a blocked chunk would. */
  var __portfolioFailEnhancements: unknown;
  /** Set by tests to 0 to count the enhancements a page mounts: each one adds 1. */
  var __portfolioMountedEnhancements: unknown;
}

/** Renders nothing once anything below it throws, so a broken enhancement leaves the page as it was. */
export class EnhancementBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidMount() {
    // Every <Enhancement> mounts one boundary, whether or not what's below
    // it then fails, so a test that sets the count learns how many the
    // throw switch has to fail. Otherwise nothing is written.
    const mounted = globalThis.__portfolioMountedEnhancements;
    if (typeof mounted === 'number') globalThis.__portfolioMountedEnhancements = mounted + 1;
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** The module registered for `key`, `<variant id>/<enhancement id>`, or a rejection saying why not. */
export async function loadModule(key: string): Promise<{ default: EnhancementComponent }> {
  const load = hostModules().enhancementLoaders?.[key];
  if (!load) throw new Error(`No enhancement ${key} is registered.`);
  return load();
}

type Loads = Map<string, Promise<{ default: EnhancementComponent }>>;

/**
 * The loads for each set of modules the host registered. A new
 * registerHostModules() call starts a new set, so nothing loaded under the
 * old one is reused.
 */
const loadsByModules = new WeakMap<object, Loads>();

/**
 * One load per enhancement, kept for the page, so a re-render never loads it
 * twice. A load that fails stays failed for the page too: React renders the
 * suspended enhancement again once it settles, and gets the failure for its
 * boundary to catch, not a new load, and nothing on the page, a parent's
 * re-render or a remount with a new key included, asks for the chunk again.
 * A new page, which registers its host modules afresh, tries again, once.
 */
export function moduleFor(key: string): Promise<{ default: EnhancementComponent }> {
  const modules = hostModules();
  let loads = loadsByModules.get(modules);
  if (!loads) {
    loads = new Map();
    loadsByModules.set(modules, loads);
  }
  let load = loads.get(key);
  if (!load) {
    load = loadModule(key);
    // A failure is the page's answer; mark it handled, for the boundary to report.
    load.catch(() => undefined);
    loads.set(key, load);
  }
  return load;
}

/** The loaded enhancement. It suspends while loading, and throws if the load failed. */
function Loaded({ input, moduleKey }: { input: VariantRenderInput; moduleKey: string }) {
  const { default: Enhanced } = use(moduleFor(moduleKey));
  return <Enhanced input={input} />;
}

const subscribe = () => () => {};

/** False on the server and while hydrating, then true. */
function useMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/**
 * Whether the page's presentation boundary, its outermost element with
 * data-variant, turns enhancements off with data-enhancement="off", as a
 * preview's environment does (#7, Slice 4). The page then reads as it does
 * when every enhancement fails.
 */
export function enhancementsOff(document: Pick<Document, 'querySelector'> | undefined): boolean {
  return document?.querySelector('[data-variant]')?.getAttribute('data-enhancement') === 'off';
}

/**
 * Nothing on the server or while hydrating, then the enhancement. It throws,
 * for the boundary to catch, when the variant doesn't declare `id` or when
 * globalThis.__portfolioFailEnhancements is set, and renders nothing when the
 * page's boundary turns enhancements off.
 */
export function MountedEnhancement({
  input,
  id,
  fallback = null,
}: {
  input: VariantRenderInput;
  id: string;
  /** What shows while the module loads: nothing, or an island's server markup. */
  fallback?: ReactNode;
}) {
  const mounted = useMounted();
  if (!mounted) return null;
  if (!input.capabilities.enhancements.some((declared) => declared.id === id)) {
    throw new Error(`${input.variant} declares no enhancement ${id}.`);
  }
  if (enhancementsOff(globalThis.document)) return null;
  if (globalThis.__portfolioFailEnhancements) {
    throw new Error('Every enhancement fails: globalThis.__portfolioFailEnhancements is set.');
  }
  return (
    <Suspense fallback={fallback}>
      <Loaded input={input} moduleKey={`${input.variant}/${id}`} />
    </Suspense>
  );
}
