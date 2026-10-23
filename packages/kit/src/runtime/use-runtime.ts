'use client';

// useEnhancementRuntime (#6, items 6 and 7): one effect's runtime. It reads
// the document's inputs from store.ts, and its root's own: whether the root
// is in view, kept for as long as the effect is mounted, and the motion its
// presentation boundary says, which a preview's environment can change while
// the page runs. While it isn't active, its root carries
// data-activity="paused", which experience-base.css pauses CSS animations
// below.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { MotionPolicy } from '@portfolio/schema';
import { useProvidedMotionPolicy } from '../motion';
import { browserProbe, meetsRequirements } from './requirements';
import { documentInputs, SERVER_INPUTS, subscribeDocument } from './store';
import { motionReduced, resolveRuntime, type RuntimeStatus } from './state';

export interface RuntimeOptions {
  /** The enhancement's `requires`: capability checks, such as webgl2 or min-width:768. */
  readonly requires?: readonly string[];
  /** How far outside the viewport the root still counts as in view. Default 200px. */
  readonly rootMargin?: string;
  /**
   * The effect's own motion policy, as its `motionPreference` prop gives it.
   * It can only add a `reduce`: the boundary's policy, a MotionPolicyProvider
   * above it, and the OS each reduce motion as well.
   */
  readonly motionPolicy?: MotionPolicy;
}

export interface EnhancementRuntime extends RuntimeStatus {
  /** Whether this browser meets every requirement. False until the page has mounted. */
  readonly eligible: boolean;
  /** Whether the root is in view, with its margin, on a mounted page, whatever else pauses it. */
  readonly inView: boolean;
  /** Attach to the effect's root: the element whose visibility decides whether it runs. */
  readonly attachRoot: (node: Element | null) => void;
  /** Marks the effect failed: static, for good, so it tears down to its server markup. */
  readonly fail: () => void;
}

const noSubscription = () => () => {};

/** The boundary's motion attributes: the site's policy and a preview's environment. */
export interface BoundaryMotion {
  readonly policy: string | null;
  readonly motion: string | null;
}

const NO_BOUNDARY: BoundaryMotion = { policy: null, motion: null };

/** The boundary's two attributes as one string, so a snapshot that hasn't changed compares equal. */
function boundaryKey(element: Element | null): string {
  if (!element) return '';
  return JSON.stringify([
    element.getAttribute('data-motion-policy'),
    element.getAttribute('data-motion'),
  ]);
}

function boundaryFrom(key: string | null): BoundaryMotion | null {
  if (key === null) return null;
  if (key === '') return NO_BOUNDARY;
  const [policy, motion] = JSON.parse(key) as [string | null, string | null];
  return { policy, motion };
}

function boundaryOf(root: Element | null): Element | null {
  if (typeof document === 'undefined') return null;
  return root?.closest('[data-variant]') ?? document.querySelector('[data-variant]');
}

/**
 * The motion attributes of `root`'s presentation boundary, or the page's
 * when there's no root: null on the server and in the first client render,
 * then read in the render that knows the page has mounted, and kept up to
 * date as a preview's environment changes them.
 */
export function useBoundaryMotion(root: Element | null): BoundaryMotion | null {
  const subscribe = useCallback(
    (change: () => void) => {
      const element = boundaryOf(root);
      if (!element) return () => {};
      const observer = new MutationObserver(change);
      observer.observe(element, {
        attributes: true,
        attributeFilter: ['data-motion-policy', 'data-motion'],
      });
      return () => observer.disconnect();
    },
    [root],
  );
  return boundaryFrom(
    useSyncExternalStore(
      subscribe,
      () => boundaryKey(boundaryOf(root)),
      () => null,
    ),
  );
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
  const [observed, setObserved] = useState<{ root: Element; intersecting: boolean } | null>(null);
  // The boundary's motion, as the server rendered it and as a preview changes
  // it, read in the same render that knows the page has mounted: until it's
  // read, the runtime stays pending, so no effect runs one commit under a
  // site's or a preview's reduce.
  const boundary = useBoundaryMotion(root);
  const [failed, setFailed] = useState(false);
  const provided = useProvidedMotionPolicy();
  // Any one policy at `reduce` reduces: none can undo another's.
  const policy =
    options.motionPolicy === 'reduce' || provided === 'reduce'
      ? 'reduce'
      : (boundary?.policy ?? null);

  // In view, both ways, for as long as the effect is mounted. An effect
  // with no root, or a browser with no IntersectionObserver, counts as in
  // view; a root counts as out of view until its observer first reports.
  const observable = root !== null && typeof IntersectionObserver !== 'undefined';
  const intersecting = !observable || (observed?.root === root && observed.intersecting);
  useEffect(() => {
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        if (entry) setObserved({ root, intersecting: entry.isIntersecting });
      },
      { rootMargin },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, [root, rootMargin]);

  const status = resolveRuntime({
    mounted,
    boundaryRead: boundary !== null,
    osReduced: inputs.osReduced,
    policy,
    environmentMotion: boundary?.motion ?? null,
    documentVisible: inputs.documentVisible,
    intersecting,
    visitorPaused: inputs.visitorPaused,
    lifecycle: inputs.lifecycle,
    failed,
  });
  const reduced = motionReduced({
    osReduced: inputs.osReduced,
    policy,
    environmentMotion: boundary?.motion ?? null,
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
    if (status.state === 'active') root.removeAttribute('data-activity');
    else root.setAttribute('data-activity', 'paused');
  }, [root, status.state]);

  return {
    ...status,
    eligible,
    inView: mounted && intersecting,
    attachRoot: setRoot,
    fail: () => setFailed(true),
  };
}
