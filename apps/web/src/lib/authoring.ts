/**
 * Whether the unauthenticated authoring surface (/admin, /variants,
 * /preview/[slug], and the portfolio, variant, and customize write APIs)
 * is served.
 *
 * This is a property of the build: `next build` inlines NODE_ENV as
 * 'production', so a production build always hides these routes and
 * `next dev` keeps them for local editing. There is deliberately no
 * override, because turning these routes back on in production would
 * re-open unauthenticated reads and writes of the portfolio file.
 */
export function authoringRoutesEnabled(): boolean {
  return process.env.NODE_ENV !== 'production';
}
