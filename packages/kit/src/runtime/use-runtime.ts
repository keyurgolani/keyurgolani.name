'use client';

// useEnhancementRuntime (#6, items 6 and 7): one effect's runtime. It reads
// the document's inputs from store.ts, and its root's own: whether the root
// is in view, kept for as long as the effect is mounted, and the motion its
// presentation boundary says, which a preview's environment can change while
// the page runs. While it isn't active, its root carries
// data-activity="paused", which experience-base.css pauses CSS animations
// below.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { browserProbe, meetsRequirements } from './requirements';
import { documentInputs, SERVER_INPUTS, subscribeDocument } from './store';
import { motionReduced, resolveRuntime, type RuntimeStatus } from './state';

export interface RuntimeOptions {
  /** The enhancement's `requires`: capability checks, such as webgl2 or min-width:768. */
  readonly requires?: readonly string[];
  /** How far outside the viewport the root still counts as in view. Default 200px. */
  readonly rootMargin?: string;
}

export interface EnhancementRuntime extends RuntimeStatus {
  /** Whether this browser meets every requirement. False until the page has mounted. */
  readonly eligible: boolean;
  /** Attach to the effect's root: the element whose visibility decides whether it runs. */
  readonly rootRef: (node: Element | null) => void;
  /** Marks the effect failed: static, for good, so it tears down to its server markup. */
  readonly fail: () => void;
}

const noSubscription = () => () => {};

/** The boundary's motion attributes: the site's policy and a preview's environment. */
interface BoundaryMotion {
  readonly policy: string | null;
  readonly motion: string | null;
}

const NO_BOUNDARY: BoundaryMotion = { policy: null, motion: null };

function boundaryOf(root: Element | null): Element | null {
  if (typeof document === 'undefined') return null;
  return root?.closest('[data-variant]') ?? document.querySelector('[data-variant]');
}

export function useEnhancementRuntime(options: RuntimeOptions = {}): EnhancementRuntime {
  const rootMargin = options.rootMargin ?? '200px';
  const requires = options.requires ?? [];
  const requiresKey = requires.join(' ');

  const mounted = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const inputs = useSyncExternalStore(subscribeDocument, documentInputs, () => SERVER_INPUTS);
  const [root, setRoot] = useState<Element | null>(null);
  const [intersecting, setIntersecting] = useState(false);
  const [boundary, setBoundary] = useState<BoundaryMotion>(NO_BOUNDARY);
  const [failed, setFailed] = useState(false);

  // In view, both ways, for as long as the effect is mounted.
  useEffect(() => {
    if (!root || typeof IntersectionObserver === 'undefined') {
      setIntersecting(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        if (entry) setIntersecting(entry.isIntersecting);
      },
      { rootMargin },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, [root, rootMargin]);

  // The boundary's motion, as the server rendered it and as a preview changes it.
  useEffect(() => {
    const element = boundaryOf(root);
    if (!element) return;
    const read = () =>
      setBoundary({
        policy: element.getAttribute('data-motion-policy'),
        motion: element.getAttribute('data-motion'),
      });
    read();
    const observer = new MutationObserver(read);
    observer.observe(element, {
      attributes: true,
      attributeFilter: ['data-motion-policy', 'data-motion'],
    });
    return () => observer.disconnect();
  }, [root]);

  const status = resolveRuntime({
    mounted,
    osReduced: inputs.osReduced,
    policy: boundary.policy,
    environmentMotion: boundary.motion,
    documentVisible: inputs.documentVisible,
    intersecting,
    visitorPaused: inputs.visitorPaused,
    lifecycle: inputs.lifecycle,
    failed,
  });
  const reduced = motionReduced({
    osReduced: inputs.osReduced,
    policy: boundary.policy,
    environmentMotion: boundary.motion,
  });
  const eligible = useMemo(
    () =>
      mounted &&
      meetsRequirements(requiresKey ? requiresKey.split(' ') : [], browserProbe(), !reduced),
    [mounted, requiresKey, reduced],
  );

  // CSS animations below a root that isn't active pause with it.
  useEffect(() => {
    if (!(root instanceof HTMLElement || root instanceof SVGElement)) return;
    if (status.state === 'active') delete root.dataset.activity;
    else root.dataset.activity = 'paused';
  }, [root, status.state]);

  return {
    ...status,
    eligible,
    rootRef: setRoot,
    fail: () => setFailed(true),
  };
}
