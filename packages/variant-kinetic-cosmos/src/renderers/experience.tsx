'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Portfolio } from '@portfolio/schema';
import { motion, AnimatePresence } from 'framer-motion';
import { ensureSectionId, formatDate } from '@portfolio/kit';
import {
  TimelineAxis,
  TimelineBranch,
  maxSlot,
  type LaneAssignment,
} from '@portfolio/kit/timeline';
import {
  useMouseTilt,
  useViewportCenterActive,
} from '@portfolio/kit/motion-fx';
import { useMotionTemplate } from 'framer-motion';
import { buildTimelineLayout, type TimelineEvent, type TimelineEventKind } from '../lib/timeline-events';

interface ExperienceProps {
  portfolio: Portfolio;
  /** The host section (used for id + title chrome). */
  section: { id?: string; title?: string; subtitle?: string };
}

const KIND_HUE: Record<TimelineEventKind, { h: number; s: number; l: number; label: string }> = {
  job:        { h: 174, s: 80, l: 45, label: 'Job' },
  internship: { h: 142, s: 71, l: 45, label: 'Intern' },
  study:      { h: 217, s: 91, l: 60, label: 'Study' },
  research:   { h: 262, s: 80, l: 66, label: 'Research' },
  project:    { h: 38,  s: 92, l: 50, label: 'Project' },
  award:      { h: 45,  s: 96, l: 55, label: 'Award' },
  life:       { h: 239, s: 84, l: 67, label: 'Life' },
};

const COLLAPSED_W = 240;
const COLLAPSED_H = 72;
const EXPANDED_W = 360;
const EXPANDED_H = 200;

interface PositionedEvent extends LaneAssignment<TimelineEvent> {
  x: number;
  startY: number;
  endY: number;
  hue: number;
  saturation: number;
  lightness: number;
  lineColor: string;
}

export function ExperienceRenderer({ portfolio, section }: ExperienceProps) {
  const id = ensureSectionId(section.id, section.title ?? 'experience');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [viewportWidth, setViewportWidth] = useState(1280);
  const containerRef = useRef<HTMLDivElement>(null);

  const layout = useMemo(() => buildTimelineLayout(portfolio, { topPadding: 140 }), [portfolio]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setViewportWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const positioned = useMemo<PositionedEvent[]>(() => {
    if (layout.events.length === 0) return [];
    const max = maxSlot(layout.assignments);
    const padX = 24;
    const halfW = viewportWidth / 2;
    const branchSpace = Math.max(40, halfW - EXPANDED_W - padX - 20);
    const slotGap = (max > 0 ? Math.min(branchSpace / max, 200) : 200) * 0.75;
    const baseOffset = Math.max(slotGap, 100);
    const centerX = viewportWidth / 2;

    return layout.assignments.map((a) => {
      const visuals = KIND_HUE[a.event.kind];
      const dir = a.side === 'right' ? 1 : -1;
      const x = centerX + dir * (baseOffset + (a.slot - 1) * slotGap);
      const startY = layout.projection.tsToY.get(a.event.endTs) ?? 0;
      const endY = layout.projection.tsToY.get(a.event.startTs) ?? startY;
      return {
        ...a,
        x,
        startY,
        endY,
        hue: visuals.h,
        saturation: visuals.s,
        lightness: visuals.l,
        lineColor: `hsl(${visuals.h}, ${visuals.s}%, ${visuals.l}%)`,
      };
    });
  }, [layout, viewportWidth]);

  const centerX = viewportWidth / 2;
  const totalHeight = layout.projection.height + 200;
  const activeId = expandedId ?? hoveredId;

  const toggle = useCallback((eventId: string) => {
    setExpandedId((prev) => (prev === eventId ? null : eventId));
  }, []);

  if (positioned.length === 0) {
    // No data to plot — render a heading + a friendly empty state.
    return (
      <section id={id} className="kc-timeline">
        <div className="kc-timeline__header">
          <h2 className="kc-timeline__title">{section.title ?? 'Timeline'}</h2>
          {section.subtitle ? <p className="kc-timeline__subtitle">{section.subtitle}</p> : null}
          <p className="kc-timeline__empty">No dated entries yet.</p>
        </div>
      </section>
    );
  }

  return (
    <section
      id={id}
      ref={containerRef}
      className="kc-timeline"
      onClick={() => setExpandedId(null)}
    >
      <div className="kc-timeline__header">
        <h2 className="kc-timeline__title">{section.title ?? 'Timeline Odyssey'}</h2>
        <p className="kc-timeline__subtitle">
          {section.subtitle ?? 'A merged chronology of work, study, research, and recognition.'}
        </p>
      </div>

      <div className="kc-timeline__canvas" style={{ height: totalHeight }}>
        <svg
          width={viewportWidth}
          height={totalHeight}
          viewBox={`0 0 ${viewportWidth} ${totalHeight}`}
          className="kc-timeline__svg"
        >
          <defs>
            {positioned.map((p) => (
              <linearGradient
                key={`grad-${p.event.id}`}
                id={`grad-${p.event.id}`}
                x1="0%" y1="0%" x2="0%" y2="100%"
              >
                <stop offset="0%" stopColor={p.lineColor} stopOpacity="0.2" />
                <stop offset="100%" stopColor={p.lineColor} stopOpacity="0.9" />
              </linearGradient>
            ))}
          </defs>

          <TimelineAxis
            centerX={centerX}
            topY={120}
            bottomY={totalHeight - 60}
            stroke="var(--kc-rule-strong)"
            strokeWidth={2}
          />

          <PresentNode y={120} centerX={centerX} />

          {positioned.map((p) => {
            const dim = activeId !== null && activeId !== p.event.id;
            const branchWidth = Math.max(1.5, 4 - p.slot * 0.8);
            const forkStroke = `url(#grad-${p.event.id})`;
            const mergeStroke = `url(#grad-${p.event.id})`;
            const trunkStroke = p.lineColor;
            const strokeFor: Record<'fork' | 'trunk' | 'merge', string> = {
              fork: forkStroke,
              trunk: trunkStroke,
              merge: mergeStroke,
            };
            return (
              <g key={`branch-${p.event.id}`} opacity={dim ? 0.3 : 1}>
                <TimelineBranch
                  centerX={centerX}
                  branchX={p.x}
                  startY={p.startY}
                  endY={p.endY}
                  forkStroke={forkStroke}
                  trunkStroke={trunkStroke}
                  mergeStroke={mergeStroke}
                  strokeWidth={branchWidth}
                  opacity={activeId === p.event.id ? 1 : 0.85}
                  renderSegment={({ d, segment }) => (
                    <motion.path
                      d={d}
                      stroke={strokeFor[segment]}
                      strokeWidth={branchWidth}
                      strokeLinecap="round"
                      fill="none"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 1.2, ease: 'easeOut' }}
                    />
                  )}
                />
              </g>
            );
          })}

          {positioned.map((p) => (
            <EventCard
              key={`card-${p.event.id}`}
              positioned={p}
              expanded={expandedId === p.event.id}
              isActive={activeId === p.event.id}
              isAnyActive={activeId !== null}
              onToggle={() => toggle(p.event.id)}
              onHoverStart={() => setHoveredId(p.event.id)}
              onHoverEnd={() => setHoveredId((prev) => (prev === p.event.id ? null : prev))}
            />
          ))}
        </svg>
      </div>
    </section>
  );
}

function PresentNode({ y, centerX }: { y: number; centerX: number }) {
  return (
    <g transform={`translate(${centerX}, ${y})`} className="kc-timeline__present">
      <title>Present Day</title>
      <motion.circle
        r={14}
        fill="transparent"
        stroke="var(--kc-primary)"
        strokeWidth={1}
        initial={{ scale: 0.8, opacity: 0.8 }}
        animate={{ scale: 1.8, opacity: 0 }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
      />
      <circle r={6} fill="var(--kc-paper)" stroke="var(--kc-primary)" strokeWidth={2} />
      <circle r={2.5} fill="var(--kc-primary)" />
      <text
        x={20}
        y={4}
        fill="var(--kc-primary)"
        className="kc-timeline__present-label"
      >
        PRESENT
      </text>
    </g>
  );
}

interface EventCardProps {
  positioned: PositionedEvent;
  expanded: boolean;
  isActive: boolean;
  isAnyActive: boolean;
  onToggle: () => void;
  onHoverStart: () => void;
  onHoverEnd: () => void;
}

function EventCard({
  positioned: p,
  expanded,
  isActive,
  isAnyActive,
  onToggle,
  onHoverStart,
  onHoverEnd,
}: EventCardProps) {
  const { ref: viewportRef, isActive: inCenter } = useViewportCenterActive();
  const tilt = useMouseTilt({ maxDegrees: 5, enabled: expanded });
  const hoverGlow = useMotionTemplate`radial-gradient(360px circle at ${tilt.mouseX}px ${tilt.mouseY}px, hsla(${p.hue}, ${p.saturation}%, ${p.lightness}%, 0.18), transparent 80%)`;
  const event = p.event;
  const visuals = KIND_HUE[event.kind];
  const isRight = p.side === 'right';

  const w = expanded ? EXPANDED_W : COLLAPSED_W;
  const h = expanded ? EXPANDED_H : COLLAPSED_H;
  const centerY = (p.startY + p.endY) / 2;
  const y = centerY - h / 2;
  // Anchor: collapsed cards centered on branch; expanded cards offset outward.
  let x: number;
  if (expanded) {
    x = isRight ? p.x : p.x - w;
  } else {
    x = p.x - w / 2;
  }

  const showActive = isActive || (inCenter && !isAnyActive);

  return (
    <foreignObject
      x={x - 30}
      y={y - 30}
      width={w + 60}
      height={h + 60}
      style={{ overflow: 'visible' }}
    >
      <div
        ref={viewportRef}
        className="kc-timeline-card-wrap"
        onMouseEnter={onHoverStart}
        onMouseLeave={onHoverEnd}
      >
        <motion.button
          ref={tilt.ref as React.Ref<HTMLButtonElement>}
          type="button"
          layout
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          onMouseMove={tilt.onMouseMove}
          onMouseLeave={tilt.onMouseLeave}
          className="kc-timeline-card"
          data-expanded={expanded || undefined}
          data-active={showActive || undefined}
          data-dimmed={!isActive && isAnyActive ? true : undefined}
          style={{
            width: w,
            height: h,
            perspective: 1000,
            transformStyle: 'preserve-3d',
            rotateX: expanded ? tilt.rotateX : 0,
            rotateY: expanded ? tilt.rotateY : 0,
            borderColor: `hsla(${visuals.h}, ${visuals.s}%, ${visuals.l}%, 0.35)`,
            boxShadow: showActive
              ? `0 8px 32px hsla(${visuals.h}, ${visuals.s}%, ${visuals.l}%, 0.25)`
              : undefined,
          }}
        >
          <motion.div
            className="kc-timeline-card__glow"
            style={{ background: hoverGlow }}
            aria-hidden="true"
          />
          <AnimatePresence mode="wait">
            {expanded ? (
              <motion.div
                key="expanded"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="kc-timeline-card__body"
              >
                <div className="kc-timeline-card__row">
                  <span
                    className="kc-timeline-card__chip"
                    style={{ background: p.lineColor }}
                  >
                    {visuals.label}
                  </span>
                  <span className="kc-timeline-card__track">{event.trackName}</span>
                </div>
                <h3 className="kc-timeline-card__title">{event.title}</h3>
                {event.subtitle ? (
                  <p className="kc-timeline-card__subtitle">{event.subtitle}</p>
                ) : null}
                <div className="kc-timeline-card__meta">
                  <span>{formatDate(event.startRaw, { short: true })}</span>
                  {event.endRaw && event.endRaw !== event.startRaw ? (
                    <>
                      <span aria-hidden="true">→</span>
                      <span>{formatDate(event.endRaw, { short: true })}</span>
                    </>
                  ) : null}
                </div>
                {event.achievements.length > 0 ? (
                  <ul className="kc-timeline-card__list">
                    {event.achievements.slice(0, 2).map((a, i) => (
                      <li key={i}>
                        <span
                          className="kc-timeline-card__bullet"
                          style={{ background: p.lineColor }}
                        />
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </motion.div>
            ) : (
              <motion.div
                key="collapsed"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="kc-timeline-card__body kc-timeline-card__body--collapsed"
              >
                <div className="kc-timeline-card__row">
                  <span className="kc-timeline-card__title kc-timeline-card__title--collapsed">
                    {event.title}
                  </span>
                  <span className="kc-timeline-card__year">
                    {event.startRaw ? formatDate(event.startRaw, { short: true }) : ''}
                  </span>
                </div>
                {event.subtitle ? (
                  <span className="kc-timeline-card__subtitle kc-timeline-card__subtitle--collapsed">
                    {event.subtitle}
                  </span>
                ) : null}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.button>
      </div>
    </foreignObject>
  );
}
