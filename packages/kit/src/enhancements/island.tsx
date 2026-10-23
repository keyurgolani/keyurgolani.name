// EnhancementIsland (#6, items 6 and 7): an enhancement in the place of its
// server markup. The markup is its children, rendered on the server and kept
// until the enhancement has loaded, so the island keeps its space and the
// page reads the same without it. It loads through <Enhancement>'s loader,
// once its runtime is active and its manifest entry's `requires` holds in
// this browser, and stays loaded after. On a chunk or runtime error it tears
// down to the markup and marks itself failed. Never put a page's essential
// content or navigation in an island: an island adds to a page that already
// works.

import { Component, useState, type ReactNode } from 'react';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { useEnhancementRuntime } from '../runtime/use-runtime';
import { enhancementsOff, MountedEnhancement } from './load';

/** The markup back in place once anything below it throws, with `onError` told once. */
class IslandBoundary extends Component<
  { children: ReactNode; markup: ReactNode; onError: () => void },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch() {
    this.props.onError();
  }

  override componentDidMount() {
    // As <Enhancement>'s boundary counts itself, for the throw switch.
    const mounted = globalThis.__portfolioMountedEnhancements;
    if (typeof mounted === 'number') globalThis.__portfolioMountedEnhancements = mounted + 1;
  }

  override render() {
    return this.state.failed ? this.props.markup : this.props.children;
  }
}

export interface EnhancementIslandProps {
  /** The render input, as the variant got it. */
  readonly input: VariantRenderInput;
  /** An enhancement id the rendering variant's manifest declares. */
  readonly id: string;
  /** The server markup: what the island shows until the enhancement loads, and after it fails. */
  readonly children?: ReactNode;
  /** A hook for the variant's layout. */
  readonly className?: string;
  /** How far outside the viewport the island still counts as in view. Default 200px. */
  readonly rootMargin?: string;
}

export function EnhancementIsland({
  input,
  id,
  children = null,
  className,
  rootMargin,
}: EnhancementIslandProps) {
  const declared = input.capabilities.enhancements.find((entry) => entry.id === id);
  const runtime = useEnhancementRuntime({ requires: declared?.requires ?? [], rootMargin });
  const { attachRoot } = runtime;
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const ready = runtime.state === 'active' && runtime.eligible;

  // Once started, it stays started: a pause doesn't unload the enhancement.
  if (ready && !started) setStarted(true);

  const off = started && enhancementsOff(globalThis.document);
  const live = started && !failed && !off;
  return (
    <div
      ref={attachRoot}
      className={className}
      data-enhancement-island={id}
      data-island={failed ? 'failed' : live ? 'live' : 'markup'}
    >
      {live ? (
        <IslandBoundary
          markup={children}
          onError={() => {
            setFailed(true);
            runtime.fail();
          }}
        >
          <MountedEnhancement input={input} id={id} fallback={children} />
        </IslandBoundary>
      ) : (
        children
      )}
    </div>
  );
}
