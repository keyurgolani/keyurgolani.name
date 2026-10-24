import type { Diagnostic } from '@portfolio/schema';
import type { ImportInput, ImportRefusal, ImportResult } from './pipeline';

// The Demo Studio's import, main-thread side (#9, PR 3). Demo only: it
// loads under the demo profile alone, and #6's forbidden list keeps it out
// of owner and read-only pages.
//
//   importFiles(files, { signal?, timeoutMs? }) -> Promise<ImportResult>
//
// `files` are the two documents of a publication unit, portfolio and site,
// as bytes, in any order and either format: the worker tells them apart by
// content, never by name. The result is
//
// - `{ kind: 'imported', unit, diagnostics, remoteImages, unchecked? }`:
//   `unit.sources` holds each document's text as imported, `unit.models`
//   the documents as #4's validator parsed them, and `unit.schemaVersions`
//   their versions. `diagnostics` are the validator's findings that don't
//   block a preview. `remoteImages` lists each https media source by kind
//   (image, video, audio, document), pointer, and host, for the notice;
//   nothing has loaded them, and they render as placeholders. `unchecked`,
//   when present, lists what the validator couldn't check without the
//   frame's catalog, as fixed strings (pipeline.ts).
// - `{ kind: 'refused', code, diagnostics }`, with `code` one of:
//   - `too_many_files`: more than two files;
//   - `not_one_document`: anything but one portfolio and one site document;
//   - `too_large`: a file over 1 MiB, before it's parsed;
//   - `parse_limits`: past #4's pre-parse limits, a YAML alias bomb among them;
//   - `invalid`: text that doesn't parse, or a pair #4's validator blocks;
//   - `timeout`: no answer within `timeoutMs`, or `signal` aborted;
//   - `worker_unavailable`: no module worker could be built or run.
//   `parse_limits` and `invalid` carry located #4 diagnostics; the rest none.
//
// `timeoutMs` is 5 seconds when absent, and is held between 1 and 30
// seconds.
//
// Parsing never happens on this thread: this module imports pipeline.ts for
// its types alone. It checks only the file count and each file's byteLength
// first, so an oversize pick is never copied, and posts the worker a copy
// of each file's own bytes, which the worker checks again. One module
// worker runs each import, and it's terminated once it answers, times out,
// or the import is aborted. Nothing here logs, fetches, or posts anywhere
// but to that worker. A diagnostic never repeats a value from a file, and
// every key the schema doesn't name is `(unknown key)` in its pointer,
// message, and stableId. Render diagnostics as text, never as HTML.
//
// pipeline.ts's validateImport(sources, ctx) is the validation step on its
// own, for the local frame to run again with its catalog and extensions.

export type {
  ImportedUnit,
  ImportInput,
  ImportRefusal,
  ImportResult,
  PortfolioDocument,
  RemoteImage,
  RemoteMediaKind,
  SiteDocument,
} from './pipeline';

/** How long an import may take before it's refused with `timeout`, when the caller names none. */
export const IMPORT_TIMEOUT_MS = 5000;
/** The shortest and longest `timeoutMs` an import takes; anything outside is held to these. */
export const IMPORT_TIMEOUT_RANGE_MS = { min: 1000, max: 30_000 } as const;
/** #4's document cap, 1 MiB, as the worker applies it (pipeline.ts's IMPORT_MAX_BYTES). */
export const IMPORT_MAX_BYTES = 1024 * 1024;

export interface ImportOptions {
  readonly signal?: AbortSignal;
  /** Milliseconds: IMPORT_TIMEOUT_MS when absent or not a number, else held to IMPORT_TIMEOUT_RANGE_MS. */
  readonly timeoutMs?: number;
}

const REFUSALS: ReadonlySet<string> = new Set<ImportRefusal>([
  'too_large',
  'too_many_files',
  'not_one_document',
  'parse_limits',
  'timeout',
  'invalid',
  'worker_unavailable',
]);

/** The timeout an import runs with, for the `timeoutMs` a caller gives. */
export function importTimeout(timeoutMs: number | undefined): number {
  if (typeof timeoutMs !== 'number' || Number.isNaN(timeoutMs)) return IMPORT_TIMEOUT_MS;
  const { min, max } = IMPORT_TIMEOUT_RANGE_MS;
  return Math.min(max, Math.max(min, timeoutMs));
}

export function importFiles(
  files: readonly ImportInput[],
  options: ImportOptions = {},
): Promise<ImportResult> {
  const { signal } = options;
  const timeoutMs = importTimeout(options.timeoutMs);
  if (signal?.aborted) return Promise.resolve(refused('timeout'));
  // The count and sizes, before anything is copied. No decode, no parse.
  if (files.length > 2) return Promise.resolve(refused('too_many_files'));
  if (files.length < 2) return Promise.resolve(refused('not_one_document'));
  if (files.some(({ bytes }) => bytes.byteLength > IMPORT_MAX_BYTES)) {
    return Promise.resolve(refused('too_large'));
  }
  // Each file's own bytes, not the whole buffer a view may sit on.
  const copies = files.map(({ name, bytes }) => ({ name, bytes: bytes.slice() }));

  let worker: Worker;
  try {
    worker = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    // No Worker, or one the page's policy blocks: never parse here instead.
    return Promise.resolve(refused('worker_unavailable'));
  }

  return new Promise<ImportResult>((resolve) => {
    let settled = false;
    const finish = (result: ImportResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      resolve(result);
    };
    const stop = () => finish(refused('timeout'));
    const timer = setTimeout(stop, timeoutMs);
    signal?.addEventListener('abort', stop, { once: true });
    worker.onmessage = (event: MessageEvent<unknown>) => {
      finish(isResult(event.data) ? event.data : refused('worker_unavailable'));
    };
    worker.onerror = (event: ErrorEvent) => {
      // Handled here, so the browser never shows it in the console as well.
      event.preventDefault();
      finish(refused('worker_unavailable'));
    };
    worker.onmessageerror = () => finish(refused('worker_unavailable'));
    try {
      // Transferred, so the copies move rather than being cloned again.
      worker.postMessage(
        { files: copies },
        copies.map(({ bytes }) => bytes.buffer),
      );
    } catch {
      finish(refused('worker_unavailable'));
    }
  });
}

function refused(code: ImportRefusal, diagnostics: readonly Diagnostic[] = []): ImportResult {
  return { kind: 'refused', code, diagnostics };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isList = (value: unknown, item: (entry: unknown) => boolean) =>
  Array.isArray(value) && value.every(item);

function isDiagnostic(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.code === 'string' &&
    typeof value.document === 'string' &&
    typeof value.pointer === 'string' &&
    typeof value.message === 'string' &&
    typeof value.remediation === 'string'
  );
}

function isSource(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.text === 'string' &&
    (value.format === 'yaml' || value.format === 'json') &&
    typeof value.name === 'string'
  );
}

function isUnit(value: unknown): boolean {
  if (!isObject(value)) return false;
  const { sources, models, schemaVersions } = value;
  return (
    isObject(sources) &&
    isSource(sources.portfolio) &&
    isSource(sources.site) &&
    isObject(models) &&
    isObject(models.portfolio) &&
    isObject(models.site) &&
    isObject(schemaVersions) &&
    typeof schemaVersions.portfolio === 'number' &&
    typeof schemaVersions.site === 'number'
  );
}

function isRemote(value: unknown): boolean {
  return (
    isObject(value) &&
    (value.document === 'portfolio' || value.document === 'site') &&
    ['image', 'video', 'audio', 'document'].includes(value.kind as string) &&
    typeof value.pointer === 'string' &&
    typeof value.host === 'string'
  );
}

/** Whether the worker's answer has ImportResult's shape, all of it. */
export function isResult(value: unknown): value is ImportResult {
  if (!isObject(value) || !isList(value.diagnostics, isDiagnostic)) return false;
  if (value.kind === 'refused') {
    return typeof value.code === 'string' && REFUSALS.has(value.code);
  }
  return (
    value.kind === 'imported' &&
    isUnit(value.unit) &&
    isList(value.remoteImages, isRemote) &&
    (value.unchecked === undefined || isList(value.unchecked, (entry) => typeof entry === 'string'))
  );
}
