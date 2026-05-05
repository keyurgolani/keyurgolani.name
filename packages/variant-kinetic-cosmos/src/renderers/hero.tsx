'use client';

import { motion } from 'framer-motion';
import type { Hero, Identity } from '@portfolio/schema';
import { ensureSectionId, TypingAnimation } from '@portfolio/kit';
import { ActionLink } from '../primitives/action-link';
import { FloatingProfileCluster } from '../primitives/floating-profile-cluster';
import type { Link as PortfolioLink } from '@portfolio/schema';

interface HeroProps {
  section: Hero;
  identity: Identity;
  links?: PortfolioLink[];
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.15, delayChildren: 0.2 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
};

/**
 * Hero — gradient name, optional typing-animation under the name (drawn
 * from the subtagline split on " / "), CTA cluster.
 *
 * The original page-zero hero had a `roles[]` array driving the typing
 * animation. The new schema doesn't model that, so we treat
 * `subtagline` as a single line and split it on " / " or " · " to
 * produce a roles list. If only one phrase is present, no typing animation.
 */
export function HeroRenderer({ section, identity, links = [] }: HeroProps) {
  const id = ensureSectionId(section.id, 'top');
  const name = section.name ?? identity.name;
  const tagline = section.tagline ?? identity.tagline;
  const subtaglineRoles = (section.subtagline ?? '')
    .split(/\s*(?:\/|·|•)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  const hasTyping = subtaglineRoles.length > 1;

  return (
    <section id={id} className="kc-hero" aria-label="Hero section">
      <FloatingProfileCluster links={links} />
      <motion.div
        className="kc-hero__inner"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {section.greeting ? (
          <motion.p variants={itemVariants} className="kc-hero__greeting">
            {section.greeting}
          </motion.p>
        ) : null}
        {name ? (
          <motion.h1 variants={itemVariants} className="kc-hero__name">
            <span className="kc-hero__name-gradient">{name}</span>
          </motion.h1>
        ) : null}
        {hasTyping ? (
          <motion.div variants={itemVariants} className="kc-hero__roles">
            <TypingAnimation texts={subtaglineRoles} />
          </motion.div>
        ) : section.subtagline ? (
          <motion.p variants={itemVariants} className="kc-hero__subtagline">
            {section.subtagline}
          </motion.p>
        ) : null}
        {tagline ? (
          <motion.p variants={itemVariants} className="kc-hero__tagline">
            {tagline}
          </motion.p>
        ) : null}
        {(identity.location || identity.email) && (
          <motion.div variants={itemVariants} className="kc-hero__meta">
            {identity.location ? (
              <span className="kc-hero__meta-item">{identity.location}</span>
            ) : null}
            {identity.email ? (
              <a className="kc-hero__meta-item" href={`mailto:${identity.email}`}>
                {identity.email}
              </a>
            ) : null}
          </motion.div>
        )}
        {section.ctas && section.ctas.length > 0 ? (
          <motion.div variants={itemVariants} className="kc-hero__ctas">
            {section.ctas.map((cta, i) => (
              <ActionLink
                key={`${cta.url}-${i}`}
                link={cta}
                variant={i === 0 ? 'primary' : 'ghost'}
                size="lg"
              />
            ))}
          </motion.div>
        ) : null}
      </motion.div>
    </section>
  );
}
