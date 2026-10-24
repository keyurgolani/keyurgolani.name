// The enhancement runtime's state (#6, items 6 and 7): what decides whether
// an effect runs. Pure, so the inputs a browser gives it can be tested one by
// one; store.ts reads them from the document and use-runtime.ts from each
// effect's root.
//
//   static   it never ran or must not: before the page knows its motion
//            preference, under reduced motion, or after a failure
//   paused   it may run, but not now: the document is hidden, the root is
//            offscreen, the visitor paused motion, or a preview frame is
//            hidden or out of focus
//   active   it runs

export type RuntimeState = 'active' | 'paused' | 'static';

export type RuntimeReason =
  /** Server render and the first client render, before any input is known. */
  | 'pending'
  /** The OS asks for reduced motion, or the site's policy or a preview's environment reduces it. */
  | 'reduced'
  /** The effect failed and tore down to the server markup. */
  | 'failed'
  /** A preview frame Studio says is hidden or out of focus (#7's lifecycle). */
  | 'lifecycle'
  /** The document is hidden. */
  | 'hidden'
  /** The effect's root is outside the viewport and its margin. */
  | 'offscreen'
  /** The visitor paused motion with MotionControl. */
  | 'visitor'
  /** Nothing stops it. */
  | 'running';

/** The last lifecycle #7's preview agent dispatched, or null outside a connected preview frame. */
export interface LifecycleInput {
  readonly state: 'visible' | 'hidden';
  readonly focused: boolean;
}

export interface RuntimeInputs {
  /** False on the server and in the first client render. */
  readonly mounted: boolean;
  /** Whether the boundary's data-motion has been read. */
  readonly boundaryRead: boolean;
  /** `prefers-reduced-motion: reduce`. */
  readonly osReduced: boolean;
  /** The effect's own motion policy, or a MotionPolicyProvider's: `reduce` reduces it. */
  readonly policy: string | null;
  /**
   * The boundary's data-motion: `full`, or `reduced` or `static`, which both
   * reduce it. It's `reduced` under the site's `reduce` policy and a
   * preview's reduced environment (#19, Slice 4).
   */
  readonly environmentMotion: string | null;
  readonly documentVisible: boolean;
  /** Whether the effect's root is within the viewport and its margin. */
  readonly intersecting: boolean;
  readonly visitorPaused: boolean;
  readonly lifecycle: LifecycleInput | null;
  readonly failed: boolean;
}

export interface RuntimeStatus {
  readonly state: RuntimeState;
  readonly reason: RuntimeReason;
}

/** Whether motion is reduced: the stricter of the OS, the site's policy, and a preview's environment wins. */
export function motionReduced(
  inputs: Pick<RuntimeInputs, 'osReduced' | 'policy' | 'environmentMotion'>,
): boolean {
  return (
    inputs.osReduced ||
    inputs.policy === 'reduce' ||
    inputs.environmentMotion === 'reduced' ||
    inputs.environmentMotion === 'static'
  );
}

/**
 * The runtime's state from its inputs. Motion can only be lowered: each
 * input can stop an effect, and none can start one another stopped. Before
 * the page knows its preference, it's static.
 */
export function resolveRuntime(inputs: RuntimeInputs): RuntimeStatus {
  if (!inputs.mounted || !inputs.boundaryRead) return { state: 'static', reason: 'pending' };
  if (motionReduced(inputs)) return { state: 'static', reason: 'reduced' };
  if (inputs.failed) return { state: 'static', reason: 'failed' };
  if (inputs.lifecycle && !(inputs.lifecycle.state === 'visible' && inputs.lifecycle.focused)) {
    return { state: 'paused', reason: 'lifecycle' };
  }
  if (!inputs.documentVisible) return { state: 'paused', reason: 'hidden' };
  if (!inputs.intersecting) return { state: 'paused', reason: 'offscreen' };
  if (inputs.visitorPaused) return { state: 'paused', reason: 'visitor' };
  return { state: 'active', reason: 'running' };
}

/** What the runtime is before anything is known: on the server and in the first client render. */
export const PENDING: RuntimeStatus = Object.freeze({ state: 'static', reason: 'pending' });
