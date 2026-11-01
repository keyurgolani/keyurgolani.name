// The server's log (#1, item 21): one JSON object per line on stdout, with
// allowlisted fields only. logLine() drops every field its event doesn't
// allow, so no caller can log a body, a cookie, an Authorization header, a
// raw URL, or a secret by passing it along. It imports nothing, so it loads
// wherever the server does.

export type LogLevel = 'info' | 'warn' | 'error' | 'fatal';

/** Fields any event may carry. `route` is a route pattern, never a raw URL. */
const BASE = [
  'level',
  'event',
  'requestId',
  'profile',
  'route',
  'operation',
  'capability',
  'status',
  'code',
  'key',
  'digest',
] as const;

/**
 * A finding at startup: where in the source it is (for one in the document
 * pair, its diagnostic record's document, pointer, position, and section id),
 * and its fixed text and remediation, which never quote a value.
 */
const FINDING = [
  'file',
  'document',
  'path',
  'line',
  'column',
  'stableId',
  'message',
  'remediation',
] as const;

/**
 * A preview grant's events (#7, Slice 2): the first 8 hex characters of the
 * grant's digest and of its session's, never a token or a whole digest, and
 * how many grants an end reached.
 */
const GRANT = ['grantRef', 'sessionRef', 'count'] as const;

/**
 * Media ingestion's events (#10): the asset's id, the source revision's
 * SHA-256, and why a source wasn't used. Never its path or URL.
 */
const MEDIA = ['assetId', 'sha256', 'reason'] as const;

/** What particular events add. */
const EXTRA: Readonly<Record<string, readonly string[]>> = {
  'config.fatal': FINDING,
  'config.warning': FINDING,
  // A pack of the serving revision that falls back (#19, Slice 4): its axis
  // in `key`, its code, and the diagnostic's fixed text, once per revision.
  'appearance.fallback': ['revisionId', 'message', 'remediation'],
  'preview.grant.minted': GRANT,
  'preview.grant.superseded': GRANT,
  'preview.grant.session_ended': GRANT,
  'preview.grant.mark_failed': GRANT,
  'preview.grant.read_failed': GRANT,
  'preview.render_failed': GRANT,
  // A draft grant's pinned generated scheme that isn't whole (#10, 10h):
  // the grant's ref and the scheme's id, a pack id the site names.
  'preview.scheme_dropped': ['grantRef', 'schemeId'],
  'media.asset.derived': MEDIA,
  'media.source.unused': MEDIA,
  'media.startup.asset': MEDIA,
  'media.blob.missing': MEDIA,
  'media.startup.derived': ['count'],
  'media.private.ingested': ['count', 'unused'],
  'deployment.config': [
    'origin',
    'previewOrigin',
    'proxyHops',
    'capabilities',
    'adapters',
    'secrets',
    // demo's read-only reference (#9): served, unavailable, or absent.
    'reference',
  ],
};

/**
 * What the revision store's lines add (#3, item 23), such as
 * store.publish.committed and store.render-drift: the revision IDs, the
 * event's seq, the stage a failure stopped at, how long it took, and the
 * IDs and versions that drifted. Never content.
 */
const STORE = ['revisionId', 'servingRevisionId', 'seq', 'stage', 'durationMs', 'drift'] as const;

export interface LogEntry {
  readonly level: LogLevel;
  readonly event: string;
  readonly [field: string]: unknown;
}

/** The JSON line for `entry`: a timestamp, then each field its event allows that has a value. */
export function logLine(entry: LogEntry, now = new Date()): string {
  const extra = EXTRA[entry.event] ?? (entry.event.startsWith('store.') ? STORE : []);
  const allowed = new Set<string>([...BASE, ...extra]);
  const line: Record<string, unknown> = { ts: now.toISOString() };
  for (const [field, value] of Object.entries(entry)) {
    if (allowed.has(field) && value !== undefined) line[field] = value;
  }
  return `${JSON.stringify(line)}\n`;
}

/** Writes `entry` to stdout as one JSON line. */
export function log(entry: LogEntry): void {
  // console.log is stdout, and tests can replace it without touching the
  // stream the test runner reports through.
  console.log(logLine(entry).slice(0, -1));
}
