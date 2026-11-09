import { config } from 'zod';

// The one zod every product module builds its schemas with, as
// `import * as z from` this module. zod 4 compiles a fast path for object
// schemas with `new Function`, and probes for it when a schema is built. Under
// a strict Content Security Policy, with no 'unsafe-eval', the browser reports
// that probe as a violation even though zod catches the throw: in the demo's
// worker, the preview frame, and Studio. So zod runs jitless, interpreted,
// everywhere. The config has to be set before the first schema is built, so
// every product module imports z from here, never from zod itself (zod.test.ts
// holds them to it). package.json names this file in sideEffects: a bundler
// that took the package as side-effect free would resolve the re-exports
// straight to zod and drop the config.
//
// The re-export is by name, never zod's own `z` namespace as a value: a
// namespace handed out whole keeps every member, every locale and the JSON
// Schema converter among them, in each page that loads zod. Imported as a
// namespace here and used by name, what a page doesn't use shakes out.
config({ jitless: true });

export * from 'zod';
