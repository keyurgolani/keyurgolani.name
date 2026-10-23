// The request headers proxy.ts sets for next.config.ts's rewrites. They're in
// a module of their own so next.config.ts reads them without the route table,
// whose variant registry is server-only (#6).

/**
 * The request header proxy.ts sets to the route table's decision on every
 * request it passes to Next. next.config.ts rewrites one marked `missing`
 * to Next's /_not-found route, which renders the app's 404 page from the
 * server with its 404 status. A page can't: in Next 16 its notFound()
 * answers with an empty document that only JavaScript fills in. The rewrite
 * runs after Next looks in public/, so a file there is still served.
 */
export const ROUTE_HEADER = 'x-portfolio-route';

/**
 * The request header proxy.ts sets to the experience segment a visitor page
 * renders in (#6, Slice 2), on each GET or HEAD of one it lets through: the
 * id of the composition the page shows. next.config.ts rewrites the request
 * to that segment, with its path below it and its query as sent, once Next
 * has looked in public/. proxy.ts drops any copy the client sent, so no
 * request picks its own segment.
 *
 * proxy.ts doesn't rewrite the request itself: Next gives the proxy's
 * request an origin of its own, which isn't always the one its router
 * compares a rewrite with, and it fetches a rewrite to any other origin over
 * the network.
 */
export const EXPERIENCE_HEADER = 'x-portfolio-experience';

/** The first segment of every experience segment's path, which the contract reserves. */
export const EXPERIENCE_SEGMENT = '_experience';

/**
 * The ids EXPERIENCE_HEADER may name, as next.config.ts matches its value
 * whole: the registry's id grammar, REGISTRY_ID_PATTERN in @portfolio/schema,
 * which experience.test.ts holds this to.
 */
export const EXPERIENCE_ID = '[a-z][a-z0-9-]{1,47}';
