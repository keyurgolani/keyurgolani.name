// Ends the process when the deployment can't start. It imports nothing, so
// it loads even when the deployment modules throw while they load.

/** Whether the deployment can start, and if not, the log lines to write before exiting. */
export type Registration = { readonly ok: true } | { readonly ok: false; readonly log: string };

/** Where a refusal writes and how it exits. Tests pass their own. */
export interface ExitIo {
  /** Calls done once the reader has the text, or the write has failed. */
  readonly write: (text: string, done: () => void) => void;
  readonly exit: (code: number) => void;
  /** How long to wait for a reader that never drains the pipe. */
  readonly flushTimeoutMs: number;
}

const STDOUT: ExitIo = {
  write: (text, done) => {
    process.stdout.write(text, () => done());
  },
  exit: (code) => process.exit(code),
  flushTimeoutMs: 10_000,
};

/**
 * Runs `start` for instrumentation register(), and returns once the
 * deployment can start. On a refusal, or any error from `start`, it writes
 * the log and exits 1 once stdout has taken it, however slowly the reader
 * drains the pipe: a full pipe holds the write in the stream, where
 * fs.writeSync would throw EAGAIN. It never rejects. Next would log the
 * rejection and go on answering every request with a 500.
 */
export async function startOrExit(
  start: () => Registration | Promise<Registration>,
  io: ExitIo = STDOUT,
): Promise<void> {
  let log: string;
  try {
    const registration = await start();
    if (registration.ok) return;
    log = registration.log;
  } catch {
    log = startupFailed();
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, io.flushTimeoutMs);
    io.write(log, () => {
      clearTimeout(timer);
      resolve();
    });
  }).catch(() => {});
  io.exit(1);
}

/**
 * The line for an error nothing anticipated, such as a module that throws
 * while it loads. It names no cause: an error message can carry a path or a
 * configured value.
 */
function startupFailed(): string {
  const line = {
    ts: new Date().toISOString(),
    level: 'fatal',
    event: 'config.fatal',
    code: 'startup_failed',
    message: 'Startup failed on an unexpected error, so the server will not start.',
  };
  return `${JSON.stringify(line)}\n`;
}
