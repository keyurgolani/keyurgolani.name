// The pieces of <Enhancement>, apart so tests can reach them.

import {
  Component,
  Suspense,
  use,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { enhancementPending } from '@portfolio/variant-contract/settle';
import { afterNextFrame } from '../runtime/use-frame-loop';
import { settleHolds } from './holds';
import { hostModules, type EnhancementComponent } from '../sections/host-modules';

declare global {
  /** Set by tests to make every enhancement fail, as a blocked chunk would. */
  var __portfolioFailEnhancements: unknown;
  /** Set by tests to 0 to count the enhancements a page mounts: each one adds 1. */
  var __portfolioMountedEnhancements: unknown;
}

/**
 * Renders nothing once anything below it throws, so a broken enhancement
 * leaves the page as it was, and the kit's own settle signal goes with what
 * it rendered. Given the enhancement's variant and id, it also takes that id
 * off any hold the variant's markup renders for it
 * (@portfolio/variant-contract/settle), since its first pass will never come.
 */
export class EnhancementBoundary extends Component<
  { children: ReactNode; variant?: string; id?: string },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch() {
    const { variant, id } = this.props;
    if (variant !== undefined && id !== undefined) settleHolds(globalThis.document, variant, id);
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

/**
 * The settle signal <Enhancement> renders in its own place until the
 * enhancement's first pass has run (@portfolio/variant-contract/settle): a
 * template, which has no box, holds nothing live, isn't in the
 * accessibility tree and styles nothing. The variant shots and the quality
 * cells' reads wait until no element on the page carries the attribute.
 */
export function PendingMarker({ id }: { id: string }) {
  return <template {...enhancementPending(id)} />;
}

/**
 * Calls `settled` one animation frame after its first commit. Rendered after
 * the enhancement, so it commits with it: an enhancement that attaches in
 * its first effect has attached by then, and so has one that attaches on
 * the commit its own ref's setState makes, which React renders and flushes,
 * effects too, in the same task. A frame boundary, not a time.
 */
function AfterFirstPass({ settled }: { settled: () => void }) {
  useEffect(() => afterNextFrame(settled), [settled]);
  return null;
}

/**
 * The loaded enhancement, and its settle signal until its first pass has
 * run, when it has one. It suspends while loading, and throws if the load
 * failed.
 */
function Loaded({
  input,
  moduleKey,
  marker,
}: {
  input: VariantRenderInput;
  moduleKey: string;
  marker: ReactNode;
}) {
  const { default: Enhanced } = use(moduleFor(moduleKey));
  const [pending, setPending] = useState(marker !== null);
  const settled = useCallback(() => setPending(false), []);
  return (
    <>
      {pending ? marker : null}
      <Enhanced input={input} />
      {pending ? <AfterFirstPass settled={settled} /> : null}
    </>
  );
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
 * On the server and while hydrating, nothing, or with `pending` the settle
 * signal (PendingMarker); then the enhancement, the signal kept while its
 * module loads and until its first pass has run. It throws, for the boundary
 * to catch, when the variant doesn't declare `id` or when
 * globalThis.__portfolioFailEnhancements is set, and renders nothing when the
 * page's boundary turns enhancements off. Either way the signal goes with it.
 */
export function MountedEnhancement({
  input,
  id,
  fallback = null,
  pending = false,
}: {
  input: VariantRenderInput;
  id: string;
  /** What shows while the module loads: nothing, or an island's server markup. */
  fallback?: ReactNode;
  /** Whether it renders the settle signal: <Enhancement>'s, never an island's, which has data-island. */
  pending?: boolean;
}) {
  const marker = pending ? <PendingMarker id={id} /> : null;
  const mounted = useMounted();
  const off = mounted && enhancementsOff(globalThis.document);
  // Turned off, it never runs, so nothing waits on its first pass.
  useEffect(() => {
    if (off) settleHolds(globalThis.document, input.variant, id);
  }, [off, input.variant, id]);
  if (!mounted) return marker;
  if (!input.capabilities.enhancements.some((declared) => declared.id === id)) {
    throw new Error(`${input.variant} declares no enhancement ${id}.`);
  }
  if (off) return null;
  if (globalThis.__portfolioFailEnhancements) {
    throw new Error('Every enhancement fails: globalThis.__portfolioFailEnhancements is set.');
  }
  return (
    <Suspense fallback={marker ?? fallback}>
      <Loaded input={input} moduleKey={`${input.variant}/${id}`} marker={marker} />
    </Suspense>
  );
}
