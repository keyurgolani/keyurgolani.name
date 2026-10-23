import type { RuntimeMode } from './config';

// The mode this code was compiled in (#7). Next writes NODE_ENV into the
// code as it compiles it, so `next dev` is development and a production
// build is production, whatever environment its server starts with. The
// preview's and Studio's policies relax for React's dev build and hot
// reloading only by this, never by the NODE_ENV a server starts under: a
// production build run with NODE_ENV=development keeps its strict policies.
// The route table's PREVIEW_DEV reads NODE_ENV the same way.

/** `development` under `next dev`, and `production` in a production build. */
export const COMPILED_MODE: RuntimeMode =
  process.env.NODE_ENV === 'development' ? 'development' : 'production';
