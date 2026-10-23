export * from './cn';
export * from './format';
// By the package's name, so React Server Components get the post-pass (markdown.server.ts).
export * from '@portfolio/kit/markdown';
export * from './motion';
export * from './pretext';
export * from './nav';
export { TypingAnimation, type TypingAnimationProps } from './typing-animation';
export { AnimatedCounter, type AnimatedCounterProps } from './animated-counter';

export type {
  Portfolio,
  Section,
  SectionKind,
  MotionPolicy,
  Identity,
  Link,
  Placement,
  Period,
} from '@portfolio/schema';
