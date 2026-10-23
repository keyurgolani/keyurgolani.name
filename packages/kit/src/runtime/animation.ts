// A CSS animation on the runtime (#6, items 6 and 7): the inline style an
// effect gives the element that animates, from its runtime's state. Static,
// there's no animation at all, so the server and reduced motion show the
// still. Paused, it keeps its place and its play-state is paused right on
// the element, since an inline `animation` shorthand would reset the
// play-state and beat experience-base.css's pause rule. Active, it runs.
// Every kit effect that animates inline goes through it.

import type { CSSProperties } from 'react';
import type { RuntimeState } from './state';

export interface RuntimeAnimation {
  /** The @keyframes name. */
  readonly name: string;
  /** One cycle, in seconds. */
  readonly seconds: number;
  /** Default `linear`. */
  readonly timing?: string;
}

/** The longhands that run `animation` forever while `state` is active, and hold it otherwise. */
export function runtimeAnimation(state: RuntimeState, animation: RuntimeAnimation): CSSProperties {
  if (state === 'static') return {};
  return {
    animationName: animation.name,
    animationDuration: `${animation.seconds}s`,
    animationTimingFunction: animation.timing ?? 'linear',
    animationIterationCount: 'infinite',
    animationPlayState: state === 'active' ? 'running' : 'paused',
  };
}
