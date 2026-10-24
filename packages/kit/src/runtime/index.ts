// @portfolio/kit/runtime (#6, items 6 and 7): the one runtime every kit
// effect and enhancement runs on. It pauses when the document is hidden,
// the effect's root is offscreen, the visitor pauses motion, or a preview
// frame is hidden or out of focus, and stays static under reduced motion,
// before the page knows its preference, and after a failure.

export { MotionControl, MOTION_CONTROL_STATUS } from './motion-control';
export type { MotionControlProps, MotionControlStatus } from './motion-control';
export { useEnhancementRuntime } from './use-runtime';
export type { EnhancementRuntime, RuntimeOptions } from './use-runtime';
export { useFrameLoop } from './use-frame-loop';
export { runtimeAnimation } from './animation';
export type { RuntimeAnimation } from './animation';
export type { FrameCallback } from './use-frame-loop';
export type { LifecycleInput, RuntimeReason, RuntimeState } from './state';
// #7's lifecycle as the runtime reads it, for an enhancement that keeps its own state in a frame.
export { LIFECYCLE_EVENT as PREVIEW_LIFECYCLE_EVENT, previewLifecycle } from './store';
