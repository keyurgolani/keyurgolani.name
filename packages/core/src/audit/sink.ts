import { recordOwnerModule } from '../load-trace';
import {
  appendAuditRecord,
  auditRecord,
  type AuditActor,
  type AuditOutcome,
  type AuditRecord,
  type AuditRefs,
  type AuditType,
} from './record.mjs';

// The AuditSink port (#2; #3 takes it over), its filesystem adapter, a
// memory adapter for tests, and the aggregation of anonymous failures.

recordOwnerModule('core/audit/sink');

export interface AuditEvent {
  readonly type: AuditType;
  readonly actor: AuditActor;
  readonly outcome: AuditOutcome;
  readonly refs?: Readonly<AuditRefs>;
  /** When it happened, in milliseconds. Defaults to when it's recorded. */
  readonly at?: number;
}

export interface AuditSink {
  /**
   * Records one event. It never throws: a failed write is logged, and the
   * caller's decision, such as an authorization result, stands.
   */
  record(event: AuditEvent): Promise<void>;
  /** Writes whatever aggregation is holding. */
  flush(): Promise<void>;
}

/** The server log, as the composition root injects it. */
export type OwnerLog = (entry: {
  readonly level: 'warn' | 'error';
  readonly event: string;
  readonly code?: string;
}) => void;

export interface FilesystemAuditOptions {
  readonly dataDir: string;
  readonly now?: () => number;
  readonly log?: OwnerLog;
  /** The operation names a `command` ref may hold. Without it, any name-shaped one. */
  readonly commands?: ReadonlySet<string>;
}

/** Appends each event to audit/<yyyy-mm>.jsonl under the data directory. */
export function filesystemAuditSink({
  dataDir,
  now = Date.now,
  log = () => {},
  commands,
}: FilesystemAuditOptions): AuditSink {
  return {
    async record(event) {
      try {
        await appendAuditRecord(
          dataDir,
          auditRecord({ ...event, at: event.at ?? now() }, { commands }),
        );
      } catch {
        log({ level: 'error', event: 'audit.write_failed', code: event.type });
      }
    },
    async flush() {},
  };
}

export interface MemoryAuditSink extends AuditSink {
  readonly records: readonly Readonly<AuditRecord>[];
}

/**
 * Keeps each record in memory, built the way the filesystem adapter builds
 * it. Like that adapter, it never throws: an event it can't build is dropped.
 */
export function memoryAuditSink(
  now: () => number = Date.now,
  { commands }: { readonly commands?: ReadonlySet<string> } = {},
): MemoryAuditSink {
  const records: Readonly<AuditRecord>[] = [];
  return {
    records,
    async record(event) {
      try {
        records.push(auditRecord({ ...event, at: event.at ?? now() }, { commands }));
      } catch {
        // The filesystem adapter logs this; a test sink has no log.
      }
    },
    async flush() {},
  };
}

/** Anonymous events that arrive in floods. */
const AGGREGATED: ReadonlySet<AuditType> = new Set([
  'login_failed',
  'login_throttled',
  'command_denied',
]);
const WINDOW_MS = 60_000;

/** The refs a bucket is kept by and writes: every one but the request ID and the count. */
const BUCKET_REFS = ['source', 'command', 'reason', 'capability', 'sessionRef'] as const;
type BucketRefs = Partial<Record<(typeof BUCKET_REFS)[number], string>>;

interface Bucket {
  readonly type: AuditType;
  readonly outcome: AuditOutcome;
  readonly refs: Readonly<BucketRefs>;
  readonly window: number;
  /** When the first event it holds came, after the one it wrote at once. */
  at: number;
  /** How many events it holds for the end of the minute. */
  held: number;
}

export interface AggregateOptions {
  readonly now?: () => number;
  /** Schedules the write at a window's end. Tests pass their own. */
  readonly schedule?: (run: () => void, delayMs: number) => void;
}

const unrefTimer = (run: () => void, delayMs: number) => {
  setTimeout(run, delayMs).unref?.();
};

/**
 * Wraps `inner` so anonymous `login_failed`, `login_throttled`, and
 * `command_denied` events don't each write a line. Events are counted per
 * type and refs (the source, command, reason, capability, and session ref;
 * never the request ID) per minute. The first one each minute is written at
 * once, with a count of 1, so a crash or an exit loses at most the count held
 * after it. The rest are written as one record when the minute ends, with
 * their count and the time of the first of them. Every other event passes
 * straight through.
 */
export function aggregateAnonymous(
  inner: AuditSink,
  { now = Date.now, schedule = unrefTimer }: AggregateOptions = {},
): AuditSink {
  const buckets = new Map<string, Bucket>();
  let scheduled = false;
  let draining: Promise<void> = Promise.resolve();

  const write = (bucket: Bucket) =>
    inner.record({
      type: bucket.type,
      actor: 'anonymous',
      outcome: bucket.outcome,
      refs: { ...bucket.refs, count: bucket.held },
      at: bucket.at,
    });

  /** Writes what every bucket whose minute is over holds, or every bucket. */
  async function drain(all: boolean): Promise<void> {
    const current = Math.floor(now() / WINDOW_MS);
    for (const [key, bucket] of [...buckets]) {
      if (!all && bucket.window >= current) continue;
      // An event of a new minute replaced it meanwhile, and wrote it.
      if (buckets.get(key) !== bucket) continue;
      buckets.delete(key);
      if (bucket.held > 0) await write(bucket);
    }
  }

  /** One drain at a time, so a flush waits for a minute's end in progress. */
  function queueDrain(all: boolean): Promise<void> {
    draining = draining.then(() => drain(all)).catch(() => {});
    return draining;
  }

  function arm(): void {
    if (scheduled || buckets.size === 0) return;
    scheduled = true;
    const delay = (Math.floor(now() / WINDOW_MS) + 1) * WINDOW_MS - now() + 50;
    schedule(() => {
      scheduled = false;
      void queueDrain(false).then(arm);
    }, delay);
  }

  return {
    async record(event) {
      if (event.actor !== 'anonymous' || !AGGREGATED.has(event.type)) {
        await inner.record(event);
        return;
      }
      const at = now();
      const window = Math.floor(at / WINDOW_MS);
      const refs: BucketRefs = { source: 'unknown' };
      for (const name of BUCKET_REFS) {
        const value = event.refs?.[name];
        if (typeof value === 'string') refs[name] = value;
      }
      const key = JSON.stringify([
        event.type,
        event.outcome,
        ...BUCKET_REFS.map((name) => refs[name]),
      ]);
      const bucket = buckets.get(key);
      if (bucket && bucket.window === window) {
        if (bucket.held === 0) bucket.at = at;
        bucket.held += 1;
        return;
      }
      // A new minute for this key. Its bucket goes in before anything is
      // awaited, so the events that arrive meanwhile count in it.
      buckets.set(key, { type: event.type, outcome: event.outcome, refs, window, at, held: 0 });
      arm();
      if (bucket && bucket.held > 0) await write(bucket);
      await inner.record({ ...event, refs: { ...event.refs, ...refs, count: 1 }, at });
    },
    async flush() {
      await queueDrain(true);
      await inner.flush();
    },
  };
}
