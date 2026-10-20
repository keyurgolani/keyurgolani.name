// What /api/ready answers before register() has stored the deployment (#1,
// item 19): 503 with this body and no-store. readiness.ts, served(), and
// proxy.ts each answer it, so a client gets the documented body whichever
// of them runs first. It imports nothing, so proxy.ts can read it.

export const READY_PATH = '/api/ready';

export const STARTING = Object.freeze({ status: 'starting' as const });

/** The headers that go with STARTING. */
export const STARTING_HEADERS = Object.freeze({ 'cache-control': 'no-store' });
