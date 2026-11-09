import { z } from 'zod';

// The one zod every product module builds its schemas with. zod 4 compiles a
// fast path for object schemas with `new Function`, and probes for it when a
// schema is built. Under a strict Content Security Policy, with no
// 'unsafe-eval', the browser reports that probe as a violation even though zod
// catches the throw: in the demo's worker, the preview frame, and Studio. So
// zod runs jitless, interpreted, everywhere. The config has to be set before
// the first schema is built, so every product module imports z from here, never
// from zod itself (zod.test.ts holds them to it).
z.config({ jitless: true });

export { z };
