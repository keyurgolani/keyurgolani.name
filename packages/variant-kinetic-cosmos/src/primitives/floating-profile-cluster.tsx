'use client';

import { motion } from 'framer-motion';
import { useState } from 'react';
import type { Link as PortfolioLink } from '@portfolio/schema';
import { useMotionPreference } from '@portfolio/kit';
import { useFirstInteraction, useScrollDispersal } from '@portfolio/kit/motion-fx';
import {
  getSocialBrandStyle,
  inferPlatformFromUrl,
} from '@portfolio/kit/social-brand';

interface FloatingProfileClusterProps {
  links: PortfolioLink[];
  /** Maximum number of profile cards to render. Default 5. */
  limit?: number;
}

/**
 * Anchored brand-colored profile cards that orbit around the hero. Each
 * card is pinned at a viewport-relative percent and disperses outward
 * radially as the user scrolls past — kit's `useScrollDispersal` does the
 * spring math.
 *
 * Cards mount invisible until the user's first interaction
 * (`useFirstInteraction`) so the very first paint isn't cluttered.
 *
 * Drag is enabled via framer-motion's drag prop; momentum is suppressed
 * for a "stick where you let go" feel that page-zero used.
 */
export function FloatingProfileCluster({ links, limit = 5 }: FloatingProfileClusterProps) {
  const reduce = useMotionPreference() === 'reduce';
  const interacted = useFirstInteraction();

  const usable = links
    .filter((link) => /^https?:\/\//i.test(link.url))
    .filter((link) => {
      const platform = (link.platform ?? '').toLowerCase();
      // Exclude things that don't visually map to a brand card.
      return !['resume', 'website', 'cv'].includes(platform);
    })
    .slice(0, limit);

  if (usable.length === 0) return null;

  // Pre-baked positions distributed around the hero center.
  const POSITIONS: Array<{ x: string; y: string; rotation: string; multiplier: number; delay: number }> = [
    { x: '12%', y: '22%', rotation: '-6deg', multiplier: 1.0, delay: 0.1 },
    { x: '85%', y: '18%', rotation: '7deg', multiplier: 1.1, delay: 0.18 },
    { x: '8%', y: '70%', rotation: '5deg', multiplier: 1.2, delay: 0.28 },
    { x: '88%', y: '72%', rotation: '-7deg', multiplier: 1.05, delay: 0.36 },
    { x: '15%', y: '45%', rotation: '-3deg', multiplier: 0.95, delay: 0.42 },
  ];

  return (
    <>
      {usable.map((link, i) => {
        const position = POSITIONS[i % POSITIONS.length]!;
        const platform =
          link.platform?.toLowerCase() ?? inferPlatformFromUrl(link.url) ?? 'default';
        return (
          <FloatingProfile
            key={`${link.url}-${i}`}
            link={link}
            platform={platform}
            position={position}
            visible={interacted}
            reduceMotion={reduce}
          />
        );
      })}
    </>
  );
}

interface FloatingProfileProps {
  link: PortfolioLink;
  platform: string;
  position: { x: string; y: string; rotation: string; multiplier: number; delay: number };
  visible: boolean;
  reduceMotion: boolean;
}

function FloatingProfile({
  link,
  platform,
  position,
  visible,
  reduceMotion,
}: FloatingProfileProps) {
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);

  const dispersal = useScrollDispersal({
    position: { x: position.x, y: position.y },
    multiplier: position.multiplier,
    enabled: !reduceMotion,
  });

  const style = getSocialBrandStyle(platform);
  const label = link.label ?? style.name;

  return (
    <motion.div
      className="kc-floater"
      style={{
        left: position.x,
        top: position.y,
        x: dispersal.x,
        y: dispersal.y,
        opacity: dispersal.opacity,
        scale: dispersal.scale,
        rotate: position.rotation,
      }}
      initial={{ opacity: 0, scale: 0, y: 30 }}
      animate={{
        opacity: visible ? 1 : 0,
        scale: visible ? (dragging ? 1.08 : 1) : 0,
        y: visible ? 0 : 30,
      }}
      transition={{
        opacity: { delay: visible ? position.delay : 0, duration: 0.6 },
        scale: { duration: 0.2 },
        y: {
          delay: visible ? position.delay : 0,
          duration: 0.7,
          type: 'spring',
          stiffness: 80,
        },
      }}
      whileHover={!dragging ? { scale: 1.08, transition: { duration: 0.25 } } : undefined}
      drag={!reduceMotion}
      dragMomentum={false}
      dragElastic={0}
      onDragStart={() => setDragging(true)}
      onDragEnd={() => setDragging(false)}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      data-dragging={dragging || undefined}
    >
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="kc-floater__card"
        aria-label={`Visit ${label}`}
        onClick={(e) => {
          if (dragging) e.preventDefault();
        }}
        style={{
          background: style.gradient,
          boxShadow: `0 10px 30px ${style.glow}, 0 0 0 1px rgba(255,255,255,0.1) inset`,
        }}
      >
        {style.pattern ? (
          <div
            className="kc-floater__pattern"
            style={{ background: style.pattern }}
            aria-hidden="true"
          />
        ) : null}

        <motion.div
          className="kc-floater__hover-glow"
          animate={{ opacity: hovered ? 0.35 : 0 }}
          transition={{ duration: 0.3 }}
          style={{
            background: `radial-gradient(circle at 50% 50%, ${style.accent} 0%, transparent 70%)`,
          }}
          aria-hidden="true"
        />

        <motion.div
          className="kc-floater__shimmer"
          animate={!reduceMotion ? { opacity: [0, 0.18, 0], x: ['-100%', '100%', '100%'] } : undefined}
          transition={{ duration: 3, repeat: Infinity, repeatDelay: 4, ease: 'easeInOut' }}
          aria-hidden="true"
        />

        <div className="kc-floater__content">
          <div
            className="kc-floater__icon"
            style={{ background: style.iconBg }}
          >
            <FloaterGlyph platform={platform} />
          </div>
          <span className="kc-floater__label">{label}</span>
        </div>

        <span
          className="kc-floater__corner"
          aria-hidden="true"
          style={{ backgroundColor: style.accent }}
        />
      </a>
    </motion.div>
  );
}

/**
 * Minimal inline SVG glyphs per platform. Avoids pulling lucide-react for
 * something this small; each path is the brand's signature mark scaled to
 * a 24×24 viewBox.
 */
function FloaterGlyph({ platform }: { platform: string }) {
  switch (platform) {
    case 'github':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.7.3 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3" />
        </svg>
      );
    case 'linkedin':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M20.5 2h-17A1.5 1.5 0 0 0 2 3.5v17A1.5 1.5 0 0 0 3.5 22h17a1.5 1.5 0 0 0 1.5-1.5v-17A1.5 1.5 0 0 0 20.5 2zM8 19H5v-9h3v9zM6.5 8.25A1.75 1.75 0 1 1 8.3 6.5a1.78 1.78 0 0 1-1.8 1.75zM19 19h-3v-4.74c0-1.42-.6-1.93-1.38-1.93A1.74 1.74 0 0 0 13 14.19V19h-3v-9h2.9v1.3a3.11 3.11 0 0 1 2.7-1.4c1.55 0 3.36.86 3.36 3.66z" />
        </svg>
      );
    case 'dockerhub':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M13.98 11.08h2.12a.19.19 0 0 0 .19-.19V9.01a.19.19 0 0 0-.19-.19h-2.12a.19.19 0 0 0-.19.19v1.88c0 .1.08.19.19.19m-2.95-5.43h2.12a.19.19 0 0 0 .19-.19V3.57a.19.19 0 0 0-.19-.19h-2.12a.19.19 0 0 0-.19.19v1.89c0 .1.09.19.19.19m0 2.72h2.12a.19.19 0 0 0 .19-.19V6.29a.19.19 0 0 0-.19-.19h-2.12a.19.19 0 0 0-.19.19v1.89c0 .1.09.18.19.19m-2.93 0h2.12a.19.19 0 0 0 .19-.19V6.29a.19.19 0 0 0-.19-.19H8.1a.19.19 0 0 0-.19.19v1.89c0 .1.08.18.19.19m-2.96 0h2.12a.19.19 0 0 0 .19-.19V6.29a.19.19 0 0 0-.19-.19H5.14a.19.19 0 0 0-.19.19v1.89c0 .1.08.18.19.19m5.89 2.71h2.12a.19.19 0 0 0 .19-.19V9.01a.19.19 0 0 0-.19-.19h-2.12a.19.19 0 0 0-.19.19v1.88c0 .1.08.19.19.19m-2.93 0h2.12a.19.19 0 0 0 .19-.19V9.01a.19.19 0 0 0-.19-.19H8.1a.19.19 0 0 0-.19.19v1.88c0 .1.09.19.19.19m-2.96 0h2.12a.19.19 0 0 0 .19-.19V9.01a.19.19 0 0 0-.19-.19H5.14a.19.19 0 0 0-.19.19v1.88c0 .1.09.19.19.19m-2.92 0h2.12a.19.19 0 0 0 .19-.19V9.01a.19.19 0 0 0-.19-.19h-2.12a.19.19 0 0 0-.19.19v1.88c0 .1.09.19.19.19m20.84-1.11c-.06-.05-.67-.51-1.95-.51-.34 0-.68.03-1.01.08-.25-1.7-1.66-2.53-1.72-2.56l-.34-.2-.23.33c-.28.44-.49.92-.61 1.43-.23.97-.09 1.88.4 2.66-.59.33-1.55.41-1.74.42H.75a.75.75 0 0 0-.75.75 11.4 11.4 0 0 0 .69 4.06c.55 1.43 1.36 2.48 2.41 3.13 1.18.72 3.1 1.13 5.28 1.13.98 0 1.96-.09 2.93-.27a12.2 12.2 0 0 0 3.82-1.39c.98-.57 1.86-1.29 2.61-2.13 1.25-1.42 2-3 2.55-4.4h.22c1.37 0 2.21-.55 2.68-1.01.31-.29.55-.65.71-1.05l.1-.29z" />
        </svg>
      );
    case 'researchgate':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M19.586 0c-.818 0-1.358.183-1.638.41-.562.451-.808 1.184-.808 2.158 0 .974.246 1.706.808 2.158.28.226.82.41 1.638.41.819 0 1.358-.184 1.638-.41.562-.452.808-1.184.808-2.158 0-.974-.246-1.707-.808-2.158C20.944.183 20.405 0 19.586 0zM4.227 1.5C2.435 1.5 1.5 2.39 1.5 4.183v15.634c0 1.793.935 2.683 2.727 2.683h15.546c1.792 0 2.727-.89 2.727-2.683V8.317h-3.3v11.5H4.8V4.183h11.5v-3.3H4.227zm6.318 7.74H8.954v6.97h1.591V12.4h.045l3.682 3.81h2.227l-3.954-4 3.682-3.97H14l-3.41 3.46h-.045z" />
        </svg>
      );
    case 'instagram':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85 0 3.2-.01 3.58-.07 4.85-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07-3.2 0-3.58-.01-4.85-.07-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85 0-3.2.01-3.58.07-4.85.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.34 4.14.63a5.85 5.85 0 0 0-2.13 1.39A5.85 5.85 0 0 0 .63 4.14C.34 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.27 2.15.56 2.91a5.85 5.85 0 0 0 1.39 2.13c.66.65 1.32 1.06 2.13 1.39.76.29 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.27 2.91-.56a5.85 5.85 0 0 0 2.13-1.39c.65-.66 1.06-1.32 1.39-2.13.29-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.27-2.15-.56-2.91a5.85 5.85 0 0 0-1.39-2.13A5.85 5.85 0 0 0 19.86.63C19.1.34 18.22.13 16.95.07 15.67.01 15.26 0 12 0zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.4-11.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88z" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M14 3h7v7h-2V6.4l-9.3 9.3-1.4-1.4L17.6 5H14V3zM5 5h6v2H7v10h10v-4h2v6H5V5z" />
        </svg>
      );
  }
}
