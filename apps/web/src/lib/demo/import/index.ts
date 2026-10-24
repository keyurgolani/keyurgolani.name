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
// - `{ kind: 'imported', unit, diagnostics, remoteImages }`: `unit.sources`
//   holds each document's text as imported, `unit.models` the documents as
//   #4's validator parsed them, and `unit.schemaVersions` their versions.
//   `diagnostics` are the validator's findings that don't block a preview.
//   `remoteImages` lists each https image by pointer and host, for the
//   notice; nothing has loaded them, and they render as placeholders.
// - `{ kind: 'refused', code, diagnostics }`, with `code` one of:
//   - `too_many_files`: more than two files;
//   - `not_one_document`: anything but one portfolio and one site document;
//   - `too_large`: a file over 1 MiB, before it's parsed;
//   - `parse_limits`: past #4's pre-parse limits, a YAML alias bomb among them;
//   - `invalid`: text that doesn't parse, or a pair #4's validator blocks;
//   - `timeout`: no answer within `timeoutMs` (5 seconds), or `signal` aborted;
//   - `worker_unavailable`: no module worker could be built or run.
//   `parse_limits` and `invalid` carry located #4 diagnostics; the rest none.
//
// Parsing never happens on this thread: this module imports pipeline.ts for
// its types alone. One module worker runs each import, and it's terminated
// once it answers, times out, or the import is aborted. Nothing here logs,
// fetches, or posts anywhere but to that worker, and a diagnostic never
// repeats a value from a file.
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
  SiteDocument,
} from './pipeline';

/** How long an import may take before it's refused with `timeout`. */
export const IMPORT_TIMEOUT_MS = 5000;

export interface ImportOptions {
  readonly signal?: AbortSignal;
  /** Milliseconds; IMPORT_TIMEOUT_MS when absent or not a positive number. */
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

export function importFiles(
  files: readonly ImportInput[],
  options: ImportOptions = {},
): Promise<ImportResult> {
  const { signal } = options;
  const timeoutMs =
    typeof options.timeoutMs === 'number' && options.timeoutMs > 0
      ? options.timeoutMs
      : IMPORT_TIMEOUT_MS;
  if (signal?.aborted) return Promise.resolve(refused('timeout'));

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
      worker.postMessage({ files });
    } catch {
      finish(refused('worker_unavailable'));
    }
  });
}

function refused(code: ImportRefusal, diagnostics: readonly Diagnostic[] = []): ImportResult {
  return { kind: 'refused', code, diagnostics };
}

/** Whether the worker's answer has ImportResult's shape. */
function isResult(value: unknown): value is ImportResult {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Record<string, unknown>;
  if (!Array.isArray(result.diagnostics)) return false;
  if (result.kind === 'refused')
    return typeof result.code === 'string' && REFUSALS.has(result.code);
  return (
    result.kind === 'imported' &&
    typeof result.unit === 'object' &&
    result.unit !== null &&
    Array.isArray(result.remoteImages)
  );
}
