// Cleanup on Ctrl-C (#11, Slice 1): a quality run that installed something
// outside the checkout, such as --external-variant's worktree, removes it
// when the run is interrupted, instead of leaving it for the next run.

/**
 * Runs `cleanup` once when the process gets SIGINT or SIGTERM, then exits
 * 130 or 143, as a shell reports either. Returns a function that drops the
 * handlers, for once the caller cleans up itself.
 *
 * @param {() => void} cleanup
 * @returns {() => void}
 */
export function cleanupOnInterrupt(cleanup) {
  let done = false;
  const handlers = {
    SIGINT: () => interrupted('SIGINT', 130),
    SIGTERM: () => interrupted('SIGTERM', 143),
  };
  function interrupted(signal, code) {
    if (done) return;
    done = true;
    console.error(`[quality] ${signal}: cleaning up before exiting`);
    try {
      cleanup();
    } finally {
      process.exit(code);
    }
  }
  for (const [signal, handler] of Object.entries(handlers)) process.once(signal, handler);
  return () => {
    done = true;
    for (const [signal, handler] of Object.entries(handlers)) process.off(signal, handler);
  };
}
