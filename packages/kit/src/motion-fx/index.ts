/**
 * Motion-fx hooks — framer-motion-backed interaction primitives shared
 * across kinetic variants. Lives behind a sub-path so light-tier variants
 * (editorial et al.) don't pull framer-motion into their bundles.
 *
 * framer-motion is an optional peer dependency of @portfolio/kit; importing
 * from this sub-path requires the consumer to have framer-motion installed.
 */

export {
  useScrollVelocityInertia,
  type ScrollVelocityInertiaOptions,
  type ScrollVelocityInertiaValues,
} from './use-scroll-velocity-inertia';

export {
  useMouseTilt,
  type MouseTiltOptions,
  type MouseTiltValues,
} from './use-mouse-tilt';

export {
  useViewportCenterActive,
  type ViewportCenterActiveOptions,
  type ViewportCenterActive,
} from './use-viewport-center-active';

export {
  useFirstInteraction,
  type FirstInteractionOptions,
} from './use-first-interaction';

export {
  useScrollDispersal,
  type ScrollDispersalOptions,
  type ScrollDispersalValues,
} from './use-scroll-dispersal';
