import 'server-only';
import type { PackAxis, Profile } from '@portfolio/appearance';
import type { Site } from '@portfolio/schema';
import { documentAppearance } from '~/lib/document-appearance';
import { log as writeLog, type LogEntry } from './log';

// Whether the live site's appearance renders as published (#19, Slice 4),
// for #1's readiness `packs` check beside the variant's: `degraded` while
// any of its packs falls back, which still serves, as the variant's
// fallback does. Each axis that falls back is one owner diagnostic in the
// log for the revision, `appearance.fallback` with its code, its fixed text,
// and its remediation, however many times readiness asks: a new revision
// that still falls back says so once more. Only ids and fixed text, never
// content; the visitor's own values are no part of it.

export interface AppearanceHealth {
  readonly status: 'ok' | 'degraded';
  /** The pack axes whose published id isn't what renders. */
  readonly fallbackAxes: readonly PackAxis[];
}

export interface AppearanceHealthOptions {
  /** The serving revision, which a diagnostic names and is told once for. */
  readonly revisionId: string;
  readonly profile: Profile;
  readonly log?: (entry: LogEntry) => void;
  /** The revision and axis pairs already told, the process's own unless a test passes one. */
  readonly told?: Set<string>;
}

const TOLD = new Set<string>();

/** The live site's appearance health, telling the owner of each axis that falls back once per revision. */
export function appearanceHealth(
  site: Pick<Site, 'appearance' | 'visitorControls' | 'motionPolicy'>,
  { revisionId, profile, log = writeLog, told = TOLD }: AppearanceHealthOptions,
): AppearanceHealth {
  // The published selection alone: no cookie, no query, no preview.
  const resolved = documentAppearance({ site, variant: site.appearance.variant, profile });
  const fallbackAxes = resolved.fallbackAxes.filter((axis): axis is PackAxis => axis !== 'variant');
  for (const axis of fallbackAxes) {
    const key = `${revisionId} ${axis}`;
    if (told.has(key)) continue;
    told.add(key);
    const diagnostic = resolved.diagnostics.find((each) => each.axis === axis);
    log({
      level: 'warn',
      event: 'appearance.fallback',
      profile,
      revisionId,
      key: axis,
      code: diagnostic?.code ?? 'appearance.unavailable',
      ...(diagnostic ? { message: diagnostic.message, remediation: diagnostic.remediation } : {}),
    });
  }
  return { status: fallbackAxes.length > 0 ? 'degraded' : 'ok', fallbackAxes };
}
