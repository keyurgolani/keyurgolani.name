/**
 * Multi-kind timeline event harvesting + lane planning.
 *
 * Pulls dated entries from `experience`, `education`, `awards`, and
 * `publications` sections into a single chronology. The kit's
 * `assignTimelineLanes` + `computeDensityProjection` do the heavy
 * arithmetic; this module is the kinetic-cosmos-specific data adapter.
 */

import type { Portfolio, Period, Section } from '@portfolio/schema';
import { parseLooseDate, slugify } from '@portfolio/kit';
import {
  assignTimelineLanes,
  computeDensityProjection,
  inferKindFromText,
  invertProjection,
  type LaneAssignment,
  type TimelineProjection,
} from '@portfolio/kit/timeline';

export type TimelineEventKind =
  | 'job'
  | 'internship'
  | 'study'
  | 'research'
  | 'project'
  | 'award'
  | 'life';

export interface TimelineEventMeta {
  id: string;
  kind: TimelineEventKind;
  title: string;
  subtitle?: string;
  trackName: string;
  startTs: number;
  endTs: number;
  startRaw: string;
  endRaw: string;
  achievements: string[];
  skills: string[];
  url?: string;
}

export interface TimelineEvent extends TimelineEventMeta {
  // shape consumed by @portfolio/kit/timeline (LaneInputEvent + meta)
  startTs: number;
  endTs: number;
}

/**
 * The agent's keyword-priority rules. First match wins; ordering matters.
 * Hoisting these per-variant is intentional — different metaphors will
 * want different taxonomies.
 */
const KIND_RULES = {
  internship: [/intern(ship)?/i],
  research: [/\b(research|publication|paper|ieee|acm|abstract)\b/i],
  project: [/\b(open[- ]?source|side[- ]?project|github)\b/i],
} as const;

function tsFromLooseDate(raw: string | undefined, fallback: Date): number {
  if (!raw) return fallback.getTime();
  const parsed = parseLooseDate(raw);
  if (!parsed) return fallback.getTime();
  if (parsed.isPresent) return Date.now();
  const month = parsed.month ?? 0;
  const day = parsed.day ?? 1;
  return Date.UTC(parsed.year, month, day);
}

function periodToTs(period: Period | undefined, now: Date): { startTs: number; endTs: number; startRaw: string; endRaw: string } {
  const startRaw = period?.start ?? '';
  const endRaw = period?.end ?? 'Present';
  const startTs = tsFromLooseDate(startRaw, now);
  let endTs = tsFromLooseDate(endRaw, now);
  if (endTs < startTs) endTs = startTs;
  return { startTs, endTs, startRaw, endRaw };
}

/**
 * Harvest a flat list of timeline events from every dated cluster the
 * variant cares about. Returns events sorted by start ascending so the
 * lane planner allocates slots deterministically.
 */
export function collectTimelineEvents(portfolio: Portfolio, now: Date = new Date()): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const section of portfolio.sections) {
    if (section.hidden) continue;
    pushFromSection(events, section, now);
  }

  return events.sort((a, b) => {
    if (a.startTs !== b.startTs) return a.startTs - b.startTs;
    const durA = a.endTs - a.startTs;
    const durB = b.endTs - b.startTs;
    if (durA !== durB) return durA - durB;
    return a.title.localeCompare(b.title);
  });
}

function pushFromSection(events: TimelineEvent[], section: Section, now: Date): void {
  switch (section.kind) {
    case 'experience': {
      for (const item of section.items) {
        const period = periodToTs(item.period, now);
        const haystack = `${item.role} ${item.organization} ${(item.highlights ?? []).join(' ')}`;
        const kind = inferKindFromText<TimelineEventKind>(haystack, KIND_RULES, { fallback: 'job' });
        events.push({
          id: slugify(`experience-${item.organization}-${item.role}-${period.startTs}`),
          kind,
          title: item.role,
          subtitle: item.organization,
          trackName: 'Career',
          ...period,
          achievements: item.highlights ?? [],
          skills: item.skills ?? [],
          url: item.organizationUrl,
        });
      }
      return;
    }
    case 'education': {
      for (const item of section.items) {
        const period = periodToTs(item.period, now);
        events.push({
          id: slugify(`education-${item.institution}-${item.degree}-${period.startTs}`),
          kind: 'study',
          title: item.degree,
          subtitle: `${item.institution}${item.field ? ` — ${item.field}` : ''}`,
          trackName: 'Education',
          ...period,
          achievements: item.achievements ?? [],
          skills: [],
          url: item.institutionUrl,
        });
      }
      return;
    }
    case 'awards': {
      for (const item of section.items) {
        if (!item.receivedAt) continue;
        const ts = tsFromLooseDate(item.receivedAt, now);
        events.push({
          id: slugify(`award-${item.name}-${ts}`),
          kind: 'award',
          title: item.name,
          subtitle: item.organization,
          trackName: 'Awards',
          startTs: ts,
          endTs: ts,
          startRaw: item.receivedAt,
          endRaw: item.receivedAt,
          achievements: item.description ? [item.description] : [],
          skills: [],
          url: item.url,
        });
      }
      return;
    }
    case 'publications': {
      for (const item of section.items) {
        if (!item.publishedAt) continue;
        const ts = tsFromLooseDate(item.publishedAt, now);
        events.push({
          id: slugify(`publication-${item.title}-${ts}`),
          kind: 'research',
          title: item.title,
          subtitle: item.venue ?? (item.authors ?? []).join(', '),
          trackName: 'Research',
          startTs: ts,
          endTs: ts,
          startRaw: item.publishedAt,
          endRaw: item.publishedAt,
          achievements: item.abstract ? [item.abstract] : [],
          skills: [],
          url: item.url ?? item.pdfUrl,
        });
      }
      return;
    }
    default:
      return;
  }
}

export interface TimelineLayout {
  events: TimelineEvent[];
  assignments: LaneAssignment<TimelineEvent>[];
  projection: TimelineProjection;
}

/**
 * Build the full layout: events → lane assignment → density projection
 * (newest at top via invertProjection).
 */
export function buildTimelineLayout(
  portfolio: Portfolio,
  options: { topPadding?: number } = {},
): TimelineLayout {
  const events = collectTimelineEvents(portfolio);
  const assignments = assignTimelineLanes(events, { balance: 'balanced' });
  const projection = invertProjection(
    computeDensityProjection(events, assignments, {
      topPadding: options.topPadding ?? 140,
      minStep: 220,
      maxYearStep: 100,
      pixelsPerExtraSlot: 250,
      globalShrink: 1 / 3,
    }),
  );
  return { events, assignments, projection };
}
