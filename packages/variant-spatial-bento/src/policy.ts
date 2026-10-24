import type { RuntimeReason, RuntimeState } from '@portfolio/kit/runtime';

// The spatial stage's capability policy (#16): whether the stage may run,
// from what the page and the browser say, never from who the browser is. It
// reads no user agent, renderer string, WEBGL_debug_renderer_info, or
// battery. Each reason is a way it stays off, in the order they're checked,
// and anything that stops it wins over anything that would start it: the
// visitor's exit, the kit runtime's state (reduced motion from the OS, the
// site, or a preview, a failure, a preview frame out of focus, a hidden page,
// the stage offscreen), forced colors, more contrast, a high-contrast
// display, a preview that turns enhancements off, WebGL2 and the width the
// stage needs, the device's memory and cores where it says, the visitor
// asking to save data, and one stage a document. Nothing here can turn it on
// against any of them: a policy of `full` that the old schema had doesn't
// exist, and the runtime counts only what reduces motion.
//
// The stage mounts only once the runtime is active, so only a focused,
// visible #7 frame starts it. Paused after that, by a hidden page, the stage
// offscreen, the visitor's pause, or a preview frame, it stays mounted with
// no frame rendering; anything static unmounts it, back to the still.

export interface StageSignals {
  /** The kit runtime's state and reason, with the stage's requirements, `webgl2` and `min-width:768`. */
  readonly state: RuntimeState;
  readonly reason: RuntimeReason;
  readonly eligible: boolean;
  /** `(forced-colors: active)`. */
  readonly forcedColors: boolean;
  /** `(prefers-contrast: more)`, or the boundary's `data-contrast="more"`. */
  readonly moreContrast: boolean;
  /** The boundary's `data-display-mode="high-contrast"`. */
  readonly highContrast: boolean;
  /** The boundary's `data-enhancement`, which a preview's environment turns off. */
  readonly enhancement: 'on' | 'off';
  /** `navigator.deviceMemory`, in GiB, where the browser says. */
  readonly deviceMemory: number | null;
  /** `navigator.hardwareConcurrency`, where the browser says. */
  readonly cores: number | null;
  /** `navigator.connection.saveData`, where the browser says. */
  readonly saveData: boolean;
  /** This page's stage failed already: it stays off for the rest of the page. */
  readonly failed: boolean;
  /** The visitor turned it off with the exit control. */
  readonly exited: boolean;
  /** Whether this stage is the document's one live stage. */
  readonly claimed: boolean;
  /** Whether it has started already, so a pause holds it rather than ending it. */
  readonly started: boolean;
}

export type StageReason =
  | 'running'
  | 'paused'
  | 'exited'
  | 'pending'
  | 'reduced'
  | 'failed'
  | 'lifecycle'
  | 'forced-colors'
  | 'contrast'
  | 'preview-off'
  | 'unsupported'
  | 'low-memory'
  | 'low-power'
  | 'save-data'
  | 'another-stage'
  | 'waiting';

export interface StageDecision {
  /** Whether the stage is mounted: running, or paused after it started. */
  readonly mount: boolean;
  /** Whether the exit control shows: the stage runs, or could, if the visitor hadn't left it. */
  readonly offered: boolean;
  readonly reason: StageReason;
}

/** The least memory and the fewest cores a stage runs on, where the browser says. */
export const MIN_DEVICE_MEMORY = 4;
export const MIN_CORES = 4;

const off = (reason: StageReason, offered = false): StageDecision => ({
  mount: false,
  offered,
  reason,
});

/** What the stage does, from its signals. Pure, so each path is tested on its own. */
export function decideStage(signals: StageSignals): StageDecision {
  if (signals.failed) return off('failed');
  if (signals.state === 'static') {
    return off(
      signals.reason === 'reduced' ? 'reduced' : signals.reason === 'failed' ? 'failed' : 'pending',
    );
  }
  if (signals.forcedColors) return off('forced-colors');
  if (signals.moreContrast || signals.highContrast) return off('contrast');
  if (signals.enhancement === 'off') return off('preview-off');
  if (!signals.eligible) return off('unsupported');
  if (signals.deviceMemory !== null && signals.deviceMemory < MIN_DEVICE_MEMORY) {
    return off('low-memory');
  }
  if (signals.cores !== null && signals.cores < MIN_CORES) return off('low-power');
  if (signals.saveData) return off('save-data');
  if (!signals.claimed) return off('another-stage');
  // From here the stage could run, so the visitor's exit shows.
  if (signals.exited) return off('exited', true);
  if (signals.state === 'active') return { mount: true, offered: true, reason: 'running' };
  // Paused: a stage that started holds still; one that hasn't waits for the runtime to be active.
  if (signals.started) return { mount: true, offered: true, reason: 'paused' };
  return off(signals.reason === 'lifecycle' ? 'lifecycle' : 'waiting', true);
}
