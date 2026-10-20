// Types config-store.ts names without importing the dispatcher back.

/** The Studio transport's dispatcher: runs the named operation for one request. */
export type Dispatch = (request: Request, name: string) => Promise<Response>;
