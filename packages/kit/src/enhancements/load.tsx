// The pieces of loadEnhancement(), apart so tests can reach them.

import { Component, Suspense, use, useSyncExternalStore, type ReactNode } from 'react';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { hostModules, type EnhancementComponent } from '../sections/host-modules';

declare global {
  /** Set by tests to make every enhancement fail, as a blocked chunk would. */
  var __portfolioFailEnhancements: unknown;
}

/** Renders nothing once anything below it throws, so a broken enhancement leaves the page as it was. */
export class EnhancementBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
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

const loads = new Map<string, Promise<{ default: EnhancementComponent }>>();

/** One load per enhancement, kept, so a re-render never loads it twice. */
export function moduleFor(key: string): Promise<{ default: EnhancementComponent }> {
  let load = loads.get(key);
  if (!load) {
    load = loadModule(key);
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
 * Nothing on the server or while hydrating, then the enhancement. It throws,
 * for the boundary to catch, when the variant doesn't declare `id` or when
 * globalThis.__portfolioFailEnhancements is set.
 */
export function Enhancement({ input, id }: { input: VariantRenderInput; id: string }) {
  const mounted = useMounted();
  if (!mounted) return null;
  if (!input.capabilities.enhancements.some((declared) => declared.id === id)) {
    throw new Error(`${input.variant} declares no enhancement ${id}.`);
  }
  if (globalThis.__portfolioFailEnhancements) {
    throw new Error('Every enhancement fails: globalThis.__portfolioFailEnhancements is set.');
  }
  return (
    <Suspense fallback={null}>
      <Loaded input={input} moduleKey={`${input.variant}/${id}`} />
    </Suspense>
  );
}
