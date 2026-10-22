/**
 * The request header proxy.ts sets to the route table's decision on every
 * request it passes to Next. next.config.ts rewrites one marked `missing`
 * to Next's /_not-found route, which renders the app's 404 page from the
 * server with its 404 status. A page can't: in Next 16 its notFound()
 * answers with an empty document that only JavaScript fills in. The rewrite
 * runs after Next looks in public/, so a file there is still served. It's a
 * module of its own so next.config.ts reads it without the route table,
 * whose variant registry is server-only (#6).
 */
export const ROUTE_HEADER = 'x-portfolio-route';
