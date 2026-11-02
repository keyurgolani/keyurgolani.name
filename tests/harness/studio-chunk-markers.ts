// The strings only each Studio's client code holds (#9), which the chunk
// specs look for in what each profile's /studio loads:
// tests/e2e/demo-studio-chunks.spec.ts under demo, and
// tests/e2e/owner-studio-chunks.spec.ts under owner.

/** Strings only Owner Studio's code holds, with the module each comes from. */
export const OWNER_MARKERS = {
  // lib/studio/owner-backend.ts: one of its failure messages.
  'owner adapter': 'The data directory is full. Your changes are kept in this browser.',
  // lib/studio-fetch.ts: the event it sends when a session ends.
  studioFetch: 'studio:auth-required',
  // lib/studio/journal.ts: its key prefix.
  journal: 'portfolio-studio:',
  // _components/shell/studio-shell.tsx: its no-JavaScript notice.
  'owner shell': 'Portfolio Studio needs JavaScript',
};

/** Strings only Demo Studio's code holds, with the module each comes from. */
export const DEMO_MARKERS = {
  // lib/demo/browser-backend.ts: the start of its NOT_OFFERED message.
  'browser backend': 'The demo changes the appearance only.',
  // lib/demo/storage.ts: its key prefix.
  'demo storage': 'portfolio-demo:',
  // lib/demo/state-lines.ts, which _components/demo/demo-studio.tsx renders: the sandbox line.
  'demo body': 'Demo sandbox',
};

/** Which of `markers` any of `scripts` holds. */
export const found = (scripts: Map<string, string>, markers: Record<string, string>) =>
  Object.entries(markers)
    .filter(([, marker]) => [...scripts.values()].some((body) => body.includes(marker)))
    .map(([name]) => name);
