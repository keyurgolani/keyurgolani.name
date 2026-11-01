import { importMessage } from './pipeline';

// The import's module worker (#9, PR 3). index.ts starts one per import with
// `new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' })`,
// under the demo CSP's worker-src 'self', posts `{ files }`, and terminates it
// once it answers. The worker answers each message with pipeline.ts's
// ImportResult and posts to nothing but the page that started it: no
// fetch, no logging, no other channel.

interface WorkerScope {
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  postMessage(message: unknown): void;
}

const scope = self as unknown as WorkerScope;
scope.onmessage = (event) => {
  scope.postMessage(importMessage(event.data));
};
