'use client';

import type { ReactNode } from 'react';
import { MotionConfig } from 'framer-motion';
import type { MotionPolicy } from '@portfolio/schema';

/**
 * framer-motion animates through the Web Animations API and its own frame
 * loop, which the stylesheet's reduced-motion rules never reach. Under the
 * site's `reduce` policy it skips every transform and layout animation, and
 * under `respect-os` it does so when the visitor's setting asks. Opacity and
 * the like still animate, so components gate those on useMotionPreference().
 */
export function KineticMotionConfig({
  policy,
  children,
}: {
  policy: MotionPolicy;
  children: ReactNode;
}) {
  return (
    <MotionConfig reducedMotion={policy === 'reduce' ? 'always' : 'user'}>{children}</MotionConfig>
  );
}
